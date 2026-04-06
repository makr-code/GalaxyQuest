FROM python:3.11-slim

# System deps: espeak-ng (Piper phonemiser) + libsndfile (audio I/O)
RUN apt-get update && apt-get install -y --no-install-recommends \
        espeak-ng \
        libsndfile1 \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Voice model downloads happen at first request (lazy) or at startup via
# the /preload endpoint; keep the image lean.
ENV TTS_CACHE_DIR=/app/voice_cache
ENV TTS_AUDIO_CACHE_DIR=/app/audio_cache
RUN mkdir -p /app/voice_cache /app/audio_cache

EXPOSE 5500

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "5500"]
