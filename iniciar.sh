#!/usr/bin/env bash
# Arranque rápido en macOS / Linux:  ./iniciar.sh
set -e
cd "$(dirname "$0")"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
( sleep 2; (xdg-open http://localhost:8000 || open http://localhost:8000) >/dev/null 2>&1 ) &
python -m app
