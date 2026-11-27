"""Opt-in Vercel family account endpoint."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import Handler as BaseHandler


class handler(BaseHandler):
    pass
