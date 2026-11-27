# Lolo Learning V2 Implementation Plan

## Current milestone: Phase 0 + Phase 1 safeguards

- [x] Capture baseline commit and isolate local development branch.
- [x] Inspect repository, runtime boundaries, curriculum, API entry points, and Android wrapper.
- [x] Record counts, baseline syntax checks, and known test gaps.
- [x] Create a remote rollback branch at the pre-change commit.
- [x] Complete scoped API validation, local bind default, and rate-limit tests.
- [x] Harden local progress reads/writes against corrupt JSON and unavailable storage.
- [x] Scope lesson timers to their session, abort stale setup, and close voice sessions on app background.
- [ ] Integrate official branding into web, manifest/favicon, Android adaptive icons and splash.
- [ ] Build and smoke-check local web/API and Android app.
- [ ] Push only the development branch; do not modify `main` or production deployment.

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
