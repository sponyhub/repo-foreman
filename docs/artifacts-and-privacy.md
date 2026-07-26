# Artifacts, privacy, and retention

PatchGantry persists run state so work can be audited, explained, and resumed. Persistence is useful operationally and creates a local data-handling responsibility.

## Artifact layout

A run typically contains:

```text
.patch-gantry/
├── runs/
│   └── <run>/
│       ├── manifest.json
│       ├── state.json
│       ├── resume-journal.jsonl
│       ├── retry-events.jsonl
│       └── phases/
└── worktrees/
    └── <branch>/
```

Exact phase directories and filenames are an unstable `0.x` contract. Use `status` and `explain` for routine inspection rather than building production automation around undocumented paths.

When `--no-redact` is explicitly enabled, phase directories also contain `events.raw.jsonl`. That file is a verbatim event stream and can contain secrets or personal data; do not enable or share it in routine runs.

## What may be recorded

- task briefs, assumptions, answers, and steering messages;
- repository paths, source excerpts, Git metadata, and diffs;
- generated analysis, plans, implementation notes, and reviews;
- command text, exit codes, and bounded output;
- error messages, retry causes, and session identifiers;
- resolved configuration and selected model settings.

Redaction targets known secret-like patterns, but novel formats and secrets embedded in ordinary prose can survive. Raw repository files and external command logs are also outside any guarantee that a single redaction function can provide.

## Data-minimization checklist

Before running:

1. Replace customer or employee identifiers with synthetic labels.
2. Remove API keys, cookies, tokens, private URLs, and production incident payloads from the brief.
3. Use opaque branch naming.
4. Leave environment-file copying and web search disabled unless necessary.
5. Run from a shell without unrelated cloud, package-registry, or production credentials.

During and after the run:

1. Do not paste secrets into interactive answers.
2. Inspect event and error artifacts before sharing them.
3. Keep artifact directories ignored by Git.
4. Apply the shortest retention period compatible with debugging and audit needs.
5. Remove abandoned worktrees before deleting their parent artifact directory.

## Cleanup

Use Git to inspect registered worktrees before manual cleanup:

```bash
git worktree list
```

Prefer PatchGantry's own cleanup command when the installed release provides one. If manual removal is necessary, identify the exact run and worktree paths first. Do not recursively remove a broad projects directory or a path constructed from an unresolved variable.

## Suspected exposure

If a credential or sensitive record appears in an artifact:

1. stop or abort the active run;
2. rotate or revoke the credential at its source;
3. preserve only the minimum sanitized evidence needed to diagnose the issue;
4. remove the sensitive artifact from worktrees, backups, and shared logs;
5. check Git history and remote refs before assuming it stayed local;
6. privately report a PatchGantry redaction or isolation flaw according to [SECURITY.md](../SECURITY.md).

Deleting the local file is not sufficient if the value was sent to a model, external search provider, remote package registry, CI log, or Git remote. Follow the retention and incident process of every affected service.
