# Bioreactor Batch Simulation

Real-time simulation of a fed-batch bioreactor with a live 6-panel dashboard and a 2D process schematic overlaid with live CPP (Critical Process Parameter) values.

---

## Project Files

| File | Purpose |
|---|---|
| `bioreactorsim.py` | Main simulation + live dashboard |
| `config.json` | All simulation parameters (setpoints, kinetics, limits) |
| `bioreactormodel.png` | 2D bioreactor schematic shown in the dashboard |
| `bioreactor_run.csv` | Output data file (generated on each run) |

---

## Prerequisites

| Requirement | Minimum version | Notes |
|---|---|---|
| Python | 3.9 | Install from [python.org](https://www.python.org/downloads/windows/) — choose **"Add Python to PATH"** during setup |
| pip | bundled with Python | Used to install packages |
| Display / GUI | — | See [Display on Windows Server](#display-on-windows-server) section below |

---

## Installation

Open **Command Prompt** or **PowerShell** and run the following steps.

### 1 — Clone or copy the project folder

Place the project folder (containing `bioreactorsim.py`, `config.json`, `bioreactormodel.png`) somewhere on the server, for example:

```
C:\bioreactor\
```

### 2 — Open a terminal in the project folder

```powershell
cd C:\bioreactor
```

### 3 — Create a virtual environment

```powershell
python -m venv .venv
```

### 4 — Activate the virtual environment

```powershell
.venv\Scripts\activate
```

You should see `(.venv)` at the start of your prompt.

### 5 — Install dependencies

```powershell
pip install numpy matplotlib
```

This installs all required packages (numpy, matplotlib, pillow, and their dependencies).

### 6 — Verify the installation

```powershell
python -c "import numpy, matplotlib; print('OK')"
```

Expected output: `OK`

---

## Running the Simulation

Make sure the virtual environment is active (`(.venv)` prefix in prompt) and you are inside the project folder.

```powershell
python bioreactorsim.py
```

The live dashboard window opens immediately and updates as the simulation runs. When the simulation finishes (~a few seconds), the terminal prints a summary and waits. **Close the dashboard window to exit.**

To run with a different config file:

```powershell
python bioreactorsim.py my_config.json
```

---

## Display on Windows Server

The live dashboard requires a graphical display. Windows Server is commonly accessed in two ways:

### Option A — Remote Desktop (RDP) — Recommended

If you connect to the server using **Remote Desktop**, the full GUI is available. Run the simulation normally — the dashboard window will appear in the RDP session.

```powershell
python bioreactorsim.py
```

This is the simplest option and requires no code changes.

### Option B — Headless (no GUI / SSH only)

If the server has no display (e.g., accessed only via SSH or used as a scheduled task), matplotlib's interactive window will fail. Use the **Agg** backend to save the final dashboard as a PNG file instead.

Set the environment variable before running:

```powershell
set MPLBACKEND=Agg
python bioreactorsim.py
```

Or set it permanently for the session in PowerShell:

```powershell
$env:MPLBACKEND = "Agg"
python bioreactorsim.py
```

> **Note:** In headless mode the live window does not appear. The simulation runs to completion, prints the summary, exports the CSV, and exits. To also save the final dashboard image in headless mode, add the following two lines at the end of `bioreactorsim.py` (just before `plt.show(block=True)`):
>
> ```python
> import os
> if os.environ.get("MPLBACKEND", "").lower() == "agg":
>     fig_path = sim.output_csv.replace(".csv", "_dashboard.png")
>     plt.savefig(fig_path, dpi=150, bbox_inches="tight")
>     print(f"Dashboard saved → {fig_path}")
> ```

### Option C — Windows Subsystem for Linux (WSL 2)

If WSL 2 with a GUI layer (e.g., WSLg on Windows 11 / Server 2022) is available:

```bash
# Inside WSL terminal
cd /mnt/c/bioreactor
python3 -m venv .venv
source .venv/bin/activate
pip install numpy matplotlib
python bioreactorsim.py
```

---

## Configuration

All simulation parameters live in `config.json`. No code changes are needed for routine tuning.

| Section | Key settings |
|---|---|
| `simulation` | Duration (hours), time step (minutes), random seed, output CSV path |
| `initial_conditions` | Starting cell density, substrate, lactate |
| `setpoints` | pH, temperature, pressure, dissolved oxygen targets |
| `cpp_limits` | Alert and limit bands for each CPP |
| `kinetics` | µmax, Ks, Kd, inhibition constants, stress multipliers |
| `process_dynamics` | Controller time constants, noise levels |
| `bioreactor` | Vessel volume, feed rate, yield coefficients |

Example — change batch duration to 72 h:

```json
"simulation": {
    "duration_hours": 72,
    ...
}
```

---

## Output Files

| File | Description |
|---|---|
| `bioreactor_run.csv` | Time-series data for all state variables, one row per recorded step |

CSV columns: `time_h`, `pH`, `temperature_C`, `pressure_bar`, `dissolved_oxygen_pct`, `viable_cell_density`, `dead_cell_density`, `viability_pct`, `growth_rate_h`, `death_rate_h`, `substrate_g_L`, `lactate_g_L`

---

## Troubleshooting

### `python` is not recognized

Python was not added to PATH during installation. Either reinstall Python and check **"Add Python to PATH"**, or use the full path:

```powershell
C:\Users\<you>\AppData\Local\Programs\Python\Python39\python.exe -m venv .venv
```

### `No module named 'numpy'` or `'matplotlib'`

The virtual environment is not active. Run:

```powershell
.venv\Scripts\activate
```

then retry.

### Dashboard window does not appear (SSH / headless server)

Set `MPLBACKEND=Agg` as described in [Option B](#option-b--headless-no-gui--ssh-only) above.

### `cannot import name 'Axes3D'` or similar matplotlib error

Upgrade matplotlib:

```powershell
pip install --upgrade matplotlib
```

### Permission denied writing CSV

Run Command Prompt or PowerShell **as Administrator**, or move the project folder to a location your user account owns (e.g., `C:\Users\<you>\bioreactor\`).

### Slow performance on the server

Increase the update interval so the GUI redraws less often. In `bioreactorsim.py`, change the `run_live` call in `__main__`:

```python
history = sim.run_live(update_every=120)   # update every 2 simulated hours instead of 1
```

---

## Quick-start Summary

```powershell
# 1. Navigate to project folder
cd C:\bioreactor

# 2. Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate

# 3. Install dependencies
pip install numpy matplotlib

# 4. Run
python bioreactorsim.py
```
