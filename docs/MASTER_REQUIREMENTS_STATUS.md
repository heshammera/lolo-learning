# V2 requirements reconciliation (initial)
Baseline reviewed: ad961a92d0da892353be285973af6f015b988f6a. This is a milestone-level inventory, not a complete atomic requirements matrix.
| Area | Current state | Next |
|---|---|---|
| Sections 1–5, 37–43 audit/memory | Partial; audit and memory files exist | trace every requirement, run baseline and update evidence |
| 6 architecture | Partial; vanilla modules exist | modularize app, incremental TypeScript/React and FastAPI |
| 7–12 security/identity/child safety | Partial; request validation, local rate limiting and PIN exist | real identity, authorization, quota/consent, provider policy verification |
| 13 audio | Partial; timers/cleanup/fallback on setup | runtime failover, latency, lifecycle tests, safe session handling |
| 14–17 learning | Partial; schema, token repetition evidence and review | educator-authored questions, evidence-specific mastery, prerequisites |
| 18–24 activities | Partial; English/math/writing/rewards | pronunciation, richer games, stories, homework safeguards |
| 25–27 UX/dashboard | Partial; existing parent UI | age-specific design, admin and analytics |
| 28–36 operations/mobile | Partial; APK CI, branding | durable quotas/cache, offline, monitoring, accounts, billing, releases |
| 44 multi-subject | Partial; schema registry exists | subject/activity/evaluator registries, CMS, Science proof |
| 45 brand | Mostly implemented per previous documentation | independently verify assets and actual Android launcher |
| 46 learning scope | Candidate implementation on verification branch | CI, browser and authorized voice/device checks |
Do not reimplement completed features without checking code and tests. Never mark untested requirements verified. Keep the backup branches unchanged. The main branch is production-linked and must only receive verified changes.

Offline milestone candidate: public shell service worker, bundled native UI, bounded API transport, local review, and offline notice. Device and provider checks remain open. No cross-device synchronization yet.

Offline milestone promoted at 0a198c9 after run 46049057338 passed. Visual assessment pilot candidate: 24 draft choice items across 8 lessons; no mastery claims or educator review; broader authored content and runtime verification remain open.

Subject catalog candidate: shared program/lesson enumeration, subject metadata/capability resolution, draft program exclusion, conservative fallbacks and synthetic science path tests. Not a complete universal subject engine, CMS, or published science curriculum.

Visual and subject catalog promoted at 3aa27c8 after run 46050817415 passed. Voice safety candidate adds process-local aggregate limits, kill switches, validation and interruption handling; distributed quota, true authentication and provider policy verification remain open.

Voice safety promoted at 70423f4. Family backend candidate: PostgreSQL schema, operator provisioning, salted password hashes, expiring/revocable sessions and parent-owned profiles. Disabled by default; no production DB, registration UI, identity/consent or progress migration yet.

Local profiles candidate: independent on-device learning paths, settings and results, protected management UI. No connection to server profiles or multi-device synchronization.

Family backend and local profiles promoted at 4875a31 and fb473d6 respectively. New progress sync candidate: strict limited snapshots, owner authorization, atomic revision checks and exact retry handling. No real data, production configuration, consent or client sync yet.

Progress backend promoted at 25f9a9d. Staging UI candidate adds temporary login, synthetic profiles, explicit first backup preview; no remote overwrite or restore, no persistent linking/queue, consent still open.

Restore candidate: explicit copy of limited remote snapshot into a new local profile; no automatic overwrite, identity link or sync queue.

Restore copy promoted at f2e93ad after successful checks. Pending first-backup queue candidate retains approved snapshot and operation ID after lost response, explicit authenticated retry only. No unattended sync or update of existing remote versions.
