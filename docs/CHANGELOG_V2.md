# V2 Change Log

## Milestone 0.1 — Baseline, initial safeguards, and official brand

**Date:** 2026-11-27
**Baseline commit:** `458ae22`
**Rollback:** remote branch `backup/pre-lolo-v2`
**Working branch:** `development/lolo-v2`

### Backend/security

- **Before:** local server bound to `0.0.0.0`; it was reachable from other devices on the same network by default.
  **After:** defaults to `127.0.0.1`; LAN use requires an explicit `HOST=0.0.0.0` setting.
- **Before:** provider-backed token and TTS endpoints had no per-process request cap.
  **After:** short-window limits return HTTP 429 and `Retry-After`; request identity is HMACed in memory. This is best effort only; Vercel production still needs a shared limiter.
- **Before:** JSON arrays/scalars or non-string route fields could trigger unhandled server exceptions.
  **After:** body byte caps, object-only JSON parsing, string/type validation, and a bounded excellence counter reject malformed data with HTTP 400.
- **Before:** a truncated upstream Gemini error body was written to logs.
  **After:** logs keep only the upstream status and exception type.
- **Before:** local static file routing returned a placeholder response for `favicon.ico` and had no controlled route for brand assets.
  **After:** favicon, manifest, branding, and brand helper files are served by a path allowlist with explicit MIME types; `.env` remains inaccessible.
- Added response headers locally and on Vercel, including `nosniff`, frame denial, microphone policy, referrer policy, and HSTS on Vercel.

### Brand and Android

- **Before:** the site used a prior SVG favicon and owl emoji in its welcome/home/teacher identity; Android resources used default launcher assets.
  **After:** adopted the supplied wordmark and icon, preserving both originals; generated the web favicon/PWA files and used the icon in child and parent surfaces.
- Added reusable `brand.js` rendering and central image/color tokens.
- Added Android density-specific launcher icons, adaptive foreground/background layers, API 33 monochrome layer, LOLO labels, and a branded system splash theme.
- Preserved Android package ID `com.heshammera.lolo`.
- Added a reproducible asset generator and a future iOS 1024px icon. Store promo artwork/screenshots were not fabricated because no approved screenshot set was provided.

### Verification

- 6 deterministic Python tests pass, including API input rejection, 429 throttling, allowed brand assets, and denial of `.env`.
- Python compilation, JavaScript syntax checks, and JSON parsing pass.
- Local HTTP smoke checks returned 200 for app files, curriculum, manifest, all favicon sizes, and PWA icon assets.
- Credential-pattern scan found no matches in current tracked files or committed Git history; secret values were not printed.
- Android Gradle build was not run locally because this environment has no Java runtime. The development branch's GitHub Actions build is the Android build check.
- Live AI/provider calls were not run and no API credits were consumed by tests.

## Milestone 0.2 — Refresh deprecated CI actions

- **Before:** Android workflow used `checkout@v4`, `setup-node@v4`, `setup-java@v4`, and `upload-artifact@v4`; the successful build reported deprecated Node 20 runtimes and deprecated setup-java v4.
- **After:** workflow uses current major releases (`checkout@v7`, `setup-node@v7`, `setup-java@v6`, `upload-artifact@v7`) to use supported Node 24 runtimes.
- **Verification:** a new Android workflow run is required; not yet verified.

## Milestone 1.1 — Resilient local progress and session timers

- **Before:** one invalid JSON value in `localStorage` could throw during app startup; quota/security errors from writes were uncaught. **After:** `storage.js` safely reads, checks the top-level data shape, preserves malformed values in place, and reports storage failures without crashing the app.
- **Before:** the lesson-duration timeout created an untracked goodbye timeout. That timeout could fire during a later session and stop the new lesson. **After:** a session timer registry invalidates all pending callbacks when a session ends or a new session begins; asynchronous token/transport setup is cancelled or ignored when its session is stale.
- **Before:** leaving the page or backgrounding the app could leave voice resources active. **After:** active sessions close on page hide/background, microphone tracks/audio connections are closed, and late microphone permission results are stopped.
- Added automated Node tests for corrupt storage, quota failures, and stale session timers. Added the tests to the Android CI workflow.
- **Verification:** 7 Python security/API tests and 2 Node resilience tests pass; Python and JavaScript syntax checks pass; local HTTP smoke checks cover the app shell, curriculum, PWA/brand assets, and both new scripts; Android resource/build validation is tracked in the CI run after push. No live AI calls are used.

## Milestone 1.2 — Run CI checks from the repository root

- **Before:** the workflow ran Python tests from inside `android-apk`, so `server.py` was outside Python's import path and the security test module could not load.
- **After:** the workflow changes to the repository root before running Python and Node tests, then returns to the existing Android build step.
- **Verification:** GitHub Actions run `45935676035` passed all 7 Python tests, both Node tests, the Android debug build, and APK upload. Downloaded artifact SHA256: `e51aa09ae6fe2dfadf3af90d4f5f1874d92aee1401b034a4f65c03a30277e4fd`.

## Milestone 1.3 — Independent assessment for advanced writing and math

- **Before:** advanced writing activities compared answer strings or used drawing-overlap heuristics inline; results had no shared question/attempt IDs, did not normalize spoken-style number forms, and parent details omitted the child's actual response and retry count. Duplicate attempts were guarded only by UI state.
- **After:** `assessment-engine.js` normalizes English text and Arabic/English numerals and number words, scores answer variants against local expected answers, classifies handwriting similarity as incorrect/partial/correct with a conservative confidence marker, assigns question/attempt IDs, and makes duplicate attempt IDs idempotent. The advanced writing/maths path now consumes its decision and preserves each tracing retry. Parent results show the child's response, retry count, and trace similarity.
- **Scope limit:** this engine is currently wired only to advanced writing/math activities. Live spoken lessons and oral quizzes still accept AI-declared correctness and need a curriculum-authored assessment contract. Browser-local results remain editable.
- **Verification:** 7 Python tests, all 3 Node test files, Python/JavaScript syntax checks, `git diff --check`, and local HTTP checks for the app, curriculum, and assessment module pass. New CI run is pending; no paid/live AI calls are involved.
