#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${HAXBALL_VPS_HOST:-}" ]]; then
  echo "HAXBALL_VPS_HOST is required, e.g. user@server-ip" >&2
  exit 1
fi

if [[ -z "${HAXBALL_VPS_PATH:-}" ]]; then
  echo "HAXBALL_VPS_PATH is required, e.g. /opt/haxball_analytics" >&2
  exit 1
fi

if [[ -z "${HAXBALL_VPS_RESTART_COMMAND:-}" ]]; then
  echo "HAXBALL_VPS_RESTART_COMMAND is required, e.g. 'pm2 restart haxball-analytics'" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Syncing project to ${HAXBALL_VPS_HOST}:${HAXBALL_VPS_PATH}"
rsync -az --delete \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude ".git/" \
  --exclude ".venv/" \
  --exclude "node_modules/" \
  --exclude "dist/" \
  --exclude "data/" \
  --exclude "logs/" \
  --exclude "*.log" \
  "${ROOT_DIR}/" "${HAXBALL_VPS_HOST}:${HAXBALL_VPS_PATH}/"

echo "Installing, building, validating, and restarting live room"
ssh "${HAXBALL_VPS_HOST}" "set -euo pipefail
cd '${HAXBALL_VPS_PATH}'
npm install
npm run build
export PATH=\"\$HOME/.local/bin:\$PATH\"
npm run bruin:validate
${HAXBALL_VPS_RESTART_COMMAND}
"

echo "Live deploy complete. Test: !bruin top players"
