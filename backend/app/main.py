import asyncio
from dataclasses import asdict
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
from urllib.parse import quote_plus
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest, urlopen
from uuid import uuid4

import pandas as pd
import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.detective import BiasThresholds
from app.job_store import JobRecord, LocalJobStore, file_sha256, utc_now_iso
from app.move_explanations import (
    MoveExplanationError,
    build_deterministic_move_review,
    load_move_explanations_contract_text,
)
from app.supabase_jobs import SupabaseJobRepository, SupabaseSyncError
from app.voice import (
    VoiceProviderError,
    synthesize_with_elevenlabs,
    synthesize_with_gradium_tts,
    transcribe_with_gradium,
)

ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT / "backend"
OUTPUTS_DIR = BACKEND_DIR / "outputs"
JUDGE_PACK_SCRIPT = BACKEND_DIR / "scripts" / "judge_pack.py"
LIST_JOBS_LIMIT_MAX = 200
COUNTERFACTUAL_PAGE_MAX = 2000
TRACE_PAGE_MAX = 5000
MAX_UPLOAD_MB_DEFAULT = 250
UPLOADTHING_FILE_BASE_URL = os.getenv("UPLOADTHING_FILE_BASE_URL", "https://utfs.io/f")
UPLOADTHING_SIGNATURE_HEADER = "x-uploadthing-signature"
COACH_JSON_NAME = "coach.json"
COACH_ERROR_JSON_NAME = "coach_error.json"
TRADE_COACH_JSON_PREFIX = "trade_coach_"
TRADE_COACH_ERROR_JSON_PREFIX = "trade_coach_error_"
TRADE_COACH_VOICE_MP3_PREFIX = "trade_coach_voice_"
TRADE_COACH_VOICE_JSON_PREFIX = "trade_coach_voice_"
TRADE_COACH_VOICE_ERROR_JSON_PREFIX = "trade_coach_voice_error_"
JOURNAL_TRANSCRIPT_JSON_PREFIX = "journal_transcript_"
TRACE_JSONL_NAME = "decision_trace.jsonl"
COACH_VERTEX_TIMEOUT_SECONDS_DEFAULT = 18.0
COACH_VERTEX_MAX_OUTPUT_TOKENS_DEFAULT = 900
COACH_ALLOWED_BIASES = {"OVERTRADING", "LOSS_AVERSION", "REVENGE_TRADING"}
COACH_ALLOWED_HORIZONS = {"NEXT_SESSION", "THIS_WEEK"}
COACH_ALLOWED_MOVE_LABELS = {
    "BRILLIANT",
    "GREAT",
    "BEST",
    "EXCELLENT",
    "GOOD",
    "INACCURACY",
    "MISTAKE",
    "MISS",
    "BLUNDER",
    "MEGABLUNDER",
}
ALLOWED_EXECUTION_STATUS = {"PENDING", "RUNNING", "COMPLETED", "FAILED", "TIMEOUT"}
JOB_WORKERS = int(os.getenv("JOB_WORKERS", "1"))
JOB_SEMAPHORE = asyncio.Semaphore(max(1, JOB_WORKERS))
ACTIVE_TASKS: set[asyncio.Task[Any]] = set()
_SUPABASE_STORE: SupabaseJobRepository | None = None

# Load .env from monorepo root
root_env = ROOT / ".env"
load_dotenv(root_env, override=True)
backend_env = BACKEND_DIR / ".env"
load_dotenv(backend_env)

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


def _trade_coach_paths(job_id: str, trade_id: int) -> tuple[Path, Path]:
    job_dir = _job_dir(job_id)
    return (
        job_dir / f"{TRADE_COACH_JSON_PREFIX}{trade_id}.json",
        job_dir / f"{TRADE_COACH_ERROR_JSON_PREFIX}{trade_id}.json",
    )


def _trade_voice_paths(job_id: str, trade_id: int) -> tuple[Path, Path, Path]:
    job_dir = _job_dir(job_id)
    return (
        job_dir / f"{TRADE_COACH_VOICE_MP3_PREFIX}{trade_id}.mp3",
        job_dir / f"{TRADE_COACH_VOICE_JSON_PREFIX}{trade_id}.json",
        job_dir / f"{TRADE_COACH_VOICE_ERROR_JSON_PREFIX}{trade_id}.json",
    )


def _journal_transcript_path(job_id: str) -> Path:
    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return _job_dir(job_id) / f"{JOURNAL_TRANSCRIPT_JSON_PREFIX}{timestamp}.json"


def _load_json_file(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text())
    if not isinstance(payload, dict):
        raise ValueError(f"{path.name} must contain a JSON object")
    return dict(payload)


def _persist_job_record(job: JobRecord, *, include_artifacts_sync: bool = False) -> None:
    _store().write(job, job_dir=_job_dir(job.job_id))
    _sync_job_to_supabase(job, include_artifacts=include_artifacts_sync, strict=False)


def _read_review_payload(job_id: str) -> dict[str, Any]:
    review_path = _job_dir(job_id) / "review.json"
    if not review_path.exists():
        raise CoachGenerationError("review artifact missing for coach generation")
    try:
        return _load_json_file(review_path)
    except Exception as exc:
        raise CoachGenerationError(f"review artifact unreadable: {exc}") from exc


def _read_counterfactual_rows(job_id: str) -> list[dict[str, Any]]:
    counterfactual_path = _job_dir(job_id) / "counterfactual.csv"
    if not counterfactual_path.exists():
        raise CoachGenerationError("counterfactual artifact missing for coach generation")
    try:
        frame = pd.read_csv(counterfactual_path)
    except Exception as exc:
        raise CoachGenerationError(f"counterfactual artifact unreadable: {exc}") from exc
    rows = frame.to_dict(orient="records")
    if not rows:
        raise CoachGenerationError("counterfactual artifact has no rows")
    return rows


def _coach_prompt_payload(
    job: JobRecord,
    *,
    review: dict[str, Any],
    deterministic_move_review: list[dict[str, Any]],
) -> dict[str, Any]:
    summary = dict(job.summary or {})
    score = review.get("scoreboard", {}) if isinstance(review.get("scoreboard"), dict) else {}
    bias_rates = review.get("bias_rates", {}) if isinstance(review.get("bias_rates"), dict) else {}
    badge_counts = review.get("badge_counts", {}) if isinstance(review.get("badge_counts"), dict) else {}
    derived_stats = review.get("derived_stats", {}) if isinstance(review.get("derived_stats"), dict) else {}
    labeling_rules = review.get("labeling_rules", {}) if isinstance(review.get("labeling_rules"), dict) else {}
    thresholds = labeling_rules.get("thresholds", {}) if isinstance(labeling_rules.get("thresholds"), dict) else {}

    return {
        "job_id": job.job_id,
        "user_id": job.user_id,
        "status": job.status,
        "outcome": summary.get("outcome"),
        "delta_pnl": _safe_float(summary.get("delta_pnl") or score.get("delta_pnl")),
        "cost_of_bias": _safe_float(summary.get("cost_of_bias") or score.get("cost_of_bias")),
        "bias_rates": bias_rates,
        "badge_counts": badge_counts,
        "derived_stats": derived_stats,
        "thresholds": thresholds,
        "top_moments": review.get("top_moments", [])[:3] if isinstance(review.get("top_moments"), list) else [],
        "recommendations": review.get("recommendations", [])[:6] if isinstance(review.get("recommendations"), list) else [],
        "move_review": deterministic_move_review,
    }


def _trade_metric_refs(trade_payload: dict[str, Any]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    counterfactual = trade_payload.get("counterfactual")
    if isinstance(counterfactual, dict):
        for name in ("actual_pnl", "policy_replay_pnl", "delta_pnl", "impact_pct_balance"):
            value = counterfactual.get(name)
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
                refs.append({"name": name, "value": float(value), "unit": "USD" if name != "impact_pct_balance" else "pct_balance"})

    decision = trade_payload.get("decision")
    if isinstance(decision, dict):
        blocked_reason = decision.get("blocked_reason")
        if isinstance(blocked_reason, str) and blocked_reason.strip():
            refs.append({"name": "blocked_reason", "value": blocked_reason.strip(), "unit": "enum"})
        reason_label = decision.get("reason_label")
        if isinstance(reason_label, str) and reason_label.strip():
            refs.append({"name": "reason_label", "value": reason_label.strip(), "unit": "enum"})

    derived_flags = trade_payload.get("derived_flags")
    if isinstance(derived_flags, dict):
        for key in ("is_revenge", "is_overtrading", "is_loss_aversion"):
            value = derived_flags.get(key)
            if isinstance(value, bool):
                refs.append({"name": key, "value": value, "unit": "bool"})

    if not refs:
        raise CoachGenerationError("trade coach requires deterministic metric refs from trade inspector payload")
    return refs


def _trade_coach_prompt_payload(
    job: JobRecord,
    *,
    trade_payload: dict[str, Any],
    metric_refs: list[dict[str, Any]],
) -> dict[str, Any]:
    summary = dict(job.summary or {})
    return {
        "job_id": job.job_id,
        "user_id": job.user_id,
        "status": job.status,
        "trade_id": trade_payload.get("trade_id"),
        "label": trade_payload.get("label"),
        "timestamp": trade_payload.get("timestamp"),
        "asset": trade_payload.get("asset"),
        "decision": trade_payload.get("decision"),
        "counterfactual": trade_payload.get("counterfactual"),
        "counterfactual_mechanics": trade_payload.get("counterfactual_mechanics"),
        "thesis": trade_payload.get("thesis"),
        "lesson": trade_payload.get("lesson"),
        "summary": {
            "outcome": summary.get("outcome"),
            "delta_pnl": _safe_float(summary.get("delta_pnl")),
            "cost_of_bias": _safe_float(summary.get("cost_of_bias")),
        },
        "metric_refs": metric_refs,
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
            "vertex auth unavailable; set one of OPENROUTER_API_KEY/GEMINI_API_KEY/GOOGLE_API_KEY/"
            "VERTEX_API_KEY or VERTEX_ACCESS_TOKEN/google auth credentials"
        ) from exc

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not creds.valid:
        creds.refresh(Request())
    if not creds.token:
        raise CoachGenerationError("failed to obtain vertex access token")
    return str(creds.token)


def _gemini_api_key() -> str:
    for key_name in ("GEMINI_API_KEY", "GOOGLE_API_KEY", "VERTEX_API_KEY"):
        value = os.getenv(key_name, "").strip()
        if value:
            return value
    return ""


def _openrouter_api_key() -> str:
    for key_name in (
        "OPENROUTER_API_KEY",
        "OPENROUTER_KEY",
        "OPEN_ROUTER_API_KEY",
        "OPENROUTER_TOKEN",
    ):
        explicit = os.getenv(key_name, "").strip()
        if explicit:
            return explicit

    # Common alias: users often place OpenRouter keys in OPENAI_API_KEY.
    openai_alias = os.getenv("OPENAI_API_KEY", "").strip()
    if openai_alias and (
        openai_alias.startswith("sk-or-")
        or "openrouter" in os.getenv("OPENAI_BASE_URL", "").lower()
        or os.getenv("LLM_PROVIDER", "").strip().lower() == "openrouter"
        or bool(os.getenv("OPENROUTER_MODEL", "").strip())
    ):
        return openai_alias
    return ""


def _openrouter_model_name() -> str:
    model = (
        os.getenv("OPENROUTER_MODEL")
        or os.getenv("OPENAI_MODEL")
        or "google/gemini-2.0-flash-001"
    ).strip()
    return model or "google/gemini-2.0-flash-001"


def _gemini_model_name() -> str:
    model = (
        os.getenv("GEMINI_MODEL")
        or os.getenv("VERTEX_MODEL")
        or "gemini-1.5-flash"
    ).strip()
    if model.endswith("-002"):
        model = model[: -len("-002")]
    return model or "gemini-1.5-flash"


def _coach_generation_target() -> tuple[str, str, dict[str, str]]:
    provider_override = os.getenv("LLM_PROVIDER", "").strip().lower()
    openrouter_key = _openrouter_api_key()

    # Favor OpenRouter whenever a key is present unless vertex is explicitly forced.
    if openrouter_key and provider_override not in {"vertex", "vertex_only"}:
        headers = {
            "Authorization": f"Bearer {openrouter_key}",
            "Content-Type": "application/json",
        }
        referer = os.getenv("OPENROUTER_HTTP_REFERER", "").strip()
        app_title = os.getenv("OPENROUTER_APP_TITLE", "Temper").strip()
        if referer:
            headers["HTTP-Referer"] = referer
        if app_title:
            headers["X-Title"] = app_title
        return "openrouter", "https://openrouter.ai/api/v1/chat/completions", headers

    if provider_override == "openrouter":
        raise CoachGenerationError(
            "LLM_PROVIDER=openrouter but OPENROUTER_API_KEY/OPENROUTER_KEY/OPENAI_API_KEY is missing"
        )

    if provider_override in {"gemini", "gemini_api", "gemini_only"}:
        api_key = _gemini_api_key()
        if not api_key:
            raise CoachGenerationError(
                "LLM_PROVIDER=gemini but GEMINI_API_KEY/GOOGLE_API_KEY/VERTEX_API_KEY is missing"
            )
        model = _gemini_model_name()
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={quote_plus(api_key)}"
        )
        return "gemini_api", endpoint, {"Content-Type": "application/json"}

    if provider_override in {"vertex", "vertex_only"}:
        endpoint = _vertex_endpoint()
        token = _vertex_access_token()
        return "vertex", endpoint, {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    api_key = _gemini_api_key()
    if api_key:
        model = _gemini_model_name()
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={quote_plus(api_key)}"
        )
        return "gemini_api", endpoint, {"Content-Type": "application/json"}

    endpoint = _vertex_endpoint()
    token = _vertex_access_token()
    return "vertex", endpoint, {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


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


def _extract_openrouter_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list):
        raise CoachGenerationError("openrouter response missing choices")
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if not isinstance(item, dict):
                    continue
                text = item.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            if parts:
                return "\n".join(parts)
    raise CoachGenerationError("openrouter response did not contain text output")


def _extract_llm_text(payload: dict[str, Any], provider: str) -> str:
    if provider == "openrouter":
        return _extract_openrouter_text(payload)
    return _extract_vertex_text(payload)


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
            raise CoachGenerationError("LLM output did not contain valid JSON")
        payload = json.loads(raw[start : end + 1])
    if not isinstance(payload, dict):
        raise CoachGenerationError("LLM output JSON must be an object")
    return dict(payload)


def _coach_request_payload(*, provider: str, prompt: str, max_tokens: int) -> dict[str, Any]:
    if provider == "openrouter":
        return {
            "model": _openrouter_model_name(),
            "messages": [
                {"role": "system", "content": "Return JSON only. Do not include markdown fences."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.1,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }

    return {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": max_tokens,
        },
    }


def _normalize_metric_scalar(value: Any, *, field: str) -> int | float | bool | str:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        parsed = float(value)
        if not math.isfinite(parsed):
            raise CoachGenerationError(f"{field} must be finite when numeric")
        return parsed
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            raise CoachGenerationError(f"{field} must be non-empty when string")
        return cleaned
    raise CoachGenerationError(f"{field} must be a scalar (bool|number|string)")


def _metric_values_equal(actual: Any, expected: Any) -> bool:
    if isinstance(actual, bool) or isinstance(expected, bool):
        return actual is expected
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return math.isclose(float(actual), float(expected), rel_tol=0.0, abs_tol=1e-9)
    return actual == expected


def _validate_move_review(
    move_review: Any,
    *,
    expected_move_review: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if not isinstance(move_review, list):
        raise CoachGenerationError("coach move_review must be a list")
    if len(move_review) != 3:
        raise CoachGenerationError("coach move_review must contain exactly 3 moments")

    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(move_review):
        if not isinstance(item, dict):
            raise CoachGenerationError("coach move_review entries must be objects")
        label = item.get("label")
        timestamp = item.get("timestamp")
        asset = item.get("asset")
        explanation = item.get("explanation")
        metric_refs = item.get("metric_refs")
        if label not in COACH_ALLOWED_MOVE_LABELS:
            raise CoachGenerationError("coach move_review.label must be a valid chess grade")
        if not isinstance(timestamp, str) or not timestamp.strip():
            raise CoachGenerationError("coach move_review.timestamp must be non-empty string")
        if not isinstance(asset, str) or not asset.strip():
            raise CoachGenerationError("coach move_review.asset must be non-empty string")
        if not isinstance(explanation, str) or not explanation.strip():
            raise CoachGenerationError("coach move_review.explanation must be non-empty string")
        if not isinstance(metric_refs, list) or not metric_refs:
            raise CoachGenerationError("coach move_review.metric_refs must be a non-empty list")

        normalized_refs: list[dict[str, Any]] = []
        for ref in metric_refs:
            if not isinstance(ref, dict):
                raise CoachGenerationError("coach move_review.metric_refs entries must be objects")
            name = ref.get("name")
            unit = ref.get("unit")
            value = ref.get("value")
            if not isinstance(name, str) or not name.strip():
                raise CoachGenerationError("coach move_review.metric_refs.name must be non-empty string")
            if not isinstance(unit, str) or not unit.strip():
                raise CoachGenerationError("coach move_review.metric_refs.unit must be non-empty string")
            normalized_refs.append(
                {
                    "name": name.strip(),
                    "value": _normalize_metric_scalar(value, field="coach move_review.metric_refs.value"),
                    "unit": unit.strip(),
                }
            )

        normalized_item = {
            "label": label,
            "timestamp": timestamp.strip(),
            "asset": asset.strip(),
            "explanation": explanation.strip(),
            "metric_refs": normalized_refs,
        }
        if expected_move_review is not None:
            if index >= len(expected_move_review):
                raise CoachGenerationError("coach move_review length does not match deterministic top moments")
            expected = expected_move_review[index]
            if (
                normalized_item["label"] != expected.get("label")
                or normalized_item["timestamp"] != expected.get("timestamp")
                or normalized_item["asset"] != expected.get("asset")
            ):
                raise CoachGenerationError("coach move_review changed deterministic labels/timestamps/assets")
            expected_refs = expected.get("metric_refs")
            if not isinstance(expected_refs, list):
                raise CoachGenerationError("deterministic move_review metric refs are missing")
            if len(normalized_refs) != len(expected_refs):
                raise CoachGenerationError("coach move_review metric_refs length drifted from deterministic payload")
            for ref_index, normalized_ref in enumerate(normalized_refs):
                expected_ref = expected_refs[ref_index]
                if not isinstance(expected_ref, dict):
                    raise CoachGenerationError("deterministic move_review metric refs are invalid")
                expected_name = str(expected_ref.get("name"))
                expected_unit = str(expected_ref.get("unit"))
                expected_value = _normalize_metric_scalar(
                    expected_ref.get("value"),
                    field="deterministic metric ref value",
                )
                if normalized_ref["name"] != expected_name or normalized_ref["unit"] != expected_unit:
                    raise CoachGenerationError("coach move_review metric identity drifted from deterministic payload")
                if not _metric_values_equal(normalized_ref["value"], expected_value):
                    raise CoachGenerationError("coach move_review metric value drifted from deterministic payload")

        normalized.append(normalized_item)

    return normalized


def _validate_trade_coach_schema(
    payload: dict[str, Any],
    *,
    expected_trade_id: int,
    expected_label: str,
    expected_metric_refs: list[dict[str, Any]],
) -> dict[str, Any]:
    llm_explanation_raw = payload.get("llm_explanation")
    actionable_fix_raw = payload.get("actionable_fix")
    confidence_note_raw = payload.get("confidence_note")
    if not isinstance(llm_explanation_raw, str) or not llm_explanation_raw.strip():
        fallback = payload.get("headline") or payload.get("explanation") or payload.get("message")
        llm_explanation_raw = str(fallback or "").strip()
    if not isinstance(actionable_fix_raw, str) or not actionable_fix_raw.strip():
        actionable_fix_raw = (
            "Use position sizing limits and cooldown rules before placing the next trade."
        )
    if not isinstance(confidence_note_raw, str) or not confidence_note_raw.strip():
        confidence_note_raw = "Deterministic trade metrics are fixed; narrative text is advisory."

    metric_refs = payload.get("metric_refs")
    if not isinstance(metric_refs, list) or not metric_refs:
        metric_refs = expected_metric_refs

    normalized_metric_refs: list[dict[str, Any]] = []
    metric_drifted = False
    for index, expected_ref in enumerate(expected_metric_refs):
        ref = metric_refs[index] if index < len(metric_refs) else expected_ref
        if not isinstance(ref, dict):
            metric_drifted = True
            ref = expected_ref
        name = ref.get("name")
        unit = ref.get("unit")
        value = ref.get("value")
        if not isinstance(name, str) or not name.strip():
            metric_drifted = True
            name = str(expected_ref.get("name", "metric"))
        if not isinstance(unit, str) or not unit.strip():
            metric_drifted = True
            unit = str(expected_ref.get("unit", "value"))
        normalized_ref = {
            "name": name.strip(),
            "value": _normalize_metric_scalar(
                value if value is not None else expected_ref.get("value"),
                field="trade coach metric_refs.value",
            ),
            "unit": unit.strip(),
        }
        expected_name = str(expected_ref.get("name"))
        expected_unit = str(expected_ref.get("unit"))
        expected_value = _normalize_metric_scalar(
            expected_ref.get("value"),
            field="deterministic trade metric ref value",
        )
        if (
            normalized_ref["name"] != expected_name
            or normalized_ref["unit"] != expected_unit
            or not _metric_values_equal(normalized_ref["value"], expected_value)
        ):
            metric_drifted = True
            normalized_metric_refs.append(
                {
                    "name": expected_name,
                    "value": expected_value,
                    "unit": expected_unit,
                }
            )
        else:
            normalized_metric_refs.append(normalized_ref)

    llm_explanation = str(llm_explanation_raw).strip()
    if metric_drifted:
        llm_explanation = (
            llm_explanation
            + " Metrics were normalized to deterministic values from the trade artifacts."
        ).strip()

    return {
        "version": 1,
        "trade_id": expected_trade_id,
        "label": expected_label,
        "llm_explanation": llm_explanation,
        "actionable_fix": str(actionable_fix_raw).strip(),
        "confidence_note": str(confidence_note_raw).strip(),
        "metric_refs": normalized_metric_refs,
    }


def _validate_coach_schema(
    payload: dict[str, Any],
    *,
    expected_move_review: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    required = {"version", "headline", "diagnosis", "plan", "do_next_session", "disclaimer", "move_review"}
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

    normalized_move_review = _validate_move_review(
        payload.get("move_review"),
        expected_move_review=expected_move_review,
    )

    return {
        "version": 1,
        "headline": headline.strip(),
        "diagnosis": normalized_diagnosis,
        "plan": normalized_plan,
        "do_next_session": next_steps,
        "disclaimer": disclaimer.strip(),
        "move_review": normalized_move_review,
    }


def generate_coach_via_vertex(payload: dict[str, Any]) -> dict[str, Any]:
    timeout = _coach_vertex_timeout_seconds()
    max_tokens = _coach_vertex_max_output_tokens()
    contract_text = load_move_explanations_contract_text()
    prompt = (
        "You are a trading discipline coach. Use ONLY the provided metrics and facts. "
        "Do not invent numbers. move_review is deterministic and immutable: keep label/timestamp/asset and all "
        "metric_refs values exactly unchanged. You may paraphrase move_review explanations only. "
        "Return JSON only with keys: version,headline,diagnosis,plan,do_next_session,disclaimer,move_review. "
        "bias values must be OVERTRADING|LOSS_AVERSION|REVENGE_TRADING. "
        "severity must be 1-5 integer. time_horizon must be NEXT_SESSION or THIS_WEEK.\n\n"
        f"MOVE_EXPLANATIONS_CONTRACT_MARKDOWN:\n{contract_text}\n\n"
        f"FACTS_JSON:\n{json.dumps(payload, sort_keys=True)}"
    )
    last_error: Exception | None = None
    for attempt in range(2):
        provider = "unknown"
        try:
            provider, endpoint, headers = _coach_generation_target()
            request_payload = _coach_request_payload(
                provider=provider,
                prompt=prompt,
                max_tokens=max_tokens,
            )
            request_bytes = json.dumps(request_payload).encode("utf-8")
            request = URLRequest(
                endpoint,
                data=request_bytes,
                headers=headers,
                method="POST",
            )
            with urlopen(request, timeout=timeout) as response:
                response_body = response.read().decode("utf-8", errors="replace")
                request_id = response.headers.get("x-request-id") or response.headers.get(
                    "x-goog-request-id"
                )
            parsed = json.loads(response_body)
            if not isinstance(parsed, dict):
                raise CoachGenerationError("LLM returned non-object response", vertex_request_id=request_id)
            text = _extract_llm_text(parsed, provider)
            result = _extract_json_from_text(text)
            return result
        except HTTPError as exc:
            last_error = exc
            if exc.code >= 500 or exc.code == 429:
                if attempt == 0:
                    continue
            raise CoachGenerationError(f"{provider} http error {exc.code}: {exc.reason}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise CoachGenerationError(f"{provider} network error: {exc}") from exc
        except CoachGenerationError:
            raise
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise CoachGenerationError(f"{provider} generation failed: {exc}") from exc
    raise CoachGenerationError(f"llm generation failed: {last_error}")


def generate_trade_coach_via_vertex(payload: dict[str, Any]) -> dict[str, Any]:
    timeout = _coach_vertex_timeout_seconds()
    max_tokens = min(700, _coach_vertex_max_output_tokens())
    contract_text = load_move_explanations_contract_text()
    prompt = (
        "You are a trading discipline coach for a single trade. Use ONLY the provided deterministic facts. "
        "Do not invent numbers. Keep trade_id, label, and metric_refs exactly unchanged. "
        "Return JSON only with keys: version,trade_id,label,llm_explanation,actionable_fix,confidence_note,metric_refs. "
        "metric_refs values must match exactly.\n\n"
        f"MOVE_EXPLANATIONS_CONTRACT_MARKDOWN:\n{contract_text}\n\n"
        f"FACTS_JSON:\n{json.dumps(payload, sort_keys=True)}"
    )
    last_error: Exception | None = None
    for attempt in range(2):
        provider = "unknown"
        try:
            provider, endpoint, headers = _coach_generation_target()
            request_payload = _coach_request_payload(
                provider=provider,
                prompt=prompt,
                max_tokens=max_tokens,
            )
            request_bytes = json.dumps(request_payload).encode("utf-8")
            request = URLRequest(
                endpoint,
                data=request_bytes,
                headers=headers,
                method="POST",
            )
            with urlopen(request, timeout=timeout) as response:
                response_body = response.read().decode("utf-8", errors="replace")
            parsed = json.loads(response_body)
            if not isinstance(parsed, dict):
                raise CoachGenerationError("LLM returned non-object response")
            text = _extract_llm_text(parsed, provider)
            try:
                result = _extract_json_from_text(text)
            except CoachGenerationError:
                trade_id_raw = payload.get("trade_id")
                label_raw = str(payload.get("label", "GOOD")).strip().upper()
                trade_id = int(trade_id_raw) if isinstance(trade_id_raw, (int, float)) else 0
                if label_raw not in COACH_ALLOWED_MOVE_LABELS:
                    label_raw = "GOOD"
                result = {
                    "version": 1,
                    "trade_id": trade_id,
                    "label": label_raw,
                    "llm_explanation": text.strip()
                    or "Trade coach narrative unavailable; deterministic trade evidence is shown.",
                    "actionable_fix": "Reduce emotional sizing and enforce cooldown/stop-loss rules.",
                    "confidence_note": "Converted from plain-text LLM response; deterministic metrics preserved.",
                    "metric_refs": payload.get("metric_refs", []),
                }
            return result
        except HTTPError as exc:
            last_error = exc
            if exc.code >= 500 or exc.code == 429:
                if attempt == 0:
                    continue
            raise CoachGenerationError(f"{provider} http error {exc.code}: {exc.reason}") from exc
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise CoachGenerationError(f"{provider} network error: {exc}") from exc
        except CoachGenerationError:
            raise
        except Exception as exc:
            last_error = exc
            if attempt == 0:
                continue
            raise CoachGenerationError(f"{provider} generation failed: {exc}") from exc
    raise CoachGenerationError(f"llm generation failed: {last_error}")


def _trade_voice_script(trade_coach_payload: dict[str, Any]) -> str:
    explanation = str(trade_coach_payload.get("llm_explanation") or "").strip()
    actionable_fix = str(trade_coach_payload.get("actionable_fix") or "").strip()
    confidence_note = str(trade_coach_payload.get("confidence_note") or "").strip()
    script_parts = [part for part in [explanation, actionable_fix, confidence_note] if part]
    if not script_parts:
        raise VoiceProviderError("trade coach artifact does not contain speech-ready text")
    return " ".join(script_parts)


def _synthesize_trade_voice(text: str, provider: str) -> tuple[str, bytes]:
    normalized = provider.strip().lower()
    if normalized not in {"auto", "elevenlabs", "gradium"}:
        raise VoiceProviderError("provider must be one of: auto, elevenlabs, gradium")

    if normalized in {"auto", "elevenlabs"}:
        try:
            return "elevenlabs", synthesize_with_elevenlabs(text)
        except VoiceProviderError:
            if normalized == "elevenlabs":
                raise

    if normalized in {"auto", "gradium"}:
        return "gradium", synthesize_with_gradium_tts(text)

    raise VoiceProviderError("failed to synthesize voice with available providers")


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
    # Keep demo-safe minimum so stale low env values do not break large uploads.
    return max(1, mb, MAX_UPLOAD_MB_DEFAULT) * 1024 * 1024


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


async def _extract_audio_upload(request: Request) -> tuple[bytes, str, str]:
    content_type = request.headers.get("content-type", "")
    body = await request.body()
    if not body:
        raise ValueError("empty request body")
    if "multipart/form-data" not in content_type:
        raise ValueError("audio upload must use multipart/form-data")

    boundary_match = re.search(r'boundary="?([^";]+)"?', content_type)
    if not boundary_match:
        raise ValueError("multipart payload missing boundary")

    boundary = boundary_match.group(1).encode("utf-8")
    marker = b"--" + boundary
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
        filename_match = re.search(r'filename="([^"]*)"', disposition)
        if not name_match or filename_match is None:
            continue
        field_name = name_match.group(1)
        if field_name not in {"audio", "file"}:
            continue
        cleaned_content = content[:-2] if content.endswith(b"\r\n") else content
        mime_header = next((h for h in headers if h.lower().startswith("content-type:")), "")
        mime_type = mime_header.split(":", 1)[1].strip() if ":" in mime_header else "application/octet-stream"
        filename = filename_match.group(1) or "journal_note"
        return cleaned_content, mime_type, filename

    raise ValueError("multipart payload missing audio file field")


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
            try:
                trace_frame = _load_counterfactual_frame(job_id)
                _load_or_build_trace(job_id, trace_frame)
                artifacts_with_trace = dict(terminal_record.artifacts)
                artifacts_with_trace["decision_trace.jsonl"] = str(_trace_path(job_id))
                terminal_record = JobRecord(
                    job_id=terminal_record.job_id,
                    user_id=terminal_record.user_id,
                    created_at=terminal_record.created_at,
                    engine_version=terminal_record.engine_version,
                    input_sha256=terminal_record.input_sha256,
                    status=terminal_record.status,
                    artifacts=artifacts_with_trace,
                    upload=terminal_record.upload,
                    summary=terminal_record.summary,
                )
                _store().write(terminal_record, job_dir=out_dir)
            except (FileNotFoundError, ValueError):
                pass
            _sync_job_to_supabase(
                terminal_record,
                include_artifacts=True,
                strict=False,
            )


def _schedule_job(**kwargs: Any) -> None:
    task = asyncio.create_task(_process_job(**kwargs))
    ACTIVE_TASKS.add(task)
    task.add_done_callback(lambda finished: ACTIVE_TASKS.discard(finished))


def _api_status_from_execution_status(execution_status: str | None) -> str:
    if execution_status in {"PENDING", "RUNNING"}:
        return "PROCESSING"
    if execution_status == "COMPLETED":
        return "COMPLETED"
    if execution_status in {"FAILED", "TIMEOUT"}:
        return "FAILED"
    return "UNKNOWN"


def _api_parse_error_message(job: JobRecord | None) -> str | None:
    if job is None:
        return None
    summary = dict(job.summary or {})
    message = summary.get("error_message")
    if isinstance(message, str) and message.strip():
        return message
    return None


def _rate_to_percent(value: Any) -> float:
    rate = _safe_float(value)
    if rate is None:
        return 0.0
    if 0.0 <= rate <= 1.0:
        rate *= 100.0
    return max(0.0, min(100.0, float(rate)))


def _temper_score_from_rates(rates: dict[str, Any]) -> float:
    any_bias_pct = _rate_to_percent(rates.get("any_bias_rate"))
    return round(max(0.0, min(100.0, 100.0 - any_bias_pct)), 1)


def _elo_delta_from_job(*, outcome: Any, delta_pnl: Any, status: str | None) -> float:
    if status != "COMPLETED":
        return 0.0
    normalized_outcome = str(outcome or "").upper()
    if normalized_outcome in {"WINNER", "BEST", "BRILLIANT", "EXCELLENT", "GREAT"}:
        return 8.0
    if normalized_outcome in {"CHECKMATED", "RESIGN", "MEGABLUNDER", "BLUNDER"}:
        return -8.0
    pnl = _safe_float(delta_pnl)
    if pnl is None:
        return 0.0
    return 4.0 if pnl >= 0 else -4.0


def _history_reports_from_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    if not rows:
        return [], {"rating": 1200.0, "peakRating": 1200.0, "sessionsPlayed": 0}

    chron_rows = sorted(rows, key=lambda row: str(row.get("created_at", "")))
    rating = 1200.0
    peak = rating
    reports_chron: list[dict[str, Any]] = []
    for row in chron_rows:
        rates = row.get("bias_rates")
        rates = dict(rates) if isinstance(rates, dict) else {}
        elo_before = rating
        elo_delta = _elo_delta_from_job(
            outcome=row.get("outcome"),
            delta_pnl=row.get("delta_pnl"),
            status=str(row.get("execution_status") or row.get("status") or ""),
        )
        elo_after = elo_before + elo_delta
        rating = elo_after
        peak = max(peak, rating)
        reports_chron.append(
            {
                "id": str(row.get("job_id") or row.get("id") or ""),
                "sessionId": str(row.get("job_id") or row.get("id") or ""),
                "date": str(row.get("created_at") or ""),
                "temperScore": _temper_score_from_rates(rates),
                "eloBefore": round(float(elo_before), 1),
                "eloAfter": round(float(elo_after), 1),
                "eloDelta": round(float(elo_delta), 1),
                "biasScores": {
                    "OVERTRADING": round(_rate_to_percent(rates.get("overtrading_rate")), 1),
                    "LOSS_AVERSION": round(_rate_to_percent(rates.get("loss_aversion_rate")), 1),
                    "REVENGE_TRADING": round(_rate_to_percent(rates.get("revenge_rate")), 1),
                },
            }
        )

    reports_desc = list(reversed(reports_chron))
    current = {
        "rating": round(float(rating), 1),
        "peakRating": round(float(peak), 1),
        "sessionsPlayed": len(reports_chron),
    }
    return reports_desc, current


def _history_rows_local(user_id: str, limit: int) -> list[dict[str, Any]]:
    local_jobs = _store().list_jobs(user_id=user_id, limit=limit)
    rows: list[dict[str, Any]] = []
    for job in local_jobs:
        bias_rates = _read_bias_rates(job.job_id) or {}
        rows.append(
            {
                "job_id": job.job_id,
                "id": job.job_id,
                "created_at": job.created_at,
                "status": job.status,
                "execution_status": job.status,
                "outcome": (job.summary or {}).get("outcome"),
                "delta_pnl": _safe_float((job.summary or {}).get("delta_pnl")),
                "cost_of_bias": _safe_float((job.summary or {}).get("cost_of_bias")),
                "bias_rates": bias_rates,
            }
        )
    return rows


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
        "data_quality_flags": [],
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


def _counterfactual_path(job_id: str) -> Path:
    return _job_dir(job_id) / "counterfactual.csv"


def _review_path(job_id: str) -> Path:
    return _job_dir(job_id) / "review.json"


def _load_counterfactual_frame(job_id: str) -> pd.DataFrame:
    path = _counterfactual_path(job_id)
    if not path.exists():
        raise FileNotFoundError("counterfactual.csv not found")
    try:
        frame = pd.read_csv(path)
    except Exception as exc:
        raise ValueError(f"counterfactual.csv is unreadable: {exc}") from exc
    if frame.empty:
        raise ValueError("counterfactual.csv has no rows")
    return frame


def _load_review_payload_for_moments(job_id: str) -> dict[str, Any]:
    path = _review_path(job_id)
    if not path.exists():
        raise FileNotFoundError("review.json not found")
    try:
        payload = _load_json_file(path)
    except Exception as exc:
        raise ValueError(f"review.json is unreadable: {exc}") from exc
    return payload


def _downsample_indices(total_points: int, max_points: int) -> list[int]:
    if total_points <= 0:
        return []
    if max_points <= 0:
        return []
    if total_points <= max_points:
        return list(range(total_points))
    if max_points == 1:
        return [0]
    step = (total_points - 1) / (max_points - 1)
    indices: list[int] = []
    last_index = -1
    for i in range(max_points):
        idx = int(round(i * step))
        if idx <= last_index:
            idx = last_index + 1
        if idx >= total_points:
            idx = total_points - 1
        indices.append(idx)
        last_index = idx
    indices[0] = 0
    indices[-1] = total_points - 1
    return indices


def _float_or_none(value: Any) -> float | None:
    try:
        parsed = float(value)
    except Exception:
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _bool_or_none(row: dict[str, Any], field: str, notes: list[str]) -> bool | None:
    if field not in row:
        notes.append(f"missing field: {field}")
        return None
    value = row.get(field)
    if value is None:
        notes.append(f"null field: {field}")
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(float(value)):
            notes.append(f"invalid boolean field: {field}")
            return None
        return int(value) != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    notes.append(f"invalid boolean field: {field}")
    return None


def _moment_threshold_keys_for_grade(grade: str) -> list[str]:
    if grade in {"MEGABLUNDER", "BLUNDER"}:
        return ["impact_p95", "impact_p995"]
    if grade in {"MISS", "MISTAKE", "INACCURACY"}:
        return ["impact_p65", "impact_p80", "impact_p90", "loss_abs_p70", "loss_abs_p85"]
    if grade in {"BEST", "EXCELLENT", "GREAT", "BRILLIANT"}:
        return ["win_p70", "win_p85", "win_p95", "win_p995"]
    return ["impact_p65", "win_p70"]


def _moment_human_explanation(
    *,
    grade: str,
    blocked_reason: str | None,
    pnl: float | None,
    simulated_pnl: float | None,
    impact_abs: float | None,
    is_revenge: bool | None,
    is_overtrading: bool | None,
    is_loss_aversion: bool | None,
) -> str:
    reason = blocked_reason or "NONE"
    if reason == "BIAS":
        return (
            f"This trade was flagged as bias-driven; skipping it in the disciplined replay changes "
            f"result by {format_currency_short(impact_abs)}."
        )
    if reason == "DAILY_MAX_LOSS":
        return (
            f"This trade happened after the day hit risk limits, so the replay blocks it. "
            f"The difference on this trade is {format_currency_short(impact_abs)}."
        )
    if grade in {"MEGABLUNDER", "BLUNDER", "MISTAKE", "INACCURACY"}:
        return (
            f"This was a costly decision: actual {format_currency_short(pnl)} vs disciplined "
            f"{format_currency_short(simulated_pnl)}."
        )
    if grade in {"MISS"}:
        return (
            f"This still made money, but context looked risky (revenge={is_revenge}, overtrading={is_overtrading}, "
            f"loss_aversion={is_loss_aversion})."
        )
    return (
        f"This was a stable decision with actual {format_currency_short(pnl)} and disciplined "
        f"{format_currency_short(simulated_pnl)}."
    )


def format_currency_short(value: float | None) -> str:
    if value is None or not math.isfinite(value):
        return "n/a"
    sign = "+" if value >= 0 else "-"
    return f"{sign}${abs(value):,.2f}"


def _intervention_type(trace_record: dict[str, Any] | None) -> str:
    if not isinstance(trace_record, dict):
        return "KEEP (no change)"
    blocked_reason = str(trace_record.get("blocked_reason", "NONE") or "NONE")
    if blocked_reason == "DAILY_MAX_LOSS":
        return "BLOCKED (risk stop)"
    if _trace_bool(trace_record.get("replay_deferred")):
        return "BLOCKED (cooldown)"
    if _trace_bool(trace_record.get("replay_rescaled")):
        return "KEEP (rescaled)"
    if _trace_bool(trace_record.get("replay_loss_capped")):
        return "KEEP (loss-capped)"
    return "KEEP (no change)"


def _reason_label(
    *,
    trace_record: dict[str, Any] | None,
    is_revenge: bool | None,
    is_overtrading: bool | None,
    is_loss_aversion: bool | None,
) -> str:
    if isinstance(trace_record, dict):
        blocked_reason = str(trace_record.get("blocked_reason", "NONE") or "NONE")
        if blocked_reason == "DAILY_MAX_LOSS":
            return "Daily stop (risk)"
        if _trace_bool(trace_record.get("replay_deferred")):
            return "Overtrading (cooldown)"
        if _trace_bool(trace_record.get("replay_rescaled")):
            return "Revenge sizing"
        if _trace_bool(trace_record.get("replay_loss_capped")):
            return "Loss aversion (downside capped)"
        reason = str(trace_record.get("reason", "") or "")
        if reason in {"OVERTRADING_DEFERRED", "OVERTRADING_COOLDOWN_SKIP"}:
            return "Overtrading (cooldown)"
        if reason == "REVENGE_SIZE_RESCALED":
            return "Revenge sizing"
        if reason == "LOSS_AVERSION_CAPPED":
            return "Loss aversion (downside capped)"
    if is_revenge is True:
        return "Revenge sizing"
    if is_overtrading is True:
        return "Overtrading (cooldown)"
    if is_loss_aversion is True:
        return "Loss aversion (downside capped)"
    return "No intervention"


def _first_fired_rule_id(trace_record: dict[str, Any] | None) -> str | None:
    if not isinstance(trace_record, dict):
        return None
    rule_hits = trace_record.get("rule_hits")
    if not isinstance(rule_hits, list):
        return None
    for hit in rule_hits:
        if not isinstance(hit, dict):
            continue
        if bool(hit.get("fired")):
            rule_id = hit.get("rule_id")
            if isinstance(rule_id, str) and rule_id.strip():
                return rule_id.strip()
    return None


def _trade_thesis(
    *,
    trace_record: dict[str, Any] | None,
    pnl: float | None,
    replay_pnl: float | None,
    impact_abs: float | None,
) -> dict[str, str]:
    trigger = "No bias/risk trigger fired for this trade."
    behavior = "Trade execution remained within policy bounds."
    intervention = "Policy replay kept this trade unchanged."
    outcome = (
        f"Actual {format_currency_short(pnl)} vs policy replay {format_currency_short(replay_pnl)}; "
        f"delta {format_currency_short(impact_abs)}."
    )
    if not isinstance(trace_record, dict):
        return {
            "trigger": trigger,
            "behavior": behavior,
            "intervention": intervention,
            "outcome": outcome,
        }

    rule_hits = trace_record.get("rule_hits")
    fired: dict[str, dict[str, Any]] = {}
    if isinstance(rule_hits, list):
        for hit in rule_hits:
            if not isinstance(hit, dict) or not bool(hit.get("fired")):
                continue
            rule_id = hit.get("rule_id")
            if isinstance(rule_id, str):
                fired[rule_id] = hit

    if "DAILY_MAX_LOSS_STOP" in fired:
        trigger = "Daily loss guardrail was breached earlier in the session."
        behavior = "Further same-day trades increase blowup risk after the limit is hit."
        intervention = "Policy replay blocks this trade after the daily stop."
    elif "OVERTRADING_COOLDOWN_SKIP_REPLAY" in fired or "OVERTRADING_DEFERRED_REPLAY" in fired:
        hit = fired.get("OVERTRADING_COOLDOWN_SKIP_REPLAY") or fired.get("OVERTRADING_DEFERRED_REPLAY")
        inputs = hit.get("inputs") if isinstance(hit.get("inputs"), dict) else {}
        rolling = _float_or_none(inputs.get("rolling_trade_count_1h"))
        threshold = _float_or_none(
            (hit.get("thresholds") if isinstance(hit.get("thresholds"), dict) else {}).get("overtrading_trade_threshold")
        )
        trigger = (
            f"Hourly cadence exceeded cap ({rolling:.0f} vs {threshold:.0f} trades/hour)."
            if rolling is not None and threshold is not None
            else "Hourly cadence exceeded the overtrading cap."
        )
        behavior = "Trade frequency spiked, which is a known impulsive pattern."
        intervention = "Policy replay skipped this trade under cooldown (no replacement trade assumed)."
    elif "OVERTRADING_HOURLY_CAP" in fired:
        hit = fired["OVERTRADING_HOURLY_CAP"]
        inputs = hit.get("inputs") if isinstance(hit.get("inputs"), dict) else {}
        thresholds = hit.get("thresholds") if isinstance(hit.get("thresholds"), dict) else {}
        rolling = _float_or_none(inputs.get("rolling_trade_count_1h"))
        threshold = _float_or_none(thresholds.get("overtrading_trade_threshold"))
        trigger = (
            f"Hourly cadence exceeded cap ({rolling:.0f} vs {threshold:.0f} trades/hour)."
            if rolling is not None and threshold is not None
            else "Hourly cadence exceeded the overtrading cap."
        )
        behavior = "Trade frequency spiked, which is a known impulsive pattern."
        intervention = "Policy replay marked this trade as overtrading context."
    elif "REVENGE_SIZE_RESCALE_REPLAY" in fired or "REVENGE_AFTER_LOSS" in fired:
        hit = fired.get("REVENGE_AFTER_LOSS") or fired.get("REVENGE_SIZE_RESCALE_REPLAY")
        inputs = hit.get("inputs") if isinstance(hit.get("inputs"), dict) else {}
        prev_loss = _float_or_none(inputs.get("prev_trade_pnl"))
        size_mult = _float_or_none(inputs.get("size_multiplier"))
        trigger = (
            f"Recent loss {format_currency_short(prev_loss)} followed by size jump ({size_mult:.2f}x)."
            if prev_loss is not None and size_mult is not None
            else "Recent loss followed by aggressive size escalation."
        )
        behavior = "Position size increased sharply after a loss."
        intervention = "Policy replay rescaled size toward rolling-median risk."
    elif "LOSS_AVERSION_CAP_REPLAY" in fired or "LOSS_AVERSION_PAYOFF_PROXY" in fired:
        hit = fired.get("LOSS_AVERSION_CAP_REPLAY") or fired.get("LOSS_AVERSION_PAYOFF_PROXY")
        inputs = hit.get("inputs") if isinstance(hit.get("inputs"), dict) else {}
        loss_abs = _float_or_none(inputs.get("loss_abs_pnl"))
        threshold = _float_or_none(inputs.get("loss_abs_threshold"))
        trigger = (
            f"Loss magnitude exceeded loss proxy ({loss_abs:.2f} vs {threshold:.2f})."
            if loss_abs is not None and threshold is not None
            else "Loss magnitude exceeded normal payoff profile."
        )
        behavior = "Downside on this trade is disproportionate to typical wins."
        intervention = "Policy replay capped downside on this trade."

    return {
        "trigger": trigger,
        "behavior": behavior,
        "intervention": intervention,
        "outcome": outcome,
    }


def _trade_lesson(
    *,
    reason_label: str,
    impact_abs: float | None,
) -> str:
    impact_text = format_currency_short(impact_abs)
    if reason_label == "Overtrading (cooldown)":
        return f"Lesson: when cadence spikes, a cooldown policy can reduce noise and protect {impact_text} of impact."
    if reason_label == "Revenge sizing":
        return f"Lesson: after losses, controlling size avoids emotional oversizing; this trade moved {impact_text}."
    if reason_label == "Loss aversion (downside capped)":
        return f"Lesson: capping downside prevents one trade from dominating the session ({impact_text})."
    if reason_label == "Daily stop (risk)":
        return f"Lesson: once risk limits are hit, stopping preserves capital beyond {impact_text} exposure."
    return f"Lesson: this trade had limited policy intervention impact ({impact_text})."


def _counterfactual_mechanics(
    trace_record: dict[str, Any] | None,
    *,
    quantity_before: float | None = None,
) -> dict[str, Any]:
    if not isinstance(trace_record, dict):
        return {
            "mechanism": "UNKNOWN",
            "scale_factor": None,
            "size_usd_before": None,
            "size_usd_after": None,
            "quantity_before": quantity_before,
            "quantity_after": None,
            "cap_used": None,
        }

    scale_factor = _float_or_none(trace_record.get("replay_effective_scale"))
    size_usd_before = _float_or_none(trace_record.get("size_usd"))
    size_usd_after = _float_or_none(trace_record.get("simulated_size_usd"))
    cap_used = _float_or_none(trace_record.get("replay_loss_cap_value"))

    if _trace_bool(trace_record.get("replay_deferred")):
        mechanism = "SKIP_COOLDOWN"
    elif _trace_bool(trace_record.get("replay_loss_capped")) or _trace_bool(trace_record.get("replay_rescaled")):
        mechanism = "EXPOSURE_SCALING"
    else:
        mechanism = "UNCHANGED"

    quantity_after = None
    if quantity_before is not None and scale_factor is not None:
        quantity_after = quantity_before * scale_factor

    return {
        "mechanism": mechanism,
        "scale_factor": scale_factor,
        "size_usd_before": size_usd_before,
        "size_usd_after": size_usd_after,
        "quantity_before": quantity_before,
        "quantity_after": quantity_after,
        "cap_used": cap_used,
    }


def _max_drawdown(equity_series: pd.Series) -> float:
    running_max = equity_series.cummax()
    drawdown = equity_series - running_max
    min_drawdown = float(drawdown.min()) if len(drawdown) else 0.0
    return abs(min_drawdown)


def _select_top_moment_rows(
    review_payload: dict[str, Any],
    counterfactual_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    def _impact_score(row: dict[str, Any]) -> float:
        impact = _float_or_none(row.get("impact_abs"))
        if impact is not None:
            return impact
        pnl = _float_or_none(row.get("pnl")) or 0.0
        simulated = _float_or_none(row.get("simulated_pnl")) or 0.0
        return abs(pnl - simulated)

    top_moment_labels: dict[tuple[str, str], str] = {}
    top_moments = review_payload.get("top_moments")
    if isinstance(top_moments, list):
        for moment in top_moments:
            if not isinstance(moment, dict):
                continue
            ts = moment.get("timestamp")
            asset = moment.get("asset")
            label = moment.get("label")
            if isinstance(ts, str) and isinstance(asset, str) and isinstance(label, str):
                top_moment_labels[(ts, asset)] = label

    ranked = sorted(
        enumerate(counterfactual_rows),
        key=lambda item: (
            -_impact_score(item[1]),
            str(item[1].get("timestamp", "")),
            str(item[1].get("asset", "")),
            item[0],
        ),
    )

    selected: list[dict[str, Any]] = []
    used_indices: set[int] = set()

    def _append_row(idx: int, row: dict[str, Any], *, category: str) -> None:
        row_copy = dict(row)
        row_copy["_source_index"] = idx
        row_copy["_selected_bias_category"] = category
        if "trade_grade" not in row_copy:
            mapped = top_moment_labels.get((str(row_copy.get("timestamp", "")), str(row_copy.get("asset", ""))))
            if isinstance(mapped, str):
                row_copy["trade_grade"] = mapped
        selected.append(row_copy)
        used_indices.add(idx)

    category_checks: list[tuple[str, str]] = [
        ("revenge", "is_revenge"),
        ("overtrading", "is_overtrading"),
        ("loss_aversion", "is_loss_aversion"),
    ]
    for category, field in category_checks:
        for idx, row in ranked:
            if idx in used_indices:
                continue
            if _trace_bool(row.get(field)) is True:
                _append_row(idx, row, category=category)
                break

    for idx, row in ranked:
        if len(selected) >= 3:
            break
        if idx in used_indices:
            continue
        _append_row(idx, row, category="fallback")

    return selected[:3]


def _trace_path(job_id: str) -> Path:
    return _job_dir(job_id) / TRACE_JSONL_NAME


def _trace_bool(value: Any) -> bool | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except Exception:
        pass
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(float(value)):
            return None
        return int(value) != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes"}:
            return True
        if lowered in {"false", "0", "no"}:
            return False
    return None


def _format_comparison(left: float | None, op: str, right: float | None) -> str:
    left_text = "n/a" if left is None else f"{left:.6f}"
    right_text = "n/a" if right is None else f"{right:.6f}"
    return f"{left_text} {op} {right_text}"


def _build_decision_trace_records(counterfactual_frame: pd.DataFrame) -> list[dict[str, Any]]:
    thresholds = BiasThresholds()
    threshold_values = asdict(thresholds)
    df = counterfactual_frame.copy()

    required = {"timestamp", "asset", "pnl", "size_usd", "blocked_reason"}
    missing_required = [column for column in required if column not in df.columns]
    if missing_required:
        raise ValueError(f"counterfactual.csv missing required columns for trace: {sorted(missing_required)}")

    timestamps = pd.to_datetime(df["timestamp"], errors="coerce")
    if timestamps.isna().any():
        raise ValueError("counterfactual.csv contains invalid timestamps for trace generation")

    pnl_series = pd.to_numeric(df["pnl"], errors="coerce")
    size_series = pd.to_numeric(df["size_usd"], errors="coerce")
    simulated_pnl_series = pd.to_numeric(df.get("simulated_pnl"), errors="coerce")
    if pnl_series.isna().any() or size_series.isna().any():
        raise ValueError("counterfactual.csv has non-numeric pnl/size_usd for trace generation")

    prev_pnl = pnl_series.shift(1)
    prev_size = size_series.shift(1)
    prev_ts = timestamps.shift(1)
    prev_asset = df["asset"].shift(1)
    prev_blocked_reason = df["blocked_reason"].shift(1)
    time_diff_minutes = (timestamps - prev_ts).dt.total_seconds() / 60.0

    prev_was_loss = prev_pnl <= -thresholds.revenge_min_prev_loss_abs
    within_window = time_diff_minutes <= thresholds.revenge_time_window_minutes
    prev_size_positive = prev_size > 0
    size_multiplier = size_series / prev_size.where(prev_size_positive)
    size_increased = size_multiplier >= thresholds.revenge_size_multiplier
    rolling_median = size_series.rolling(
        thresholds.revenge_baseline_window_trades,
        min_periods=5,
    ).median()
    escalated_vs_baseline = size_series >= (
        thresholds.revenge_rolling_median_multiplier * rolling_median
    )
    revenge_fired = (
        prev_was_loss
        & within_window
        & prev_size_positive
        & size_increased
        & escalated_vs_baseline
    ).fillna(False)

    rolling_count = pd.Series(1.0, index=timestamps).rolling(
        f"{thresholds.overtrading_window_hours}h",
        min_periods=1,
    ).sum()
    overtrading_fired = (rolling_count > thresholds.overtrading_trade_threshold).fillna(False)

    wins = pnl_series[pnl_series > 0]
    median_win = float(wins.median()) if not wins.empty else None
    loss_threshold = (
        thresholds.loss_aversion_loss_to_win_multiplier * median_win
        if median_win is not None and median_win > 0
        else None
    )
    if loss_threshold is None:
        loss_aversion_fired = pd.Series(False, index=df.index)
    else:
        loss_aversion_fired = (
            (pnl_series < 0) & (pnl_series.abs() > loss_threshold)
        ).fillna(False)

    trace_records: list[dict[str, Any]] = []
    for idx in range(len(df)):
        row = df.iloc[idx]
        blocked_reason = str(row.get("blocked_reason", "NONE") or "NONE")
        is_revenge = _trace_bool(row.get("is_revenge"))
        is_overtrading = _trace_bool(row.get("is_overtrading"))
        is_loss_aversion = _trace_bool(row.get("is_loss_aversion"))
        pnl = float(pnl_series.iloc[idx])
        simulated_pnl = _float_or_none(simulated_pnl_series.iloc[idx]) if idx < len(simulated_pnl_series) else None
        impact_abs = _float_or_none(row.get("impact_abs"))
        if impact_abs is None and simulated_pnl is not None:
            impact_abs = abs(pnl - simulated_pnl)
        replay_deferred = bool(_trace_bool(row.get("replay_deferred")))
        replay_rescaled = bool(_trace_bool(row.get("replay_rescaled")))
        replay_loss_capped = bool(_trace_bool(row.get("replay_loss_capped")))
        simulated_size_usd = _float_or_none(row.get("simulated_size_usd"))
        replay_effective_scale = _float_or_none(row.get("replay_effective_scale"))
        replay_rescale_factor = _float_or_none(row.get("replay_rescale_factor"))
        replay_loss_cap_factor = _float_or_none(row.get("replay_loss_cap_factor"))
        replay_loss_cap_value = _float_or_none(row.get("replay_loss_cap_value"))
        deferred_target_index = None
        deferred_target_raw = row.get("replay_deferred_target_index")
        if isinstance(deferred_target_raw, (int, float)) and not isinstance(deferred_target_raw, bool):
            if math.isfinite(float(deferred_target_raw)):
                deferred_target_index = int(deferred_target_raw)
                if deferred_target_index < 0:
                    deferred_target_index = None
        deferred_target_trade = None
        if deferred_target_index is not None and 0 <= deferred_target_index < len(df):
            target_row = df.iloc[deferred_target_index]
            deferred_target_trade = {
                "trade_id": deferred_target_index,
                "timestamp": str(target_row.get("timestamp")),
                "asset": str(target_row.get("asset", "")),
                "pnl": _float_or_none(target_row.get("pnl")),
                "size_usd": _float_or_none(target_row.get("size_usd")),
            }

        prev_trade = None
        if idx > 0:
            prev_trade = {
                "trade_id": idx - 1,
                "timestamp": str(prev_ts.iloc[idx]),
                "asset": str(prev_asset.iloc[idx]),
                "pnl": _float_or_none(prev_pnl.iloc[idx]),
                "size_usd": _float_or_none(prev_size.iloc[idx]),
                "blocked_reason": str(prev_blocked_reason.iloc[idx]) if prev_blocked_reason.iloc[idx] is not None else None,
            }

        revenge_inputs = {
            "prev_trade_pnl": _float_or_none(prev_pnl.iloc[idx]),
            "minutes_since_prev_trade": _float_or_none(time_diff_minutes.iloc[idx]),
            "prev_trade_size_usd": _float_or_none(prev_size.iloc[idx]),
            "current_trade_size_usd": _float_or_none(size_series.iloc[idx]),
            "size_multiplier": _float_or_none(size_multiplier.iloc[idx]),
            "rolling_median_size_usd": _float_or_none(rolling_median.iloc[idx]),
        }
        overtrading_inputs = {
            "rolling_trade_count_1h": _float_or_none(rolling_count.iloc[idx]),
            "overtrading_window_hours": thresholds.overtrading_window_hours,
            "cooldown_minutes": 30,
            "resulting_simulated_pnl": simulated_pnl,
            "size_usd_before": _float_or_none(size_series.iloc[idx]),
            "size_usd_after": simulated_size_usd,
            "effective_scale": replay_effective_scale,
        }
        loss_aversion_inputs = {
            "median_win_pnl": median_win,
            "loss_abs_pnl": abs(pnl),
            "loss_cap_value": replay_loss_cap_value,
            "size_usd_before": _float_or_none(size_series.iloc[idx]),
            "size_usd_after": simulated_size_usd,
            "effective_scale": replay_effective_scale,
            "loss_cap_scale": replay_loss_cap_factor,
        }
        risk_inputs = {
            "blocked_reason": blocked_reason,
            "is_blocked_risk": _trace_bool(row.get("is_blocked_risk")),
            "simulated_daily_pnl": _float_or_none(row.get("simulated_daily_pnl")),
        }

        rule_hits: list[dict[str, Any]] = [
            {
                "rule_id": "REVENGE_AFTER_LOSS",
                "inputs": revenge_inputs,
                "thresholds": {
                    "revenge_min_prev_loss_abs": threshold_values["revenge_min_prev_loss_abs"],
                    "revenge_time_window_minutes": threshold_values["revenge_time_window_minutes"],
                    "revenge_size_multiplier": threshold_values["revenge_size_multiplier"],
                    "revenge_rolling_median_multiplier": threshold_values["revenge_rolling_median_multiplier"],
                },
                "comparison": {
                    "prev_trade_loss_check": _format_comparison(
                        revenge_inputs["prev_trade_pnl"],
                        "<=",
                        -float(threshold_values["revenge_min_prev_loss_abs"]),
                    ),
                    "time_window_check": _format_comparison(
                        revenge_inputs["minutes_since_prev_trade"],
                        "<=",
                        float(threshold_values["revenge_time_window_minutes"]),
                    ),
                    "size_multiplier_check": _format_comparison(
                        revenge_inputs["size_multiplier"],
                        ">=",
                        float(threshold_values["revenge_size_multiplier"]),
                    ),
                    "baseline_escalation_check": _format_comparison(
                        revenge_inputs["current_trade_size_usd"],
                        ">=",
                        (
                            revenge_inputs["rolling_median_size_usd"] * float(threshold_values["revenge_rolling_median_multiplier"])
                            if revenge_inputs["rolling_median_size_usd"] is not None
                            else None
                        ),
                    ),
                },
                "fired": bool(revenge_fired.iloc[idx]),
            },
            {
                "rule_id": "OVERTRADING_HOURLY_CAP",
                "inputs": overtrading_inputs,
                "thresholds": {
                    "overtrading_trade_threshold": threshold_values["overtrading_trade_threshold"],
                    "overtrading_window_hours": threshold_values["overtrading_window_hours"],
                },
                "comparison": {
                    "rolling_trade_count_check": _format_comparison(
                        overtrading_inputs["rolling_trade_count_1h"],
                        ">",
                        float(threshold_values["overtrading_trade_threshold"]),
                    ),
                },
                "fired": bool(overtrading_fired.iloc[idx]),
            },
            {
                "rule_id": "LOSS_AVERSION_PAYOFF_PROXY",
                "inputs": loss_aversion_inputs,
                "thresholds": {
                    "loss_aversion_loss_to_win_multiplier": threshold_values["loss_aversion_loss_to_win_multiplier"],
                    "loss_abs_threshold": loss_threshold,
                },
                "comparison": {
                    "loss_abs_check": _format_comparison(
                        loss_aversion_inputs["loss_abs_pnl"],
                        ">",
                        loss_threshold,
                    ),
                },
                "fired": bool(loss_aversion_fired.iloc[idx]),
            },
            {
                "rule_id": "DAILY_MAX_LOSS_STOP",
                "inputs": risk_inputs,
                "thresholds": {},
                "comparison": {"blocked_reason_check": f"{blocked_reason} == DAILY_MAX_LOSS"},
                "fired": blocked_reason == "DAILY_MAX_LOSS",
            },
            {
                "rule_id": "OVERTRADING_COOLDOWN_SKIP_REPLAY",
                "inputs": {
                    "resulting_simulated_pnl": overtrading_inputs["resulting_simulated_pnl"],
                    "size_usd_before": overtrading_inputs["size_usd_before"],
                    "size_usd_after": overtrading_inputs["size_usd_after"],
                    "effective_scale": overtrading_inputs["effective_scale"],
                },
                "thresholds": {"cooldown_minutes": overtrading_inputs["cooldown_minutes"]},
                "comparison": {"cooldown_skip_applied": f"{replay_deferred} == True"},
                "fired": replay_deferred,
            },
            {
                "rule_id": "REVENGE_SIZE_RESCALE_REPLAY",
                "inputs": {
                    "current_trade_size_usd": revenge_inputs["current_trade_size_usd"],
                    "rolling_median_size_usd": revenge_inputs["rolling_median_size_usd"],
                    "resulting_simulated_pnl": simulated_pnl,
                    "size_usd_after": simulated_size_usd,
                    "effective_scale": replay_effective_scale,
                    "rescale_factor": replay_rescale_factor,
                },
                "thresholds": {"rescale_cap_multiplier": 1.0},
                "comparison": {
                    "rescale_applied": f"{replay_rescaled} == True",
                },
                "fired": replay_rescaled,
            },
            {
                "rule_id": "LOSS_AVERSION_CAP_REPLAY",
                "inputs": {
                    "loss_abs_pnl": loss_aversion_inputs["loss_abs_pnl"],
                    "loss_abs_threshold": loss_threshold,
                    "loss_cap_value": loss_aversion_inputs["loss_cap_value"],
                    "resulting_simulated_pnl": simulated_pnl,
                    "size_usd_before": loss_aversion_inputs["size_usd_before"],
                    "size_usd_after": loss_aversion_inputs["size_usd_after"],
                    "effective_scale": loss_aversion_inputs["effective_scale"],
                    "loss_cap_scale": loss_aversion_inputs["loss_cap_scale"],
                },
                "thresholds": {
                    "loss_aversion_loss_to_win_multiplier": threshold_values["loss_aversion_loss_to_win_multiplier"],
                },
                "comparison": {
                    "loss_cap_applied": f"{replay_loss_capped} == True",
                    "loss_cap_scale_check": _format_comparison(
                        loss_aversion_inputs["loss_cap_scale"],
                        "<",
                        1.0,
                    ),
                },
                "fired": replay_loss_capped,
            },
        ]

        if blocked_reason == "DAILY_MAX_LOSS":
            decision = "SKIP"
            reason = "DAILY_MAX_LOSS_STOP"
        elif replay_deferred:
            decision = "SKIP"
            reason = "OVERTRADING_COOLDOWN_SKIP"
        elif replay_rescaled:
            decision = "KEEP"
            reason = "REVENGE_SIZE_RESCALED"
        elif replay_loss_capped:
            decision = "KEEP"
            reason = "LOSS_AVERSION_CAPPED"
        elif blocked_reason == "BIAS":
            decision = "SKIP"
            reason = "BIAS_RULE_BLOCK"
        else:
            decision = "KEEP"
            reason = "NO_BLOCK"

        if blocked_reason == "DAILY_MAX_LOSS":
            explain_like_im_5 = (
                "You hit the daily loss guardrail, so trading stops for the day to prevent deeper losses."
            )
        elif replay_deferred:
            rolling_count_value = _float_or_none(overtrading_inputs["rolling_trade_count_1h"]) or 0.0
            threshold_value = float(threshold_values["overtrading_trade_threshold"])
            explain_like_im_5 = (
                "You were trading far more frequently than normal, so this trade was skipped during cooldown "
                f"(details: {rolling_count_value:.0f} trades in last hour, threshold: {threshold_value:.0f})."
            )
        elif replay_rescaled and bool(revenge_fired.iloc[idx]):
            scale_text = (
                f"{(replay_effective_scale * 100.0):.4f}%"
                if replay_effective_scale is not None
                else "n/a"
            )
            explain_like_im_5 = (
                f"You just had a big loss ({format_currency_short(revenge_inputs['prev_trade_pnl'])}) and increased size "
                f"to {format_currency_short(revenge_inputs['current_trade_size_usd'])}, so replay scaled exposure to {scale_text}."
            )
        elif replay_loss_capped and bool(loss_aversion_fired.iloc[idx]):
            scale_text = (
                f"{(replay_effective_scale * 100.0):.6f}%"
                if replay_effective_scale is not None
                else "n/a"
            )
            explain_like_im_5 = (
                f"This loss was much larger than your typical win, so replay kept the same price move but scaled "
                f"exposure to {scale_text} to cap downside near {format_currency_short(-replay_loss_cap_value if replay_loss_cap_value is not None else None)}."
            )
        elif blocked_reason == "BIAS" and bool(revenge_fired.iloc[idx]):
            explain_like_im_5 = (
                f"This loss ({format_currency_short(pnl)}) was much larger than your typical win "
                f"({format_currency_short(median_win)}), so replay marked it as bias-risk context."
            )
        else:
            explain_like_im_5 = "No hard rule block fired, so this trade stays in the disciplined replay."

        trace_records.append(
            {
                "trade_id": idx,
                "timestamp": str(row.get("timestamp", "")),
                "asset": str(row.get("asset", "")),
                "side": str(row.get("side", "")) if row.get("side") is not None else None,
                "pnl": pnl,
                "size_usd": _float_or_none(row.get("size_usd")),
                "simulated_pnl": simulated_pnl,
                "simulated_size_usd": simulated_size_usd,
                "impact_abs": impact_abs,
                "blocked_reason": blocked_reason,
                "is_revenge": is_revenge,
                "is_overtrading": is_overtrading,
                "is_loss_aversion": is_loss_aversion,
                "replay_effective_scale": replay_effective_scale,
                "replay_rescale_factor": replay_rescale_factor,
                "replay_loss_cap_factor": replay_loss_cap_factor,
                "replay_loss_cap_value": replay_loss_cap_value,
                "replay_deferred": replay_deferred,
                "replay_rescaled": replay_rescaled,
                "replay_loss_capped": replay_loss_capped,
                "replay_deferred_target_index": deferred_target_index,
                "replay_deferred_target_trade": deferred_target_trade,
                "rule_hits": rule_hits,
                "decision": decision,
                "reason": reason,
                "triggering_prior_trade": prev_trade if bool(revenge_fired.iloc[idx]) else None,
                "explain_like_im_5": explain_like_im_5,
            }
        )
    return trace_records


def _write_trace_artifact(job_id: str, trace_records: list[dict[str, Any]]) -> Path:
    path = _trace_path(job_id)
    lines = [json.dumps(record, sort_keys=True) for record in trace_records]
    path.write_text(("\n".join(lines) + "\n") if lines else "", encoding="utf-8")
    return path


def _read_trace_artifact(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError("decision_trace artifact contains non-object line")
        records.append(dict(payload))
    return records


def _load_or_build_trace(job_id: str, counterfactual_frame: pd.DataFrame) -> list[dict[str, Any]]:
    path = _trace_path(job_id)
    if path.exists():
        try:
            records = _read_trace_artifact(path)
            required_trace_fields = {
                "replay_effective_scale",
                "simulated_size_usd",
                "replay_loss_cap_value",
                "replay_loss_cap_factor",
                "replay_rescale_factor",
            }
            has_required_schema = bool(records) and required_trace_fields.issubset(
                set(records[0].keys())
            )
            if len(records) == len(counterfactual_frame) and has_required_schema:
                return records
        except Exception:
            pass
    records = _build_decision_trace_records(counterfactual_frame)
    _write_trace_artifact(job_id, records)
    return records


def _input_csv_path(job_id: str) -> Path:
    return _job_dir(job_id) / "input.csv"


def _load_raw_input_frame(job_id: str) -> pd.DataFrame:
    path = _input_csv_path(job_id)
    if not path.exists():
        raise FileNotFoundError("input.csv not found")
    try:
        frame = pd.read_csv(path)
    except Exception as exc:
        raise ValueError(f"input.csv is unreadable: {exc}") from exc
    if frame.empty:
        raise ValueError("input.csv has no rows")
    return frame


def _find_first_column(df: pd.DataFrame, candidates: list[str]) -> str | None:
    lookup = {str(col).strip().lower(): col for col in df.columns}
    for candidate in candidates:
        resolved = lookup.get(candidate.strip().lower())
        if resolved is not None:
            return str(resolved)
    return None


def _missing_mask(series: pd.Series) -> pd.Series:
    missing = series.isna()
    if pd.api.types.is_string_dtype(series.dtype) or series.dtype == object:
        text_missing = series.astype(str).str.strip().eq("")
        missing = missing | text_missing
    return missing


def _balance_from_row(row: dict[str, Any] | None) -> float | None:
    if not isinstance(row, dict):
        return None
    for key in ("balance", "account_balance", "equity"):
        if key in row:
            parsed = _float_or_none(row.get(key))
            if parsed is not None and parsed > 0:
                return parsed
    return None


def _impact_pct_balance(impact_abs: float | None, balance: float | None) -> float | None:
    if impact_abs is None or balance is None:
        return None
    if not math.isfinite(impact_abs) or not math.isfinite(balance) or balance <= 0:
        return None
    return (abs(impact_abs) / balance) * 100.0


def _compute_data_quality_flags(raw_frame: pd.DataFrame) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    rows = int(len(raw_frame))
    if rows == 0:
        return flags

    quantity_col = _find_first_column(raw_frame, ["quantity", "qty", "size_qty_proxy"])
    pnl_col = _find_first_column(raw_frame, ["profit_loss", "pnl", "closed pnl", "closed_pnl"])
    asset_col = _find_first_column(raw_frame, ["asset", "coin", "symbol"])
    timestamp_col = _find_first_column(raw_frame, ["timestamp", "timestamp ist", "time"])
    balance_col = _find_first_column(raw_frame, ["balance", "account_balance", "equity"])
    entry_col = _find_first_column(raw_frame, ["entry_price", "price", "execution price"])

    quantity_missing = int(_missing_mask(raw_frame[quantity_col]).sum()) if quantity_col else 0
    pnl_missing = int(_missing_mask(raw_frame[pnl_col]).sum()) if pnl_col else 0
    if quantity_missing > 0 or pnl_missing > 0:
        flags.append(
            {
                "code": "MISSING_FIELDS",
                "count": quantity_missing + pnl_missing,
                "message": "Rows with missing quantity/profit values were detected.",
                "details": {
                    "quantity_missing": quantity_missing,
                    "profit_loss_missing": pnl_missing,
                },
            }
        )

    asset_missing = int(_missing_mask(raw_frame[asset_col]).sum()) if asset_col else 0
    if asset_missing > 0:
        flags.append(
            {
                "code": "ASSET_MISSING",
                "count": asset_missing,
                "message": "Rows with missing asset symbols were detected.",
                "details": {
                    "asset_missing": asset_missing,
                    "cadence_only_rows": asset_missing,
                },
            }
        )

    timestamp_missing = int(_missing_mask(raw_frame[timestamp_col]).sum()) if timestamp_col else 0
    excluded_rows = timestamp_missing + pnl_missing
    if excluded_rows > 0:
        flags.append(
            {
                "code": "INCOMPLETE_FOR_BIAS_METRICS",
                "count": excluded_rows,
                "message": "Rows missing timestamp/profit were excluded from bias metrics.",
                "details": {
                    "timestamp_missing": timestamp_missing,
                    "profit_loss_missing": pnl_missing,
                },
            }
        )

    if quantity_col and entry_col and balance_col:
        qty = pd.to_numeric(raw_frame[quantity_col], errors="coerce").abs()
        px = pd.to_numeric(raw_frame[entry_col], errors="coerce").abs()
        bal = pd.to_numeric(raw_frame[balance_col], errors="coerce").abs()
        notional = qty * px
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = notional / bal
        threshold = 100.0
        mask = ratio > threshold
        count = int(mask.fillna(False).sum())
        if count > 0:
            flags.append(
                {
                    "code": "IMPLIED_NOTIONAL_TOO_HIGH",
                    "count": count,
                    "message": "Rows imply notional exposure far above account balance.",
                    "details": {"ratio_threshold": threshold},
                }
            )

    if pnl_col and balance_col:
        pnl = pd.to_numeric(raw_frame[pnl_col], errors="coerce").abs()
        bal = pd.to_numeric(raw_frame[balance_col], errors="coerce").abs()
        with np.errstate(divide="ignore", invalid="ignore"):
            ratio = pnl / bal
        threshold = 20.0
        mask = ratio > threshold
        count = int(mask.fillna(False).sum())
        if count > 0:
            flags.append(
                {
                    "code": "PNL_TO_BALANCE_OUTLIER",
                    "count": count,
                    "message": "Rows have pnl magnitudes far above account balance.",
                    "details": {"ratio_threshold": threshold},
                }
            )

    return flags


def _normalize_timestamp_text(value: Any) -> str:
    if value is None:
        return ""
    raw = str(value).strip()
    if not raw:
        return ""
    parsed = pd.to_datetime(raw, errors="coerce")
    if pd.isna(parsed):
        return raw
    return parsed.isoformat().replace("+00:00", "")


def _pnl_matches(left: Any, right: Any, *, atol: float = 1e-9) -> bool:
    left_f = _float_or_none(left)
    right_f = _float_or_none(right)
    if left_f is None or right_f is None:
        return False
    return math.isclose(left_f, right_f, rel_tol=0.0, abs_tol=atol)


def _find_raw_input_row(
    input_frame: pd.DataFrame,
    *,
    trace_record: dict[str, Any],
    trade_id: int,
) -> dict[str, Any] | None:
    cleaned = input_frame.where(pd.notna(input_frame), None).to_dict(orient="records")
    if 0 <= trade_id < len(cleaned):
        candidate = cleaned[trade_id]
        if isinstance(candidate, dict):
            return dict(candidate)

    trace_ts = _normalize_timestamp_text(trace_record.get("timestamp"))
    trace_asset = str(trace_record.get("asset", "")).strip()
    trace_side = str(trace_record.get("side", "")).strip().lower()
    trace_pnl = trace_record.get("pnl")

    for row in cleaned:
        if not isinstance(row, dict):
            continue
        row_ts = _normalize_timestamp_text(row.get("timestamp"))
        row_asset = str(row.get("asset", "")).strip()
        if row_ts != trace_ts or row_asset != trace_asset:
            continue
        if trace_side:
            row_side = str(row.get("side", "")).strip().lower()
            if row_side and row_side != trace_side:
                continue
        if trace_pnl is not None:
            row_pnl = row.get("pnl")
            if row_pnl is not None and not _pnl_matches(row_pnl, trace_pnl):
                continue
        return dict(row)
    return None


def _find_balance_for_timestamp_asset(
    input_frame: pd.DataFrame | None,
    *,
    timestamp: Any,
    asset: Any,
) -> float | None:
    if input_frame is None:
        return None
    target_ts = _normalize_timestamp_text(timestamp)
    target_asset = str(asset or "").strip()
    if not target_ts and not target_asset:
        return None
    rows = input_frame.where(pd.notna(input_frame), None).to_dict(orient="records")
    for row in rows:
        if not isinstance(row, dict):
            continue
        row_ts = _normalize_timestamp_text(row.get("timestamp"))
        row_asset = str(row.get("asset", "")).strip()
        if target_ts and row_ts != target_ts:
            continue
        if target_asset and row_asset != target_asset:
            continue
        balance = _balance_from_row(row)
        if balance is not None:
            return balance
    return None


def _trace_record_for_row(
    row: dict[str, Any],
    trace_records: list[dict[str, Any]],
) -> dict[str, Any] | None:
    index_value = row.get("_source_index")
    if isinstance(index_value, (int, float)) and not isinstance(index_value, bool):
        index_int = int(index_value)
        if 0 <= index_int < len(trace_records):
            return dict(trace_records[index_int])

    row_ts = str(row.get("timestamp", ""))
    row_asset = str(row.get("asset", ""))
    for record in trace_records:
        if str(record.get("timestamp", "")) == row_ts and str(record.get("asset", "")) == row_asset:
            return dict(record)
    return None


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


@app.post("/api/upload")
async def api_upload_csv(
    request: Request,
    userId: str | None = None,
    run_async: bool = True,
) -> JSONResponse:
    try:
        csv_bytes, fields = await _extract_csv_and_fields(request)
    except ValueError as exc:
        return JSONResponse(
            status_code=400,
            content={"error": str(exc)},
        )

    user_id_value = (
        fields.get("userId")
        or fields.get("user_id")
        or userId
        or "demo-user"
    )
    user_id_value = str(user_id_value).strip() if user_id_value is not None else "demo-user"
    if not user_id_value:
        user_id_value = "demo-user"

    if len(csv_bytes) > _max_upload_bytes():
        return JSONResponse(
            status_code=413,
            content={"error": f"Upload exceeds MAX_UPLOAD_MB={_max_upload_bytes() // (1024 * 1024)}"},
        )

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

    if run_async:
        _schedule_job(
            job_id=job_id,
            input_path=input_path,
            out_dir=out_dir,
            user_id=user_id_value,
            daily_max_loss=None,
            k_repeat=1,
            max_seconds=120.0,
        )
    else:
        await _process_job(
            job_id=job_id,
            input_path=input_path,
            out_dir=out_dir,
            user_id=user_id_value,
            daily_max_loss=None,
            k_repeat=1,
            max_seconds=120.0,
        )

    return JSONResponse(
        status_code=202,
        content={
            "jobId": job_id,
            "status": "PENDING",
            "validRows": 0,
            "parseErrors": [],
        },
    )


@app.post("/api/analyze")
async def api_analyze(request: Request) -> JSONResponse:
    try:
        payload = await _optional_json_body(request)
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"error": str(exc)})

    job_id = payload.get("jobId") or payload.get("job_id")
    if not isinstance(job_id, str) or not job_id.strip():
        return JSONResponse(status_code=400, content={"error": "jobId is required"})
    job_id = job_id.strip()

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return JSONResponse(
            status_code=422,
            content={
                "status": "FAILED",
                "jobId": exc.job_id or job_id,
                "error": "Corrupt job record",
            },
        )

    if job is None:
        return JSONResponse(status_code=404, content={"error": "Job not found", "jobId": job_id})

    execution_status = _job_payload(job)["execution_status"]
    api_status = _api_status_from_execution_status(execution_status)
    response: dict[str, Any] = {
        "jobId": job_id,
        "status": api_status,
    }
    if api_status == "COMPLETED":
        response["sessionsAnalyzed"] = 1
        response["sessionIds"] = [job_id]
    elif api_status == "FAILED":
        response["error"] = _api_parse_error_message(job) or "Analysis failed"
    return JSONResponse(status_code=200, content=_json_safe(response))


@app.get("/api/jobs/{job_id}")
async def api_job_status(job_id: str) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError:
        return JSONResponse(
            status_code=422,
            content={"jobId": job_id, "status": "FAILED", "error": "Corrupt job record"},
        )
    if job is None:
        return JSONResponse(status_code=404, content={"jobId": job_id, "error": "Job not found"})

    execution_status = _job_payload(job)["execution_status"]
    api_status = _api_status_from_execution_status(execution_status)
    payload: dict[str, Any] = {
        "jobId": job_id,
        "status": api_status,
    }
    if api_status == "COMPLETED":
        payload["sessionIds"] = [job_id]
    elif api_status == "FAILED":
        payload["error"] = _api_parse_error_message(job) or "Analysis failed"
    return JSONResponse(status_code=200, content=_json_safe(payload))


@app.get("/api/history")
async def api_history(userId: str = "demo-user", limit: int = 20) -> JSONResponse:
    if limit < 1:
        limit = 1
    if limit > LIST_JOBS_LIMIT_MAX:
        limit = LIST_JOBS_LIMIT_MAX

    user_id = userId.strip() or "demo-user"

    rows: list[dict[str, Any]] = []
    try:
        supabase_rows = _supabase_store().list_jobs_for_user(user_id=user_id, limit=limit)
    except SupabaseSyncError:
        supabase_rows = []

    for row in supabase_rows:
        rows.append(
            {
                "job_id": row.get("id"),
                "id": row.get("id"),
                "created_at": row.get("created_at"),
                "status": row.get("status"),
                "execution_status": row.get("status"),
                "outcome": row.get("outcome"),
                "delta_pnl": row.get("delta_pnl"),
                "cost_of_bias": row.get("cost_of_bias"),
                "bias_rates": row.get("bias_rates") if isinstance(row.get("bias_rates"), dict) else {},
            }
        )

    if not rows:
        rows = _history_rows_local(user_id=user_id, limit=limit)

    reports, current_elo = _history_reports_from_rows(rows)
    return JSONResponse(
        status_code=200,
        content=_json_safe(
            {
                "reports": reports,
                "currentElo": current_elo,
            }
        ),
    )


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

    if len(csv_bytes) > _max_upload_bytes():
        return _envelope(
            ok=False,
            job=None,
            data=None,
            error_code="PAYLOAD_TOO_LARGE",
            error_message=f"Upload exceeds MAX_UPLOAD_MB={_max_upload_bytes() // (1024 * 1024)}",
            status_code=413,
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
    except SupabaseSyncError:
        # Demo-safe fallback: preserve list contract when Supabase is temporarily unavailable.
        rows = _history_rows_local(user_id=user_id, limit=limit)

    jobs: list[dict[str, Any]] = []
    for row in rows:
        status_value = row.get("status") or row.get("execution_status")
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
                "job_id": row.get("id") or row.get("job_id"),
                "user_id": row.get("user_id") or user_id,
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
    raw_input_frame: pd.DataFrame | None = None
    try:
        raw_input_frame = _load_raw_input_frame(job_id)
        data["data_quality_flags"] = _compute_data_quality_flags(raw_input_frame)
    except Exception:
        data["data_quality_flags"] = []

    review_path = _job_dir(job_id) / "review.json"
    if review_path.exists():
        review = json.loads(review_path.read_text())
        top = []
        for item in review.get("top_moments", [])[:3]:
            top.append(
                {
                    "label": item.get("label"),
                    "bias_category": item.get("bias_category"),
                    "timestamp": item.get("timestamp"),
                    "asset": item.get("asset"),
                    "pnl": _safe_float(item.get("actual_pnl")),
                    "simulated_pnl": _safe_float(item.get("simulated_pnl")),
                    "disciplined_replay_pnl": _safe_float(item.get("simulated_pnl")),
                    "policy_replay_pnl": _safe_float(item.get("simulated_pnl")),
                    "impact": _safe_float(item.get("impact")),
                    "impact_pct_balance": _impact_pct_balance(
                        _safe_float(item.get("impact")),
                        _find_balance_for_timestamp_asset(
                            raw_input_frame,
                            timestamp=item.get("timestamp"),
                            asset=item.get("asset"),
                        ),
                    ),
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


@app.get("/jobs/{job_id}/elo")
async def get_job_elo(job_id: str) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"elo": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"elo": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    status = _job_payload(job)["execution_status"]
    summary = dict(job.summary or {})
    outcome = summary.get("outcome")
    delta_pnl = _safe_float(summary.get("delta_pnl"))
    elo_delta = _elo_delta_from_job(
        outcome=outcome,
        delta_pnl=delta_pnl,
        status=status,
    )
    base_elo = 1200.0

    badge_counts = summary.get("badge_counts")
    if not isinstance(badge_counts, dict):
        badge_counts = {}

    return _envelope(
        ok=True,
        job=job,
        data={
            "status": status,
            "outcome": outcome,
            "delta_pnl": delta_pnl,
            "badge_counts": badge_counts,
            "elo": {
                "base": base_elo,
                "delta": float(elo_delta),
                "projected": float(base_elo + float(elo_delta)),
                "formula": "deterministic outcome/delta-based mapping",
            },
        },
    )


@app.get("/jobs/{job_id}/move-review")
async def get_move_review(job_id: str) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"move_review": []},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"move_review": []},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    try:
        review_payload = _read_review_payload(job_id)
        counterfactual_rows = _read_counterfactual_rows(job_id)
        move_review = build_deterministic_move_review(
            review_payload,
            counterfactual_rows,
        )
    except (CoachGenerationError, MoveExplanationError) as exc:
        error_message = str(exc)
        lowered = error_message.lower()
        if "artifact missing" in lowered:
            return _envelope(
                ok=False,
                job=job,
                data={"move_review": []},
                error_code="MOVE_REVIEW_NOT_READY",
                error_message=error_message,
                status_code=409,
            )
        return _envelope(
            ok=False,
            job=job,
            data={"move_review": []},
            error_code="MOVE_REVIEW_GENERATION_FAILED",
            error_message=error_message,
            status_code=422,
        )

    return _envelope(
        ok=True,
        job=job,
        data={
            "move_review": move_review,
            "source": "deterministic_contract_templates",
        },
    )


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

    try:
        review_payload = _read_review_payload(job_id)
        counterfactual_rows = _read_counterfactual_rows(job_id)
        deterministic_move_review = build_deterministic_move_review(
            review_payload,
            counterfactual_rows,
        )
    except (CoachGenerationError, MoveExplanationError) as exc:
        error_payload = {
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "when": utc_now_iso(),
            "vertex_request_id": None,
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

    coach_input = _coach_prompt_payload(
        job,
        review=review_payload,
        deterministic_move_review=deterministic_move_review,
    )

    try:
        generated = await asyncio.to_thread(generate_coach_via_vertex, coach_input)
        coach_payload = _validate_coach_schema(
            generated,
            expected_move_review=deterministic_move_review,
        )
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


@app.post("/jobs/{job_id}/trade/{trade_id}/coach")
async def generate_trade_coach(job_id: str, trade_id: int, force: bool = False) -> JSONResponse:
    if trade_id < 0:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"trade_coach": None},
            error_code="INVALID_TRADE_ID",
            error_message="trade_id must be >= 0",
            status_code=400,
        )

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"trade_coach": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"trade_coach": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    status = _job_payload(job)["execution_status"]
    if status != "COMPLETED":
        return _envelope(
            ok=False,
            job=job,
            data={"trade_coach": None, "execution_status": status},
            error_code="JOB_NOT_READY",
            error_message="Job must be COMPLETED before trade coach generation.",
            status_code=409,
        )

    coach_path, coach_error_path = _trade_coach_paths(job_id, trade_id)
    if coach_path.exists() and not force:
        try:
            existing = _load_json_file(coach_path)
        except Exception as exc:
            return _envelope(
                ok=False,
                job=job,
                data={"trade_coach": None},
                error_code="TRADE_COACH_READ_FAILED",
                error_message=f"Stored trade coach artifact is unreadable: {exc}",
                status_code=409,
            )
        return _envelope(
            ok=True,
            job=job,
            data={"trade_coach": existing, "cached": True},
            status_code=200,
        )

    trade_response = await get_trade_inspector(job_id, trade_id)
    trade_payload_envelope = json.loads(trade_response.body.decode("utf-8"))
    if trade_response.status_code != 200 or not bool(trade_payload_envelope.get("ok")):
        return trade_response
    trade_payload_data = trade_payload_envelope.get("data", {})
    if not isinstance(trade_payload_data, dict):
        return _envelope(
            ok=False,
            job=job,
            data={"trade_coach": None},
            error_code="TRADE_NOT_FOUND",
            error_message="Trade payload was unavailable for coach generation.",
            status_code=404,
        )
    trade_payload = trade_payload_data.get("trade")
    if not isinstance(trade_payload, dict):
        return _envelope(
            ok=False,
            job=job,
            data={"trade_coach": None},
            error_code="TRADE_NOT_FOUND",
            error_message="Trade payload was unavailable for coach generation.",
            status_code=404,
        )

    expected_label = str(trade_payload.get("label", "GOOD")).strip().upper()
    if expected_label not in COACH_ALLOWED_MOVE_LABELS:
        expected_label = "GOOD"
    try:
        metric_refs = _trade_metric_refs(trade_payload)
    except CoachGenerationError as exc:
        error_payload = {
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "when": utc_now_iso(),
            "vertex_request_id": None,
            "trade_id": trade_id,
        }
        coach_error_path.write_text(json.dumps(error_payload, indent=2, sort_keys=True) + "\n")
        updated_artifacts = dict(job.artifacts)
        updated_artifacts[f"trade_coach_error_{trade_id}_json"] = str(coach_error_path)
        updated_artifacts.pop(f"trade_coach_{trade_id}_json", None)
        updated_job = JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            created_at=job.created_at,
            engine_version=job.engine_version,
            input_sha256=job.input_sha256,
            status=job.status,
            artifacts=updated_artifacts,
            upload=job.upload,
            summary=dict(job.summary or {}),
        )
        _persist_job_record(updated_job, include_artifacts_sync=True)
        return _envelope(
            ok=False,
            job=updated_job,
            data={"trade_coach_error": error_payload},
            error_code="TRADE_COACH_GENERATION_FAILED",
            error_message="Trade coach generation failed.",
            error_details=error_payload,
            status_code=502,
        )

    trade_input = _trade_coach_prompt_payload(
        job,
        trade_payload=trade_payload,
        metric_refs=metric_refs,
    )

    try:
        generated = await asyncio.to_thread(generate_trade_coach_via_vertex, trade_input)
        trade_coach_payload = _validate_trade_coach_schema(
            generated,
            expected_trade_id=trade_id,
            expected_label=expected_label,
            expected_metric_refs=metric_refs,
        )
    except Exception as exc:
        request_id = getattr(exc, "vertex_request_id", None)
        error_payload = {
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "when": utc_now_iso(),
            "vertex_request_id": request_id,
            "trade_id": trade_id,
        }
        coach_error_path.write_text(json.dumps(error_payload, indent=2, sort_keys=True) + "\n")
        updated_artifacts = dict(job.artifacts)
        updated_artifacts[f"trade_coach_error_{trade_id}_json"] = str(coach_error_path)
        updated_artifacts.pop(f"trade_coach_{trade_id}_json", None)
        updated_job = JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            created_at=job.created_at,
            engine_version=job.engine_version,
            input_sha256=job.input_sha256,
            status=job.status,
            artifacts=updated_artifacts,
            upload=job.upload,
            summary=dict(job.summary or {}),
        )
        _persist_job_record(updated_job, include_artifacts_sync=True)
        return _envelope(
            ok=False,
            job=updated_job,
            data={"trade_coach_error": error_payload},
            error_code="TRADE_COACH_GENERATION_FAILED",
            error_message="Trade coach generation failed.",
            error_details=error_payload,
            status_code=502,
        )

    coach_path.write_text(json.dumps(trade_coach_payload, indent=2, sort_keys=True) + "\n")
    if coach_error_path.exists():
        coach_error_path.unlink()

    updated_artifacts = dict(job.artifacts)
    updated_artifacts[f"trade_coach_{trade_id}_json"] = str(coach_path)
    updated_artifacts.pop(f"trade_coach_error_{trade_id}_json", None)
    updated_job = JobRecord(
        job_id=job.job_id,
        user_id=job.user_id,
        created_at=job.created_at,
        engine_version=job.engine_version,
        input_sha256=job.input_sha256,
        status=job.status,
        artifacts=updated_artifacts,
        upload=job.upload,
        summary=dict(job.summary or {}),
    )
    _persist_job_record(updated_job, include_artifacts_sync=True)
    return _envelope(
        ok=True,
        job=updated_job,
        data={"trade_coach": trade_coach_payload, "cached": False},
        status_code=200,
    )


@app.get("/jobs/{job_id}/trade/{trade_id}/coach")
async def get_trade_coach(job_id: str, trade_id: int) -> JSONResponse:
    if trade_id < 0:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"trade_coach": None},
            error_code="INVALID_TRADE_ID",
            error_message="trade_id must be >= 0",
            status_code=400,
        )

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"trade_coach": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"trade_coach": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    coach_path, coach_error_path = _trade_coach_paths(job_id, trade_id)
    if coach_path.exists():
        try:
            payload = _load_json_file(coach_path)
        except Exception as exc:
            return _envelope(
                ok=False,
                job=job,
                data={"trade_coach": None},
                error_code="TRADE_COACH_READ_FAILED",
                error_message=f"Stored trade coach artifact is unreadable: {exc}",
                status_code=409,
            )
        return _envelope(
            ok=True,
            job=job,
            data={"trade_coach": payload},
            status_code=200,
        )

    if coach_error_path.exists():
        try:
            error_payload = _load_json_file(coach_error_path)
        except Exception as exc:
            error_payload = {
                "error_type": "CorruptTradeCoachErrorArtifact",
                "error_message": str(exc),
                "when": utc_now_iso(),
                "trade_id": trade_id,
            }
        return _envelope(
            ok=False,
            job=job,
            data={"trade_coach_error": error_payload},
            error_code="TRADE_COACH_FAILED",
            error_message="Trade coach generation previously failed.",
            error_details=error_payload,
            status_code=409,
        )

    return _envelope(
        ok=False,
        job=job,
        data={"trade_coach": None},
        error_code="TRADE_COACH_NOT_FOUND",
        error_message="Trade coach artifact not found for this trade.",
        status_code=404,
    )


@app.post("/jobs/{job_id}/trade/{trade_id}/voice")
async def generate_trade_voice(
    job_id: str,
    trade_id: int,
    provider: str = "auto",
    force: bool = False,
) -> JSONResponse:
    if trade_id < 0:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"voice": None},
            error_code="INVALID_TRADE_ID",
            error_message="trade_id must be >= 0",
            status_code=400,
        )

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"voice": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"voice": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    status = _job_payload(job)["execution_status"]
    if status != "COMPLETED":
        return _envelope(
            ok=False,
            job=job,
            data={"voice": None, "execution_status": status},
            error_code="JOB_NOT_READY",
            error_message="Job must be COMPLETED before trade voice generation.",
            status_code=409,
        )

    audio_path, meta_path, error_path = _trade_voice_paths(job_id, trade_id)
    if audio_path.exists() and meta_path.exists() and not force:
        try:
            voice_meta = _load_json_file(meta_path)
        except Exception:
            voice_meta = {
                "provider": "unknown",
                "mime_type": "audio/mpeg",
                "artifact": str(audio_path),
            }
        return _envelope(
            ok=True,
            job=job,
            data={"voice": voice_meta, "cached": True},
            status_code=200,
        )

    trade_coach_payload: dict[str, Any] | None = None
    coach_path, _ = _trade_coach_paths(job_id, trade_id)
    if coach_path.exists():
        try:
            trade_coach_payload = _load_json_file(coach_path)
        except Exception:
            trade_coach_payload = None

    if trade_coach_payload is None:
        existing = await get_trade_coach(job_id, trade_id)
        if existing.status_code == 200:
            existing_payload = json.loads(existing.body.decode("utf-8"))
            trade_coach = existing_payload.get("data", {}).get("trade_coach")
            if isinstance(trade_coach, dict):
                trade_coach_payload = trade_coach
        elif existing.status_code == 404:
            generated = await generate_trade_coach(job_id, trade_id, force=force)
            if generated.status_code != 200:
                return generated
            generated_payload = json.loads(generated.body.decode("utf-8"))
            trade_coach = generated_payload.get("data", {}).get("trade_coach")
            if isinstance(trade_coach, dict):
                trade_coach_payload = trade_coach
        elif existing.status_code == 409:
            existing_payload = json.loads(existing.body.decode("utf-8"))
            error_code = str(existing_payload.get("error", {}).get("code", "")).strip()
            if error_code in {"TRADE_COACH_FAILED", "TRADE_COACH_READ_FAILED"}:
                regenerated = await generate_trade_coach(job_id, trade_id, force=True)
                if regenerated.status_code != 200:
                    return regenerated
                regenerated_payload = json.loads(regenerated.body.decode("utf-8"))
                trade_coach = regenerated_payload.get("data", {}).get("trade_coach")
                if isinstance(trade_coach, dict):
                    trade_coach_payload = trade_coach
            else:
                return existing
        else:
            return existing

    if not isinstance(trade_coach_payload, dict):
        return _envelope(
            ok=False,
            job=job,
            data={"voice": None},
            error_code="TRADE_COACH_NOT_FOUND",
            error_message="Trade coach text is unavailable for voice synthesis.",
            status_code=404,
        )

    try:
        script = _trade_voice_script(trade_coach_payload)
        provider_used, audio_bytes = await asyncio.to_thread(
            _synthesize_trade_voice,
            script,
            provider,
        )
        audio_path.write_bytes(audio_bytes)
        voice_meta = {
            "provider": provider_used,
            "mime_type": "audio/mpeg",
            "artifact": str(audio_path),
            "trade_id": trade_id,
            "generated_at": utc_now_iso(),
        }
        meta_path.write_text(json.dumps(voice_meta, indent=2, sort_keys=True) + "\n")
        if error_path.exists():
            error_path.unlink()

        updated_artifacts = dict(job.artifacts)
        updated_artifacts[f"trade_coach_voice_{trade_id}_mp3"] = str(audio_path)
        updated_artifacts[f"trade_coach_voice_{trade_id}_json"] = str(meta_path)
        updated_artifacts.pop(f"trade_coach_voice_error_{trade_id}_json", None)
        updated_job = JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            created_at=job.created_at,
            engine_version=job.engine_version,
            input_sha256=job.input_sha256,
            status=job.status,
            artifacts=updated_artifacts,
            upload=job.upload,
            summary=dict(job.summary or {}),
        )
        _persist_job_record(updated_job, include_artifacts_sync=True)
        return _envelope(
            ok=True,
            job=updated_job,
            data={"voice": voice_meta, "cached": False},
            status_code=200,
        )
    except Exception as exc:
        error_payload = {
            "error_type": type(exc).__name__,
            "error_message": str(exc),
            "when": utc_now_iso(),
            "trade_id": trade_id,
            "provider": provider,
        }
        error_path.write_text(json.dumps(error_payload, indent=2, sort_keys=True) + "\n")
        updated_artifacts = dict(job.artifacts)
        updated_artifacts[f"trade_coach_voice_error_{trade_id}_json"] = str(error_path)
        updated_artifacts.pop(f"trade_coach_voice_{trade_id}_mp3", None)
        updated_artifacts.pop(f"trade_coach_voice_{trade_id}_json", None)
        updated_job = JobRecord(
            job_id=job.job_id,
            user_id=job.user_id,
            created_at=job.created_at,
            engine_version=job.engine_version,
            input_sha256=job.input_sha256,
            status=job.status,
            artifacts=updated_artifacts,
            upload=job.upload,
            summary=dict(job.summary or {}),
        )
        _persist_job_record(updated_job, include_artifacts_sync=True)
        return _envelope(
            ok=False,
            job=updated_job,
            data={"voice_error": error_payload},
            error_code="TRADE_VOICE_GENERATION_FAILED",
            error_message="Trade voice generation failed.",
            error_details=error_payload,
            status_code=502,
        )


@app.get("/jobs/{job_id}/trade/{trade_id}/voice")
async def get_trade_voice(job_id: str, trade_id: int) -> Response:
    if trade_id < 0:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"voice": None},
            error_code="INVALID_TRADE_ID",
            error_message="trade_id must be >= 0",
            status_code=400,
        )

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"voice": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"voice": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    audio_path, _, error_path = _trade_voice_paths(job_id, trade_id)
    if audio_path.exists():
        return Response(
            content=audio_path.read_bytes(),
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )

    if error_path.exists():
        try:
            error_payload = _load_json_file(error_path)
        except Exception as exc:
            error_payload = {
                "error_type": "CorruptTradeVoiceErrorArtifact",
                "error_message": str(exc),
                "when": utc_now_iso(),
            }
        return _envelope(
            ok=False,
            job=job,
            data={"voice_error": error_payload},
            error_code="TRADE_VOICE_FAILED",
            error_message="Trade voice generation previously failed.",
            error_details=error_payload,
            status_code=409,
        )

    return _envelope(
        ok=False,
        job=job,
        data={"voice": None},
        error_code="TRADE_VOICE_NOT_FOUND",
        error_message="Trade voice artifact not found for this trade.",
        status_code=404,
    )


@app.post("/jobs/{job_id}/journal/transcribe")
async def transcribe_journal(job_id: str, request: Request) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"transcript": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"transcript": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    try:
        audio_bytes, mime_type, filename = await _extract_audio_upload(request)
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"transcript": None},
            error_code="INVALID_AUDIO",
            error_message=str(exc),
            status_code=400,
        )

    if not audio_bytes:
        return _envelope(
            ok=False,
            job=job,
            data={"transcript": None},
            error_code="INVALID_AUDIO",
            error_message="Uploaded audio file is empty.",
            status_code=400,
        )
    if len(audio_bytes) > _max_upload_bytes():
        return _envelope(
            ok=False,
            job=job,
            data={"transcript": None},
            error_code="PAYLOAD_TOO_LARGE",
            error_message=f"Audio exceeds MAX_UPLOAD_MB={_max_upload_bytes() // (1024 * 1024)}",
            status_code=413,
        )

    try:
        transcript_payload = await asyncio.to_thread(
            transcribe_with_gradium,
            audio_bytes,
            mime_type=mime_type,
        )
    except Exception as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"transcript": None},
            error_code="TRANSCRIPTION_FAILED",
            error_message=str(exc),
            error_details={"error_type": type(exc).__name__},
            status_code=502,
        )

    transcript_artifact = {
        "provider": transcript_payload.get("provider", "gradium"),
        "filename": filename,
        "mime_type": mime_type,
        "byte_size": len(audio_bytes),
        "transcript": transcript_payload.get("transcript"),
        "created_at": utc_now_iso(),
        "raw": transcript_payload.get("raw"),
    }
    transcript_path = _journal_transcript_path(job_id)
    transcript_path.write_text(json.dumps(transcript_artifact, indent=2, sort_keys=True) + "\n")

    updated_artifacts = dict(job.artifacts)
    updated_artifacts[transcript_path.stem] = str(transcript_path)
    updated_job = JobRecord(
        job_id=job.job_id,
        user_id=job.user_id,
        created_at=job.created_at,
        engine_version=job.engine_version,
        input_sha256=job.input_sha256,
        status=job.status,
        artifacts=updated_artifacts,
        upload=job.upload,
        summary=dict(job.summary or {}),
    )
    _persist_job_record(updated_job, include_artifacts_sync=True)

    return _envelope(
        ok=True,
        job=updated_job,
        data={
            "transcript": transcript_artifact.get("transcript"),
            "provider": transcript_artifact.get("provider"),
            "artifact": str(transcript_path),
            "mime_type": mime_type,
        },
        status_code=200,
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


@app.get("/jobs/{job_id}/counterfactual/series")
async def get_counterfactual_series(job_id: str, max_points: int = 2000) -> JSONResponse:
    if max_points < 1 or max_points > 20000:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"points": [], "markers": [], "total_points": 0, "returned_points": 0},
            error_code="INVALID_MAX_POINTS",
            error_message="max_points must be between 1 and 20000",
            status_code=400,
        )

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"points": [], "markers": [], "total_points": 0, "returned_points": 0},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"points": [], "markers": [], "total_points": 0, "returned_points": 0},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    try:
        frame = _load_counterfactual_frame(job_id)
    except FileNotFoundError:
        return _envelope(
            ok=False,
            job=job,
            data={"points": [], "markers": [], "total_points": 0, "returned_points": 0},
            error_code="COUNTERFACTUAL_NOT_READY",
            error_message="Counterfactual rows are not available yet.",
            status_code=409,
        )
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"points": [], "markers": [], "total_points": 0, "returned_points": 0},
            error_code="COUNTERFACTUAL_PARSE_ERROR",
            error_message=str(exc),
            status_code=422,
        )

    required_columns = {"timestamp", "pnl", "simulated_pnl"}
    missing_required = [column for column in required_columns if column not in frame.columns]
    if missing_required:
        return _envelope(
            ok=False,
            job=job,
            data={"points": [], "markers": [], "total_points": 0, "returned_points": 0},
            error_code="COUNTERFACTUAL_SCHEMA_INVALID",
            error_message=f"counterfactual.csv missing required columns: {sorted(missing_required)}",
            status_code=422,
        )

    pnl_series = pd.to_numeric(frame["pnl"], errors="coerce")
    simulated_pnl_series = pd.to_numeric(frame["simulated_pnl"], errors="coerce")
    if pnl_series.isna().any() or simulated_pnl_series.isna().any():
        return _envelope(
            ok=False,
            job=job,
            data={"points": [], "markers": [], "total_points": 0, "returned_points": 0},
            error_code="COUNTERFACTUAL_SCHEMA_INVALID",
            error_message="counterfactual.csv has non-numeric pnl/simulated_pnl values",
            status_code=422,
        )

    actual_equity = pnl_series.cumsum()
    fallback_simulated_equity = simulated_pnl_series.cumsum()
    if "simulated_equity" in frame.columns:
        simulated_equity_series = pd.to_numeric(frame["simulated_equity"], errors="coerce")
        simulated_equity = simulated_equity_series.where(simulated_equity_series.notna(), fallback_simulated_equity)
    else:
        simulated_equity = fallback_simulated_equity

    full_points: list[dict[str, Any]] = []
    for idx in range(len(frame)):
        full_points.append(
            {
                "timestamp": str(frame.iloc[idx]["timestamp"]),
                "actual_equity": float(actual_equity.iloc[idx]),
                "simulated_equity": float(simulated_equity.iloc[idx]),
                "policy_replay_equity": float(simulated_equity.iloc[idx]),
            }
        )

    if not full_points:
        return _envelope(
            ok=False,
            job=job,
            data={"points": [], "markers": [], "total_points": 0, "returned_points": 0},
            error_code="COUNTERFACTUAL_PARSE_ERROR",
            error_message="counterfactual.csv produced no timeline points",
            status_code=422,
        )

    sampled_indices = _downsample_indices(len(full_points), max_points)
    sampled_points = [full_points[idx] for idx in sampled_indices]

    marker_review_payload: dict[str, Any] = {}
    if _review_path(job_id).exists():
        try:
            marker_review_payload = _load_review_payload_for_moments(job_id)
        except Exception:
            marker_review_payload = {}
    frame_rows = frame.to_dict(orient="records")
    marker_rows = _select_top_moment_rows(
        marker_review_payload,
        frame_rows,
    )
    trace_records: list[dict[str, Any]] = []
    try:
        trace_records = _load_or_build_trace(job_id, frame)
    except Exception:
        trace_records = []
    markers: list[dict[str, Any]] = []
    for row in marker_rows:
        trace_record = _trace_record_for_row(row, trace_records) if trace_records else None
        reason_label = _reason_label(
            trace_record=trace_record,
            is_revenge=_trace_bool(row.get("is_revenge")),
            is_overtrading=_trace_bool(row.get("is_overtrading")),
            is_loss_aversion=_trace_bool(row.get("is_loss_aversion")),
        )
        impact_abs = _float_or_none(row.get("impact_abs"))
        if impact_abs is None:
            pnl_v = _float_or_none(row.get("pnl"))
            replay_v = _float_or_none(row.get("simulated_pnl"))
            if pnl_v is not None and replay_v is not None:
                impact_abs = abs(pnl_v - replay_v)
        markers.append(
            {
                "timestamp": str(row.get("timestamp", "")),
                "asset": str(row.get("asset", "")),
                "trade_grade": str(row.get("trade_grade", row.get("label", "UNKNOWN"))),
                "blocked_reason": str(row.get("blocked_reason", "NONE")),
                "reason_label": reason_label,
                "impact_abs": impact_abs,
                "intervention_type": _intervention_type(trace_record),
            }
        )

    modified_mask = (pnl_series - simulated_pnl_series).abs() > 1e-9
    pct_trades_modified = float(modified_mask.mean() * 100.0)
    actual_trade_volatility = float(pnl_series.std(ddof=0)) if len(pnl_series) else 0.0
    replay_trade_volatility = float(simulated_pnl_series.std(ddof=0)) if len(simulated_pnl_series) else 0.0

    day_key = pd.to_datetime(frame["timestamp"], errors="coerce").dt.floor("D")
    actual_daily = pnl_series.groupby(day_key, sort=False).sum()
    replay_daily = simulated_pnl_series.groupby(day_key, sort=False).sum()
    actual_worst_day = float(actual_daily.min()) if len(actual_daily) else 0.0
    replay_worst_day = float(replay_daily.min()) if len(replay_daily) else 0.0

    actual_max_drawdown = _max_drawdown(actual_equity)
    replay_max_drawdown = _max_drawdown(simulated_equity)

    impact_abs_series = (pnl_series - simulated_pnl_series).abs()
    bias_impact: dict[str, float] = {}
    for bias_name, col in (
        ("REVENGE_TRADING", "is_revenge"),
        ("OVERTRADING", "is_overtrading"),
        ("LOSS_AVERSION", "is_loss_aversion"),
    ):
        if col not in frame.columns:
            bias_impact[bias_name] = 0.0
            continue
        col_bool = frame[col].fillna(False).astype(bool)
        bias_impact[bias_name] = float(impact_abs_series[col_bool].sum())
    top_bias = max(bias_impact.items(), key=lambda item: item[1]) if bias_impact else ("NONE", 0.0)

    return _envelope(
        ok=True,
        job=job,
        data={
            "points": sampled_points,
            "markers": markers,
            "total_points": len(full_points),
            "returned_points": len(sampled_points),
            "max_points": max_points,
            "metrics": {
                "return_actual": float(pnl_series.sum()),
                "return_policy_replay": float(simulated_pnl_series.sum()),
                "max_drawdown_actual": actual_max_drawdown,
                "max_drawdown_policy_replay": replay_max_drawdown,
                "worst_day_actual": actual_worst_day,
                "worst_day_policy_replay": replay_worst_day,
                "trade_volatility_actual": actual_trade_volatility,
                "trade_volatility_policy_replay": replay_trade_volatility,
                "pct_trades_modified": pct_trades_modified,
                "top_bias_by_impact": {
                    "bias": top_bias[0],
                    "impact_abs_total": float(top_bias[1]),
                    "by_bias": bias_impact,
                },
            },
        },
    )


@app.get("/jobs/{job_id}/counterfactual/heatmap")
async def get_counterfactual_heatmap(job_id: str, granularity: str = "hour") -> JSONResponse:
    granularity_norm = granularity.strip().lower()
    if granularity_norm not in {"hour", "day"}:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"granularity": granularity_norm, "cells": [], "total_cells": 0, "totals": {}},
            error_code="INVALID_GRANULARITY",
            error_message="granularity must be one of: hour, day",
            status_code=400,
        )

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"granularity": granularity_norm, "cells": [], "total_cells": 0, "totals": {}},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"granularity": granularity_norm, "cells": [], "total_cells": 0, "totals": {}},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    try:
        frame = _load_counterfactual_frame(job_id)
    except FileNotFoundError:
        return _envelope(
            ok=False,
            job=job,
            data={"granularity": granularity_norm, "cells": [], "total_cells": 0, "totals": {}},
            error_code="COUNTERFACTUAL_NOT_READY",
            error_message="Counterfactual rows are not available yet.",
            status_code=409,
        )
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"granularity": granularity_norm, "cells": [], "total_cells": 0, "totals": {}},
            error_code="COUNTERFACTUAL_PARSE_ERROR",
            error_message=str(exc),
            status_code=422,
        )

    required_columns = {"timestamp", "pnl", "simulated_pnl"}
    missing_required = [column for column in required_columns if column not in frame.columns]
    if missing_required:
        return _envelope(
            ok=False,
            job=job,
            data={"granularity": granularity_norm, "cells": [], "total_cells": 0, "totals": {}},
            error_code="COUNTERFACTUAL_SCHEMA_INVALID",
            error_message=f"counterfactual.csv missing required columns: {sorted(missing_required)}",
            status_code=422,
        )

    timestamp_series = pd.to_datetime(frame["timestamp"], errors="coerce")
    if timestamp_series.isna().any():
        return _envelope(
            ok=False,
            job=job,
            data={"granularity": granularity_norm, "cells": [], "total_cells": 0, "totals": {}},
            error_code="COUNTERFACTUAL_SCHEMA_INVALID",
            error_message="counterfactual.csv has invalid timestamp values",
            status_code=422,
        )

    pnl_series = pd.to_numeric(frame["pnl"], errors="coerce")
    replay_series = pd.to_numeric(frame["simulated_pnl"], errors="coerce")
    if pnl_series.isna().any() or replay_series.isna().any():
        return _envelope(
            ok=False,
            job=job,
            data={"granularity": granularity_norm, "cells": [], "total_cells": 0, "totals": {}},
            error_code="COUNTERFACTUAL_SCHEMA_INVALID",
            error_message="counterfactual.csv has non-numeric pnl/simulated_pnl values",
            status_code=422,
        )

    impact_abs_series = (pnl_series - replay_series).abs()
    modified_series = impact_abs_series > 1e-9
    is_revenge_series = (
        frame["is_revenge"].fillna(False).astype(bool)
        if "is_revenge" in frame.columns
        else pd.Series(False, index=frame.index)
    )
    is_overtrading_series = (
        frame["is_overtrading"].fillna(False).astype(bool)
        if "is_overtrading" in frame.columns
        else pd.Series(False, index=frame.index)
    )
    is_loss_aversion_series = (
        frame["is_loss_aversion"].fillna(False).astype(bool)
        if "is_loss_aversion" in frame.columns
        else pd.Series(False, index=frame.index)
    )
    any_bias_series = is_revenge_series | is_overtrading_series | is_loss_aversion_series

    if granularity_norm == "hour":
        bucket_series = timestamp_series.dt.floor("h")
    else:
        bucket_series = timestamp_series.dt.floor("d")

    cells: list[dict[str, Any]] = []
    for bucket in sorted(bucket_series.unique()):
        bucket_mask = bucket_series == bucket
        bucket_pnl = pnl_series[bucket_mask]
        bucket_replay = replay_series[bucket_mask]
        bucket_impact = impact_abs_series[bucket_mask]
        bucket_modified = modified_series[bucket_mask]
        bucket_any_bias = any_bias_series[bucket_mask]
        bucket_revenge = is_revenge_series[bucket_mask]
        bucket_overtrading = is_overtrading_series[bucket_mask]
        bucket_loss_aversion = is_loss_aversion_series[bucket_mask]

        cells.append(
            {
                "bucket_start": bucket.isoformat(),
                "trade_count": int(bucket_mask.sum()),
                "modified_count": int(bucket_modified.sum()),
                "bias_count": int(bucket_any_bias.sum()),
                "actual_pnl": float(bucket_pnl.sum()),
                "policy_replay_pnl": float(bucket_replay.sum()),
                "impact_abs_total": float(bucket_impact.sum()),
                "bias_breakdown": {
                    "loss_aversion": int(bucket_loss_aversion.sum()),
                    "revenge": int(bucket_revenge.sum()),
                    "overtrading": int(bucket_overtrading.sum()),
                },
            }
        )

    totals = {
        "trade_count": int(len(frame)),
        "modified_count": int(modified_series.sum()),
        "bias_count": int(any_bias_series.sum()),
        "actual_pnl": float(pnl_series.sum()),
        "policy_replay_pnl": float(replay_series.sum()),
        "impact_abs_total": float(impact_abs_series.sum()),
    }

    return _envelope(
        ok=True,
        job=job,
        data={
            "granularity": granularity_norm,
            "total_cells": len(cells),
            "cells": cells,
            "totals": totals,
        },
    )


@app.get("/jobs/{job_id}/moments")
async def get_moments(job_id: str) -> JSONResponse:
    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"moments": []},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"moments": []},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    try:
        review_payload = _load_review_payload_for_moments(job_id)
    except FileNotFoundError:
        return _envelope(
            ok=False,
            job=job,
            data={"moments": []},
            error_code="REVIEW_NOT_READY",
            error_message="review.json is not available yet.",
            status_code=409,
        )
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"moments": []},
            error_code="REVIEW_PARSE_ERROR",
            error_message=str(exc),
            status_code=422,
        )

    try:
        counterfactual_frame = _load_counterfactual_frame(job_id)
    except FileNotFoundError:
        return _envelope(
            ok=False,
            job=job,
            data={"moments": []},
            error_code="COUNTERFACTUAL_NOT_READY",
            error_message="counterfactual.csv is not available yet.",
            status_code=409,
        )
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"moments": []},
            error_code="COUNTERFACTUAL_PARSE_ERROR",
            error_message=str(exc),
            status_code=422,
        )
    counterfactual_rows = counterfactual_frame.to_dict(orient="records")

    try:
        trace_records = _load_or_build_trace(job_id, counterfactual_frame)
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"moments": []},
            error_code="TRACE_GENERATION_FAILED",
            error_message=str(exc),
            status_code=422,
        )
    try:
        raw_input_frame = _load_raw_input_frame(job_id)
    except Exception:
        raw_input_frame = None

    top_rows = _select_top_moment_rows(review_payload, counterfactual_rows)
    if not top_rows:
        return _envelope(
            ok=False,
            job=job,
            data={"moments": []},
            error_code="MOMENTS_NOT_AVAILABLE",
            error_message="No top moments available for this job.",
            status_code=422,
        )

    grade_rules = {}
    labeling_rules = review_payload.get("labeling_rules")
    if isinstance(labeling_rules, dict):
        grade_rules = labeling_rules.get("grade_rules", {})
    if not isinstance(grade_rules, dict):
        grade_rules = {}

    thresholds = {}
    if isinstance(labeling_rules, dict) and isinstance(labeling_rules.get("thresholds"), dict):
        thresholds = labeling_rules["thresholds"]

    moments: list[dict[str, Any]] = []
    for row in top_rows:
        notes: list[str] = []
        trace_record = _trace_record_for_row(row, trace_records)
        if trace_record is None:
            notes.append("trace lookup failed for this moment")
        timestamp = str(row.get("timestamp", ""))
        asset = str(row.get("asset", ""))
        grade = str(row.get("trade_grade", row.get("label", "UNKNOWN")))
        pnl = _float_or_none(trace_record.get("pnl")) if trace_record is not None else None
        if pnl is None:
            pnl = _float_or_none(row.get("pnl"))
        if pnl is None:
            pnl = _float_or_none(row.get("actual_pnl"))
        simulated_pnl = (
            _float_or_none(trace_record.get("simulated_pnl")) if trace_record is not None else None
        )
        if simulated_pnl is None:
            simulated_pnl = _float_or_none(row.get("simulated_pnl"))
        impact_abs = (
            _float_or_none(trace_record.get("impact_abs")) if trace_record is not None else None
        )
        if impact_abs is None:
            impact_abs = _float_or_none(row.get("impact_abs"))
        if impact_abs is None and pnl is not None and simulated_pnl is not None:
            impact_abs = abs(pnl - simulated_pnl)
        if impact_abs is None:
            notes.append("missing field: impact_abs")
        moment_balance: float | None = None
        if trace_record is not None:
            trade_id_value = trace_record.get("trade_id")
            if (
                raw_input_frame is not None
                and isinstance(trade_id_value, (int, float))
                and not isinstance(trade_id_value, bool)
            ):
                trade_id_int = int(trade_id_value)
                raw_rows = raw_input_frame.where(pd.notna(raw_input_frame), None).to_dict(orient="records")
                if 0 <= trade_id_int < len(raw_rows):
                    candidate = raw_rows[trade_id_int]
                    if isinstance(candidate, dict):
                        moment_balance = _balance_from_row(candidate)
        if moment_balance is None:
            moment_balance = _find_balance_for_timestamp_asset(
                raw_input_frame,
                timestamp=timestamp,
                asset=asset,
            )
        impact_pct_balance = _impact_pct_balance(impact_abs, moment_balance)

        blocked_reason: str | None
        if trace_record is not None and trace_record.get("blocked_reason") is not None:
            blocked_reason = str(trace_record.get("blocked_reason"))
        elif "blocked_reason" in row and row.get("blocked_reason") is not None:
            blocked_reason = str(row.get("blocked_reason"))
        else:
            blocked_reason = None
            notes.append("missing field: blocked_reason")

        if trace_record is not None:
            is_revenge = _trace_bool(trace_record.get("is_revenge"))
            if is_revenge is None:
                notes.append("missing field: is_revenge")
            is_overtrading = _trace_bool(trace_record.get("is_overtrading"))
            if is_overtrading is None:
                notes.append("missing field: is_overtrading")
            is_loss_aversion = _trace_bool(trace_record.get("is_loss_aversion"))
            if is_loss_aversion is None:
                notes.append("missing field: is_loss_aversion")
        else:
            is_revenge = _bool_or_none(row, "is_revenge", notes)
            is_overtrading = _bool_or_none(row, "is_overtrading", notes)
            is_loss_aversion = _bool_or_none(row, "is_loss_aversion", notes)

        rule_hits: list[dict[str, Any]] | None = None
        if trace_record is not None:
            raw_rule_hits = trace_record.get("rule_hits")
            if isinstance(raw_rule_hits, list):
                rule_hits = [dict(hit) for hit in raw_rule_hits if isinstance(hit, dict)]
            else:
                notes.append("missing field: rule_hits")
        else:
            notes.append("missing field: rule_hits")

        triggering_prior_trade = (
            dict(trace_record["triggering_prior_trade"])
            if trace_record is not None and isinstance(trace_record.get("triggering_prior_trade"), dict)
            else None
        )
        if trace_record is not None and trace_record.get("triggering_prior_trade") is not None and triggering_prior_trade is None:
            notes.append("invalid field: triggering_prior_trade")

        threshold_keys = _moment_threshold_keys_for_grade(grade)
        referenced_thresholds: dict[str, float | None] = {}
        metric_refs: list[dict[str, Any]] = []
        if pnl is not None:
            metric_refs.append({"name": "pnl", "value": pnl, "unit": "USD"})
        if simulated_pnl is not None:
            metric_refs.append({"name": "simulated_pnl", "value": simulated_pnl, "unit": "USD"})
        if impact_abs is not None:
            metric_refs.append({"name": "impact_abs", "value": impact_abs, "unit": "USD"})
        if impact_pct_balance is not None:
            metric_refs.append(
                {
                    "name": "impact_pct_balance",
                    "value": impact_pct_balance,
                    "unit": "pct_balance",
                }
            )
        if blocked_reason is not None:
            metric_refs.append({"name": "blocked_reason", "value": blocked_reason, "unit": "enum"})
        if is_revenge is not None:
            metric_refs.append({"name": "is_revenge", "value": is_revenge, "unit": "bool"})
        if is_overtrading is not None:
            metric_refs.append({"name": "is_overtrading", "value": is_overtrading, "unit": "bool"})
        if is_loss_aversion is not None:
            metric_refs.append({"name": "is_loss_aversion", "value": is_loss_aversion, "unit": "bool"})
        for threshold_key in threshold_keys:
            threshold_value = _float_or_none(thresholds.get(threshold_key))
            referenced_thresholds[threshold_key] = threshold_value
            if threshold_value is not None:
                metric_refs.append({"name": threshold_key, "value": threshold_value, "unit": "USD"})

        explanation_human: str
        if trace_record is not None and isinstance(trace_record.get("explain_like_im_5"), str):
            explanation_human = str(trace_record.get("explain_like_im_5"))
        else:
            explanation_human = _moment_human_explanation(
                grade=grade,
                blocked_reason=blocked_reason,
                pnl=pnl,
                simulated_pnl=simulated_pnl,
                impact_abs=impact_abs,
                is_revenge=is_revenge,
                is_overtrading=is_overtrading,
                is_loss_aversion=is_loss_aversion,
            )
        reason_label = _reason_label(
            trace_record=trace_record,
            is_revenge=is_revenge,
            is_overtrading=is_overtrading,
            is_loss_aversion=is_loss_aversion,
        )
        thesis = _trade_thesis(
            trace_record=trace_record,
            pnl=pnl,
            replay_pnl=simulated_pnl,
            impact_abs=impact_abs,
        )
        lesson = _trade_lesson(reason_label=reason_label, impact_abs=impact_abs)
        mechanics = _counterfactual_mechanics(trace_record)

        moments.append(
            {
                "timestamp": timestamp,
                "asset": asset,
                "trade_grade": grade,
                "bias_category": row.get("_selected_bias_category"),
                "pnl": pnl,
                "simulated_pnl": simulated_pnl,
                "disciplined_replay_pnl": simulated_pnl,
                "policy_replay_pnl": simulated_pnl,
                "impact_abs": impact_abs,
                "impact_pct_balance": impact_pct_balance,
                "blocked_reason": blocked_reason,
                "reason_label": reason_label,
                "is_revenge": is_revenge,
                "is_overtrading": is_overtrading,
                "is_loss_aversion": is_loss_aversion,
                "thresholds_referenced": referenced_thresholds,
                "explanation_human": explanation_human,
                "thesis": thesis,
                "lesson": lesson,
                "counterfactual_mechanics": mechanics,
                "decision": trace_record.get("decision") if trace_record is not None else None,
                "reason": trace_record.get("reason") if trace_record is not None else None,
                "intervention_type": _intervention_type(trace_record),
                "triggering_prior_trade": triggering_prior_trade,
                "trace_trade_id": trace_record.get("trade_id") if trace_record is not None else None,
                "rule_hits": rule_hits,
                "evidence": {
                    "rule_signature": grade_rules.get(grade),
                    "metric_refs": metric_refs,
                    "rule_hits": rule_hits,
                },
                "error_notes": notes,
            }
        )

    return _envelope(
        ok=True,
        job=job,
        data={
            "moments": moments,
            "source": "review.top_moments_joined_with_counterfactual",
        },
    )


@app.get("/jobs/{job_id}/trace")
async def get_trace(job_id: str, offset: int = 0, limit: int = 500) -> JSONResponse:
    if offset < 0:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"offset": offset, "limit": limit, "total_rows": 0, "rows": []},
            error_code="INVALID_OFFSET",
            error_message="offset must be >= 0",
            status_code=400,
        )
    if limit < 1 or limit > TRACE_PAGE_MAX:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"offset": offset, "limit": limit, "total_rows": 0, "rows": []},
            error_code="INVALID_LIMIT",
            error_message=f"limit must be between 1 and {TRACE_PAGE_MAX}",
            status_code=400,
        )

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"offset": offset, "limit": limit, "total_rows": 0, "rows": []},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"offset": offset, "limit": limit, "total_rows": 0, "rows": []},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    try:
        counterfactual_frame = _load_counterfactual_frame(job_id)
    except FileNotFoundError:
        return _envelope(
            ok=False,
            job=job,
            data={"offset": offset, "limit": limit, "total_rows": 0, "rows": []},
            error_code="COUNTERFACTUAL_NOT_READY",
            error_message="counterfactual.csv is not available yet.",
            status_code=409,
        )
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"offset": offset, "limit": limit, "total_rows": 0, "rows": []},
            error_code="COUNTERFACTUAL_PARSE_ERROR",
            error_message=str(exc),
            status_code=422,
        )

    try:
        trace_records = _load_or_build_trace(job_id, counterfactual_frame)
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"offset": offset, "limit": limit, "total_rows": 0, "rows": []},
            error_code="TRACE_GENERATION_FAILED",
            error_message=str(exc),
            status_code=422,
        )

    total_rows = len(trace_records)
    rows_window = [dict(row) for row in trace_records[offset : offset + limit]]
    return _envelope(
        ok=True,
        job=job,
        data={
            "offset": offset,
            "limit": limit,
            "total_rows": total_rows,
            "rows": rows_window,
            "artifact_name": TRACE_JSONL_NAME,
        },
    )


@app.get("/jobs/{job_id}/trade/{trade_id}")
async def get_trade_inspector(job_id: str, trade_id: int) -> JSONResponse:
    if trade_id < 0:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"trade": None},
            error_code="INVALID_TRADE_ID",
            error_message="trade_id must be >= 0",
            status_code=400,
        )

    try:
        job = _read_job(job_id)
    except CorruptJobRecordError as exc:
        return _corrupt_job_response(
            job_id=exc.job_id,
            data={"trade": None},
            path=exc.path,
            cause=exc.cause,
        )
    if job is None:
        return _envelope(
            ok=False,
            job=None,
            fallback_job_id=job_id,
            data={"trade": None},
            error_code="JOB_NOT_FOUND",
            error_message="Job does not exist.",
            status_code=404,
        )

    try:
        counterfactual_frame = _load_counterfactual_frame(job_id)
    except FileNotFoundError:
        return _envelope(
            ok=False,
            job=job,
            data={"trade": None},
            error_code="COUNTERFACTUAL_NOT_READY",
            error_message="counterfactual.csv is not available yet.",
            status_code=409,
        )
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"trade": None},
            error_code="COUNTERFACTUAL_PARSE_ERROR",
            error_message=str(exc),
            status_code=422,
        )

    try:
        trace_records = _load_or_build_trace(job_id, counterfactual_frame)
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"trade": None},
            error_code="TRACE_GENERATION_FAILED",
            error_message=str(exc),
            status_code=422,
        )

    if trade_id >= len(trace_records):
        return _envelope(
            ok=False,
            job=job,
            data={"trade": None},
            error_code="TRADE_NOT_FOUND",
            error_message=f"trade_id {trade_id} is out of range for this job.",
            error_details={"total_trades": len(trace_records)},
            status_code=404,
        )

    trace_record = dict(trace_records[trade_id])
    try:
        input_frame = _load_raw_input_frame(job_id)
        raw_input_row = _find_raw_input_row(
            input_frame,
            trace_record=trace_record,
            trade_id=trade_id,
        )
    except FileNotFoundError:
        raw_input_row = None
    except ValueError as exc:
        return _envelope(
            ok=False,
            job=job,
            data={"trade": None},
            error_code="INPUT_PARSE_ERROR",
            error_message=str(exc),
            status_code=422,
        )

    rule_hits = trace_record.get("rule_hits")
    if not isinstance(rule_hits, list):
        rule_hits = []
    normalized_rule_hits = [dict(hit) for hit in rule_hits if isinstance(hit, dict)]
    first_fired_rule: str | None = None
    for hit in normalized_rule_hits:
        if bool(hit.get("fired")):
            first_fired_rule = str(hit.get("rule_id"))
            break

    pnl = _float_or_none(trace_record.get("pnl"))
    simulated_pnl = _float_or_none(trace_record.get("simulated_pnl"))
    impact_abs = _float_or_none(trace_record.get("impact_abs"))
    if impact_abs is None and pnl is not None and simulated_pnl is not None:
        impact_abs = abs(pnl - simulated_pnl)
    balance_value = _balance_from_row(raw_input_row)
    impact_pct_balance = _impact_pct_balance(impact_abs, balance_value)
    is_revenge = _trace_bool(trace_record.get("is_revenge"))
    is_overtrading = _trace_bool(trace_record.get("is_overtrading"))
    is_loss_aversion = _trace_bool(trace_record.get("is_loss_aversion"))
    reason_label = _reason_label(
        trace_record=trace_record,
        is_revenge=is_revenge,
        is_overtrading=is_overtrading,
        is_loss_aversion=is_loss_aversion,
    )
    thesis = _trade_thesis(
        trace_record=trace_record,
        pnl=pnl,
        replay_pnl=simulated_pnl,
        impact_abs=impact_abs,
    )
    lesson = _trade_lesson(reason_label=reason_label, impact_abs=impact_abs)
    quantity_before = None
    if isinstance(raw_input_row, dict):
        for key in ("quantity", "qty", "size_qty_proxy"):
            if key in raw_input_row:
                quantity_before = _float_or_none(raw_input_row.get(key))
                if quantity_before is not None:
                    break
    mechanics = _counterfactual_mechanics(
        trace_record,
        quantity_before=quantity_before,
    )

    trade_payload = {
        "trade_id": trade_id,
        "label": str(trace_record.get("trade_grade", trace_record.get("label", "GOOD"))).upper(),
        "timestamp": str(trace_record.get("timestamp", "")),
        "asset": str(trace_record.get("asset", "")),
        "raw_input_row": raw_input_row,
        "derived_flags": {
            "is_revenge": is_revenge,
            "is_overtrading": is_overtrading,
            "is_loss_aversion": is_loss_aversion,
        },
        "decision": {
            "decision": trace_record.get("decision"),
            "reason": trace_record.get("reason"),
            "reason_label": reason_label,
            "intervention_type": _intervention_type(trace_record),
            "triggering_rule_id": first_fired_rule,
            "triggering_prior_trade": trace_record.get("triggering_prior_trade"),
            "blocked_reason": trace_record.get("blocked_reason"),
        },
        "counterfactual": {
            "actual_pnl": pnl,
            "simulated_pnl": simulated_pnl,
            "disciplined_replay_pnl": simulated_pnl,
            "policy_replay_pnl": simulated_pnl,
            "delta_pnl": impact_abs,
            "impact_pct_balance": impact_pct_balance,
        },
        "counterfactual_mechanics": mechanics,
        "explanation_plain_english": trace_record.get("explain_like_im_5"),
        "thesis": thesis,
        "lesson": lesson,
        "evidence": {
            "timestamp": trace_record.get("timestamp"),
            "asset": trace_record.get("asset"),
            "side": trace_record.get("side"),
            "size_usd": _float_or_none(trace_record.get("size_usd")),
            "rule_hits": normalized_rule_hits,
            "trace": trace_record,
        },
    }
    return _envelope(
        ok=True,
        job=job,
        data={"trade": trade_payload},
    )
