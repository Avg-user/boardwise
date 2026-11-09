FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# The read-aloud voice is baked into the image, so nothing is downloaded at runtime.
ARG TTS_VOICE=en_US-ryan-medium
ENV TTS_VOICE=${TTS_VOICE} TTS_VOICE_DIR=/voices
RUN python -m piper.download_voices ${TTS_VOICE} --data-dir /voices

# Model weights download into /models on first use; mount a volume there to keep them.
RUN useradd --system --create-home speech && mkdir -p /models && chown speech /models
COPY *.py ./
USER speech

EXPOSE 9100
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9100/health', timeout=2)"
CMD ["python", "server.py"]
