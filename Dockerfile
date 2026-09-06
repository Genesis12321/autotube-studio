FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIPER_BIN=/opt/piper-venv/bin/python \
    PIPER_VOICES_DIR=/opt/piper-voices \
    DATA_DIR=/home/user/data \
    NODE_ENV=production \
    PORT=7860 \
    LOW_MEMORY=1 \
    OMP_NUM_THREADS=1 \
    NODE_OPTIONS=--max-old-space-size=256

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg espeak-ng fonts-dejavu-core python3 python3-venv ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/piper-venv && /opt/piper-venv/bin/pip install --no-cache-dir piper-tts

ARG VOICES_BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main
RUN mkdir -p /opt/piper-voices && cd /opt/piper-voices && \
    for voice in \
      "es/es_ES/sharvard/medium/es_ES-sharvard-medium" \
      "es/es_ES/davefx/medium/es_ES-davefx-medium" \
      "es/es_MX/claude/high/es_MX-claude-high" \
      "es/es_AR/daniela/high/es_AR-daniela-high" ; do \
      name=$(basename "$voice") ; \
      curl -fsSL "$VOICES_BASE/$voice.onnx?download=true" -o "$name.onnx" ; \
      curl -fsSL "$VOICES_BASE/$voice.onnx.json?download=true" -o "$name.onnx.json" ; \
    done

RUN userdel -r node 2>/dev/null || true; \
    useradd -m -u 1000 user && mkdir -p /home/user/data && chown -R user:user /home/user
USER user
WORKDIR /home/user/app

COPY --chown=user package.json package-lock.json ./
RUN npm ci --include=dev

COPY --chown=user . .
RUN npm run build

EXPOSE 7860
CMD ["npm", "start"]
