#!/bin/sh
# Validate the actual pinned driver in Vercel previews without accessing their database.
# Only production with explicit opt-in may connect, using the existing read-only gate.
set -eu
case "${VERCEL_ENV:-}" in
  production|preview) ;;
  *) echo "LOLO_NEON_VERIFY=SKIPPED: not Vercel deployment."; exit 0 ;;
esac
probe() {
  "$1" -I -c 'import sys; assert sys.version_info[:2] == (3, 12); import psycopg; from psycopg import pq; assert pq.version() > 0' >/dev/null 2>&1
}
run_gate() {
  echo "LOLO_NEON_DRIVER=PASS: Python 3.12 and PostgreSQL driver loaded."
  if [ "${VERCEL_ENV:-}" != "production" ]; then
    echo "LOLO_NEON_VERIFY=SKIPPED: preview; no database connection."
    return 0
  fi
  if [ "${LOLO_USE_VERCEL_DATABASE:-}" != "true" ]; then
    echo "LOLO_NEON_VERIFY=SKIPPED: database opt-in disabled."
    return 0
  fi
  "$1" -I scripts/verify_neon_schema.py
}
for candidate in .vercel/python/.venv/bin/python .venv/bin/python python3.12 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && probe "$candidate"; then
    run_gate "$candidate"
    exit 0
  fi
done
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
if command -v uv >/dev/null 2>&1; then
  if ! uv venv --python 3.12 "$tmp/venv" >/dev/null 2>&1 || ! uv pip install --python "$tmp/venv/bin/python" -r requirements.txt >/dev/null 2>&1; then
    echo "LOLO_NEON_VERIFY=FAILED: PINNED_DRIVER_INSTALL_FAILED" >&2
    exit 1
  fi
elif command -v python3.12 >/dev/null 2>&1; then
  if ! python3.12 -m venv "$tmp/venv" >/dev/null 2>&1 || ! "$tmp/venv/bin/python" -m pip install --disable-pip-version-check --quiet -r requirements.txt >/dev/null 2>&1; then
    echo "LOLO_NEON_VERIFY=FAILED: PINNED_DRIVER_INSTALL_FAILED" >&2
    exit 1
  fi
else
  echo "LOLO_NEON_VERIFY=FAILED: PYTHON_312_UNAVAILABLE" >&2
  exit 1
fi
if ! probe "$tmp/venv/bin/python"; then
  echo "LOLO_NEON_VERIFY=FAILED: PINNED_DRIVER_IMPORT_FAILED" >&2
  exit 1
fi
run_gate "$tmp/venv/bin/python"
