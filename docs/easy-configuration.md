# Easy per-repository configuration

RepoForeman intentionally does not add a second configuration-file parser. The lowest-complexity setup uses two configuration layers that already exist:

1. one target-repository script for RepoForeman model, reasoning, workflow, policy, sandbox, search, worktree, and verification options;
2. optional `.codex/config.toml` settings for direct Codex sessions in the same repository.

This keeps configuration visible and version-controlled without introducing another schema or precedence system.

## 1. Save a RepoForeman preset

For a repository with `package.json`, add one editable script:

```json
{
  "scripts": {
    "agent:run": "repo-foreman run --model gpt-5.6-sol --effort xhigh --execution-profile standard --sandbox workspace-write --policy strict --policy-allowlist-mode monitor --no-search --worktree-deps none --task-tests \"npm test\" --final-tests \"npm run lint && npm test\""
  }
}
```

The model and effort shown above match RepoForeman's built-in defaults. Keeping them in the preset makes a repository-specific choice visible and easy to edit. Adapt the verification commands to the repository, then supply only the task for each run:

```bash
npm run agent:run -- --task-file ./task.md
```

Command-line options appended after `--` remain available for one-off overrides. For example:

```bash
npm run agent:run -- --model <another-supported-model> --effort high --execution-profile strict --task-file ./security-task.md
```

If the repository is not managed with npm, put the same fixed options in its existing task runner, Makefile, or small local wrapper script.

## 2. Configure direct Codex sessions, if needed

Create `.codex/config.toml` in the trusted repository where RepoForeman will run:

```toml
# These values apply to direct Codex sessions. RepoForeman passes its own
# explicit model and reasoning values.
model = "gpt-5.6-sol"

model_reasoning_effort = "xhigh"

# Safe defaults for direct Codex sessions in this repository.
approval_policy = "on-request"
sandbox_mode = "workspace-write"
web_search = "disabled"

[sandbox_workspace_write]
network_access = false
```

Project `.codex/config.toml` files are loaded by Codex only for repositories it considers trusted. Commit the project file if direct Codex sessions opened in RepoForeman-created Git worktrees should see it; an untracked file is not present in a new worktree. Keep personal cross-repository defaults in `~/.codex/config.toml` instead.

RepoForeman passes explicit model, reasoning, sandbox, approval, network, and search controls to each child execution. Those values take precedence over the corresponding native defaults during a RepoForeman run.

## Where each setting belongs

| Setting | Persistent location | One-off override |
| --- | --- | --- |
| Model | Repository script; built-in `gpt-5.6-sol` | `--model` |
| Reasoning effort | Repository script; built-in `xhigh` | `--effort` |
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
