#!/usr/bin/env bash
# Fire mock notifications for a live demo. Usage:
#   demo/notify.sh slack            one Slack message from Minji
#   demo/notify.sh gmail            one Gmail message from Prof. Han
#   demo/notify.sh burst            three in a row, a few seconds apart
# Needs a notification daemon; starts dunst if none is running (Linux). On macOS use
# `osascript -e 'display notification "..." with title "..."'`, on Windows PowerShell's BurntToast.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
if command -v pgrep >/dev/null && ! pgrep -x dunst >/dev/null && ! pgrep -x swaync >/dev/null && ! pgrep -x mako >/dev/null; then
  command -v dunst >/dev/null && { dunst >/dev/null 2>&1 & disown; sleep 0.5; }
fi
slack() { notify-send -a Slack -i "$HERE/icons/slack.png" -t 12000 "Minji Park · #hackathon" "did you send the intro draft yet?"; }
gmail() { notify-send -a Gmail -i "$HERE/icons/gmail.png" -t 12000 "Prof. Han" "Office hours moved to Friday 14:00, room 302"; }
case "${1:-slack}" in
  slack) slack ;;
  gmail) gmail ;;
  burst) slack; sleep 4; gmail; sleep 4; notify-send -a Slack -i "$HERE/icons/slack.png" -t 12000 "Jiho Kim · #hackathon" "demo is at 9, can someone bring the HDMI adapter" ;;
  *) echo "usage: $0 slack|gmail|burst" >&2; exit 1 ;;
esac
