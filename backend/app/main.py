from dataclasses import asdict
import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from .model import Params, ShallowWaterSimulation, FLOORS

app = FastAPI(title="Simulación Canal de Agua - SCN")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "canal-agua"}


@app.get("/api/floors")
def floors():
    return FLOORS


@app.websocket("/ws/sim")
async def simulation_socket(ws: WebSocket):
    await ws.accept()
    params = Params()
    sim = ShallowWaterSimulation(params)
    running = True

    await ws.send_json({"type": "state", "data": sim.sample(max_nx=params.nx, max_ny=params.ny)})

    try:
        while True:
            # Wait briefly for control messages without blocking the simulation.
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=0.01)
                data = json.loads(msg)

                if data.get("type") == "params":
                    incoming = data.get("params", {})
                    params = Params(**{**asdict(params), **incoming})
                    sim.update_params(params)

                elif data.get("type") == "reset":
                    params = Params(**data.get("params", asdict(params)))
                    sim = ShallowWaterSimulation(params)

                elif data.get("type") == "pause":
                    running = False

                elif data.get("type") == "resume":
                    running = True

            except asyncio.TimeoutError:
                pass

            if running:
                dt = sim.step()
                # Full numerical resolution (no downsampling): the grid is
                # small enough (nx*ny <= a few thousand cells) that sending
                # it raw keeps the browser's surface mesh faithful to the
                # solver instead of losing detail to stride-based sampling.
                await ws.send_json({"type": "state", "data": sim.sample(max_nx=params.nx, max_ny=params.ny)})
                await asyncio.sleep(0.03)
            else:
                await asyncio.sleep(0.05)

    except WebSocketDisconnect:
        return
