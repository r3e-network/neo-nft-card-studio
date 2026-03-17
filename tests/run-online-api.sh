#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

if [[ -z "${NEO_TEST_WIF:-}" ]]; then
  echo "Missing NEO_TEST_WIF. Set it to a Neo N3 testnet WIF before running tests/run-online-api.sh." >&2
  exit 1
fi

if lsof -ti:5173 >/dev/null 2>&1; then
  echo "Port 5173 is already in use. Stop the existing process before running tests/run-online-api.sh." >&2
  exit 1
fi

ONLINE_API_BASE_URL="${ONLINE_API_BASE_URL:-https://neo-nft-card-studio-api.vercel.app}"
WEB_PID=""

cleanup() {
  if [[ -n "$WEB_PID" ]] && kill -0 "$WEB_PID" 2>/dev/null; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
}

wait_for_url() {
  local url="$1"
  local timeout_seconds="$2"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi

    if (( "$(date +%s)" - started_at >= timeout_seconds )); then
      echo "Timed out waiting for $url" >&2
      return 1
    fi

    sleep 1
  done
}

trap cleanup EXIT INT TERM

curl -fsS "${ONLINE_API_BASE_URL}/api/health?network=testnet" >/dev/null

VITE_API_BASE_URL="${ONLINE_API_BASE_URL}/api" \
VITE_API_BASE_URL_MAINNET="${ONLINE_API_BASE_URL}/api" \
VITE_API_BASE_URL_TESTNET="${ONLINE_API_BASE_URL}/api" \
VITE_NEOFS_UPLOAD_MAX_MB="${VITE_NEOFS_UPLOAD_MAX_MB:-3}" \
npm run dev:web > web-online-api.log 2>&1 &
WEB_PID=$!

wait_for_url "http://127.0.0.1:5173/" 60

WIF_UI_BASE_URL="http://127.0.0.1:5173/" \
WIF_UI_SYNC_API_BASE_URL="${ONLINE_API_BASE_URL}" \
node tests/wif-ui.mjs
