"""Wraps BioreactorSimulator for headless, API-driven execution."""
import sys
import os
import threading
import time
import copy
import asyncio
from typing import Optional

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bioreactorsim as _bsim


class SimulationRunner:
    def __init__(self) -> None:
        self._sim: Optional[_bsim.BioreactorSimulator] = None
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._running = False
        self._finished = False
        self._state_snapshot: Optional[dict] = None
        self._subscribers: list[tuple] = []   # (asyncio.AbstractEventLoop, asyncio.Queue)
        self._step_delay = 0.05               # seconds of real time per sim step (~20 steps/s)

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self, config_overrides: dict) -> None:
        if self._running:
            self.stop()

        sim = _bsim.BioreactorSimulator()
        if "duration_hours" in config_overrides:
            sim.duration_hours = float(config_overrides["duration_hours"])
        if "dt_minutes" in config_overrides:
            sim.dt = float(config_overrides["dt_minutes"]) / 60.0

        # Always create a fault engine with ALL 22 faults.
        # trigger_time_h = 1e9 so none auto-trigger; use trigger_fault() via API instead.
        all_faults = [copy.deepcopy(f) for f in _bsim.FAULT_CATALOGUE]
        for f in all_faults:
            f["trigger_time_h"] = 1e9
        sim.fault_engine = _bsim.FaultEngine(all_faults)

        self._sim = sim
        self._running = True
        self._finished = False
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._running = False
        if self._thread:
            self._thread.join(timeout=3.0)
        self._thread = None

    def is_running(self) -> bool:
        return self._running

    def is_finished(self) -> bool:
        return self._finished

    # ── Internal simulation loop ───────────────────────────────────────────────

    def _run_loop(self) -> None:
        sim = self._sim
        total_steps = int(sim.duration_hours / sim.dt)
        sim._record()
        snap = self._build_snapshot(finished=False)
        with self._lock:
            self._state_snapshot = snap
        self._publish(snap)

        for step in range(1, total_steps + 1):
            if not self._running:
                break
            sim._step()
            if step % sim.record_every == 0:
                sim._record()

            # Recovery auto-timeout: auto-decline after 40% of batch duration
            if sim.fault_engine:
                t_now = sim.state.time
                recovery_window = sim.duration_hours * 0.40
                for f in sim.fault_engine.faults:
                    if f.get("_awaiting_input") and not f.get("_recovered"):
                        elapsed = t_now - f.get("_prompt_time_h", t_now)
                        if elapsed >= recovery_window:
                            f["_awaiting_input"] = False

            snap = self._build_snapshot(finished=False)
            with self._lock:
                self._state_snapshot = snap
            self._publish(snap)
            time.sleep(self._step_delay)

        self._running = False
        self._finished = True
        snap = self._build_snapshot(finished=True)
        with self._lock:
            self._state_snapshot = snap
        self._publish(snap)

    # ── Snapshot builder ──────────────────────────────────────────────────────

    def _build_snapshot(self, finished: bool = False) -> dict:
        sim = self._sim
        s = sim.state
        snap: dict = {
            "time_h":                round(s.time, 3),
            "pH":                    round(s.pH, 3),
            "temperature_C":         round(s.temperature, 3),
            "pressure_bar":          round(s.pressure, 4),
            "dissolved_oxygen_pct":  round(s.dissolved_oxygen, 2),
            "viable_cell_density":   round(s.viable_cell_density, 0),
            "dead_cell_density":     round(s.dead_cell_density, 0),
            "viability_pct":         round(s.viability, 2),
            "growth_rate_h":         round(s.growth_rate, 6),
            "death_rate_h":          round(s.death_rate, 6),
            "substrate_g_L":         round(s.substrate, 4),
            "lactate_g_L":           round(s.lactate, 4),
            "active_faults":         [],
            "recovered_faults":      [],
            "recovery_prompt":       None,
            "finished":              finished,
            "duration_hours":        sim.duration_hours,
        }

        if sim.fault_engine:
            fe = sim.fault_engine
            active = []
            recovered = []
            for f in fe.faults:
                if f.get("_triggered"):
                    entry = {
                        "id":             f["id"],
                        "name":           f["name"],
                        "category":       f["category"],
                        "desc":           f["desc"],
                        "triggered_at_h": round(f.get("_trigger_time_h", 0), 3),
                        "recovered":      bool(f.get("_recovered")),
                        "recovered_at_h": round(f["_recovered_at_h"], 3) if f.get("_recovered_at_h") is not None else None,
                    }
                    if f.get("_recovered"):
                        recovered.append(entry)
                    else:
                        active.append(entry)
            snap["active_faults"] = active
            snap["recovered_faults"] = recovered

            # Recovery prompt (first awaiting fault)
            t_now = s.time
            for f in fe.faults:
                if f.get("_awaiting_input") and not f.get("_recovered"):
                    rec_name = _bsim.RECOVERY_NAMES.get(f["id"], "Standard Recovery")
                    prompt_t = f.get("_prompt_time_h", t_now)
                    deadline_h = prompt_t + sim.duration_hours * 0.40
                    snap["recovery_prompt"] = {
                        "fault_id":     f["id"],
                        "fault_name":   f["name"],
                        "recovery_name": rec_name,
                        "deadline_h":   round(deadline_h, 2),
                        "remaining_h":  round(max(0.0, deadline_h - t_now), 2),
                    }
                    break

        return snap

    # ── SSE pub/sub ───────────────────────────────────────────────────────────

    def subscribe(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
        self._subscribers.append((loop, queue))

    def unsubscribe(self, loop: asyncio.AbstractEventLoop, queue: asyncio.Queue) -> None:
        try:
            self._subscribers.remove((loop, queue))
        except ValueError:
            pass

    def _publish(self, data: dict) -> None:
        dead = []
        for loop, q in self._subscribers:
            try:
                loop.call_soon_threadsafe(q.put_nowait, data)
            except Exception:
                dead.append((loop, q))
        for d in dead:
            try:
                self._subscribers.remove(d)
            except ValueError:
                pass

    # ── Fault actions (called from API) ───────────────────────────────────────

    def get_available_faults(self) -> list[dict]:
        return _bsim.FAULT_CATALOGUE

    def get_state(self) -> Optional[dict]:
        with self._lock:
            return copy.deepcopy(self._state_snapshot)

    def get_history(self) -> list[dict]:
        if not self._sim:
            return []
        with self._lock:
            return list(self._sim.history)

    def trigger_fault(self, fault_id: str) -> bool:
        """Immediately force-trigger a fault that is in the engine's list."""
        if not self._sim or not self._sim.fault_engine:
            return False
        fe = self._sim.fault_engine
        for f in fe.faults:
            if f["id"] == fault_id and not f.get("_triggered"):
                t_now = self._sim.state.time
                f["trigger_time_h"] = t_now
                f["_trigger_time_h"] = t_now
                f["_triggered"] = True
                fe.event_log.append((t_now, f["id"], f["name"], f["category"]))
                fe._on_trigger(self._sim, f)
                f["_needs_recovery_prompt"] = True
                f["_prompt_started"] = True
                f["_awaiting_input"] = True
                f["_prompt_time_h"] = t_now
                return True
        return False

    def apply_recovery(self, fault_id: str) -> bool:
        if not self._sim or not self._sim.fault_engine:
            return False
        fe = self._sim.fault_engine
        for f in fe.faults:
            if f["id"] == fault_id and f.get("_awaiting_input") and not f.get("_recovered"):
                f["_awaiting_input"] = False
                fe.recover(self._sim, f)
                return True
        return False

    def decline_recovery(self, fault_id: str) -> bool:
        if not self._sim or not self._sim.fault_engine:
            return False
        fe = self._sim.fault_engine
        for f in fe.faults:
            if f["id"] == fault_id and f.get("_awaiting_input"):
                f["_awaiting_input"] = False
                return True
        return False
