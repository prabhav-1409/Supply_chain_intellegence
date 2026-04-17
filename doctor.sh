#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.run-logs"
BACKEND_PORT="${BACKEND_PORT:-8003}"
FRONTEND_PORT="${FRONTEND_PORT:-5175}"
ALT_FRONTEND_PORT="${ALT_FRONTEND_PORT:-5173}"
OLLAMA_PORT="${OLLAMA_PORT:-11434}"

mkdir -p "$LOG_DIR"

red() { printf '\033[31m%s\033[0m\n' "$1"; }
green() { printf '\033[32m%s\033[0m\n' "$1"; }
yellow() { printf '\033[33m%s\033[0m\n' "$1"; }
info() { printf '[doctor] %s\n' "$1"; }

print_listeners() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
  else
    ss -ltnp "( sport = :$port )" || true
  fi
}

kill_port() {
  local port="$1"
  info "Clearing port $port"

  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi

  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
    if [[ -n "${pids}" ]]; then
      kill ${pids} 2>/dev/null || true
      pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
      if [[ -n "${pids}" ]]; then
        kill -9 ${pids} 2>/dev/null || true
      fi
    fi
  fi
}

check_http() {
  local name="$1"
  local url="$2"
  local out_file="$3"

  local code
  code="$(curl -sS -o "$out_file" -w '%{http_code}' "$url" || true)"

  if [[ "$code" == "200" ]]; then
    green "[ok] $name -> $url (HTTP 200)"
    return 0
  fi

  red "[fail] $name -> $url (HTTP ${code:-n/a})"
  return 1
}

info "Current listeners"
printf -- '--- port %s ---\n' "$BACKEND_PORT"
print_listeners "$BACKEND_PORT"
printf -- '--- port %s ---\n' "$FRONTEND_PORT"
print_listeners "$FRONTEND_PORT"
printf -- '--- port %s ---\n' "$ALT_FRONTEND_PORT"
print_listeners "$ALT_FRONTEND_PORT"

info "Stopping stale app processes"
pkill -f "uvicorn app.main:app" 2>/dev/null || true
pkill -f "vite --host 0.0.0.0 --port ${FRONTEND_PORT}" 2>/dev/null || true
pkill -f "vite preview --host 0.0.0.0 --port ${FRONTEND_PORT}" 2>/dev/null || true
pkill -f "npm run preview -- --host 0.0.0.0 --port ${FRONTEND_PORT}" 2>/dev/null || true
pkill -f "npm run dev -- --host 0.0.0.0 --port ${FRONTEND_PORT}" 2>/dev/null || true

kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"
kill_port "$ALT_FRONTEND_PORT"

info "Ports after cleanup"
printf -- '--- port %s ---\n' "$BACKEND_PORT"
print_listeners "$BACKEND_PORT"
printf -- '--- port %s ---\n' "$FRONTEND_PORT"
print_listeners "$FRONTEND_PORT"
printf -- '--- port %s ---\n' "$ALT_FRONTEND_PORT"
print_listeners "$ALT_FRONTEND_PORT"

info "Starting app via run-v3.sh"
cd "$ROOT_DIR"
OLLAMA_BASE_URL="${OLLAMA_BASE_URL:-http://localhost:${OLLAMA_PORT}}" OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}" ./run-v3.sh

info "Post-start checks"
backend_ok=0
frontend_ok=0
ollama_ok=0

check_http "Backend health" "http://localhost:${BACKEND_PORT}/api/v2/health" "$LOG_DIR/doctor-backend-health.json" && backend_ok=1 || true
check_http "Frontend root" "http://localhost:${FRONTEND_PORT}/" "$LOG_DIR/doctor-frontend-root.html" && frontend_ok=1 || true
check_http "Ollama tags" "http://localhost:${OLLAMA_PORT}/api/tags" "$LOG_DIR/doctor-ollama-tags.json" && ollama_ok=1 || true

info "Final listeners"
printf -- '--- port %s ---\n' "$BACKEND_PORT"
print_listeners "$BACKEND_PORT"
printf -- '--- port %s ---\n' "$FRONTEND_PORT"
print_listeners "$FRONTEND_PORT"

if [[ "$backend_ok" -eq 1 && "$frontend_ok" -eq 1 ]]; then
  green "doctor result: stack is healthy"
  exit 0
fi

red "doctor result: stack is not fully healthy"
yellow "Inspect logs in $LOG_DIR (backend.log, frontend.log, frontend-build.log)"
exit 1
