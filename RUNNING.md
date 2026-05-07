# Running the Bioreactor Simulation

Three applications are available. All require the **Python API server** to be running first.

---

## Prerequisites (one-time setup)

### Python
```bash
# macOS / Linux
python3 -m venv .venv
source .venv/bin/activate
pip install numpy matplotlib fastapi uvicorn

# Windows (PowerShell)
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install numpy matplotlib fastapi uvicorn
```

### Node.js
Download and install the LTS release from https://nodejs.org

---

## 1 — Python Desktop App (matplotlib)

No build step needed.

```bash
# macOS / Linux
source .venv/bin/activate
python bioreactorsim.py

# Windows
.venv\Scripts\Activate.ps1
python bioreactorsim.py
```

A matplotlib window opens with the live dashboard.

---

## 2 — React Web App

### First-time build
```bash
cd frontend
npm install
npm run build
cd ..
```

### Run
```bash
# macOS / Linux
source .venv/bin/activate
uvicorn api.main:app --port 8000

# Windows
.venv\Scripts\Activate.ps1
uvicorn api.main:app --port 8000
```

Open **http://localhost:8000**

> **Dev mode** (hot-reload, no build needed):
> ```bash
> # Terminal 1 — API
> uvicorn api.main:app --port 8000
>
> # Terminal 2 — React dev server
> cd frontend && npm run dev
> ```
> Open **http://localhost:5173**

---

## 3 — Angular Web App

### First-time build
```bash
cd frontend-angular
npm install
npm run build
cd ..
```

### Run (same API server as React)
```bash
# macOS / Linux
source .venv/bin/activate
uvicorn api.main:app --port 8000

# Windows
.venv\Scripts\Activate.ps1
uvicorn api.main:app --port 8000
```

Open **http://localhost:8000/ng**

> **Dev mode** (hot-reload, no build needed):
> ```bash
> # Terminal 1 — API
> uvicorn api.main:app --port 8000
>
> # Terminal 2 — Angular dev server
> cd frontend-angular && npm run start
> ```
> Open **http://localhost:4200**

---

## Running all three at once

```
Terminal 1   →   uvicorn api.main:app --port 8000
Terminal 2   →   cd frontend         && npm run dev    (React,   port 5173)
Terminal 3   →   cd frontend-angular && npm run start  (Angular, port 4200)
```

| App | URL |
|-----|-----|
| Python desktop | Opens as a window |
| React (dev) | http://localhost:5173 |
| React (built) | http://localhost:8000 |
| Angular (dev) | http://localhost:4200 |
| Angular (built) | http://localhost:8000/ng |
| API | http://localhost:8000/api |
