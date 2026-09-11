#!/bin/zsh
cd "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  export NVM_DIR="$HOME/.nvm"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then source "$NVM_DIR/nvm.sh"; fi
fi
if ! command -v node >/dev/null 2>&1; then
  print "Node.js 22 or newer is required. Install it, then reopen this launcher."
  read -k 1
  exit 1
fi
if [[ ! -d node_modules/sharp || ! -d node_modules/@openai/codex ]]; then
  npm install || exit 1
fi
node server.mjs &
studio_pid=$!
trap 'kill "$studio_pid" 2>/dev/null' EXIT INT TERM
for attempt in {1..60}; do
  if ! kill -0 "$studio_pid" 2>/dev/null; then
    wait "$studio_pid"
    exit $?
  fi
  if curl --silent --fail "http://localhost:${PORT:-4317}/api/state" >/dev/null; then
    open "http://localhost:${PORT:-4317}"
    break
  fi
  sleep 0.5
done
wait "$studio_pid"
