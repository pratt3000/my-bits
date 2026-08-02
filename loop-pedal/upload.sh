#!/usr/bin/env bash
# Upload the Loop Pedal draft to Plethora.
#
# Prereq: you have paired an agent and hold a one-time access token
# (starts with "plag_"). See README "Uploading" for the pairing steps, or
# pair via the web dashboard at https://create.plethora.studio/agent-pair.
#
# Usage:
#   ./upload.sh <ACCESS_TOKEN> [BASE_URL]
#
# BASE_URL defaults to https://create.plethora.studio
set -euo pipefail

TOKEN="${1:?Pass the Plethora agent access token (plag_...) as arg 1}"
BASE="${2:-https://create.plethora.studio}"
DIR="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD="$DIR/draft-payload.json"

[ -f "$PAYLOAD" ] || { echo "Missing $PAYLOAD"; exit 1; }

echo "Uploading draft to $BASE/v1/agent/bits/drafts ..."
for attempt in 1 2 3 4; do
  if curl -sS -f -X POST "$BASE/v1/agent/bits/drafts" \
      -H "Authorization: Plethora-Agent $TOKEN" \
      -H "Content-Type: application/json" \
      --data-binary "@$PAYLOAD" \
      -o /tmp/plethora-draft-resp.json -w "HTTP %{http_code}\n"; then
    echo "Upload OK. Response:"
    cat /tmp/plethora-draft-resp.json
    echo
    echo "Draft created. Publish stays manual from the Plethora app/dashboard."
    exit 0
  fi
  echo "Attempt $attempt failed; retrying in $((2**attempt))s ..."
  sleep "$((2**attempt))"
done

echo "Upload failed after retries. Last response:"
cat /tmp/plethora-draft-resp.json 2>/dev/null || true
exit 1
