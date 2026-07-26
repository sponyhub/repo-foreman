# Configuration and safe defaults

PatchGantry combines its own CLI configuration with the configuration of the installed Codex CLI and the commands defined by the target repository. Those layers have different responsibilities.

## Precedence

For values PatchGantry controls, the intended precedence is:

1. explicit PatchGantry CLI option;
2. environment-sensitive PatchGantry default, where documented;
3. PatchGantry public default;
4. inherited Codex CLI configuration for model settings not overridden by PatchGantry.

Run manifests record the resolved runtime configuration used for a run. Do not infer an old run's configuration from the defaults of a newer package.

## Public beta defaults

| Area | Default | Why |
| --- | --- | --- |
| Branch naming | `opaque` | Avoids embedding task text or personal data in refs and paths |
| Web search | off | Avoids accidental external queries |
| Sandbox | read-only for planning/review; `workspace-write` for worker/fix; network off; approval `on-request` | Grants writes only to phases that implement or repair changes |
| Host access | off | `danger-full-access` requires `--unsafe-host-access` |
| Command policy | `strict` | Applies deny rules and secret-diff checks by default |
| Allowlist mode | `monitor` | Reports deviations only when the active policy defines command prefixes |
| Environment-file copying | off | Prevents automatic propagation of local secrets |
| Model and effort | inherited | Respects the operator's Codex CLI configuration |
| Worktree | on | Isolates a run from the launching checkout |
| Worktree dependencies | `none` | Avoids implicit package installation and lifecycle scripts |
| Event redaction | on | Reduces accidental secret persistence |

Stock policies currently define no `allow_command_prefixes`; their `monitor` setting therefore emits no allowlist diagnostics and they rely on deny/path/diff controls. A custom policy can define prefixes to activate monitoring. Use `enforce` only after validating that the custom allowlist covers every legitimate command shape needed by the repository.

## Search and network are different controls

`--search` allows Codex web-search behavior supported by the installed CLI. By default PatchGantry disables search and configures the workspace-write Codex sandbox with network access off. This does not establish a system-wide offline guarantee: repository verification scripts and other subprocesses may run outside that agent sandbox and have their own network behavior.

When offline execution is required, enforce it at the container, VM, firewall, or operating-system layer and verify the repository's commands independently.

## Sandbox and policy are different controls

The Codex sandbox is the primary execution boundary selected for agent phases. PatchGantry's policy inspects commands and diffs for known-risk patterns. The policy may block or report an action, but it is not a complete shell parser and cannot replace OS isolation.

`--unsafe-host-access` opts into Codex `danger-full-access`. The name is intentionally explicit. Use it only when:

- the repository and task are trusted;
- the host is disposable or strongly isolated;
- unrelated credentials are absent;
- the expected commands cannot run under workspace scope;
- the resulting diff and artifacts will receive human review.

## Branch naming

Opaque names are the safest default because task text does not become part of Git refs or worktree paths.

- `opaque`: random/run-derived, no task words.
- `heuristic`: local deterministic words derived from task text.
- `codex`: asks Codex to choose semantic task words.

Both semantic strategies can leak names or sensitive task details into local paths and pushed refs. Sanitize the brief before enabling them.

## Environment files

PatchGantry does not copy `.env*` or `.npmrc` by default. The explicit `--copy-env-files` opt-in is limited to supported test files such as `.env.test` and `.env.test.local`; it must not be used as a path to propagate production credentials.

Even without file copying, child processes can inherit environment variables. Launch PatchGantry from a minimally privileged shell and review the subprocess environment behavior of the installed version.

## Model settings

Without overrides, model selection and reasoning effort come from Codex CLI configuration. For reproducible evaluation, set both explicitly:

```bash
patch-gantry run \
  --model <model-supported-by-your-codex-cli> \
  --effort <effort-supported-by-your-codex-cli> \
  --task-file ./task.md
```

PatchGantry does not guarantee that every Codex version supports every model or effort value. `doctor` and the underlying Codex CLI error are authoritative.

## Repository verification

There is no universal command set for JavaScript, Python, Rust, monorepos, or mixed repositories. Define task and final checks that cover the actual change:

```bash
patch-gantry run \
  --task-tests "npm test -- --runInBand" \
  --final-tests "npm run lint && npm run type-check && npm test" \
  --task-file ./task.md
```

These owner-provided values execute through a shell outside the Codex sandbox and command-policy path, with a filtered environment. Task-graph schemas require model-produced verification lists to be empty, and PatchGantry replaces them with `--task-tests`; model-proposed shell strings are not retained. Avoid interpolation from untrusted input and quote paths containing spaces, parentheses, wildcards, or other shell metacharacters.

## Planning-only dry runs

`--dry-run` stops after the planning gates and forces agent phases to `read-only`. It rejects host-wide access, environment-file copying, and dependency materialization. It still creates a local branch, isolated worktree, and `.patch-gantry` artifacts so the plan can be inspected; it is not a zero-write command.

## CI behavior

Running PatchGantry inside CI may select stricter review and verification behavior when flags are omitted. Pin the package version and pass important options explicitly in production automation. Never rely on a floating prerelease tag for a release gate.
