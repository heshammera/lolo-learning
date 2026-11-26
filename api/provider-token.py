"""Vercel function for issuing short-lived voice-provider session tokens."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler as BaseHandler  # noqa: E402


class handler(BaseHandler):
    pass
