# CLI reference

RepoForeman is a command-line application. Run `repo-foreman help` for the options implemented by the installed version; that output is authoritative when this document and a beta build differ.

## Commands

### `run`

Starts a new gated workflow in the current Git repository.

```bash
repo-foreman run --task "Describe the intended change"
repo-foreman run --task-file ./task.md
```

Exactly one task source should be supplied. A normal run creates an opaque branch and isolated worktree, captures the base commit, plans the change, executes approved tasks, verifies the repository, and writes a final summary.

### `resume`

Continues a run from persisted phase and task checkpoints.

```bash
repo-foreman resume --run-id <run-id>
```

Resume is artifact-aware but fail-safe: if required output is missing or does not match the current input fingerprint, the relevant phase runs again. Already committed tasks are guarded against duplicate commits.

### `status`

Prints persisted run state and task progress.

```bash
repo-foreman status --run-id <run-id>
```

### `explain`

Summarizes gate decisions, phase failures, and diagnostics for a run.

```bash
repo-foreman explain --run-id <run-id>
```

### `list`

Lists local runs discovered under the artifact directory.

```bash
repo-foreman list
```

### `doctor`

Checks local prerequisites and reports capability and hardening advice.

```bash
repo-foreman doctor
repo-foreman doctor --codex-bin /absolute/path/to/codex
```

Doctor does not authenticate on the user's behalf and does not prove that target-repository commands are safe.

### `promote`

Evaluates retry and outcome metrics from completed run artifacts before a review profile is promoted to a new organizational default.

```bash
repo-foreman promote --promotion-sample-size 30
```

This is an artifact analysis command; it does not publish packages or change Codex configuration.

## Common run options

Use `repo-foreman help` for the complete list and current defaults.

| Option | Purpose |
| --- | --- |
| `--task <text>` | Inline task brief |
| `--task-file <path>` | Read the task brief from a file |
| `--codex-bin <command-or-path>` | Select the Codex CLI executable |
| `--model <model>` | Override the model inherited from Codex CLI |
| `--effort <level>` | Override reasoning effort inherited from Codex CLI |
| `--execution-profile fast\|standard\|strict` | Select review depth and retry defaults |
| `--mode autonomous\|interactive` | Select gate behavior when input is needed |
| `--interaction-model phased\|conversational` | Select boundary-only or terminal steering behavior |
| `--task-tests <command>` | Verification used around individual tasks |
| `--final-tests <command>` | Final repository verification contract |
| `--policy strict\|balanced\|off` | Select the command policy preset |
| `--policy-file <path>` | Load a custom policy document |
| `--policy-allowlist-mode off\|monitor\|enforce` | Control deviations when the active policy defines `allow_command_prefixes` |
| `--sandbox read-only\|workspace-write` | Select the normal Codex sandbox scope |
| `--unsafe-host-access` | Explicitly request `danger-full-access` |
| `--search` | Enable Codex web search for phases that support it |
| `--copy-env-files` | Copy only supported test environment files into a worktree |
| `--dry-run` | Stop after planning with read-only agent phases; still creates a local branch, worktree, and artifacts |
| `--no-redact` | Also persist raw Codex event lines; sensitive and unsafe for routine use |
| `--no-commit` | Leave successful changes uncommitted |
| `--no-worktree` | Use legacy in-place branch mode; higher collision risk |
| `--worktree-deps auto\|link\|npm-ci\|none` | Select dependency materialization behavior |

## Review and retry controls

RepoForeman bounds retry loops. Important controls include:

- `--max-task-graph-attempts`
- `--max-worker-attempts`
- `--max-review-fix-attempts`
- `--max-fix-attempts`
- `--max-review-diff-growth-lines`
- task-graph size limits for files, acceptance criteria, description length, and verification commands

A larger budget can improve recovery on a difficult task, but it also increases cost, latency, and the amount of generated change. Repeated failure usually indicates a bad task boundary or missing repository context rather than a need for unbounded retries.

## Exit behavior

- `0`: the command completed successfully.
- non-zero: input, prerequisite, policy, pipeline, verification, or artifact handling failed.

A pipeline can also produce a terminal `partial` result when bounded post-review recovery is exhausted. Inspect `status`, `explain`, and the final summary rather than relying on process completion alone.
