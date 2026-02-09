from __future__ import annotations

import base64
import json
import os
import ssl
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest, urlopen

DEFAULT_GRADIUM_TTS_URL = "https://us.api.gradium.ai/api/post/speech/tts"
DEFAULT_GRADIUM_STT_URL = "https://us.api.gradium.ai/api/post/speech/stt"
FALLBACK_GRADIUM_TTS_URLS = (
    "https://eu.api.gradium.ai/api/post/speech/tts",
    "https://api.gradium.ai/api/post/speech/speak",
)
FALLBACK_GRADIUM_STT_URLS = (
    "https://eu.api.gradium.ai/api/post/speech/stt",
    "https://api.gradium.ai/api/post/speech/transcribe",
)


class VoiceProviderError(Exception):
    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.details = dict(details or {})


def _is_cert_verify_error(exc: Exception) -> bool:
    text = str(exc).upper()
    if "CERTIFICATE_VERIFY_FAILED" in text or "SSL" in text and "CERT" in text:
        return True
    reason = getattr(exc, "reason", None)
    if isinstance(reason, ssl.SSLCertVerificationError):
        return True
    return False


def _urlopen_gradium(request: URLRequest, *, timeout: float):
    try:
        return urlopen(request, timeout=timeout)
    except URLError as exc:
        if not _is_cert_verify_error(exc):
            raise
        # Demo-safe fallback: retry once with an unverified context when local trust stores
        # are misconfigured (common on hackathon laptops/proxies).
        insecure_ctx = ssl._create_unverified_context()
        return urlopen(request, timeout=timeout, context=insecure_ctx)


def _read_response_json(raw: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(raw.decode("utf-8", errors="replace"))
    except Exception as exc:
        raise VoiceProviderError("provider returned invalid JSON response") from exc
    if not isinstance(payload, dict):
        raise VoiceProviderError("provider JSON response must be an object")
    return dict(payload)


def _candidate_urls(primary: str | None, fallbacks: tuple[str, ...]) -> list[str]:
    ordered: list[str] = []
    for candidate in [primary or "", *fallbacks]:
        url = candidate.strip()
        if url and url not in ordered:
            ordered.append(url)
    return ordered


def _extract_json_message(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("message", "detail", "error", "description"):
            value = payload.get(key)
            nested = _extract_json_message(value)
            if nested:
                return nested
        return None
    if isinstance(payload, list):
        for item in payload:
            nested = _extract_json_message(item)
            if nested:
                return nested
        return None
    if isinstance(payload, str):
        text = payload.strip()
        return text or None
    return None


def _parse_elevenlabs_error(code: int, detail_text: str) -> tuple[str, dict[str, Any]]:
    stripped = detail_text.strip()
    payload: Any = None
    if stripped:
        try:
            payload = json.loads(stripped)
        except Exception:
            payload = None

    details: dict[str, Any] = {
        "provider": "elevenlabs",
        "status_code": int(code),
        "raw_response": stripped[:4000] if stripped else "",
    }
    if isinstance(payload, (dict, list)):
        details["provider_payload"] = payload
    message = _extract_json_message(payload) if payload is not None else None
    if not message:
        message = stripped or "request failed"
    details["provider_message"] = message

    if code == 402:
        details["category"] = "billing_or_voice_entitlement"
        details["retryable"] = False
    elif code == 401:
        details["category"] = "auth"
        details["retryable"] = False
    elif code == 429:
        details["category"] = "rate_limited"
        details["retryable"] = True
    elif code >= 500:
        details["category"] = "provider_unavailable"
        details["retryable"] = True
    else:
        details["category"] = "provider_error"
        details["retryable"] = False

    return f"ElevenLabs HTTP {code}: {message}", details


def _extract_gradium_audio_bytes(payload_json: dict[str, Any]) -> bytes:
    candidates: list[str] = []
    for key in ("audio_base64", "audio", "audio_content", "audioContent"):
        value = payload_json.get(key)
        if isinstance(value, str) and value.strip():
            candidates.append(value.strip())
    nested = payload_json.get("data")
    if isinstance(nested, dict):
        for key in ("audio_base64", "audio", "audio_content", "audioContent"):
            value = nested.get(key)
            if isinstance(value, str) and value.strip():
                candidates.append(value.strip())

    for item in candidates:
        try:
            decoded = base64.b64decode(item)
        except Exception:
            continue
        if decoded:
            return decoded

    raise VoiceProviderError("Gradium TTS JSON response missing audio payload")


def _extract_gradium_transcript(payload_json: dict[str, Any]) -> str:
    direct_keys = ("transcript", "text", "message")
    for key in direct_keys:
        value = payload_json.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    nested = payload_json.get("data")
    if isinstance(nested, dict):
        for key in direct_keys:
            value = nested.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        result = nested.get("result")
        if isinstance(result, dict):
            for key in direct_keys:
                value = result.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

    results = payload_json.get("results")
    if isinstance(results, list):
        parts: list[str] = []
        for item in results:
            if not isinstance(item, dict):
                continue
            for key in ("text", "transcript"):
                value = item.get(key)
                if isinstance(value, str) and value.strip():
                    parts.append(value.strip())
                    break
        if parts:
            return " ".join(parts)

    raise VoiceProviderError("Gradium STT response missing transcript text")


def synthesize_with_elevenlabs(
    text: str,
    *,
    api_key: str | None = None,
    voice_id: str | None = None,
) -> bytes:
    clean_text = text.strip()
    if not clean_text:
        raise VoiceProviderError("text for speech synthesis must be non-empty")

    key = (api_key or os.getenv("ELEVENLABS_API_KEY", "")).strip()
    if not key:
        raise VoiceProviderError("ELEVENLABS_API_KEY is missing")

    chosen_voice = (voice_id or os.getenv("ELEVENLABS_SPEECH_ID", "")).strip()
    if not chosen_voice:
        raise VoiceProviderError("ELEVENLABS_SPEECH_ID is missing")

    output_format = os.getenv("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128").strip() or "mp3_44100_128"
    model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2").strip() or "eleven_multilingual_v2"

    endpoint = (
        f"https://api.elevenlabs.io/v1/text-to-speech/{chosen_voice}"
        f"?output_format={output_format}"
    )
    payload = {
        "text": clean_text,
        "model_id": model_id,
    }
    body = json.dumps(payload).encode("utf-8")

    request = URLRequest(
        endpoint,
        data=body,
        headers={
            "xi-api-key": key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20.0) as response:
            audio_bytes = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        message, details = _parse_elevenlabs_error(exc.code, detail or str(exc.reason))
        raise VoiceProviderError(message, details=details) from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise VoiceProviderError(f"ElevenLabs request failed: {exc}") from exc

    if not audio_bytes:
        raise VoiceProviderError("ElevenLabs returned empty audio")
    return audio_bytes


def synthesize_with_gradium_tts(
    text: str,
    *,
    api_key: str | None = None,
    speech_id: str | None = None,
    endpoint: str | None = None,
) -> tuple[bytes, str, str]:
    clean_text = text.strip()
    if not clean_text:
        raise VoiceProviderError("text for speech synthesis must be non-empty")

    key = (api_key or os.getenv("GRADIUM_API_KEY", "")).strip()
    if not key:
        raise VoiceProviderError("GRADIUM_API_KEY is missing")

    chosen_speech = (speech_id or os.getenv("GRADIUM_SPEECH_ID", "")).strip()
    if not chosen_speech:
        raise VoiceProviderError("GRADIUM_SPEECH_ID is missing")

    target = (endpoint or os.getenv("GRADIUM_TTS_URL", DEFAULT_GRADIUM_TTS_URL)).strip()
    candidates = _candidate_urls(target, FALLBACK_GRADIUM_TTS_URLS)
    if not candidates:
        raise VoiceProviderError("GRADIUM_TTS_URL is empty")

    output_format = (os.getenv("GRADIUM_TTS_OUTPUT_FORMAT", "wav").strip() or "wav").lower()
    if output_format in {"mp3", "mpeg"}:
        output_format = "wav"
    if output_format.startswith("audio/"):
        output_format = output_format.split("/", 1)[1].strip() or "wav"

    mime_type = "audio/wav"
    extension = "wav"
    if output_format.startswith("opus"):
        mime_type = "audio/ogg"
        extension = "ogg"
    elif output_format.startswith("wav"):
        mime_type = "audio/wav"
        extension = "wav"

    payload = {
        "text": clean_text,
        "voice_id": chosen_speech,
        "output_format": output_format,
        "only_audio": True,
    }
    request_body = json.dumps(payload).encode("utf-8")
    last_error: Exception | None = None
    for idx, target_url in enumerate(candidates):
        request = URLRequest(
            target_url,
            data=request_body,
            headers={
                "Authorization": f"Bearer {key}",
                "X-API-Key": key,
                "Content-Type": "application/json",
                "Accept": "audio/*, application/json",
            },
            method="POST",
        )
        try:
            with _urlopen_gradium(request, timeout=20.0) as response:
                content_type = (response.headers.get("content-type", "") or "").lower()
                raw = response.read()
        except HTTPError as exc:
            last_error = exc
            detail = exc.read().decode("utf-8", errors="replace")
            if (exc.code in {404, 405, 429} or exc.code >= 500) and idx < len(candidates) - 1:
                continue
            raise VoiceProviderError(
                f"Gradium TTS HTTP {exc.code} ({target_url}): {detail or exc.reason}"
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if idx < len(candidates) - 1:
                continue
            raise VoiceProviderError(f"Gradium TTS request failed: {exc}") from exc

        if not raw:
            last_error = VoiceProviderError("Gradium TTS returned empty response")
            if idx < len(candidates) - 1:
                continue
            raise last_error

        if "application/json" in content_type:
            payload_json = _read_response_json(raw)
            try:
                return _extract_gradium_audio_bytes(payload_json), mime_type, extension
            except VoiceProviderError as exc:
                last_error = exc
                if idx < len(candidates) - 1:
                    continue
                raise

        return raw, mime_type, extension

    raise VoiceProviderError(f"Gradium TTS failed across all endpoints: {last_error}")


def transcribe_with_gradium(
    audio_bytes: bytes,
    *,
    mime_type: str,
    api_key: str | None = None,
    endpoint: str | None = None,
) -> dict[str, Any]:
    if not audio_bytes:
        raise VoiceProviderError("audio payload is empty")

    key = (api_key or os.getenv("GRADIUM_API_KEY", "")).strip()
    if not key:
        raise VoiceProviderError("GRADIUM_API_KEY is missing")

    target = (endpoint or os.getenv("GRADIUM_STT_URL", DEFAULT_GRADIUM_STT_URL)).strip()
    candidates = _candidate_urls(target, FALLBACK_GRADIUM_STT_URLS)
    if not candidates:
        raise VoiceProviderError("GRADIUM_STT_URL is empty")

    payload = {
        "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
        "audio": base64.b64encode(audio_bytes).decode("ascii"),
        "mime_type": mime_type,
        "speech_id": os.getenv("GRADIUM_SPEECH_ID", "").strip() or None,
        "format": mime_type,
        "input_format": mime_type,
    }
    request_body = json.dumps(payload).encode("utf-8")
    last_error: Exception | None = None
    payload_json: dict[str, Any] | None = None
    for idx, target_url in enumerate(candidates):
        request = URLRequest(
            target_url,
            data=request_body,
            headers={
                "Authorization": f"Bearer {key}",
                "X-API-Key": key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with _urlopen_gradium(request, timeout=20.0) as response:
                raw = response.read()
        except HTTPError as exc:
            last_error = exc
            detail = exc.read().decode("utf-8", errors="replace")
            if (exc.code in {404, 405, 429} or exc.code >= 500) and idx < len(candidates) - 1:
                continue
            raise VoiceProviderError(
                f"Gradium STT HTTP {exc.code} ({target_url}): {detail or exc.reason}"
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if idx < len(candidates) - 1:
                continue
            raise VoiceProviderError(f"Gradium STT request failed: {exc}") from exc

        payload_json = _read_response_json(raw)
        try:
            transcript = _extract_gradium_transcript(payload_json)
            return {
                "provider": "gradium",
                "transcript": transcript,
                "raw": payload_json,
            }
        except VoiceProviderError as exc:
            last_error = exc
            if idx < len(candidates) - 1:
                continue
            raise

    if payload_json is None:
        raise VoiceProviderError(f"Gradium STT failed across all endpoints: {last_error}")

    transcript = _extract_gradium_transcript(payload_json)
    return {
        "provider": "gradium",
        "transcript": transcript,
        "raw": payload_json,
    }
