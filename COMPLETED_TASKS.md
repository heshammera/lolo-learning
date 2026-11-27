# Completed Tasks

- Added a device-local parent PIN gate for parent settings and sensitive local reset actions. Includes salted PIN/recovery hashes, throttling, auto-lock, recovery/PIN change flows, and deterministic tests. Commit `6f7cfcd` is deployed to Vercel-linked `main`; this remains a device barrier, not server authentication.

## Pre-V2 baseline

- Added the Capacitor Android shell and GitHub Actions debug APK workflow (baseline history).
- Added `.gitignore` coverage for local APK outputs (baseline history).

## V2 work

- Added recognized-token skill progress and spaced review for oral repeat quizzes; verified in GitHub Actions and deployed to Vercel. The measurement limits are documented in `docs/CHANGELOG_V2.md`.

- Added baseline docs, API input validation and in-process rate limiting, local-only server binding, security headers, official branding across web/Android, storage recovery handling, and generation-scoped session timers.
- Built an updated Android debug APK from GitHub Actions.
- Added the first independent assessment module for advanced writing/math activities: normalized answers, math word/digit parsing, partial handwriting feedback, question/attempt IDs, duplicate protection, and richer parent results. Normal live lesson scoring remains model-dependent.
- Added OpenAI app-gated oral listen-and-repeat testing and schema-v2 curriculum versioning/validation with stable skill references for all 140 lessons. Authored question banks, accessibility/difficulty/localization metadata, prerequisite edges, mastery, and spaced review remain open.
