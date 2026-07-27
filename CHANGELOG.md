# Changelog

All notable changes to this project are documented in this file. The format is based on Keep a Changelog, and versions follow Semantic Versioning while noting that `0.x` contracts may still change.

## [Unreleased]

## [0.1.0-beta.1] - 2026-07-26

### Added

- Added a copyable low-complexity configuration guide using native Codex project settings and repository command presets.
- Initial standalone RepoForeman public beta.
- npm CLI entrypoint exposed as `repo-foreman`.
- Gated analysis, architecture, task planning, implementation, review, recovery, and verification workflow around Codex CLI.
- Git worktree isolation, resumable state, retry telemetry, policy presets, schemas, prompts, and an offline self-test.
- Verified public GitHub source, homepage, issue-tracker, and other npm package metadata; Apache-2.0 license; security policy; contributor guide; and local release verification.

### Changed

- Set the default pipeline model to `gpt-5.6-sol` with `xhigh` reasoning while preserving `--model` and `--effort` overrides.
- Renamed the public project, npm package, CLI command, artifact directory, and branch prefix to RepoForeman.
- Rewrote the README with the project's origin, delivery workflow, trust boundary, safe defaults, and practical usage examples.
- Artifacts created by earlier local beta builds are not automatically discovered after the rename.
- Replaced repository-specific installation and command examples with standalone CLI usage.
- Generalized model, reasoning, verification, and environment behavior for use across repositories.
- Introduced safer public defaults for branch naming, search, sandbox scope, policy selection, and environment-file copying.

### Fixed

- Marked ESM-based test suites explicitly so release checks run correctly on supported Node.js 22 and 24 versions.
- Terminated owner-provided shell command process groups on interruption and timeout so descendant processes do not outlive the command on macOS or Linux.

### Removed

- Removed GitHub Actions automation; repository and release verification are manual.

### Security

- Host-wide access requires an explicit unsafe opt-in.
- Environment files are not copied by default.
- Documentation defines the trusted-repository boundary and sensitive-artifact handling requirements.
