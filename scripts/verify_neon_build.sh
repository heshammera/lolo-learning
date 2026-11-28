#!/bin/sh
# A production-only, read-only deployment gate; no public diagnostic API.
set -eu
if [ "${LOLO_USE_VERCEL_DATABASE:-}" != "true" ]; then
  echo "LOLO_NEON_VERIFY=SKIPPED: database opt-in disabled."
  exit 0
fi
if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "LOLO_NEON_VERIFY=SKIPPED: not production."
  exit 0
fi
if python3 -c 'import psycopg' >/dev/null 2>&1; then
  python3 scripts/verify_neon_schema.py
  exit 0
fi
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
if ! python3 -m venv "$tmp/venv" >/dev/null 2>&1 || ! "$tmp/venv/bin/python" -m pip install --disable-pip-version-check --quiet -r requirements.txt >/dev/null 2>&1; then
  echo "LOLO_NEON_VERIFY=FAILED: unable to install verification driver." >&2
  exit 1
fi
"$tmp/venv/bin/python" scripts/verify_neon_schema.py
