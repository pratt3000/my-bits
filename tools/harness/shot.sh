#!/bin/sh
# Render a bit and stamp the screenshot with a unique name.
# The unique name matters: image readers cache by path, so a fixed filename
# silently shows the previous render and an edit reads as having done nothing.
set -e
BIT="$1"; TAG="${2:-$(date +%s)}"
cd /home/user/my-bits
node tools/harness/run.mjs "$BIT" --ms="${3:-2200}" 2>&1 | grep -vE "404|^$" || true
OUT="/tmp/claude-0/-home-user-my-bits/5b47fb00-0ae8-5201-8db8-9b2f8b1c2232/scratchpad/${BIT}-${TAG}.png"
cp "tools/harness/shots/${BIT}-boot.png" "$OUT"
echo "$OUT"
