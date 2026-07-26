# Easy per-repository configuration

RepoForeman intentionally does not add a second configuration-file parser. The lowest-complexity setup uses two configuration layers that already exist:

1. `.codex/config.toml` for native Codex defaults such as model and reasoning effort;
2. one target-repository script for RepoForeman workflow, policy, sandbox, search, worktree, and verification options.

This keeps configuration visible and version-controlled without introducing another schema or precedence system.

## 1. Set Codex defaults

Create `.codex/config.toml` in the trusted repository where RepoForeman will run:

```toml
# Uncomment and replace this only when you want to pin a model supported by
# your installed Codex CLI. If omitted, Codex selects its configured default.
# model = "your-model-id"

model_reasoning_effort = "high"

# Safe defaults for direct Codex sessions in this repository.
approval_policy = "on-request"
sandbox_mode = "workspace-write"
web_search = "disabled"

[sandbox_workspace_write]
network_access = false
```

Project `.codex/config.toml` files are loaded by Codex only for repositories it considers trusted. Commit the project file if RepoForeman-created Git worktrees should inherit it; an untracked file is not present in a new worktree. Keep personal cross-repository defaults in `~/.codex/config.toml` instead.

When `--model` and `--effort` are omitted, RepoForeman inherits `model` and `model_reasoning_effort` from Codex. RepoForeman passes explicit safety settings to each child execution, so its phase-specific sandbox, approval, network, and search controls take precedence over the corresponding native defaults during a RepoForeman run.

## 2. Save a RepoForeman preset

For a repository with `package.json`, add one editable script:

```json
{
  "scripts": {
    "agent:run": "repo-foreman run --execution-profile standard --sandbox workspace-write --policy strict --policy-allowlist-mode monitor --no-search --worktree-deps none --task-tests \"npm test\" --final-tests \"npm run lint && npm test\""
  }
}
```

Adapt the two verification commands to the repository. Then supply only the task for each run:

```bash
npm run agent:run -- --task-file ./task.md
```

Command-line options appended after `--` remain available for one-off overrides. For example:

```bash
npm run agent:run -- --execution-profile strict --task-file ./security-task.md
```

If the repository is not managed with npm, put the same fixed options in its existing task runner, Makefile, or small local wrapper script.

## Where each setting belongs

| Setting | Persistent location | One-off override |
| --- | --- | --- |
| Model | `.codex/config.toml` `model` | `--model` |
| Reasoning effort | `.codex/config.toml` `model_reasoning_effort` | `--effort` |
| Review depth and retry defaults | Repository script | `--execution-profile` |
| Command/diff policy | Repository script | `--policy`, `--policy-file`, `--policy-allowlist-mode` |
| Normal agent sandbox | Repository script or safe built-in default | `--sandbox` |
| Host-wide access | Do not persist for routine use | `--unsafe-host-access` plus `--sandbox danger-full-access` |
| Web search | Repository script or safe built-in default | `--search` or `--no-search` |
| Worktree dependencies | Repository script | `--worktree-deps` |
| Repository verification | Repository script | `--task-tests`, `--final-tests` |

RepoForeman does not currently expose child approval policy or child workspace-network access as configurable options. They remain fixed at `on-request` and off respectively. This is intentional hardening, not a missing setup step. Repository verification commands still run as ordinary host processes, so network isolation for those commands must be enforced outside RepoForeman when required.

## Why there is no `repo-foreman.config.json`

A native RepoForeman config file would require a documented schema, validation, CLI-versus-file precedence, secure path resolution, migration behavior, and additional tests. Until that feature is justified, a repository script is the simpler and more auditable preset mechanism.
