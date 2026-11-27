# Completed Tasks

## Pre-V2 baseline

- Added the Capacitor Android shell and GitHub Actions debug APK workflow (baseline history).
- Added `.gitignore` coverage for local APK outputs (baseline history).

## V2 work

- Skill-progress and spaced-review wiring is in progress; current status and verification boundaries are in `CURRENT_STATUS.md` and `docs/IMPLEMENTATION_PLAN.md`.

- Added baseline docs, API input validation and in-process rate limiting, local-only server binding, security headers, official branding across web/Android, storage recovery handling, and generation-scoped session timers.
- Built an updated Android debug APK from GitHub Actions.
- Added the first independent assessment module for advanced writing/math activities: normalized answers, math word/digit parsing, partial handwriting feedback, question/attempt IDs, duplicate protection, and richer parent results. Normal live lesson scoring remains model-dependent.
- Added OpenAI app-gated oral listen-and-repeat testing and schema-v2 curriculum versioning/validation with stable skill references for all 140 lessons. Authored question banks, accessibility/difficulty/localization metadata, prerequisite edges, mastery, and spaced review remain open.
