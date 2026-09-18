#!/usr/bin/env bash
# Deploy the backend to the host in deploy.env: sync source, install deps with uv, run as a
# systemd user service, and expose it publicly with Tailscale Funnel.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
if [ ! -f "$HERE/deploy.env" ]; then
  echo "deploy.env missing, copy deploy.env.example and fill it in" >&2; exit 1
fi
# shellcheck disable=SC1091
set -a; . "$HERE/deploy.env"; set +a
: "${HOST:?set HOST in deploy.env}" "${REMOTE_DIR:?set REMOTE_DIR in deploy.env}"
PORT=${PORT:-8787}
FUNNEL_PORT=${FUNNEL_PORT:-8443}

rsync -az --delete --exclude .venv --exclude __pycache__ --exclude .env --exclude "deploy.env" "$HERE/" "$HOST:$REMOTE_DIR/"

ssh "$HOST" bash -s "$REMOTE_DIR" "$PORT" "$FUNNEL_PORT" <<'REMOTE'
set -euo pipefail
DIR=$(eval echo "$1"); PORT=$2; FUNNEL_PORT=$3
cd "$DIR"
if [ ! -f .env ]; then
  echo ".env missing at $DIR/.env — create it from .env.example first" >&2; exit 1
fi
uv sync --quiet
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/bypp-backend.service <<UNIT
[Unit]
Description=BYPP backend (FastAPI)
After=network-online.target

[Service]
WorkingDirectory=$DIR
ExecStart=$(command -v uv) run uvicorn app.main:app --host 127.0.0.1 --port $PORT
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now bypp-backend.service
systemctl --user restart bypp-backend.service
sleep 2
systemctl --user --no-pager status bypp-backend.service | head -5
tailscale funnel --bg --https="$FUNNEL_PORT" "http://127.0.0.1:$PORT"
tailscale funnel status
REMOTE
