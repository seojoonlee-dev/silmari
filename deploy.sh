#!/usr/bin/env bash
# Deploy to the host in deploy.env: sync the repo, build the frontend and install the
# backend there, run the backend as a systemd user service (it serves the frontend build
# and the API on one port), and expose that port with Tailscale Funnel.
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

rsync -az --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude .venv --exclude __pycache__ \
  --exclude .env --exclude '.env.*' --exclude deploy.env --exclude .canvas \
  "$HERE/" "$HOST:$REMOTE_DIR/"

ssh "$HOST" bash -s "$REMOTE_DIR" "$PORT" "$FUNNEL_PORT" <<'REMOTE'
set -euo pipefail
DIR=$(eval echo "$1"); PORT=$2; FUNNEL_PORT=$3
if [ ! -f "$DIR/backend/.env" ]; then
  echo "backend/.env missing at $DIR/backend/.env — create it from .env.example first" >&2; exit 1
fi
cd "$DIR/frontend" && npm ci --silent && npm run build --silent
cd "$DIR/backend" && uv sync --quiet
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/silmari.service <<UNIT
[Unit]
Description=Silmari backend (FastAPI, serves frontend build + API)
After=network-online.target

[Service]
WorkingDirectory=$DIR/backend
ExecStart=$DIR/backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port $PORT
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now silmari.service
systemctl --user restart silmari.service
sleep 2
systemctl --user --no-pager status silmari.service | head -5
tailscale funnel --bg --https="$FUNNEL_PORT" "http://127.0.0.1:$PORT"
tailscale funnel status
REMOTE
