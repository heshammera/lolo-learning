# Data Privacy and Child Safety

## Current data flow

- Microphone audio is sent from the browser to the active realtime AI provider after the parent/child starts a voice session.
- Provider keys remain on the Python server. A short-lived connection token is returned to the browser.
- Lesson progress, test summaries, writing scores, and parent preferences are stored in browser `localStorage` on that device.
- Parent settings and destructive actions use a device-local PIN gate. The PIN and recovery code are not stored in plaintext: salted PBKDF2-SHA256 hashes and lockout state are stored in browser `localStorage`.
- The recovery code is shown once during setup or rotation. If it is lost, clearing the browser's local application data removes the gate but also deletes locally stored learning progress and preferences; there is no server-side recovery.
- The repository now contains opt-in family account and minimal child-profile schemas, and the production Neon schema passed a read-only deployment check. Hosted account features remain disabled; the pilot is synthetic-only and requires a separate reviewed database. No real account provisioning or production progress sync has been demonstrated.
- Onboarding/challenge narration requests contain fixed or bounded text; the server caches responses in process memory.

## Do not collect by default

Avoid full name, address, school, precise location, contact details, and raw audio retention. Do not add analytics/session replay that captures child speech or text without a reviewed consent and retention plan.

## Before a public child-facing release

- Review provider age rules, regional requirements, data processing, and retention settings for each enabled vendor.
- Add guardian-facing disclosures and consent flows appropriate to the actual markets.
- Decide how a parent exports/deletes data and how consent withdrawal is enforced.
- Define incident response, access controls, and retention periods before adding accounts or server-side child data.
- Document that local browser data can be cleared or modified. The limited synthetic cloud path requires parent authorization and does not synchronize all local settings, scores or audio; no unattended real-user synchronization has been enabled.
- Treat the PIN gate as a casual local-device barrier only; it is not parent identity verification or server-side authorization.
