# AGENTS.md — RepoForeman Contributor Contract

This file applies to the entire repository. It defines durable instructions for coding agents and contributors working on RepoForeman itself. It is not a template for consumer repositories and must not be injected into projects that use RepoForeman.

## Start here

Before a broad or behavior-changing edit, read:

- `README.md` for product scope, supported workflows, and public claims;
- `CONTRIBUTING.md` for contribution expectations;
- `SECURITY.md` for trust boundaries and vulnerability reporting;
- `docs/architecture.md` for the pipeline, isolation, recovery, and security model;
- the relevant file under `docs/` when changing configuration, artifacts, or release behavior.

RepoForeman is an early public beta. Keep changes focused, reviewable, and explicit about compatibility and security consequences.

## Product invariants

- RepoForeman remains a local, deterministic delivery and governance layer around Codex CLI. Do not present it as a model provider, hosted service, OS security boundary, or replacement for native Codex Goal and subagent interfaces.
- Preserve restrictive defaults. Broader filesystem, network, environment, command, or host access must be explicit, visibly unsafe, and covered by tests and documentation.
- Keep the published runtime dependency-free unless a maintainer explicitly approves changing that contract. Prefer Node.js built-ins.
- Support the Node.js, operating-system, and Git worktree matrix documented in `package.json`, `README.md`, and `.github/workflows/ci.yml`.
- Keep every planning, worker, review, recovery, and verification loop bounded. Exhaustion must produce an explainable failure or partial result, never an unbounded retry cycle.
- Validate agent-produced structured data before it becomes executable state. A valid schema is necessary but does not prove factual correctness.
- Treat command and diff policy as defense in depth, not as a shell parser or sandbox. Do not weaken the documented trust boundary.
- Preserve baseline verification so pre-existing failures are not silently reported as regressions introduced by a run.
- Persist enough redacted state to explain and safely resume a run. Do not persist raw sensitive output by default.

## Implementation rules

- Use ESM and the repository's existing `.mjs` module style.
- Make the smallest cohesive change that satisfies the task. Keep unrelated refactors separate.
- Do not edit generated output, `node_modules/`, coverage data, packed tarballs, or `.repo-foreman/` run artifacts.
- Do not introduce product-specific paths, test commands, policy assumptions, private prompts, or organization-specific rules into public defaults or fixtures.
- Never add credentials, tokens, customer data, personal data, private source excerpts, or real environment files to code, tests, prompts, artifacts, or documentation.
- When adding or changing a CLI option, update parsing, validation, help text, runtime behavior, focused tests, and the relevant documentation together.
- When changing a schema or artifact format, update producers, consumers, fixtures, resume/cache behavior, and compatibility or migration notes together.
- When changing policy, sandbox, shell, environment, Git, worktree, redaction, or verification behavior, add focused negative-path tests as well as the successful path.
- Keep owner-provided verification commands distinct from model-produced data. Never interpolate untrusted task or model text into a shell command.
- Avoid silent fallbacks in security-sensitive code. Fail closed when required state, validation, or compatibility checks are missing.
- Maintain stable human-readable diagnostics for failures that users can act on. Do not log secrets or unnecessarily large command output.

## Tests and verification

Use targeted tests while iterating. Before declaring a repository change complete, run:

```bash
npm run check
```

The full check must continue to cover package metadata, unit tests, the isolated self-test, package contents, and installation of the packed CLI.

Additional expectations:

- Run `npm audit --omit=dev --audit-level=high` when dependencies, the lockfile, packaging, or release configuration changes.
- Inspect `npm pack --dry-run` when changing `package.json`, the `files` allowlist, executable modes, documentation included in the package, or release assets.
- Add regression tests for every bug fix when a stable reproduction is practical.
- Do not require a live Codex account or live model call in the default unit and self-test suites.
- If a required check cannot run, report the exact command, reason, and residual risk. Do not imply the change is fully verified.

## Documentation and public claims

- Update `README.md` or the relevant file under `docs/` whenever behavior, defaults, CLI usage, artifacts, compatibility, security boundaries, or installation changes.
- Update `CHANGELOG.md` for user-visible release changes.
- Keep claims precise and testable. Do not claim affiliation with OpenAI, complete isolation, guaranteed security, platform support not covered by CI, npm availability before publication, or capabilities the installed Codex CLI does not expose.
- Keep examples generic and safe to publish. Use placeholders for repository owners, model IDs, paths, and credentials.
- Preserve working relative links and ensure public documentation does not reveal private repository names, paths, prompts, or business logic.

## Git and release safety

- Preserve unrelated user changes in a dirty worktree and do not rewrite history unless explicitly requested.
- Do not push branches, create releases, change repository visibility, publish to npm, add collaborators, or modify external repository settings without explicit authorization.
- Before any authorized npm publication, verify the account, registry, version, dist-tag, public source URL, package contents, CI result, and release notes.
- Keep commits focused and descriptive. A public pull request should explain behavior, verification, security/privacy impact, and remaining limitations.

## Code Review Rules

Review changes for consequential repository-specific risks, especially:

- an unsafe default or permission expansion;
- an unbounded retry, recovery, or synthetic-task loop;
- execution of unvalidated model output or untrusted shell text;
- loss of schema, task-graph, baseline, resume, or cache invariants;
- worktree, branch, commit, or cleanup behavior that can damage user work;
- secret, environment, prompt, event, command-output, or artifact exposure;
- a mismatch between CLI help, implementation, tests, package contents, and documentation;
- a runtime dependency, platform claim, or external network behavior introduced without explicit approval and documentation.

Prioritize concrete correctness, security, privacy, compatibility, and test findings. Avoid blocking a change on personal style preferences when it follows the existing codebase conventions.
