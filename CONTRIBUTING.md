# Contributing to RepoForeman

RepoForeman is an early public beta. Small, focused changes with tests and clear security consequences are easier to review than broad rewrites.

## Before opening a change

- Search existing issues and discussions when a public repository is available.
- Submit changes through a pull request; direct updates to `main` are blocked.
- For a behavior change, describe the user problem and expected CLI or artifact contract.
- For a security issue, follow [SECURITY.md](SECURITY.md) and do not open a public report.
- Do not include proprietary source, customer data, run artifacts, credentials, or private prompts in fixtures.

## Local setup

Requirements are Node.js `22.14.0` or newer, npm, and Git.

```bash
npm ci
npm run check:metadata
npm test
npm run self-test
npm pack --dry-run
```

The self-test uses a disposable repository and a fake Codex executable. It should not require authentication or a live model call.

## Design constraints

- Keep runtime npm dependencies at zero unless maintainers explicitly approve a change to that contract.
- Preserve safe defaults. Broader filesystem, network, environment, or command access must be explicit and visibly unsafe.
- Treat policy checks as defense in depth, not as a sandbox.
- Bound retries and preserve enough artifacts to explain failures.
- Validate agent-produced structured data before using it.
- Avoid embedding product-specific test commands, documentation names, privacy rules, or repository paths in defaults.
- Keep the CLI usable on supported macOS and Linux versions.
- Do not add telemetry or external data transmission without explicit design discussion and documentation.

## Tests and documentation

Add or update tests for parsing, state transitions, policy behavior, artifact handling, and failure paths. A behavior change also requires updates to the README or relevant file in `docs/`.

Before requesting review, confirm:

- `npm run check` passes locally;
- unit tests pass without a real Codex account;
- the isolated self-test passes;
- `npm pack --dry-run` contains runtime assets and excludes tests, local artifacts, and credentials;
- runtime dependencies remain empty;
- no source-specific names or paths have been reintroduced;
- security and privacy consequences are described.

GitHub Actions repeats `npm run check` on macOS and Linux with Node.js 22.14 and 24. The pull request must have a successful `Required CI` result and all review conversations must be resolved before merge. The current beta does not require an approving review, but maintainers may still request one for higher-risk changes.

## Commit and review scope

Use descriptive commits and keep refactors separate from behavior changes when practical. Maintainers may request changes to schemas or migration notes when an artifact contract changes. Contribution does not imply that a feature will be accepted or that a `0.x` API will remain stable.
