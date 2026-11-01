# Contributing to GalaxyQuest

## Before opening a pull request

1. Check the [production-readiness roadmap](ROADMAP.md) and relevant
   [technical documentation](docs/INDEX.md) before starting broad changes.
2. Keep changes focused. Add or update tests for behavior changes and explain
   migration or operational effects in the pull request.
3. Never commit credentials, session material, user data, generated runtime
   output, or local environment files.

## Branches and pull requests

- Use a descriptive branch name such as `feature/<topic>`, `fix/<topic>`, or
  `docs/<topic>`.
- Target `develop` for normal changes. Target `main` only for an explicitly
  coordinated release or urgent fix.
- Open a pull request with a concise summary, linked issue or roadmap finding
  when applicable, test results, and screenshots for user-visible changes.
- Keep the pull request reviewable and address CI failures before requesting
  final review.

Branch protection and required reviewer policies are not yet configured;
these instructions do not imply that GitHub currently enforces them.

## Quality checks

Run the relevant checks from the repository root before submitting:

```powershell
npm ci
npm run lint:js
npm run test:unit:js -- --reporter=dot
npm run vite:build
npm run check:bundle-budget
actionlint
```

For Python changes:

```powershell
ruff check tts_service/ scripts/
ruff format --check tts_service/ scripts/
```

Run the TTS service tests from `tts_service/` with `pytest tests/ -v`.
Python type checks are defined in
[`.github/workflows/python-quality.yml`](.github/workflows/python-quality.yml).

For PHP changes, run `php -l` on changed files and
`vendor/bin/phpunit --no-coverage` after installing Composer dependencies and
starting the MySQL test service. The CI workflow also runs Composer's locked
dependency audit.

The Playwright smoke-test job uses `docker-compose.ci.yml` to run only the web
and database services with TTS and the NPC LLM controller disabled.

If a local tool, database, Docker daemon, or platform-specific capability is
unavailable, state that explicitly instead of reporting the check as passed.

## Security-sensitive changes

Do not disclose suspected vulnerabilities in a public pull request. Follow
[`SECURITY.md`](SECURITY.md) for private reporting.
