#!/usr/bin/env bash
# Run the tracker inside a GitHub Codespace.
#
#   bash scripts/codespace-start.sh          build and (re)start the tracker
#   bash scripts/codespace-start.sh update   get the latest code from GitHub, then build and restart
#   bash scripts/codespace-start.sh attach   start only if not already running (used automatically)
#
# The database (data/tracker.db) is kept across restarts and updates.
cd "$(dirname "$0")/.."
MODE="${1:-restart}"

running() { curl -s -o /dev/null http://localhost:8080/api/setup; }

if [ "$MODE" = attach ] && running; then
  echo "The tracker is already running. Open it from the PORTS tab (port 8080)."
  exit 0
fi

if [ "$MODE" = update ]; then
  echo "Getting the latest code..."
  git pull --ff-only || { echo "git pull failed: see the message above."; exit 1; }
  npm install --no-audit --no-fund || exit 1
fi

if [ "$MODE" != attach ] || [ ! -f dist/client/index.html ]; then
  echo "Building..."
  npm run build > build.log 2>&1 || { cat build.log; echo "Build failed."; exit 1; }
fi

# Stop a tracker that is already running, so the new build is used.
if pgrep -f "^node dist/server/index.js" > /dev/null; then
  echo "Stopping the running tracker..."
  pkill -f "^node dist/server/index.js"
  for _ in $(seq 1 20); do running || break; sleep 0.5; done
fi

nohup node dist/server/index.js > tracker.log 2>&1 &
for _ in $(seq 1 30); do running && break; sleep 1; done
if running; then
  echo "The tracker is running. Open it from the PORTS tab (port 8080) and refresh the page."
else
  echo "The tracker did not start. Last lines of tracker.log:"
  tail -20 tracker.log
  exit 1
fi

if [ -f data/initial-passwords.txt ]; then
  echo
  echo "Temporary passwords (each person sets their own at first sign-in):"
  cat data/initial-passwords.txt
fi
