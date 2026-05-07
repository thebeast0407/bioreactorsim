"""
Bioreactor Batch Simulation
All parameters driven by config.json.
Run frequency: configurable (default 1 min), batch duration: configurable (default 48 h).
"""

import json
import math
import csv
import os
import sys
from dataclasses import dataclass
from typing import Any, Optional

import threading
import queue
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.gridspec import GridSpec


# ── Config loader ─────────────────────────────────────────────────────────────

def load_config(path: str = "config.json") -> dict[str, Any]:
    with open(path) as f:
        return json.load(f)


# ── State ─────────────────────────────────────────────────────────────────────

@dataclass
class BioreactorState:
    pH: float
    temperature: float
    pressure: float
    dissolved_oxygen: float
    viable_cell_density: float
    dead_cell_density: float
    substrate: float
    lactate: float
    growth_rate: float = 0.0
    death_rate: float = 0.0
    viability: float = 100.0
    time: float = 0.0

    @classmethod
    def from_config(cls, cfg: dict) -> "BioreactorState":
        sp = cfg["setpoints"]
        ic = cfg["initial_conditions"]
        return cls(
            pH=sp["pH"],
            temperature=sp["temperature_C"],
            pressure=sp["pressure_bar"],
            dissolved_oxygen=sp["dissolved_oxygen_pct"],
            viable_cell_density=ic["viable_cell_density"],
            dead_cell_density=ic["dead_cell_density"],
            substrate=ic["substrate_g_L"],
            lactate=ic["lactate_g_L"],
        )


# ── Alarm helper ──────────────────────────────────────────────────────────────

@dataclass
class Alarm:
    time_h: float
    parameter: str
    level: str          # "ALERT" | "LIMIT"
    direction: str      # "LOW" | "HIGH"
    value: float
    threshold: float

    def __str__(self) -> str:
        return (
            f"[t={self.time_h:6.2f}h] {self.level:<5} {self.direction:<4} "
            f"{self.parameter}: {self.value:.4f}  (threshold={self.threshold})"
        )


# ── Kinetic model ─────────────────────────────────────────────────────────────

class KineticModel:
    def __init__(self, cfg: dict) -> None:
        k = cfg["kinetics"]
        self.mu_max       = k["mu_max"]
        self.Ks           = k["Ks"]
        self.Kd_base      = k["Kd_base"]
        self.Ki_lactate   = k["Ki_lactate"]
        self.Ko           = k["Ko_do"]
        self.pH_opt       = k["pH_optimum"]
        self.pH_sigma     = k["pH_sigma"]
        self.T_opt        = k["temperature_optimum_C"]
        self.T_sigma      = k["temperature_sigma"]
        self.T_hard_min   = k["temperature_hard_min_C"]
        self.T_hard_max   = k["temperature_hard_max_C"]
        self.P_opt        = k["pressure_optimum_bar"]
        self.P_sigma      = k["pressure_sigma"]
        self.sm           = k["stress_multipliers"]
        self.kd_cap       = k["death_rate_cap"]

    def _pH_factor(self, pH: float) -> float:
        return math.exp(-0.5 * ((pH - self.pH_opt) / self.pH_sigma) ** 2)

    def _temp_factor(self, T: float) -> float:
        if T < self.T_hard_min or T > self.T_hard_max:
            return 0.0
        return math.exp(-0.5 * ((T - self.T_opt) / self.T_sigma) ** 2)

    def _do_factor(self, do: float) -> float:
        return max(do, 0.0) / (max(do, 0.0) + self.Ko)

    def _pressure_factor(self, P: float) -> float:
        return math.exp(-0.5 * ((P - self.P_opt) / self.P_sigma) ** 2)

    def _substrate_factor(self, S: float, L: float) -> float:
        if S <= 0:
            return 0.0
        return (S / (S + self.Ks)) * (1.0 / (1.0 + L / self.Ki_lactate))

    def growth_rate(self, state: BioreactorState) -> float:
        mu = (
            self.mu_max
            * self._substrate_factor(state.substrate, state.lactate)
            * self._pH_factor(state.pH)
            * self._temp_factor(state.temperature)
            * self._do_factor(state.dissolved_oxygen)
            * self._pressure_factor(state.pressure)
        )
        # Lag-phase ramp: cells take ~2-4 h to adapt after inoculation.
        # 1 - exp(-0.6*t): t=0→0, t=1h→0.45, t=2h→0.70, t=4h→0.91, t=8h→0.99
        lag = 1.0 - math.exp(-0.6 * max(0.0, state.time))
        return max(mu * lag, 0.0)

    def death_rate(self, state: BioreactorState) -> float:
        stress = (
            (1.0 + self.sm["pH"]               * max(0.0, 1.0 - self._pH_factor(state.pH)))
            * (1.0 + self.sm["temperature"]    * max(0.0, 1.0 - self._temp_factor(state.temperature)))
            * (1.0 + self.sm["dissolved_oxygen"] * max(0.0, 1.0 - self._do_factor(state.dissolved_oxygen)))
            * (1.0 + self.sm["pressure"]        * max(0.0, 1.0 - self._pressure_factor(state.pressure)))
        )
        # Death ramp: background death rate is very low at inoculation, rises over ~6 h.
        # 1 - exp(-0.35*t): t=0→0, t=2h→0.50, t=4h→0.75, t=8h→0.94
        death_ramp = 1.0 - math.exp(-0.35 * max(0.0, state.time))
        return min(self.Kd_base * stress * death_ramp, self.kd_cap)


# ── CPP dynamics ──────────────────────────────────────────────────────────────

class ProcessDynamics:
    def __init__(self, cfg: dict, rng: np.random.Generator) -> None:
        sp = cfg["setpoints"]
        pd = cfg["process_dynamics"]
        lim = cfg["cpp_limits"]
        me = pd["metabolic_effects"]

        self.sp_pH   = sp["pH"]
        self.sp_temp  = sp["temperature_C"]
        self.sp_press = sp["pressure_bar"]
        self.sp_do    = sp["dissolved_oxygen_pct"]

        tc = pd["time_constants_hours"]
        self.tau_pH    = tc["pH"]
        self.tau_temp  = tc["temperature"]
        self.tau_press = tc["pressure"]
        self.tau_do    = tc["dissolved_oxygen"]

        ns = pd["noise_std_per_sqrt_hour"]
        self.noise_pH    = ns["pH"]
        self.noise_temp  = ns["temperature"]
        self.noise_press = ns["pressure"]
        self.noise_do    = ns["dissolved_oxygen"]

        self.pH_drop_coeff  = me["pH_drop_per_1e6_cells_per_hour"]
        self.heat_coeff     = me["heat_per_1e6_cells_per_hour"]
        self.our_coeff      = me["our_mmol_per_cell_per_hour"]

        self.press_floor = lim["pressure_bar"]["floor"]
        self.rng = rng

    def step(self, state: BioreactorState, dt: float) -> None:
        vcd_M = state.viable_cell_density / 1e6
        sqrt_dt = math.sqrt(dt)

        state.pH = (
            state.pH
            + dt / self.tau_pH * (self.sp_pH - state.pH)
            - self.pH_drop_coeff * vcd_M * dt
            + self.rng.normal(0, self.noise_pH * sqrt_dt)
        )

        state.temperature = (
            state.temperature
            + dt / self.tau_temp * (self.sp_temp - state.temperature)
            + self.heat_coeff * vcd_M * dt
            + self.rng.normal(0, self.noise_temp * sqrt_dt)
        )

        state.pressure = max(
            self.press_floor,
            state.pressure
            + dt / self.tau_press * (self.sp_press - state.pressure)
            + self.rng.normal(0, self.noise_press * sqrt_dt),
        )

        our = self.our_coeff * state.viable_cell_density * dt
        do_sp_eff = self.sp_do - our * 100
        state.dissolved_oxygen = float(np.clip(
            state.dissolved_oxygen
            + dt / self.tau_do * (do_sp_eff - state.dissolved_oxygen)
            + self.rng.normal(0, self.noise_do * sqrt_dt),
            0.0, 100.0,
        ))


# ── Alarm checker ─────────────────────────────────────────────────────────────

class AlarmChecker:
    def __init__(self, cfg: dict) -> None:
        self.limits = cfg["cpp_limits"]
        # map config key → state attribute
        self._map = {
            "pH":                ("pH",               "pH"),
            "temperature_C":     ("temperature_C",    "temperature"),
            "pressure_bar":      ("pressure_bar",     "pressure"),
            "dissolved_oxygen_pct": ("dissolved_oxygen_pct", "dissolved_oxygen"),
        }

    def check(self, state: BioreactorState) -> list[Alarm]:
        alarms: list[Alarm] = []
        for cfg_key, (label, attr) in self._map.items():
            lim = self.limits[cfg_key]
            val = getattr(state, attr)
            checks = [
                ("LIMIT", "LOW",  val < lim["min"],        lim["min"]),
                ("LIMIT", "HIGH", val > lim["max"],        lim["max"]),
                ("ALERT", "LOW",  val < lim["alert_low"],  lim["alert_low"]),
                ("ALERT", "HIGH", val > lim["alert_high"], lim["alert_high"]),
            ]
            for level, direction, triggered, threshold in checks:
                if triggered:
                    alarms.append(Alarm(state.time, label, level, direction, val, threshold))
        return alarms



# ── Fault catalogue & engine ──────────────────────────────────────────────────

FAULT_CATALOGUE: list[dict] = [
    # ── Process faults ────────────────────────────────────────────────────────
    {"id": "agitator_power_loss", "category": "process",
     "name": "Agitator Power Loss",
     "desc": "RPM drops 80 %; kLa halves, DO crashes below 10 % within 30 min.",
     "trigger_default_h": 8.0},
    {"id": "sparger_blockage",    "category": "process",
     "name": "Sparger Blockage",
     "desc": "Air stones clog; OTR to 20 %, hypoxic stress, lactate buildup.",
     "trigger_default_h": 12.0},
    {"id": "gas_supply_failure",  "category": "process",
     "name": "Gas Supply Failure",
     "desc": "O2-enriched air stops; DO to 0 % within 1 h, anaerobic shift.",
     "trigger_default_h": 10.0},
    {"id": "foam_overflow",       "category": "process",
     "name": "Foam Overflow via Sparger",
     "desc": "Foam blocks gas inlet; intermittent DO spikes/drops every 15 min.",
     "trigger_default_h": 14.0},
    {"id": "viscosity_surge",     "category": "process",
     "name": "Broth Viscosity Surge",
     "desc": "High biomass; kLa drops 60 %, poor DO transfer.",
     "trigger_default_h": 24.0},
    {"id": "antifoam_injection",  "category": "process",
     "name": "Anti-foam Over-injection",
     "desc": "Bubble coalescence; kLa -40 %, sustained mass transfer loss.",
     "trigger_default_h": 8.0},
    {"id": "impeller_shear",      "category": "process",
     "name": "Impeller Shear Damage",
     "desc": "High-shear cell lysis; OUR spikes, DO controller hunts.",
     "trigger_default_h": 16.0},
    {"id": "coolant_leak",        "category": "process",
     "name": "Coolant Leak to Sparge Line",
     "desc": "Cold O2-sat air; DO supersaturates >100 %, oxidative stress.",
     "trigger_default_h": 10.0},
    {"id": "exhaust_filter_clog", "category": "process",
     "name": "Exhaust Filter Clog",
     "desc": "Back-pressure; reduced sparge flow, DO undershoot, pressure rise.",
     "trigger_default_h": 18.0},
    {"id": "seed_hypoxia",        "category": "process",
     "name": "Seed Train Hypoxia",
     "desc": "Low-DO inoculum; lag phase extended, DO overshoot early batch.",
     "trigger_default_h": 0.0},
    # ── Sensor / actuator faults ──────────────────────────────────────────────
    {"id": "do_probe_bias",       "category": "sensor",
     "name": "DO Probe Bias (-20 %)",
     "desc": "Probe reads 20 % low; displayed DO understated.",
     "trigger_default_h": 5.0},
    {"id": "pid_fault",           "category": "sensor",
     "name": "PID Tuning Fault",
     "desc": "Temp controller Kp 10x too high; +/-5 degC oscillations.",
     "trigger_default_h": 3.0},
    {"id": "antifoam_overdose",   "category": "sensor",
     "name": "Antifoam Overdose",
     "desc": "kLa reduced 30 %; reduced O2 mass transfer.",
     "trigger_default_h": 8.0},
    # ── CPP excursions ───────────────────────────────────────────────────────
    {"id": "ph_high",             "category": "excursion",
     "name": "pH Excursion High (>8.0)",
     "desc": "Ammonia toxicity: pH forced above 8.0, 25 % viability loss.",
     "trigger_default_h": 8.0},
    {"id": "ph_low",              "category": "excursion",
     "name": "pH Excursion Low (<5.5)",
     "desc": "Enzyme denaturation: growth halts, lactate overproduction.",
     "trigger_default_h": 8.0},
    {"id": "ph_oscillation",      "category": "excursion",
     "name": "pH Oscillation (+/-0.5)",
     "desc": "Base/acid pump hunting: cell stress cycles at 30-min period.",
     "trigger_default_h": 6.0},
    {"id": "do_low_sustained",    "category": "excursion",
     "name": "DO Excursion Low (<10 % sustained)",
     "desc": "Hypoxic stress >2 h: lactate shift, titer drop 40 %.",
     "trigger_default_h": 10.0},
    {"id": "do_high",             "category": "excursion",
     "name": "DO Excursion High (>60 %)",
     "desc": "Oxidative damage: ROS buildup, apoptosis cascade.",
     "trigger_default_h": 10.0},
    {"id": "do_hunting",          "category": "excursion",
     "name": "DO Setpoint Hunting",
     "desc": "PID overshoot: boom-bust DO cycles at 20-min period.",
     "trigger_default_h": 8.0},
    {"id": "temp_high",           "category": "excursion",
     "name": "Temp Excursion High (>42 degC)",
     "desc": "Heat shock: inclusion bodies, 30 % yield loss.",
     "trigger_default_h": 12.0},
    {"id": "temp_low",            "category": "excursion",
     "name": "Temp Excursion Low (<28 degC)",
     "desc": "Membrane rigidity: nutrient uptake fails, 12 h lag.",
     "trigger_default_h": 12.0},
    {"id": "temp_ramp",           "category": "excursion",
     "name": "Temp Ramp (>1 degC/h)",
     "desc": "Thermal gradients: uneven growth zones, moderate cell stress.",
     "trigger_default_h": 6.0},
]


# Recovery function name for every fault id
RECOVERY_NAMES: dict[str, str] = {
    # Process faults
    "agitator_power_loss":  "Emergency Agitator Restart",
    "sparger_blockage":     "Sparger Flush & Purge Cycle",
    "gas_supply_failure":   "Emergency O2 Line Restoration",
    "foam_overflow":        "Antifoam Bolus + Gas Restart",
    "viscosity_surge":      "Dilution & RPM Step-up",
    "antifoam_injection":   "Aeration Rate Compensation",
    "impeller_shear":       "RPM Reduction & Viability Check",
    "coolant_leak":         "Coolant Line Isolation",
    "exhaust_filter_clog":  "Filter Swap & Backpressure Relief",
    "seed_hypoxia":         "O2 Boost & Extended Lag Protocol",
    # Sensor / actuator faults
    "do_probe_bias":        "DO Probe In-line Recalibration",
    "pid_fault":            "PID Controller Reset",
    "antifoam_overdose":    "Aeration Rate Step-up",
    # CPP excursions
    "ph_high":              "Acid Corrective Addition",
    "ph_low":               "Base Addition & Medium Correction",
    "ph_oscillation":       "Pump PID Retuning",
    "do_low_sustained":     "Aeration Boost & Sparger Inspection",
    "do_high":              "Aeration Reduction & Setpoint Reset",
    "do_hunting":           "DO Controller Retuning",
    "temp_high":            "Emergency Cooling Activation",
    "temp_low":             "Heating Jacket Ramp-up",
    "temp_ramp":            "Thermal Gradient Correction",
}


class FaultEngine:
    """Applies fault effects to the simulator during run_live."""

    FAULT_LINE_COLORS = {"process": "#d62728", "sensor": "#ff7f0e", "excursion": "#7B2FBE"}

    def __init__(self, faults: list[dict]) -> None:
        import copy
        self.faults    = copy.deepcopy(faults)
        self.event_log:    list[tuple] = []   # (time_h, id, name, category)
        self.recovery_log: list[tuple] = []   # (time_h, id, name)

    @property
    def triggered(self) -> list[dict]:
        return [f for f in self.faults if f.get("_triggered")]

    def step(self, sim: object, dt: float) -> None:
        t = sim.state.time
        for f in self.faults:
            if t < f["trigger_time_h"]:
                continue
            if not f.get("_triggered"):
                f["_triggered"] = True
                self.event_log.append((t, f["id"], f["name"], f["category"]))
                rec_name = RECOVERY_NAMES.get(f["id"], "Standard Recovery Procedure")
                print(
                    f"\n  \u26a0  FAULT   t={t:.2f} h"
                    f"  [{f['category'].upper()}]  {f['name']}"
                    f"\n     Desc      : {f['desc']}"
                    f"\n     Recovery  : {rec_name}"
                    "\n     Simulation continues with fault active."
                    "\n     Recovery prompt appears after the next dashboard update.\n"
                )
                self._on_trigger(sim, f)
                f["_needs_recovery_prompt"] = True
            if not f.get("_recovered"):
                self._each_step(sim, f, dt)

    def apply_sensor(self, reading: dict) -> dict:
        for f in self.faults:
            if not f.get("_triggered") or f.get("_recovered"):
                continue
            if f["id"] == "do_probe_bias":
                reading["dissolved_oxygen_pct"] = round(
                    max(0.0, reading["dissolved_oxygen_pct"] * 0.80), 4)
        return reading

    def recover(self, sim: object, f: dict) -> None:
        """Restore all dynamics/kinetics to pre-fault values and mark fault resolved."""
        if f.get("_recovered"):
            return
        o = f.get("_orig", {})
        dyn, kin = sim.dynamics, sim.kinetics
        if "sp_do"     in o: dyn.sp_do    = o["sp_do"]
        if "tau_do"    in o: dyn.tau_do   = o["tau_do"]
        if "sp_pH"     in o: dyn.sp_pH    = o["sp_pH"]
        if "tau_pH"    in o: dyn.tau_pH   = o["tau_pH"]
        if "sp_temp"   in o: dyn.sp_temp  = o["sp_temp"]
        if "tau_temp"  in o: dyn.tau_temp = o["tau_temp"]
        if "sp_press"  in o: dyn.sp_press = o["sp_press"]
        if "mu_max"    in o: kin.mu_max   = o["mu_max"]
        if "Kd_base"   in o: kin.Kd_base  = o["Kd_base"]
        if "feed_rate" in o: sim.feed_rate = o["feed_rate"]
        if "q_lac"     in o: sim.q_lac    = o["q_lac"]
        if "kd_lysis"  in o: sim.kd_lysis = o["kd_lysis"]
        f["_recovered"] = True
        f["_recovered_at_h"] = sim.state.time
        t = sim.state.time
        self.recovery_log.append((t, f["id"], f["name"]))
        print(
            f"\n  \u2713 RECOVERED  t={t:.2f} h  {f['name']}"
            "\n    All CPPs restored to pre-fault setpoints."
            "\n    Batch continues normally.\n"
        )

    def _on_trigger(self, sim: object, f: dict) -> None:
        fid = f["id"]
        dyn = sim.dynamics
        kin = sim.kinetics
        # Snapshot every modifiable parameter BEFORE fault is applied (for recovery)
        f["_orig"] = {
            "sp_do":    dyn.sp_do,    "tau_do":   dyn.tau_do,
            "sp_pH":    dyn.sp_pH,    "tau_pH":   dyn.tau_pH,
            "sp_temp":  dyn.sp_temp,  "tau_temp": dyn.tau_temp,
            "sp_press": dyn.sp_press,
            "mu_max":   kin.mu_max,   "Kd_base":  kin.Kd_base,
            "feed_rate": sim.feed_rate, "q_lac":  sim.q_lac,
            "kd_lysis": sim.kd_lysis,
        }

        if fid == "agitator_power_loss":
            dyn.sp_do  = 8.0
            dyn.tau_do = 0.5

        elif fid == "sparger_blockage":
            dyn.sp_do  *= 0.20
            dyn.tau_do *= 5.0
            sim.q_lac  *= 3.0

        elif fid == "gas_supply_failure":
            dyn.sp_do  = 0.0
            dyn.tau_do = 0.15
            sim.q_lac  *= 8.0

        elif fid == "foam_overflow":
            f["_base_sp_do"] = dyn.sp_do
            f["_phase"]      = 0.0

        elif fid == "viscosity_surge":
            dyn.sp_do  *= 0.40
            dyn.tau_do *= 2.5

        elif fid == "antifoam_injection":
            dyn.sp_do  *= 0.60
            dyn.tau_do *= 1.67

        elif fid == "impeller_shear":
            sim.kd_lysis    *= 5.0
            kin.Kd_base     *= 2.5
            f["_orig_sp_do"] = dyn.sp_do
            f["_phase"]      = 0.0

        elif fid == "coolant_leak":
            dyn.sp_do   = 98.0
            dyn.tau_do  = 0.10
            kin.Kd_base *= 2.5

        elif fid == "exhaust_filter_clog":
            dyn.sp_do   *= 0.70
            dyn.tau_do  *= 1.50
            dyn.sp_press = min(2.0, dyn.sp_press * 1.50)

        elif fid == "seed_hypoxia":
            sim.state.viable_cell_density *= 0.50
            sim.state.dissolved_oxygen     = 85.0

        elif fid == "pid_fault":
            f["_phase"] = 0.0

        elif fid == "antifoam_overdose":
            dyn.sp_do  *= 0.70
            dyn.tau_do *= 1.43

        # ── CPP excursions ───────────────────────────────────────────────────
        elif fid == "ph_high":
            # Ammonia toxicity: pH forced >8.0; viability loss
            dyn.sp_pH  = 8.2
            dyn.tau_pH = 0.10
            kin.Kd_base *= 1.8

        elif fid == "ph_low":
            # Enzyme denaturation: pH forced <5.5; growth stops
            dyn.sp_pH  = 5.2
            dyn.tau_pH = 0.10
            kin.mu_max *= 0.05
            sim.q_lac  *= 4.0

        elif fid == "ph_oscillation":
            # Pump hunting: oscillate sp_pH +/-0.5 at 30-min cycle
            f["_base_sp_pH"] = dyn.sp_pH
            f["_phase"]      = 0.0

        elif fid == "do_low_sustained":
            # Hypoxic stress: DO forced below 10 % for >2 h; lactate shift
            dyn.sp_do  = 5.0
            dyn.tau_do = 0.50
            sim.q_lac  *= 3.0

        elif fid == "do_high":
            # Oxidative stress: DO forced above 60 %; apoptosis cascade
            dyn.sp_do   = 80.0
            dyn.tau_do  = 0.20
            kin.Kd_base *= 3.0

        elif fid == "do_hunting":
            # PID overshoot: oscillate sp_do +/-25 % at 20-min cycle
            f["_base_sp_do"] = dyn.sp_do
            f["_phase"]      = 0.0

        elif fid == "temp_high":
            # Heat shock: temp forced above 42 degC; 30 % yield loss
            dyn.sp_temp  = 43.5
            dyn.tau_temp = 0.20
            kin.Kd_base  *= 2.0

        elif fid == "temp_low":
            # Membrane rigidity: temp forced below 28 degC; nutrient uptake fails
            dyn.sp_temp  = 26.0
            dyn.tau_temp = 0.30
            kin.mu_max   *= 0.05

        elif fid == "temp_ramp":
            # Thermal gradient: ramp sp_temp +2 degC/h; moderate stress
            f["_ramp_sp_temp"] = dyn.sp_temp
            kin.Kd_base        *= 1.3

    def _each_step(self, sim: object, f: dict, dt: float) -> None:
        fid = f["id"]
        dyn = sim.dynamics
        s   = sim.state

        if fid == "foam_overflow":
            f["_phase"] = f.get("_phase", 0.0) + 2 * math.pi * dt / 0.25
            dyn.sp_do = max(0.0, f["_base_sp_do"] * (1.0 + 0.60 * math.sin(f["_phase"])))

        elif fid == "impeller_shear":
            f["_phase"] = f.get("_phase", 0.0) + 2 * math.pi * dt / 0.50
            dyn.sp_do = max(0.0, f["_orig_sp_do"] + 12.0 * math.sin(f["_phase"]))

        elif fid == "pid_fault":
            f["_phase"] = f.get("_phase", 0.0) + 2 * math.pi * dt
            s.temperature += 5.0 * math.sin(f["_phase"]) * dt

        elif fid == "ph_oscillation":
            # +/-0.5 pH pump hunting at 30-min (0.5 h) cycle
            f["_phase"] = f.get("_phase", 0.0) + 2 * math.pi * dt / 0.50
            dyn.sp_pH = f["_base_sp_pH"] + 0.5 * math.sin(f["_phase"])

        elif fid == "do_hunting":
            # +/-25 % DO boom-bust at 20-min (0.33 h) cycle
            f["_phase"] = f.get("_phase", 0.0) + 2 * math.pi * dt / 0.33
            dyn.sp_do = max(0.0, f["_base_sp_do"] + 25.0 * math.sin(f["_phase"]))

        elif fid == "temp_ramp":
            # Ramp sp_temp at +2 degC/h; cap at hard-kill temperature
            f["_ramp_sp_temp"] = min(43.0, f.get("_ramp_sp_temp", dyn.sp_temp) + 2.0 * dt)
            dyn.sp_temp = f["_ramp_sp_temp"]


# ── Startup configuration prompt ──────────────────────────────────────────────

def _prompt_run_config(cfg: dict) -> tuple:
    """Ask the user for duration, step frequency, and optional fault injection."""
    sim_cfg = cfg["simulation"]

    print("\n" + "\u2550" * 60)
    print("  BIOREACTOR SIMULATION \u2014 RUN SETUP")
    print("\u2550" * 60)

    def _ask(prompt: str, default: float) -> float:
        raw = input(f"  {prompt} [{default}]: ").strip()
        try:
            return float(raw) if raw else default
        except ValueError:
            return default

    duration = _ask("Batch duration   (h) ", sim_cfg["duration_hours"])
    dt_min   = _ask("Time step      (min) ", sim_cfg["dt_minutes"])

    W = 62
    print(f"\n  {chr(9472)*W}")
    print(f"  {'#':<3} {'Category':<11} {'Fault':<32} {'Default'}")
    print(f"  {chr(9472)*W}")
    for i, fc in enumerate(FAULT_CATALOGUE, 1):
        cat = f"[{fc['category'].upper()[:7]}]"
        print(f"  {i:<3} {cat:<11} {fc['name']:<32} t={fc['trigger_default_h']:.0f} h")
    print(f"  {chr(9472)*W}")
    print("  Select fault numbers (comma-separated) or press Enter to skip:")
    raw = input("  Faults > ").strip()

    selected: list[dict] = []
    if raw:
        for tok in raw.split(","):
            tok = tok.strip()
            if not tok.isdigit():
                continue
            idx = int(tok) - 1
            if not (0 <= idx < len(FAULT_CATALOGUE)):
                print(f"  (skipping invalid selection: {tok})")
                continue
            template = FAULT_CATALOGUE[idx]
            t_def = template["trigger_default_h"]
            raw_t = input(
                f"  Trigger time for \u2018{template['name']}\u2019 (h) [{t_def}]: "
            ).strip()
            try:
                t_trigger = float(raw_t) if raw_t else t_def
            except ValueError:
                t_trigger = t_def
            t_trigger = max(0.0, min(t_trigger, duration))
            selected.append({**template, "trigger_time_h": t_trigger})

    print("\u2550" * 60)
    return duration, dt_min, selected

# ── Bioreactor simulator ──────────────────────────────────────────────────────

class BioreactorSimulator:
    def __init__(self, config_path: str = "config.json") -> None:
        self.cfg = load_config(config_path)
        sim = self.cfg["simulation"]
        bio = self.cfg["bioreactor"]

        self.duration_hours = sim["duration_hours"]
        self.dt = sim["dt_minutes"] / 60.0          # convert minutes → hours
        self.record_every = sim["record_every_n_steps"]
        self.output_csv = sim["output_csv"]
        self.summary_interval = sim["print_summary_interval_hours"]

        self.V         = bio["volume_L"]
        self.feed_rate = bio["feed_rate_L_per_hour"]
        self.S_feed    = bio["feed_glucose_g_L"]
        self.Y_xs      = bio["yield_cells_per_g_glucose"]
        self.q_lac     = bio["lactate_production_g_per_cell_per_hour"]
        self.kd_lysis  = bio["dead_cell_lysis_rate_per_hour"]

        rng = np.random.default_rng(self.cfg["simulation"]["seed"])
        self.state    = BioreactorState.from_config(self.cfg)
        self.kinetics = KineticModel(self.cfg)
        self.dynamics = ProcessDynamics(self.cfg, rng)
        self.alarms   = AlarmChecker(self.cfg)

        self.history: list[dict] = []
        self.alarm_log: list[Alarm] = []
        self.fault_engine: Optional[FaultEngine] = None

    def _record(self) -> None:
        s = self.state
        reading = {
            "time_h":                 round(s.time, 6),
            "pH":                     round(s.pH, 4),
            "temperature_C":          round(s.temperature, 4),
            "pressure_bar":           round(s.pressure, 4),
            "dissolved_oxygen_pct":   round(s.dissolved_oxygen, 4),
            "viable_cell_density":    round(s.viable_cell_density, 0),
            "dead_cell_density":      round(s.dead_cell_density, 0),
            "viability_pct":          round(s.viability, 2),
            "growth_rate_h":          round(s.growth_rate, 6),
            "death_rate_h":           round(s.death_rate, 6),
            "substrate_g_L":          round(s.substrate, 4),
            "lactate_g_L":            round(s.lactate, 4),
        }
        if self.fault_engine:
            reading = self.fault_engine.apply_sensor(reading)
        self.history.append(reading)

    def _step(self) -> None:
        s = self.state
        dt = self.dt

        mu = self.kinetics.growth_rate(s)
        kd = self.kinetics.death_rate(s)
        s.growth_rate = mu
        s.death_rate  = kd

        dXv = (mu - kd) * s.viable_cell_density * dt
        dXd = kd * s.viable_cell_density * dt - self.kd_lysis * s.dead_cell_density * dt
        s.viable_cell_density = max(0.0, s.viable_cell_density + dXv)
        s.dead_cell_density   = max(0.0, s.dead_cell_density + dXd)

        # VCD is stored as cells/mL; Y_xs and q_lac use cells/L, so multiply by 1000.
        Xv_L          = s.viable_cell_density * 1000.0
        consumption   = (mu / self.Y_xs) * Xv_L * dt
        feed_contrib  = self.feed_rate * self.S_feed / self.V * dt
        s.substrate   = max(0.0, s.substrate - consumption + feed_contrib)
        s.lactate    += self.q_lac * Xv_L * dt

        total = s.viable_cell_density + s.dead_cell_density
        s.viability = 100.0 * s.viable_cell_density / total if total > 0 else 0.0

        self.dynamics.step(s, dt)
        if self.fault_engine:
            self.fault_engine.step(self, dt)
        s.time += dt

        for alarm in self.alarms.check(s):
            self.alarm_log.append(alarm)

    def run(self) -> list[dict]:
        self.history.clear()
        self.alarm_log.clear()
        self._record()

        total_steps = int(self.duration_hours / self.dt)
        for step in range(1, total_steps + 1):
            self._step()
            if step % self.record_every == 0:
                self._record()

        return self.history

    def export_csv(self) -> str:
        path = self.output_csv
        with open(path, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(self.history[0].keys()))
            w.writeheader()
            w.writerows(self.history)
        return os.path.abspath(path)

    def print_summary(self) -> None:
        hdr = (
            f"\n{'Time(h)':>8} | {'pH':>6} | {'Temp(°C)':>8} | {'Press(bar)':>10} | "
            f"{'DO(%)':>7} | {'VCD(cells/mL)':>15} | {'Viab(%)':>8} | {'Death(h⁻¹)':>11}"
        )
        print(hdr)
        print("-" * len(hdr))
        interval = self.summary_interval
        for row in self.history:
            if row["time_h"] % interval < self.dt + 1e-9:
                print(
                    f"{row['time_h']:>8.2f} | "
                    f"{row['pH']:>6.3f} | "
                    f"{row['temperature_C']:>8.3f} | "
                    f"{row['pressure_bar']:>10.4f} | "
                    f"{row['dissolved_oxygen_pct']:>7.2f} | "
                    f"{row['viable_cell_density']:>15,.0f} | "
                    f"{row['viability_pct']:>8.1f} | "
                    f"{row['death_rate_h']:>11.6f}"
                )

    @staticmethod
    def _cpp_color(val: float, lim: dict) -> str:
        if val < lim["min"] or val > lim["max"]:
            return "#FDDCDC"
        if val < lim["alert_low"] or val > lim["alert_high"]:
            return "#FFF3CD"
        return "#D4EDDA"


    def _build_dashboard(self):
        """Create figure with 2D vessel schematic + six trend panels; return (fig, ln, free_axes)."""
        lim = self.cfg["cpp_limits"]
        sp  = self.cfg["setpoints"]
        T   = self.duration_hours
        ALERT_COLOR = "#FFF3CD"
        LIMIT_COLOR = "#FDDCDC"

        fig = plt.figure(figsize=(22, 14))
        fig.suptitle("Bioreactor Batch Simulation — Live Dashboard",
                     fontsize=14, fontweight="bold", y=0.99)
        gs = GridSpec(3, 3, figure=fig,
                      width_ratios=[1.35, 1, 1], hspace=0.45, wspace=0.38,
                      bottom=0.10, top=0.97)

        # ── 2D vessel schematic panel ──────────────────────────────────
        img_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "bioreactormodel.png")
        ax_img = fig.add_subplot(gs[:, 0])
        img = plt.imread(img_path)
        h_px, w_px = img.shape[:2]
        ax_img.imshow(img)          # aspect='equal' by default: 1 px x == 1 px y
        ax_img.set_axis_off()
        ax_img.set_title("Bioreactor Vessel  |  t = 0.0 h", fontsize=10, pad=4)
        # Fill the panel height while keeping the pixel aspect ratio locked.
        # Compute the panel's physical h/w and expand the y data-range to match,
        # centering the image with neutral padding rather than stretching pixels.
        pos = ax_img.get_position()
        panel_ar = (pos.height * fig.get_figheight()) / (pos.width * fig.get_figwidth())
        y_range  = w_px * panel_ar          # y data-units needed to fill panel height
        y_pad    = max(0.0, y_range - h_px) / 2
        ax_img.set_xlim(0, w_px)
        ax_img.set_ylim(h_px + y_pad, -y_pad)   # inverted y, symmetric padding

        bkw = dict(boxstyle="round,pad=0.40", alpha=0.92)
        apo = dict(arrowstyle="-|>", lw=0.9, connectionstyle="arc3,rad=0.15")

        def _ann(xt, yt, xs, ys, header, body, color, acol="#555"):
            return ax_img.annotate(
                f"{header}\n{body}",
                xy=(w_px * xs, h_px * ys),
                xytext=(w_px * xt, h_px * yt),
                arrowprops={**apo, "color": acol},
                bbox={**bkw, "facecolor": color},
                fontsize=9, fontfamily="monospace",
                ha="center", va="center", zorder=5,
            )

        s = self.state
        # pH – sensor cluster probe (right whitespace, lower)
        txt_ph = _ann(0.87, 0.52, 0.55, 0.68,
                      "  pH  ", f" {s.pH:.2f} ",
                      self._cpp_color(s.pH, lim["pH"]), "#2ca02c")
        # DO – sensor cluster probe (right whitespace, upper)
        txt_do = _ann(0.87, 0.39, 0.52, 0.62,
                      "  DO %  ", f" {s.dissolved_oxygen:.1f} ",
                      self._cpp_color(s.dissolved_oxygen, lim["dissolved_oxygen_pct"]), "#9467bd")
        # Temperature – sensor cluster probe (right whitespace, lowest)
        txt_tmp = _ann(0.87, 0.66, 0.57, 0.74,
                       " Temp °C ", f" {s.temperature:.2f} ",
                       self._cpp_color(s.temperature, lim["temperature_C"]), "#ff7f0e")
        # Pressure – headspace / gas outlet (top-right whitespace)
        txt_prs = _ann(0.87, 0.10, 0.64, 0.18,
                       " Press bar ", f" {s.pressure:.3f} ",
                       self._cpp_color(s.pressure, lim["pressure_bar"]), "#8c564b")
        # VCD / Viability – bulk liquid (left label area, arrow to vessel centre)
        via_col = ("#D4EDDA" if s.viability >= 80
                   else "#FFF3CD" if s.viability >= 60 else "#FDDCDC")
        txt_vcd = _ann(0.10, 0.42, 0.42, 0.48,
                       " VCD ×10⁶/mL ",
                       f" {s.viable_cell_density/1e6:.3f} \n Viab {s.viability:.0f}% ",
                       via_col, "#1f77b4")

        # ── fault status box on vessel image ──────────────────────────────────
        fault_box = ax_img.text(
            w_px * 0.50, h_px * 0.99,
            "No active faults",
            fontsize=7.5, ha="center", va="bottom",
            bbox=dict(boxstyle="round,pad=0.30",
                      facecolor="#E8F4FD", alpha=0.90,
                      edgecolor="#90C4E4", linewidth=0.8),
            zorder=6,
        )

        # ── helper: alert/limit bands on a 2D trend panel ─────────────────
        def _cpp_bands(ax, cfg_key, y_lo, y_hi):
            c = lim[cfg_key]
            ax.set_xlim(0, T)
            ax.set_ylim(y_lo, y_hi)
            ax.axhspan(y_lo,            c["min"],        color=LIMIT_COLOR, zorder=0)
            ax.axhspan(c["min"],        c["alert_low"],  color=ALERT_COLOR, zorder=0)
            ax.axhspan(c["alert_high"], c["max"],        color=ALERT_COLOR, zorder=0)
            ax.axhspan(c["max"],        y_hi,            color=LIMIT_COLOR, zorder=0)
            for val, ls, lw, col in [
                (c["min"],        "-",  0.8, "#d62728"),
                (c["max"],        "-",  0.8, "#d62728"),
                (c["alert_low"],  "--", 0.7, "#ff7f0e"),
                (c["alert_high"], "--", 0.7, "#ff7f0e"),
            ]:
                ax.axhline(val, linestyle=ls, linewidth=lw, color=col, zorder=1)

        limit_patch = mpatches.Patch(color=LIMIT_COLOR, label="Limit band")
        alert_patch = mpatches.Patch(color=ALERT_COLOR, label="Alert band")

        # ── Panel 1: Cell culture ──────────────────────────────────────────
        ax1 = fig.add_subplot(gs[0, 1])
        ax1.set_xlim(0, T)
        ax1.set_xlabel("Time (h)")
        ax1.set_ylabel("Cell Density (×10⁶ cells/mL)")
        ax1.set_title("Cell Culture")
        ax1.grid(True, linewidth=0.4, alpha=0.5, zorder=0)
        ln_vcd, = ax1.plot([], [], color="#1f77b4", linewidth=1.5, label="Viable (×10⁶/mL)")
        ln_dcd, = ax1.plot([], [], color="#d62728", linewidth=1.2, linestyle=":", label="Dead (×10⁶/mL)")
        ax1v = ax1.twinx()
        ax1v.set_ylim(0, 105)
        ax1v.set_ylabel("Viability (%)", color="#2ca02c")
        ax1v.tick_params(axis="y", labelcolor="#2ca02c")
        ln_via, = ax1v.plot([], [], color="#2ca02c", linewidth=1.0, linestyle="-.", alpha=0.8, label="Viability (%)")
        h1a, l1a = ax1.get_legend_handles_labels()
        h1b, l1b = ax1v.get_legend_handles_labels()
        ax1.legend(h1a + h1b, l1a + l1b, fontsize=7, loc="upper left")

        # ── Panel 2: pH ────────────────────────────────────────────────────
        ax2 = fig.add_subplot(gs[0, 2])
        _cpp_bands(ax2, "pH", 6.3, 8.0)
        sp2, = ax2.plot([0, T], [sp["pH"]] * 2, color="#444", linestyle="--", linewidth=0.9, label="Setpoint")
        ln_ph, = ax2.plot([], [], color="#1f77b4", linewidth=1.5, label="pH", zorder=2)
        ax2.set_xlabel("Time (h)")
        ax2.set_ylabel("pH")
        ax2.set_title("pH")
        ax2.grid(True, linewidth=0.4, alpha=0.5, zorder=0)
        ax2.legend(handles=[ln_ph, sp2, limit_patch, alert_patch], fontsize=7)

        # ── Panel 3: Temperature ───────────────────────────────────────────
        ax3 = fig.add_subplot(gs[1, 1])
        _cpp_bands(ax3, "temperature_C", 33.0, 41.5)
        sp3, = ax3.plot([0, T], [sp["temperature_C"]] * 2, color="#444", linestyle="--", linewidth=0.9, label="Setpoint")
        ln_tmp, = ax3.plot([], [], color="#ff7f0e", linewidth=1.5, label="Temperature", zorder=2)
        ax3.set_xlabel("Time (h)")
        ax3.set_ylabel("Temperature (°C)")
        ax3.set_title("Temperature")
        ax3.grid(True, linewidth=0.4, alpha=0.5, zorder=0)
        ax3.legend(handles=[ln_tmp, sp3, limit_patch, alert_patch], fontsize=7)

        # ── Panel 4: Dissolved Oxygen ──────────────────────────────────────
        ax4 = fig.add_subplot(gs[1, 2])
        _cpp_bands(ax4, "dissolved_oxygen_pct", 0.0, 105.0)
        sp4, = ax4.plot([0, T], [sp["dissolved_oxygen_pct"]] * 2, color="#444", linestyle="--", linewidth=0.9, label="Setpoint")
        ln_do, = ax4.plot([], [], color="#9467bd", linewidth=1.5, label="DO", zorder=2)
        ax4.set_xlabel("Time (h)")
        ax4.set_ylabel("Dissolved Oxygen (% air sat.)")
        ax4.set_title("Dissolved Oxygen")
        ax4.grid(True, linewidth=0.4, alpha=0.5, zorder=0)
        ax4.legend(handles=[ln_do, sp4, limit_patch, alert_patch], fontsize=7)

        # ── Panel 5: Metabolites ───────────────────────────────────────────
        ax5 = fig.add_subplot(gs[2, 1])
        ax5.set_xlim(0, T)
        ax5.set_xlabel("Time (h)")
        ax5.set_ylabel("Glucose (g/L)", color="#17becf")
        ax5.tick_params(axis="y", labelcolor="#17becf")
        ax5.set_title("Metabolites")
        ax5.grid(True, linewidth=0.4, alpha=0.5, zorder=0)
        ln_sub, = ax5.plot([], [], color="#17becf", linewidth=1.5, label="Glucose (g/L)")
        ax5l = ax5.twinx()
        ax5l.set_ylabel("Lactate (g/L)", color="#e377c2")
        ax5l.tick_params(axis="y", labelcolor="#e377c2")
        ln_lac, = ax5l.plot([], [], color="#e377c2", linewidth=1.5, linestyle="--", label="Lactate (g/L)")
        h5a, l5a = ax5.get_legend_handles_labels()
        h5b, l5b = ax5l.get_legend_handles_labels()
        ax5.legend(h5a + h5b, l5a + l5b, fontsize=7)

        # ── Panel 6: Kinetic rates ─────────────────────────────────────────
        ax6 = fig.add_subplot(gs[2, 2])
        ax6.set_xlim(0, T)
        ax6.set_xlabel("Time (h)")
        ax6.set_ylabel("Rate (h⁻¹)")
        ax6.set_title("Growth & Death Rates")
        ax6.grid(True, linewidth=0.4, alpha=0.5, zorder=0)
        ln_mu, = ax6.plot([], [], color="#2ca02c", linewidth=1.5, label="Growth rate μ (h⁻¹)")
        ln_kd, = ax6.plot([], [], color="#d62728", linewidth=1.2, linestyle="--", label="Death rate kd (h⁻¹)")
        ax6.legend(fontsize=7)

        # ── Recovery action bar ───────────────────────────────────────────
        from matplotlib.widgets import Button as _Btn
        ax_rec_info = fig.add_axes([0.01, 0.025, 0.55, 0.055])
        ax_rec_info.set_facecolor('#F8F9FA')
        ax_rec_info.tick_params(left=False, bottom=False,
                                labelleft=False, labelbottom=False)
        for _sp in ax_rec_info.spines.values():
            _sp.set_edgecolor('#ccc'); _sp.set_linewidth(0.5)
        rec_info_txt = ax_rec_info.text(
            0.01, 0.5, '  No active recovery prompts',
            va='center', ha='left', fontsize=9, fontfamily='monospace',
            transform=ax_rec_info.transAxes,
        )
        ax_btn_yes = fig.add_axes([0.57, 0.025, 0.19, 0.055])
        btn_yes = _Btn(ax_btn_yes, '\u2713  Apply Recovery',
                       color='#D4EDDA', hovercolor='#A8D5BA')
        btn_yes.label.set_fontsize(9)
        ax_btn_no  = fig.add_axes([0.77, 0.025, 0.19, 0.055])
        btn_no  = _Btn(ax_btn_no,  '\u2717  Decline',
                       color='#FDDCDC', hovercolor='#F5ABAB')
        btn_no.label.set_fontsize(9)
        ax_btn_yes.set_visible(False)
        ax_btn_no.set_visible(False)

        fig.canvas.draw()
        plt.pause(0.001)

        ln = dict(
            vcd=ln_vcd, dcd=ln_dcd, via=ln_via, ph=ln_ph,
            tmp=ln_tmp, do=ln_do, sub=ln_sub, lac=ln_lac, mu=ln_mu, kd=ln_kd,
            txt_ph=txt_ph, txt_do=txt_do, txt_tmp=txt_tmp,
            txt_prs=txt_prs, txt_vcd=txt_vcd,
            ax_img=ax_img,
            fault_box=fault_box,
            trend_axes=[ax1, ax2, ax3, ax4, ax5, ax6],
            fault_drawn=set(),
            rec_info_txt=rec_info_txt,
            rec_ax_info=ax_rec_info,
            rec_ax_yes=ax_btn_yes,
            rec_ax_no=ax_btn_no,
            rec_btn_yes=btn_yes,
            rec_btn_no=btn_no,
            rec_cids=[],
        )
        free_axes = [ax1, ax1v, ax5, ax5l, ax6]
        return fig, ln, free_axes

    def _refresh_dashboard(self, ln: dict, free_axes: list) -> None:
        h = self.history
        t = [r["time_h"] for r in h]
        ln["vcd"].set_data(t, [r["viable_cell_density"] / 1e6 for r in h])
        ln["dcd"].set_data(t, [r["dead_cell_density"]   / 1e6 for r in h])
        ln["via"].set_data(t, [r["viability_pct"]             for r in h])
        ln["ph" ].set_data(t, [r["pH"]                        for r in h])
        ln["tmp"].set_data(t, [r["temperature_C"]             for r in h])
        ln["do" ].set_data(t, [r["dissolved_oxygen_pct"]      for r in h])
        ln["sub"].set_data(t, [r["substrate_g_L"]             for r in h])
        ln["lac"].set_data(t, [r["lactate_g_L"]               for r in h])
        ln["mu" ].set_data(t, [r["growth_rate_h"]             for r in h])
        ln["kd" ].set_data(t, [r["death_rate_h"]              for r in h])
        for ax in free_axes:
            ax.relim()
            ax.autoscale_view()

        # ── refresh 3D CPP labels ──────────────────────────────────────────
        last = h[-1]
        lim  = self.cfg["cpp_limits"]

        def _upd(txt, header, val, val_str, lim_key):
            txt.set_text(f"{header}\n{val_str}")
            txt.get_bbox_patch().set_facecolor(self._cpp_color(val, lim[lim_key]))

        _upd(ln["txt_ph"],  "  pH  ",
             last["pH"], f" {last['pH']:.2f} ", "pH")
        _upd(ln["txt_do"],  "  DO %  ",
             last["dissolved_oxygen_pct"],
             f" {last['dissolved_oxygen_pct']:.1f} ", "dissolved_oxygen_pct")
        _upd(ln["txt_tmp"], " Temp °C ",
             last["temperature_C"], f" {last['temperature_C']:.2f} ", "temperature_C")
        _upd(ln["txt_prs"], " Press bar ",
             last["pressure_bar"], f" {last['pressure_bar']:.3f} ", "pressure_bar")

        vcd_M = last["viable_cell_density"] / 1e6
        via   = last["viability_pct"]
        ln["txt_vcd"].set_text(
            f" VCD ×10⁶/mL \n {vcd_M:.3f} \n Viab {via:.0f}% ")
        via_col = "#D4EDDA" if via >= 80 else "#FFF3CD" if via >= 60 else "#FDDCDC"
        ln["txt_vcd"].get_bbox_patch().set_facecolor(via_col)

        ln["ax_img"].set_title(
            f"Bioreactor Vessel  |  t = {last['time_h']:.1f} h", fontsize=10, pad=4)

        # ── fault event lines, recovery lines, status box ─────────────────────
        if self.fault_engine:
            fe  = self.fault_engine
            col_map = FaultEngine.FAULT_LINE_COLORS
            # Fault trigger lines (dashed, category colour)
            for (t_ev, fid, fname, fcat) in fe.event_log:
                if fid not in ln["fault_drawn"]:
                    ln["fault_drawn"].add(fid)
                    col = col_map.get(fcat, "#555")
                    for tax in ln["trend_axes"]:
                        tax.axvline(t_ev, color=col, linestyle="--",
                                    linewidth=1.1, alpha=0.75, zorder=3)
                        tax.text(t_ev, 1.0, f" {fname[:14]}",
                                 color=col, fontsize=5.5, rotation=90,
                                 va="top", ha="left",
                                 transform=tax.get_xaxis_transform(), zorder=4)
            # Recovery lines (dash-dot, green)
            for (t_rec, fid, fname) in fe.recovery_log:
                key = f"rec_{fid}"
                if key not in ln["fault_drawn"]:
                    ln["fault_drawn"].add(key)
                    rec_label = RECOVERY_NAMES.get(fid, "Recovery")
                    for tax in ln["trend_axes"]:
                        tax.axvline(t_rec, color="#2ca02c", linestyle="-.",
                                    linewidth=1.1, alpha=0.85, zorder=3)
                        tax.text(t_rec, 1.0, f" \u2713{rec_label[:14]}",
                                 color="#2ca02c", fontsize=5.5, rotation=90,
                                 va="top", ha="left",
                                 transform=tax.get_xaxis_transform(), zorder=4)
            # Status box
            still_active = [f for f in fe.triggered if not f.get("_recovered")]
            recovered    = [f for f in fe.faults   if f.get("_recovered")]
            box_lines = []
            for f in still_active:
                cat = f["category"].upper()[:4]
                if f.get("_awaiting_input"):
                    deadline = f.get("_prompt_time_h", 0) + self.duration_hours * 0.40
                    rec = RECOVERY_NAMES.get(f["id"], "Recovery")
                    box_lines.append(
                        f"\u26a0 [{cat}] {f['name']}"
                        f"\n  \u23f3 {rec[:22]}?"
                        f"\n  auto-N at t={deadline:.1f} h"
                    )
                else:
                    box_lines.append(f"\u26a0 [{cat}] {f['name']}")
            for f in recovered:
                box_lines.append(f"\u2713 RECOVERED: {f['name']}")
            if box_lines:
                ln["fault_box"].set_text("\n".join(box_lines))
                if still_active:
                    ln["fault_box"].get_bbox_patch().set_facecolor("#FFF3CD")
                    ln["fault_box"].get_bbox_patch().set_edgecolor("#ff7f0e")
                else:
                    ln["fault_box"].get_bbox_patch().set_facecolor("#D4EDDA")
                    ln["fault_box"].get_bbox_patch().set_edgecolor("#28a745")

    def _hide_recovery_bar(self, ln: dict) -> None:
        for btn, cid in ln.get('rec_cids', []):
            try:
                btn.disconnect(cid)
            except Exception:
                pass
        ln['rec_cids'] = []
        ln['rec_ax_yes'].set_visible(False)
        ln['rec_ax_no'].set_visible(False)
        ln['rec_info_txt'].set_text('  No active recovery prompts')
        ln['rec_ax_info'].set_facecolor('#F8F9FA')
        for sp in ln['rec_ax_info'].spines.values():
            sp.set_edgecolor('#ccc'); sp.set_linewidth(0.5)

    def _show_recovery_bar(self, ln: dict, f: dict, t_now: float) -> None:
        self._hide_recovery_bar(ln)
        fe       = self.fault_engine
        fname    = f['name']
        fid      = f['id']
        rec_name = RECOVERY_NAMES.get(fid, 'Standard Recovery')
        deadline = t_now + self.duration_hours * 0.40
        ln['rec_info_txt'].set_text(
            f'  \u26a0  {fname}  \u203a  {rec_name}'
            f'  \u2502  auto-N at t={deadline:.1f} h'
        )
        ln['rec_ax_info'].set_facecolor('#FFF3CD')
        for sp in ln['rec_ax_info'].spines.values():
            sp.set_edgecolor('#ff7f0e'); sp.set_linewidth(1.0)
        ln['rec_ax_yes'].set_visible(True)
        ln['rec_ax_no'].set_visible(True)

        def _on_yes(event, fault=f):
            fault['_awaiting_input'] = False
            fe.recover(self, fault)
            self._hide_recovery_bar(ln)

        def _on_no(event, fault=f):
            fault['_awaiting_input'] = False
            fn = fault['name']
            print(f'\n  Recovery declined \u2014 {fn!r} remains active.\n')
            self._hide_recovery_bar(ln)

        cid_yes = ln['rec_btn_yes'].on_clicked(_on_yes)
        cid_no  = ln['rec_btn_no'].on_clicked(_on_no)
        ln['rec_cids'] = [(ln['rec_btn_yes'], cid_yes),
                          (ln['rec_btn_no'],  cid_no)]

    def _check_recovery_prompts(self) -> None:
        """Button-based recovery UI embedded in the figure.
        Auto-declines if no response within 40% of the batch duration."""
        if not self.fault_engine:
            return
        fe    = self.fault_engine
        ln    = getattr(self, '_ln', None)
        if ln is None:
            return
        t_now = self.state.time
        recovery_window = self.duration_hours * 0.40

        # timeout check on the active prompt
        for f in fe.faults:
            if f.get('_awaiting_input') and not f.get('_recovered'):
                elapsed = t_now - f.get('_prompt_time_h', t_now)
                if elapsed >= recovery_window:
                    f['_awaiting_input'] = False
                    fname = f['name']
                    self._hide_recovery_bar(ln)
                    print(
                        f'\n  \u23f1  No response within recovery window \u2014 '
                        f'recovery auto-declined for {fname!r}.\n'
                    )
                else:
                    remaining = recovery_window - elapsed
                    fname     = f['name']
                    rec_name  = RECOVERY_NAMES.get(f['id'], 'Recovery')
                    ln['rec_info_txt'].set_text(
                        f'  \u26a0  {fname}  \u203a  {rec_name}'
                        f'  \u2502  auto-N in {remaining:.1f} h  (t={t_now:.1f} h)'
                    )
                return

        # issue the next pending prompt
        for f in fe.faults:
            if (
                f.get('_needs_recovery_prompt')
                and not f.get('_prompt_started')
                and not f.get('_recovered')
            ):
                f['_prompt_started'] = True
                f['_awaiting_input'] = True
                f['_prompt_time_h']  = t_now
                self._show_recovery_bar(ln, f, t_now)
                break


    def run_live(self, update_every: int = 60,
                 duration_hours: Optional[float] = None,
                 dt_minutes: Optional[float] = None) -> list[dict]:
        """Run the simulation while streaming data into a live dashboard window."""
        if duration_hours is not None:
            self.duration_hours = duration_hours
        if dt_minutes is not None:
            self.dt = dt_minutes / 60.0
        self.history.clear()
        self.alarm_log.clear()
        self._record()

        plt.ion()
        fig, ln, free_axes = self._build_dashboard()
        self._ln = ln   # accessible by _check_recovery_prompts

        total_steps = int(self.duration_hours / self.dt)
        for step in range(1, total_steps + 1):
            self._step()
            if step % self.record_every == 0:
                self._record()
            if step % update_every == 0:
                self._refresh_dashboard(ln, free_axes)
                fig.canvas.draw_idle()
                plt.pause(0.01)
                self._check_recovery_prompts()

        self._refresh_dashboard(ln, free_axes)
        fig.canvas.draw()
        plt.ioff()
        return self.history

    def print_alarm_summary(self) -> None:
        if not self.alarm_log:
            print("\nNo alarms raised.")
            return
        limit_alarms = [a for a in self.alarm_log if a.level == "LIMIT"]
        alert_alarms = [a for a in self.alarm_log if a.level == "ALERT"]
        print(f"\nAlarm summary: {len(limit_alarms)} LIMIT  |  {len(alert_alarms)} ALERT")
        # Print first 5 of each type to avoid flooding the terminal
        for alarm in (limit_alarms + alert_alarms)[:10]:
            print(" ", alarm)
        if len(self.alarm_log) > 10:
            print(f"  ... ({len(self.alarm_log) - 10} more — see alarm_log attribute)")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    config_path = sys.argv[1] if len(sys.argv) > 1 else "config.json"
    print(f"Loading config: {os.path.abspath(config_path)}")

    sim = BioreactorSimulator(config_path)

    duration, dt_min, fault_defs = _prompt_run_config(sim.cfg)

    if fault_defs:
        sim.fault_engine = FaultEngine(fault_defs)

    print(
        f"\nBatch simulation  |  Duration: {duration} h  "
        f"|  Step: {dt_min} min  "
        f"|  Total steps: {int(duration * 60 / dt_min):,}"
    )
    if fault_defs:
        print("  Faults scheduled:")
        for fd in fault_defs:
            print(f"    t={fd['trigger_time_h']:.1f} h  [{fd['category'].upper()[:7]}]  {fd['name']}")
    print("=" * 65)

    history = sim.run_live(duration_hours=duration, dt_minutes=dt_min)
    sim.print_summary()
    sim.print_alarm_summary()

    peak = max(history, key=lambda r: r["viable_cell_density"])
    final = history[-1]
    print(f"\nPeak VCD     : {peak['viable_cell_density']:>15,.0f} cells/mL  at t = {peak['time_h']:.2f} h")
    print(f"Final VCD    : {final['viable_cell_density']:>15,.0f} cells/mL")
    print(f"Final viab.  : {final['viability_pct']:.1f} %")
    print(f"Final kd     : {final['death_rate_h']:.6f} h⁻¹")
    print(f"Final lactate: {final['lactate_g_L']:.2f} g/L")
    print(f"Data points  : {len(history):,}")

    csv_path = sim.export_csv()
    print(f"\nCSV exported → {csv_path}")
    print("\nClose the dashboard window to exit.")
    plt.show(block=True)
