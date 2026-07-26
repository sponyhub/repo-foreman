# Architecture

PatchGantry is a local state machine around Codex CLI, Git, repository commands, prompt templates, and JSON schemas. The npm package has no runtime JavaScript dependencies; external executables remain part of the operational dependency chain.

## Main components

| Component | Responsibility |
| --- | --- |
| `cli.mjs` | Command dispatch and human-facing help |
| `lib/args.mjs` | Option parsing, validation, and default resolution |
| `lib/run.mjs` | Pipeline state machine and phase orchestration |
| `lib/codex.mjs` | `codex exec` process construction and event handling |
| `lib/git.mjs` | Branch, commit, stash, and worktree operations |
| `lib/policy.mjs` | Command and diff guardrails |
| `schemas/` | Structured-output contracts for agent phases |
| `prompts/` | Phase role and output instructions |
| `policies/` | Built-in policy presets |
| resume/cache/telemetry modules | Recovery, input fingerprints, and audit records |

No file under `lib/` is a supported public JavaScript API during the beta.

## Pipeline

A normal run progresses through the following conceptual stages:

1. Preflight validates Git, Codex CLI, inputs, configuration, and worktree setup.
2. Analysis discovers scope, constraints, risks, questions, and likely verification.
3. Independent analysis review gates missing or unsafe context.
4. Blocking questions are resolved interactively or recorded as explicit autonomous assumptions.
5. Architecture produces decisions and a verification strategy.
6. Architecture review checks correctness, security, maintainability, and scope.
7. A task graph maps decisions to bounded implementation tasks.
8. Deterministic gates validate traceability, task size, commands, and file conflicts.
9. Baseline verification records failures present before implementation.
10. Workers implement tasks with bounded retries and task-level review.
11. Integration review evaluates the combined diff and can request bounded synthetic fixes.
12. Final verification compares results with the baseline.
13. Verification review and summary record the terminal outcome.

Every phase consumes an explicit prompt and, where appropriate, must produce schema-valid JSON. Schema validation prevents malformed output from silently becoming executable state; it does not prove that a valid statement is factually correct.

## Isolation model

By default a run creates a Git branch in a separate worktree. This protects the launching checkout from ordinary file collisions and enables concurrent runs. It is not an OS container: processes inside the worktree may still see resources permitted by their sandbox and host account.

Analysis, architecture, task-graph, review, and summary phases run read-only. Worker and fix phases use `workspace-write`, with Codex workspace network disabled. Selecting a globally read-only sandbox also prevents normal implementation writes; selecting host-wide access expands every phase and is available only through the explicitly unsafe option.

## Recovery model

PatchGantry uses several bounded recovery mechanisms:

- phase retries after invalid structured output;
- task-graph replanning after deterministic gate failures;
- worker retries with review or verification feedback;
- failure-manager actions constrained by a code allowlist;
- synthetic tasks requested by combined reviews;
- resume from phase and task checkpoints;
- cache reuse only when input fingerprints match.

Budgets prevent an unsuccessful run from becoming an indefinite agent loop. Exhaustion is recorded as a failure or partial result for human review.

## Security boundaries

The execution path crosses several boundaries:

- operator input into prompts and branch metadata;
- repository content into model context;
- model output into validated state and selected commands;
- PatchGantry into Codex, Git, shells, package managers, and test runners;
- command and model output into persistent artifacts.

Controls include schemas, bounded context, redaction, strict policy presets, worktrees, sandbox selection, secret-diff detection, and bounded retries. See [SECURITY.md](../SECURITY.md) for the assumptions these controls do not cover.
