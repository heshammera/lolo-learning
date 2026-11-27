# Software Audit

## Scope inspected

Git history and branch state; tracked files; app entry points; local environment variable names (values intentionally not inspected); Vercel configuration; Android wrapper and workflow; curriculum hierarchy; frontend scoring/storage flow; provider/token and TTS server handlers.

## Existing capabilities

| Capability | Main implementation | State at baseline | Main dependency/risk |
|---|---|---|---|
| Welcome and child UI | `index.html`, `app.js` | Present | Inline CSS, single large JS file |
| Curriculum selection | `curriculum.json`, `app.js` | Present; 140 lessons | JSON shape is the runtime contract |
| Voice lessons/tests | `app.js`, `server.py`, `api/provider-token.py` | Present | External realtime providers and browser microphone |
| Lesson mastery and progress | `app.js` | Present | AI judgment is accepted client-side; `localStorage` only |
| Visual math activities | `app.js` | Present | AI tool arguments drive client activity state |
| Touch writing challenges | `app.js` | Present | Canvas and browser input; no automated browser coverage |
| TTS for onboarding/challenges | `server.py`, Vercel function files | Present | Public provider-backed endpoints can incur cost |
| Android wrapper | `android-apk/` | Present | Loads hosted URL; does not bundle credentials |
| Deployment workflow | `.github/workflows/build-android.yml`, `vercel.json` | Present | Android artifact is a debug APK |

## Verified curriculum shape

- Foundation: 12 units × 4 lessons = 48.
- Connect Plus 1: 12 units × 4 lessons = 48.
- Math Grade 1 Languages: 11 units × 4 lessons = 44.
- Total: 35 units, 140 lessons.

## Key findings

1. The project is a working monolith, not yet a multi-user platform. The browser owns progress, settings, reports, and answer history in `localStorage`.
2. Lesson answer correctness and completion are client-side decisions informed by the live model. This is not an independent assessment authority and is not tamper-resistant.
3. Provider-backed API endpoints were publicly callable without request throttling at baseline. This creates a provider-credit abuse risk.
4. The local server bound to all interfaces at baseline despite being documented primarily for same-device use.
5. There are no repository-authored automated tests at baseline; Android’s generated sample tests do not cover LOLO behavior.
6. The Android app loads a remote URL, so web changes are reflected without a new APK; native icon/splash changes require a new build.
7. The browser tab and deployment can be public to anyone with the URL; no authenticated parent account or parental gate exists at baseline.
8. Current API configuration avoids sending provider keys to the browser, and `.env` is ignored by Git. Keep that invariant.

Line-level implementation findings and fixes are tracked in `SECURITY_AUDIT.md` and `TECHNICAL_DEBT.md`.
