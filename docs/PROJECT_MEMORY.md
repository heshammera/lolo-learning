# Project Memory

- Product: LOLO Learning, Arabic RTL education app for children, with Lolo as the teacher.
- Official assets are preserved in `assets/branding/original/`; use generated logo and icon assets without altering their shape or colors.
- Stable pre-V2 baseline: `458ae22`; rollback branch `backup/pre-lolo-v2` remains at this commit.
- V2 was promoted to `main` at merge `b9c5850`; curriculum schema v2 followed at `5eb1f75` after the user requested updates on the Vercel-linked main branch. `development/lolo-v2` remains at `021a931`.
- Never commit `.env`, provider credentials, child audio, or personal data.
- API throttling in `server.py` is a process-local best-effort control; production needs a shared edge/store limiter.
- Writing/math assessment is deterministic; oral listen-and-repeat tests in OpenAI locally match ASR transcripts to lesson tokens, but do not measure pronunciation. Gemini oral tests and normal live lessons still depend on model behavior.
- Curriculum schema v2 has versioned lesson records and one-to-one lesson skill references. `curriculum-engine.js` validates structure, IDs, references, question formats, math arithmetic, and prerequisite cycles. No authored question banks or reviewed prerequisites exist yet.
- Curriculum counts: foundation 48; Connect Plus 1 48; Math Grade 1 Languages 44; total 140.
- Android ID is `com.heshammera.lolo`; do not change it.
- Do not push to `main` or deploy production unless the user explicitly requests it.
