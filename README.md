# RepoForeman

> A gated, local workflow orchestrator for Codex CLI.

RepoForeman turns a development brief into a structured engineering workflow: analysis, architecture, task planning, implementation, independent review, recovery, and final verification. It runs locally around `codex exec`, isolates work in Git worktrees by default, and leaves behind enough state to inspect, explain, or resume a run.

The goal is simple: make agent-assisted coding behave more like a disciplined delivery process and less like one long, opaque prompt.

RepoForeman is an independent open-source project. It is not affiliated with, endorsed by, or supported by OpenAI. Codex and OpenAI are trademarks of their respective owner.

## Why this project exists

RepoForeman began while I was building a private software project. I needed a repeatable way to move from a rough feature request to a reviewed, tested change without relying on a single agent session to remember every decision and police its own work.

The repository-local orchestration tooling became useful beyond that one application, so I decided to extract it, remove project-specific assumptions, harden the public defaults, and make it available as an open-source project. RepoForeman contains the reusable orchestration mechanics only; it does not contain the private project's application code, data, credentials, or business logic.

## Project status

The current release is `0.1.0-beta.1`. Treat it as an early public beta:

- CLI behavior and artifact formats may change between `0.x` releases.
- macOS and Linux are the supported platforms.
- The tool is designed for trusted repositories and trusted task descriptions.
- Files under `lib/` are internal implementation details, not a stable JavaScript API.
- This source tree does not claim that an npm package or public repository has already been published. Verify provenance before installing anything under this name.

## What RepoForeman adds

Coding agents are capable, but long implementation runs introduce predictable failure modes:

- planning decisions disappear into conversation history;
- implementation drifts away from the original acceptance criteria;
- one agent reviews its own assumptions;
- retries become unbounded and expensive;
- pre-existing test failures are confused with regressions;
- an interrupted run has to start from scratch;
- the final answer says “done” without an inspectable delivery record.

RepoForeman addresses those problems with explicit phases and deterministic gates:

- JSON Schema-validated phase outputs;
- analysis, architecture, task-graph, task, integration, and verification reviews;
- task traceability and shared-file conflict checks;
- isolated Git worktrees and opaque branch names by default;
- baseline verification before implementation begins;
- bounded worker, review, fix, replan, and verification attempts;
- resumable state with an append-only resume journal;
- run status, explanations, retry telemetry, and redacted event artifacts;
- interactive steering or autonomous execution;
- local policy presets for commands, paths, and generated diffs.

RepoForeman deliberately does **not** provide model access, authentication, a hosted service, a GitHub integration, or an operating-system security boundary.

## How a run works

```mermaid
flowchart LR
    A["Development brief"] --> B["Analysis and architecture gates"]
    B --> C["Validated task graph"]
    C --> D["Baseline verification"]
    D --> E["Task implementation"]
    E --> F{"Task review"}
    F -- "Fix required" --> E
    F -- "Pass" --> G["Integration review"]
    G --> H{"Final verification"}
    H -- "Bounded recovery" --> E
    H -- "Pass" --> I["Summary and inspectable artifacts"]
```

Every loop has a configured attempt budget. Repeated failure becomes a visible gate result instead of an infinite agent loop.

## Requirements

- Node.js `22.14.0` or newer. CI covers Node.js 22 and 24.
- npm compatible with the selected Node.js release.
- Git with worktree support.
- Codex CLI installed and available as `codex`.
- An authenticated Codex session.
- A local Git repository containing the code to be changed.

Check Codex first:

```bash
codex --version
codex login status
```

Codex CLI evolves independently from RepoForeman. After installation, run `repo-foreman doctor` to check the capabilities visible to this release. A passing preflight confirms the detected CLI contract; it does not prove that arbitrary repository commands are safe or successful.

## Installation

### From a local package tarball

Use this reproducible path before an npm release exists:

```bash
# In the RepoForeman source checkout
npm ci
npm pack

# In the repository where you want to use it
npm install --save-dev /absolute/path/to/repo-foreman-0.1.0-beta.1.tgz
npx repo-foreman doctor
```

Inspect the exact package contents before installing:

```bash
npm pack --dry-run
```

### From a source checkout

```bash
npm ci
npm link
repo-foreman doctor
```

### From npm after publication

The beta should be published under the `next` dist-tag. These commands become valid only after a maintainer has published the package:

```bash
# One-off
npx --yes repo-foreman@next doctor

# Global
npm install --global repo-foreman@next
repo-foreman doctor

# Repository-local
npm install --save-dev repo-foreman@next
npx repo-foreman doctor
```

Do not treat a matching package name as proof of origin. Check the npm owner, version, integrity metadata, repository link, and tarball contents.

## Quick start

Run RepoForeman from the root of a trusted Git repository:

```bash
repo-foreman doctor
repo-foreman run --task "Add validation for the account settings form"
```

For a longer or reviewable brief:

```bash
repo-foreman run --task-file ./task.md
```

Inspect an active or completed run:

```bash
repo-foreman list
repo-foreman status --run-id <run-id>
repo-foreman explain --run-id <run-id>
repo-foreman resume --run-id <run-id>
```

Start with a small, reversible task. Read the generated task graph and inspect the Git diff before merging or pushing anything.

## Execution profiles

Profiles select review depth and retry defaults. They do not relax the repository trust boundary.

| Profile | Best for | Review behavior |
| --- | --- | --- |
| `fast` | Small, routine, low-risk changes | Minimal review depth and retry budget |
| `standard` | Normal feature and maintenance work | Balanced review depth and cost |
| `strict` | Security-sensitive, broad, or high-impact changes | Deepest reviews and larger bounded recovery budget |

```bash
# Small, routine change
repo-foreman run --execution-profile fast --task-file ./task.md

# Default balance
repo-foreman run --execution-profile standard --task-file ./task.md

# Security-sensitive or broad change
repo-foreman run --execution-profile strict --task-file ./task.md
```

## Common workflows

### Plan without implementation

```bash
repo-foreman run \
  --dry-run \
  --task-file ./task.md
```

Dry-run mode stops after planning and forces agent phases to `read-only`. It still creates a local branch, worktree, and run artifacts so the plan can be inspected; it is not a zero-write command.

### Define repository-specific verification

```bash
repo-foreman run \
  --task-file ./task.md \
  --task-tests "npm test -- --runInBand" \
  --final-tests "npm run lint && npm run type-check && npm test"
```

These commands come from the repository owner. They execute through the host shell with a filtered environment but outside the Codex sandbox and command-policy path. Treat them as code: do not interpolate untrusted input, and quote paths containing shell metacharacters.

### Steer a run interactively

```bash
repo-foreman run \
  --mode interactive \
  --interaction-model conversational \
  --task-file ./task.md
```

Terminal commands include `/help`, `/status`, `/pause`, `/resume`, `/abort`, and `/replan [guidance]`. Steering is applied at supported boundaries and may interrupt and replay work. It is not guaranteed to inject text into an already running `codex exec` process.

### Pin model behavior

RepoForeman inherits model selection and reasoning effort from Codex unless you override them:

```bash
repo-foreman run \
  --model <model-supported-by-your-codex-cli> \
  --effort high \
  --task-file ./task.md
```

For durable per-repository defaults, use `.codex/config.toml`. See [Easy per-repository configuration](docs/easy-configuration.md) for a copyable setup and a reusable `package.json` command preset.

## Safe defaults

RepoForeman starts from restrictive public defaults:

| Area | Default |
| --- | --- |
| Planning and review | Codex `read-only` sandbox |
| Implementation and repair | Codex `workspace-write` sandbox |
| Workspace network | off for child Codex executions |
| Approval policy | `on-request` |
| Web search | off unless `--search` is passed |
| Host-wide access | off; requires explicit `--unsafe-host-access` |
| Command/diff policy | `strict` |
| Policy allowlist mode | `monitor` |
| Branch naming | opaque `repo-foreman/run-<run-id>` |
| Worktree | enabled |
| Worktree dependencies | `none` |
| Environment-file copying | off |
| Event redaction | on |

Stock policies currently define no `allow_command_prefixes`. Their default `monitor` mode therefore provides deny, path, and diff controls without allowlist diagnostics. Use a custom policy to define permitted prefixes, and test it in monitor mode before enabling enforcement.

## Security and trust boundary

RepoForeman is for trusted local development work. It is **not** a safe executor for hostile repositories or hostile task descriptions.

Important limitations:

- `workspace-write` permits changes inside the selected workspace.
- Install, build, test, lint, audit, and other repository commands execute local code.
- The policy layer is defense in depth, not a complete shell parser or OS sandbox.
- Disabling Codex workspace network and web search does not prove that every subprocess is offline.
- Repository verification commands run as ordinary host processes and may have their own network behavior.
- `--unsafe-host-access` selects `danger-full-access` and materially expands the impact of mistakes or malicious instructions.
- `--no-redact` writes raw Codex event lines and can persist secrets or personal data.
- Redaction is best effort, not a data-loss-prevention system.

Do not use RepoForeman on an untrusted fork, an unreviewed archive, or a task copied from an unknown source. For higher-risk evaluation, use an ephemeral machine or container without personal credentials and enforce network restrictions outside RepoForeman.

Read [SECURITY.md](SECURITY.md) before broad or sensitive runs.

## Artifacts, privacy, and retention

Each run writes state beneath `.repo-foreman/` in the target repository:

```text
.repo-foreman/
├── runs/       # manifests, phase outputs, events, reviews, and summaries
└── worktrees/  # isolated Git worktrees created for active runs
```

Artifacts may include:

- task descriptions and follow-up answers;
- source excerpts, paths, branch names, and diffs;
- commands and bounded command output;
- model responses, assumptions, and review findings;
- failures, retry events, and verification results.

Never include secrets, tokens, customer data, or unnecessary personal information in task descriptions. Keep `.repo-foreman/` out of Git and backups unless retention is intentional. Remove run data according to your own retention policy after it is no longer needed.

See [Artifacts and privacy](docs/artifacts-and-privacy.md) for cleanup and incident guidance.

## Command overview

| Command | Purpose |
| --- | --- |
| `run` | Start a new gated workflow |
| `resume` | Continue from persisted phase and task checkpoints |
| `status` | Show run state and task progress |
| `explain` | Summarize gates, failures, and diagnostics |
| `list` | List runs found in the local artifact directory |
| `doctor` | Check prerequisites and Codex CLI capabilities |
| `promote` | Evaluate completed-run retry and outcome metrics |

Run `repo-foreman help` for the options implemented by the installed build. See the full [CLI reference](docs/orchestrator-reference.md) and [configuration guide](docs/configuration.md) for option groups, precedence, policies, and retry controls.

## Cost and latency

One run can invoke Codex many times. Planning, reviews, worker attempts, recovery, branch naming, and summaries all consume model calls. Strict profiles, large briefs, retries, and failed verification increase both runtime and usage.

RepoForeman does not enforce a monetary budget. Before a broad run:

- split unrelated work into separate briefs;
- use the lightest profile appropriate for the risk;
- keep retry limits bounded;
- check the current pricing and limits of your Codex account;
- monitor the run instead of assuming one task equals one model call.

## Compatibility

| Component | Status |
| --- | --- |
| macOS with Node.js 22/24 | Supported in CI |
| Linux with Node.js 22/24 | Supported in CI |
| Windows native | Not supported by this release |
| WSL | Not currently covered by CI |
| Codex CLI | External prerequisite; capabilities checked by `doctor` |
| Git worktrees | Required for the default isolated workflow |

## Development

```bash
npm ci
npm run check:metadata
npm test
npm run self-test
npm pack --dry-run
```

Run the complete release gate with:

```bash
npm run check
```

The published runtime is designed to use only Node.js built-ins. Jest and Ajv are development-only dependencies and are not installed as runtime dependencies for consumers.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md), not through a public issue.

## Documentation

- [Configuration and safe defaults](docs/configuration.md)
- [Easy per-repository configuration](docs/easy-configuration.md)
- [CLI reference](docs/orchestrator-reference.md)
- [Architecture](docs/architecture.md)
- [Artifacts and privacy](docs/artifacts-and-privacy.md)
- [Release process](docs/releasing.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
