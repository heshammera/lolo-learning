# Current Status
- Main: 70423f4303920d4a2bccefd0f98e0fbc50bb1711; run 46051660196 passed all existing Python/Node, browser offline and APK checks. Voice safety changes promoted; deployment still to verify.
- Current candidate: disabled-by-default PostgreSQL family identity foundation on verification/family-backend-20261127. See docs/FAMILY_BACKEND.md. Database not connected in production, no registration UI/consent/sync.
- Offline and scoped learning preserved. Backups unchanged. Full V2 incomplete; native phone, live voice and signing continuity unverified.

- Local profile candidate on verification/local-profiles-20261127: isolated storage namespaces, parent-gated create/rename/switch and offline browser test. Existing legacy data remains default. CI pending; no cloud sync.
