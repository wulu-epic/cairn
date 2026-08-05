#!/usr/bin/env bash
# Launch chrome-headless-shell in Docker with CDP exposed on port 9222.
# Usage: ./scripts/launch-chrome.sh [port]
set -euo pipefail

PORT="${1:-9222}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "Building and starting chrome-headless-shell (CDP on port $PORT)..."
docker compose up --build -d

echo -n "Waiting for CDP endpoint..."
for i in $(seq 1 30); do
    if curl -s "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
        echo " ready!"
        echo ""
        echo "Chrome CDP endpoint: http://localhost:$PORT"
        echo "Playwright: await chromium.connectOverCDP('http://localhost:$PORT')"
        exit 0
    fi
    echo -n "."
    sleep 1
done

echo " FAILED: CDP endpoint not responding after 30s"
docker compose logs --tail=20
exit 1
