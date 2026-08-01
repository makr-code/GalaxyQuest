"""Integration tests for TTS API routes."""

from __future__ import annotations

from fastapi.testclient import TestClient

# ── /health ────────────────────────────────────────────────────────────────────


def test_health_returns_ok(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert "engine" in body
    assert "default_voice" in body


# ── /voices ────────────────────────────────────────────────────────────────────


def test_voices_returns_list(client: TestClient) -> None:
    resp = client.get("/voices")
    assert resp.status_code == 200
    body = resp.json()
    assert "engine" in body
    assert isinstance(body["voices"], list)
    assert len(body["voices"]) >= 1


def test_voices_requires_secret_when_set(
    tmp_path,  # type: ignore[no-untyped-def]
    monkeypatch,  # type: ignore[no-untyped-def]
) -> None:
    monkeypatch.setenv("TTS_SECRET", "supersecret")
    monkeypatch.setenv("TTS_CACHE_DIR", str(tmp_path / "vc"))
    monkeypatch.setenv("TTS_AUDIO_CACHE_DIR", str(tmp_path / "ac"))

    from cache import AudioCache
    from main import app, get_cache, get_engine

    class _NoSecretEngine:
        name = "mock"

        def list_voices(self) -> list[dict]:  # type: ignore[type-arg]
            return []

        async def synthesise_mp3(
            self, text: str, voice: str, lang: str, speaker_wav: object
        ) -> bytes:
            return b""

    app.dependency_overrides[get_engine] = lambda: _NoSecretEngine()
    app.dependency_overrides[get_cache] = lambda: AudioCache(tmp_path / "ac")
    try:
        with TestClient(app) as c:
            resp = c.get("/voices")
            assert resp.status_code == 401

            resp_auth = c.get("/voices", headers={"x-tts-key": "supersecret"})
            assert resp_auth.status_code == 200
    finally:
        app.dependency_overrides.clear()


# ── /synthesize ────────────────────────────────────────────────────────────────


def test_synthesize_returns_mp3(client: TestClient) -> None:
    resp = client.post("/synthesize", json={"text": "Hallo Welt"})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/mpeg"
    assert len(resp.content) > 0


def test_synthesize_uses_cache_on_second_call(client: TestClient) -> None:
    payload = {"text": "Cache me please"}
    resp1 = client.post("/synthesize", json=payload)
    resp2 = client.post("/synthesize", json=payload)
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.content == resp2.content


def test_synthesize_bypasses_cache_with_no_cache(client: TestClient) -> None:
    payload = {"text": "Bypass cache", "no_cache": True}
    resp = client.post("/synthesize", json=payload)
    assert resp.status_code == 200


def test_synthesize_rejects_empty_text(client: TestClient) -> None:
    resp = client.post("/synthesize", json={"text": "   "})
    assert resp.status_code == 400


def test_synthesize_rejects_text_too_long(client: TestClient) -> None:
    resp = client.post("/synthesize", json={"text": "x" * 3000})
    assert resp.status_code == 400


def test_synthesize_missing_text_field(client: TestClient) -> None:
    resp = client.post("/synthesize", json={})
    assert resp.status_code == 422


# ── /preload ───────────────────────────────────────────────────────────────────


def test_preload_rejects_non_piper_engine(client: TestClient) -> None:
    """Mock engine is named 'mock', not 'piper' – preload must 400."""
    resp = client.post("/preload/de_DE-thorsten-high")
    assert resp.status_code == 400
