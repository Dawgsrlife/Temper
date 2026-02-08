from __future__ import annotations

import base64
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request as URLRequest, urlopen


class VoiceProviderError(Exception):
    pass


def _read_response_json(raw: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(raw.decode("utf-8", errors="replace"))
    except Exception as exc:
        raise VoiceProviderError("provider returned invalid JSON response") from exc
    if not isinstance(payload, dict):
        raise VoiceProviderError("provider JSON response must be an object")
    return dict(payload)


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
        raise VoiceProviderError(f"ElevenLabs HTTP {exc.code}: {detail or exc.reason}") from exc
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
) -> bytes:
    clean_text = text.strip()
    if not clean_text:
        raise VoiceProviderError("text for speech synthesis must be non-empty")

    key = (api_key or os.getenv("GRADIUM_API_KEY", "")).strip()
    if not key:
        raise VoiceProviderError("GRADIUM_API_KEY is missing")

    chosen_speech = (speech_id or os.getenv("GRADIUM_SPEECH_ID", "")).strip()
    if not chosen_speech:
        raise VoiceProviderError("GRADIUM_SPEECH_ID is missing")

    target = (endpoint or os.getenv("GRADIUM_TTS_URL", "")).strip()
    if not target:
        raise VoiceProviderError("GRADIUM_TTS_URL is missing")

    payload = {
        "text": clean_text,
        "speech_id": chosen_speech,
        "format": "mp3",
    }
    request = URLRequest(
        target,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "X-API-Key": key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg, application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20.0) as response:
            content_type = (response.headers.get("content-type", "") or "").lower()
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise VoiceProviderError(f"Gradium TTS HTTP {exc.code}: {detail or exc.reason}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise VoiceProviderError(f"Gradium TTS request failed: {exc}") from exc

    if not raw:
        raise VoiceProviderError("Gradium TTS returned empty response")

    if "application/json" in content_type:
        payload_json = _read_response_json(raw)
        audio_b64 = payload_json.get("audio_base64") or payload_json.get("audio")
        if not isinstance(audio_b64, str) or not audio_b64.strip():
            raise VoiceProviderError("Gradium TTS JSON response missing audio payload")
        try:
            return base64.b64decode(audio_b64)
        except Exception as exc:
            raise VoiceProviderError("Gradium TTS audio_base64 could not be decoded") from exc

    return raw


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

    target = (endpoint or os.getenv("GRADIUM_STT_URL", "")).strip()
    if not target:
        raise VoiceProviderError("GRADIUM_STT_URL is missing")

    payload = {
        "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
        "mime_type": mime_type,
        "speech_id": os.getenv("GRADIUM_SPEECH_ID", "").strip() or None,
    }
    request = URLRequest(
        target,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "X-API-Key": key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20.0) as response:
            raw = response.read()
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise VoiceProviderError(f"Gradium STT HTTP {exc.code}: {detail or exc.reason}") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise VoiceProviderError(f"Gradium STT request failed: {exc}") from exc

    payload_json = _read_response_json(raw)
    transcript = payload_json.get("transcript")
    if not isinstance(transcript, str):
        transcript = payload_json.get("text")
    if not isinstance(transcript, str) or not transcript.strip():
        raise VoiceProviderError("Gradium STT response missing transcript text")
    return {
        "provider": "gradium",
        "transcript": transcript.strip(),
        "raw": payload_json,
    }
