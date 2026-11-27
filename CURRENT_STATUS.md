# Current Status

- Baseline: `458ae22`.
- Latest milestone: device-local parent PIN barrier committed as `6f7cfcd` and pushed to Vercel-linked `main`.
- Existing completed work: Phase 0/1 safeguards, brand, writing/math assessment, OpenAI transcript-gated oral repeat tests, curriculum schema v2.1, and deterministic skill-progress/spaced-review.
- Backup: remote `backup/pre-lolo-v2` points to the pre-change baseline.
- Branches: `main` and `origin/main` are at `6f7cfcd`; `backup/pre-lolo-v2` and `origin/backup/pre-lolo-v2` remain at `458ae22`; `development/lolo-v2` remains at `021a931`. The feature branch `codex/lolo-v2-next` tracks the promoted commit locally.
- Vercel: the public site returns HTTP 200 and serves the new parent-gate UI and `/parent-gate.js`, alongside curriculum version `2.1.0` and `learning-engine.js`.
- Verification: all 9 Python tests and all 6 Node test files passed locally, including parent PIN hashing/lockout/recovery/auto-lock cases; Python compilation and `git diff --check` passed. Local app, live Vercel app, and the new parent-gate asset returned HTTP 200. GitHub Actions run `46018068496` passed the full test and Android build. No live AI calls were made.
- Android: updated debug APK is available at `outputs/lolo-android-apk/parent-pin-6f7cfcd/app-debug.apk`; SHA256 `939383d604e8ae7c1340dc8888a732bd9c082eb8b117f89523cb60dac1acbfbf`.
- See `docs/CHANGELOG_V2.md` for before/after detail and `docs/NEXT_ACTION.md` for the next milestone.

## Learning scope verification milestone
Candidate path engine and UI/session integration added on verification/learning-scope-20261127 from ad961a92d0da892353be285973af6f015b988f6a. Backup branch created. This candidate has not been promoted to main or verified on live AI or Android. See docs/LEARNING_PATH_ARCHITECTURE.md and docs/MASTER_REQUIREMENTS_STATUS.md.
