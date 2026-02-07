import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env from monorepo root
root_env = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(root_env)

app = FastAPI(
    title="Temper API",
    description="Behavioral trading analysis backend",
    version="0.1.0",
)

# CORS from env
origins = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {"message": "Temper API", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


# ─── API Routes ───────────────────────────────────────────────
# These will be implemented to match your architecture:
#
# POST /api/upload         - Upload CSV, validate, store in Supabase
# POST /api/analyze        - Run analysis pipeline (sessions → behaviors → ELO)
# GET  /api/jobs/{id}      - Poll job status
# GET  /api/history        - Fetch user's Temper Score + ELO history
# GET  /api/sessions/{id}  - Fetch session details with report
# GET  /api/reports/{id}   - Fetch single TemperReport
#
# from app.routers import upload, analyze, jobs, history, sessions, reports
# app.include_router(upload.router, prefix="/api")
# app.include_router(analyze.router, prefix="/api")
# app.include_router(jobs.router, prefix="/api")
# app.include_router(history.router, prefix="/api")
# app.include_router(sessions.router, prefix="/api")
# app.include_router(reports.router, prefix="/api")
