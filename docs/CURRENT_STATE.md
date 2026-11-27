# Current State

**Reviewed:** 2026-11-27
**Baseline:** `458ae22` (`Ignore downloaded Android APK artifact`)
**Working branch:** `development/lolo-v2` (local work is in progress)

## Product and runtime

- Static Arabic RTL interface: `index.html`, `app.js`, `pcm-processor.js`.
- Python standard-library server: `server.py`; Vercel Python endpoints import its handler from `api/`.
- Curriculum data: `curriculum.json` (JSON hierarchy: 12 foundation units, 12 Connect Plus units, and 11 Math units; 140 lessons total).
- Learning progress and parent settings are stored in browser `localStorage`.
- Realtime speech uses short-lived provider tokens issued server-side; provider order and features are controlled in `app.js` / `server.py`.
- Android is a Capacitor shell (`android-apk/`) targeting the hosted Vercel URL; package ID is `com.heshammera.lolo`.
- No application database, user accounts, durable cross-device progress, or checked-in automated browser suite is present at baseline.

## Baseline checks

- Python syntax compilation passed for `server.py` and `api/*.py`.
- Node syntax checks passed for `app.js` and `pcm-processor.js` using the locally installed Node runtime.
- Curriculum was parsed and counted: 140 lessons / 35 units / 3 learning tracks.
- No repository test script or Python test suite existed at baseline.
- Live AI calls were not made; they can spend provider credits and require credentials.
- Android build status is pending for this work branch.

## Current work status

Phase 0 audit and Phase 1 foundational safeguards are underway. Local edits are isolated on `development/lolo-v2`; the remote backup branch `backup/pre-lolo-v2` points to the baseline commit. Production `main` has not been changed or deployed.
