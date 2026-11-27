# V2 Change Log

## Milestone 0.1 — Baseline, initial safeguards, and official brand

**Date:** 2026-11-27
**Baseline commit:** `458ae22`
**Rollback:** remote branch `backup/pre-lolo-v2`
**Working branch:** `development/lolo-v2`

### Backend/security

- **Before:** local server bound to `0.0.0.0`; it was reachable from other devices on the same network by default.
  **After:** defaults to `127.0.0.1`; LAN use requires an explicit `HOST=0.0.0.0` setting.
- **Before:** provider-backed token and TTS endpoints had no per-process request cap.
  **After:** short-window limits return HTTP 429 and `Retry-After`; request identity is HMACed in memory. This is best effort only; Vercel production still needs a shared limiter.
- **Before:** JSON arrays/scalars or non-string route fields could trigger unhandled server exceptions.
  **After:** body byte caps, object-only JSON parsing, string/type validation, and a bounded excellence counter reject malformed data with HTTP 400.
- **Before:** a truncated upstream Gemini error body was written to logs.
  **After:** logs keep only the upstream status and exception type.
- **Before:** local static file routing returned a placeholder response for `favicon.ico` and had no controlled route for brand assets.
  **After:** favicon, manifest, branding, and brand helper files are served by a path allowlist with explicit MIME types; `.env` remains inaccessible.
- Added response headers locally and on Vercel, including `nosniff`, frame denial, microphone policy, referrer policy, and HSTS on Vercel.

### Brand and Android

- **Before:** the site used a prior SVG favicon and owl emoji in its welcome/home/teacher identity; Android resources used default launcher assets.
  **After:** adopted the supplied wordmark and icon, preserving both originals; generated the web favicon/PWA files and used the icon in child and parent surfaces.
- Added reusable `brand.js` rendering and central image/color tokens.
- Added Android density-specific launcher icons, adaptive foreground/background layers, API 33 monochrome layer, LOLO labels, and a branded system splash theme.
- Preserved Android package ID `com.heshammera.lolo`.
- Added a reproducible asset generator and a future iOS 1024px icon. Store promo artwork/screenshots were not fabricated because no approved screenshot set was provided.

### Verification

- 6 deterministic Python tests pass, including API input rejection, 429 throttling, allowed brand assets, and denial of `.env`.
- Python compilation, JavaScript syntax checks, and JSON parsing pass.
- Local HTTP smoke checks returned 200 for app files, curriculum, manifest, all favicon sizes, and PWA icon assets.
- Credential-pattern scan found no matches in current tracked files or committed Git history; secret values were not printed.
- Android Gradle build was not run locally because this environment has no Java runtime. The development branch's GitHub Actions build is the Android build check.
- Live AI/provider calls were not run and no API credits were consumed by tests.
