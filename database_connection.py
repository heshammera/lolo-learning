"""Resolve database credentials server-side, never expose them to the client."""
import os

def database_dsn(kind="family",env=None):
    env=os.environ if env is None else env
    if kind not in ("family","budget"):raise ValueError("Unknown database scope")
    explicit=env.get("LOLO_DATABASE_URL" if kind=="family" else "LOLO_BUDGET_DATABASE_URL")
    if explicit:return explicit
    # Do not silently connect PR deployments to the production database.
    if env.get("VERCEL_ENV")!="production":return None
    if env.get("LOLO_USE_VERCEL_DATABASE")!="true":return None
    if kind=="budget" and env.get("LOLO_BUDGET_USE_FAMILY_DB")!="true":return None
    return env.get("DATABASE_URL") or env.get("POSTGRES_URL") or None
