# Repository Guidance

- Keep changes incremental and preserve working child/parent flows.
- Do not read, print, copy, commit, or expose `.env` values. Keep API keys server-side.
- Run deterministic tests and syntax/build checks for changed subsystems; do not use paid live AI calls in tests.
- Treat AI-generated correctness/tool arguments as untrusted input. Validate all data that changes progress.
- Minimize child data; never log audio, transcripts, secrets, or identifying information.
- Preserve the `com.heshammera.lolo` Android application ID.
- Keep releases local/on development branch until the user requests production deployment. `main` is the stable version; `backup/pre-lolo-v2` is the pre-V2 rollback point.
- Update `docs/` and root status/memory files when completing a milestone.
