#!/usr/bin/env node

import { parseArgs } from './lib/args.mjs'
import {
  doctorCommand,
  explainCommand,
  listCommand,
  promoteCommand,
  resumeCommand,
  runCommand,
  statusCommand,
} from './lib/run.mjs'
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_REASONING_EFFORT,
  ORCHESTRATOR_VERSION,
} from './lib/manifest.mjs'

function printHelp() {
  console.log(`RepoForeman v${ORCHESTRATOR_VERSION}

Usage:
  repo-foreman <command> [options]

Commands:
  run       Run full pipeline
  resume    Resume a previous run
  status    Print run state.json
  explain   Print gate status/reasons for a run
  list      List runs
  promote   Evaluate retry baseline/promotion gate from run artifacts
  doctor    Preflight checks + hardening advice

Runtime defaults:
  Model: ${DEFAULT_MODEL}
  Default reasoning effort: ${DEFAULT_MODEL_REASONING_EFFORT}
  Sandbox: read-only for planning/review; workspace-write for implementation
  Host-wide access: danger-full-access requires --unsafe-host-access
  Web search: disabled
  Policy: strict; allowlist mode monitor (effective only with configured prefixes)
  Branch names: opaque repo-foreman/run-<RUN_ID>

Core options:
  --task "<text>" | --task-file <path>
  --run-id <id>
  --codex-bin "codex"
  --model <model>       # override default: ${DEFAULT_MODEL}
  --effort minimal|low|medium|high|xhigh|max|ultra  # default: ${DEFAULT_MODEL_REASONING_EFFORT}
  --sandbox read-only|workspace-write|danger-full-access
  --unsafe-host-access  # required acknowledgement for danger-full-access
  --branch-name-strategy opaque|heuristic|codex
  --search      # opt in to web search
  --no-search   # default
  --max-task-graph-attempts 7
  --max-worker-attempts 3
  --execution-profile fast|standard|strict  # alias for --review-mode (fast=minimal, standard=balanced, strict=strict)
  --review-mode strict|balanced|minimal
  --reviewer-independence linked|isolated   # linked keeps previous review context; isolated suppresses it
  --max-review-fix-attempts <n>  # default by review-mode: strict=6, balanced=4, minimal=1
  --max-review-diff-growth-lines 1200
  --prompt-json-max-chars 32000
  --task-graph-max-files-per-task 24
  --task-graph-max-acceptance-criteria-per-task 15
  --task-graph-max-description-chars 1800
  --task-graph-max-verification-commands-per-task 7
  --max-fix-attempts 5
  --tests "npm test"   # legacy shorthand for both --task-tests and --final-tests
  --task-tests "npm test"
  --final-tests "npm test"
  --coverage
  --coverage-floor 40
  --audit
  --dry-run       # plan only; read-only agent phases, but creates local branch/worktree/artifacts
  --policy strict|balanced|off
  --policy-allowlist-mode off|monitor|enforce  # default: monitor
  --policy-file <path>
  --no-redact
  --verbose        # default
  --pretty-events  # default; human-readable (multiline blocks)
  --mode autonomous|interactive  # default: autonomous
  --interaction-model phased|conversational  # default: phased
  --answers-mode auto|file|console
  --git-author-name "<name>"
  --git-author-email "<email>"
  --force
  --no-commit
  --autostash
  --worktree         # default (isolated git worktree per run)
  --no-worktree      # legacy mode (checkout branch in current worktree)
  --worktree-deps auto|link|npm-ci|none  # default: none; avoids untrusted install scripts
  --copy-env-files  # opt in; only .env.test and .env.test.local
  --promotion-sample-size 30

CI reliability defaults (when CI is truthy and flags are omitted):
  --policy strict
  --execution-profile strict
  --review-mode strict
  --coverage
  --audit
  --prompt-json-max-chars 32000
  --final-tests "npm test"
`)
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2))
  if (command === 'help' || options.help) {
    printHelp()
    process.exit(0)
  }

  try {
    if (command === 'run') {
      await runCommand(options)
      return
    }
    if (command === 'resume') {
      await resumeCommand(options)
      return
    }
    if (command === 'status') {
      await statusCommand(options)
      return
    }
    if (command === 'explain') {
      await explainCommand(options)
      return
    }
    if (command === 'list') {
      await listCommand()
      return
    }
    if (command === 'doctor') {
      const healthy = await doctorCommand(options)
      if (!healthy) process.exitCode = 1
      return
    }
    if (command === 'promote') {
      await promoteCommand(options)
      return
    }
    printHelp()
    process.exit(2)
  } catch (error) {
    console.error(error?.stack ?? String(error))
    process.exit(1)
  }
}

await main()
