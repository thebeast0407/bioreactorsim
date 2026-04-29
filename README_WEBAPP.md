# Bioreactor Simulation — Web Application

A full-stack web application that runs the bioreactor simulation as a FastAPI service
and visualises it in a React dashboard with live streaming charts, a 2D vessel model
with CPP overlays, and interactive fault injection / recovery.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Installation — macOS / Linux](#installation--macos--linux)
4. [Installation — Windows](#installation--windows)
5. [Running the Application](#running-the-application)
6. [Using the Dashboard](#using-the-dashboard)
7. [API Reference](#api-reference)
8. [Integration Guide](#integration-guide)
9. [Troubleshooting](#troubleshooting)
10. [Development Notes](#development-notes)

---

## Architecture

```
bioreactor/
├── bioreactorsim.py          Python simulation engine
├── config.json               Simulation parameters
├── bioreactormodel.png       2D vessel schematic (served by FastAPI)
│
├── api/
│   ├── main.py               FastAPI application — REST + SSE endpoints
│   └── simulation_runner.py  Thread-safe simulation wrapper
│
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── App.jsx
        ├── components/
        │   ├── ConfigStage.jsx     Stage 1 — run parameters
        │   ├── DashboardStage.jsx  Stage 2 — live dashboard
        │   ├── BioreactorModel.jsx 2D schematic with CPP badges
        │   ├── ChartPanel.jsx      Recharts wrapper
        │   ├── FaultList.jsx       Fault dropdown + status list
        │   └── RecoveryBar.jsx     Recovery prompt bar
        └── services/
            └── api.js              HTTP + SSE client helpers
```

### Data flow

```
bioreactorsim.py
    └── BioreactorSimulator._step()
            │
            ▼
    SimulationRunner (background thread, api/simulation_runner.py)
            │  publishes state dict every step
            ▼
    asyncio.Queue  (one per connected SSE client)
            │
            ▼
    GET /api/simulation/stream   (text/event-stream)
            │
            ▼
    Browser  EventSource  →  React state  →  chart re-render
```

---

## Prerequisites

| Tool    | Minimum | Purpose |
|---------|---------|---------|
| Python  | 3.9     | Backend simulation + FastAPI server |
| Node.js | 18 LTS  | Frontend build (not needed at runtime after build) |
| npm     | 9       | Frontend package manager |

---

## Installation — macOS / Linux

Open a terminal in the project folder.

### 1. Python virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install numpy matplotlib fastapi uvicorn
```

### 2. Install Node.js

**macOS (Homebrew)**

```bash
# Install Homebrew if needed
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node
node --version   # v18 or later
```

**Alternative**: download the LTS installer from <https://nodejs.org>.

**Linux (Ubuntu / Debian)**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

### 3. Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Build the React app

```bash
cd frontend
npm run build
cd ..
```

Built files land in `frontend/dist/`. FastAPI serves them at the root URL.

---

## Installation — Windows

All commands below are for **PowerShell** (Windows 10 / 11) unless noted.
Open PowerShell in the project folder (right-click the folder → **Open in Terminal** or use `cd C:\path\to\bioreactor`).

### 1. Install Python

1. Download Python 3.9 or later from <https://www.python.org/downloads/windows/>
2. Run the installer. On the first screen, **check "Add Python to PATH"** before clicking Install Now.
3. Verify:

```powershell
python --version   # Python 3.9.x or later
```

> If `python` is not recognised, try `py --version`. Use `py` instead of `python` in all commands below.

### 2. Python virtual environment

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install numpy matplotlib fastapi uvicorn
```

> **Execution policy error?**  
> If PowerShell blocks the activation script, run this once (as Administrator) then retry:
> ```powershell
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
> ```

After activation you should see `(.venv)` at the start of your prompt.

### 3. Install Node.js

1. Download the **LTS** installer from <https://nodejs.org/en/download>
2. Run the installer — accept defaults. It adds both `node` and `npm` to PATH.
3. **Restart PowerShell** after installation, then verify:

```powershell
node --version   # v18 or later
npm --version    # 9 or later
```

> **winget alternative** (Windows Package Manager):
> ```powershell
> winget install OpenJS.NodeJS.LTS
> ```
> Then restart PowerShell.

### 4. Frontend dependencies

```powershell
cd frontend
npm install
cd ..
```

### 5. Build the React app

```powershell
cd frontend
npm run build
cd ..
```

The built files land in `frontend\dist\`.

---

## Running the Application

### Mode A — Single server (production, recommended)

Start only the FastAPI server. It serves both the API and the pre-built React frontend.

**macOS / Linux**

```bash
source .venv/bin/activate
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

**Windows (PowerShell)**

```powershell
.venv\Scripts\Activate.ps1
uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Open your browser: **<http://localhost:8000>**

Expected console output:
```
INFO:     Started server process [...]
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

To stop: press **Ctrl+C** in the terminal.

---

### Mode B — Two servers (development, hot-reload)

Run the API server and the Vite dev server side by side. React code changes are
reflected instantly in the browser without rebuilding.

**Terminal 1 — API server**

```bash
# macOS / Linux
source .venv/bin/activate
uvicorn api.main:app --reload --port 8000

# Windows
.venv\Scripts\Activate.ps1
uvicorn api.main:app --reload --port 8000
```

**Terminal 2 — Vite dev server**

```bash
# macOS / Linux
cd frontend
npm run dev

# Windows
cd frontend
npm run dev
```

Open your browser: **<http://localhost:5173>**

Vite automatically proxies all `/api` requests to `http://localhost:8000`.

---

### Windows: running as a background service (optional)

To keep the server running after closing the terminal, use **NSSM** (Non-Sucking Service Manager):

```powershell
# Install NSSM (once)
winget install NSSM.NSSM

# Create service (replace C:\bioreactor with your actual path)
nssm install BioreactorAPI "C:\bioreactor\.venv\Scripts\python.exe" `
  "-m" "uvicorn" "api.main:app" "--host" "0.0.0.0" "--port" "8000"
nssm set BioreactorAPI AppDirectory "C:\bioreactor"
nssm start BioreactorAPI
```

Stop with `nssm stop BioreactorAPI`. Remove with `nssm remove BioreactorAPI`.

---

## Using the Dashboard

### Stage 1 — Configuration

| Field | Description |
|-------|-------------|
| Batch Duration | Total simulated time in hours (default 48 h) |
| Step Frequency | Minutes of simulation time per step — lower = finer resolution, slower wall-clock |

Click **▶ Start Simulation** to begin.

### Stage 2 — Live Dashboard

| Panel | Content |
|-------|---------|
| Left column | 2D vessel schematic with live CPP value badges |
| Right 2 × 3 grid | Six live charts (see below) |
| Bottom strip | Fault injection panel |
| Top amber bar (when active) | Recovery prompt |

**Charts**

| Chart | Series |
|-------|--------|
| Cell Density & Viability | VCD, DCD, Viability % |
| pH | pH with alert / limit bands and setpoint baseline |
| Temperature | °C with alert / limit bands |
| Dissolved Oxygen | % with alert / limit bands |
| Substrate & Lactate | Glucose g/L, Lactate g/L |
| Cell Growth Rate | μ (h⁻¹) — shows lag → exponential → stationary → decline |

**CPP badge colours**

| Colour | Meaning |
|--------|---------|
| Green  | Within normal operating range |
| Amber  | Inside alert band |
| Red    | Outside limit band |
| Category-tinted with ⚠ icon | Active fault is affecting this CPP |

**Fault injection**: select a fault from the dropdown, read its description, click **▶ Trigger Fault**.

**Recovery**: when a fault prompts, the top bar shows the fault name, recovery procedure, and a countdown. Click **✓ Apply Recovery** or **✗ Decline**.

---

## API Reference

Base URL: `http://localhost:8000`  
All request and response bodies are JSON (`Content-Type: application/json`).

---

### GET `/api/config`

Returns default simulation parameters.

**Response**

```json
{
  "duration_hours": 48.0,
  "dt_minutes": 1.0,
  "fault_ids": []
}
```

---

### GET `/api/faults`

Returns the full fault catalogue (22 entries).

**Response** — array of fault objects

```json
[
  {
    "id": "agitator_power_loss",
    "category": "process",
    "name": "Agitator Power Loss",
    "desc": "RPM drops 80 %; kLa halves, DO crashes below 10 % within 30 min.",
    "trigger_default_h": 8.0
  }
]
```

**Fault categories**

| `category` | Colour | Count | Description |
|-----------|--------|-------|-------------|
| `process`   | Red    | 10    | Mechanical / gas-line failures |
| `sensor`    | Orange |  3    | Probe bias, PID faults |
| `excursion` | Purple |  9    | pH, DO, temperature out-of-range events |

---

### POST `/api/simulation/start`

Starts a new simulation run (stops any currently running run first).

**Request body**

```json
{
  "duration_hours": 48.0,
  "dt_minutes": 1.0,
  "fault_ids": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `duration_hours` | float | No (default 48) | Total batch duration |
| `dt_minutes` | float | No (default 1) | Simulation step size in minutes |
| `fault_ids` | string[] | No (default []) | Reserved — faults are triggered on demand |

**Response**

```json
{ "status": "started" }
```

---

### POST `/api/simulation/stop`

Stops the running simulation.

**Response**

```json
{ "status": "stopped" }
```

---

### GET `/api/simulation/status`

Returns the current simulation state without streaming.

**Response**

```json
{
  "running": true,
  "finished": false,
  "state": { ...state snapshot... }
}
```

---

### GET `/api/simulation/history`

Returns all recorded data points since the simulation started.

**Response** — array of state snapshot objects (same schema as SSE frames).

---

### POST `/api/fault/trigger`

Immediately injects a fault into the running simulation.

**Request body**

```json
{ "fault_id": "agitator_power_loss" }
```

**Response (200)**

```json
{ "status": "triggered", "fault_id": "agitator_power_loss" }
```

**Error (400)** — fault not found or already triggered

```json
{ "detail": "Fault not found or already triggered" }
```

---

### POST `/api/fault/recover`

Applies the recovery procedure for a fault that is currently awaiting a decision.
Restores all CPP setpoints to their pre-fault values.

**Request body**

```json
{ "fault_id": "agitator_power_loss" }
```

**Response (200)**

```json
{ "status": "recovered", "fault_id": "agitator_power_loss" }
```

**Error (400)** — no awaiting recovery for this fault

```json
{ "detail": "No awaiting recovery for this fault" }
```

---

### POST `/api/fault/decline`

Declines the recovery decision for a fault. The fault remains active.

**Request body**

```json
{ "fault_id": "agitator_power_loss" }
```

**Response (200)**

```json
{ "status": "declined", "fault_id": "agitator_power_loss" }
```

---

### GET `/api/simulation/stream`

**Server-Sent Events (SSE)** endpoint. Pushes one JSON data frame per simulation step.

**Headers required by client**

```
Accept: text/event-stream
Cache-Control: no-cache
```

**Event format**

Each event is a standard SSE `data:` line:

```
data: {"time_h": 12.5, "pH": 7.19, ...}\n\n
```

Keep-alive pings (no data, safe to ignore):

```
: ping\n\n
```

**Full state snapshot schema**

```json
{
  "time_h": 12.5,
  "pH": 7.19,
  "temperature_C": 36.98,
  "pressure_bar": 1.203,
  "dissolved_oxygen_pct": 41.2,
  "viable_cell_density": 2150000,
  "dead_cell_density": 48000,
  "viability_pct": 97.8,
  "growth_rate_h": 0.041,
  "death_rate_h": 0.008,
  "substrate_g_L": 7.43,
  "lactate_g_L": 0.92,
  "active_faults": [
    {
      "id": "agitator_power_loss",
      "name": "Agitator Power Loss",
      "category": "process",
      "desc": "RPM drops 80 %; kLa halves, DO crashes below 10 % within 30 min.",
      "triggered_at_h": 8.02,
      "recovered": false,
      "recovered_at_h": null
    }
  ],
  "recovered_faults": [
    {
      "id": "ph_high",
      "name": "pH Excursion High (>8.0)",
      "category": "excursion",
      "desc": "...",
      "triggered_at_h": 6.50,
      "recovered": true,
      "recovered_at_h": 7.83
    }
  ],
  "recovery_prompt": {
    "fault_id": "agitator_power_loss",
    "fault_name": "Agitator Power Loss",
    "recovery_name": "Emergency Agitator Restart",
    "deadline_h": 10.02,
    "remaining_h": 1.47
  },
  "finished": false,
  "duration_hours": 48.0
}
```

**Field reference**

| Field | Type | Unit | Description |
|-------|------|------|-------------|
| `time_h` | float | h | Elapsed simulated time |
| `pH` | float | — | Bioreactor pH |
| `temperature_C` | float | °C | Culture temperature |
| `pressure_bar` | float | bar | Headspace pressure |
| `dissolved_oxygen_pct` | float | % air sat. | Dissolved oxygen |
| `viable_cell_density` | float | cells/mL | Live cell concentration |
| `dead_cell_density` | float | cells/mL | Dead cell concentration |
| `viability_pct` | float | % | Xv / (Xv + Xd) × 100 |
| `growth_rate_h` | float | h⁻¹ | Specific growth rate μ |
| `death_rate_h` | float | h⁻¹ | Specific death rate kd |
| `substrate_g_L` | float | g/L | Glucose concentration |
| `lactate_g_L` | float | g/L | Lactate concentration |
| `active_faults` | array | — | Faults currently active and unrecovered |
| `recovered_faults` | array | — | Faults that have been recovered |
| `recovery_prompt` | object\|null | — | Pending recovery decision, or null |
| `finished` | bool | — | `true` on the final frame when batch completes |
| `duration_hours` | float | h | Total configured batch duration |

---

## Integration Guide

This section shows how to connect an external application to the simulation API.

### Python client example

```python
import requests
import json
import sseclient   # pip install sseclient-py

BASE = "http://localhost:8000"

# 1. Start a 48-hour simulation
resp = requests.post(f"{BASE}/api/simulation/start", json={
    "duration_hours": 48,
    "dt_minutes": 1,
})
print(resp.json())   # {"status": "started"}

# 2. Stream live data
response = requests.get(f"{BASE}/api/simulation/stream", stream=True)
client = sseclient.SSEClient(response)
for event in client.events():
    if event.data.startswith(":"):
        continue   # skip keep-alive pings
    state = json.loads(event.data)
    print(f"t={state['time_h']:.1f}h  pH={state['pH']:.2f}  DO={state['dissolved_oxygen_pct']:.1f}%")
    if state["finished"]:
        break

# 3. Trigger a fault mid-run
requests.post(f"{BASE}/api/fault/trigger", json={"fault_id": "agitator_power_loss"})

# 4. Apply recovery when prompted
status = requests.get(f"{BASE}/api/simulation/status").json()
if status["state"] and status["state"]["recovery_prompt"]:
    fid = status["state"]["recovery_prompt"]["fault_id"]
    requests.post(f"{BASE}/api/fault/recover", json={"fault_id": fid})
```

---

### JavaScript / Node.js client example

```javascript
const BASE = 'http://localhost:8000';

// Start simulation
await fetch(`${BASE}/api/simulation/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ duration_hours: 48, dt_minutes: 1 }),
});

// Stream via EventSource (browser) or eventsource package (Node.js)
const es = new EventSource(`${BASE}/api/simulation/stream`);
es.onmessage = (event) => {
  const state = JSON.parse(event.data);
  console.log(`t=${state.time_h.toFixed(1)}h  VCD=${(state.viable_cell_density/1e6).toFixed(2)}M cells/mL`);
  if (state.finished) es.close();
};

// Trigger a fault
await fetch(`${BASE}/api/fault/trigger`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fault_id: 'ph_high' }),
});
```

---

### cURL examples

```bash
# Get all available faults
curl http://localhost:8000/api/faults | python3 -m json.tool

# Start a 24-hour simulation
curl -X POST http://localhost:8000/api/simulation/start \
  -H "Content-Type: application/json" \
  -d '{"duration_hours": 24, "dt_minutes": 2}'

# Current simulation status
curl http://localhost:8000/api/simulation/status | python3 -m json.tool

# Trigger a fault
curl -X POST http://localhost:8000/api/fault/trigger \
  -H "Content-Type: application/json" \
  -d '{"fault_id": "sparger_blockage"}'

# Apply recovery
curl -X POST http://localhost:8000/api/fault/recover \
  -H "Content-Type: application/json" \
  -d '{"fault_id": "sparger_blockage"}'

# Stream live data (prints SSE lines to terminal)
curl -N http://localhost:8000/api/simulation/stream

# Stop simulation
curl -X POST http://localhost:8000/api/simulation/stop
```

---

### HTTP polling (no SSE)

If your environment does not support SSE, poll `/api/simulation/status` at regular intervals:

```python
import requests, time

BASE = "http://localhost:8000"
requests.post(f"{BASE}/api/simulation/start", json={"duration_hours": 48})

while True:
    r = requests.get(f"{BASE}/api/simulation/status").json()
    if not r["running"] and r["finished"]:
        print("Simulation complete")
        break
    if r["state"]:
        s = r["state"]
        print(f"t={s['time_h']:.1f}h  Xv={s['viable_cell_density']/1e6:.2f}M")
    time.sleep(5)   # poll every 5 seconds
```

---

### Complete fault ID list

| Fault ID | Name | Category |
|----------|------|----------|
| `agitator_power_loss` | Agitator Power Loss | process |
| `sparger_blockage` | Sparger Blockage | process |
| `gas_supply_failure` | Gas Supply Failure | process |
| `foam_overflow` | Foam Overflow via Sparger | process |
| `viscosity_surge` | Broth Viscosity Surge | process |
| `antifoam_injection` | Anti-foam Over-injection | process |
| `impeller_shear` | Impeller Shear Damage | process |
| `coolant_leak` | Coolant Leak to Sparge Line | process |
| `exhaust_filter_clog` | Exhaust Filter Clog | process |
| `seed_hypoxia` | Seed Train Hypoxia | process |
| `do_probe_bias` | DO Probe Bias (-20 %) | sensor |
| `pid_fault` | PID Tuning Fault | sensor |
| `antifoam_overdose` | Antifoam Overdose | sensor |
| `ph_high` | pH Excursion High (>8.0) | excursion |
| `ph_low` | pH Excursion Low (<5.5) | excursion |
| `ph_oscillation` | pH Oscillation (±0.5) | excursion |
| `do_low_sustained` | DO Excursion Low (<10 % sustained) | excursion |
| `do_high` | DO Excursion High (>60 %) | excursion |
| `do_hunting` | DO Setpoint Hunting | excursion |
| `temp_high` | Temp Excursion High (>42 °C) | excursion |
| `temp_low` | Temp Excursion Low (<28 °C) | excursion |
| `temp_ramp` | Temp Ramp (>1 °C/h) | excursion |

---

## Troubleshooting

### `uvicorn: command not found` / `uvicorn is not recognized`

The virtual environment is not active. Run:

```bash
source .venv/bin/activate        # macOS / Linux
.venv\Scripts\Activate.ps1       # Windows PowerShell
```

### PowerShell activation script blocked

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

Then try activation again.

### `npm: command not found` / `npm is not recognized`

Node.js is not installed. See [Installation — Windows](#installation--windows) step 3.  
After installing, **restart your terminal** for PATH changes to take effect.

### Browser shows blank page or "Frontend not built yet"

The React build is missing. Run:

```bash
# macOS / Linux
cd frontend && npm run build && cd ..

# Windows
cd frontend
npm run build
cd ..
```

Then restart uvicorn.

### `ModuleNotFoundError: No module named 'fastapi'`

Packages are not installed in the active virtual environment:

```bash
pip install numpy matplotlib fastapi uvicorn
```

### Charts do not update / SSE connection drops

1. Check the uvicorn terminal for Python tracebacks.
2. Confirm the simulation is running: `curl http://localhost:8000/api/simulation/status`
3. Reload the browser tab — the EventSource reconnects automatically.

### Port 8000 already in use

**macOS / Linux** — find and kill the process:

```bash
lsof -ti :8000 | xargs kill -9
```

**Windows** — find and kill the process:

```powershell
netstat -ano | findstr :8000
# Note the PID in the last column, then:
taskkill /PID <PID> /F
```

Or start uvicorn on a different port:

```bash
uvicorn api.main:app --port 8001
```

### Firewall blocks external connections (Windows)

When using `--host 0.0.0.0`, Windows Firewall may prompt for network access.
Click **Allow access**. To add the rule manually:

```powershell
New-NetFirewallRule -DisplayName "Bioreactor API" -Direction Inbound `
  -Protocol TCP -LocalPort 8000 -Action Allow
```

### `config.json` not found when running uvicorn from a subfolder

Always run uvicorn from the **project root** (the folder containing `config.json`), not from inside `api/`:

```bash
# Correct
cd C:\bioreactor
uvicorn api.main:app --port 8000

# Wrong — config.json not found
cd C:\bioreactor\api
uvicorn main:app --port 8000
```

---

## Development Notes

| Topic | Detail |
|-------|--------|
| Simulation speed | Runner sleeps 50 ms per step (`_step_delay = 0.05` in `api/simulation_runner.py`). A 48 h run at 1 min/step ≈ 144 s real time. Set to `0.001` for fastest-possible replay. |
| Chart buffer | Frontend keeps up to 3 000 data points, then thins uniformly. The full timeline is always preserved — no gaps on the fixed x-axis. |
| SSE fan-out | Each browser tab / API client gets its own `asyncio.Queue`. The simulation broadcasts to all connected clients simultaneously. |
| Python-only mode | `python bioreactorsim.py` still works independently using matplotlib. The web app does not modify this code path. |
| Auto-decline | If a fault's recovery prompt receives no response within 2 simulated hours, it is automatically declined and the fault stays active. |
| CORS | The API allows all origins (`*`). Restrict in `api/main.py` (`allow_origins`) for production deployments. |
