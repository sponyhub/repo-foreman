# PatchGantry

> Gated workflow for Codex CLI.

PatchGantry is a local, deterministic workflow around `codex exec`. It turns a development brief into explicit analysis, architecture, task planning, implementation, independent review, recovery, and verification phases. Every run writes inspectable state and phase artifacts so that a failure can be explained or resumed instead of silently starting over.

PatchGantry is an independent community project. It is not affiliated with, endorsed by, or supported by OpenAI. Codex and OpenAI are trademarks of their respective owner.

## Project status

The current release is `0.1.0-beta.1`. It is an alpha-quality public beta:

- CLI behavior and artifact formats may change between `0.x` releases.
- macOS and Linux are the supported platforms.
- The tool is intended for trusted repositories and trusted task descriptions.
- There is no stability guarantee for importing files from `lib/`; PatchGantry is distributed as a CLI, not a JavaScript library.
- No npm publication or public repository location is claimed by this source tree. Verify the package origin before installing it.

## What it provides

- Schema-validated outputs between agent phases.
- A task graph with size, traceability, and shared-file conflict gates.
- Isolated Git worktrees by default.
- Bounded worker, review, replan, and verification retries.
- Analysis, architecture, task, integration, and verification reviews.
- Baseline verification to distinguish pre-existing failures from new regressions.
- Resumable run state, an append-only resume journal, and retry telemetry.
- Interactive and autonomous operation.
- Local policy presets and redacted event artifacts.

PatchGantry deliberately does not provide a hosted service, model access, authentication, a GitHub integration, or an operating-system security boundary.

## Prerequisites

- Node.js `22.14.0` or newer. CI covers Node.js 22 and 24.
- npm compatible with the selected Node.js release.
- Git with worktree support.
- Codex CLI installed, available as `codex`, and authenticated.
- A local Git repository containing the code to be changed.

Confirm the external CLI first:

```bash
codex --version
codex login status
```

Codex CLI evolves independently from PatchGantry. Run `patch-gantry doctor` after installation to check the capabilities visible to this release. Passing `doctor` is a preflight signal, not a guarantee that every repository command will succeed.

## Installation

### From a local package tarball

This is the reproducible option before an npm release exists:

```bash
# In the PatchGantry source checkout
npm ci
npm pack

# In the repository where you want to use it
npm install --save-dev /absolute/path/to/patch-gantry-0.1.0-beta.1.tgz
npx patch-gantry doctor
```

Inspect the dry-run package listing before installing:

```bash
npm pack --dry-run
```

### From a source checkout

```bash
npm ci
npm link
patch-gantry doctor
```

### From npm after publication

The beta should be published under the `next` dist-tag. These commands become valid only after a maintainer has actually published the package:

```bash
# One-off
npx --yes patch-gantry@next doctor

# Global
npm install --global patch-gantry@next
patch-gantry doctor

# Repository-local
npm install --save-dev patch-gantry@next
npx patch-gantry doctor
```

Do not treat the package name alone as proof of provenance. Check the npm owner, version, integrity metadata, and package contents.

## Quick start

Run PatchGantry from the root of a trusted Git repository:

```bash
patch-gantry doctor
patch-gantry run --task "Add validation for the account settings form"
```

For a longer brief:

```bash
patch-gantry run --task-file ./task.md
```

Operational commands:

```bash
patch-gantry list
patch-gantry status --run-id <run-id>
patch-gantry explain --run-id <run-id>
patch-gantry resume --run-id <run-id>
```

Start with a small, reversible task. Review the generated task graph and Git diff before merging or pushing anything.

## Safe defaults and their limits

The public beta is configured to reduce accidental exposure and overly broad execution:

- Branch names are opaque by default and do not derive words from the task. `heuristic` and Codex-generated names are opt-in.
- Codex web search is off unless `--search` is passed.
- Planning and review phases are read-only; worker and fix phases use `workspace-write` with Codex workspace network access disabled and approval set to `on-request`. Host-wide access requires `--unsafe-host-access`.
- The command policy defaults to `strict`. Allowlist mode defaults to `monitor`, but stock policies currently define no command prefixes, so they provide deny/path/diff controls rather than allowlist diagnostics.
- `.env*` and `.npmrc` files are not copied automatically. `--copy-env-files` is an explicit opt-in limited to test environment files supported by the CLI.
- The model and reasoning effort inherit the user's Codex CLI configuration unless `--model` or `--effort` is provided.
- Runs use an isolated Git worktree by default, without automatically installing dependencies.
- Sensitive-looking values in event output are redacted by default.

These controls reduce risk; they do not make untrusted code safe:

- `workspace-write` still permits changes inside the selected workspace.
- A repository's install, build, test, lint, and audit commands execute local code.
- The policy layer is defense in depth, not a substitute for the Codex sandbox, OS isolation, or human review.
- Allowlist `monitor` reports deviations only when the active custom policy defines `allow_command_prefixes`; it does not block commands outside that list.
- Disabling Codex workspace network and web search is not the same as proving that every subprocess is offline. PatchGantry's repository verification commands execute separately; review and isolate them as needed.
- `--unsafe-host-access` materially expands impact. Use it only in a disposable, isolated environment.
- `--no-redact` writes a raw event transcript. Do not enable it for a run that may encounter credentials, personal data, or proprietary material.

Do not run PatchGantry on code from an untrusted fork, an unreviewed archive, or a task copied from an unknown party. For higher-risk evaluation, use an ephemeral machine or container without personal credentials.

## Choosing a profile

```bash
# Small, routine change
patch-gantry run --execution-profile fast --task-file ./task.md

# Default balance of review depth and cost
patch-gantry run --execution-profile standard --task-file ./task.md

# Security-sensitive or broad change
patch-gantry run --execution-profile strict --task-file ./task.md
```

Profiles control review depth and retry budgets. They do not change the trust boundary of the repository. See [Configuration](docs/configuration.md) for the option groups and precedence rules.

## Easy per-repository configuration

You do not need to repeat every option on every run. Put model and reasoning defaults in the target repository's native `.codex/config.toml`, then save the PatchGantry policy, sandbox, search, worktree, and verification options in one repository script.

See [Easy per-repository configuration](docs/easy-configuration.md) for copyable TOML and `package.json` examples. PatchGantry does not add a separate config-file parser in this beta.

## Interactive control

Use conversational interaction when you want to steer a long run from the launching terminal:

```bash
patch-gantry run \
  --mode interactive \
  --interaction-model conversational \
  --task-file ./task.md
```

Available terminal commands include `/help`, `/status`, `/pause`, `/resume`, `/abort`, and `/replan [guidance]`. Steering interrupts and replays work at supported boundaries; it is not guaranteed to inject text into an already running `codex exec` process.

## Repository verification

PatchGantry cannot infer a perfect verification contract for every project. Pass commands that are correct for the target repository:

```bash
patch-gantry run \
  --task-file ./task.md \
  --task-tests "npm test -- --runInBand" \
  --final-tests "npm run lint && npm test"
```

Verification strings are shell commands supplied by the repository owner. Task-graph schemas reject model-proposed commands, and PatchGantry replaces each task's verification list with the configured `--task-tests` value. The resulting checks execute through the host shell with a filtered environment but ordinary host process and network permissions. Treat configured commands as code. A green command only proves what that command actually covers.

## Artifacts, privacy, and retention

Runs create local state, prompts, outputs, logs, retry events, and worktrees under `.patch-gantry/` in the target repository. The directory is ignored by this repository's `.gitignore`.

Artifacts can contain:

- task text and follow-up answers;
- source excerpts, file paths, branch names, and diffs;
- commands and bounded command output;
- model responses, review findings, and assumptions;
- error details and retry telemetry.

Never put secrets, tokens, customer data, or unnecessary personal data in task descriptions. Keep run directories out of Git and backups unless explicitly required. Delete them according to your own retention policy after the run is no longer needed. Redaction is best effort and must not be treated as a data-loss-prevention system.

See [Artifacts and privacy](docs/artifacts-and-privacy.md) for a practical cleanup and incident checklist.

## Cost and latency

One PatchGantry run can invoke Codex many times: planning, reviews, worker attempts, recovery, and summary all consume model calls. Strict profiles, large tasks, retries, web search, and failed verification increase both runtime and API or subscription usage. PatchGantry does not set or enforce a monetary budget.

Before a broad run:

- split unrelated work into separate briefs;
- use the lightest review profile appropriate for the risk;
- set bounded retry limits;
- verify your Codex account's current pricing and limits;
- monitor the run rather than assuming a single request equals a single model call.

## Compatibility

| Component | Status |
| --- | --- |
| macOS + Node.js 22/24 | Supported in CI |
| Linux + Node.js 22/24 | Supported in CI |
| Windows native | Not supported by this package release |
| WSL | Not currently covered by CI |
| Codex CLI | External prerequisite; capability checked by `doctor` |
| Git worktrees | Required for the default run mode |

## Development

```bash
npm ci
npm run check:metadata
npm test
npm run self-test
npm pack --dry-run
```

The runtime uses only Node.js built-ins. Jest and Ajv are development-only test dependencies and are not installed for consumers when PatchGantry is used as a normal dependency.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Security reports belong in the private channel described in [SECURITY.md](SECURITY.md), not in a public issue.

## License

Apache License 2.0. See [LICENSE](LICENSE).
