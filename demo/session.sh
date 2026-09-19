#!/usr/bin/env bash
# A scripted "day" for a live demo on Hyprland: hops between workspaces, focuses each window in
# turn the way a person would, and fires mock notifications along the way. About 3.5 minutes.
# Run it from any terminal AFTER Silmari is recording the whole screen. Ctrl+C stops it.
#   demo/session.sh            full run
#   demo/session.sh --fast     half the pauses (for a rehearsal)
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
SCALE=1; [ "${1:-}" = "--fast" ] && SCALE=2
START_WS=$(hyprctl activeworkspace -j | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')

say() { printf '\033[1;36m%s\033[0m  %s\n' "$(date +%H:%M:%S)" "$*"; }
pause() { local s=$(( $1 / SCALE )); for ((i=s; i>0; i--)); do printf '\r   … %2ds ' "$i"; sleep 1; done; printf '\r          \r'; }
ws() { hyprctl dispatch workspace "$1" >/dev/null; say "workspace $1"; }
# focus every window on the current workspace, one after another, dwelling on each
tour_windows() {
  local dwell=$1 cur; cur=$(hyprctl activeworkspace -j | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')
  hyprctl clients -j | python3 -c "
import sys,json
for c in sorted([c for c in json.load(sys.stdin) if c.get('mapped') and c['workspace']['id']==$cur], key=lambda c:(c['at'][1],c['at'][0])):
    print(c['address'], c['class'], c['title'][:40])" | while read -r addr cls title; do
    hyprctl dispatch focuswindow "address:$addr" >/dev/null
    say "  focus $cls · $title"
    pause "$dwell"
  done
}
workspaces=$(hyprctl clients -j | python3 -c 'import sys,json; print(" ".join(str(i) for i in sorted({c["workspace"]["id"] for c in json.load(sys.stdin) if c.get("mapped") and c["workspace"]["id"]>0})))')
say "workspaces with windows: $workspaces  (starting on $START_WS)"
say "make sure Silmari is recording the whole screen. starting in 5 s"; pause 5

# 1. settle on the first workspace and work through its windows
first=$(echo $workspaces | cut -d' ' -f1)
ws "$first"; pause 12
tour_windows 15

# 2. a message arrives while working
say "Slack notification"; "$HERE/notify.sh" slack; pause 14

# 3. move to the next workspace, look around, come back
for w in $(echo $workspaces | cut -d' ' -f2-); do
  ws "$w"; pause 14
  tour_windows 12
done

# 4. mail arrives, gets ignored, we go back to the first workspace
say "Gmail notification"; "$HERE/notify.sh" gmail; pause 12
ws "$first"; pause 12
tour_windows 10

# 5. a burst of messages while switching quickly (fast multitasking)
say "burst of notifications"; "$HERE/notify.sh" burst &
for w in $workspaces $first; do ws "$w"; pause 6; done
wait

# 6. end where Silmari is, so the timeline can be shown
silmari_ws=$(hyprctl clients -j | python3 -c 'import sys,json
c=[c for c in json.load(sys.stdin) if c.get("mapped") and "Silmari" in c["title"]]
print(c[0]["workspace"]["id"] if c else "")')
[ -n "$silmari_ws" ] && ws "$silmari_ws"
say "done. give the model ~15 s, then scrub the timeline."
