#!/bin/sh
set -e

if [ ! -f "public/index.html" ]; then
  echo "[start] Building frontend..."
  if [ ! -d "frontend/node_modules" ]; then
    cd frontend && npm install && cd ..
  fi
  cd frontend
  NODE_OPTIONS="--max-old-space-size=4096" npm run build
  mkdir -p ../public
  cp -r out/* ../public/
  cd ..
  echo "[start] Frontend built."
else
  echo "[start] Frontend already built, skipping build."
fi

echo "[start] Starting server..."
exec npx tsx src/index.ts
