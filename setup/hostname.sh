#!/bin/bash
# Adds a friendly /etc/hosts entry mapping a memorable hostname to 127.0.0.1.
# After this, http://ground.control:4242/ resolves locally just like
# http://localhost:4242/ — except it reads like a real name. Idempotent.
#
# Customize:
#   GC_HOSTNAME=tower.local bash setup/hostname.sh
set -e

HOST="${GC_HOSTNAME:-ground.control}"
PORT="${GC_PORT:-4242}"
LINE="127.0.0.1 $HOST"
HOSTS_FILE="/etc/hosts"

if grep -qE "^[[:space:]]*127\.0\.0\.1[[:space:]]+$HOST([[:space:]]|$)" "$HOSTS_FILE" 2>/dev/null; then
  echo "✓ $HOST already in $HOSTS_FILE"
  echo "  visit  →  http://$HOST:$PORT/"
  exit 0
fi

echo "Adding to $HOSTS_FILE (requires sudo):"
echo "  $LINE"
echo
echo "$LINE" | sudo tee -a "$HOSTS_FILE" >/dev/null

# macOS DNS cache flush so resolution picks up immediately.
if [[ "$(uname)" == "Darwin" ]]; then
  sudo dscacheutil -flushcache 2>/dev/null || true
  sudo killall -HUP mDNSResponder 2>/dev/null || true
fi

echo "✓ done  →  http://$HOST:$PORT/"
echo
echo "To undo:  sudo sed -i '' \"/127\\.0\\.0\\.1[[:space:]]\\{1,\\}$HOST/d\" $HOSTS_FILE"
