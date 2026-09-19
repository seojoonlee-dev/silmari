#!/usr/bin/env bash
# A scripted "day" for a live demo on Hyprland: hops between workspaces, focuses each window in
# turn the way a person would, and fires mock notifications along the way. About 30 seconds.
# Run it from any terminal AFTER Silmari is recording the whole screen. Ctrl+C stops it.
#   demo/session.sh            full run
#   demo/session.sh --slow     same, slower (about a minute)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SLOW=0; [ "${1:-}" = "--slow" ] && SLOW=1
START_WS=$(hyprctl activeworkspace -j | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

say() { printf '\033[1;36m%s\033[0m  %s\n' "$(date +%H:%M:%S)" "$*"; }
pause() { local s=$1; [ "${1:-}" != "" ] && [ "$SLOW" = 1 ] && s=$(( s * 2 )); for ((i=s; i>0; i--)); do printf '\r   … %2ds ' "$i"; sleep 1; done; printf '\r          \r'; }
# Hyprland 0.56's hyprctl dispatch takes Lua, so use the hl.dsp API directly.
ws() { hyprctl eval "return hl.dispatch(hl.dsp.focus({ workspace = $1 }))" >/dev/null; say "workspace $1"; }
# focus every window on the current workspace, one after another, dwelling on each
tour_windows() {
  local dwell=$1 cur; cur=$(hyprctl activeworkspace -j | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
  hyprctl clients -j | python3 -c "
import sys,json
for c in sorted([c for c in json.load(sys.stdin) if c.get('mapped') and c['workspace']['id']==$cur], key=lambda c:(c['at'][1],c['at'][0])):
    print(c['address'], c['class'], c['title'][:40])" | while read -r addr cls title; do
    hyprctl eval "return hl.dispatch(hl.dsp.focus({ window = \"address:$addr\" }))" >/dev/null
    say "  focus $cls · $title"
    pause "$dwell"
  done
}
workspaces=$(hyprctl clients -j | python3 -c 'import sys,json; print(" ".join(str(i) for i in sorted({c["workspace"]["id"] for c in json.load(sys.stdin) if c.get("mapped") and c["workspace"]["id"]>0})))')
say "workspaces with windows: $workspaces  (starting on $START_WS)"
say "make sure Silmari is recording the whole screen. starting in 3 s"; pause 3

# 1. settle on the first workspace and work through its windows
first=$(echo $workspaces | cut -d' ' -f1)
ws "$first"; pause 3
tour_windows 2

# 2. a message arrives while working
say "Slack notification"; "$HERE/notify.sh" slack; pause 5

# 3. move to the next workspace, look around, come back
for w in $(echo $workspaces | cut -d' ' -f2-); do
  ws "$w"; pause 3
  tour_windows 2
done

# 4. mail arrives, gets ignored, we go back to the first workspace
say "Gmail notification"; "$HERE/notify.sh" gmail; pause 5
ws "$first"; pause 3

# 5. a burst of messages while switching quickly (fast multitasking)
say "burst of notifications"; "$HERE/notify.sh" burst &
for w in $workspaces $first; do ws "$w"; pause 2; done
wait

# 6. end where Silmari is, so the timeline can be shown
silmari_ws=$(hyprctl clients -j | python3 -c 'import sys,json
c=[c for c in json.load(sys.stdin) if c.get("mapped") and "Silmari" in c["title"]]
print(c[0]["workspace"]["id"] if c else "")')
[ -n "$silmari_ws" ] && ws "$silmari_ws"
say "done. give the model ~10 s, then scrub the timeline."
