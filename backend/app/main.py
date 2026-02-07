import asyncio
import hmac
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest, urlopen
from uuid import uuid4

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.job_store import JobRecord, LocalJobStore, file_sha256, utc_now_iso
from app.supabase_jobs import SupabaseJobRepository, SupabaseSyncError

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
OUTPUTS_DIR = BACKEND_DIR / "outputs"
JUDGE_PACK_SCRIPT = BACKEND_DIR / "scripts" / "judge_pack.py"
LIST_JOBS_LIMIT_MAX = 200
COUNTERFACTUAL_PAGE_MAX = 2000
MAX_UPLOAD_MB_DEFAULT = 25
UPLOADTHING_FILE_BASE_URL = os.getenv("UPLOADTHING_FILE_BASE_URL", "https://utfs.io/f")
UPLOADTHING_SIGNATURE_HEADER = "x-uploadthing-signature"
COACH_JSON_NAME = "coach.json"
COACH_ERROR_JSON_NAME = "coach_error.json"
COACH_VERTEX_TIMEOUT_SECONDS_DEFAULT = 18.0
COACH_VERTEX_MAX_OUTPUT_TOKENS_DEFAULT = 900
COACH_ALLOWED_BIASES = {"OVERTRADING", "LOSS_AVERSION", "REVENGE_TRADING"}
COACH_ALLOWED_HORIZONS = {"NEXT_SESSION", "THIS_WEEK"}
ALLOWED_EXECUTION_STATUS = {"PENDING", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"}
JOB_WORKERS = int(os.getenv("JOB_WORKERS", "1"))
JOB_SEMAPHORE = asyncio.Semaphore(max(1, JOB_WORKERS))
ACTIVE_TASKS: set[asyncio.Task[Any]] = set()
_SUPABASE_STORE: SupabaseJobRepository | None = None

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


def _supabase_store() -> SupabaseJobRepository:
    global _SUPABASE_STORE
    if _SUPABASE_STORE is None:
        _SUPABASE_STORE = SupabaseJobRepository()
    return _SUPABASE_STORE


def _job_dir(job_id: str) -> Path:
    return OUTPUTS_DIR / job_id


def _read_job(job_id: str) -> JobRecord | None:
    path = _job_dir(job_id) / "job.json"
    if not path.exists():
        return None
    try:
        return _store().read_path(path)
    except Exception as exc:
        raise CorruptJobRecordError(
            job_id=job_id,
            path=path,
            cause=exc,
        ) from exc


class CorruptJobRecordError(Exception):
    def __init__(self, *, job_id: str | None, path: Path, cause: Exception) -> None:
        super().__init__(f"Corrupt job record at {path}: {cause}")
        self.job_id = job_id
        self.path = path
        self.cause = cause


def _corrupt_job_response(
    *,
    job_id: str | None,
    user_id: str | None = None,
    data: Any,
    path: Path,
    cause: Exception,
) -> JSONResponse:
    return _envelope(
        ok=False,
        job=None,
        job_override={
            "job_id": job_id,
            "user_id": user_id,
            "created_at": None,
            "engine_version": None,
            "input_sha256": None,
            "execution_status": None,
            "upload": None,
        },
        data=data,
        error_code="CORRUPT_JOB_RECORD",
        error_message="Job record is corrupt or unreadable.",
        error_details={
            "job_id": job_id,
            "path": str(path),
            "parse_error": str(cause),
        },
        status_code=422,
    )


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


def _read_bias_rates(job_id: str) -> dict[str, Any] | None:
    review_path = _job_dir(job_id) / "review.json"
    if not review_path.exists():
        return None
    try:
        payload = json.loads(review_path.read_text())
    except Exception:
        return None
    rates = payload.get("bias_rates")
    return dict(rates) if isinstance(rates, dict) else None


def _supabase_job_row(
    job: JobRecord,
    *,
    bias_rates: dict[str, Any] | None = None,
) -> dict[str, Any]:
    summary = dict(job.summary or {})
    upload = dict(job.upload) if isinstance(job.upload, dict) else {}
    row = {
        "id": job.job_id,
        "user_id": job.user_id,
        "created_at": job.created_at,
        "status": job.status,
        "engine_version": job.engine_version,
        "input_sha256": job.input_sha256,
        "outcome": summary.get("outcome"),
        "delta_pnl": _safe_float(summary.get("delta_pnl")),
        "cost_of_bias": _safe_float(summary.get("cost_of_bias")),
        "badge_counts": summary.get("badge_counts", {}),
        "bias_rates": bias_rates or {},
        "error_type": summary.get("error_type"),
        "error_message": summary.get("error_message"),
        "coach_status": summary.get("coach_status"),
        "coach_error_type": summary.get("coach_error_type"),
        "coach_error_message": summary.get("coach_error_message"),
        "upload_source": upload.get("source"),
        "uploadthing_file_key": upload.get("file_key"),
        "original_filename": upload.get("original_filename"),
        "byte_size": upload.get("byte_size"),
    }
    return row


def _sync_job_to_supabase(
    job: JobRecord,
    *,
    include_artifacts: bool = False,
    strict: bool = False,
) -> None:
    try:
        bias_rates = _read_bias_rates(job.job_id) if include_artifacts else None
        _supabase_store().upsert_job(_supabase_job_row(job, bias_rates=bias_rates))
        if include_artifacts:
            _supabase_store().replace_job_artifacts(job.job_id, dict(job.artifacts))
    except SupabaseSyncError:
        if strict:
            raise


def _supabase_unavailable_response(*, user_id: str | None, message: str) -> JSONResponse:
    return _envelope(
        ok=False,
        job=None,
        job_override={
            "job_id": None,
            "user_id": user_id,
            "created_at": None,
            "engine_version": None,
            "input_sha256": None,
            "execution_status": None,
            "upload": None,
        },
        data=None,
        error_code="SUPABASE_UNAVAILABLE",
        error_message=message,
        status_code=503,
    )


def _coach_paths(job_id: str) -> tuple[Path, Path]:
    job_dir = _job_dir(job_id)
    return job_dir / COACH_JSON_NAME, job_dir / COACH_ERROR_JSON_NAME


def _load_json_file(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return dict(payload)


def _persist_job_record(job: JobRecord, *, include_artifacts_sync: bool = False) -> None:
    _store().write(job, job_dir=_job_dir(job.job_id))
    _sync_job_to_supabase(job, include_artifacts=include_artifacts_sync, strict=False)


def _coach_prompt_payload(job: JobRecord) -> dict[str, Any]:
    review_path = _job_dir(job.job_id) / "review.json"
    review: dict[str, Any] = {}
    if review_path.exists():
        try:
            review = _load_json_file(review_path)
        except Exception:
            review = {}

    summary = dict(job.summary or {})
    score = review.get("scoreboard", {}) if isinstance(review.get("scoreboard"), dict) else {}
    bias_rates = review.get("bias_rates", {}) if isinstance(review.get("bias_rates"), dict) else {}
    badge_counts = review.get("badge_counts", {}) if isinstance(review.get("badge_counts"), dict) else {}

    return {
        "job_id": job.job_id,
        "user_id": job.user_id,
        "status": job.status,
        "outcome": summary.get("outcome"),
        "delta_pnl": _safe_float(summary.get("delta_pnl") or score.get("delta_pnl")),
        "cost_of_bias": _safe_float(summary.get("cost_of_bias") or score.get("cost_of_bias")),
        "bias_rates": bias_rates,
        "badge_counts": badge_counts,
        "top_moments": review.get("top_moments", [])[:3] if isinstance(review.get("top_moments"), list) else [],
        "recommendations": review.get("recommendations", [])[:6] if isinstance(review.get("recommendations"), list) else [],
    }


class CoachGenerationError(Exception):
    def __init__(self, message: str, *, vertex_request_id: str | None = None) -> None:
        super().__init__(message)
        self.vertex_request_id = vertex_request_id


def _vertex_access_token() -> str:
    direct = os.getenv("VERTEX_ACCESS_TOKEN", "").strip()
    if direct:
        return direct

    try:
        import google.auth  # type: ignore
        from google.auth.transport.requests import Request  # type: ignore
    except Exception as exc:
        raise CoachGenerationError(
            "vertex auth unavailable; set VERTEX_ACCESS_TOKEN or google auth credentials"
        ) from exc

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not creds.valid:
        creds.refresh(Request())
    if not creds.token:
        raise CoachGenerationError("failed to obtain vertex access token")
    return str(creds.token)


def _vertex_endpoint() -> str:
    project = (
        os.getenv("VERTEX_PROJECT_ID")
        or os.getenv("GOOGLE_CLOUD_PROJECT")
        or os.getenv("GCP_PROJECT")
        or ""
    ).strip()
    if not project:
        raise CoachGenerationError("missing VERTEX_PROJECT_ID (or GOOGLE_CLOUD_PROJECT)")

    location = (os.getenv("VERTEX_LOCATION", "us-central1") or "us-central1").strip()
    model = (os.getenv("VERTEX_MODEL", "gemini-1.5-flash-002") or "gemini-1.5-flash-002").strip()
    return (
        f"https://{location}-aiplatform.googleapis.com/v1/projects/{project}/"
        f"locations/{location}/publishers/google/models/{model}:generateContent"
    )


def _coach_vertex_timeout_seconds() -> float:
    raw = os.getenv("COACH_VERTEX_TIMEOUT_SECONDS", str(COACH_VERTEX_TIMEOUT_SECONDS_DEFAULT))
    try:
        timeout = float(raw)
    except ValueError:
        timeout = COACH_VERTEX_TIMEOUT_SECONDS_DEFAULT
    return max(5.0, timeout)


def _coach_vertex_max_output_tokens() -> int:
    raw = os.getenv("COACH_VERTEX_MAX_OUTPUT_TOKENS", str(COACH_VERTEX_MAX_OUTPUT_TOKENS_DEFAULT))
    try:
        tokens = int(raw)
    except ValueError:
        tokens = COACH_VERTEX_MAX_OUTPUT_TOKENS_DEFAULT
    return max(200, min(tokens, 2048))


def _extract_vertex_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise CoachGenerationError("vertex response missing candidates")
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        content = candidate.get("content")
        if not isinstance(content, dict):
            continue
        parts = content.get("parts")
        if not isinstance(parts, list):
            continue
        for part in parts:
            if not isinstance(part, dict):
                continue
            text = part.get("text")
            if isinstance(text, str) and text.strip():
                return text
    raise CoachGenerationError("vertex response did not contain text output")


def _extract_json_from_text(text: str) -> dict[str, Any]:
    raw = text.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*", "", raw)
        raw = re.sub(r"\s*```$", "", raw)
    try:
        payload = json.loads(raw)
    except Exception:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end < start:
            raise CoachGenerationError("vertex output did not contain valid JSON")
        payload = json.loads(raw[start : end + 1])
    if not isinstance(payload, dict):
        raise CoachGenerationError("vertex output JSON must be an object")
    return dict(payload)


def _validate_coach_schema(payload: dict[str, Any]) -> dict[str, Any]:
    required = {"version", "headline", "diagnosis", "plan", "do_next_session", "disclaimer"}
    missing = required - set(payload.keys())
    if missing:
        raise CoachGenerationError(f"coach JSON missing required keys: {sorted(missing)}")

    version = payload.get("version")
    if version != 1:
        raise CoachGenerationError("coach version must be 1")

    headline = payload.get("headline")
    disclaimer = payload.get("disclaimer")
    if not isinstance(headline, str) or not headline.strip():
        raise CoachGenerationError("coach headline must be non-empty string")
    if not isinstance(disclaimer, str) or not disclaimer.strip():
        raise CoachGenerationError("coach disclaimer must be non-empty string")

    diagnosis = payload.get("diagnosis")
    if not isinstance(diagnosis, list):
        raise CoachGenerationError("coach diagnosis must be a list")
    normalized_diagnosis: list[dict[str, Any]] = []
    for item in diagnosis:
        if not isinstance(item, dict):
            raise CoachGenerationError("each diagnosis item must be an object")
        bias = item.get("bias")
        severity = item.get("severity")
        evidence = item.get("evidence")
        metric_refs = item.get("metric_refs")
        if bias not in COACH_ALLOWED_BIASES:
            raise CoachGenerationError("diagnosis bias must be one of OVERTRADING|LOSS_AVERSION|REVENGE_TRADING")
        if not isinstance(severity, int) or isinstance(severity, bool) or severity < 1 or severity > 5:
            raise CoachGenerationError("diagnosis severity must be int in [1,5]")
        if not isinstance(evidence, list) or not evidence:
            raise CoachGenerationError("diagnosis evidence must be a non-empty list")
        evidence_clean: list[str] = []
        for entry in evidence:
            if not isinstance(entry, str) or not entry.strip():
                raise CoachGenerationError("evidence entries must be non-empty strings")
            if not any(ch.isdigit() for ch in entry):
                raise CoachGenerationError("evidence must reference numeric metrics")
            evidence_clean.append(entry.strip())
        if not isinstance(metric_refs, list) or not metric_refs:
            raise CoachGenerationError("diagnosis metric_refs must be a non-empty list")
        refs_clean: list[dict[str, Any]] = []
        for ref in metric_refs:
            if not isinstance(ref, dict):
                raise CoachGenerationError("metric_refs entries must be objects")
            name = ref.get("name")
            unit = ref.get("unit")
            value = ref.get("value")
            if not isinstance(name, str) or not name.strip():
                raise CoachGenerationError("metric_refs.name must be non-empty string")
            if not isinstance(unit, str) or not unit.strip():
                raise CoachGenerationError("metric_refs.unit must be non-empty string")
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(float(value)):
                raise CoachGenerationError("metric_refs.value must be finite number")
            refs_clean.append(
                {
                    "name": name.strip(),
                    "value": float(value),
                    "unit": unit.strip(),
                }
            )
        normalized_diagnosis.append(
            {
                "bias": bias,
                "severity": severity,
                "evidence": evidence_clean,
                "metric_refs": refs_clean,
            }
        )

    plan = payload.get("plan")
    if not isinstance(plan, list) or not plan:
        raise CoachGenerationError("coach plan must be a non-empty list")
    normalized_plan: list[dict[str, Any]] = []
    for item in plan:
        if not isinstance(item, dict):
            raise CoachGenerationError("plan entries must be objects")
        title = item.get("title")
        steps = item.get("steps")
        horizon = item.get("time_horizon")
        if not isinstance(title, str) or not title.strip():
            raise CoachGenerationError("plan.title must be non-empty string")
        if not isinstance(steps, list) or not steps:
            raise CoachGenerationError("plan.steps must be non-empty list")
        steps_clean: list[str] = []
        for step in steps:
            if not isinstance(step, str) or not step.strip():
                raise CoachGenerationError("plan.steps entries must be non-empty strings")
            steps_clean.append(step.strip())
        if horizon not in COACH_ALLOWED_HORIZONS:
            raise CoachGenerationError("plan.time_horizon must be NEXT_SESSION or THIS_WEEK")
        normalized_plan.append(
            {
                "title": title.strip(),
                "steps": steps_clean,
                "time_horizon": horizon,
            }
        )

    do_next_session = payload.get("do_next_session")
    if not isinstance(do_next_session, list) or not do_next_session:
        raise CoachGenerationError("do_next_session must be a non-empty list")
    next_steps: list[str] = []
    for entry in do_next_session:
        if not isinstance(entry, str) or not entry.strip():
            raise CoachGenerationError("do_next_session entries must be non-empty strings")
        next_steps.append(entry.strip())

    return {
        "version": 1,
        "headline": headline.strip(),
        "diagnosis": normalized_diagnosis,
        "plan": normalized_plan,
        "do_next_session": next_steps,
        "disclaimer": disclaimer.strip(),
    }


def generate_coach_via_vertex(payload: dict[str, Any]) -> dict[str, Any]:
    endpoint = _vertex_endpoint()
    token = _vertex_access_token()
    timeout = _coach_vertex_timeout_seconds()
    max_tokens = _coach_vertex_max_output_tokens()
    prompt = (
        "You are a trading discipline coach. Use ONLY the provided metrics and facts. "
        "Do not invent numbers. Return JSON only with keys: "
        "version,headline,diagnosis,plan,do_next_session,disclaimer. "
        "bias values must be OVERTRADING|LOSS_AVERSION|REVENGE_TRADING. "
        "severity must be 1-5 integer. time_horizon must be NEXT_SESSION or THIS_WEEK.\n\n"
        f"FACTS_JSON:\n{json.dumps(payload, sort_keys=True)}"
    )
    request_payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": max_tokens,
        },
    }

    request_bytes = json.dumps(request_payload).encode("utf-8")
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            request = URLRequest(
                endpoint,
                data=request_bytes,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                method="POST",
            )
            with urlopen(request, timeout=timeout) as response:
                response_body = response.read().decode("utf-8", errors="replace")
                request_id = response.headers.get("x-request-id")
            parsed = json.loads(response_body)
            if not isinstance(parsed, dict):
                raise CoachGenerationError("vertex returned non-object response", vertex_request_id=request_id)
            text = _extract_vertex_text(parsed)
            result = _extract_json_from_text(text)
            return result
        except HTTPError as exc:
            last_error = exc
            if exc.code >= 500 or exc.code == 429:
                if attempt == 0:
                    continue
            raise CoachGenerationError(f"vertex http error {exc.code}: {exc.reason}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise CoachGenerationError(f"vertex network error: {exc}") from exc
        except CoachGenerationError:
            raise
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise CoachGenerationError(f"vertex generation failed: {exc}") from exc
    raise CoachGenerationError(f"vertex generation failed: {last_error}")


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
            "upload": None,
        }

    execution_status = job.status if job.status in ALLOWED_EXECUTION_STATUS else None
    return {
        "job_id": job.job_id,
        "user_id": job.user_id,
        "created_at": job.created_at,
        "engine_version": job.engine_version,
        "input_sha256": job.input_sha256,
        "execution_status": execution_status,
        "upload": dict(job.upload) if isinstance(job.upload, dict) else None,
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


def _coerce_bool(value: Any, default: bool = True) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return _parse_bool(str(value), default=default)


class UploadthingDownloadError(Exception):
    pass


class UploadthingPayloadTooLargeError(UploadthingDownloadError):
    pass


def _max_upload_bytes() -> int:
    raw = os.getenv("MAX_UPLOAD_MB", str(MAX_UPLOAD_MB_DEFAULT))
    try:
        mb = int(raw)
    except ValueError:
        mb = MAX_UPLOAD_MB_DEFAULT
    return max(1, mb) * 1024 * 1024


def _uploadthing_url(file_key: str) -> str:
    base = UPLOADTHING_FILE_BASE_URL.rstrip("/")
    return f"{base}/{file_key}"


def _uploadthing_signature_payload(
    *,
    user_id: str,
    file_key: str,
    original_filename: str | None,
) -> bytes:
    return f"{user_id}:{file_key}:{original_filename or ''}".encode("utf-8")


def _verify_uploadthing_signature(
    *,
    signature: str | None,
    user_id: str,
    file_key: str,
    original_filename: str | None,
) -> bool:
    secret = os.getenv("UPLOADTHING_SECRET", "")
    if not secret or not signature:
        return False

    provided = signature.strip()
    if provided.lower().startswith("sha256="):
        provided = provided.split("=", 1)[1]

    expected = hmac.new(
        secret.encode("utf-8"),
        _uploadthing_signature_payload(
            user_id=user_id,
            file_key=file_key,
            original_filename=original_filename,
        ),
        sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, provided)


def _download_uploadthing_bytes(file_key: str) -> bytes:
    url = _uploadthing_url(file_key)
    limit = _max_upload_bytes()
    try:
        with urlopen(url, timeout=20) as response:
            chunks: list[bytes] = []
            size = 0
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > limit:
                    raise UploadthingPayloadTooLargeError(
                        f"upload exceeds max size ({limit} bytes)"
                    )
                chunks.append(chunk)
    except UploadthingPayloadTooLargeError:
        raise
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        raise UploadthingDownloadError(f"failed downloading uploadthing file: {exc}") from exc

    if not chunks:
        raise UploadthingDownloadError("uploadthing file is empty")
    return b"".join(chunks)


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
    upload: dict[str, Any] | None = None,
) -> JobRecord:
    return JobRecord(
        job_id=job_id,
        user_id=user_id,
        created_at=utc_now_iso(),
        engine_version=_engine_version(),
        input_sha256=input_sha256,
        status=status,
        artifacts={},
        upload=dict(upload) if isinstance(upload, dict) else None,
        summary={
            "outcome": None,
            "delta_pnl": None,
            "cost_of_bias": None,
            "error_type": None,
            "error_message": None,
            "coach_status": None,
            "coach_error_type": None,
            "coach_error_message": None,
            "badge_counts": {},
        },
    )


def _run_job_subprocess(
    *,
    job_id: str,
    input_path: Path,
    out_dir: Path,
    user_id: str | None,
    upload: dict[str, Any] | None,
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
            upload=dict(upload) if isinstance(upload, dict) else None,
            summary={
                "outcome": None,
                "delta_pnl": None,
                "cost_of_bias": None,
                "error_type": "SubprocessError",
                "error_message": error_message,
                "coach_status": None,
                "coach_error_type": None,
                "coach_error_message": None,
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
    upload: dict[str, Any] | None = None,
    daily_max_loss: float | None,
    k_repeat: int,
    max_seconds: float,
) -> None:
    async with JOB_SEMAPHORE:
        existing = _read_job(job_id)
        input_sha = file_sha256(input_path)
        if existing is None:
            running_record = _initial_job_record(
                job_id,
                user_id=user_id,
                input_sha256=input_sha,
                status="RUNNING",
                upload=upload,
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
                upload=existing.upload,
                summary=existing.summary,
            )
        _store().write(running_record, job_dir=out_dir)
        _sync_job_to_supabase(running_record, strict=False)

        await asyncio.to_thread(
            _run_job_subprocess,
            job_id=job_id,
            input_path=input_path,
            out_dir=out_dir,
            user_id=user_id,
            upload=upload,
            daily_max_loss=daily_max_loss,
            k_repeat=k_repeat,
            max_seconds=max_seconds,
        )
        try:
            terminal_record = _read_job(job_id)
        except CorruptJobRecordError:
            terminal_record = None
        if terminal_record is not None:
            _sync_job_to_supabase(
                terminal_record,
                include_artifacts=True,
                strict=False,
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


async def _optional_json_body(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    body = await request.body()
    if not body:
        return {}
    if "application/json" not in content_type:
        return {}
    try:
        payload = json.loads(body.decode("utf-8", errors="replace"))
    except Exception as exc:
        raise ValueError("invalid JSON body") from exc
    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object")
    return payload


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
    _sync_job_to_supabase(pending_record, strict=False)

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
    else:
        await _process_job(
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


@app.post("/jobs/from-uploadthing")
async def create_job_from_uploadthing(
    request: Request,
    user_id: str | None = None,
    file_key: str | None = None,
    original_filename: str | None = None,
    run_async: bool = True,
    daily_max_loss: float | None = None,
    k_repeat: int = 1,
    max_seconds: float = 120.0,
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
        payload = await _optional_json_body(request)
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_REQUEST",
            error_message=str(exc),
            status_code=400,
        )

    user_id_value = user_id if user_id is not None else payload.get("user_id")
    file_key_value = file_key if file_key is not None else (
        payload.get("file_key") or payload.get("uploadthing_file_key")
    )
    filename_value = (
        original_filename
        if original_filename is not None
        else payload.get("original_filename")
    )
    run_async_value = (
        _coerce_bool(payload.get("run_async"), default=run_async)
        if "run_async" in payload
        else run_async
    )

    if isinstance(user_id_value, str):
        user_id_value = user_id_value.strip()
    if isinstance(file_key_value, str):
        file_key_value = file_key_value.strip()
    if isinstance(filename_value, str):
        filename_value = filename_value.strip() or None

    if not user_id_value:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_REQUEST",
            error_message="user_id is required",
            status_code=400,
        )
    if not file_key_value:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_REQUEST",
            error_message="file_key is required",
            status_code=400,
        )

    signature = request.headers.get(UPLOADTHING_SIGNATURE_HEADER)
    if not _verify_uploadthing_signature(
        signature=signature,
        user_id=str(user_id_value),
        file_key=str(file_key_value),
        original_filename=filename_value if isinstance(filename_value, str) else None,
    ):
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="INVALID_UPLOADTHING_SIGNATURE",
            error_message="Uploadthing signature verification failed.",
            error_details={"header": UPLOADTHING_SIGNATURE_HEADER},
            status_code=401,
        )

    try:
        csv_bytes = await asyncio.to_thread(_download_uploadthing_bytes, str(file_key_value))
    except UploadthingPayloadTooLargeError:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="PAYLOAD_TOO_LARGE",
            error_message=f"Upload exceeds MAX_UPLOAD_MB={_max_upload_bytes() // (1024 * 1024)}",
            status_code=413,
        )
    except UploadthingDownloadError as exc:
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="UPLOADTHING_DOWNLOAD_FAILED",
            error_message=str(exc),
            status_code=502,
        )

    if len(csv_bytes) > _max_upload_bytes():
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="PAYLOAD_TOO_LARGE",
            error_message=f"Upload exceeds MAX_UPLOAD_MB={_max_upload_bytes() // (1024 * 1024)}",
            status_code=413,
        )

    input_sha = sha256(csv_bytes).hexdigest()
    upload_metadata = {
        "source": "uploadthing",
        "file_key": str(file_key_value),
        "original_filename": filename_value,
        "byte_size": len(csv_bytes),
        "input_sha256": input_sha,
    }

    job_id = str(uuid4())
    out_dir = _job_dir(job_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    input_path = out_dir / "input.csv"
    input_path.write_bytes(csv_bytes)

    pending_record = _initial_job_record(
        job_id,
        user_id=str(user_id_value),
        input_sha256=input_sha,
        status="PENDING",
        upload=upload_metadata,
    )
    _store().write(pending_record, job_dir=out_dir)
    try:
        _sync_job_to_supabase(pending_record, strict=True)
    except SupabaseSyncError as exc:
        return _supabase_unavailable_response(
            user_id=str(user_id_value),
            message=str(exc),
        )

    if run_async_value:
        _schedule_job(
            job_id=job_id,
            input_path=input_path,
            out_dir=out_dir,
            user_id=str(user_id_value),
            upload=upload_metadata,
            daily_max_loss=daily_max_loss,
            k_repeat=k_repeat,
            max_seconds=max_seconds,
        )
    else:
        await _process_job(
            job_id=job_id,
            input_path=input_path,
            out_dir=out_dir,
            user_id=str(user_id_value),
            upload=upload_metadata,
            daily_max_loss=daily_max_loss,
            k_repeat=k_repeat,
            max_seconds=max_seconds,
        )

    return _envelope(
        ok=True,
        job=pending_record,
        data={
            "status_url": f"/jobs/{job_id}",
            "summary_url": f"/jobs/{job_id}/summary",
            "review_url": f"/jobs/{job_id}/review",
            "counterfactual_url": f"/jobs/{job_id}/counterfactual",
            "message": "Uploadthing job accepted.",
        },
        status_code=202,
    )


@app.get("/jobs/{job_id}")
async def get_job(job_id: str) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data=None,
            path=exc.path,
            cause=exc.cause,
        )
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
    if status in {"COMPLETED", "FAILED", "TIMEOUT"}:
        _sync_job_to_supabase(job, include_artifacts=True, strict=False)
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

    try:
        rows = _supabase_store().list_jobs_for_user(user_id=user_id, limit=limit)
    except SupabaseSyncError as exc:
        return _supabase_unavailable_response(user_id=user_id, message=str(exc))

    jobs: list[dict[str, Any]] = []
    for row in rows:
        status_value = row.get("status")
        status = status_value if status_value in ALLOWED_EXECUTION_STATUS else None
        badge_counts = row.get("badge_counts")
        bias_rates = row.get("bias_rates")
        upload = {
            "source": row.get("upload_source"),
            "file_key": row.get("uploadthing_file_key"),
            "original_filename": row.get("original_filename"),
            "byte_size": row.get("byte_size"),
            "input_sha256": row.get("input_sha256"),
        }
        if upload["source"] is None:
            upload = None
        jobs.append(
            {
                "job_id": row.get("id"),
                "user_id": row.get("user_id"),
                "created_at": row.get("created_at"),
                "engine_version": row.get("engine_version"),
                "input_sha256": row.get("input_sha256"),
                "execution_status": status,
                "outcome": row.get("outcome"),
                "delta_pnl": _safe_float(row.get("delta_pnl")),
                "cost_of_bias": _safe_float(row.get("cost_of_bias")),
                "badge_counts": badge_counts if isinstance(badge_counts, dict) else {},
                "bias_rates": bias_rates if isinstance(bias_rates, dict) else {},
                "error_type": row.get("error_type"),
                "error_message": row.get("error_message"),
                "coach_status": row.get("coach_status"),
                "coach_error_type": row.get("coach_error_type"),
                "coach_error_message": row.get("coach_error_message"),
                "upload": upload,
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
            "upload": None,
        },
        data={"count": len(jobs), "limit": limit, "jobs": jobs},
    )


@app.get("/jobs/{job_id}/summary")
async def get_summary(job_id: str) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data=_default_summary_data(None),
            path=exc.path,
            cause=exc.cause,
        )
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
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"review": _default_review_data(None)},
            path=exc.path,
            cause=exc.cause,
        )
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


@app.post("/jobs/{job_id}/coach")
async def generate_coach(job_id: str, force: bool = False) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"coach": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"coach": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    status = _job_payload(job)["execution_status"]
    if status != "COMPLETED":
        return _envelope(
            ok=False,
            job=job,
            data={"coach": None, "execution_status": status},
            error_code="JOB_NOT_READY",
            error_message="Job must be COMPLETED before coach generation.",
            status_code=409,
        )

    coach_path, coach_error_path = _coach_paths(job_id)
    if coach_path.exists() and not force:
        try:
            existing = _load_json_file(coach_path)
        except Exception as exc:
            return _envelope(
                ok=False,
                job=job,
                data={"coach": None},
                error_code="COACH_READ_FAILED",
                error_message=f"Stored coach artifact is unreadable: {exc}",
                status_code=409,
            )
        return _envelope(
            ok=True,
            job=job,
            data={"coach": existing, "cached": True},
            status_code=200,
        )

    coach_input = _coach_prompt_payload(job)

    try:
        generated = await asyncio.to_thread(generate_coach_via_vertex, coach_input)
        coach_payload = _validate_coach_schema(generated)
    except Exception as exc:
        request_id = getattr(exc, "vertex_request_id", None)
        error_payload = {
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "when": utc_now_iso(),
            "vertex_request_id": request_id,
        }
        coach_error_path.write_text(json.dumps(error_payload, indent=2, sort_keys=True) + "\n")
        updated_summary = dict(job.summary or {})
        updated_summary["coach_status"] = "FAILED"
        updated_summary["coach_error_type"] = error_payload["error_type"]
        updated_summary["coach_error_message"] = error_payload["error_message"]
        updated_artifacts = dict(job.artifacts)
        updated_artifacts["coach_error_json"] = str(coach_error_path)
        updated_artifacts.pop("coach_json", None)
        updated_job = JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            created_at=job.created_at,
            engine_version=job.engine_version,
            input_sha256=job.input_sha256,
            status=job.status,
            artifacts=updated_artifacts,
            upload=job.upload,
            summary=updated_summary,
        )
        _persist_job_record(updated_job, include_artifacts_sync=True)
        return _envelope(
            ok=False,
            job=updated_job,
            data={"coach_error": error_payload},
            error_code="COACH_GENERATION_FAILED",
            error_message="Vertex coach generation failed.",
            error_details=error_payload,
            status_code=502,
        )

    coach_path.write_text(json.dumps(coach_payload, indent=2, sort_keys=True) + "\n")
    if coach_error_path.exists():
        coach_error_path.unlink()
    updated_summary = dict(job.summary or {})
    updated_summary["coach_status"] = "COMPLETED"
    updated_summary["coach_error_type"] = None
    updated_summary["coach_error_message"] = None
    updated_artifacts = dict(job.artifacts)
    updated_artifacts["coach_json"] = str(coach_path)
    updated_artifacts.pop("coach_error_json", None)
    updated_job = JobRecord(
        job_id=job.job_id,
        user_id=job.user_id,
        created_at=job.created_at,
        engine_version=job.engine_version,
        input_sha256=job.input_sha256,
        status=job.status,
        artifacts=updated_artifacts,
        upload=job.upload,
        summary=updated_summary,
    )
    _persist_job_record(updated_job, include_artifacts_sync=True)
    return _envelope(
        ok=True,
        job=updated_job,
        data={"coach": coach_payload, "cached": False},
        status_code=200,
    )


@app.get("/jobs/{job_id}/coach")
async def get_coach(job_id: str) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"coach": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"coach": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    coach_path, coach_error_path = _coach_paths(job_id)
    if coach_path.exists():
        try:
            coach_payload = _load_json_file(coach_path)
        except Exception as exc:
            return _envelope(
                ok=False,
                job=job,
                data={"coach": None},
                error_code="COACH_READ_FAILED",
                error_message=f"Stored coach artifact is unreadable: {exc}",
                status_code=409,
            )
        return _envelope(ok=True, job=job, data={"coach": coach_payload})

    if coach_error_path.exists():
        try:
            error_payload = _load_json_file(coach_error_path)
        except Exception as exc:
            error_payload = {
                "error_type": "CorruptCoachErrorArtifact",
                "error_message": str(exc),
                "when": utc_now_iso(),
            }
        return _envelope(
            ok=False,
            job=job,
            data={"coach_error": error_payload},
            error_code="COACH_FAILED",
            error_message="Coach generation previously failed.",
            error_details=error_payload,
            status_code=409,
        )

    if (job.summary or {}).get("coach_status") == "FAILED":
        error_payload = {
            "error_type": (job.summary or {}).get("coach_error_type"),
            "error_message": (job.summary or {}).get("coach_error_message"),
            "when": utc_now_iso(),
        }
        return _envelope(
            ok=False,
            job=job,
            data={"coach_error": error_payload},
            error_code="COACH_FAILED",
            error_message="Coach generation previously failed.",
            error_details=error_payload,
            status_code=409,
        )

    return _envelope(
        ok=False,
        job=job,
        data={"coach": None},
        error_code="COACH_NOT_FOUND",
        error_message="Coach artifact not found for this job.",
        status_code=404,
    )


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

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data=_default_counterfactual_data(offset=offset, limit=limit),
            path=exc.path,
            cause=exc.cause,
        )
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
