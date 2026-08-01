# =============================================================================
# GalaxyQuest TTS Service – Dockerfile
# Multi-stage build: lean runtime image, non-root user, health check.
# =============================================================================

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# System build deps
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create virtualenv and install Python deps
COPY requirements.txt .
RUN python -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir --upgrade pip && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

WORKDIR /app

# Runtime system deps: espeak-ng (Piper phonemiser) + ffmpeg + curl (health probe)
RUN apt-get update && apt-get install -y --no-install-recommends \
        espeak-ng \
        libsndfile1 \
        ffmpeg \
        curl \
    && rm -rf /var/lib/apt/lists/*

# Copy virtualenv from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy application (all modules; tests excluded via .dockerignore)
COPY main.py audio.py auth.py cache.py config.py models.py ./
COPY engines/ ./engines/

# Voice model downloads happen at first request (lazy) or via /preload.
ENV TTS_CACHE_DIR=/app/voice_cache \
    TTS_AUDIO_CACHE_DIR=/app/audio_cache \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN mkdir -p /app/voice_cache /app/audio_cache

# Create non-root user
RUN useradd -m -u 1000 tts && \
    chown -R tts:tts /app
USER tts

EXPOSE 5500

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:5500/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5500"]
