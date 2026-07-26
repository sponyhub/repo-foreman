import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { gateSyntheticTaskForEnqueue } from './synthetic-task-gate.mjs'
import { fileExists, readJsonFile } from './fs.mjs'

const execFileAsync = promisify(execFile)

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI_PATH = path.join(TOOL_ROOT, 'cli.mjs')

const NOOP_COMMAND = 'node -e "process.exit(0)"'

export function evaluateSelfTestReport({ dryRun, executionRun, syntheticGate }) {
  const checks = [
    {
      id: 'dry_run_blocking_question_precheck',
      ok: Array.isArray(dryRun?.checkpoints) && dryRun.checkpoints.includes('blocking_question_precheck'),
      detail: 'Dry-run stub run records the blocking-question pre-check phase.',
    },
    {
      id: 'execution_baseline_verification',
      ok:
        ((Array.isArray(executionRun?.checkpoints) && executionRun.checkpoints.includes('baseline_verification')) ||
          (Array.isArray(executionRun?.phaseDirectories) &&
            executionRun.phaseDirectories.includes('baseline_verification'))) &&
        executionRun?.state?.baseline_verification &&
        typeof executionRun.state.baseline_verification === 'object',
      detail: 'Stub execution run records baseline verification before task work starts.',
    },
    {
      id: 'execution_task_progress_written',
      ok:
        Number.isFinite(executionRun?.state?.task_execution?.total) &&
        executionRun.state.task_execution.total > 0 &&
        Array.isArray(executionRun?.state?.task_execution?.completed_task_ids) &&
        executionRun.state.task_execution.completed_task_ids.length > 0,
      detail: 'Stub execution run writes task_execution progress after the stub task completes.',
    },
    {
      id: 'synthetic_gate_blocks_before_loop',
      ok: syntheticGate?.blocked === true && syntheticGate?.implementationLoopProtected === true,
      detail:
        syntheticGate?.reason != null
          ? `Synthetic gate blocked the invalid task with reason '${syntheticGate.reason}' before the implementation loop.`
          : 'Synthetic gate blocks invalid tasks before the implementation loop.',
    },
  ]

  return {
    ok: checks.every((check) => check.ok),
    checks,
    failures: checks.filter((check) => !check.ok).map((check) => check.id),
  }
}

export async function runSelfTest({ repoRoot = process.cwd(), cleanup = true } = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'patch-gantry-self-test-'))

  try {
    const cloneRoot = path.join(tempRoot, 'repo')
    await createFixtureRepo(cloneRoot)

    const fakeCodexPath = path.join(tempRoot, 'fake-codex.js')
    await writeFile(fakeCodexPath, buildFakeCodexScript(), 'utf8')
    await execFileAsync('chmod', ['755', fakeCodexPath], { cwd: tempRoot })

    const dryRun = await runScenario({
      cloneRoot,
      fakeCodexPath,
      runId: 'selftest-dry-run',
      dryRun: true,
    })

    const executionRun = await runScenario({
      cloneRoot,
      fakeCodexPath,
      runId: 'selftest-execution-run',
      dryRun: false,
    })

    const syntheticGate = await runSyntheticGateAssertion()

    return {
      ...evaluateSelfTestReport({ dryRun, executionRun, syntheticGate }),
      dryRun,
      executionRun,
      syntheticGate,
    }
  } finally {
    if (cleanup) {
      await rm(tempRoot, { recursive: true, force: true })
    }
  }
}

async function createFixtureRepo(repoRoot) {
  await mkdir(repoRoot, { recursive: true })
  await writeFile(
    path.join(repoRoot, 'package.json'),
    `${JSON.stringify({ name: 'patch-gantry-self-test-fixture', private: true, scripts: { test: NOOP_COMMAND } }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(path.join(repoRoot, 'README.md'), '# PatchGantry self-test fixture\n', 'utf8')
  await writeFile(path.join(repoRoot, '.gitignore'), '.patch-gantry/\n', 'utf8')
  await execFileAsync('git', ['init', '--quiet', '-b', 'main'], { cwd: repoRoot })
  await execFileAsync('git', ['config', 'user.name', 'PatchGantry Self-Test'], { cwd: repoRoot })
  await execFileAsync('git', ['config', 'user.email', 'self-test@patch-gantry.local'], { cwd: repoRoot })
  await execFileAsync('git', ['add', 'package.json', 'README.md', '.gitignore'], { cwd: repoRoot })
  await execFileAsync('git', ['commit', '--quiet', '-m', 'Initialize self-test fixture'], { cwd: repoRoot })
}

async function runScenario({ cloneRoot, fakeCodexPath, runId, dryRun }) {
  const taskText = [
    'Task: Run a deterministic orchestrator self-test stub task.',
    'Goal: Validate orchestrator checkpoint wiring without touching production paths.',
    'In scope: isolated self-test execution only.',
    'Out of scope: application code changes.',
    'Constraints: use fake codex outputs, no commits, no external services.',
    `Verification commands: ${NOOP_COMMAND}`,
  ].join('\n')

  const args = [
    CLI_PATH,
    'run',
    '--task',
    taskText,
    '--run-id',
    runId,
    '--codex-bin',
    fakeCodexPath,
    '--branch-name-strategy',
    'heuristic',
    '--mode',
    'autonomous',
    '--review-mode',
    'balanced',
    '--no-search',
    '--no-worktree',
    '--no-commit',
    '--task-tests',
    NOOP_COMMAND,
    '--final-tests',
    NOOP_COMMAND,
  ]

  if (dryRun) {
    args.push('--dry-run')
  }

  await execFileAsync('node', args, {
    cwd: cloneRoot,
    env: {
      ...process.env,
      CI: '1',
    },
    maxBuffer: 20 * 1024 * 1024,
  })

  const runDir = await findRunDirByRunId(cloneRoot, runId)
  const manifest = await readJsonFile(path.join(runDir, 'manifest.json'))
  const state = await readJsonFile(path.join(runDir, 'state.json'))
  const phasesDir = path.join(runDir, 'phases')
  const phaseDirectories = (await fileExists(phasesDir))
    ? (await readdir(phasesDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : []

  return {
    runDir,
    checkpoints: Object.keys(manifest?.phases ?? {}),
    phaseDirectories,
    manifest,
    state,
  }
}

async function findRunDirByRunId(repoRoot, runId) {
  const runsRoot = path.join(repoRoot, '.patch-gantry', 'runs')
  const candidates = await findFilesNamed(runsRoot, 'state.json')

  for (const statePath of candidates) {
    const state = await readJsonFile(statePath)
    if (state?.run_id === runId) {
      return path.dirname(statePath)
    }
  }

  throw new Error(`Unable to find self-test run directory for run_id=${runId}`)
}

async function findFilesNamed(rootDir, targetName) {
  if (!(await fileExists(rootDir))) {
    return []
  }

  const results = []
  const stack = [rootDir]

  while (stack.length > 0) {
    const current = stack.pop()
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
        continue
      }
      if (entry.isFile() && entry.name === targetName) {
        results.push(fullPath)
      }
    }
  }

  return results
}

async function runSyntheticGateAssertion() {
  const blocked = await gateSyntheticTaskForEnqueue({
    task: {
      id: 'synthetic-invalid-missing-criteria',
      title: 'Invalid synthetic task',
      type: 'refactor',
      description: 'Missing acceptance criteria to validate schema enforcement.',
      dependencies: [],
      risk_level: 'low',
      files: { create: [], modify: [], delete: [] },
      verification_commands: [NOOP_COMMAND],
    },
    sourcePhase: 'integration_review',
    policy: { max_deletes_per_task: 0 },
    architecture: { docs_to_update: [] },
    mode: 'autonomous',
  })

  const runSource = await readFile(path.join(TOOL_ROOT, 'lib', 'run.mjs'), 'utf8')
  const implementationLoopProtected = sourceContainsSyntheticGateLoopGuard(runSource)

  return {
    blocked: blocked.ok === false,
    reason: blocked?.blocked?.reason ?? null,
    implementationLoopProtected,
  }
}

function sourceContainsSyntheticGateLoopGuard(runSource) {
  const integrationGuardPattern =
    /gateSyntheticTaskForEnqueue[\s\S]*?if \(!gateResult\.ok\) \{[\s\S]*?continue[\s\S]*?\}[\s\S]*?allowedSyntheticTasks\.push/
  const verificationGuardPattern =
    /gateSyntheticTaskForEnqueue[\s\S]*?if \(!gateResult\.ok\) \{[\s\S]*?continue[\s\S]*?\}[\s\S]*?taskResult = await runTaskWithReviewLoop/

  return integrationGuardPattern.test(runSource) && verificationGuardPattern.test(runSource)
}

function buildFakeCodexScript() {
  return `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

function readFlagValue(flag) {
  const args = process.argv.slice(2)
  const idx = args.indexOf(flag)
  return idx >= 0 ? args[idx + 1] : null
}

function createReviewResult() {
  return {
    verdict: 'approve',
    summary: 'Approved by self-test fake codex.',
    scope_alignment: {
      status: 'match',
      notes: 'Self-test stub output matches the requested checkpoint flow.',
    },
    rubric: {
      security: { status: 'pass', notes: 'No live secrets or user data are used.' },
      functionality: { status: 'pass', notes: 'Stub output satisfies the orchestrator schema.' },
      simplicity: { status: 'pass', notes: 'Minimal deterministic fixture.' },
      speed: { status: 'pass', notes: 'No external provider calls are required.' },
      quality: { status: 'pass', notes: 'Schema-complete fixture output.' },
      gdpr: { status: 'pass', notes: 'No personal data is processed.' }
    },
    changes_since_last_review: 'initial self-test stub',
    verification_summary: 'not run',
    blocking_issues: [],
    acknowledged_conflicts: [],
    non_blocking_suggestions: [],
    docs_impact: [],
    security_privacy_concerns: []
  }
}

function createOutput(schemaPath) {
  const schemaName = path.basename(schemaPath)

  switch (schemaName) {
    case 'analysis.schema.json':
      return {
        gate: { status: 'pass', reasons: [], questions: [] },
        task: 'Self-test stub run',
        repo_context_summary: 'Deterministic fake codex output for orchestrator self-test.',
        scope: {
          in_scope: ['Validate orchestrator checkpoint wiring.'],
          out_of_scope: ['Application behavior changes.'],
          non_goals: ['External service integration.']
        },
        assumptions: [],
        risks: [],
        key_files_to_review: [],
        suggested_verification_commands: ['node -e "process.exit(0)"'],
        stop_conditions: []
      }
    case 'architecture.schema.json':
      return {
        gate: { status: 'pass', reasons: [], questions: [] },
        architecture_summary: 'Use deterministic fake codex responses for self-test coverage.',
        decisions: [
          {
            id: 'DEC-SELFTEST-001',
            decision: 'Drive the orchestrator with schema-valid canned responses.',
            rationale: 'This keeps the self-test deterministic and offline.',
            alternatives_considered: ['Live Codex execution'],
            impacts: ['Validates orchestrator phase wiring without external dependencies.'],
            security_privacy_notes: ['No customer data or secrets are processed.']
          }
        ],
        interface_boundaries: [],
        test_strategy: {
          unit: ['Evaluate self-test report logic.'],
          integration: ['Run a stub orchestrator flow with fake codex output.'],
          e2e: []
        },
        docs_to_update: [],
        open_questions: []
      }
    case 'task-graph.schema.json':
      return {
        gate: { status: 'pass', reasons: [], questions: [] },
        execution_order: ['stub-task-1'],
        tasks: [
          {
            id: 'stub-task-1',
            title: 'Complete the stub task',
            type: 'code',
            description: 'No-op task used only for orchestrator self-test coverage and DEC-SELFTEST-001 traceability.',
            acceptance_criteria: [
              'DEC-SELFTEST-001 remains covered by the stub task execution path.',
              'The worker returns done and task_execution is persisted.',
            ],
            dependencies: [],
            risk_level: 'low',
            files: { create: [], modify: [], delete: [] },
            verification_commands: []
          }
        ]
      }
    case 'worker-result.schema.json':
      return {
        task_id: 'stub-task-1',
        status: 'done',
        summary: 'Self-test stub task completed without file edits.',
        files_touched: [],
        notes: [],
        followups: [],
        questions: []
      }
    case 'summary.schema.json':
      return {
        ready_for_dev_deploy: false,
        change_summary: 'Completed deterministic orchestrator self-test stub run.',
        files_changed: [],
        docs_updated: [],
        synthetic_tasks_blocked: [],
        verification: [
          {
            command: 'node -e "process.exit(0)"',
            result: 'pass'
          }
        ],
        verification_failures: [],
        security_gdpr_notes: ['No personal data processed during the self-test.'],
        residual_risks: [],
        next_steps: []
      }
    case 'review.schema.json':
      return createReviewResult()
    case 'resolve-block.schema.json':
      return {
        can_proceed: true,
        summary: 'No blocker resolution required for self-test.',
        assumptions: [],
        mitigations: [],
        task_hints: [],
        remaining_blockers: [],
        notes: []
      }
    case 'question-capture.schema.json':
    case 'assumption-hint-capture.schema.json':
      return {
        assumptions: [],
        task_hints: [],
        notes: [],
        questions: []
      }
    case 'fix-tests.schema.json':
      return {
        diagnosis: 'No fixes required for self-test.',
        changes_made: [],
        recommended_rerun_commands: [],
        notes: []
      }
    case 'failure-manager.schema.json':
      return {
        action: 'escalate',
        reason: 'Failure manager should not be needed in the self-test happy path.',
        review_feedback: '',
        verification_feedback: '',
        questions: [],
        answers: [],
        notes: []
      }
    case 'branch-name.schema.json':
      return {
        words: ['orchestrator', 'selftest']
      }
    default:
      throw new Error('Unsupported schema in fake codex: ' + schemaName)
  }
}

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--version') {
  console.log('fake-codex 0.0.0')
  process.exit(0)
}

if (args[0] === 'login' && args[1] === 'status') {
  process.exit(0)
}

if (args[0] === 'exec' && args[1] === '--help') {
  console.log('--ask-for-approval --cd --json --output-last-message --output-schema --sandbox --search')
  process.exit(0)
}

if (args[0] !== 'exec') {
  console.error('Unsupported fake codex command: ' + args.join(' '))
  process.exit(2)
}

const schemaPath = readFlagValue('--output-schema')
const outputPath = readFlagValue('--output-last-message')
if (!schemaPath || !outputPath) {
  console.error('Missing required output flags')
  process.exit(3)
}

let received = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  received += chunk
})

process.stdin.on('end', () => {
  const output = createOutput(schemaPath)
  fs.writeFileSync(outputPath, JSON.stringify(output))
  console.log(JSON.stringify({ session_id: 'fake-self-test-session' }))
  console.log(JSON.stringify({ type: 'item.completed', item: { id: 'selftest', type: 'message', text: received.trim() } }))
  process.exit(0)
})
`
}
