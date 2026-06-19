# OCR sidecar — PP-OCRv5 (ONNX Runtime) behind a tiny HTTP server.
# Debian slim (glibc) because onnxruntime-node ships glibc prebuilds; alpine/musl
# would need a source build. libgomp1 is ONNX Runtime's OpenMP runtime dep.
FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
RUN chown -R node:node /app

USER node
# Bake the model into the image so the container never downloads at runtime
# (survives restarts, works offline). Caches under /home/node/.cache.
RUN node -e "import('ppu-paddle-ocr').then(m => m.PaddleOcrService.downloadModels())"

EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
