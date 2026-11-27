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
