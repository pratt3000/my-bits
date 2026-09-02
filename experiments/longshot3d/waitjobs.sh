#!/bin/sh
# Poll until every submission id given on the command line has left the queue.
SCRATCH=/tmp/claude-0/-home-user-my-bits/1b040449-f8b6-5bc0-9de4-2b105cb7a462/scratchpad
cd /home/user/longshot3d
i=0
while [ $i -lt 60 ]; do
  ARGS="["
  for id in "$@"; do
    ARGS="$ARGS{\"tool\":\"thrixel_job_status\",\"args\":{\"submission_id\":\"$id\"},\"timeout\":120},"
  done
  ARGS="${ARGS%,}]"
  OUT=$(timeout 200 python3 "$SCRATCH/session.py" "$ARGS" 2>&1)
  PENDING=$(printf '%s' "$OUT" | grep -c "status: processing\|status: queued\|status: pending")
  if [ "$PENDING" = "0" ]; then
    printf '%s\n' "$OUT" | grep -v "^structured:" | head -40
    exit 0
  fi
  i=$((i+1))
  sleep 20
done
echo "TIMED_OUT after 20 min"
exit 1
