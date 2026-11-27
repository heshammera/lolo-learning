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

- Learning scope milestone promoted to main at 45b5b0c; workflow 46048242427 passed.
- Offline milestone promoted at 0a198c9; workflow 46049057338 passed unit, browser offline and APK build. Native phone verification remains open.

- Visual comprehension pilot and subject catalog promoted to main at 3aa27c8; run 46050817415 passed. Content remains draft; no published Science course.

- Voice safety milestone promoted at 70423f4 after run 46051660196 passed. Distributed quotas and account authorization remain open.

- Family backend promoted at 4875a31 after PostgreSQL run 46052517826 and Android run 46052517789 passed.
- Local profiles promoted at fb473d6 after run 46052818258 passed offline browser switching and Android build.

- Progress sync backend promoted at 25f9a9d after PostgreSQL and Android/browser checks passed (46053423531, 46053423600); disabled by default.

- Queue milestone promoted at ae98c9e after successful CI run 46054696792.
