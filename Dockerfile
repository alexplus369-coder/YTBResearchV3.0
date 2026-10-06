FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend /app/backend
COPY docs/video-production.md docs/third-party-notices.md /app/docs/
COPY index.html research-core.js research-workspace.js creator-core.js creator-studio.js replicate-studio.js video-production.js /app/
ENV YT_RENDER_DIR=/data YT_RENDER_HOST=0.0.0.0
EXPOSE 8787
CMD ["python", "-m", "backend"]
