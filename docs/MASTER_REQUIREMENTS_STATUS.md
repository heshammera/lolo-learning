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

First-backup queue promoted at ae98c9e after run 46054696792. User approved independent owner CMS and expanded dynamic activity library; keep all prior requirements. Activity registry candidate: seven v1 contracts/evaluators/shared accessible preview renderer, draft science examples only. Server validation, CMS, publishing, download and remaining activities pending.

Activity Library candidate: separate admin metadata, runtime-derived support, template drift audit, target compatibility and local-only visual prototype. Not a deployed or authenticated admin CMS. Existing activity registry CI still required before promotion.

Admin identity candidate adds separate admin DB, operator enrollment with encrypted TOTP seed, replay prevention, role policy, revocable short sessions and audit. No admin HTTP surface, account provision or real deployment yet. Prior activity library CI pending.

Admin identity promoted at 0ab2878 after PostgreSQL and Android checks. Separate local admin web candidate: authenticated read-only Activity Library, server-side role checks, HttpOnly cookie, origin guard, local login rate cap. Production HTTPS deployment and all CMS mutation workflows pending.

CMS draft candidate: server-validated structured drafts, role-checked read/edit, atomic revisions, basic JSON template editor. No publication or learner delivery. Full visual editing, review/versioning, client capability compatibility and all remaining V2 requirements pending.

CMS draft foundation promoted at 20dbc12 after admin and Android checks. Visual editor candidate: no-code unit/lesson/activity editing with all seven runtime configs and preview, save/check against existing backend. Publishing, taxonomy management, client delivery and remaining types pending.

Visual editor first CI failed browser locator; accessible select labels fixed in 3e33a65 (not yet verified). Staged CMS review/release candidate adds separate reviewer, revisioned transitions, snapshot history and rollback; no student publishing or production service. All prior requirements retained.

Visual editor promoted at 3e33a65 after passing browser and Android CI. Review tests failed during fixture cleanup; fixed in 11324ce, rerun pending. Content package candidate adds shared schema, pinned-key verification and P-256 signing primitive; no delivery or production key configured.

CMS review and signed package verified/promoted at 829bc63. Candidate active release export with server permission, persistent sequence and IndexedDB signed package staging, no production key or learner activation. Real download/UI/subject catalog and remaining activities pending.

Content export/install promoted at d7e5747 after all three CI workflows. Additional curriculum runtime candidate: parent-gated signed file import, verified installed list, explicit scope and offline session practice. Empty pinned keys disable production; no network download, saved new curriculum progress or real device test. Prior V2 requirements remain.

Content runtime promoted at bbc65d8 after family/Android CI. Checkpoint candidate: per-local-profile, per-release/sequence/scope, resume after each resolved response, bounded local practice results only. Full signed import UI E2E, live delivery, consent, advanced activities and remaining master requirements still open.

Local checkpoints verified/promoted at 2352edc (family and Android checks). Signed curriculum UI E2E candidate tests real app, SW offline reload, import, tamper rejection, resume, update and scope boundaries using ephemeral fixture key. Production trust still empty; no live delivery.
Checkpoint promoted at 2352edc. Signed UI E2E reached offline resume and score but failed visible Next assertion; fixed 7b4258d, rerun pending. Opt-in curated public delivery candidate includes read-only catalog, fixed endpoint, metadata/signature check, parent download UI; no real keys or live catalog, no entitlements yet.

Delivery and signed E2E promoted at 41114e6 after successful Android and family checks. Candidate expansion adds four bounded offline activity contracts, matching authoring fields and tests (11 implemented / 18 planned). Free-text means accepted short answers only; essay review remains pending. Production catalog/trust and device verification still pending.

Four additional offline contracts at 617b9f7 passed admin and Android test/build steps (final artifact publication pending when checked). Candidate adds pointer drag/drop, shape identification and bounded linear equations (14/29) with editor and tests. General geometry/algebra, real touch device, production delivery and remaining 15 types remain open.

Interaction expansion promoted at a771b7d after both CI workflows. Games candidate adds memory, ordering puzzle and maze with visual authoring and offline validation (17 implemented / 12 planned if verified). Image jigsaws and comprehensive game metrics remain future extensions. Production delivery and actual device checks remain open.

Games verified/promoted at 62d1759. Candidate adds fixed diagram hotspots, bounded balance simulation and branching text story (20 implemented / 9 planned). Custom images, richer simulations/multimedia stories and actual device/accessibility testing remain open. No production trust/delivery activation.
Visual Android passed; admin browser count failed due to story page using lesson CSS class. Fixed fa7547c, rerun pending. Drawing candidate adds three limited activity contracts (23/29) and completion-only evidence excluded from grades. CI and real-device tests pending.
Admin HTTPS staging candidate: exact dedicated origin, shared proxy authentication, Secure host-only cookies, HSTS, database-backed global login quota, operator IP restriction template and systemd configuration. Local mode unchanged. CI, live TLS/ingress/security review and owner provisioning remain required; no public deployment or real data.

Admin HTTPS staging, local progress backup and stable Android signing support promoted; real VPS/DNS/DB, signing key and device install checks still required. Dictation and self-confirmed speech repeat promoted at 786a65e after successful branch Android/admin CI. Reading-aloud candidate: segmented offline self-confirmed practice only; no microphone, fluency, timing or accuracy metrics; 26/29 candidate contracts, three planned. Actual phoneme scoring and consent/provider work remain open.

Guided conversation candidate: offline authored text dialogue, bounded ordered turns, reset and deterministic selected-reply scoring; no free conversation, microphone, generative AI or language proficiency claim. 27/29 candidate contracts, two planned. Live conversation and specialized phoneme scoring remain open.

Offline guided dialogue and reading practice promoted; pronunciation safety and homework storage/review foundations promoted, but no live provider or production homework upload. Adaptive review candidate: exact installed signed package scope and profile-local checkpoint; incomplete practice resumes first, completed attempts suggest the lesson with most observed errors. Ungraded completion excluded, no mastery labels or automatic progression, no AI requests. CI pending; long-term skill adaptation and spaced repetition integration remain open.

Cloud merge candidate: explicit parent-confirmed union of completed original curriculum lesson IDs, exact remote revision CAS, retain remote path unchanged including null, local profile untouched, durable version-2 queue retains approved source and merged snapshots for exact retry. Existing first-backup queues preserved. No unattended sync, automatic identity link, real consent or production deployment; local restore remains independent copy. CI pending.
