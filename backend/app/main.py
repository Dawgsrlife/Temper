import asyncio
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.job_store import JobRecord, LocalJobStore, file_sha256, utc_now_iso

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
OUTPUTS_DIR = BACKEND_DIR / "outputs"
JUDGE_PACK_SCRIPT = BACKEND_DIR / "scripts" / "judge_pack.py"
LIST_JOBS_LIMIT_MAX = 200
COUNTERFACTUAL_PAGE_MAX = 2000
ALLOWED_EXECUTION_STATUS = {"PENDING", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"}
JOB_WORKERS = int(os.getenv("JOB_WORKERS", "1"))
JOB_SEMAPHORE = asyncio.Semaphore(max(1, JOB_WORKERS))
ACTIVE_TASKS: set[asyncio.Task[Any]] = set()

# Load .env from monorepo root
root_env = ROOT / ".env"
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


def _engine_version() -> str:
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
    except Exception:
        return "unknown"


def _store() -> LocalJobStore:
    return LocalJobStore(OUTPUTS_DIR)


def _job_dir(job_id: str) -> Path:
    return OUTPUTS_DIR / job_id


def _read_job(job_id: str) -> JobRecord | None:
    path = _job_dir(job_id) / "job.json"
    if not path.exists():
        return None
    return _store().read_path(path)


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except Exception:
        return None
    if parsed != parsed or parsed in (float("inf"), float("-inf")):
        return None
    return parsed


def _finished_at(job_id: str, status: str) -> str | None:
    if status not in {"COMPLETED", "FAILED", "TIMEOUT"}:
        return None
    path = _job_dir(job_id) / "job.json"
    if not path.exists():
        return None
    ts = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).replace(microsecond=0)
    return ts.isoformat()


def _job_payload(job: JobRecord | None, *, fallback_job_id: str | None = None) -> dict[str, Any]:
    if job is None:
        return {
            "job_id": fallback_job_id,
            "user_id": None,
            "created_at": None,
            "engine_version": None,
            "input_sha256": None,
            "execution_status": None,
        }

    execution_status = job.status if job.status in ALLOWED_EXECUTION_STATUS else None
    return {
        "job_id": job.job_id,
        "user_id": job.user_id,
        "created_at": job.created_at,
        "engine_version": job.engine_version,
        "input_sha256": job.input_sha256,
        "execution_status": execution_status,
    }


def _envelope(
    *,
    ok: bool,
    job: JobRecord | None,
    data: Any,
    job_override: dict[str, Any] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    error_details: dict[str, Any] | None = None,
    fallback_job_id: str | None = None,
    status_code: int = 200,
) -> JSONResponse:
    payload = {
        "ok": ok,
        "job": job_override if job_override is not None else _job_payload(job, fallback_job_id=fallback_job_id),
        "data": data,
        "error": None
        if ok
        else {
            "code": error_code or "UNKNOWN_ERROR",
            "message": error_message or "Unknown error",
            "details": error_details or {},
        },
    }
    return JSONResponse(status_code=status_code, content=_json_safe(payload))


def _json_safe(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_json_safe(v) for v in value]
    if isinstance(value, tuple):
        return [_json_safe(v) for v in value]
    if isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            return None
        return value
    return value


def _parse_bool(value: str | None, default: bool = True) -> bool:
    if value is None:
        return default
    lowered = value.strip().lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    return default


def _parse_multipart(
    body: bytes,
    content_type: str,
) -> tuple[bytes | None, dict[str, str]]:
    boundary_match = re.search(r'boundary="?([^";]+)"?', content_type)
    if not boundary_match:
        return None, {}

    boundary = boundary_match.group(1).encode("utf-8")
    marker = b"--" + boundary
    file_bytes: bytes | None = None
    fields: dict[str, str] = {}
    for raw_part in body.split(marker):
        part = raw_part.strip()
        if not part or part == b"--":
            continue
        if part.startswith(b"--"):
            part = part[2:]
        part = part.strip(b"\r\n")
        headers_blob, sep, content = part.partition(b"\r\n\r\n")
        if not sep:
            continue
        headers = headers_blob.decode("utf-8", errors="ignore").split("\r\n")
        disposition = next(
            (h for h in headers if h.lower().startswith("content-disposition:")),
            "",
        )
        name_match = re.search(r'name="([^"]+)"', disposition)
        if not name_match:
            continue
        field_name = name_match.group(1)
        filename_match = re.search(r'filename="([^"]*)"', disposition)

        cleaned_content = content
        if cleaned_content.endswith(b"\r\n"):
            cleaned_content = cleaned_content[:-2]

        if filename_match is not None and field_name == "file":
            file_bytes = cleaned_content
        elif filename_match is None:
            fields[field_name] = cleaned_content.decode("utf-8", errors="ignore")
    return file_bytes, fields


async def _extract_csv_and_fields(request: Request) -> tuple[bytes, dict[str, str]]:
    content_type = request.headers.get("content-type", "")
    body = await request.body()
    if not body:
        raise ValueError("empty request body")

    if "multipart/form-data" in content_type:
        file_bytes, fields = _parse_multipart(body, content_type)
        if file_bytes is None:
            raise ValueError("multipart payload missing file field")
        return file_bytes, fields

    # Backward-compatible raw CSV path.
    return body, {}


def _initial_job_record(
    job_id: str,
    *,
    user_id: str | None,
    input_sha256: str,
    status: str,
) -> JobRecord:
    return JobRecord(
        job_id=job_id,
        user_id=user_id,
        created_at=utc_now_iso(),
        engine_version=_engine_version(),
        input_sha256=input_sha256,
        status=status,
        artifacts={},
        summary={
            "outcome": None,
            "delta_pnl": None,
            "cost_of_bias": None,
            "error_type": None,
            "error_message": None,
            "badge_counts": {},
        },
    )


def _run_job_subprocess(
    *,
    job_id: str,
    input_path: Path,
    out_dir: Path,
    user_id: str | None,
    daily_max_loss: float | None,
    k_repeat: int,
    max_seconds: float,
) -> None:
    cmd = [
        sys.executable,
        str(JUDGE_PACK_SCRIPT),
        "--input",
        str(input_path),
        "--out_dir",
        str(out_dir),
        "--k_repeat",
        str(int(k_repeat)),
        "--max_seconds",
        str(float(max_seconds)),
    ]
    if user_id:
        cmd.extend(["--user_id", user_id])
    if daily_max_loss is not None:
        cmd.extend(["--daily_max_loss", str(float(daily_max_loss))])

    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        capture_output=True,
        text=True,
    )

    if (out_dir / "job.json").exists():
        return

    # Fallback if judge_pack failed before writing a terminal record.
    input_sha = file_sha256(input_path)
    error_message = proc.stderr.strip() or proc.stdout.strip() or "judge_pack failed"
    _store().write(
        JobRecord(
            job_id=job_id,
            user_id=user_id,
            created_at=utc_now_iso(),
            engine_version=_engine_version(),
            input_sha256=input_sha,
            status="FAILED",
            artifacts={
                "runtime_metrics.json": str(out_dir / "runtime_metrics.json"),
                "review.json": str(out_dir / "review.json"),
            },
            summary={
                "outcome": None,
                "delta_pnl": None,
                "cost_of_bias": None,
                "error_type": "SubprocessError",
                "error_message": error_message,
                "badge_counts": {},
            },
        ),
        job_dir=out_dir,
    )


async def _process_job(
    *,
    job_id: str,
    input_path: Path,
    out_dir: Path,
    user_id: str | None,
    daily_max_loss: float | None,
    k_repeat: int,
    max_seconds: float,
) -> None:
    async with JOB_SEMAPHORE:
        existing = _read_job(job_id)
        input_sha = file_sha256(input_path)
        if existing is None:
            running_record = _initial_job_record(
                job_id, user_id=user_id, input_sha256=input_sha, status="RUNNING"
            )
        else:
            running_record = JobRecord(
                job_id=existing.job_id,
                user_id=existing.user_id,
                created_at=existing.created_at,
                engine_version=existing.engine_version,
                input_sha256=existing.input_sha256,
                status="RUNNING",
                artifacts=existing.artifacts,
                summary=existing.summary,
            )
        _store().write(running_record, job_dir=out_dir)

        await asyncio.to_thread(
            _run_job_subprocess,
            job_id=job_id,
            input_path=input_path,
            out_dir=out_dir,
            user_id=user_id,
            daily_max_loss=daily_max_loss,
            k_repeat=k_repeat,
            max_seconds=max_seconds,
        )


def _schedule_job(**kwargs: Any) -> None:
    task = asyncio.create_task(_process_job(**kwargs))
    ACTIVE_TASKS.add(task)
    task.add_done_callback(lambda finished: ACTIVE_TASKS.discard(finished))


def _default_summary_data(job: JobRecord | None) -> dict[str, Any]:
    status = _job_payload(job)["execution_status"]
    return {
        "headline": None,
        "delta_pnl": None,
        "cost_of_bias": None,
        "bias_rates": {
            "revenge_rate": None,
            "overtrading_rate": None,
            "loss_aversion_rate": None,
            "any_bias_rate": None,
        },
        "badge_counts": {},
        "top_moments": [],
        "data_quality_warnings": [],
        "execution_status": status,
        "error_type": None,
        "error_message": None,
    }


def _default_review_data(job: JobRecord | None) -> dict[str, Any]:
    status = _job_payload(job)["execution_status"]
    return {
        "headline": None,
        "execution_status": status,
        "scoreboard": {
            "delta_pnl": None,
            "cost_of_bias": None,
            "blocked_bias_count": None,
            "blocked_risk_count": None,
        },
        "bias_rates": {},
        "derived_stats": {},
        "labeling_rules": {},
        "badge_counts": {},
        "badge_examples": {},
        "grade_distribution_by_phase": {},
        "opening": {},
        "middlegame": {},
        "endgame": {},
        "top_moments": [],
        "recommendations": [],
        "coach_plan": [],
        "data_quality_warnings": [],
        "error_type": None,
        "error_message": None,
    }


def _default_counterfactual_data(offset: int, limit: int) -> dict[str, Any]:
    return {
        "offset": offset,
        "limit": limit,
        "total_rows": None,
        "columns": [],
        "rows": [],
    }


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "Temper API", "status": "running"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "healthy"}


@app.post("/jobs")
async def create_job(
    request: Request,
    user_id: str | None = None,
    daily_max_loss: float | None = None,
    k_repeat: int = 1,
    max_seconds: float = 120.0,
    run_async: bool = True,
) -> JSONResponse:
    if k_repeat <= 0:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_REQUEST",
            error_message="k_repeat must be > 0",
            status_code=400,
        )
    if max_seconds <= 0:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_REQUEST",
            error_message="max_seconds must be > 0",
            status_code=400,
        )
    if daily_max_loss is not None and daily_max_loss <= 0:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_REQUEST",
            error_message="daily_max_loss must be > 0",
            status_code=400,
        )

    try:
        csv_bytes, fields = await _extract_csv_and_fields(request)
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_REQUEST",
            error_message=str(exc),
            status_code=400,
        )

    # Allow multipart form fields to override query args when provided.
    user_id_value = fields.get("user_id", user_id)
    daily_max_loss_value = daily_max_loss
    if "daily_max_loss" in fields and fields["daily_max_loss"].strip() != "":
        parsed = _safe_float(fields["daily_max_loss"])
        if parsed is None or parsed <= 0:
            return _envelope(
                ok=False,
                job=None,
                data=None,
                error_code="INVALID_REQUEST",
                error_message="daily_max_loss must be > 0",
                status_code=400,
            )
        daily_max_loss_value = parsed
    k_repeat_value = k_repeat
    if "k_repeat" in fields and fields["k_repeat"].strip() != "":
        try:
            k_repeat_value = int(fields["k_repeat"])
        except ValueError:
            return _envelope(
                ok=False,
                job=None,
                data=None,
                error_code="INVALID_REQUEST",
                error_message="k_repeat must be integer > 0",
                status_code=400,
            )
        if k_repeat_value <= 0:
            return _envelope(
                ok=False,
                job=None,
                data=None,
                error_code="INVALID_REQUEST",
                error_message="k_repeat must be > 0",
                status_code=400,
            )
    max_seconds_value = max_seconds
    if "max_seconds" in fields and fields["max_seconds"].strip() != "":
        parsed = _safe_float(fields["max_seconds"])
        if parsed is None or parsed <= 0:
            return _envelope(
                ok=False,
                job=None,
                data=None,
                error_code="INVALID_REQUEST",
                error_message="max_seconds must be > 0",
                status_code=400,
            )
        max_seconds_value = parsed
    run_async_value = _parse_bool(fields.get("run_async"), default=run_async)

    job_id = str(uuid4())
    out_dir = _job_dir(job_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    input_path = out_dir / "input.csv"
    input_path.write_bytes(csv_bytes)
    input_sha = file_sha256(input_path)

    pending_record = _initial_job_record(
        job_id,
        user_id=user_id_value,
        input_sha256=input_sha,
        status="PENDING",
    )
    _store().write(pending_record, job_dir=out_dir)

    # API contract: async by default; return immediately and poll.
    if not run_async_value:
        run_async_value = True
    if run_async_value:
        _schedule_job(
            job_id=job_id,
            input_path=input_path,
            out_dir=out_dir,
            user_id=user_id_value,
            daily_max_loss=daily_max_loss_value,
            k_repeat=k_repeat_value,
            max_seconds=max_seconds_value,
        )

    return _envelope(
        ok=True,
        job=pending_record,
        data={
            "status_url": f"/jobs/{job_id}",
            "summary_url": f"/jobs/{job_id}/summary",
            "review_url": f"/jobs/{job_id}/review",
            "counterfactual_url": f"/jobs/{job_id}/counterfactual",
            "message": "Job accepted.",
        },
        status_code=202,
    )


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> JSONResponse:
    job = _read_job(job_id)
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data=None,
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    status = _job_payload(job)["execution_status"]
    summary = job.summary or {}
    data = {
        "status": status,
        "finished_at": _finished_at(job_id, status or ""),
        "outcome": summary.get("outcome"),
        "delta_pnl": _safe_float(summary.get("delta_pnl")),
        "cost_of_bias": _safe_float(summary.get("cost_of_bias")),
        "error_type": summary.get("error_type"),
        "error_message": summary.get("error_message"),
        "artifacts": {
            "summary_url": f"/jobs/{job_id}/summary",
            "review_url": f"/jobs/{job_id}/review",
            "counterfactual_url": f"/jobs/{job_id}/counterfactual",
        },
    }
    return _envelope(ok=True, job=job, data=data)


@app.get("/users/{user_id}/jobs")
async def list_user_jobs(user_id: str, limit: int = 20) -> JSONResponse:
    if limit < 1 or limit > LIST_JOBS_LIMIT_MAX:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_LIMIT",
            error_message=f"limit must be between 1 and {LIST_JOBS_LIMIT_MAX}",
            status_code=400,
        )

    records = _store().list_jobs(user_id=user_id, limit=limit)
    jobs: list[dict[str, Any]] = []
    for record in records:
        status = record.status if record.status in ALLOWED_EXECUTION_STATUS else None
        jobs.append(
            {
                "job_id": record.job_id,
                "user_id": record.user_id,
                "created_at": record.created_at,
                "engine_version": record.engine_version,
                "input_sha256": record.input_sha256,
                "execution_status": status,
                "outcome": record.summary.get("outcome"),
                "delta_pnl": _safe_float(record.summary.get("delta_pnl")),
                "cost_of_bias": _safe_float(record.summary.get("cost_of_bias")),
            }
        )

    return _envelope(
        ok=True,
        job=None,
        job_override={
            "job_id": None,
            "user_id": user_id,
            "created_at": None,
            "engine_version": None,
            "input_sha256": None,
            "execution_status": None,
        },
        data={"count": len(jobs), "limit": limit, "jobs": jobs},
    )


@app.get("/jobs/{job_id}/summary")
async def get_summary(job_id: str) -> JSONResponse:
    job = _read_job(job_id)
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data=_default_summary_data(None),
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    data = _default_summary_data(job)
    status = _job_payload(job)["execution_status"]

    review_path = _job_dir(job_id) / "review.json"
    if review_path.exists():
        review = json.loads(review_path.read_text())
        top = []
        for item in review.get("top_moments", [])[:3]:
            top.append(
                {
                    "label": item.get("label"),
                    "timestamp": item.get("timestamp"),
                    "asset": item.get("asset"),
                    "pnl": _safe_float(item.get("actual_pnl")),
                    "simulated_pnl": _safe_float(item.get("simulated_pnl")),
                    "impact": _safe_float(item.get("impact")),
                    "blocked_reason": item.get("blocked_reason"),
                }
            )
        rates = review.get("bias_rates", {})
        data.update(
            {
                "headline": review.get("headline"),
                "delta_pnl": _safe_float(review.get("scoreboard", {}).get("delta_pnl")),
                "cost_of_bias": _safe_float(review.get("scoreboard", {}).get("cost_of_bias")),
                "bias_rates": {
                    "revenge_rate": _safe_float(rates.get("revenge_rate")),
                    "overtrading_rate": _safe_float(rates.get("overtrading_rate")),
                    "loss_aversion_rate": _safe_float(rates.get("loss_aversion_rate")),
                    "any_bias_rate": _safe_float(rates.get("any_bias_rate")),
                },
                "badge_counts": review.get("badge_counts", {}),
                "top_moments": top,
                "data_quality_warnings": review.get("data_quality_warnings", []),
                "execution_status": review.get("execution_status", status),
                "error_type": review.get("error_type"),
                "error_message": review.get("error_message"),
            }
        )
    else:
        data["execution_status"] = status
        data["error_type"] = job.summary.get("error_type")
        data["error_message"] = job.summary.get("error_message")

    return _envelope(ok=True, job=job, data=data)


@app.get("/jobs/{job_id}/review")
async def get_review(job_id: str) -> JSONResponse:
    job = _read_job(job_id)
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"review": _default_review_data(None)},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    review_path = _job_dir(job_id) / "review.json"
    review = _default_review_data(job)
    if review_path.exists():
        persisted = json.loads(review_path.read_text())
        review.update(persisted)
        review["execution_status"] = persisted.get(
            "execution_status", _job_payload(job)["execution_status"]
        )
        review.setdefault("error_type", None)
        review.setdefault("error_message", None)
    else:
        review["error_type"] = job.summary.get("error_type")
        review["error_message"] = job.summary.get("error_message")

    return _envelope(ok=True, job=job, data={"review": review})


@app.get("/jobs/{job_id}/counterfactual")
async def get_counterfactual(job_id: str, offset: int = 0, limit: int = 500) -> JSONResponse:
    if offset < 0:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data=_default_counterfactual_data(offset=offset, limit=limit),
            error_code="INVALID_OFFSET",
            error_message="offset must be >= 0",
            status_code=400,
        )
    if limit < 1 or limit > COUNTERFACTUAL_PAGE_MAX:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data=_default_counterfactual_data(offset=offset, limit=limit),
            error_code="INVALID_LIMIT",
            error_message=f"limit must be between 1 and {COUNTERFACTUAL_PAGE_MAX}",
            status_code=400,
        )

    job = _read_job(job_id)
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data=_default_counterfactual_data(offset=offset, limit=limit),
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    path = _job_dir(job_id) / "counterfactual.csv"
    if not path.exists():
        return _envelope(
            ok=False,
            job=job,
            data=_default_counterfactual_data(offset=offset, limit=limit),
            error_code="COUNTERFACTUAL_NOT_READY",
            error_message="Counterfactual rows are not available yet.",
            status_code=409,
        )

    df = pd.read_csv(path)
    total_rows = int(len(df))
    window = df.iloc[offset : offset + limit].copy()
    window = window.where(pd.notna(window), None)

    data = {
        "offset": offset,
        "limit": limit,
        "total_rows": total_rows,
        "columns": [str(col) for col in df.columns],
        "rows": window.to_dict(orient="records"),
    }
    return _envelope(ok=True, job=job, data=data)
