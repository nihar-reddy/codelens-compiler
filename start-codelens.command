#!/bin/bash
set -e
cd "$(dirname "$0")"
export CODELENS_HOST="127.0.0.1"
export CODELENS_PORT="8023"
printf '\n========================================\n'
printf ' CodeLens 1.3.3 — Fresh Engine Fix\n'
printf '========================================\n'
printf 'Project folder: %s\n' "$PWD"
printf 'Website:        http://127.0.0.1:8023\n'
printf 'Health check:   http://127.0.0.1:8023/api/health\n'
printf '\nKeep this Terminal window open. Press Control+C to stop the server.\n\n'
exec python3 server.py
