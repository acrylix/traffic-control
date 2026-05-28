#!/bin/bash
# ground-control statusline relay
# ───────────────────────────────────────────────────────────────────────────
# Reads Claude's statusline JSON on stdin, fans it out to two places:
#   1. POST /e/beat on the GC collector — the heartbeat that powers ctx%,
#      tokens, cost, rate-limit gauges in the dashboard.
#   2. Whatever statusline command you actually want displayed (default:
#      ccstatusline, override with GC_STATUSLINE_CMD).
#
# Transparent passthrough: ccstatusline still renders normally. If the GC
# collector is down, the beat fails silently in ≤1s and ccstatusline still
# runs. Never blocks Claude.

set -u

# Slurp stdin once — the payload is small and we need to send it to two sinks.
INPUT=$(cat)

# Sink 1: heartbeat to the collector. 1s cap so a downed collector can't
# delay your statusline. -o /dev/null + 2>/dev/null so nothing of ours
# ever appears in the line Claude renders.
printf '%s' "$INPUT" \
  | curl -sm1 -o /dev/null \
      -X POST "${GC_INGEST_URL:-http://localhost:4242}/e/beat" \
      --data-binary @- 2>/dev/null \
  || true

# Sink 2: the real statusline command — its stdout is what Claude shows.
# Default to ccstatusline; override with GC_STATUSLINE_CMD if you use a
# different one (e.g. GC_STATUSLINE_CMD="my-statusline --color").
CMD="${GC_STATUSLINE_CMD:-npx -y ccstatusline@latest}"
printf '%s' "$INPUT" | eval "$CMD"
