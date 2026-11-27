# Architecture (as implemented and transition target)

## Current runtime

```text
Browser / Android Capacitor WebView
  ├── index.html + app.js + pcm-processor.js + assessment-engine.js + curriculum-engine.js
  ├── curriculum.json (schema and content versions, programs, lessons, skills)
  └── localStorage (lesson progress, tests, settings)
          │ same-origin JSON requests
          ▼
Python Handler (local server.py / Vercel api/*.py)
  ├── short-lived provider token minting
  ├── onboarding and challenge TTS
  └── status endpoint
          │ provider API keys stay server-side
          ▼
Gemini Live / Gemini backup / OpenAI Realtime
```

## Current boundaries

- `curriculum.json` is the curriculum source of truth.
- `curriculum-engine.js` validates the fetched curriculum before the app renders it; `scripts/validate-curriculum.js` applies the same rules in CI.
- Browser UI and client persistence are trusted only for convenience, not authoritative scoring or identity.
- `assessment-engine.js` handles deterministic writing/math responses and lesson-board-token oral repeat checks. OpenAI oral tests use app-gated VAD and local transcript matching; Gemini still relies on model tool calls. ASR is not pronunciation grading, and local results remain editable.
- API provider keys remain server-only. Browser sessions receive short-lived tokens.
- Android `appId` remains `com.heshammera.lolo`; Android currently loads the hosted site.

## Incremental target

Keep a modular monolith. First isolate configuration, provider adapters, API validation/throttling, curriculum validation, assessment rules, and versioned persistence. Add accounts and a database only after the product requires cross-device profiles and a reviewed privacy model. Do not move to microservices without measured need.
