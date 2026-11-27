# Security Audit

**Assessment date:** 2026-11-27. No provider key values were read or copied.

## Findings

| ID | Severity | Finding / evidence | Status and acceptance |
|---|---|---|---|
| SEC-01 | P1 | Public `/api/provider-token`, `/api/onboarding-audio`, and `/api/challenge-audio` can invoke paid provider APIs; no durable limiter or account identity existed at baseline. Routes are dispatched in `server.py:265`; short-lived limits now live in `server.py:22` and are applied before dispatch. | Added bounded in-process per-route limits and JSON/type checks. This is only a defense-in-depth limit; production acceptance still requires a shared edge or datastore limiter and alerting. |
| SEC-02 | P1 | Live lessons still accept model `is_correct` and tutor-feedback parsing. Browser `localStorage` is editable. | Oral tests no longer accept a model-submitted score. OpenAI oral tests disable automatic responses and grade recognized transcripts locally against lesson-board tokens. Gemini still depends on model tool calls; ASR can misrecognize speech and local storage is editable. Do not treat conversational mastery or pronunciation as independently verified. |
| SEC-03 | P1 | No authenticated parent identity, parental gate, consent workflow, or durable child data governance exists. | Open: required before multi-user/commercial launch; define minimum data collection and vendor review first. |
| SEC-04 | P1 | TTS responses are held in process memory; this is bounded for challenge prompts but not a distributed cache. | Open: evaluate cache privacy, TTL, budget, and provider retention before external shared storage. |
| SEC-05 | P2 | Baseline local server bound to `0.0.0.0`, unnecessarily exposing local API routes on the LAN. | Fixed: default bind is `127.0.0.1`; explicit `HOST` override is needed for a LAN test. |
| SEC-06 | P2 | Baseline logged truncated upstream Gemini token error response bodies. | Fixed: log only the upstream HTTP status; never print token/credential response bodies. |
| SEC-07 | P2 | No CSP, request tracing policy, or persistent security monitoring is configured. | Open: design CSP against actual WebRTC/WebSocket provider paths; add observability without recording child audio/transcripts. |

## Safeguards now present

- `.env` and `.env.*` are ignored; `.env.example` contains names/placeholders only.
- API responses include `Cache-Control: no-store` and security headers.
- Static local serving is allowlisted; public branding files are limited to the branding tree and safe file suffixes.
- Provider responses expose short-lived session tokens, not provider API keys.
- New process-local throttles use an ephemeral HMAC of the client address rather than storing raw IP values.
- Provider-backed test calls are not part of the automated suite.

## Production limitation

Vercel serverless instances do not share process memory reliably. The in-process limiter is not sufficient as the sole cost-control layer for public production traffic. Configure a shared edge/WAF or durable rate-limit store before broad public access, then verify real behavior with a safe staging deployment.
