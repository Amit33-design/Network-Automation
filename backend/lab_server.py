"""
Standalone lab simulation server — no database, no Redis, no Vault required.
Serves all endpoints needed by the wizard Steps 1-6 for local testing.

Usage:
    cd backend
    python lab_server.py          # starts on :8000
    python lab_server.py --port 9000
"""
from __future__ import annotations

import argparse
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.lab import router as lab_router

app = FastAPI(
    title="NetDesign AI — Lab Server",
    description="Simulation backend for wizard Steps 4–6. No real devices required.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(lab_router)


@app.get("/health")
def health():
    return {"status": "ok", "server": "lab"}


@app.get("/")
def root():
    return {
        "server": "NetDesign AI Lab Server",
        "docs":   "/docs",
        "health": "/health",
        "endpoints": [
            "GET  /api/topology",
            "GET  /api/topology/devices",
            "POST /api/ztp/run",
            "POST /api/checks/pre",
            "POST /api/checks/post",
            "GET  /api/monitoring/poll",
            "POST /api/monitoring/poll",
            "GET  /api/alerts",
            "POST /api/rca/analyze",
        ],
    }


if __name__ == "__main__":
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    uvicorn.run(
        "lab_server:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
        log_level="info",
    )
