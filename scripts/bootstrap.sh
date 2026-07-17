#!/usr/bin/env sh
set -eu
python3.12 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -e '.[dev,vision]'
.venv/bin/python scripts/download_mediapipe_models.py
pnpm install
printf '%s\n' 'Ready. Activate with: . .venv/bin/activate'
