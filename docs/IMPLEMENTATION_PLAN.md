# Lolo Learning V2 Implementation Plan

## Current milestone: Phase 5/6 foundation — independent assessment

- [x] Capture baseline commit and isolate local development branch.
- [x] Inspect repository, runtime boundaries, curriculum, API entry points, and Android wrapper.
- [x] Record counts, baseline syntax checks, and known test gaps.
- [x] Create a remote rollback branch at the pre-change commit.
- [x] Complete scoped API validation, local bind default, and rate-limit tests.
- [x] Harden local progress reads/writes against corrupt JSON and unavailable storage.
- [x] Scope lesson timers to their session, abort stale setup, and close voice sessions on app background.
- [x] Integrate official branding into web, manifest/favicon, Android adaptive icons and splash.
- [x] Build and smoke-check local web/API and Android app.
- [x] Push only the development branch; do not modify `main` or production deployment.
- [x] Add deterministic assessment for advanced writing, math, ordering, confidence bands, question/attempt IDs, and idempotency.
- [x] Add a bounded oral listen-and-repeat assessment sourced from lesson-board tokens; locally grade OpenAI transcripts and prevent OpenAI from auto-responding before the app score.
- [ ] Add authored open-comprehension questions, reliable pronunciation evaluation, and equivalent app-controlled grading for Gemini; do not treat ASR transcript match as pronunciation mastery.
- [ ] Add versioned curriculum schemas, validators, skill mapping, mastery states, and spaced review.

## Ordered milestones from the master prompt

1. Audit, baseline, and project memory.
2. Critical security and stability: API request validation, abuse limits, no secret exposure, privacy-safe errors.
3. Modular monolith refactor guarded by tests.
4. Parent/child identity and local-data migration design; implement only after data and consent decisions are explicit.
5. AI provider adapters, resilient voice lifecycle, bounded context, and safe tool contracts.
6. Curriculum schema, deterministic assessment, adaptive learning and spaced repetition.
7. Interactive English, math, handwriting, games, and stories with curriculum-backed content.
8. Child/parent UI and accessibility, including approved LOLO brand assets.
9. Offline/mobile packaging and Android/iOS preparation.
10. Commercial readiness, operational budgets, monitoring, and release controls.

Each milestone has its own acceptance checks. Do not make a database, a paid service, an AI call, or a production release a prerequisite for local testing.

## Assessment Engine acceptance boundary

The first assessment module is wired into advanced handwriting, letter/word ordering, multiple-choice writing activities, and math-writing questions. It provides deterministic answer normalization and grading, per-question and per-attempt identifiers, and in-memory idempotency. Writing-path reports retain the evaluation outcome and confidence.

Oral quizzes now use up to five lesson-board words/numbers, deduplicated and locally matched against the recognized OpenAI transcript; OpenAI VAD remains active but automatic responses are disabled in test mode, and app-initiated responses disallow tools for that turn. The transcript is a rough recognition signal, not reliable pronunciation or comprehension grading. Gemini still depends on model tool-calling for quiz flow. This does **not** make model-led live lessons or mastery trustworthy: regular lesson answers still use model claims and feedback parsing. Client-side progress also remains editable by the device owner.
