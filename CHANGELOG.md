# Changelog

All notable changes to this project are documented in this file. The format is based on Keep a Changelog, and versions follow Semantic Versioning while noting that `0.x` contracts may still change.

## [Unreleased]

### Added

- Added a copyable low-complexity configuration guide using native Codex project settings and repository command presets.

### Changed

- Added verified public GitHub source, homepage, and issue-tracker metadata for npm consumers.
- Set the default pipeline model to `gpt-5.6-sol` with `xhigh` reasoning while preserving `--model` and `--effort` overrides.
- Renamed the public project, npm package, CLI command, artifact directory, and branch prefix to RepoForeman.
- Rewrote the README with the project's origin, delivery workflow, trust boundary, safe defaults, and practical usage examples.
- Artifacts created by earlier local beta builds are not automatically discovered after the rename.

### Removed

- Removed GitHub Actions automation; repository and release verification are manual.

## [0.1.0-beta.1] - 2026-07-26

### Added

- Initial standalone RepoForeman public beta.
- npm CLI entrypoint exposed as `repo-foreman`.
- Gated analysis, architecture, task planning, implementation, review, recovery, and verification workflow around Codex CLI.
- Git worktree isolation, resumable state, retry telemetry, policy presets, schemas, prompts, and an offline self-test.
- Public package metadata, Apache-2.0 license, security policy, contributor guide, and local release verification.

### Changed

- Replaced repository-specific installation and command examples with standalone CLI usage.
- Generalized model, reasoning, verification, and environment behavior for use across repositories.
- Introduced safer public defaults for branch naming, search, sandbox scope, policy selection, and environment-file copying.

### Security

- Host-wide access requires an explicit unsafe opt-in.
- Environment files are not copied by default.
- Documentation defines the trusted-repository boundary and sensitive-artifact handling requirements.
