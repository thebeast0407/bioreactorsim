"""FastAPI server for the bioreactor simulation web UI."""
import asyncio
import json
import os
import sys
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Project root on sys.path so bioreactorsim can be imported
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _ROOT)
from api.simulation_runner import SimulationRunner

app = FastAPI(title="Bioreactor Simulation API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

runner = SimulationRunner()

# ── Paths ─────────────────────────────────────────────────────────────────────

_DIST       = os.path.join(_ROOT, "frontend", "dist")
_INDEX_HTML = os.path.join(_DIST, "index.html")
_MODEL_PNG  = os.path.join(_ROOT, "bioreactormodel.png")

# ── Request / response models ─────────────────────────────────────────────────

class StartRequest(BaseModel):
    duration_hours: float = 48.0
    dt_minutes: float = 1.0
    fault_ids: list[str] = []

class FaultActionRequest(BaseModel):
    fault_id: str

# ── API routes (registered BEFORE the static/catch-all mounts) ───────────────

@app.get("/api/faults")
def list_faults() -> list[dict]:
    return runner.get_available_faults()

@app.get("/api/config")
def get_config() -> dict:
    return {"duration_hours": 48.0, "dt_minutes": 1.0, "fault_ids": []}

@app.post("/api/simulation/start")
def start_simulation(req: StartRequest) -> dict[str, Any]:
    runner.start({
        "duration_hours": req.duration_hours,
        "dt_minutes":     req.dt_minutes,
        "fault_ids":      req.fault_ids,
    })
    return {"status": "started"}

@app.post("/api/simulation/stop")
def stop_simulation() -> dict[str, Any]:
    runner.stop()
    return {"status": "stopped"}

@app.get("/api/simulation/status")
def simulation_status() -> dict[str, Any]:
    return {
        "running":  runner.is_running(),
        "finished": runner.is_finished(),
        "state":    runner.get_state(),
    }

@app.get("/api/simulation/history")
def simulation_history() -> list[dict]:
    return runner.get_history()

@app.post("/api/fault/trigger")
def trigger_fault(req: FaultActionRequest) -> dict[str, Any]:
    ok = runner.trigger_fault(req.fault_id)
    if not ok:
        raise HTTPException(400, "Fault not found or already triggered")
    return {"status": "triggered", "fault_id": req.fault_id}

@app.post("/api/fault/recover")
def apply_recovery(req: FaultActionRequest) -> dict[str, Any]:
    ok = runner.apply_recovery(req.fault_id)
    if not ok:
        raise HTTPException(400, "No awaiting recovery for this fault")
    return {"status": "recovered", "fault_id": req.fault_id}

@app.post("/api/fault/decline")
def decline_recovery(req: FaultActionRequest) -> dict[str, Any]:
    ok = runner.decline_recovery(req.fault_id)
    if not ok:
        raise HTTPException(400, "No awaiting recovery for this fault")
    return {"status": "declined", "fault_id": req.fault_id}

@app.get("/api/simulation/stream")
async def simulation_stream(request: Request):
    """SSE endpoint — one JSON frame per simulation step."""
    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=300)
    runner.subscribe(loop, queue)

    async def generate():
        try:
            current = runner.get_state()
            if current:
                yield f"data: {json.dumps(current)}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=2.0)
                    yield f"data: {json.dumps(data)}\n\n"
                    if data.get("finished"):
                        break
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            runner.unsubscribe(loop, queue)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# ── Static assets from React build (JS / CSS only) ───────────────────────────
# Mount /assets → dist/assets so the hashed JS/CSS bundles are served.
# This must come AFTER the /api routes so API calls win.

_ASSETS_DIR = os.path.join(_DIST, "assets")
if os.path.isdir(_ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=_ASSETS_DIR), name="assets")

# Serve bioreactor schematic PNG
@app.get("/bioreactormodel.png")
def serve_model_png():
    if not os.path.exists(_MODEL_PNG):
        raise HTTPException(404, "bioreactormodel.png not found")
    return FileResponse(_MODEL_PNG, media_type="image/png")

# ── SPA catch-all — serves index.html for every remaining GET path ────────────
# React Router / state navigation needs the shell HTML for any URL the user
# lands on directly (bookmark, refresh, direct link).

def _serve_index():
    if os.path.isfile(_INDEX_HTML):
        return FileResponse(_INDEX_HTML, media_type="text/html")
    return HTMLResponse(
        """<!doctype html><html><body style="font:14px system-ui;padding:40px;background:#0f1117;color:#e2e8f0">
        <h2>Frontend not built yet</h2>
        <p>Run the following commands, then restart the server:</p>
        <pre style="background:#1a202c;padding:16px;border-radius:6px;margin-top:12px">
cd frontend
npm install
npm run build</pre>
        </body></html>""",
        status_code=503,
    )

@app.get("/")
def root():
    return _serve_index()

@app.get("/{full_path:path}", include_in_schema=False)
def spa_fallback(full_path: str):
    # Let mounted routes (StaticFiles /assets) win; this only fires for everything else.
    return _serve_index()
