# Technical Debt Register

| ID | Priority | Debt | Next action |
|---|---|---|---|
| TD-01 | P1 | `app.js` owns UI, provider transport, assessment, curriculum selection, persistence, writing canvas, and games in one file. | Extract modules gradually with behavior tests; retain the current entry point during migration. |
| TD-02 | P1 | Model tool calls currently carry answer correctness and mastery evidence; no independent assessment catalog exists. | Define typed question/answer criteria per lesson before changing score semantics. |
| TD-03 | P1 | LocalStorage has no schema version, migration layer, cross-device sync, or user identity. | Add versioned storage adapters and migration tests; later decide whether accounts are needed. |
| TD-04 | P1 | No parent authentication/gate and no documented consent lifecycle. | Product/legal/privacy decision before production accounts or analytics. |
| TD-05 | P1 | API throttling is process-local and resets between serverless instances. | Add shared edge throttling before exposing public API endpoints broadly. |
| TD-06 | P2 | Curriculum JSON is not schema-validated in CI; lesson structure is implicit. | Publish JSON Schema and validate all lessons before introducing curriculum editing. |
| TD-07 | P2 | No tests for UI, voice fallbacks, storage migrations, curriculum, or scoring at baseline. | Add deterministic backend tests first, then browser interaction tests with mocked provider transport. |
| TD-08 | P2 | Inline styles and DOM IDs couple app logic to one document. | Extract UI styles and introduce small module boundaries while preserving behavior. |
| TD-09 | P2 | Android wrapper points to production Vercel URL and is not a locally bundled offline app. | Add an explicit development URL/build profile and later package lesson assets for offline use. |
| TD-10 | P3 | No production monitoring/budget alerts or backup/restore process for future server data. | Design only after choosing account/data architecture. |
