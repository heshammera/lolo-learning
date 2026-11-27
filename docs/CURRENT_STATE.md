# Current State

**Reviewed:** 2026-11-27
**Baseline:** `458ae22` (`Ignore downloaded Android APK artifact`)
**Working branch:** `main` (new local schema work; the user requested updates on Vercel-linked main)

## Product and runtime

- Static Arabic RTL interface: `index.html`, `app.js`, `pcm-processor.js`.
- Python standard-library server: `server.py`; Vercel Python endpoints import its handler from `api/`.
- Curriculum data: `curriculum.json` (schema 2.0: 12 foundation units, 12 Connect Plus units, 11 Math units, 140 lessons, and 140 lesson-linked skills).
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

Phase 0 / Phase 1 safeguards, branding, deterministic writing/math grading, and a bounded lesson-token oral repeat test are implemented. OpenAI oral-test replies are gated by local transcript grading. Curriculum schema v2 and validation are deployed: 140 lessons carry versions and link to stable skill records. Open comprehension questions, pronunciation evaluation, Gemini parity, normal lesson assessment, skill mastery and spaced review remain open. `main` is at `83e8ab6` (implementation `5eb1f75`), Vercel deployment succeeded, and `backup/pre-lolo-v2` remains at the old baseline `458ae22`.
