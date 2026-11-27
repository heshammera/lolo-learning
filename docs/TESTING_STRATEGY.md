# Testing Strategy

## Baseline

- Python syntax compilation: passed before edits.
- JavaScript syntax checks (`app.js`, `pcm-processor.js`): passed before edits.
- Curriculum parse/count: passed (140 lessons).
- Existing app tests: none at baseline beyond generated Android sample tests.

## Current deterministic checks

- Python `unittest` for limiter behavior, API input rejection, response security headers, public asset routing, and `.env` non-public routing (7 tests).
- Node tests for safe local storage, deterministic writing/math/oral-repeat assessment normalization/grading/idempotency, curriculum schema/references/skill cycles, and stale session timer callbacks (4 test files).
- Curriculum validation checks 3 programs, 35 units, 140 lessons, and 140 skill records; current missing authored question banks, localization, accessibility, and reviewed difficulty are warnings, not hidden.
- Python bytecode syntax compilation for serverless handlers.
- Node syntax checks for frontend files.
- Android Gradle debug build and resource validation.
- Local HTTP smoke checks for index, curriculum, manifest, branding images, API validation, and static path rejection.

## Later coverage

- Unit: curriculum schema/IDs, oral assessment rules and OpenAI VAD gating, mastery rules, provider selection, progress migrations, audio lifecycle state transitions.
- Integration: provider adapter mocks, realtime tool validation, rate-limit adapter, TTS cache bounds.
- Browser E2E: onboarding, course filtering, lesson transitions, answer retries, tests/reports, touch tracing, responsive and reduced-motion states.
- Security: malformed JSON/types/size, path traversal, CORS/CSRF, API cost limits, key scanning, child data minimization.
- AI quality: fixed lesson transcripts and scoring cases; never use paid live calls by default.
- Load: only against an isolated staging service and after budget/consent.
