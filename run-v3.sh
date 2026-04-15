#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/.run-logs"
BACKEND_PORT="${BACKEND_PORT:-8003}"
FRONTEND_PORT="${FRONTEND_PORT:-5175}"
VITE_API_BASE="${VITE_API_BASE:-http://localhost:${BACKEND_PORT}}"
FRONTEND_MODE="${FRONTEND_MODE:-preview}"

mkdir -p "$LOG_DIR"

kill_port_if_used() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempts=30

  for _ in $(seq 1 "$attempts"); do
    if curl -sSf "$url" >/dev/null 2>&1; then
      echo "$name is up: $url"
      return 0
    fi
    sleep 1
  done

  echo "Failed to start $name. Check logs in $LOG_DIR"
  return 1
}

echo "Stopping stale processes on ports ${BACKEND_PORT} and ${FRONTEND_PORT}..."
kill_port_if_used "$BACKEND_PORT"
kill_port_if_used "$FRONTEND_PORT"
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite --host 0.0.0.0 --port ${FRONTEND_PORT}" 2>/dev/null || true
pkill -f "vite preview --host 0.0.0.0 --port ${FRONTEND_PORT}" 2>/dev/null || true

if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "Creating backend virtual environment..."
  python3 -m venv "$BACKEND_DIR/.venv"
fi

echo "Ensuring backend dependencies..."
"$BACKEND_DIR/.venv/bin/python" -m pip install --quiet --upgrade pip
"$BACKEND_DIR/.venv/bin/python" -m pip install --quiet -r "$BACKEND_DIR/requirements.txt"

echo "Starting backend on port ${BACKEND_PORT}..."
(
  cd "$BACKEND_DIR"
  nohup "$BACKEND_DIR/.venv/bin/python" -m uvicorn app.main:app --reload --host 0.0.0.0 --port "$BACKEND_PORT" > "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$LOG_DIR/backend.pid"
)

echo "Ensuring frontend dependencies..."
(
  cd "$FRONTEND_DIR"
  if [ ! -d node_modules ]; then
    npm install
  fi
)

if [ "$FRONTEND_MODE" = "dev" ]; then
  echo "Starting frontend dev server on port ${FRONTEND_PORT}..."
  (
    cd "$FRONTEND_DIR"
    nohup env VITE_API_BASE="$VITE_API_BASE" npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$LOG_DIR/frontend.pid"
  )
else
  echo "Building frontend for stable preview..."
  (
    cd "$FRONTEND_DIR"
    env VITE_API_BASE="$VITE_API_BASE" npm run build > "$LOG_DIR/frontend-build.log" 2>&1
  )
  echo "Starting frontend preview server on port ${FRONTEND_PORT}..."
  (
    cd "$FRONTEND_DIR"
    nohup npm run preview -- --host 0.0.0.0 --port "$FRONTEND_PORT" > "$LOG_DIR/frontend.log" 2>&1 &
    echo $! > "$LOG_DIR/frontend.pid"
  )
fi

wait_for_http "http://localhost:${BACKEND_PORT}/api/v2/health" "Backend"
wait_for_http "http://localhost:${FRONTEND_PORT}/" "Frontend"

echo
echo "V3 is running."
echo "Frontend: http://localhost:${FRONTEND_PORT}"
echo "Backend:  http://localhost:${BACKEND_PORT}"
echo "Logs:     $LOG_DIR"
echo "Mode:     $FRONTEND_MODE"
