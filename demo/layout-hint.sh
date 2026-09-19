#!/usr/bin/env bash
# Optional helper for Hyprland: sends the real window rectangles of the active workspace to Silmari
# every 2 seconds, so windows that share a dark theme are never merged. Usage:
#   SILMARI_PASSWORD=... demo/layout-hint.sh <device-id> <server-url>
# The device id is in the browser's localStorage under "silmari.device" (or ask the server log).
set -uo pipefail
DEV=${1:?device id}; URL=${2:?server url, e.g. https://your-host:8443}; PW=${SILMARI_PASSWORD:?set SILMARI_PASSWORD}
TOK=$(curl -s -X POST "$URL/api/login" -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])') || exit 1
echo "sending layout hints for $DEV to $URL (Ctrl+C to stop)"
while true; do
  body=$(hyprctl -j monitors | python3 -c '
import sys, json, subprocess
mons=json.load(sys.stdin); mon=next((m for m in mons if m.get("focused")), mons[0])
mx,my,mw,mh=mon["x"],mon["y"],mon["width"]/mon["scale"],mon["height"]/mon["scale"]
ws=mon["activeWorkspace"]["id"]
cs=json.loads(subprocess.run(["hyprctl","-j","clients"],capture_output=True,text=True).stdout)
out=[]
for c in cs:
    if not c.get("mapped") or c.get("hidden") or c["workspace"]["id"]!=ws: continue
    x,y=c["at"]; w,h=c["size"]
    out.append({"cls":c["class"],"title":c["title"][:120],"bbox":[round((x-mx)/mw,4),round((y-my)/mh,4),round((x-mx+w)/mw,4),round((y-my+h)/mh,4)]})
print(json.dumps({"device":sys.argv[1],"windows":out}))' "$DEV")
  curl -s -o /dev/null -X POST "$URL/api/hint" -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' -d "$body"
  sleep 2
done
