#!/usr/bin/env bash
# Starts the tracker inside a GitHub Codespace (run automatically when you open it).
cd "$(dirname "$0")/.."

if curl -s -o /dev/null http://localhost:8080/api/setup; then
  echo "The tracker is already running on port 8080 (see the PORTS tab)."
else
  [ -d dist/client ] || npm run build
  nohup npm start > tracker.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -s -o /dev/null http://localhost:8080/api/setup && break
    sleep 1
  done
  echo "The tracker is running. Open it from the PORTS tab (port 8080). Server log: tracker.log"
fi

if [ -f data/initial-passwords.txt ]; then
  echo
  echo "Temporary passwords (each person sets their own at first sign-in):"
  cat data/initial-passwords.txt
fi
