"""Vercel function for checking configured voice providers."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler as BaseHandler  # noqa: E402


class handler(BaseHandler):
    pass
