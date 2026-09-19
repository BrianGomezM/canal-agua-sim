from dataclasses import asdict, fields
import asyncio
import json
import time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .model import Params, ChannelFlowSolver, TYPE_NAMES

app = FastAPI(title="Flujo en un canal - Navier-Stokes 2D (SCN)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PARAM_FIELDS = {f.name for f in fields(Params)}
# The mesh (400 x 40 m, 80 x 8 cells of 5 m) is that of the report and is fixed. A client can change
# how the solver is run and three variables of the model (viscosity, inlet speed, pressure gradient);
# their defaults are the report's (nu = 1 m^2/s, 1 m/s, constant pressure).
LIVE_FIELDS = ("omega", "tol", "sweeps_per_second")          # while it runs
RESET_FIELDS = LIVE_FIELDS + ("nu", "inlet_vx", "dpdx")     # model variables: they change the equations, so the run restarts
MAX_SWEEPS_PER_TICK = 50                                    # bounds the work done between two frames
TICK = 1.0 / 60.0


def merge_params(base: Params, incoming: dict, allowed) -> Params:
    """Params with the `allowed` fields of `incoming` applied; raises ValueError if invalid."""
    values = {**asdict(base), **{k: v for k, v in incoming.items() if k in allowed and k in PARAM_FIELDS}}
    try:
        return Params(**values)
    except TypeError as exc:
        raise ValueError(str(exc)) from exc


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "canal-navier-stokes"}


@app.get("/api/mesh")
def mesh():
    return ChannelFlowSolver(Params()).mesh()


@app.get("/api/cell-types")
def cell_types():
    return {str(k): v for k, v in TYPE_NAMES.items()}


@app.websocket("/ws/sim")
async def simulation_socket(ws: WebSocket):
    await ws.accept()
    params = Params()
    sim = ChannelFlowSolver(params)
    running = True
    inbox: asyncio.Queue = asyncio.Queue()

    def state() -> dict:
        # `running` travels with every state so the buttons of the browser always match the server.
        return {"type": "state", "data": {**sim.sample(), "running": running}}

    async def reader():
        # Messages are read concurrently with the iteration, so the pace of the animation does not
        # depend on polling the socket with timeouts (timer granularity is coarse on Windows).
        try:
            while True:
                await inbox.put(await ws.receive_text())
        except (WebSocketDisconnect, RuntimeError):
            await inbox.put(None)

    reader_task = asyncio.create_task(reader())
    await ws.send_json({"type": "mesh", "data": sim.mesh()})
    await ws.send_json(state())

    budget = 0.0                    # fractional iterations owed to the animation pace
    last = time.perf_counter()
    try:
        while True:
            while not inbox.empty():
                raw = inbox.get_nowait()
                if raw is None:
                    return
                try:
                    data = json.loads(raw)
                    kind = data.get("type")
                    if kind == "params":
                        params = merge_params(params, data.get("params", {}), LIVE_FIELDS)
                        sim.update_params(params)
                        if sim.diverged:
                            # A diverged state is not recoverable: restart from the initial guess.
                            sim = ChannelFlowSolver(params)
                            await ws.send_json({"type": "mesh", "data": sim.mesh()})
                    elif kind == "reset":
                        params = merge_params(params, data.get("params", {}), RESET_FIELDS)
                        sim = ChannelFlowSolver(params)
                        running = True
                        await ws.send_json({"type": "mesh", "data": sim.mesh()})
                    elif kind == "pause":
                        running = False
                    elif kind == "resume":
                        running = True
                    await ws.send_json(state())
                except ValueError as exc:
                    await ws.send_json({"type": "error", "message": str(exc)})

            now = time.perf_counter()
            if running and not (sim.converged or sim.diverged):
                budget += sim.p.sweeps_per_second * (now - last)
                n = min(int(budget), MAX_SWEEPS_PER_TICK)
                budget = min(budget - n, 1.0)
                for _ in range(n):
                    sim.sweep()
                    if sim.converged or sim.diverged:
                        break
                if n:
                    await ws.send_json(state())
            else:
                budget = 0.0
            last = now
            await asyncio.sleep(TICK)
    except WebSocketDisconnect:
        return
    finally:
        reader_task.cancel()
