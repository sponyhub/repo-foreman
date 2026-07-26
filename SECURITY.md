# Security policy

PatchGantry launches an AI coding agent and repository-defined commands. Its security model assumes that the operator trusts the target repository, task description, verification commands, and local Codex installation.

## Supported releases

| Release line | Security fixes |
| --- | --- |
| `0.1.x` beta | Best effort |
| Older or unreleased snapshots | No guarantee |

During the `0.x` period, fixes may require a breaking configuration or artifact-format change.

## Reporting a vulnerability

Do not disclose a suspected vulnerability, exploit, secret, or sensitive artifact in a public issue.

Use GitHub private vulnerability reporting from the repository's **Security** tab when it is available. If that channel is not enabled, contact the repository owner privately using the contact method displayed on the owner's profile. Include:

- affected PatchGantry version and platform;
- a minimal reproduction using synthetic data;
- the expected and observed security boundary;
- whether credentials, host files, Git history, or run artifacts may be exposed;
- suggested mitigations, if known.

Remove tokens, personal data, proprietary source, and raw model transcripts from the report. A maintainer should acknowledge a complete report within seven days, but this community beta does not promise a formal SLA or bounty.

## Trust boundary

PatchGantry is designed for trusted local development repositories. It is not a hardened executor for hostile code.

The following are outside its security boundary:

- malicious package lifecycle scripts, build tools, tests, linters, or binaries in the target repository;
- malicious instructions in source files, task descriptions, dependencies, or fetched web content;
- a compromised Codex CLI installation or user configuration;
- secrets already available to the launching process or repository commands;
- operating-system compromise after explicit host-wide access is enabled.

The command policy is an additional detection and blocking layer. It is not an OS sandbox. Redaction is best effort and is not a substitute for keeping secrets out of prompts and subprocess environments.

## Operator checklist

Before a run:

1. Use a repository and task source you trust.
2. Review package scripts and verification commands before allowing them to execute.
3. Remove unrelated credentials from the shell environment.
4. Keep web search disabled unless the task needs it.
5. Do not opt into `--unsafe-host-access` on a normal workstation.
6. Confirm that no production `.env`, `.npmrc`, cloud credential, or SSH key will be copied into a worktree.
7. Leave `--no-redact` disabled unless a sanitized raw transcript is essential for debugging.
8. Prefer an ephemeral VM or container for higher-risk code.

After a run:

1. Inspect the Git diff and commits before pushing.
2. Review policy warnings and retry artifacts.
3. Treat the run directory as sensitive.
4. Remove run artifacts and temporary worktrees according to your retention policy.
5. Rotate any credential that may have appeared in a prompt, event stream, command output, or diff.

## Dependency and network posture

The published runtime is intended to have zero npm dependencies and uses Node.js built-ins. Development dependencies are not part of the runtime trust claim. PatchGantry invokes external programs including Git, Codex CLI, the shell, and repository-defined tools; each has its own dependency and network behavior.

The beta's Jest test toolchain currently has upstream transitive advisories reported by a full `npm audit`; those packages are not included in the published runtime tarball. CI treats `npm audit --omit=dev --audit-level=high` as the blocking runtime gate and reports the full development audit separately. Contributors still execute the development toolchain, so maintainers must reassess these advisories on every Jest update and should not use unreviewed test inputs.

Web search being disabled does not prove that every child process is offline. Repository-owner verification commands execute through the host shell outside the Codex sandbox, with a filtered environment but ordinary host process and network permissions. Model-proposed task verification commands are rejected and replaced with the configured owner command. Enforce external network or process isolation when it is required.
