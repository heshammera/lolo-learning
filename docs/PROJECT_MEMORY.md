# Project Memory

- Product: LOLO Learning, Arabic RTL education app for children, with Lolo as the teacher.
- Official assets are preserved in `assets/branding/original/`; use generated logo and icon assets without altering their shape or colors.
- Stable baseline: `main` at `458ae22`; rollback branch `backup/pre-lolo-v2`.
- Active work branch: `development/lolo-v2`.
- Never commit `.env`, provider credentials, child audio, or personal data.
- API throttling in `server.py` is a process-local best-effort control; production needs a shared edge/store limiter.
- Assessment currently is not independently authoritative: do not describe it as verified until curriculum-backed scoring is implemented.
- Curriculum counts: foundation 48; Connect Plus 1 48; Math Grade 1 Languages 44; total 140.
- Android ID is `com.heshammera.lolo`; do not change it.
- Do not push to `main` or deploy production unless the user explicitly requests it.
