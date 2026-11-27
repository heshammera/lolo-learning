# Data Privacy and Child Safety

## Current data flow

- Microphone audio is sent from the browser to the active realtime AI provider after the parent/child starts a voice session.
- Provider keys remain on the Python server. A short-lived connection token is returned to the browser.
- Lesson progress, test summaries, writing scores, and parent preferences are stored in browser `localStorage` on that device.
- Parent settings and destructive actions use a device-local PIN gate. The PIN and recovery code are not stored in plaintext: salted PBKDF2-SHA256 hashes and lockout state are stored in browser `localStorage`.
- The recovery code is shown once during setup or rotation. If it is lost, clearing the browser's local application data removes the gate but also deletes locally stored learning progress and preferences; there is no server-side recovery.
- No application account database or server-side child profile exists in this repository.
- Onboarding/challenge narration requests contain fixed or bounded text; the server caches responses in process memory.

## Do not collect by default

Avoid full name, address, school, precise location, contact details, and raw audio retention. Do not add analytics/session replay that captures child speech or text without a reviewed consent and retention plan.

## Before a public child-facing release

- Review provider age rules, regional requirements, data processing, and retention settings for each enabled vendor.
- Add guardian-facing disclosures and consent flows appropriate to the actual markets.
- Decide how a parent exports/deletes data and how consent withdrawal is enforced.
- Define incident response, access controls, and retention periods before adding accounts or server-side child data.
- Document that local browser data can be cleared or modified and does not sync between devices.
- Treat the PIN gate as a casual local-device barrier only; it is not parent identity verification or server-side authorization.
