import crypto from 'node:crypto'
import { chmod, copyFile, lstat, readdir, rename, symlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  addAssumptions,
  addMitigations,
  addTaskHints,
  addOpenQuestions,
  createManifest,
  ORCHESTRATOR_VERSION,
  updatePhase,
  writeManifest,
} from './manifest.mjs'
import { createPhaseInputFingerprint, loadCachedPhaseWithDiagnostics, maybeLoadCachedPhase } from './cache.mjs'
import {
  CodexPhaseInterruptedError,
  detectCodexCliContract,
  detectCodexLiveInteractionSupport,
  runCodexPhase,
} from './codex.mjs'
import {
  appendMarkdownUnique,
  ensureDir,
  fileExists,
  readJsonFile,
  readTextFile,
  writeJsonFileAtomic,
  writeJsonFile,
  writeTextFile,
} from './fs.mjs'
import {
  addAll,
  assertGitRepo,
  checkoutBranch,
  commit,
  createAndCheckoutBranch,
  createWorktreeForExistingBranch,
  createWorktreeWithNewBranch,
  ensureCleanWorkingTree,
  ensureGitAuthorConfigured,
  git,
  hasChanges,
  getHeadSha,
  getRepoRoot,
  getStatusPorcelain,
  popAutostash,
} from './git.mjs'
import { validateTaskGraph } from './gates.mjs'
import {
  formatPolicyViolationGuidanceBlock,
  formatWorkerContinuationBlock,
  isRetryableCodexPhaseError,
  resolvePolicyGuidanceRetryLimit,
} from './codex-retry.mjs'
import { decideGateAction, decideWorkerBlockedAction } from './mode.mjs'
import { isDeniedPath, loadPolicy, parseGitStatusPorcelain, detectSecretDiffMatches } from './policy.mjs'
import {
  buildUnresolvedPostCycleFailuresFromIssues,
  buildUnresolvedPostCycleFailuresFromVerification,
  normalizeSyntheticCycleState,
  planSyntheticCycleEnqueue,
} from './synthetic-cycle-cap.mjs'
import {
  DEFAULT_TASK_GRAPH_BUDGETS,
  formatTaskGraphBudgetConstraints,
  formatTaskGraphBudgetFeedback,
  validateTaskGraphBudgets,
} from './task-graph-budgets.mjs'
import { ensureTaskGraphVerificationCommands } from './task-graph-verification.mjs'
import {
  findInvalidArchitectureDocsToUpdateEntries,
  findMissingArchitectureDocsToUpdate,
} from './task-graph-coverage.mjs'
import { findMissingArchitectureDecisionCoverage } from './task-graph-traceability.mjs'
import {
  createEmptyFileConflictMap,
  detectFileConflicts,
  findMissingConflictAcknowledgements,
} from './task-graph-file-conflicts.mjs'
import {
  DEFAULT_PROMPT_JSON_MAX_CHARS,
  jsonStringifyForPrompt,
  renderJsonForPrompt,
  renderTextForPrompt,
  renderTemplate,
} from './templates.mjs'
import { runShellCommand, ShellCommandInterruptedError } from './verify.mjs'
import { buildCodexSubprocessEnv } from './env.mjs'
import { redactText } from './redact.mjs'
import { makeRunBranchName } from './branch-name.mjs'
import { pickBranchDescriptorWordsWithCodex } from './branch-name-codex.mjs'
import { buildTaskDirNameMap } from './task-dir-name.mjs'
import { resolveRunAndWorktreePaths } from './run-paths.mjs'
import { diffGrowthWithinLimit, parseNumstat, totalChangedLines } from './diff-stats.mjs'
import { getReviewPromptFile } from './review-prompts.mjs'
import {
  collectGateSummaries,
  collectLatestReviewSummaries,
  collectTaskGraphCoverageDiagnostics,
  formatGateSummaries,
  formatReviewSummaries,
} from './gate-diagnostics.mjs'
import { createPlanningContext, mergePlanningContext } from './planning-context.mjs'
import { shouldRunReviewPhase } from './review-mode.mjs'
import { previousReviewPromptValue } from './reviewer-independence.mjs'
import {
  appendUserAnswers,
  ensureAnswersTemplate,
  parseAnswerDirectives,
  parseStructuredAnswers,
  promptForConsoleAnswers,
  readAnswersCursor,
  readOpenQuestions,
  readUserAnswers,
  readUserAnswersDelta,
  resolveAnswersMode,
  writeAnswersCursor,
} from './user-input.mjs'
import { extractQuestionTexts, isCriticalQuestion } from './questions.mjs'
import {
  buildConversationPromptSuffix,
  clearPendingQuestion,
  consumePendingReplanRequest,
  consumePendingSteeringMessages,
  createConversationArtifacts,
  recordAnswerMessage,
  readConversationState,
  setLiveInteractionCapability,
  setActiveConversationCommand,
  setActiveConversationPhase,
  setConversationWaitState,
  setConversationSessionId,
  setPendingQuestion,
} from './conversation-state.mjs'
import { startTerminalInputBroker } from './terminal-input.mjs'
import {
  extractBlockingPrecheckQuestions,
  resolveBlockingQuestionPrecheck,
} from './blocking-question-precheck.mjs'
import { isWorkerStatusBlocking } from './worker-status.mjs'
import { getActionableBlockingIssues } from './review-issues.mjs'
import {
  buildAnswersBlockFromList,
  buildAutonomousFallbackAnswersBlock,
  createQuestionSetSignature,
  deriveTaskLoopLimits,
} from './task-loop-controls.mjs'
import { resolveRecoveryAction, validateFailureManagerDecision } from './failure-manager.mjs'
import { gateSyntheticTaskForEnqueue } from './synthetic-task-gate.mjs'
import {
  appendPhaseSubstateEvent,
  appendRecoveryMarkerEvent,
  appendVerificationCommandEvent,
  buildPhaseSubstateIndex,
  buildAutoResolveReplayMarkerId,
  deriveTaskReplayState,
  deriveVerificationReplayState,
  hasPhaseSubstateCheckpoint,
  readResumeJournalEvents,
} from './resume-journal.mjs'
import { appendRetryEvent, resolveRetryCauseCode } from './retry-telemetry.mjs'
import { evaluatePromotionGateFromRunDirs } from './promotion-gate.mjs'
import {
  buildVerificationCommandPlan,
  collectKnownFailureIds,
  summarizeCommandOutput,
} from './baseline-verification.mjs'
import {
  createTaskExecutionState,
  formatTaskExecutionProgressLines,
  hydrateTaskExecutionState,
  recordCommittedTask,
  recordFailedTask,
  shouldSkipCommittedTask,
} from './task-execution.mjs'

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROMPTS_DIR = path.join(TOOL_ROOT, 'prompts')
const SCHEMAS_DIR = path.join(TOOL_ROOT, 'schemas')
const POLICIES_DIR = path.join(TOOL_ROOT, 'policies')

const RUNS_DIR_NAME = '.patch-gantry/runs'
const WORKTREES_DIR_NAME = '.patch-gantry/worktrees'
const NON_FAILURE_STATES = new Set(['STOPPED_ABORTED', 'STOPPED_BLOCKED', 'STOPPED_NEEDS_USER_INPUT', 'WAITING_FOR_USER_INPUT'])
const SAFE_RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/

export class RunAbortedError extends Error {
  constructor(message = 'Run aborted from conversational control command.', phaseName = null) {
    super(message)
    this.name = 'RunAbortedError'
    this.phaseName = phaseName
  }
}

async function commitIfChanges({ repoRoot, message, ui, context }) {
  if (!(await hasChanges(repoRoot))) {
    ui.log(`${context} no changes to commit; skipping`)
    return false
  }

  await addAll(repoRoot)
  await commit(repoRoot, message)
  return true
}

export async function runCommand(options) {
  const mainRepoRoot = await getRepoRoot(process.cwd())
  await assertGitRepo(mainRepoRoot)

  const runId = options.run_id ?? generateRunId()
  if (!SAFE_RUN_ID_PATTERN.test(runId)) {
    throw new Error('Unsafe run id: expected 1-80 ASCII letters, numbers, underscores, or hyphens')
  }
  const bootstrapRunDir = path.join(mainRepoRoot, RUNS_DIR_NAME, runId)
  const ui = createUi({ runId, verbose: Boolean(options.verbose), prettyEvents: Boolean(options.pretty_events) })

  const taskSource = options.task_file ? 'task-file' : 'task'
  const taskText = await loadTaskText(options)
  const baseSha = await getHeadSha(mainRepoRoot)
  let runDir = bootstrapRunDir
  let branchName = null
  let preflightResult = null
  let bootstrapInteractionContext = null

  await ensureDir(bootstrapRunDir)
  await writeTextFile(path.join(bootstrapRunDir, 'task.md'), `${redactText(taskText.trim())}\n`)
  await writeState(bootstrapRunDir, {
    version: ORCHESTRATOR_VERSION,
    run_id: runId,
    state: 'INIT',
    base_sha: baseSha,
    branch_name: null,
    worktree_path: null,
    tasks_completed: [],
    file_conflict_map: createEmptyFileConflictMap(),
    synthetic_tasks_blocked: [],
    synthetic_cycle_count: 0,
    unresolved_post_cycle_failures: [],
    invalid_recovery_suggestions: [],
    final_status: null,
    failure_reason: null,
    failed_phase: null,
    last_blocking_issues: [],
  })
  if (options.interaction_model === 'conversational') {
    bootstrapInteractionContext = {
      currentInterruptController: null,
      terminalBroker: null,
      pendingQuestionPhase: null,
    }
    options.interaction_context = bootstrapInteractionContext
    await createConversationArtifacts(bootstrapRunDir, { interactionModel: options.interaction_model })
    await initializeLiveInteractionCapability({
      codexBin: options.codex_bin,
      repoRoot: mainRepoRoot,
      runDir: bootstrapRunDir,
      ui,
    })
    bootstrapInteractionContext.terminalBroker = startTerminalInputBroker({
      runDir: bootstrapRunDir,
      interactionModel: options.interaction_model,
      interactionContext: bootstrapInteractionContext,
      ui,
    })
  }
  try {
    branchName = await resolveRunBranchName({
      repoRoot: mainRepoRoot,
      runDir: bootstrapRunDir,
      runId,
      taskText,
      options,
      interactionContext: options?.interaction_context ?? null,
      ui,
    })

    const { runRelativePath } = resolveRunAndWorktreePaths({ branchName })
    const resolvedRunDir = path.join(mainRepoRoot, runRelativePath)
    if (resolvedRunDir !== bootstrapRunDir) {
      if (await fileExists(resolvedRunDir)) {
        throw new Error(`Run directory already exists: ${path.relative(mainRepoRoot, resolvedRunDir)}`)
      }
      bootstrapInteractionContext?.terminalBroker?.stop?.()
      if (bootstrapInteractionContext) {
        bootstrapInteractionContext.terminalBroker = null
      }
      await ensureDir(path.dirname(resolvedRunDir))
      await rename(bootstrapRunDir, resolvedRunDir)
      runDir = resolvedRunDir
      if (options.interaction_model === 'conversational') {
        await createConversationArtifacts(runDir, { interactionModel: options.interaction_model })
        bootstrapInteractionContext.terminalBroker = startTerminalInputBroker({
          runDir,
          interactionModel: options.interaction_model,
          interactionContext: bootstrapInteractionContext,
          ui,
        })
      }
    }

    await updateState(runDir, {
      base_sha: baseSha,
      branch_name: branchName,
    })
    await checkpointConversationBoundary({
      runDir,
      interactionModel: options?.interaction_model ?? 'phased',
      phaseName: 'preflight',
      boundaryLabel: 'starting preflight',
      ui,
    })
    preflightResult = await preflight(mainRepoRoot, runId, options, runDir, branchName, ui)
    bootstrapInteractionContext?.terminalBroker?.stop?.()
    if (bootstrapInteractionContext) {
      bootstrapInteractionContext.terminalBroker = null
    }

    const policy = await resolvePolicy(options, runDir)
    const manifest = createManifest({
      runId,
      mode: options.mode,
      reviewMode: options.review_mode,
      createdAt: new Date().toISOString(),
      baseSha,
      branchName,
      worktreePath: preflightResult.worktreePath ?? null,
      taskSource,
      policyPreset: options.policy,
      policyFilePath: options.policy_file ?? null,
      runtimeConfig: buildRuntimeConfigSnapshot(options),
    })
    await writeManifest(path.join(runDir, 'manifest.json'), manifest)

    await runPipeline({
      repoRoot: preflightResult.executionRepoRoot,
      runId,
      runDir,
      branchName,
      baseSha,
      taskText,
      policy,
      manifest,
      options,
    })
  } catch (error) {
    if (error instanceof RunAbortedError) {
      await markRunAborted(runDir, { phase: error.phaseName ?? 'pipeline', error })
      return
    }
    const failedPhase = preflightResult ? 'pipeline' : 'preflight'
    await markRunFailedIfNeeded(runDir, error, failedPhase)
      throw error
  } finally {
    bootstrapInteractionContext?.terminalBroker?.stop?.()
    if (preflightResult?.autostashed) {
      await popAutostash(mainRepoRoot)
    }
  }
}

export async function resumeCommand(options) {
  const mainRepoRoot = await getRepoRoot(process.cwd())
  await assertGitRepo(mainRepoRoot)

  const selector = options.run_id ?? (await getLastRunId(mainRepoRoot))
  if (!selector) {
    throw new Error('No runs found (provide --run-id)')
  }

  const runDir = await resolveRunDirBySelector(mainRepoRoot, selector)
  if (!runDir) {
    throw new Error(`Run not found: ${selector}`)
  }

  const state = await readJsonFile(path.join(runDir, 'state.json'))
  if (isTerminalState(state.state)) {
    throw new Error(`Run is in terminal state: ${state.state}`)
  }

  const manifest = await readJsonFile(path.join(runDir, 'manifest.json'))
  const taskText = await readTextFile(path.join(runDir, 'task.md'))

  const policyJsonPath = path.join(runDir, 'policy.json')
  const policy = (await fileExists(policyJsonPath)) ? await readJsonFile(policyJsonPath) : null

  let executionRepoRoot = mainRepoRoot
  const shouldUseWorktree = Boolean(options.worktree)
  let worktreePath = typeof state.worktree_path === 'string' ? state.worktree_path : null
  if (shouldUseWorktree && worktreePath) {
    if (!path.isAbsolute(worktreePath)) {
      worktreePath = path.join(mainRepoRoot, worktreePath)
    }
    if (!(await fileExists(worktreePath))) {
      await ensureDir(path.dirname(worktreePath))
      await createWorktreeForExistingBranch(mainRepoRoot, { worktreePath, branchName: state.branch_name })
    }
    executionRepoRoot = worktreePath
  } else {
    await checkoutBranch(mainRepoRoot, state.branch_name)
  }

  try {
    return await runPipeline({
      repoRoot: executionRepoRoot,
      runId: state.run_id,
      runDir,
      branchName: state.branch_name,
      baseSha: state.base_sha,
      taskText,
      policy: policy ?? null,
      manifest,
      options,
      resumeState: state,
    })
  } catch (error) {
    if (error instanceof RunAbortedError) {
      await markRunAborted(runDir, { phase: error.phaseName ?? 'pipeline', error })
      return
    }
    await markRunFailedIfNeeded(runDir, error, 'pipeline')
    throw error
  }
}

export async function statusCommand(options) {
  const repoRoot = await getRepoRoot(process.cwd())
  const selector = options.run_id ?? (await getLastRunId(repoRoot))
  if (!selector) {
    throw new Error('No runs found')
  }

  const runDir = await resolveRunDirBySelector(repoRoot, selector)
  if (!runDir) {
    throw new Error(`Run not found: ${selector}`)
  }
  const state = await readJsonFile(path.join(runDir, 'state.json'))
  console.log(JSON.stringify(state, null, 2))
  const conversationState = await readConversationSnapshot(runDir)
  const conversationLines = formatConversationStatusLines(conversationState)
  if (conversationLines.length > 0) {
    console.log('')
    for (const line of conversationLines) {
      console.log(line)
    }
  }
  const taskExecutionLines = formatTaskExecutionProgressLines({
    phaseState: state?.state,
    taskExecution: state?.task_execution,
  })
  if (taskExecutionLines.length > 0) {
    console.log('')
    for (const line of taskExecutionLines) {
      console.log(line)
    }
  }
}

export async function explainCommand(options) {
  const repoRoot = await getRepoRoot(process.cwd())
  const selector = options.run_id ?? (await getLastRunId(repoRoot))
  if (!selector) {
    throw new Error('No runs found')
  }

  const runDir = await resolveRunDirBySelector(repoRoot, selector)
  if (!runDir) {
    throw new Error(`Run not found: ${selector}`)
  }

  const summaries = await collectGateSummaries({ runDir })
  if (summaries.length === 0) {
    console.log('No gate information found')
    return
  }

  const relativeRunDir = path.relative(repoRoot, runDir)
  console.log(`Gate summary (${relativeRunDir}):`)
  for (const line of formatGateSummaries(summaries)) {
    console.log(line)
  }

  const state = await readJsonFile(path.join(runDir, 'state.json'))
  const conversationState = await readConversationSnapshot(runDir)
  const conversationLines = formatConversationStatusLines(conversationState)
  if (conversationLines.length > 0) {
    console.log('\nConversation control:')
    for (const line of conversationLines.slice(1)) {
      console.log(line)
    }
  }
  const taskExecutionLines = formatTaskExecutionProgressLines({
    phaseState: state?.state,
    taskExecution: state?.task_execution,
  })
  if (taskExecutionLines.length > 0) {
    console.log('\nTask execution progress:')
    for (const line of taskExecutionLines) {
      console.log(line)
    }
  }
  if (state?.state === 'FAILED' || state?.state === 'STOPPED_ABORTED') {
    console.log('\nFailure diagnostics:')
    if (typeof state.failed_phase === 'string' && state.failed_phase.trim()) {
      console.log(`failed_phase: ${state.failed_phase}`)
    }
    if (typeof state.failure_reason === 'string' && state.failure_reason.trim()) {
      console.log(`failure_reason: ${state.failure_reason}`)
    }
    const issues = Array.isArray(state.last_blocking_issues) ? state.last_blocking_issues : []
    if (issues.length > 0) {
      console.log('last_blocking_issues:')
      for (const issue of issues) {
        console.log(`- ${issue.id ?? 'unknown'} (${issue.severity ?? 'unknown'}): ${issue.description ?? ''}`)
      }
    }
  }

  const reviewSummaries = await collectLatestReviewSummaries({ runDir })
  if (reviewSummaries.length > 0) {
    console.log('\nLatest review diagnostics:')
    for (const line of formatReviewSummaries(reviewSummaries)) {
      console.log(line)
    }
  }

  const coverageDiagnostics = await collectTaskGraphCoverageDiagnostics({ runDir })
  if (coverageDiagnostics.invalidDocsToUpdate.length > 0) {
    console.log('\nArchitecture docs_to_update format issues:')
    console.log(`invalid_docs_to_update: ${coverageDiagnostics.invalidDocsToUpdate.join(', ')}`)
  }
  if (coverageDiagnostics.missingDocsToUpdate.length > 0) {
    console.log('\nTask-graph coverage gaps:')
    console.log(`missing_docs_to_update: ${coverageDiagnostics.missingDocsToUpdate.join(', ')}`)
  }
  if (coverageDiagnostics.missingDecisionCoverage.length > 0) {
    console.log('\nTask-graph traceability gaps:')
    console.log(`missing_decision_coverage: ${coverageDiagnostics.missingDecisionCoverage.join(', ')}`)
  }
}

export async function listCommand() {
  const repoRoot = await getRepoRoot(process.cwd())
  const runsDir = path.join(repoRoot, RUNS_DIR_NAME)
  if (!(await fileExists(runsDir))) {
    console.log('No runs found')
    return
  }

  const runRoots = await findRunRoots(runsDir)
  if (runRoots.length === 0) {
    console.log('No runs found')
    return
  }

  const states = await Promise.all(
    runRoots.map(async (runDir) => {
      const statePath = path.join(runDir, 'state.json')
      let state = null
      try {
        state = await readJsonFile(statePath)
      } catch {
        // ignore
      }
      return { runDir, state }
    }),
  )

  states.sort((a, b) => {
    const aUpdated = a.state?.updated_at ? Date.parse(a.state.updated_at) || 0 : 0
    const bUpdated = b.state?.updated_at ? Date.parse(b.state.updated_at) || 0 : 0
    return bUpdated - aUpdated
  })

  for (const entry of states) {
    const state = entry.state
    console.log(`${state?.run_id ?? 'unknown'}\t${state?.state ?? 'unknown'}\t${state?.branch_name ?? ''}`)
  }
}

export async function promoteCommand(options) {
  const repoRoot = await getRepoRoot(process.cwd())
  const runsDir = path.join(repoRoot, RUNS_DIR_NAME)
  if (!(await fileExists(runsDir))) {
    console.log('No runs found')
    return
  }

  const runRoots = await findRunRoots(runsDir)
  if (runRoots.length === 0) {
    console.log('No runs found')
    return
  }

  const report = await evaluatePromotionGateFromRunDirs({
    runDirs: runRoots,
    minSampleSize: options.promotion_sample_size ?? 30,
  })

  console.log(JSON.stringify(report, null, 2))
}

export async function doctorCommand(options) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)

  const codexBin = options.codex_bin ?? 'codex'
  const subprocessEnv = buildCodexSubprocessEnv(process.env)

  const checks = []

  try {
    const { stdout } = await execFileAsync(codexBin, ['--version'], { env: subprocessEnv })
    checks.push({ name: 'codex', ok: true, detail: stdout.trim() })
  } catch (error) {
    checks.push({ name: 'codex', ok: false, detail: String(error?.message ?? error) })
  }

  try {
    const support = await detectCodexCliContract({ codexBin, repoRoot: process.cwd() })
    checks.push({
      name: 'codex capabilities',
      ok: support.supported,
      detail: support.supported ? 'required exec flags are available' : `missing: ${support.missingFlags.join(', ')}`,
    })
  } catch (error) {
    checks.push({ name: 'codex capabilities', ok: false, detail: String(error?.message ?? error) })
  }

  try {
    await execFileAsync(codexBin, ['login', 'status'], { env: subprocessEnv })
    checks.push({ name: 'codex login', ok: true, detail: 'authenticated' })
  } catch (error) {
    checks.push({ name: 'codex login', ok: false, detail: String(error?.stderr ?? error?.message ?? error) })
  }

  try {
    const { stdout } = await execFileAsync('node', ['-v'], { env: subprocessEnv })
    checks.push({ name: 'node', ok: true, detail: stdout.trim() })
  } catch (error) {
    checks.push({ name: 'node', ok: false, detail: String(error?.message ?? error) })
  }

  try {
    const { stdout } = await execFileAsync('npm', ['-v'], { env: subprocessEnv })
    checks.push({ name: 'npm', ok: true, detail: stdout.trim() })
  } catch (error) {
    checks.push({ name: 'npm', ok: false, detail: String(error?.message ?? error) })
  }
  console.log('Doctor checks:')
  for (const check of checks) {
    console.log(`- ${check.ok ? 'OK' : 'FAIL'} ${check.name}: ${check.detail}`)
  }
  console.log('\nPatchGantry defaults to workspace-write, web search off, and the strict policy preset.')
  console.log('Use --unsafe-host-access only for repositories and tasks you fully trust.')
  return checks.every((check) => check.ok)
}

function isTerminalState(state) {
  return ['STOPPED_ABORTED', 'STOPPED_BLOCKED', 'FAILED', 'STOPPED_NEEDS_USER_INPUT'].includes(state)
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function sleepWithConversationControl({
  runDir,
  interactionModel = 'phased',
  phaseName = 'pipeline',
  ui,
  ms = 0,
  pollMs = 250,
} = {}) {
  const totalMs = Number.isFinite(ms) ? Math.max(0, ms) : 0
  if (totalMs === 0) {
    return
  }
  if (interactionModel !== 'conversational') {
    await sleep(totalMs)
    return
  }

  const deadline = Date.now() + totalMs
  while (true) {
    await waitForConversationControl({ runDir, phaseName, ui, pollMs })
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      return
    }
    await sleep(Math.min(pollMs, remainingMs))
  }
}

export async function checkpointConversationBoundary({
  runDir,
  interactionModel = 'phased',
  phaseName = 'pipeline',
  boundaryLabel = null,
  ui,
  pollMs = 250,
} = {}) {
  if (interactionModel !== 'conversational') {
    return
  }

  const normalizedBoundaryLabel =
    typeof boundaryLabel === 'string' && boundaryLabel.trim() ? boundaryLabel.trim() : `continuing ${phaseName}`
  await waitForConversationControl({
    runDir,
    phaseName,
    ui,
    pollMs,
    pauseDetail: `Paused before ${normalizedBoundaryLabel}; waiting for /resume.`,
  })

  const state = await readConversationState(runDir)
  const pendingSteers = Array.isArray(state.pending_steering_messages) ? state.pending_steering_messages.length : 0
  if (!state.pending_replan && pendingSteers === 0) {
    return
  }

  await setConversationWaitState(runDir, {
    waitState: 'safe_boundary',
    phaseName,
    detail: `Applying queued conversation updates before ${normalizedBoundaryLabel}.`,
  })

  try {
    await applyConversationUpdatesAtSafeBoundary({ runDir, phaseName, ui })
  } finally {
    await setConversationWaitState(runDir, { waitState: null })
  }
}

async function runInterruptibleShellCommand({
  command,
  cwd,
  logPath,
  env,
  timeoutMs,
  maxCaptureBytes,
  runDir,
  phaseName,
  ui,
  interactionModel = 'phased',
  interactionContext = null,
}) {
  while (true) {
    let interruptController = null
    try {
      if (interactionModel === 'conversational') {
        await waitForConversationControl({ runDir, phaseName, ui })
        await applyConversationUpdatesAtSafeBoundary({ runDir, phaseName, ui })
        interruptController = new AbortController()
        if (interactionContext) {
          interactionContext.currentInterruptController = interruptController
        }
        await setActiveConversationCommand(runDir, { command, phaseName })
      }

      return await runShellCommand({
        command,
        cwd,
        env: env ?? buildCodexSubprocessEnv(process.env),
        logPath,
        timeoutMs,
        maxCaptureBytes,
        interruptSignal: interruptController?.signal ?? null,
      })
    } catch (error) {
      if (error instanceof ShellCommandInterruptedError && interactionModel === 'conversational') {
        const state = await readConversationState(runDir)
        if (state.control_state === 'aborted') {
          throw new RunAbortedError(
            state.abort_reason ?? 'Run aborted from conversational control command.',
            phaseName,
          )
        }
        if (state.control_state === 'paused') {
          await waitForConversationControl({ runDir, phaseName, ui })
        }
        const reason =
          state.control_state === 'paused'
            ? 'pause'
            : state.pending_replan
              ? 'replan'
              : Array.isArray(state.pending_steering_messages) && state.pending_steering_messages.length > 0
                ? 'steering'
                : 'interrupt'
        ui?.log?.(`phase:${phaseName} shell command interrupted by ${reason}; restarting command`)
        continue
      }
      throw error
    } finally {
      if (interactionContext?.currentInterruptController === interruptController) {
        interactionContext.currentInterruptController = null
      }
      if (interactionModel === 'conversational') {
        await setActiveConversationCommand(runDir, { command: null })
      }
    }
  }
}

async function readConversationSnapshot(runDir) {
  const conversationStatePath = path.join(runDir, 'conversation-state.json')
  if (!(await fileExists(conversationStatePath))) {
    return null
  }

  const state = await readConversationState(runDir)
  return state.interaction_model === 'conversational' ? state : null
}

async function initializeLiveInteractionCapability({ codexBin, repoRoot, runDir, ui }) {
  try {
    const capability = await detectCodexLiveInteractionSupport({ codexBin, repoRoot })
    await setLiveInteractionCapability(runDir, capability)
    if (!capability.supported) {
      ui?.log?.(
        `conversation: true live in-place codex steering unavailable; using ${capability.mode} (${capability.blockers.join(', ')})`,
      )
    }
  } catch (error) {
    const summary = 'Live interaction capability probe failed; using interrupt-and-replay.'
    await setLiveInteractionCapability(runDir, {
      supported: false,
      mode: 'interrupt-replay',
      summary,
      blockers: ['capability_probe_failed'],
      cliVersion: null,
    })
    ui?.log?.(`conversation: ${summary} ${error?.message ?? String(error)}`)
  }
}

function formatConversationStatusLines(conversationState) {
  if (!conversationState) {
    return []
  }

  return [
    'Conversation control:',
    `interaction_model: ${conversationState.interaction_model}`,
    `conversation_state: ${conversationState.conversation_state}`,
    `control_state: ${conversationState.control_state}`,
    `active_phase: ${conversationState.active_phase ?? 'none'}`,
    `active_session_id: ${conversationState.active_session_id ?? 'none'}`,
    `active_command: ${conversationState.active_command ?? 'none'}`,
    `active_command_phase: ${conversationState.active_command_phase ?? 'none'}`,
    `waiting_state: ${conversationState.waiting_state ?? 'none'}`,
    `waiting_phase: ${conversationState.waiting_phase ?? 'none'}`,
    `waiting_detail: ${conversationState.waiting_detail ?? 'none'}`,
    `terminal_broker_state: ${conversationState.terminal_broker_state ?? 'none'}`,
    `live_interaction_supported: ${
      typeof conversationState.live_interaction_supported === 'boolean'
        ? conversationState.live_interaction_supported
          ? 'yes'
          : 'no'
        : 'unknown'
    }`,
    `live_interaction_mode: ${conversationState.live_interaction_mode ?? 'none'}`,
    `live_interaction_summary: ${conversationState.live_interaction_summary ?? 'none'}`,
    `live_interaction_blockers: ${
      Array.isArray(conversationState.live_interaction_blockers) && conversationState.live_interaction_blockers.length > 0
        ? conversationState.live_interaction_blockers.join(', ')
        : 'none'
    }`,
    `live_interaction_checked_at: ${conversationState.live_interaction_checked_at ?? 'none'}`,
    `live_interaction_cli_version: ${conversationState.live_interaction_cli_version ?? 'none'}`,
    `pending_steers: ${Array.isArray(conversationState.pending_steering_messages) ? conversationState.pending_steering_messages.length : 0}`,
    `pending_replan: ${conversationState.pending_replan ? 'yes' : 'no'}`,
    `last_control_command: ${conversationState.last_control_command ?? 'none'}`,
    `abort_reason: ${conversationState.abort_reason ?? 'none'}`,
  ]
}

async function applyConversationUpdatesAtSafeBoundary({ runDir, phaseName, ui } = {}) {
  const state = await readConversationState(runDir)
  const pendingSteers = Array.isArray(state.pending_steering_messages) ? state.pending_steering_messages.length : 0
  if (!state.pending_replan && pendingSteers === 0) {
    return state
  }

  const consumedSteeringMessages = await consumePendingSteeringMessages(runDir)
  const consumedReplan = await consumePendingReplanRequest(runDir)
  const reason = consumedReplan ? 'replan' : 'steering'
  ui?.log?.(
    `phase:${phaseName} applying queued conversation updates at safe boundary (${reason}${consumedSteeringMessages.length > 0 ? `, messages=${consumedSteeringMessages.length}` : ''})`,
  )
  return await readConversationState(runDir)
}

async function waitForConversationControl({ runDir, phaseName, ui, pollMs = 250, pauseDetail = null } = {}) {
  let loggedPause = false
  while (true) {
    const state = await readConversationState(runDir)
    if (state.control_state === 'aborted') {
      if (loggedPause) {
        await setConversationWaitState(runDir, { waitState: null })
      }
      throw new RunAbortedError(state.abort_reason ?? 'Run aborted from conversational control command.', phaseName)
    }
    if (state.control_state !== 'paused') {
      if (loggedPause) {
        ui?.log?.(`phase:${phaseName} resumed`)
        await setConversationWaitState(runDir, { waitState: null })
      }
      return state
    }
    if (!loggedPause) {
      await setConversationWaitState(runDir, {
        waitState: 'paused',
        phaseName,
        detail:
          typeof pauseDetail === 'string' && pauseDetail.trim()
            ? pauseDetail.trim()
            : `Paused before continuing ${phaseName}; waiting for /resume.`,
      })
      ui?.log?.(`phase:${phaseName} paused; waiting for /resume`)
      loggedPause = true
    }
    await sleep(pollMs)
  }
}

async function loadUserInputContext(runDir) {
  const [userAnswers, openQuestions] = await Promise.all([readUserAnswers(runDir), readOpenQuestions(runDir)])
  const userAnswerDirectives = parseAnswerDirectives(userAnswers)
  return { userAnswers, userAnswerDirectives, openQuestions }
}

function validateStructuredAnswerCount(answers, questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return []
  }
  if (!Array.isArray(answers)) {
    return ['Structured answers are missing or invalid.']
  }
  if (answers.length < questions.length) {
    return [
      `Expected answers for ${questions.length} questions; received ${answers.length}. Fill every entry in the JSON answers array.`,
    ]
  }
  return []
}

async function waitForUserAnswers({ runDir, questions, ui, options }) {
  const answersPath = await ensureAnswersTemplate(runDir, questions ?? [])
  const relativePath = path.relative(process.cwd(), answersPath)
  const answersMode = resolveAnswersMode({ requestedMode: options?.answers_mode })
  ui?.log?.(`waiting for user answers in ${relativePath} (${answersMode})`)
  const interactionContext = options?.interaction_context ?? null
  const conversationalMode = options?.interaction_model === 'conversational'
  const normalizedQuestions = extractQuestionTexts(questions)

  if (conversationalMode && normalizedQuestions.length > 0) {
    await setPendingQuestion(runDir, {
      phase: interactionContext?.pendingQuestionPhase ?? null,
      questions: normalizedQuestions,
    })
    await setConversationWaitState(runDir, {
      waitState: answersMode === 'console' ? 'console_answers' : 'file_answers',
      phaseName: interactionContext?.pendingQuestionPhase ?? 'answers',
      detail:
        answersMode === 'console'
          ? 'Waiting for blocking console answers; terminal broker is suspended during prompt capture.'
          : `Waiting for blocking answers in ${relativePath}.`,
    })
  }

  try {
    while (true) {
      const cursor = await readAnswersCursor(runDir)
      const { answers, nextCursor, issues } = await readUserAnswersDelta(runDir, cursor)
      if (issues && issues.length > 0) {
        ui?.log?.('answers format rejected:')
        for (const issue of issues) {
          ui?.log?.(`- ${issue}`)
        }
        if (nextCursor?.hash) {
          await writeAnswersCursor(runDir, nextCursor)
        }
        if (answersMode !== 'console') {
          await sleepWithConversationControl({
            runDir,
            interactionModel: options?.interaction_model ?? 'phased',
            phaseName: interactionContext?.pendingQuestionPhase ?? 'answers',
            ui,
            ms: 2000,
          })
        }
        continue
      }
      if (answers) {
        const parsed = parseStructuredAnswers(answers)
        const countIssues = validateStructuredAnswerCount(parsed.answers, questions)
        if (parsed.issues.length > 0 || countIssues.length > 0) {
          ui?.log?.('answers rejected:')
          for (const issue of [...parsed.issues, ...countIssues]) {
            ui?.log?.(`- ${issue}`)
          }
          if (nextCursor?.hash) {
            await writeAnswersCursor(runDir, nextCursor)
          }
          if (answersMode !== 'console') {
            await sleepWithConversationControl({
              runDir,
              interactionModel: options?.interaction_model ?? 'phased',
              phaseName: interactionContext?.pendingQuestionPhase ?? 'answers',
              ui,
              ms: 2000,
            })
          }
          continue
        }
        await writeAnswersCursor(runDir, nextCursor)
        return answers
      }
      if (answersMode === 'console') {
        interactionContext?.terminalBroker?.suspend?.()
        const response = await promptForConsoleAnswers({ questions, ui })
        interactionContext?.terminalBroker?.resume?.()
        if (response) {
          const parsed = parseStructuredAnswers(response)
          for (const answer of parsed.answers ?? []) {
            if (typeof answer === 'string') {
              await recordAnswerMessage(runDir, { text: answer, source: 'terminal' })
            }
          }
          await appendUserAnswers(runDir, response, questions ?? [])
          const updated = await readUserAnswersDelta(runDir, { hash: null })
          await writeAnswersCursor(runDir, updated.nextCursor)
          return response
        }
      } else {
        await sleepWithConversationControl({
          runDir,
          interactionModel: options?.interaction_model ?? 'phased',
          phaseName: interactionContext?.pendingQuestionPhase ?? 'answers',
          ui,
          ms: 2000,
        })
      }
    }
  } finally {
    if (conversationalMode) {
      await clearPendingQuestion(runDir)
      await setConversationWaitState(runDir, { waitState: null })
    }
    interactionContext?.terminalBroker?.resume?.()
  }
}

async function buildPromptTextWithConversation({ promptText, runDir, interactionModel }) {
  if (interactionModel !== 'conversational') {
    return promptText
  }
  const suffix = await buildConversationPromptSuffix(runDir)
  if (!suffix) {
    return promptText
  }
  return `${promptText}\n\n${suffix}`
}

function resolveTaskGraphBudgets(options) {
  const resolved = { ...DEFAULT_TASK_GRAPH_BUDGETS }
  if (Number.isFinite(options?.task_graph_max_files_per_task)) {
    resolved.max_files_per_task = options.task_graph_max_files_per_task
  }
  if (Number.isFinite(options?.task_graph_max_acceptance_criteria_per_task)) {
    resolved.max_acceptance_criteria_per_task = options.task_graph_max_acceptance_criteria_per_task
  }
  if (Number.isFinite(options?.task_graph_max_description_chars)) {
    resolved.max_description_chars = options.task_graph_max_description_chars
  }
  if (Number.isFinite(options?.task_graph_max_verification_commands_per_task)) {
    resolved.max_verification_commands_per_task = options.task_graph_max_verification_commands_per_task
  }
  return resolved
}

async function copyPhaseArtifacts({ fromDir, toDir }) {
  await ensureDir(toDir)
  const filenames = ['prompt.txt', 'events.jsonl', 'events.raw.jsonl', 'stderr.log', 'meta.json', 'output.json']
  for (const filename of filenames) {
    const fromPath = path.join(fromDir, filename)
    if (!(await fileExists(fromPath))) {
      continue
    }
    const toPath = path.join(toDir, filename)
    await copyFile(fromPath, toPath)
    await chmod(toPath, 0o600)
  }
}

async function runTaskGraphWithBudgetLoop({
  repoRoot,
  runId,
  runDir,
  taskText,
  analysis,
  architecture,
  planningContext,
  taskGraphPhaseDir,
  reviewFeedback,
  policy,
  manifest,
  options,
  ui,
  force,
  resumePhaseSubstateIndex = null,
}) {
  const budgets = resolveTaskGraphBudgets(options)
  const constraintsText = formatTaskGraphBudgetConstraints(budgets)
  const taskTests = options?.task_tests ?? options?.tests
  const requiredVerificationCommands = [taskTests].filter(Boolean)

  const cached = await maybeLoadCachedPhase({ phaseDir: taskGraphPhaseDir, force: Boolean(force) })
  if (cached) {
    const enforcedCached = ensureTaskGraphVerificationCommands(cached, requiredVerificationCommands)
    const cachedGraph = enforcedCached.taskGraph
    if (enforcedCached.changed) {
      await writeJsonFile(path.join(taskGraphPhaseDir, 'output.json'), cachedGraph)
    }
    const cachedBudgetValidation = validateTaskGraphBudgets(cachedGraph, budgets)
    if (cachedBudgetValidation.ok) {
      ui?.log?.(`phase:task_graph cached (within budgets)`)
      updatePhase(manifest, 'task_graph', { status: 'cached', output_path: path.join(taskGraphPhaseDir, 'output.json') })
      return cachedGraph
    }
  }

  let feedback = ''
  if (cached) {
    const enforcedCached = ensureTaskGraphVerificationCommands(cached, requiredVerificationCommands)
    const cachedGraph = enforcedCached.taskGraph
    if (enforcedCached.changed) {
      await writeJsonFile(path.join(taskGraphPhaseDir, 'output.json'), cachedGraph)
    }
    const cachedBudgetValidation = validateTaskGraphBudgets(cachedGraph, budgets)
    feedback = formatTaskGraphBudgetFeedback(cachedBudgetValidation.violations)
  }

  const maxAttempts = Number.isFinite(options?.max_task_graph_attempts) ? options.max_task_graph_attempts : 7
  const attemptsRootDir = path.join(taskGraphPhaseDir, 'attempts')
  await ensureDir(attemptsRootDir)
  const existingAttemptEntries = await readdir(attemptsRootDir, { withFileTypes: true })
  const existingAttemptNumbers = existingAttemptEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseInt(entry.name, 10))
    .filter((value) => Number.isFinite(value))
  const attemptOffset = existingAttemptNumbers.length > 0 ? Math.max(...existingAttemptNumbers) : 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const globalAttempt = attemptOffset + attempt
    const attemptPhaseName = `task_graph/attempt-${globalAttempt}`
    await checkpointConversationBoundary({
      runDir,
      interactionModel: options?.interaction_model ?? 'phased',
      phaseName: 'task_graph',
      boundaryLabel: `starting task graph budget attempt ${globalAttempt}`,
      ui,
    })
    const attemptDir = path.join(attemptsRootDir, String(globalAttempt))
    const userInput = await loadUserInputContext(runDir)

    ui?.log?.(`phase:task_graph attempt ${attempt}/${maxAttempts} (global=${globalAttempt}) starting (dir=${attemptDir})`)
    let promptVariables
    try {
      promptVariables = {
        TASK: taskText.trim(),
        ANALYSIS_JSON: renderPromptJsonText(analysis, {
          options,
          label: 'ANALYSIS_JSON',
          phaseName: 'task_graph',
          failOnTruncation: true,
        }),
        ARCH_JSON: renderPromptJsonText(architecture, {
          options,
          label: 'ARCH_JSON',
          phaseName: 'task_graph',
          failOnTruncation: true,
        }),
        PLANNING_CONTEXT_JSON: renderPromptJsonText(planningContext ?? {}, {
          options,
          label: 'PLANNING_CONTEXT_JSON',
          phaseName: 'task_graph',
          failOnTruncation: true,
        }),
        PLANNER_CONSTRAINTS: constraintsText,
        PLANNER_FEEDBACK: feedback,
        REVIEW_FEEDBACK: reviewFeedback ?? '',
        USER_ANSWERS: userInput.userAnswers,
        USER_ANSWERS_DIRECTIVES: renderPromptJsonText(userInput.userAnswerDirectives ?? {}, {
          options,
          label: 'USER_ANSWERS_DIRECTIVES',
          phaseName: 'task_graph',
          failOnTruncation: true,
        }),
        OPEN_QUESTIONS: userInput.openQuestions,
        TEST_COMMAND: taskTests ?? '',
      }
    } catch (error) {
      if (error instanceof PromptContextTruncationError) {
        await markRunFailed(runDir, { phase: 'task_graph', error })
      }
      throw error
    }

    const taskGraphAttempt = await runOrLoadPhase({
      phaseName: attemptPhaseName,
      phaseDir: attemptDir,
      promptFile: path.join(PROMPTS_DIR, '02-task-graph.md'),
      schemaFile: path.join(SCHEMAS_DIR, 'task-graph.schema.json'),
      promptVariables,
      sandbox: resolveReadOnlyPhaseSandbox(options),
      codexBin: options.codex_bin,
      repoRoot,
      search: options.search,
      noRedact: options.no_redact,
      policy,
      policyAllowlistMode: options.policy_allowlist_mode,
      maxPolicyGuidanceRetries: options.max_review_fix_attempts,
      manifest,
      runDir,
      runId,
      force,
      attempt: globalAttempt,
      resumePhaseSubstateIndex,
      interactionContext: options?.interaction_context ?? null,
      ui,
    })

    const enforcedAttempt = ensureTaskGraphVerificationCommands(taskGraphAttempt, requiredVerificationCommands)
    const enforcedTaskGraph = enforcedAttempt.taskGraph
    if (enforcedAttempt.changed) {
      await writeJsonFile(path.join(attemptDir, 'output.json'), enforcedTaskGraph)
    }

    await copyPhaseArtifacts({ fromDir: attemptDir, toDir: taskGraphPhaseDir })
    updatePhase(manifest, 'task_graph', { status: 'completed', output_path: path.join(taskGraphPhaseDir, 'output.json') })

    if (enforcedTaskGraph?.gate?.status !== 'pass') {
      return enforcedTaskGraph
    }

    const budgetValidation = validateTaskGraphBudgets(enforcedTaskGraph, budgets)
    if (budgetValidation.ok) {
      return enforcedTaskGraph
    }

    feedback = formatTaskGraphBudgetFeedback(budgetValidation.violations)
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: 'task_graph',
      loop: 'task_graph_budget_replan',
      attempt,
      budget: maxAttempts,
      retryFamily: 'task_graph_budget_replan',
    })
    ui?.log?.(`phase:task_graph attempt ${attempt} (global=${globalAttempt}) exceeded budgets; replanning`)
  }

  await markRunFailed(runDir, {
    phase: 'task_graph',
    error: `Task graph did not satisfy budgets after ${maxAttempts} attempt(s).`,
  })
  throw new Error(`Task graph did not satisfy budgets after ${maxAttempts} attempt(s).`)
}

function formatTaskGraphOverview(taskGraph) {
  const order = Array.isArray(taskGraph?.execution_order) ? taskGraph.execution_order : []
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : []
  const titles = new Map()
  for (const task of tasks) {
    if (typeof task?.id !== 'string' || !task.id) {
      continue
    }
    if (typeof task?.title === 'string' && task.title.trim()) {
      titles.set(task.id, task.title.trim())
    }
  }

  if (order.length === 0 && tasks.length === 0) {
    return '(no tasks)'
  }

  const ids = order.length > 0 ? order : tasks.map((task) => task?.id).filter(Boolean)
  return ids
    .map((id, index) => {
      const title = titles.get(id)
      return `${index + 1}. ${id}${title ? ` — ${title}` : ''}`
    })
    .join('\n')
}

function formatWorkerContextBrief({ analysis, architecture }) {
  const lines = []

  const repoSummary = analysis?.repo_context_summary
  if (typeof repoSummary === 'string' && repoSummary.trim()) {
    lines.push(`Repo context: ${repoSummary.trim()}`)
  }

  const archSummary = architecture?.architecture_summary
  if (typeof archSummary === 'string' && archSummary.trim()) {
    lines.push(`Architecture: ${archSummary.trim()}`)
  }

  const risks = Array.isArray(analysis?.risks) ? analysis.risks : []
  const highRisks = risks.filter((risk) => risk?.severity === 'high')
  if (highRisks.length > 0) {
    lines.push('High risks to keep in mind:')
    for (const risk of highRisks.slice(0, 5)) {
      lines.push(`- (${risk.domain}) ${risk.description}`)
    }
  }

  const decisions = Array.isArray(architecture?.decisions) ? architecture.decisions : []
  if (decisions.length > 0) {
    lines.push('Key architecture decisions:')
    for (const decision of decisions.slice(0, 5)) {
      lines.push(`- ${decision.decision}`)
    }
  }

  return lines.length > 0 ? lines.join('\n') : '(no additional context)'
}

function extractWorkerQuestions(output) {
  return extractQuestionTexts(extractWorkerQuestionPayloads(output))
}

function extractWorkerQuestionPayloads(output) {
  const explicit = extractQuestionTexts(output?.questions)
  if (explicit.length > 0 && Array.isArray(output?.questions)) {
    return output.questions
  }
  if (Array.isArray(output?.followups)) {
    return output.followups
  }
  return []
}

class VerificationError extends Error {
  constructor(message, { command, logPath }) {
    super(message)
    this.name = 'VerificationError'
    this.command = command
    this.logPath = logPath
  }
}

function reviewRequiresFix(review) {
  return review?.verdict !== 'approve'
}

function formatReviewFeedback(review) {
  return jsonStringifyForPrompt(review ?? {})
}

class PromptContextTruncationError extends Error {
  constructor(message, { phaseName, label, originalChars, maxChars }) {
    super(message)
    this.name = 'PromptContextTruncationError'
    this.phaseName = phaseName
    this.label = label
    this.originalChars = originalChars
    this.maxChars = maxChars
  }
}

function resolvePromptJsonMaxChars(options) {
  if (Number.isFinite(options?.prompt_json_max_chars)) {
    return options.prompt_json_max_chars
  }
  return DEFAULT_PROMPT_JSON_MAX_CHARS
}

function renderPromptJsonText(value, { options, label, phaseName, failOnTruncation = false } = {}) {
  const rendered = renderJsonForPrompt(value, { maxChars: resolvePromptJsonMaxChars(options), label })
  if (failOnTruncation && rendered.truncated) {
    throw new PromptContextTruncationError(
      `Prompt context truncated in ${phaseName} for ${label} (${rendered.originalChars} > ${rendered.maxChars})`,
      {
        phaseName,
        label: rendered.label,
        originalChars: rendered.originalChars,
        maxChars: rendered.maxChars,
      },
    )
  }
  return rendered.text
}

function renderPromptText(value, { options, label } = {}) {
  const rendered = renderTextForPrompt(value, { maxChars: resolvePromptJsonMaxChars(options), label })
  return rendered.text
}

function buildVerificationFeedback({ command, logPath, logText, diffSummary, options }) {
  const raw = [
    `Verification failed for: ${command ?? 'unknown command'}`,
    `Log: ${logPath ?? 'N/A'}`,
    logText?.trim() ?? '',
    `Diff summary: ${diffSummary ?? ''}`,
  ]
    .filter(Boolean)
    .join('\n')

  return renderPromptText(raw, { options, label: 'VERIFICATION_FEEDBACK' })
}

function getBaselineSkipFlags(options) {
  const skipFlagKeys = ['fast', 'skip_baseline', 'skipBaseline', 'skip_verification', 'skipVerification']
  return skipFlagKeys.filter((key) => Boolean(options?.[key]))
}

function buildBaselineVerificationFallback() {
  return {
    passed: true,
    commands_run: [],
    results: [],
    known_failures: [],
  }
}

async function resolveVerificationCommandPlanForRepo(repoRoot, options) {
  const finalTestsCommand = options.final_tests ?? options.tests
  const coverageCommand = options.coverage ? await resolveCoverageCommand(repoRoot) : null

  return buildVerificationCommandPlan({
    finalTestsCommand,
    coverageEnabled: Boolean(options.coverage),
    coverageCommand,
    auditEnabled: Boolean(options.audit),
  })
}

function buildRuntimeConfigSnapshot(options) {
  return {
    model: options?.model ?? null,
    reasoning_effort: options?.effort ?? null,
    sandbox: options?.sandbox ?? 'workspace-write',
    unsafe_host_access: Boolean(options?.unsafe_host_access),
    search_enabled: Boolean(options?.search),
    mode: options?.mode ?? 'autonomous',
    interaction_model: options?.interaction_model ?? 'phased',
    execution_profile: options?.execution_profile ?? 'standard',
    review_mode: options?.review_mode ?? 'balanced',
    reviewer_independence: options?.reviewer_independence ?? 'linked',
    policy: options?.policy ?? 'strict',
    policy_allowlist_mode: options?.policy_allowlist_mode ?? 'monitor',
    worktree_enabled: Boolean(options?.worktree),
    worktree_deps: options?.worktree_deps ?? 'none',
    copy_env_files: Boolean(options?.copy_env_files),
    task_tests: options?.task_tests ?? options?.tests ?? 'npm test',
    final_tests: options?.final_tests ?? options?.tests ?? 'npm test',
    coverage_enabled: Boolean(options?.coverage),
    coverage_floor: options?.coverage_floor ?? 40,
    audit_enabled: Boolean(options?.audit),
    max_fix_attempts: options?.max_fix_attempts ?? 5,
    max_worker_attempts: options?.max_worker_attempts ?? 3,
    max_task_graph_attempts: options?.max_task_graph_attempts ?? 7,
    max_review_fix_attempts: options?.max_review_fix_attempts,
    max_review_diff_growth_lines: options?.max_review_diff_growth_lines ?? 1200,
    prompt_json_max_chars: resolvePromptJsonMaxChars(options),
  }
}

function resolveReadOnlyPhaseSandbox(options) {
  return options?.sandbox === 'danger-full-access' ? 'danger-full-access' : 'read-only'
}

function formatLogPaths(paths) {
  if (!paths || paths.length === 0) {
    return 'N/A'
  }
  return paths.join('\n')
}

function createSkippedReviewResult(reviewMode) {
  return {
    verdict: 'approve',
    summary: `Review skipped by review mode (${reviewMode}).`,
    scope_alignment: {
      status: 'match',
      notes: `Skipped by review mode (${reviewMode}).`,
    },
    rubric: {
      security: { status: 'na', notes: 'Skipped by review mode.' },
      functionality: { status: 'na', notes: 'Skipped by review mode.' },
      simplicity: { status: 'na', notes: 'Skipped by review mode.' },
      speed: { status: 'na', notes: 'Skipped by review mode.' },
      quality: { status: 'na', notes: 'Skipped by review mode.' },
      gdpr: { status: 'na', notes: 'Skipped by review mode.' },
    },
    changes_since_last_review: 'initial review',
    verification_summary: 'not run',
    blocking_issues: [],
    non_blocking_suggestions: [],
    docs_impact: [],
    security_privacy_concerns: [],
  }
}

function normalizeFailureReason(errorOrMessage) {
  if (typeof errorOrMessage === 'string' && errorOrMessage.trim()) {
    return errorOrMessage.trim().slice(0, 2000)
  }
  if (errorOrMessage && typeof errorOrMessage.message === 'string' && errorOrMessage.message.trim()) {
    return errorOrMessage.message.trim().slice(0, 2000)
  }
  return 'Unknown orchestrator failure'
}

function normalizeBlockingIssuesForState(blockingIssues) {
  if (!Array.isArray(blockingIssues)) {
    return []
  }
  return blockingIssues
    .map((issue) => {
      if (!issue || typeof issue !== 'object') {
        return null
      }
      const id = typeof issue.id === 'string' ? issue.id.trim() : ''
      const severity = typeof issue.severity === 'string' ? issue.severity.trim() : ''
      const file = typeof issue.file === 'string' ? issue.file.trim() : ''
      const description = typeof issue.description === 'string' ? issue.description.trim() : ''
      const suggestedFix = typeof issue.suggested_fix === 'string' ? issue.suggested_fix.trim() : ''
      if (!id || !description) {
        return null
      }
      return {
        id,
        severity: severity || 'unknown',
        file: file || 'N/A',
        description,
        suggested_fix: suggestedFix || 'N/A',
      }
    })
    .filter(Boolean)
    .slice(0, 10)
}

async function markRunFailed(runDir, { phase = null, error, blockingIssues } = {}) {
  const patch = {
    state: 'FAILED',
    final_status: 'failed',
    failure_reason: normalizeFailureReason(error),
    failed_phase: phase || 'unknown',
  }
  const normalizedIssues = normalizeBlockingIssuesForState(blockingIssues)
  if (normalizedIssues.length > 0) {
    patch.last_blocking_issues = normalizedIssues
  }
  await updateState(runDir, patch)
}

async function markRunAborted(runDir, { phase = null, error } = {}) {
  await updateState(runDir, {
    state: 'STOPPED_ABORTED',
    final_status: 'failed',
    failure_reason: normalizeFailureReason(error),
    failed_phase: phase || 'pipeline',
  })
}

async function markRunFailedIfNeeded(runDir, error, phase) {
  let current = null
  try {
    current = await readState(runDir)
  } catch {
    current = null
  }
  if (current?.state === 'FAILED') {
    return
  }
  if (NON_FAILURE_STATES.has(current?.state)) {
    return
  }
  await markRunFailed(runDir, { phase, error })
}

function buildArchitectureDocsFormatIssue({ repoRoot, architecturePhaseDir, invalidEntries }) {
  const issueId = 'ARCH-DOCS-001'
  return {
    id: issueId,
    severity: 'medium',
    file: path.relative(repoRoot, path.join(architecturePhaseDir, 'output.json')),
    description:
      'architecture.docs_to_update must contain workspace-relative file paths only, but one or more entries are malformed.',
    suggested_fix:
      `Replace malformed docs_to_update entries with plain paths only: ${invalidEntries.join(', ')}`,
  }
}

async function getDiffSummary(repoRoot, baseSha, headSha = 'HEAD') {
  if (!baseSha) {
    return { summary: 'N/A', stats: parseNumstat('') }
  }
  const range = `${baseSha}..${headSha}`
  const numstat = await git(repoRoot, ['diff', '--numstat', range], { allowFailure: true })
  const stats = parseNumstat(numstat)
  const shortstat = await git(repoRoot, ['diff', '--shortstat', range], { allowFailure: true })
  const summary = shortstat.trim() ? shortstat.trim() : '(no diff)'
  return { summary, stats }
}

async function runReviewPhase({
  repoRoot,
  runDir,
  runId,
  reviewTarget,
  taskText,
  baseSha,
  stepOutputPath,
  task,
  taskDir,
  verificationLogPaths,
  diffSummary,
  previousReview,
  reviewPhaseName,
  reviewPhaseDir,
  attempt,
  extraPromptVariables = {},
  options,
  policy,
  manifest,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  if (!shouldRunReviewPhase({ reviewMode: options.review_mode, reviewTarget })) {
    ui?.log?.(`phase:${reviewPhaseName} skipped (review-mode=${options.review_mode})`)
    updatePhase(manifest, reviewPhaseName, {
      status: 'skipped',
      skipped_reason: `review-mode:${options.review_mode}`,
    })
    await writeManifest(path.join(runDir, 'manifest.json'), manifest)
    const skipped = createSkippedReviewResult(options.review_mode)
    await logPhaseSubstate({
      runDir,
      manifest,
      runId,
      phase: reviewPhaseName,
      substate: 'phase_review_completed',
      attempt,
      reviewTarget,
      verdict: skipped.verdict,
    })
    return skipped
  }

  const attemptDir = path.join(reviewPhaseDir, 'attempts', String(attempt))
  let promptVariables
  try {
    promptVariables = {
      TASK: taskText.trim(),
      REVIEW_TARGET: reviewTarget,
      REVIEWER_INDEPENDENCE_MODE: options.reviewer_independence,
      BASE_SHA: baseSha ?? 'N/A',
      STEP_OUTPUT_PATH: stepOutputPath ?? 'N/A',
      TASK_JSON: task
        ? renderPromptJsonText(task, {
            options,
            label: 'TASK_JSON',
            phaseName: reviewPhaseName,
            failOnTruncation: true,
          })
        : 'N/A',
      TASK_DIR: taskDir ?? 'N/A',
      VERIFICATION_LOG_PATHS: formatLogPaths(verificationLogPaths),
      DIFF_SUMMARY: diffSummary ?? 'N/A',
      PREVIOUS_REVIEW_JSON: previousReviewPromptValue({
        previousReview,
        reviewerIndependence: options.reviewer_independence,
        renderPreviousReview: (value) =>
          renderPromptJsonText(value, {
            options,
            label: 'PREVIOUS_REVIEW_JSON',
            phaseName: reviewPhaseName,
            failOnTruncation: true,
          }),
      }),
      ...extraPromptVariables,
    }
  } catch (error) {
    if (error instanceof PromptContextTruncationError) {
      await markRunFailed(runDir, { phase: reviewPhaseName, error })
    }
    throw error
  }

  const review = await runOrLoadPhase({
    phaseName: `${reviewPhaseName}/attempt-${attempt}`,
    phaseDir: attemptDir,
    promptFile: getReviewPromptFile({ reviewTarget, promptsDir: PROMPTS_DIR }),
    schemaFile: path.join(SCHEMAS_DIR, 'review.schema.json'),
    promptVariables,
    sandbox: resolveReadOnlyPhaseSandbox(options),
    codexBin: options.codex_bin,
    repoRoot,
    search: options.search,
    noRedact: options.no_redact,
    policy,
    policyAllowlistMode: options.policy_allowlist_mode,
    maxPolicyGuidanceRetries: options.max_review_fix_attempts,
    manifest,
    runDir,
    runId,
    force: true,
    attempt,
    resumePhaseSubstateIndex,
    interactionContext: options?.interaction_context ?? null,
    ui,
  })
  await logPhaseSubstate({
    runDir,
    manifest,
    runId,
    phase: reviewPhaseName,
    substate: 'phase_review_completed',
    attempt,
    reviewTarget,
    verdict: review?.verdict ?? null,
  })
  return review
}

function logGateStatus({ ui, phaseName, gate }) {
  if (!ui?.log) return
  const status = gate?.status ?? 'unknown'
  ui.log(`phase:${phaseName} gate.status=${status}`)

  const reasons = Array.isArray(gate?.reasons) ? gate.reasons : []
  for (const reason of reasons) {
    if (typeof reason === 'string' && reason.trim()) {
      ui.log(`phase:${phaseName} gate.reason=${reason.trim()}`)
    }
  }
}

function formatGateReasons(gate) {
  const reasons = Array.isArray(gate?.reasons) ? gate.reasons : []
  if (reasons.length === 0) {
    return '(none)'
  }
  return reasons.map((reason) => `- ${reason}`).join('\n')
}

function mergePlanningContextWithDiff(planningContext, update) {
  const before = {
    assumptions: new Set(planningContext.assumptions ?? []),
    mitigations: new Set(planningContext.mitigations ?? []),
    task_hints: new Set(planningContext.task_hints ?? []),
    notes: new Set(planningContext.notes ?? []),
  }

  mergePlanningContext(planningContext, update)

  return {
    assumptions: (planningContext.assumptions ?? []).filter((item) => !before.assumptions.has(item)),
    mitigations: (planningContext.mitigations ?? []).filter((item) => !before.mitigations.has(item)),
    task_hints: (planningContext.task_hints ?? []).filter((item) => !before.task_hints.has(item)),
    notes: (planningContext.notes ?? []).filter((item) => !before.notes.has(item)),
  }
}

function buildBlockingQuestionPrecheckAssumption(question) {
  const assumedAnswer =
    typeof question?.assumed_answer === 'string' && question.assumed_answer.trim()
      ? question.assumed_answer.trim()
      : 'Assumed safest compliant default until user confirmation.'
  return `[${question.id}] ${question.question} -> ${assumedAnswer}`
}

function buildBlockingQuestionPrecheckMitigation(question) {
  if (typeof question?.mitigation === 'string' && question.mitigation.trim()) {
    return `[${question.id}] ${question.mitigation.trim()}`
  }
  return `[${question.id}] Confirm and replace the assumption before final merge.`
}

async function runBlockingQuestionPrecheckPhase({
  runDir,
  runId,
  analysis,
  options,
  manifest,
  ui,
}) {
  const phaseName = 'blocking_question_precheck'
  const phaseDir = path.join(runDir, 'phases', phaseName)
  await ensureDir(phaseDir)
  updatePhase(manifest, phaseName, { status: 'running', started_at: new Date().toISOString() })
  await writeManifest(path.join(runDir, 'manifest.json'), manifest)

  const blockingQuestions = extractBlockingPrecheckQuestions(analysis?.gate?.questions)
  const blockingQuestionTexts = blockingQuestions.map((question) => question.question)
  addOpenQuestions(manifest, blockingQuestionTexts)
  await appendMarkdown(path.join(runDir, 'open_questions.md'), blockingQuestionTexts)
  let structuredAnswers = null

  if (options.mode === 'interactive' && blockingQuestions.length > 0) {
    await updateState(runDir, { state: 'WAITING_FOR_USER_INPUT' })
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: phaseName,
      loop: 'gate_wait_for_user',
      attempt: 1,
      budget: 1,
      retryFamily: 'gate_wait_for_user',
    })
    options.interaction_context.pendingQuestionPhase = 'blocking_question_precheck'
    const answers = await waitForUserAnswers({
      runDir,
      questions: blockingQuestions.map((question) => question.question),
      ui,
      options,
    })
    options.interaction_context.pendingQuestionPhase = null
    const parsed = parseStructuredAnswers(answers)
    structuredAnswers = Array.isArray(parsed.answers) ? parsed.answers : []
  }

  const precheck = resolveBlockingQuestionPrecheck({
    mode: options.mode,
    blockingQuestions,
    structuredAnswers,
    log: (message) => ui?.log?.(message),
  })

  await writeJsonFile(path.join(phaseDir, 'output.json'), precheck)
  updatePhase(manifest, phaseName, {
    status: 'completed',
    output_path: path.join(phaseDir, 'output.json'),
    completed_at: new Date().toISOString(),
  })
  await writeManifest(path.join(runDir, 'manifest.json'), manifest)
  await updateState(runDir, {
    state: 'BLOCKING_QUESTION_PRECHECK_DONE',
    blocking_question_precheck: precheck,
  })

  return precheck
}

async function runAssumptionHintCapturePhase({
  repoRoot,
  runDir,
  runId,
  taskText,
  analysis,
  architecture,
  policy,
  manifest,
  options,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const phaseName = 'assumption_hint_capture'
  const phaseDir = path.join(runDir, 'phases', phaseName)
  const userInput = await loadUserInputContext(runDir)
  let promptVariables
  try {
    promptVariables = {
      TASK: taskText.trim(),
      ANALYSIS_JSON: renderPromptJsonText(analysis, {
        options,
        label: 'ANALYSIS_JSON',
        phaseName,
        failOnTruncation: true,
      }),
      ARCH_JSON: renderPromptJsonText(architecture, {
        options,
        label: 'ARCH_JSON',
        phaseName,
        failOnTruncation: true,
      }),
      USER_ANSWERS: userInput.userAnswers,
      USER_ANSWERS_DIRECTIVES: renderPromptJsonText(userInput.userAnswerDirectives ?? {}, {
        options,
        label: 'USER_ANSWERS_DIRECTIVES',
        phaseName,
        failOnTruncation: true,
      }),
      OPEN_QUESTIONS: userInput.openQuestions,
    }
  } catch (error) {
    if (error instanceof PromptContextTruncationError) {
      await markRunFailed(runDir, { phase: phaseName, error })
    }
    throw error
  }

  return await runOrLoadPhase({
    phaseName,
    phaseDir,
    promptFile: path.join(PROMPTS_DIR, '02-assumption-hint-capture.md'),
    schemaFile: path.join(SCHEMAS_DIR, 'assumption-hint-capture.schema.json'),
    promptVariables,
    sandbox: resolveReadOnlyPhaseSandbox(options),
    codexBin: options.codex_bin,
    repoRoot,
    search: options.search,
    noRedact: options.no_redact,
    policy,
    policyAllowlistMode: options.policy_allowlist_mode,
    maxPolicyGuidanceRetries: options.max_review_fix_attempts,
    manifest,
    runDir,
    runId,
    force: options.force,
    attempt: 1,
    resumePhaseSubstateIndex,
    interactionContext: options?.interaction_context ?? null,
    ui,
  })
}

async function runResolveBlockPhase({
  repoRoot,
  runDir,
  runId,
  taskText,
  phaseName,
  phaseOutput,
  gate,
  policy,
  manifest,
  options,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const resolveDir = path.join(runDir, 'phases', 'resolve_block', phaseName)
  const resolvePhaseName = `resolve_block/${phaseName}`
  let promptVariables
  try {
    promptVariables = {
      TASK: taskText.trim(),
      PHASE_NAME: phaseName,
      GATE_REASONS: formatGateReasons(gate),
      PHASE_OUTPUT_JSON: renderPromptJsonText(phaseOutput, {
        options,
        label: 'PHASE_OUTPUT_JSON',
        phaseName: resolvePhaseName,
        failOnTruncation: true,
      }),
    }
  } catch (error) {
    if (error instanceof PromptContextTruncationError) {
      await markRunFailed(runDir, { phase: resolvePhaseName, error })
    }
    throw error
  }

  return await runOrLoadPhase({
    phaseName: resolvePhaseName,
    phaseDir: resolveDir,
    promptFile: path.join(PROMPTS_DIR, '02-resolve-block.md'),
    schemaFile: path.join(SCHEMAS_DIR, 'resolve-block.schema.json'),
    promptVariables,
    sandbox: resolveReadOnlyPhaseSandbox(options),
    codexBin: options.codex_bin,
    repoRoot,
    search: options.search,
    noRedact: options.no_redact,
    policy,
    policyAllowlistMode: options.policy_allowlist_mode,
    maxPolicyGuidanceRetries: options.max_review_fix_attempts,
    manifest,
    runDir,
    runId,
    force: options.force,
    resumePhaseSubstateIndex,
    interactionContext: options?.interaction_context ?? null,
    ui,
  })
}

function normalizeQuestionList(questions) {
  return extractQuestionTexts(questions)
}

async function escalateFailureToUser({
  runDir,
  manifest,
  options,
  ui,
  taskId,
  questions,
  fallbackReason,
}) {
  const normalizedQuestions = normalizeQuestionList(questions)
  const effectiveQuestions =
    normalizedQuestions.length > 0
      ? normalizedQuestions
      : [
          `Failure manager could not produce a safe actionable recovery for ${taskId}. ${fallbackReason || 'Please provide direction.'}`,
        ]

  addOpenQuestions(manifest, effectiveQuestions)
  await appendMarkdown(path.join(runDir, 'open_questions.md'), effectiveQuestions)
  await updateState(runDir, { state: 'WAITING_FOR_USER_INPUT' })
  options.interaction_context.pendingQuestionPhase = `task:${taskId}/failure_manager`
  await waitForUserAnswers({ runDir, questions: effectiveQuestions, ui, options })
  options.interaction_context.pendingQuestionPhase = null
}

async function runFailureManagerPhase({
  repoRoot,
  runDir,
  runId,
  taskText,
  task,
  taskDirBase,
  failureContext,
  managerAttempt,
  options,
  policy,
  manifest,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const phaseName = `tasks/${task.id}/failure_manager`
  const phaseDir = path.join(runDir, 'phases', 'tasks', taskDirBase, 'failure_manager', 'attempts', String(managerAttempt))
  const userInput = await loadUserInputContext(runDir)
  let promptVariables
  try {
    promptVariables = {
      TASK: taskText.trim(),
      USER_ANSWERS: userInput.userAnswers,
      USER_ANSWERS_DIRECTIVES: renderPromptJsonText(userInput.userAnswerDirectives ?? {}, {
        options,
        label: 'USER_ANSWERS_DIRECTIVES',
        phaseName,
        failOnTruncation: true,
      }),
      OPEN_QUESTIONS: userInput.openQuestions,
      FAILURE_CONTEXT_JSON: renderPromptJsonText(failureContext, {
        options,
        label: 'FAILURE_CONTEXT_JSON',
        phaseName,
        failOnTruncation: true,
      }),
    }
  } catch (error) {
    if (error instanceof PromptContextTruncationError) {
      await markRunFailed(runDir, { phase: phaseName, error })
    }
    throw error
  }

  return await runOrLoadPhase({
    phaseName: `${phaseName}/attempt-${managerAttempt}`,
    phaseDir,
    promptFile: path.join(PROMPTS_DIR, '08-failure-manager.md'),
    schemaFile: path.join(SCHEMAS_DIR, 'failure-manager.schema.json'),
    promptVariables,
    sandbox: resolveReadOnlyPhaseSandbox(options),
    codexBin: options.codex_bin,
    repoRoot,
    search: options.search,
    noRedact: options.no_redact,
    policy,
    policyAllowlistMode: options.policy_allowlist_mode,
    maxPolicyGuidanceRetries: options.max_review_fix_attempts,
    manifest,
    runDir,
    runId,
    force: true,
    attempt: managerAttempt,
    resumePhaseSubstateIndex,
    interactionContext: options?.interaction_context ?? null,
    ui,
  })
}

async function runFailureManagerRecovery({
  repoRoot,
  runDir,
  runId,
  taskText,
  task,
  taskDirBase,
  failureContext,
  managerAttempt,
  options,
  policy,
  manifest,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const managerOutput = await runFailureManagerPhase({
    repoRoot,
    runDir,
    runId,
    taskText,
    task,
    taskDirBase,
    failureContext,
    managerAttempt,
    options,
    policy,
    manifest,
    resumePhaseSubstateIndex,
    ui,
  })

  const validation = validateFailureManagerDecision(managerOutput, { mode: options.mode })
  if (!validation.ok) {
    ui?.log?.(`task:${task.id} failure-manager output rejected: ${validation.error}`)
    await escalateFailureToUser({
      runDir,
      manifest,
      options,
      ui,
      taskId: task.id,
      questions: [],
      fallbackReason: validation.error,
    })
    return {
      outcome: 'continue',
      managerOutput,
      validation,
    }
  }

  const resolvedRecovery = resolveRecoveryAction({
    suggestion: validation.decision,
    context: {
      mode: options.mode,
      questions: failureContext?.questions_context ?? [],
      task: {
        id: task.id,
        required: failureContext?.task_context?.required === true,
        affects_schema: failureContext?.task_context?.affects_schema === true,
        affects_migrations: failureContext?.task_context?.affects_migrations === true,
      },
    },
  })

  if (!resolvedRecovery.validation.valid && resolvedRecovery.invalidRecoverySuggestion) {
    ui?.log?.(
      `Phase 12: invalid recovery suggestion '${resolvedRecovery.invalidRecoverySuggestion.action}' blocked, reason: ${resolvedRecovery.validation.reason}. Falling back to escalate.`,
    )
    await appendInvalidRecoverySuggestion(runDir, resolvedRecovery.invalidRecoverySuggestion)
  }

  const decision = resolvedRecovery.decision
  if (decision.action === 'retry') {
    return {
      outcome: 'retry_with_feedback',
      decision,
      managerOutput,
    }
  }

  if (decision.action === 'auto_answer_noncritical') {
    const answerBlock = buildAnswersBlockFromList(decision.answers)
    await appendUserAnswers(runDir, answerBlock, decision.questions)
    return {
      outcome: 'continue',
      decision,
      managerOutput,
    }
  }

  if (decision.action === 'escalate') {
    await escalateFailureToUser({
      runDir,
      manifest,
      options,
      ui,
      taskId: task.id,
      questions: decision.questions,
      fallbackReason: decision.reason,
    })
    return {
      outcome: 'continue',
      decision,
      managerOutput,
    }
  }

  if (decision.action === 'skip_task') {
    ui?.log?.(`task:${task.id} failure manager skipped task: ${decision.reason}`)
    return {
      outcome: 'skip_task',
      decision,
      managerOutput,
    }
  }

  await markRunFailed(runDir, {
    phase: `task:${task.id}/failure_manager`,
    error: `Failure manager action=abort: ${decision.reason}`,
  })

  return {
    outcome: 'abort',
    decision,
    managerOutput,
  }
}

async function runPipeline({
  repoRoot,
  runId,
  runDir,
  branchName,
  baseSha,
  taskText,
  policy,
  manifest,
  options,
  resumeState,
}) {
  const state = resumeState ?? (await readState(runDir))
  const resumePhaseSubstateIndex = resumeState
    ? buildPhaseSubstateIndex({
        events: await readResumeJournalEvents({ runDir }),
      })
    : null
  const ui = createUi({ runId, verbose: Boolean(options.verbose), prettyEvents: Boolean(options.pretty_events) })
  const interactionContext = {
    currentInterruptController: null,
    terminalBroker: null,
    pendingQuestionPhase: null,
  }
  options.interaction_context = interactionContext
  await createConversationArtifacts(runDir, { interactionModel: options.interaction_model })
  if (options.interaction_model === 'conversational') {
    await initializeLiveInteractionCapability({
      codexBin: options.codex_bin,
      repoRoot,
      runDir,
      ui,
    })
  }
  interactionContext.terminalBroker = startTerminalInputBroker({
    runDir,
    interactionModel: options.interaction_model,
    interactionContext,
    ui,
  })
  const maxReviewFixAttempts = options.max_review_fix_attempts
  const maxReviewDiffGrowthLines = options.max_review_diff_growth_lines

  const assumptionsPath = path.join(runDir, 'assumptions.md')
  const mitigationsPath = path.join(runDir, 'mitigations.md')
  const taskHintsPath = path.join(runDir, 'task_hints.md')
  const questionsPath = path.join(runDir, 'open_questions.md')
  const planningContext = createPlanningContext()
  const checkpointBoundary = async (phaseName, boundaryLabel) =>
    await checkpointConversationBoundary({
      runDir,
      interactionModel: options.interaction_model ?? 'phased',
      phaseName,
      boundaryLabel,
      ui,
    })

  const analysisPhaseDir = path.join(runDir, 'phases', 'analysis')
  const architecturePhaseDir = path.join(runDir, 'phases', 'architecture')
  const taskGraphPhaseDir = path.join(runDir, 'phases', 'task_graph')

  let analysisBlockResolution = null
  let architectureBlockResolution = null
  let syntheticCycleCapReached = false

  // analysis
  await checkpointBoundary('analysis', 'starting analysis')
  ui.log(`phase:analysis starting (dir=${analysisPhaseDir})`)
  await updateState(runDir, { state: 'POLICY_READY' })
  let analysis = null
  let analysisReview = null
  let analysisReviewFeedback = ''
  let analysisPreviousReview = null
  for (let attempt = 1; attempt <= maxReviewFixAttempts + 1; attempt += 1) {
    await checkpointBoundary('analysis', `starting analysis attempt ${attempt}`)
    const userInput = await loadUserInputContext(runDir)
    let promptVariables
    try {
      promptVariables = {
        TASK: taskText.trim(),
        WEB_SEARCH_STATUS: options.search ? 'enabled' : 'disabled',
        REVIEW_FEEDBACK: analysisReviewFeedback,
        USER_ANSWERS: userInput.userAnswers,
        USER_ANSWERS_DIRECTIVES: renderPromptJsonText(userInput.userAnswerDirectives ?? {}, {
          options,
          label: 'USER_ANSWERS_DIRECTIVES',
          phaseName: 'analysis',
          failOnTruncation: true,
        }),
        OPEN_QUESTIONS: userInput.openQuestions,
      }
    } catch (error) {
      if (error instanceof PromptContextTruncationError) {
        await markRunFailed(runDir, { phase: 'analysis', error })
      }
      throw error
    }

    analysis = await runOrLoadPhase({
      phaseName: 'analysis',
      phaseDir: analysisPhaseDir,
      promptFile: path.join(PROMPTS_DIR, '00-analysis.md'),
      schemaFile: path.join(SCHEMAS_DIR, 'analysis.schema.json'),
      promptVariables,
      sandbox: resolveReadOnlyPhaseSandbox(options),
      codexBin: options.codex_bin,
      repoRoot,
      search: options.search,
      noRedact: options.no_redact,
      policy,
      policyAllowlistMode: options.policy_allowlist_mode,
      maxPolicyGuidanceRetries: options.max_review_fix_attempts,
      manifest,
      runDir,
      runId,
      force: options.force || attempt > 1,
      attempt,
      resumePhaseSubstateIndex,
      interactionContext: options?.interaction_context ?? null,
      ui,
    })

    logGateStatus({ ui, phaseName: 'analysis', gate: analysis.gate })

    let analysisGateStatus = analysis.gate?.status
    if (analysisGateStatus === 'blocked') {
      const resolution = await runResolveBlockPhase({
        repoRoot,
        runDir,
        runId,
        taskText,
        phaseName: 'analysis',
        phaseOutput: analysis,
        gate: analysis.gate,
        policy,
        manifest,
        options,
        resumePhaseSubstateIndex,
        ui,
      })

      if (!resolution?.can_proceed) {
        await updateState(runDir, { state: 'STOPPED_BLOCKED' })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
        throw new Error('Analysis phase blocked (unmitigable)')
      }

      analysisBlockResolution = resolution
      const diff = mergePlanningContextWithDiff(planningContext, resolution)
      addAssumptions(manifest, diff.assumptions)
      addMitigations(manifest, diff.mitigations)
      addTaskHints(manifest, diff.task_hints)
      await appendMarkdown(assumptionsPath, diff.assumptions)
      await appendMarkdown(mitigationsPath, diff.mitigations)
      await appendMarkdown(taskHintsPath, diff.task_hints)

      analysisGateStatus = 'pass'
    }

    const analysisGateDecision = decideGateAction({
      mode: options.mode,
      gateStatus: analysisGateStatus,
      gateQuestions: analysis.gate?.questions,
    })
    await logPhaseSubstate({
      runDir,
      manifest,
      runId,
      phase: 'analysis',
      substate: 'phase_gate_evaluated',
      attempt,
      gateStatus: analysisGateDecision.effectiveStatus,
    })
    if (analysisGateDecision.stop) {
      if (analysisGateDecision.effectiveStatus === 'needs_user_input') {
        await updateState(runDir, { state: 'WAITING_FOR_USER_INPUT' })
        await logRetryTelemetry({
          runDir,
          manifest,
          runId,
          phase: 'analysis',
          loop: 'gate_wait_for_user',
          attempt,
          budget: maxReviewFixAttempts + 1,
          retryFamily: 'gate_wait_for_user',
        })
        options.interaction_context.pendingQuestionPhase = 'analysis'
        await waitForUserAnswers({ runDir, questions: analysis.gate?.questions, ui, options })
        options.interaction_context.pendingQuestionPhase = null
        continue
      }
      await updateState(runDir, {
        state: analysisGateDecision.effectiveStatus === 'blocked' ? 'STOPPED_BLOCKED' : 'STOPPED_NEEDS_USER_INPUT',
      })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      throw new Error(
        analysisGateDecision.effectiveStatus === 'blocked'
          ? 'Analysis phase blocked'
          : 'Analysis gate requires user input',
      )
    }

    const analysisReviewDir = path.join(runDir, 'phases', 'analysis_review')
    analysisReview = await runReviewPhase({
      repoRoot,
      runDir,
      runId,
      reviewTarget: 'analysis',
      taskText,
      baseSha,
      stepOutputPath: path.relative(repoRoot, path.join(analysisPhaseDir, 'output.json')),
      task: null,
      taskDir: null,
      verificationLogPaths: [],
      diffSummary: 'N/A',
      previousReview: analysisPreviousReview,
      reviewPhaseName: 'analysis_review',
      reviewPhaseDir: analysisReviewDir,
      attempt,
      options,
      policy,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })

    if (!reviewRequiresFix(analysisReview)) {
      break
    }

    if (attempt > maxReviewFixAttempts) {
      await markRunFailed(runDir, {
        phase: 'analysis_review',
        error: 'Analysis review failed after max fix attempts',
        blockingIssues: analysisReview?.blocking_issues,
      })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      throw new Error('Analysis review failed after max fix attempts')
    }

    analysisReviewFeedback = formatReviewFeedback(analysisReview)
    analysisPreviousReview = analysisReview
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: 'analysis_review',
      loop: 'review_fix_retry',
      attempt,
      budget: maxReviewFixAttempts,
      retryFamily: 'review_fix_retry',
      reviewTarget: 'analysis',
      failureKind: 'analysis_review_requested_changes',
    })
  }

  addAssumptions(manifest, analysis.assumptions ?? [])
  addOpenQuestions(manifest, analysis.gate?.questions ?? [])
  await appendMarkdown(assumptionsPath, analysis.assumptions ?? [])
  await appendMarkdown(questionsPath, analysis.gate?.questions ?? [])

  const blockingRisks = Array.isArray(analysis.risks)
    ? analysis.risks.filter((risk) => risk?.blocking === true).slice(0, 5)
    : []
  if (blockingRisks.length > 0) {
    ui.log('analysis: reported blocking risks (continuing; gate.status controls stopping):')
    for (const risk of blockingRisks) {
      ui.log(`- (${risk.domain}) ${risk.id}: ${risk.description}`)
    }
  }
  await updateState(runDir, { state: 'ANALYSIS_DONE' })

  // blocking_question_precheck
  await checkpointBoundary('blocking_question_precheck', 'starting blocking question precheck')
  ui.log('phase:blocking_question_precheck starting')
  const blockingQuestionPrecheck = await runBlockingQuestionPrecheckPhase({
    runDir,
    runId,
    analysis,
    options,
    manifest,
    ui,
  })

  const autonomousBlockingAssumptions = Array.isArray(blockingQuestionPrecheck?.blocking_questions)
    ? blockingQuestionPrecheck.blocking_questions
        .filter((question) => question?.resolved_by === 'autonomous_assumption')
        .map((question) => buildBlockingQuestionPrecheckAssumption(question))
    : []
  const autonomousBlockingMitigations = Array.isArray(blockingQuestionPrecheck?.blocking_questions)
    ? blockingQuestionPrecheck.blocking_questions
        .filter((question) => question?.resolved_by === 'autonomous_assumption')
        .map((question) => buildBlockingQuestionPrecheckMitigation(question))
    : []
  addAssumptions(manifest, autonomousBlockingAssumptions)
  addMitigations(manifest, autonomousBlockingMitigations)
  await appendMarkdown(assumptionsPath, autonomousBlockingAssumptions)
  await appendMarkdown(mitigationsPath, autonomousBlockingMitigations)

  let blockingQuestionsResolved = blockingQuestionPrecheck?.blocking_questions_resolved
  if (typeof blockingQuestionsResolved !== 'boolean') {
    if (options.mode === 'autonomous') {
      ui.log('warning: blocking_question_precheck missing in state; treating blocking_questions_resolved as true')
      blockingQuestionsResolved = true
    } else {
      blockingQuestionsResolved = false
    }
  }
  if (options.mode === 'interactive' && !blockingQuestionsResolved) {
    await updateState(runDir, { state: 'STOPPED_NEEDS_USER_INPUT' })
    await writeManifest(path.join(runDir, 'manifest.json'), manifest)
    throw new Error('Architecture phase blocked: unresolved blocking questions from pre-check phase.')
  }
  ui.log('phase:blocking_question_precheck completed')

  // architecture
  await checkpointBoundary('architecture', 'starting architecture')
  ui.log(`phase:architecture starting (dir=${architecturePhaseDir})`)
  let architecture = null
  let architectureReview = null
  let architectureReviewFeedback = ''
  let architecturePreviousReview = null
  for (let attempt = 1; attempt <= maxReviewFixAttempts + 1; attempt += 1) {
    await checkpointBoundary('architecture', `starting architecture attempt ${attempt}`)
    const userInput = await loadUserInputContext(runDir)
    let architecturePromptVariables
    try {
      architecturePromptVariables = {
        TASK: taskText.trim(),
        BLOCKING_QUESTIONS_RESOLVED: String(blockingQuestionsResolved),
        ANALYSIS_JSON: renderPromptJsonText(analysis, {
          options,
          label: 'ANALYSIS_JSON',
          phaseName: 'architecture',
          failOnTruncation: true,
        }),
        BLOCK_RESOLUTION_JSON: renderPromptJsonText(analysisBlockResolution ?? {}, {
          options,
          label: 'BLOCK_RESOLUTION_JSON',
          phaseName: 'architecture',
          failOnTruncation: true,
        }),
        REVIEW_FEEDBACK: architectureReviewFeedback,
        USER_ANSWERS: userInput.userAnswers,
        USER_ANSWERS_DIRECTIVES: renderPromptJsonText(userInput.userAnswerDirectives ?? {}, {
          options,
          label: 'USER_ANSWERS_DIRECTIVES',
          phaseName: 'architecture',
          failOnTruncation: true,
        }),
        OPEN_QUESTIONS: userInput.openQuestions,
      }
    } catch (error) {
      if (error instanceof PromptContextTruncationError) {
        await markRunFailed(runDir, { phase: 'architecture', error })
      }
      throw error
    }

    architecture = await runOrLoadPhase({
      phaseName: 'architecture',
      phaseDir: architecturePhaseDir,
      promptFile: path.join(PROMPTS_DIR, '01-architecture.md'),
      schemaFile: path.join(SCHEMAS_DIR, 'architecture.schema.json'),
      promptVariables: architecturePromptVariables,
      sandbox: resolveReadOnlyPhaseSandbox(options),
      codexBin: options.codex_bin,
      repoRoot,
      search: options.search,
      noRedact: options.no_redact,
      policy,
      policyAllowlistMode: options.policy_allowlist_mode,
      maxPolicyGuidanceRetries: options.max_review_fix_attempts,
      manifest,
      runDir,
      runId,
      force: options.force || attempt > 1,
      attempt,
      resumePhaseSubstateIndex,
      interactionContext: options?.interaction_context ?? null,
      ui,
    })

    logGateStatus({ ui, phaseName: 'architecture', gate: architecture.gate })

    let architectureGateStatus = architecture.gate?.status
    if (architectureGateStatus === 'blocked') {
      const resolution = await runResolveBlockPhase({
        repoRoot,
        runDir,
        runId,
        taskText,
        phaseName: 'architecture',
        phaseOutput: architecture,
        gate: architecture.gate,
        policy,
        manifest,
        options,
        resumePhaseSubstateIndex,
        ui,
      })

      if (!resolution?.can_proceed) {
        await updateState(runDir, { state: 'STOPPED_BLOCKED' })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
        throw new Error('Architecture phase blocked (unmitigable)')
      }

      architectureBlockResolution = resolution
      const diff = mergePlanningContextWithDiff(planningContext, resolution)
      addAssumptions(manifest, diff.assumptions)
      addMitigations(manifest, diff.mitigations)
      addTaskHints(manifest, diff.task_hints)
      await appendMarkdown(assumptionsPath, diff.assumptions)
      await appendMarkdown(mitigationsPath, diff.mitigations)
      await appendMarkdown(taskHintsPath, diff.task_hints)

      architectureGateStatus = 'pass'
    }

    const archGateDecision = decideGateAction({
      mode: options.mode,
      gateStatus: architectureGateStatus,
      gateQuestions: architecture.gate?.questions,
    })
    await logPhaseSubstate({
      runDir,
      manifest,
      runId,
      phase: 'architecture',
      substate: 'phase_gate_evaluated',
      attempt,
      gateStatus: archGateDecision.effectiveStatus,
    })
    if (archGateDecision.stop) {
      if (archGateDecision.effectiveStatus === 'needs_user_input') {
        await updateState(runDir, { state: 'WAITING_FOR_USER_INPUT' })
        await logRetryTelemetry({
          runDir,
          manifest,
          runId,
          phase: 'architecture',
          loop: 'gate_wait_for_user',
          attempt,
          budget: maxReviewFixAttempts + 1,
          retryFamily: 'gate_wait_for_user',
        })
        options.interaction_context.pendingQuestionPhase = 'architecture'
        await waitForUserAnswers({ runDir, questions: architecture.gate?.questions, ui, options })
        options.interaction_context.pendingQuestionPhase = null
        continue
      }
      await updateState(runDir, {
        state: archGateDecision.effectiveStatus === 'blocked' ? 'STOPPED_BLOCKED' : 'STOPPED_NEEDS_USER_INPUT',
      })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      throw new Error(
        archGateDecision.effectiveStatus === 'blocked'
          ? 'Architecture phase blocked'
          : 'Architecture gate requires user input',
      )
    }

    const invalidDocsToUpdateEntries = findInvalidArchitectureDocsToUpdateEntries(architecture)
    if (invalidDocsToUpdateEntries.length > 0) {
      const docsFormatIssue = buildArchitectureDocsFormatIssue({
        repoRoot,
        architecturePhaseDir,
        invalidEntries: invalidDocsToUpdateEntries,
      })
      architectureReview = {
        verdict: 'revise',
        summary:
          'Architecture output includes malformed docs_to_update entries; entries must be workspace-relative file paths only.',
        scope_alignment: {
          status: 'partial',
          notes: `Malformed docs_to_update entries: ${invalidDocsToUpdateEntries.join(', ')}`,
        },
        rubric: {
          security: { status: 'pass', notes: 'No direct security regression in this deterministic validation.' },
          functionality: { status: 'fix', notes: 'Malformed docs_to_update breaks downstream task-graph coverage checks.' },
          simplicity: { status: 'fix', notes: 'docs_to_update should be machine-readable plain paths only.' },
          speed: { status: 'fix', notes: 'Malformed entries cause deterministic replanning loops.' },
          quality: { status: 'fix', notes: 'Architecture output violates docs_to_update formatting contract.' },
          gdpr: { status: 'pass', notes: 'No direct GDPR regression in this deterministic validation.' },
        },
        changes_since_last_review: 'deterministic docs_to_update format check',
        verification_summary: 'not run',
        blocking_issues: [docsFormatIssue],
        non_blocking_suggestions: [],
        docs_impact: [],
        security_privacy_concerns: [],
      }

      if (attempt > maxReviewFixAttempts) {
        await markRunFailed(runDir, {
          phase: 'architecture',
          error: 'Architecture docs_to_update format check failed after max fix attempts',
          blockingIssues: architectureReview.blocking_issues,
        })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
        throw new Error('Architecture docs_to_update format check failed after max fix attempts')
      }

      architectureReviewFeedback = formatReviewFeedback(architectureReview)
      architecturePreviousReview = architectureReview
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: 'architecture',
        loop: 'architecture_docs_format_retry',
        attempt,
        budget: maxReviewFixAttempts,
        retryFamily: 'review_non_actionable_retry',
        reviewTarget: 'architecture',
        failureKind: 'architecture_docs_to_update_invalid',
      })
      ui.log(
        `phase:architecture docs_to_update format check failed; replanning (${invalidDocsToUpdateEntries.join(', ')})`,
      )
      continue
    }

    const architectureReviewDir = path.join(runDir, 'phases', 'architecture_review')
    architectureReview = await runReviewPhase({
      repoRoot,
      runDir,
      runId,
      reviewTarget: 'architecture',
      taskText,
      baseSha,
      stepOutputPath: path.relative(repoRoot, path.join(architecturePhaseDir, 'output.json')),
      task: null,
      taskDir: null,
      verificationLogPaths: [],
      diffSummary: 'N/A',
      previousReview: architecturePreviousReview,
      reviewPhaseName: 'architecture_review',
      reviewPhaseDir: architectureReviewDir,
      attempt,
      options,
      policy,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })

    if (!reviewRequiresFix(architectureReview)) {
      break
    }

    if (attempt > maxReviewFixAttempts) {
      await markRunFailed(runDir, {
        phase: 'architecture_review',
        error: 'Architecture review failed after max fix attempts',
        blockingIssues: architectureReview?.blocking_issues,
      })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      throw new Error('Architecture review failed after max fix attempts')
    }

    architectureReviewFeedback = formatReviewFeedback(architectureReview)
    architecturePreviousReview = architectureReview
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: 'architecture_review',
      loop: 'review_fix_retry',
      attempt,
      budget: maxReviewFixAttempts,
      retryFamily: 'review_fix_retry',
      reviewTarget: 'architecture',
      failureKind: 'architecture_review_requested_changes',
    })
  }

  addOpenQuestions(manifest, architecture.open_questions ?? [])
  addOpenQuestions(manifest, architecture.gate?.questions ?? [])
  await appendMarkdown(questionsPath, architecture.open_questions ?? [])
  await appendMarkdown(questionsPath, architecture.gate?.questions ?? [])

  await updateState(runDir, { state: 'ARCHITECTURE_DONE' })

  // assumption_hint_capture
  await checkpointBoundary('assumption_hint_capture', 'starting assumption and hint capture')
  ui.log('phase:assumption_hint_capture starting')
  const assumptionHintCapture = await runAssumptionHintCapturePhase({
    repoRoot,
    runDir,
    runId,
    taskText,
    analysis,
    architecture,
    policy,
    manifest,
    options,
    resumePhaseSubstateIndex,
    ui,
  })
  const questionDiff = mergePlanningContextWithDiff(planningContext, assumptionHintCapture)
  const capturedQuestions = Array.isArray(assumptionHintCapture?.questions) ? assumptionHintCapture.questions : []
  const questionEntries = extractQuestionTexts(capturedQuestions.filter((question) => !isCriticalQuestion(question)))
  const ignoredBlockingQuestions = extractQuestionTexts(capturedQuestions.filter((question) => isCriticalQuestion(question)))
  if (ignoredBlockingQuestions.length > 0) {
    ui.log(
      `phase:assumption_hint_capture ignored ${ignoredBlockingQuestions.length} blocking question(s); only non-blocking questions are retained`,
    )
  }
  addAssumptions(manifest, questionDiff.assumptions)
  addMitigations(manifest, questionDiff.mitigations)
  addTaskHints(manifest, questionDiff.task_hints)
  addOpenQuestions(manifest, questionEntries)
  await appendMarkdown(assumptionsPath, questionDiff.assumptions)
  await appendMarkdown(mitigationsPath, questionDiff.mitigations)
  await appendMarkdown(taskHintsPath, questionDiff.task_hints)
  await appendMarkdown(questionsPath, questionEntries)
  ui.log('phase:assumption_hint_capture completed')

  // task_graph
  await checkpointBoundary('task_graph', 'starting task graph planning')
  ui.log(`phase:task_graph starting (dir=${taskGraphPhaseDir})`)
  let taskGraph = null
  let taskGraphReview = null
  let taskGraphReviewFeedback = ''
  let taskGraphPreviousReview = null
  for (let attempt = 1; attempt <= maxReviewFixAttempts + 1; attempt += 1) {
    await checkpointBoundary('task_graph', `starting task graph attempt ${attempt}`)
    taskGraph = await runTaskGraphWithBudgetLoop({
      repoRoot,
      runId,
      runDir,
      taskText,
      analysis,
      architecture,
      planningContext,
      taskGraphPhaseDir,
      reviewFeedback: taskGraphReviewFeedback,
      policy,
      manifest,
      options,
      ui,
      force: options.force || attempt > 1,
      resumePhaseSubstateIndex,
    })

    logGateStatus({ ui, phaseName: 'task_graph', gate: taskGraph.gate })

    let taskGraphGateStatus = taskGraph.gate?.status
    if (taskGraphGateStatus === 'blocked') {
      const resolution = await runResolveBlockPhase({
        repoRoot,
        runDir,
        runId,
        taskText,
        phaseName: 'task_graph',
        phaseOutput: taskGraph,
        gate: taskGraph.gate,
        policy,
        manifest,
        options,
        resumePhaseSubstateIndex,
        ui,
      })

      if (!resolution?.can_proceed) {
        await updateState(runDir, { state: 'STOPPED_BLOCKED' })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
        throw new Error('Task graph phase blocked (unmitigable)')
      }

      const diff = mergePlanningContextWithDiff(planningContext, resolution)
      addAssumptions(manifest, diff.assumptions)
      addMitigations(manifest, diff.mitigations)
      addTaskHints(manifest, diff.task_hints)
      await appendMarkdown(assumptionsPath, diff.assumptions)
      await appendMarkdown(mitigationsPath, diff.mitigations)
      await appendMarkdown(taskHintsPath, diff.task_hints)

      taskGraph = await runTaskGraphWithBudgetLoop({
        repoRoot,
        runId,
        runDir,
        taskText,
        analysis,
        architecture,
        planningContext,
        taskGraphPhaseDir,
        reviewFeedback: taskGraphReviewFeedback,
        policy,
        manifest,
        options,
        ui,
        force: true,
        resumePhaseSubstateIndex,
      })
      logGateStatus({ ui, phaseName: 'task_graph', gate: taskGraph.gate })
      taskGraphGateStatus = taskGraph.gate?.status
    }

    const graphGateDecision = decideGateAction({
      mode: options.mode,
      gateStatus: taskGraphGateStatus,
      gateQuestions: taskGraph.gate?.questions,
    })
    await logPhaseSubstate({
      runDir,
      manifest,
      runId,
      phase: 'task_graph',
      substate: 'phase_gate_evaluated',
      attempt,
      gateStatus: graphGateDecision.effectiveStatus,
    })
    if (graphGateDecision.stop) {
      if (graphGateDecision.effectiveStatus === 'needs_user_input') {
        await updateState(runDir, { state: 'WAITING_FOR_USER_INPUT' })
        await logRetryTelemetry({
          runDir,
          manifest,
          runId,
          phase: 'task_graph',
          loop: 'gate_wait_for_user',
          attempt,
          budget: maxReviewFixAttempts + 1,
          retryFamily: 'gate_wait_for_user',
        })
        options.interaction_context.pendingQuestionPhase = 'task_graph'
        await waitForUserAnswers({ runDir, questions: taskGraph.gate?.questions, ui, options })
        options.interaction_context.pendingQuestionPhase = null
        continue
      }
      await updateState(runDir, {
        state: graphGateDecision.effectiveStatus === 'blocked' ? 'STOPPED_BLOCKED' : 'STOPPED_NEEDS_USER_INPUT',
      })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      throw new Error(
        graphGateDecision.effectiveStatus === 'blocked'
          ? 'Task graph phase blocked'
          : 'Task graph gate requires user input',
      )
    }

    const validation = validateTaskGraph(taskGraph)
    if (!validation.ok) {
      await markRunFailed(runDir, {
        phase: 'task_graph',
        error: `Invalid task graph: ${validation.errors.join('; ')}`,
      })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      throw new Error(`Invalid task graph: ${validation.errors.join('; ')}`)
    }

    const fileConflictMap = detectFileConflicts(taskGraph)
    await updateState(runDir, { file_conflict_map: fileConflictMap })
    if (fileConflictMap.blocked.length > 0) {
      const blockedFiles = fileConflictMap.blocked.map((conflict) => `${conflict.file} (${conflict.task_ids.join(' -> ')})`)
      taskGraphReview = {
        verdict: 'revise',
        summary: 'Task graph contains blocked shared-file conflicts and must be replanned before review.',
        scope_alignment: {
          status: 'mismatch',
          notes: `Blocked file conflicts: ${blockedFiles.join(', ')}`,
        },
        rubric: {
          security: { status: 'pass', notes: 'No direct security regression detected in this deterministic check.' },
          functionality: {
            status: 'fix',
            notes: 'Parallel or unordered shared-file writes make the task graph unsafe to execute as planned.',
          },
          simplicity: { status: 'fix', notes: 'Shared-file sequencing must be explicit before implementation starts.' },
          speed: { status: 'fix', notes: 'Replanning is cheaper than resolving cross-task merge conflicts later.' },
          quality: { status: 'fix', notes: 'Task graph hard gates require deterministic file conflict handling.' },
          gdpr: { status: 'pass', notes: 'No direct GDPR regression detected in this deterministic check.' },
        },
        changes_since_last_review: 'deterministic pre-review file conflict check',
        verification_summary: 'not run',
        blocking_issues: [
          {
            id: 'TG-CONFLICT-001',
            severity: 'high',
            file: path.relative(repoRoot, path.join(taskGraphPhaseDir, 'output.json')),
            description: 'Task graph contains shared-file writes without a stable execution order.',
            suggested_fix: `Replan shared-file ownership or add deterministic ordering for: ${blockedFiles.join(', ')}`,
          },
        ],
        non_blocking_suggestions: [],
        docs_impact: [],
        security_privacy_concerns: [],
      }

      taskGraphReviewFeedback = formatReviewFeedback(taskGraphReview)
      taskGraphPreviousReview = taskGraphReview
      ui.log('Phase 10 blocked: parallel file conflicts detected. Task graph requires replanning.')
      for (const conflict of fileConflictMap.blocked) {
        ui.log(`phase:task_graph blocked_file_conflict=${conflict.file} tasks=${conflict.task_ids.join(',')}`)
      }
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: 'task_graph',
        loop: 'task_graph_file_conflict_retry',
        attempt,
        budget: maxReviewFixAttempts,
        retryFamily: 'review_fix_retry',
        reviewTarget: 'task_graph',
        failureKind: 'task_graph_file_conflict_blocked',
      })
      continue
    }

    if (policy) {
      const proposedDeletes = (taskGraph.tasks ?? []).reduce((count, task) => {
        const deletes = Array.isArray(task?.files?.delete) ? task.files.delete.length : 0
        return count + deletes
      }, 0)
      if (proposedDeletes > policy.max_deleted_files) {
        await markRunFailed(runDir, {
          phase: 'task_graph',
          error: `Task graph proposes ${proposedDeletes} file delete(s), exceeding policy max_deleted_files=${policy.max_deleted_files}`,
        })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
        throw new Error(
          `Task graph proposes ${proposedDeletes} file delete(s), exceeding policy max_deleted_files=${policy.max_deleted_files}`,
        )
      }
    }

    const missingArchitectureDocs = findMissingArchitectureDocsToUpdate({ architecture, taskGraph })
    if (missingArchitectureDocs.length > 0) {
      if (attempt > maxReviewFixAttempts) {
        const coverageIssue = {
          id: 'TG-COVERAGE-001',
          severity: 'medium',
          file: path.relative(repoRoot, path.join(taskGraphPhaseDir, 'output.json')),
          description:
            'Task graph does not include all files listed in architecture.docs_to_update within tasks[].files.{create|modify|delete}.',
          suggested_fix: `Add explicit docs coverage for: ${missingArchitectureDocs.join(', ')}`,
        }
        await markRunFailed(runDir, {
          phase: 'task_graph',
          error: `Task graph is missing architecture docs coverage after max fix attempts: ${missingArchitectureDocs.join(', ')}`,
          blockingIssues: [coverageIssue],
        })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
        throw new Error(
          `Task graph is missing architecture docs coverage after max fix attempts: ${missingArchitectureDocs.join(', ')}`,
        )
      }

      taskGraphReview = {
        verdict: 'revise',
        summary:
          'Task graph is missing required docs coverage from architecture.docs_to_update; replanning with explicit feedback.',
        scope_alignment: {
          status: 'partial',
          notes: `Missing docs: ${missingArchitectureDocs.join(', ')}`,
        },
        rubric: {
          security: { status: 'pass', notes: 'No direct security regression detected in this deterministic check.' },
          functionality: { status: 'pass', notes: 'Core task graph remains structurally valid.' },
          simplicity: { status: 'pass', notes: 'Coverage check adds deterministic planning guardrails.' },
          speed: { status: 'fix', notes: 'Missing docs would create avoidable review rework.' },
          quality: { status: 'fix', notes: 'Architecture-to-task traceability is incomplete.' },
          gdpr: { status: 'fix', notes: 'Missing compliance docs can cause release-readiness drift.' },
        },
        changes_since_last_review: 'deterministic pre-review coverage check',
        verification_summary: 'not run',
        blocking_issues: [
          {
            id: 'TG-COVERAGE-001',
            severity: 'medium',
            file: path.relative(repoRoot, path.join(taskGraphPhaseDir, 'output.json')),
            description:
              'Task graph does not include all files listed in architecture.docs_to_update within tasks[].files.{create|modify|delete}.',
            suggested_fix: `Add explicit docs coverage for: ${missingArchitectureDocs.join(', ')}`,
          },
        ],
        non_blocking_suggestions: [],
        docs_impact: missingArchitectureDocs,
        security_privacy_concerns: [],
      }

      taskGraphReviewFeedback = formatReviewFeedback(taskGraphReview)
      taskGraphPreviousReview = taskGraphReview
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: 'task_graph',
        loop: 'task_graph_docs_coverage_retry',
        attempt,
        budget: maxReviewFixAttempts,
        retryFamily: 'review_fix_retry',
        reviewTarget: 'task_graph',
        failureKind: 'task_graph_docs_coverage_missing',
      })
      ui.log(`phase:task_graph coverage check failed; replanning (${missingArchitectureDocs.join(', ')})`)
      continue
    }

    const missingArchitectureDecisionCoverage = findMissingArchitectureDecisionCoverage({
      architecture,
      taskGraph,
    })
    if (missingArchitectureDecisionCoverage.length > 0) {
      if (attempt > maxReviewFixAttempts) {
        const traceIssue = {
          id: 'TG-TRACE-001',
          severity: 'medium',
          file: path.relative(repoRoot, path.join(taskGraphPhaseDir, 'output.json')),
          description:
            'Task graph does not reference all architecture.decision IDs in task descriptions or acceptance criteria.',
          suggested_fix: `Reference missing decision IDs in task narratives (description/acceptance_criteria): ${missingArchitectureDecisionCoverage.join(', ')}`,
        }
        await markRunFailed(runDir, {
          phase: 'task_graph',
          error: `Task graph is missing architecture decision traceability after max fix attempts: ${missingArchitectureDecisionCoverage.join(', ')}`,
          blockingIssues: [traceIssue],
        })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
        throw new Error(
          `Task graph is missing architecture decision traceability after max fix attempts: ${missingArchitectureDecisionCoverage.join(', ')}`,
        )
      }

      taskGraphReview = {
        verdict: 'revise',
        summary:
          'Task graph is missing architecture decision traceability; replanning with explicit decision coverage feedback.',
        scope_alignment: {
          status: 'partial',
          notes: `Missing decision coverage: ${missingArchitectureDecisionCoverage.join(', ')}`,
        },
        rubric: {
          security: { status: 'pass', notes: 'No direct security regression detected in this deterministic check.' },
          functionality: { status: 'pass', notes: 'Core task graph remains structurally valid.' },
          simplicity: { status: 'fix', notes: 'Decision traceability is not explicit in task narratives.' },
          speed: { status: 'fix', notes: 'Missing traceability increases downstream review rework.' },
          quality: { status: 'fix', notes: 'Architecture-to-task traceability is incomplete.' },
          gdpr: { status: 'pass', notes: 'No direct GDPR regression detected in this deterministic check.' },
        },
        changes_since_last_review: 'deterministic pre-review decision traceability check',
        verification_summary: 'not run',
        blocking_issues: [
          {
            id: 'TG-TRACE-001',
            severity: 'medium',
            file: path.relative(repoRoot, path.join(taskGraphPhaseDir, 'output.json')),
            description:
              'Task graph does not reference all architecture.decision IDs in task descriptions or acceptance criteria.',
            suggested_fix: `Reference missing decision IDs in task narratives (description/acceptance_criteria): ${missingArchitectureDecisionCoverage.join(', ')}`,
          },
        ],
        non_blocking_suggestions: [],
        docs_impact: [],
        security_privacy_concerns: [],
      }

      taskGraphReviewFeedback = formatReviewFeedback(taskGraphReview)
      taskGraphPreviousReview = taskGraphReview
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: 'task_graph',
        loop: 'task_graph_traceability_retry',
        attempt,
        budget: maxReviewFixAttempts,
        retryFamily: 'review_fix_retry',
        reviewTarget: 'task_graph',
        failureKind: 'task_graph_traceability_missing',
      })
      ui.log(
        `phase:task_graph traceability check failed; replanning (${missingArchitectureDecisionCoverage.join(', ')})`,
      )
      continue
    }

    const taskGraphReviewDir = path.join(runDir, 'phases', 'task_graph_review')
    const reviewRequiredConflicts = fileConflictMap.review_required
    taskGraphReview = await runReviewPhase({
      repoRoot,
      runDir,
      runId,
      reviewTarget: 'task_graph',
      taskText,
      baseSha,
      stepOutputPath: path.relative(repoRoot, path.join(taskGraphPhaseDir, 'output.json')),
      task: null,
      taskDir: null,
      verificationLogPaths: [],
      diffSummary: 'N/A',
      previousReview: taskGraphPreviousReview,
      reviewPhaseName: 'task_graph_review',
      reviewPhaseDir: taskGraphReviewDir,
      attempt,
      extraPromptVariables: {
        REVIEW_REQUIRED_CONFLICTS: renderPromptJsonText(reviewRequiredConflicts, {
          options,
          label: 'REVIEW_REQUIRED_CONFLICTS',
          phaseName: 'task_graph_review',
          failOnTruncation: true,
        }),
      },
      options,
      policy,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })

    const missingConflictAcknowledgements = findMissingConflictAcknowledgements({
      reviewRequiredConflicts,
      review: taskGraphReview,
    })
    if (missingConflictAcknowledgements.length > 0) {
      taskGraphReview = {
        verdict: 'revise',
        summary: 'Task graph review omitted required shared-file conflict acknowledgements.',
        scope_alignment: {
          status: 'partial',
          notes: `Missing conflict acknowledgements: ${missingConflictAcknowledgements.join(', ')}`,
        },
        rubric: {
          security: { status: 'pass', notes: 'No direct security regression detected in this deterministic check.' },
          functionality: { status: 'fix', notes: 'Review output must acknowledge every shared-file conflict before Phase 10 passes.' },
          simplicity: { status: 'fix', notes: 'Explicit acknowledgements keep shared-file sequencing auditable.' },
          speed: { status: 'fix', notes: 'Missing acknowledgements would hide predictable integration risk.' },
          quality: { status: 'fix', notes: 'Reviewer output is incomplete for the task-graph hard gate.' },
          gdpr: { status: 'pass', notes: 'No direct GDPR regression detected in this deterministic check.' },
        },
        changes_since_last_review: 'deterministic task-graph conflict acknowledgement check',
        verification_summary: 'not run',
        blocking_issues: [
          {
            id: 'TG-CONFLICT-ACK-001',
            severity: 'medium',
            file: path.relative(repoRoot, path.join(taskGraphPhaseDir, 'output.json')),
            description: 'Task-graph review did not acknowledge every review_required shared-file conflict.',
            suggested_fix: `Include acknowledged_conflicts for: ${missingConflictAcknowledgements.join(', ')}`,
          },
        ],
        non_blocking_suggestions: [],
        docs_impact: [],
        security_privacy_concerns: [],
        acknowledged_conflicts: Array.isArray(taskGraphReview?.acknowledged_conflicts)
          ? taskGraphReview.acknowledged_conflicts
          : [],
      }
    }

    if (!reviewRequiresFix(taskGraphReview)) {
      break
    }

    if (attempt > maxReviewFixAttempts) {
      await markRunFailed(runDir, {
        phase: 'task_graph_review',
        error: 'Task graph review failed after max fix attempts',
        blockingIssues: taskGraphReview?.blocking_issues,
      })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      throw new Error('Task graph review failed after max fix attempts')
    }

    taskGraphReviewFeedback = formatReviewFeedback(taskGraphReview)
    taskGraphPreviousReview = taskGraphReview
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: 'task_graph_review',
      loop: 'review_fix_retry',
      attempt,
      budget: maxReviewFixAttempts,
      retryFamily: 'review_fix_retry',
      reviewTarget: 'task_graph',
      failureKind: 'task_graph_review_requested_changes',
    })
  }

  await updateState(runDir, { state: 'TASK_GRAPH_DONE' })

  await writeManifest(path.join(runDir, 'manifest.json'), manifest)

  if (options.dry_run) {
    return
  }

  await checkpointBoundary('baseline_verification', 'starting baseline verification')
  const baselineVerification = await runBaselineVerificationPhase({
    repoRoot,
    runDir,
    runId,
    options,
    manifest,
    ui,
  })
  const baselineKnownFailures = Array.isArray(baselineVerification?.known_failures)
    ? baselineVerification.known_failures
    : []

  // tasks
  const runtimeState = await readState(runDir)
  const taskExecutionPlan = resumeState
    ? hydrateTaskExecutionState({
        executionOrder: taskGraph.execution_order ?? [],
        taskExecution: runtimeState.task_execution ?? null,
        force: Boolean(options.force),
        warnOnMissing:
          runtimeState.state === 'IMPLEMENTING_TASKS' ||
          runtimeState.state === 'WAITING_FOR_USER_INPUT' ||
          runtimeState.state === 'STOPPED_BLOCKED' ||
          runtimeState.state === 'STOPPED_NEEDS_USER_INPUT' ||
          runtimeState.state === 'INTEGRATION_REVIEW_DONE' ||
          runtimeState.state === 'TESTS_PASSED' ||
          runtimeState.state === 'COVERAGE_PASSED' ||
          runtimeState.state === 'AUDIT_PASSED' ||
          runtimeState.state === 'SUMMARY_DONE',
      })
    : {
        taskExecution: createTaskExecutionState(taskGraph.execution_order ?? []),
        completedTaskIds: new Set(),
        startIndex: 0,
        pendingTaskIds: taskGraph.execution_order ?? [],
        resumeMessage: null,
        warningMessages: [],
      }
  for (const warningMessage of taskExecutionPlan.warningMessages) {
    ui.log(warningMessage)
  }
  if (taskExecutionPlan.resumeMessage) {
    ui.log(taskExecutionPlan.resumeMessage)
  }

  let taskExecution = taskExecutionPlan.taskExecution
  const completedTasks = new Set(taskExecution.completed_task_ids)
  await updateState(runDir, {
    state: 'IMPLEMENTING_TASKS',
    tasks_completed: Array.from(completedTasks),
    task_execution: taskExecution,
  })
  const tasksById = new Map((taskGraph.tasks ?? []).map((task) => [task.id, task]))
  const taskDirNameById = buildTaskDirNameMap(taskGraph.tasks ?? [])

  await checkpointBoundary('tasks', 'starting per-task implementation')
  for (const [taskIndex, taskId] of (taskGraph.execution_order ?? []).entries()) {
    if (taskIndex < taskExecutionPlan.startIndex && shouldSkipCommittedTask({ completedTaskIds: completedTasks, taskId })) {
      ui.log(`Skipping task ${taskId}: already committed (double-commit guard).`)
      continue
    }
    if (shouldSkipCommittedTask({ completedTaskIds: completedTasks, taskId })) {
      ui.log(`Skipping task ${taskId}: already committed (double-commit guard).`)
      continue
    }
    const task = tasksById.get(taskId)
    if (!task) {
      throw new Error(`Task not found in graph: ${taskId}`)
    }

    await checkpointBoundary(`task:${taskId}`, `starting task ${taskId}`)
    ui.log(`task:${taskId} starting`)
    let taskResult = null
    try {
      taskResult = await runTaskWithReviewLoop({
        repoRoot,
        runId,
        runDir,
        taskText,
        analysis,
        architecture,
        taskGraph,
        planningContext,
        task,
        taskDirName: taskDirNameById.get(task.id),
        policy,
        options,
        baselineKnownFailures,
        maxReviewFixAttempts,
        maxReviewDiffGrowthLines,
        manifest,
        resumePhaseSubstateIndex,
        ui,
      })
    } catch (error) {
      taskExecution = recordFailedTask({ taskExecution, taskId })
      await updateState(runDir, {
        tasks_completed: Array.from(completedTasks),
        task_execution: taskExecution,
      })
      throw error
    }

    if (!taskResult?.skipped && !options.no_commit) {
      await commitIfChanges({
        repoRoot,
        message: `codex(team): ${taskId} - ${task.title}`,
        ui,
        context: `task:${taskId}`,
      })
    }

    if (taskResult?.skipped) {
      ui.log(`task:${taskId} skipped by failure manager`)
    }
    completedTasks.add(taskId)
    taskExecution = recordCommittedTask({ taskExecution, taskId })
    await updateState(runDir, {
      tasks_completed: Array.from(completedTasks),
      task_execution: taskExecution,
    })
  }

  // review (integration)
  const reviewDir = path.join(runDir, 'phases', 'review')
  await checkpointBoundary('review', 'starting integration review')
  ui.log(`phase:review starting (dir=${reviewDir})`)
  let review = null
  let previousReview = null
  let previousDiffLines = null
  for (let attempt = 1; attempt <= maxReviewFixAttempts + 1; attempt += 1) {
    await checkpointBoundary('review', `starting integration review attempt ${attempt}`)
    const { summary, stats } = await getDiffSummary(repoRoot, baseSha)
    const currentDiffLines = totalChangedLines(stats)
    if (previousDiffLines != null) {
      const growthCheck = diffGrowthWithinLimit({
        previousLines: previousDiffLines,
        currentLines: currentDiffLines,
        maxGrowth: maxReviewDiffGrowthLines,
      })
      if (!growthCheck.ok) {
        await markRunFailed(runDir, {
          phase: 'integration_review',
          error: `Integration review diff growth exceeded max ${maxReviewDiffGrowthLines} lines (growth ${growthCheck.growth})`,
        })
        throw new Error(
          `Integration review diff growth exceeded max ${maxReviewDiffGrowthLines} lines (growth ${growthCheck.growth})`,
        )
      }
    }
    previousDiffLines = currentDiffLines

    review = await runReviewPhase({
      repoRoot,
      runDir,
      runId,
      reviewTarget: 'integration',
      taskText,
      baseSha,
      stepOutputPath: 'N/A',
      task: null,
      taskDir: null,
      verificationLogPaths: [],
      diffSummary: summary,
      previousReview,
      reviewPhaseName: 'review',
      reviewPhaseDir: reviewDir,
      attempt,
      options,
      policy,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })

    if (!reviewRequiresFix(review)) {
      break
    }

    if (attempt > maxReviewFixAttempts) {
      await markRunFailed(runDir, {
        phase: 'integration_review',
        error: 'Integration review failed after max fix attempts',
        blockingIssues: review?.blocking_issues,
      })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      throw new Error('Integration review failed after max fix attempts')
    }

    const issuesForTasks = getActionableBlockingIssues(review)
    if (issuesForTasks.length === 0) {
      await markRunFailed(runDir, {
        phase: 'integration_review',
        error: 'Integration review requested fixes without actionable blocking_issues',
      })
      throw new Error('Integration review requested fixes without actionable blocking_issues')
    }

    const pendingCycleDecision = planSyntheticCycleEnqueue({
      state: await readState(runDir),
      policy,
      unresolvedFailures: buildUnresolvedPostCycleFailuresFromIssues({
        issues: issuesForTasks,
        sourcePhase: 'integration_review',
      }),
    })
    if (!pendingCycleDecision.allowed) {
      await applySyntheticCyclePlan(runDir, pendingCycleDecision)
      ui.log(`WARN: ${pendingCycleDecision.warningMessage}`)
      syntheticCycleCapReached = true
      break
    }

    const allowedSyntheticTasks = []
    for (const [index, issue] of issuesForTasks.entries()) {
      const issueId = typeof issue?.id === 'string' && issue.id.trim() ? issue.id.trim() : `issue-${index + 1}`
      const issueFile =
        typeof issue?.file === 'string' && issue.file.trim() && issue.file.trim() !== 'N/A'
          ? issue.file.trim()
          : null

      const syntheticTask = {
        id: `review-fix-${attempt}-${index + 1}`,
        title: `Address review fix ${index + 1} (attempt ${attempt})`,
        type: 'refactor',
        description: `Fix integration review feedback for ${issueId}:\n${jsonStringifyForPrompt(issue)}`,
        acceptance_criteria: [`Fix: ${issueId}${issueFile ? ` (${issueFile})` : ''}`],
        dependencies: [],
        risk_level: 'medium',
        files: { create: [], modify: issueFile ? [issueFile] : [], delete: [] },
        verification_commands: [options.task_tests ?? options.tests],
      }

      const gateResult = await gateSyntheticTaskForEnqueue({
        task: syntheticTask,
        sourcePhase: 'integration_review',
        policy,
        architecture,
        mode: options.mode,
      })
      if (!gateResult.ok) {
        ui.log(`Synthetic task ${gateResult.blocked.id} blocked by gate: ${gateResult.blocked.reason}`)
        await appendSyntheticTaskBlocked(runDir, gateResult.blocked)
        if (gateResult.escalationQuestion) {
          addOpenQuestions(manifest, [gateResult.escalationQuestion])
          await appendMarkdown(path.join(runDir, 'open_questions.md'), [gateResult.escalationQuestion])
        }
        continue
      }

      allowedSyntheticTasks.push(syntheticTask)
    }

    if (allowedSyntheticTasks.length === 0) {
      previousReview = review
      continue
    }

    await applySyntheticCyclePlan(runDir, pendingCycleDecision)
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: 'integration_review',
      loop: 'review_fix_retry',
      attempt,
      budget: maxReviewFixAttempts,
      retryFamily: 'review_fix_retry',
      reviewTarget: 'integration',
      failureKind: 'integration_review_requested_changes',
    })

    for (const syntheticTask of allowedSyntheticTasks) {
      const taskResult = await runTaskWithReviewLoop({
        repoRoot,
        runId,
        runDir,
        taskText,
        analysis,
        architecture,
        taskGraph,
        planningContext,
        task: syntheticTask,
        policy,
        options,
        baselineKnownFailures,
        maxReviewFixAttempts,
        maxReviewDiffGrowthLines,
        initialReviewFeedback: formatReviewFeedback(review),
        manifest,
        resumePhaseSubstateIndex,
        ui,
      })

      if (!taskResult?.skipped && !options.no_commit) {
        await commitIfChanges({
          repoRoot,
          message: `codex(team): ${syntheticTask.id}`,
          ui,
          context: `task:${syntheticTask.id}`,
        })
      }
    }

    previousReview = review
  }

  await updateState(runDir, { state: 'INTEGRATION_REVIEW_DONE' })

  // tests + verification review
  if (!syntheticCycleCapReached) {
    await checkpointBoundary('verification', 'starting verification and verification review')
    const verificationResult = await runVerificationWithReviewLoop({
      repoRoot,
      runId,
      runDir,
      taskText,
      analysis,
      architecture,
      taskGraph,
      planningContext,
      baseSha,
      policy,
      options,
      baselineKnownFailures,
      maxReviewFixAttempts,
      maxReviewDiffGrowthLines,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })
    syntheticCycleCapReached = Boolean(verificationResult?.capped)
  }

  // summary
  const summaryDir = path.join(runDir, 'phases', 'summary')
  const statePathRel = path.relative(repoRoot, path.join(runDir, 'state.json'))
  const manifestPath = path.relative(repoRoot, path.join(runDir, 'manifest.json'))
  const assumptionsPathRel = path.relative(repoRoot, path.join(runDir, 'assumptions.md'))
  const openQuestionsPathRel = path.relative(repoRoot, path.join(runDir, 'open_questions.md'))
  const verificationLogCandidates = [
    path.join(runDir, 'verification', 'npm-test.log'),
    path.join(runDir, 'verification', 'coverage.log'),
    path.join(runDir, 'verification', 'audit.log'),
  ]
  const verificationLogPaths = []
  for (const candidate of verificationLogCandidates) {
    if (await fileExists(candidate)) {
      verificationLogPaths.push(path.relative(repoRoot, candidate))
    }
  }
  const verificationLogPathsText = verificationLogPaths.length > 0 ? verificationLogPaths.join('\n') : 'N/A'
  await checkpointBoundary('summary', 'starting summary generation')
  ui.log(`phase:summary starting (dir=${summaryDir})`)
  await runOrLoadPhase({
    phaseName: 'summary',
    phaseDir: summaryDir,
    promptFile: path.join(PROMPTS_DIR, '06-summary.md'),
    schemaFile: path.join(SCHEMAS_DIR, 'summary.schema.json'),
    promptVariables: {
      TASK: taskText.trim(),
      RUN_DIR: path.relative(repoRoot, runDir),
      STATE_PATH: statePathRel,
      MANIFEST_PATH: manifestPath,
      ASSUMPTIONS_PATH: assumptionsPathRel,
      OPEN_QUESTIONS_PATH: openQuestionsPathRel,
      VERIFICATION_LOG_PATHS: verificationLogPathsText,
    },
    sandbox: resolveReadOnlyPhaseSandbox(options),
    codexBin: options.codex_bin,
    repoRoot,
    search: options.search,
    noRedact: options.no_redact,
    policy,
    policyAllowlistMode: options.policy_allowlist_mode,
    maxPolicyGuidanceRetries: options.max_review_fix_attempts,
    manifest,
    runDir,
    runId,
    force: options.force,
    resumePhaseSubstateIndex,
    interactionContext: options?.interaction_context ?? null,
    ui,
  })
  const finalState = await readState(runDir)
  await updateState(runDir, {
    state: 'SUMMARY_DONE',
    final_status: normalizeSyntheticCycleState(finalState).final_status === 'partial' ? 'partial' : 'success',
  })

  await writeManifest(path.join(runDir, 'manifest.json'), manifest)
}

function resolveWorktreePaths(mainRepoRoot, branchName) {
  const { worktreeRelativePath } = resolveRunAndWorktreePaths({ branchName })
  return {
    relativePath: worktreeRelativePath,
    absolutePath: path.join(mainRepoRoot, worktreeRelativePath),
  }
}

async function maybeCopyLocalEnvFiles(mainRepoRoot, worktreeRoot) {
  const filenames = ['.env.test', '.env.test.local']

  for (const filename of filenames) {
    const fromPath = path.join(mainRepoRoot, filename)
    if (!(await fileExists(fromPath))) {
      continue
    }
    const toPath = path.join(worktreeRoot, filename)
    if (await fileExists(toPath)) {
      continue
    }
    await copyFile(fromPath, toPath)
    await chmod(toPath, 0o600)
  }
}

async function ensureWorktreeNodeModules(
  mainRepoRoot,
  worktreeRoot,
  depsMode,
  runDir,
  { interactionModel = 'phased', interactionContext = null, ui } = {},
) {
  if (depsMode === 'none') {
    return
  }

  const worktreeNodeModulesPath = path.join(worktreeRoot, 'node_modules')
  try {
    await lstat(worktreeNodeModulesPath)
    return
  } catch {
    // missing
  }

  const mainNodeModulesPath = path.join(mainRepoRoot, 'node_modules')
  const mainHasNodeModules = await fileExists(mainNodeModulesPath)

  const shouldLink = depsMode === 'link' || (depsMode === 'auto' && mainHasNodeModules)
  if (shouldLink && mainHasNodeModules) {
    const relativeTarget = path.relative(worktreeRoot, mainNodeModulesPath)
    await symlink(relativeTarget, worktreeNodeModulesPath, 'dir')
    return
  }

  const logPath = path.join(runDir, 'preflight', 'npm-ci.log')
  const result = await runInterruptibleShellCommand({
    command: 'npm ci --ignore-scripts',
    cwd: worktreeRoot,
    logPath,
    runDir,
    phaseName: 'preflight',
    ui,
    interactionModel,
    interactionContext,
  })
  if (result.exitCode !== 0) {
    throw new Error(`npm ci failed (see ${logPath})`)
  }
}

async function preflight(mainRepoRoot, runId, options, runDir, branchName, ui) {
  await updateState(runDir, { state: 'INIT' })

  await preflightPrereqs(options.codex_bin ?? 'codex', mainRepoRoot)

  let stashed = false
  const useWorktree = Boolean(options.worktree)
  if (!useWorktree) {
    const result = await ensureCleanWorkingTree(mainRepoRoot, {
      autostash: Boolean(options.autostash),
      stashMessage: `patch-gantry ${runId}`,
    })
    stashed = result.stashed
  }

  const gitAuthorName = options.git_author_name ?? 'PatchGantry'
  const gitAuthorEmail = options.git_author_email ?? 'patch-gantry@local'
  await ensureGitAuthorConfigured(mainRepoRoot, { name: gitAuthorName, email: gitAuthorEmail })

  const baseSha = await getHeadSha(mainRepoRoot)

  let executionRepoRoot = mainRepoRoot
  let worktreePath = null

  if (useWorktree) {
    const worktreePaths = resolveWorktreePaths(mainRepoRoot, branchName)
    await ensureDir(path.dirname(worktreePaths.absolutePath))
    await createWorktreeWithNewBranch(mainRepoRoot, {
      worktreePath: worktreePaths.absolutePath,
      branchName,
      baseRef: baseSha,
    })
    executionRepoRoot = worktreePaths.absolutePath
    worktreePath = worktreePaths.relativePath

    if (options.copy_env_files) {
      ui?.log?.('preflight: copying explicitly allowed test env files into the worktree')
      await maybeCopyLocalEnvFiles(mainRepoRoot, executionRepoRoot)
    }
    await ensureWorktreeNodeModules(mainRepoRoot, executionRepoRoot, options.worktree_deps, runDir, {
      interactionModel: options?.interaction_model ?? 'phased',
      interactionContext: options?.interaction_context ?? null,
      ui,
    })
  } else {
    await createAndCheckoutBranch(mainRepoRoot, branchName)
  }

  await updateState(runDir, {
    state: 'PREFLIGHT_OK',
    branch_name: branchName,
    base_sha: baseSha,
    worktree_path: worktreePath,
  })
  return { baseSha, autostashed: stashed, executionRepoRoot, worktreePath }
}

async function resolvePolicy(options, runDir) {
  const policy = await loadPolicy({
    policyName: options.policy,
    policyFilePath: options.policy_file,
    policiesDir: POLICIES_DIR,
    onWarning: (message) => {
      process.stderr.write(`[patch-gantry:policy] WARN: ${message}\n`)
    },
  })

  await writeJsonFile(path.join(runDir, 'policy.json'), policy)

  await updateState(runDir, { state: 'POLICY_READY' })
  return policy
}

async function loadTaskText(options) {
  if (options.task_file) {
    return await readTextFile(options.task_file)
  }
  if (options.task) {
    return options.task
  }
  throw new Error('Missing --task or --task-file')
}

async function resolveRunBranchName({ repoRoot, runDir, runId, taskText, options, interactionContext = null, ui = null }) {
  const strategy = options.branch_name_strategy ?? 'opaque'
  if (strategy === 'opaque') {
    return `patch-gantry/run-${runId}`
  }
  if (strategy === 'heuristic') {
    return makeRunBranchName({ runId, taskText })
  }

  try {
    await checkpointConversationBoundary({
      runDir,
      interactionModel: options?.interaction_model ?? 'phased',
      phaseName: 'branch_name',
      boundaryLabel: 'starting branch name selection',
      ui,
    })
    const words = await pickBranchDescriptorWordsWithCodex({
      codexBin: options.codex_bin ?? 'codex',
      repoRoot,
      runDir,
      taskText,
      model: options.model ?? null,
      runPhase: async ({
        codexBin,
        repoRoot,
        promptText,
        schemaPath,
        phaseDir,
        sandbox,
        search,
        model,
        reasoningEffort,
        noRedact,
        policy,
        onEventLine,
      }) =>
        await runCodexPhaseWithPolicyGuidanceRetry({
          phaseName: 'branch_name',
          codexBin,
          repoRoot,
          promptText,
          schemaPath,
          phaseDir,
          sandbox,
          search,
          model,
          reasoningEffort,
          noRedact,
          policy,
          policyAllowlistMode: 'off',
          maxPolicyGuidanceRetries: 0,
          onEventLine,
          runDir,
          manifest: null,
          runId,
          ui,
          interactionModel: options?.interaction_model ?? 'phased',
          interactionContext,
        }),
    })
    return `${words.join('-')}-${runId}`
  } catch (error) {
    if (error instanceof RunAbortedError) {
      throw error
    }
    return makeRunBranchName({ runId, taskText })
  }
}

async function persistCacheFingerprintDiagnostics({ phaseDir, existingMeta, fingerprintMismatch }) {
  if (!existingMeta || typeof existingMeta !== 'object' || Array.isArray(existingMeta)) {
    return
  }
  if (!fingerprintMismatch || typeof fingerprintMismatch !== 'object' || Array.isArray(fingerprintMismatch)) {
    return
  }

  const changedDimensions = Array.isArray(fingerprintMismatch.changed_dimensions)
    ? fingerprintMismatch.changed_dimensions
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []

  const nextMeta = {
    ...existingMeta,
    expected_fingerprint:
      typeof fingerprintMismatch.expected_fingerprint === 'string' ? fingerprintMismatch.expected_fingerprint : null,
    actual_fingerprint:
      typeof fingerprintMismatch.actual_fingerprint === 'string' ? fingerprintMismatch.actual_fingerprint : null,
    changed_dimensions: changedDimensions,
  }

  await writeJsonFile(path.join(phaseDir, 'meta.json'), nextMeta)
}

async function maybeLoadResumePhaseOutputCheckpoint({
  phaseName,
  phaseDir,
  attempt = null,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const hasCheckpoint = hasPhaseSubstateCheckpoint({
    index: resumePhaseSubstateIndex,
    phase: phaseName,
    substate: 'phase_output_validated',
    attempt,
  })
  if (!hasCheckpoint) {
    return null
  }

  const outputPath = path.join(phaseDir, 'output.json')
  if (!(await fileExists(outputPath))) {
    ui?.log?.(
      `phase:${phaseName} resume checkpoint found (phase_output_validated) but output.json is missing; rerunning`,
    )
    return null
  }

  try {
    const output = await readJsonFile(outputPath)
    return { output, outputPath }
  } catch {
    ui?.log?.(
      `phase:${phaseName} resume checkpoint found (phase_output_validated) but output.json is unreadable; rerunning`,
    )
    return null
  }
}

async function runOrLoadPhase({
  phaseName,
  phaseDir,
  promptFile,
  schemaFile,
  promptVariables,
  sandbox,
  reasoningEffort,
  codexBin,
  repoRoot,
  search,
  noRedact,
  policy,
  policyAllowlistMode,
  maxPolicyGuidanceRetries,
  manifest,
  runDir,
  runId,
  force,
  attempt = null,
  resumePhaseSubstateIndex = null,
  interactionContext = null,
  ui,
}) {
  const resumeCheckpoint = await maybeLoadResumePhaseOutputCheckpoint({
    phaseName,
    phaseDir,
    attempt,
    resumePhaseSubstateIndex,
    ui,
  })
  if (resumeCheckpoint) {
    ui?.log?.(`phase:${phaseName} resumed from checkpoint (phase_output_validated)`)
    updatePhase(manifest, phaseName, { status: 'resumed', output_path: resumeCheckpoint.outputPath })
    await writeManifest(path.join(runDir, 'manifest.json'), manifest)
    return resumeCheckpoint.output
  }

  await logPhaseSubstate({
    runDir,
    manifest,
    runId,
    phase: phaseName,
    substate: 'phase_started',
    attempt,
  })

  const template = await readTextFile(promptFile)
  const basePromptText = renderTemplate(template, promptVariables)
  const effectivePromptText = await buildPromptTextWithConversation({
    promptText: basePromptText,
    runDir,
    interactionModel: manifest?.runtime_config?.interaction_model ?? 'phased',
  })
  const schemaPath = schemaFile
  const schemaText = await readTextFile(schemaPath)
  const expectedInputFingerprint = createPhaseInputFingerprint({
    promptText: effectivePromptText,
    schemaText,
    runtimeConfig: manifest?.runtime_config ?? {},
    baseSha: manifest?.base_sha ?? '',
  })

  const cacheResult = await loadCachedPhaseWithDiagnostics({
    phaseDir,
    force,
    expectedInputFingerprint,
  })
  if (cacheResult.status === 'hit') {
    ui?.log?.(`phase:${phaseName} cached (dir=${phaseDir})`)
    updatePhase(manifest, phaseName, { status: 'cached', output_path: path.join(phaseDir, 'output.json') })
    await logPhaseSubstate({
      runDir,
      manifest,
      runId,
      phase: phaseName,
      substate: 'phase_output_validated',
      attempt,
    })
    return cacheResult.output
  }

  if (cacheResult.fingerprintMismatch && cacheResult.meta) {
    await persistCacheFingerprintDiagnostics({
      phaseDir,
      existingMeta: cacheResult.meta,
      fingerprintMismatch: cacheResult.fingerprintMismatch,
    })
  }

  if (cacheResult.status === 'fingerprint_mismatch') {
    const changedDimensions = Array.isArray(cacheResult.fingerprintMismatch?.changed_dimensions)
      ? cacheResult.fingerprintMismatch.changed_dimensions.join(',')
      : 'unknown'
    ui?.log?.(`phase:${phaseName} cache rejected (changed_dimensions=${changedDimensions})`)
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: phaseName,
      loop: 'cache_reuse',
      attempt: 1,
      budget: 1,
      retryFamily: 'cache_mismatch_retry',
    })
  }

  ui?.log?.(`phase:${phaseName} running (sandbox=${sandbox})`)
  updatePhase(manifest, phaseName, { status: 'running', started_at: new Date().toISOString() })
  await writeManifest(path.join(runDir, 'manifest.json'), manifest)

  const { output, meta } = await runCodexPhaseWithPolicyGuidanceRetry({
    phaseName,
    codexBin,
    repoRoot,
    promptText: basePromptText,
    schemaPath,
    phaseDir,
    sandbox,
    search,
    model: manifest?.runtime_config?.model ?? null,
    reasoningEffort,
    noRedact,
    policy,
    policyAllowlistMode,
    maxPolicyGuidanceRetries,
    onEventLine: ui?.onEventLine ?? null,
    runDir,
    manifest,
    runId,
    ui,
    inputFingerprint: expectedInputFingerprint,
    cacheFingerprintDiagnostics: cacheResult.fingerprintMismatch,
    interactionModel: manifest?.runtime_config?.interaction_model ?? 'phased',
    interactionContext,
  })

  updatePhase(manifest, phaseName, {
    status: 'completed',
    started_at: meta.started_at,
    ended_at: meta.ended_at,
    exit_code: meta.exit_code,
    session_id: meta.session_id ?? null,
    output_path: meta.output_path,
  })
  await writeManifest(path.join(runDir, 'manifest.json'), manifest)
  ui?.log?.(`phase:${phaseName} completed (dir=${phaseDir})`)
  await logPhaseSubstate({
    runDir,
    manifest,
    runId,
    phase: phaseName,
    substate: 'phase_output_validated',
    attempt,
  })

  return output
}

export async function runCodexPhaseWithPolicyGuidanceRetry({
  phaseName,
  codexBin,
  repoRoot,
  promptText,
  schemaPath,
  phaseDir,
  sandbox,
  search,
  model = null,
  reasoningEffort = null,
  noRedact,
  policy,
  policyAllowlistMode,
  maxPolicyGuidanceRetries,
  onEventLine,
  runDir,
  manifest,
  runId,
  ui,
  inputFingerprint = null,
  cacheFingerprintDiagnostics = null,
  interactionModel = 'phased',
  interactionContext = null,
}) {
  const resolvedModel = model ?? manifest?.runtime_config?.model ?? null
  const resolvedReasoningEffort = reasoningEffort ?? manifest?.runtime_config?.reasoning_effort ?? null
  let currentPromptBase = promptText
  let currentPrompt = await buildPromptTextWithConversation({ promptText: currentPromptBase, runDir, interactionModel })
  let policyGuidanceRetriesUsed = 0
  const retryLimit = resolvePolicyGuidanceRetryLimit(maxPolicyGuidanceRetries)

  while (true) {
    let interruptController = null
    try {
      if (interactionModel === 'conversational') {
        await waitForConversationControl({ runDir, phaseName, ui })
        await applyConversationUpdatesAtSafeBoundary({ runDir, phaseName, ui })
        currentPrompt = await buildPromptTextWithConversation({ promptText: currentPromptBase, runDir, interactionModel })
        interruptController = new AbortController()
        if (interactionContext) {
          interactionContext.currentInterruptController = interruptController
        }
        await setActiveConversationPhase(runDir, {
          phaseName,
          conversationState: 'awaiting_model',
        })
      }
      const result = await runCodexPhase({
        codexBin,
        repoRoot,
        promptText: currentPrompt,
        schemaPath,
        phaseDir,
        sandbox,
        search,
        model: resolvedModel,
        reasoningEffort: resolvedReasoningEffort,
        noRedact,
        policy,
        policyAllowlistMode,
        onEventLine,
        inputFingerprint,
        cacheFingerprintDiagnostics,
        interruptSignal: interruptController?.signal ?? null,
      })
      if (interactionModel === 'conversational') {
        await setConversationSessionId(runDir, result?.meta?.session_id ?? null)
      }
      return result
    } catch (error) {
      if (error instanceof CodexPhaseInterruptedError && interactionModel === 'conversational') {
        const stateAtInterrupt = await readConversationState(runDir)
        const interruptedByPause = stateAtInterrupt.control_state === 'paused'
        if (stateAtInterrupt.control_state === 'aborted') {
          throw new RunAbortedError(
            stateAtInterrupt.abort_reason ?? 'Run aborted from conversational control command.',
            phaseName,
          )
        }
        if (interruptedByPause) {
          await waitForConversationControl({ runDir, phaseName, ui })
        }

        const steeringMessages = await consumePendingSteeringMessages(runDir)
        const replanRequested = await consumePendingReplanRequest(runDir)
        const stateAfterInterrupt = await readConversationState(runDir)
        if (stateAfterInterrupt.control_state === 'aborted') {
          throw new RunAbortedError(
            stateAfterInterrupt.abort_reason ?? 'Run aborted from conversational control command.',
            phaseName,
          )
        }
        if (!interruptedByPause && steeringMessages.length === 0 && !replanRequested) {
          throw error
        }
        const reason = interruptedByPause ? 'pause' : replanRequested ? 'replan' : 'steering'
        ui?.log?.(`phase:${phaseName} interrupted by ${reason}; replaying with updated conversation context`)
        currentPrompt = await buildPromptTextWithConversation({ promptText: currentPromptBase, runDir, interactionModel })
        continue
      }
      const policyGuidance = formatPolicyViolationGuidanceBlock(error)
      if (!policyGuidance || policyGuidanceRetriesUsed >= retryLimit) {
        throw error
      }

      policyGuidanceRetriesUsed += 1
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: phaseName,
        loop: 'policy_guidance_retry',
        attempt: policyGuidanceRetriesUsed,
        budget: retryLimit,
        retryFamily: 'policy_guidance_retry',
        failureKind: error?.message ?? null,
      })
      ui?.log?.(
        `phase:${phaseName} policy violation; retrying with explicit forbidden-command guidance (${policyGuidanceRetriesUsed}/${retryLimit})`,
      )
      currentPromptBase = `${promptText}\n\n${policyGuidance}`
      currentPrompt = await buildPromptTextWithConversation({
        promptText: currentPromptBase,
        runDir,
        interactionModel,
      })
    } finally {
      if (interactionContext?.currentInterruptController === interruptController) {
        interactionContext.currentInterruptController = null
      }
      if (interactionModel === 'conversational') {
        await setActiveConversationPhase(runDir, { phaseName: null, conversationState: 'idle' })
      }
    }
  }
}

async function runWorkerTask({
  repoRoot,
  runId,
  runDir,
  taskText,
  analysis,
  architecture,
  taskGraph,
  task,
  planningContext,
  taskDirName,
  policy,
  options,
  baselineKnownFailures = [],
  taskDirOverride,
  cycleAttempt = null,
  reviewFeedback,
  verificationFeedback,
  manifest,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const taskDirBase = taskDirName ?? task.id
  const taskDir = taskDirOverride ?? path.join(runDir, 'phases', 'tasks', taskDirBase)
  await ensureDir(taskDir)
  await writeJsonFile(path.join(taskDir, 'task.json'), task)

  const shaBefore = await getHeadSha(repoRoot)

  const template = await readTextFile(path.join(PROMPTS_DIR, '03-worker-implement-task.md'))
  const runDirRel = path.relative(repoRoot, runDir)
  const analysisOutputPath = path.join(runDirRel, 'phases', 'analysis', 'output.json')
  const archOutputPath = path.join(runDirRel, 'phases', 'architecture', 'output.json')
  const taskGraphOutputPath = path.join(runDirRel, 'phases', 'task_graph', 'output.json')
  const taskDirRel = path.relative(repoRoot, taskDir)
  const contextBrief = formatWorkerContextBrief({ analysis, architecture })
  const taskGraphOverview = formatTaskGraphOverview(taskGraph)
  const userInput = await loadUserInputContext(runDir)

  if (manifest) {
    updatePhase(manifest, `tasks/${task.id}`, { status: 'running', started_at: new Date().toISOString() })
    await writeManifest(path.join(runDir, 'manifest.json'), manifest)
  }

  const maxWorkerAttempts = Number.isFinite(options?.max_worker_attempts) ? options.max_worker_attempts : 2
  let lastError = null
  let lastMeta = null

  for (let attempt = 1; attempt <= maxWorkerAttempts; attempt += 1) {
    const attemptDir = path.join(taskDir, 'attempts', String(attempt))
    const previousAttemptDir =
      attempt > 1 ? path.join(taskDir, 'attempts', String(attempt - 1)) : path.join(taskDir, 'attempts', '1')
    const continuation = formatWorkerContinuationBlock({
      attemptNumber: attempt,
      maxAttempts: maxWorkerAttempts,
      previousAttemptDir: path.relative(repoRoot, previousAttemptDir),
      error: lastError,
    })

    const attemptPhaseName = `tasks/${task.id}/attempt-${attempt}`
    if (manifest) {
      updatePhase(manifest, attemptPhaseName, { status: 'running', started_at: new Date().toISOString() })
      await writeManifest(path.join(runDir, 'manifest.json'), manifest)
    }

    let promptText
    try {
      promptText = renderTemplate(template, {
        TASK: taskText.trim(),
        RUN_ID: runId,
        RUN_DIR: runDirRel,
        ANALYSIS_OUTPUT_PATH: analysisOutputPath,
        ARCH_OUTPUT_PATH: archOutputPath,
        TASK_GRAPH_OUTPUT_PATH: taskGraphOutputPath,
        TASK_DIR: taskDirRel,
        CONTEXT_BRIEF: contextBrief,
        TASK_GRAPH_OVERVIEW: taskGraphOverview,
        TASK_ID: task.id,
        TASK_JSON: renderPromptJsonText(task, {
          options,
          label: 'TASK_JSON',
          phaseName: attemptPhaseName,
          failOnTruncation: true,
        }),
        PLANNING_CONTEXT_JSON: renderPromptJsonText(planningContext ?? {}, {
          options,
          label: 'PLANNING_CONTEXT_JSON',
          phaseName: attemptPhaseName,
          failOnTruncation: true,
        }),
        REVIEW_FEEDBACK: renderPromptText(reviewFeedback ?? '', { options, label: 'REVIEW_FEEDBACK' }),
        VERIFICATION_FEEDBACK: renderPromptText(verificationFeedback ?? '', {
          options,
          label: 'VERIFICATION_FEEDBACK',
        }),
        BASELINE_KNOWN_FAILURES: renderPromptJsonText(baselineKnownFailures, {
          options,
          label: 'BASELINE_KNOWN_FAILURES',
          phaseName: attemptPhaseName,
          failOnTruncation: true,
        }),
        CONTINUATION: continuation,
        USER_ANSWERS: userInput.userAnswers,
        USER_ANSWERS_DIRECTIVES: renderPromptJsonText(userInput.userAnswerDirectives ?? {}, {
          options,
          label: 'USER_ANSWERS_DIRECTIVES',
          phaseName: attemptPhaseName,
          failOnTruncation: true,
        }),
        OPEN_QUESTIONS: userInput.openQuestions,
      })
    } catch (error) {
      if (error instanceof PromptContextTruncationError) {
        if (manifest) {
          updatePhase(manifest, attemptPhaseName, { status: 'failed', error: String(error?.message ?? error) })
          await writeManifest(path.join(runDir, 'manifest.json'), manifest)
        }
        await markRunFailed(runDir, { phase: attemptPhaseName, error })
      }
      throw error
    }

    try {
      const { meta } = await runCodexPhaseWithPolicyGuidanceRetry({
        phaseName: attemptPhaseName,
        codexBin: options.codex_bin,
        repoRoot,
        promptText,
        schemaPath: path.join(SCHEMAS_DIR, 'worker-result.schema.json'),
        phaseDir: attemptDir,
        sandbox: options.sandbox,
        search: options.search,
        noRedact: options.no_redact,
        policy,
        policyAllowlistMode: options.policy_allowlist_mode,
        onEventLine: ui?.onEventLine ?? null,
        runDir,
        manifest,
        runId,
        ui,
        interactionModel: options?.interaction_model ?? 'phased',
        interactionContext: options?.interaction_context ?? null,
      })
      lastMeta = meta
      if (options?.interaction_model === 'conversational') {
        await setConversationSessionId(runDir, meta.session_id ?? null)
      }

      if (manifest) {
        updatePhase(manifest, attemptPhaseName, {
          status: 'completed',
          started_at: meta.started_at,
          ended_at: meta.ended_at,
          exit_code: meta.exit_code,
          session_id: meta.session_id ?? null,
          output_path: meta.output_path,
        })
        updatePhase(manifest, `tasks/${task.id}`, {
          status: 'completed',
          started_at: meta.started_at,
          ended_at: meta.ended_at,
          exit_code: meta.exit_code,
          session_id: meta.session_id ?? null,
          output_path: meta.output_path,
        })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      }
      break
    } catch (error) {
      lastError = error

      if (manifest) {
        updatePhase(manifest, attemptPhaseName, { status: 'failed', error: String(error?.message ?? error) })
        await writeManifest(path.join(runDir, 'manifest.json'), manifest)
      }

      const shaAfterAttempt = await getHeadSha(repoRoot)
      if (shaAfterAttempt !== shaBefore) {
        throw new Error('Worker phase created git commits (forbidden by orchestrator policy)')
      }

      await enforceRepoPolicy(repoRoot, policy)

      const retryable = isRetryableCodexPhaseError(error)
      if (!retryable || attempt >= maxWorkerAttempts) {
        throw error
      }
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: `task:${task.id}`,
        loop: 'worker_retry',
        attempt,
        budget: maxWorkerAttempts,
        retryFamily: 'worker_retry',
        taskId: task.id,
        failureKind: error?.message ?? null,
      })
      ui?.log?.(`task:${task.id} failed; retrying worker phase (attempt ${attempt + 1}/${maxWorkerAttempts})`)
    }
  }

  if (!lastMeta) {
    throw lastError ?? new Error('Worker phase failed')
  }

  const shaAfter = await getHeadSha(repoRoot)
  if (shaAfter !== shaBefore) {
    throw new Error('Worker phase created git commits (forbidden by orchestrator policy)')
  }

  await enforceRepoPolicy(repoRoot, policy)

  const outputPath = lastMeta.output_path ?? null
  const output = outputPath ? await readJsonFile(outputPath) : null
  await logPhaseSubstate({
    runDir,
    manifest,
    runId,
    phase: `task:${task.id}`,
    substate: 'phase_output_validated',
  })
  const outputStatus = output?.status
  const outputQuestions = extractWorkerQuestions(output)
  const partialNeedsInput = outputStatus === 'partial' && outputQuestions.length > 0
  if (isWorkerStatusBlocking(outputStatus) || partialNeedsInput) {
    ui?.log?.(`task:${task.id} reported ${outputStatus ?? 'unknown'} status; awaiting user input`)
    return { taskDir, outputPath, output, blocked: true }
  }
  if (outputStatus === 'partial') {
    ui?.log?.(`task:${task.id} reported partial status without blocking questions; continuing`)
  }

  await verifyTaskCommands(repoRoot, runDir, runId, task, taskText, options, policy, manifest, ui, taskDir, {
    cycleAttempt,
    resumePhaseSubstateIndex,
  })
  ui?.log?.(`task:${task.id} completed`)

  return { taskDir, outputPath, output, blocked: false }
}

async function runTaskWithReviewLoop({
  repoRoot,
  runId,
  runDir,
  taskText,
  analysis,
  architecture,
  taskGraph,
  task,
  planningContext,
  taskDirName,
  policy,
  options,
  baselineKnownFailures = [],
  maxReviewFixAttempts,
  maxReviewDiffGrowthLines,
  initialReviewFeedback,
  initialVerificationFeedback,
  manifest,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const taskBaseSha = await getHeadSha(repoRoot)
  const taskDirBase = taskDirName ?? task.id
  const replayEvents = await readResumeJournalEvents({ runDir })
  const replayState = deriveTaskReplayState({ events: replayEvents, taskId: task.id })
  const journalRunId = resolveJournalRunId(manifest, runId)
  let reviewFeedback = initialReviewFeedback ?? ''
  let verificationFeedback = initialVerificationFeedback ?? ''
  let previousReview = null
  let previousDiffLines = null
  const loopLimits = deriveTaskLoopLimits({ maxReviewFixAttempts })
  let reviewFixAttemptsUsed = 0
  let verificationRetriesUsed = 0
  let autoResolveAttemptsUsed = replayState.autoResolveAttemptsUsed
  let managerAttemptsUsed = replayState.managerAttemptsUsed
  const autoResolveReplayMarkerIds = new Set(replayState.autoResolveReplayMarkerIds)

  const runManagerRecoveryForTask = async ({
    failureKind,
    reason,
    questions = [],
    blockingIssues = [],
    review = null,
    verificationLogPath = null,
    verificationCommand = null,
  } = {}) => {
    if (managerAttemptsUsed >= loopLimits.maxManagerAttempts) {
      await escalateFailureToUser({
        runDir,
        manifest,
        options,
        ui,
        taskId: task.id,
        questions,
        fallbackReason: `Failure manager attempt budget exhausted (${loopLimits.maxManagerAttempts}). ${reason || ''}`.trim(),
      })
      return { outcome: 'continue' }
    }

    managerAttemptsUsed += 1
    return await runFailureManagerRecovery({
      repoRoot,
      runDir,
      runId,
      taskText,
      task,
      taskDirBase,
      failureContext: {
        failure_kind: failureKind ?? 'unknown_failure',
        reason: reason ?? '',
        task_id: task.id,
        questions_context: Array.isArray(questions) ? questions : [],
        task_context: {
          required: task.required === true,
          affects_schema: task.affects_schema === true,
          affects_migrations: task.affects_migrations === true,
        },
        manager_attempt: managerAttemptsUsed,
        manager_attempt_budget: loopLimits.maxManagerAttempts,
        review_fix_attempts_used: reviewFixAttemptsUsed,
        review_fix_attempt_budget: loopLimits.maxReviewFixAttempts,
        verification_retries_used: verificationRetriesUsed,
        verification_retry_budget: loopLimits.maxVerificationRetries,
        auto_resolve_attempts_used: autoResolveAttemptsUsed,
        auto_resolve_attempt_budget: loopLimits.maxAutoResolveAttempts,
        blocking_issues: blockingIssues,
        review,
        verification: {
          command: verificationCommand ?? null,
          log_path: verificationLogPath ?? null,
        },
      },
      managerAttempt: managerAttemptsUsed,
      options,
      policy,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })
  }

  for (let cycleAttempt = 1; cycleAttempt <= loopLimits.maxCycles; cycleAttempt += 1) {
    await checkpointConversationBoundary({
      runDir,
      interactionModel: options?.interaction_model ?? 'phased',
      phaseName: `task:${task.id}`,
      boundaryLabel: `starting task loop cycle ${cycleAttempt} for ${task.id}`,
      ui,
    })
    await logPhaseSubstate({
      runDir,
      manifest,
      runId,
      phase: `task:${task.id}`,
      substate: 'phase_started',
      attempt: cycleAttempt,
    })
    const taskDir = path.join(runDir, 'phases', 'tasks', taskDirBase, 'review_attempts', String(cycleAttempt))
    let workerResult = null

    try {
      workerResult = await runWorkerTask({
        repoRoot,
        runId,
        runDir,
        taskText,
        analysis,
        architecture,
        taskGraph,
        task,
        planningContext,
        taskDirName: taskDirBase,
        policy,
        options,
        baselineKnownFailures,
        taskDirOverride: taskDir,
        cycleAttempt,
        reviewFeedback,
        verificationFeedback,
        manifest,
        resumePhaseSubstateIndex,
        ui,
      })
    } catch (error) {
      if (!(error instanceof VerificationError)) {
        throw error
      }

      const { summary, stats } = await getDiffSummary(repoRoot, taskBaseSha)
      const currentDiffLines = totalChangedLines(stats)
      if (previousDiffLines != null) {
        const growthCheck = diffGrowthWithinLimit({
          previousLines: previousDiffLines,
          currentLines: currentDiffLines,
          maxGrowth: maxReviewDiffGrowthLines,
        })
        if (!growthCheck.ok) {
          await markRunFailed(runDir, {
            phase: `task:${task.id}`,
            error: `Task ${task.id} diff growth exceeded max ${maxReviewDiffGrowthLines} lines (growth ${growthCheck.growth})`,
          })
          throw new Error(
            `Task ${task.id} diff growth exceeded max ${maxReviewDiffGrowthLines} lines (growth ${growthCheck.growth})`,
          )
        }
      }
      previousDiffLines = currentDiffLines

      verificationRetriesUsed += 1
      if (verificationRetriesUsed > loopLimits.maxVerificationRetries) {
        const recovery = await runManagerRecoveryForTask({
          failureKind: 'task_verification_retry_exhausted',
          reason: `Verification retry budget exceeded for task ${task.id}.`,
          verificationLogPath: error.logPath ?? null,
          verificationCommand: error.command ?? null,
        })
        if (recovery.outcome === 'abort') {
          throw new Error(`Failure manager aborted recovery for task ${task.id}`)
        }
        if (recovery.outcome === 'skip_task') {
          return { skipped: true, decision: recovery.decision }
        }
        if (recovery.outcome === 'retry_with_feedback') {
          reviewFeedback = recovery.decision.review_feedback || reviewFeedback
          verificationFeedback = recovery.decision.verification_feedback || verificationFeedback
          await logRetryTelemetry({
            runDir,
            manifest,
            runId,
            phase: `task:${task.id}`,
            loop: 'failure_manager_retry',
            attempt: managerAttemptsUsed,
            budget: loopLimits.maxManagerAttempts,
            retryFamily: 'failure_manager_retry',
            taskId: task.id,
            failureKind: 'task_verification_retry_exhausted',
          })
        }
        verificationRetriesUsed = 0
        continue
      }

      let logText = ''
      if (error.logPath && (await fileExists(error.logPath))) {
        logText = await readTextFile(error.logPath)
      }
      verificationFeedback = buildVerificationFeedback({
        command: error.command,
        logPath: error.logPath,
        logText,
        diffSummary: summary,
        options,
      })

      ui?.log?.(
        `task:${task.id} verification failed; retrying with feedback (${verificationRetriesUsed}/${loopLimits.maxVerificationRetries})`,
      )
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: `task:${task.id}`,
        loop: 'verification_retry',
        attempt: verificationRetriesUsed,
        budget: loopLimits.maxVerificationRetries,
        retryFamily: 'verification_retry',
        taskId: task.id,
        failureKind: 'verification_failed',
      })
      continue
    }

    verificationRetriesUsed = 0

    if (workerResult?.blocked) {
      const questionPayloads = extractWorkerQuestionPayloads(workerResult.output)
      const questions = extractQuestionTexts(questionPayloads)
      if (questions.length > 0) {
        addOpenQuestions(manifest, questions)
        await appendMarkdown(path.join(runDir, 'open_questions.md'), questions)
      }
      const blockedAction = decideWorkerBlockedAction({ mode: options.mode, questions: questionPayloads })
      if (blockedAction === 'auto-resolve') {
        const questionSignature = createQuestionSetSignature(questionPayloads)
        let autoResolveReplayMarkerId = null
        if (questionSignature) {
          autoResolveReplayMarkerId = buildAutoResolveReplayMarkerId({
            taskId: task.id,
            questionSetSignature: questionSignature,
          })
        }
        if (autoResolveReplayMarkerId && !autoResolveReplayMarkerIds.has(autoResolveReplayMarkerId)) {
          autoResolveAttemptsUsed += 1
          if (autoResolveAttemptsUsed > loopLimits.maxAutoResolveAttempts) {
            const recovery = await runManagerRecoveryForTask({
              failureKind: 'task_auto_resolve_exhausted',
              reason: `Auto-resolve attempts exceeded (${loopLimits.maxAutoResolveAttempts}) for task ${task.id}.`,
              questions: questionPayloads,
            })
            if (recovery.outcome === 'abort') {
              throw new Error(`Failure manager aborted recovery for task ${task.id}`)
            }
            if (recovery.outcome === 'skip_task') {
              return { skipped: true, decision: recovery.decision }
            }
            if (recovery.outcome === 'retry_with_feedback') {
              reviewFeedback = recovery.decision.review_feedback || reviewFeedback
              verificationFeedback = recovery.decision.verification_feedback || verificationFeedback
              await logRetryTelemetry({
                runDir,
                manifest,
                runId,
                phase: `task:${task.id}`,
                loop: 'failure_manager_retry',
                attempt: managerAttemptsUsed,
                budget: loopLimits.maxManagerAttempts,
                retryFamily: 'failure_manager_retry',
                taskId: task.id,
                failureKind: 'task_auto_resolve_exhausted',
              })
            }
            autoResolveAttemptsUsed = 0
            continue
          }

          const autoAnswers = buildAutonomousFallbackAnswersBlock(questionPayloads)
          await appendUserAnswers(runDir, autoAnswers, questionPayloads)
          autoResolveReplayMarkerIds.add(autoResolveReplayMarkerId)
          if (journalRunId) {
            await appendRecoveryMarkerEvent({
              runDir,
              runId: journalRunId,
              phase: `task:${task.id}`,
              recoveryTaskId: autoResolveReplayMarkerId,
              attempt: autoResolveAttemptsUsed,
            })
          }
          ui?.log?.(
            `task:${task.id} appended autonomous fallback answers (${autoResolveAttemptsUsed}/${loopLimits.maxAutoResolveAttempts})`,
          )
          await logRetryTelemetry({
            runDir,
            manifest,
            runId,
            phase: `task:${task.id}`,
            loop: 'auto_resolve_retry',
            attempt: autoResolveAttemptsUsed,
            budget: loopLimits.maxAutoResolveAttempts,
            retryFamily: 'auto_resolve_retry',
            taskId: task.id,
          })
        } else if (autoResolveReplayMarkerId && autoResolveReplayMarkerIds.has(autoResolveReplayMarkerId)) {
          ui?.log?.(`task:${task.id} skipped duplicate autonomous fallback answers from resume replay guard`)
        }

        const reasons = questions.length > 0 ? questions : ['Worker reported blocked status.']
        const resolution = await runResolveBlockPhase({
          repoRoot,
          runDir,
          runId,
          taskText,
          phaseName: `task:${task.id}`,
          phaseOutput: workerResult.output,
          gate: { status: 'needs_user_input', reasons, questions: questionPayloads },
          policy,
          manifest,
          options,
          resumePhaseSubstateIndex,
          ui,
        })

        if (!resolution?.can_proceed) {
          const recovery = await runManagerRecoveryForTask({
            failureKind: 'task_resolve_block_unmitigable',
            reason: `Resolve-block reported can_proceed=false for task ${task.id}.`,
            questions: questionPayloads.length > 0 ? questionPayloads : reasons,
          })
          if (recovery.outcome === 'abort') {
            await updateState(runDir, { state: 'STOPPED_BLOCKED' })
            await writeManifest(path.join(runDir, 'manifest.json'), manifest)
            throw new Error(`Task ${task.id} blocked (unmitigable)`)
          }
          if (recovery.outcome === 'skip_task') {
            return { skipped: true, decision: recovery.decision }
          }
          if (recovery.outcome === 'retry_with_feedback') {
            reviewFeedback = recovery.decision.review_feedback || reviewFeedback
            verificationFeedback = recovery.decision.verification_feedback || verificationFeedback
            await logRetryTelemetry({
              runDir,
              manifest,
              runId,
              phase: `task:${task.id}`,
              loop: 'failure_manager_retry',
              attempt: managerAttemptsUsed,
              budget: loopLimits.maxManagerAttempts,
              retryFamily: 'failure_manager_retry',
              taskId: task.id,
              failureKind: 'task_resolve_block_unmitigable',
            })
          }
          continue
        }

        const diff = mergePlanningContextWithDiff(planningContext, resolution)
        addAssumptions(manifest, diff.assumptions)
        addMitigations(manifest, diff.mitigations)
        addTaskHints(manifest, diff.task_hints)
        await appendMarkdown(path.join(runDir, 'assumptions.md'), diff.assumptions)
        await appendMarkdown(path.join(runDir, 'mitigations.md'), diff.mitigations)
        await appendMarkdown(path.join(runDir, 'task_hints.md'), diff.task_hints)
        continue
      }

      await updateState(runDir, { state: 'WAITING_FOR_USER_INPUT' })
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: `task:${task.id}`,
        loop: 'gate_wait_for_user',
        attempt: cycleAttempt,
        budget: loopLimits.maxCycles,
        retryFamily: 'gate_wait_for_user',
        taskId: task.id,
      })
      options.interaction_context.pendingQuestionPhase = `task:${task.id}`
      await waitForUserAnswers({ runDir, questions, ui, options })
      options.interaction_context.pendingQuestionPhase = null
      continue
    }

    const { summary, stats } = await getDiffSummary(repoRoot, taskBaseSha)
    const currentDiffLines = totalChangedLines(stats)
    if (previousDiffLines != null) {
      const growthCheck = diffGrowthWithinLimit({
        previousLines: previousDiffLines,
        currentLines: currentDiffLines,
        maxGrowth: maxReviewDiffGrowthLines,
      })
      if (!growthCheck.ok) {
        await markRunFailed(runDir, {
          phase: `task:${task.id}`,
          error: `Task ${task.id} diff growth exceeded max ${maxReviewDiffGrowthLines} lines (growth ${growthCheck.growth})`,
        })
        throw new Error(
          `Task ${task.id} diff growth exceeded max ${maxReviewDiffGrowthLines} lines (growth ${growthCheck.growth})`,
        )
      }
    }
    previousDiffLines = currentDiffLines

    const reviewDir = path.join(runDir, 'phases', 'tasks', taskDirBase, 'review')
    const verificationLogPath = path.join(workerResult.taskDir, 'verify.log')
    const verificationLogPaths = (await fileExists(verificationLogPath))
      ? [path.relative(repoRoot, verificationLogPath)]
      : []
    const review = await runReviewPhase({
      repoRoot,
      runDir,
      runId,
      reviewTarget: `task:${task.id}`,
      taskText,
      baseSha: taskBaseSha,
      stepOutputPath: workerResult.outputPath ? path.relative(repoRoot, workerResult.outputPath) : 'N/A',
      task,
      taskDir: path.relative(repoRoot, workerResult.taskDir),
      verificationLogPaths,
      diffSummary: summary,
      previousReview,
      reviewPhaseName: `tasks/${task.id}/review`,
      reviewPhaseDir: reviewDir,
      attempt: cycleAttempt,
      options,
      policy,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })

    if (!reviewRequiresFix(review)) {
      return
    }

    const actionableBlockingIssues = getActionableBlockingIssues(review)
    if (actionableBlockingIssues.length === 0) {
      const recovery = await runManagerRecoveryForTask({
        failureKind: 'task_review_non_actionable',
        reason: `Task review requested fixes without actionable blocking issues for ${task.id}.`,
        review,
      })
      if (recovery.outcome === 'abort') {
        throw new Error(`Failure manager aborted recovery for task ${task.id}`)
      }
      if (recovery.outcome === 'skip_task') {
        return { skipped: true, decision: recovery.decision }
      }
      if (recovery.outcome === 'retry_with_feedback') {
        reviewFeedback = recovery.decision.review_feedback || reviewFeedback
        verificationFeedback = recovery.decision.verification_feedback || verificationFeedback
        await logRetryTelemetry({
          runDir,
          manifest,
          runId,
          phase: `task:${task.id}`,
          loop: 'task_review_non_actionable',
          attempt: managerAttemptsUsed,
          budget: loopLimits.maxManagerAttempts,
          retryFamily: 'review_non_actionable_retry',
          taskId: task.id,
          reviewTarget: `task:${task.id}`,
          failureKind: 'task_review_non_actionable',
        })
      }
      continue
    }

    if (reviewFixAttemptsUsed >= loopLimits.maxReviewFixAttempts) {
      const recovery = await runManagerRecoveryForTask({
        failureKind: 'task_review_fix_exhausted',
        reason: `Task review fix attempt budget exhausted for ${task.id}.`,
        review,
        blockingIssues: actionableBlockingIssues,
      })
      if (recovery.outcome === 'abort') {
        await markRunFailed(runDir, {
          phase: `task:${task.id}`,
          error: `Task ${task.id} review failed after max fix attempts`,
          blockingIssues: actionableBlockingIssues,
        })
        throw new Error(`Failure manager aborted recovery for task ${task.id}`)
      }
      if (recovery.outcome === 'skip_task') {
        return { skipped: true, decision: recovery.decision }
      }
      if (recovery.outcome === 'retry_with_feedback') {
        reviewFeedback = recovery.decision.review_feedback || reviewFeedback
        verificationFeedback = recovery.decision.verification_feedback || verificationFeedback
        await logRetryTelemetry({
          runDir,
          manifest,
          runId,
          phase: `task:${task.id}`,
          loop: 'failure_manager_retry',
          attempt: managerAttemptsUsed,
          budget: loopLimits.maxManagerAttempts,
          retryFamily: 'failure_manager_retry',
          taskId: task.id,
          reviewTarget: `task:${task.id}`,
          failureKind: 'task_review_fix_exhausted',
        })
      }
      continue
    }
    reviewFixAttemptsUsed += 1

    reviewFeedback = formatReviewFeedback(review)
    verificationFeedback = ''
    previousReview = review
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: `task:${task.id}`,
      loop: 'task_review_fix_retry',
      attempt: reviewFixAttemptsUsed,
      budget: loopLimits.maxReviewFixAttempts,
      retryFamily: 'review_fix_retry',
      taskId: task.id,
      reviewTarget: `task:${task.id}`,
      failureKind: 'task_review_requested_changes',
    })
    ui?.log?.(
      `task:${task.id} review requested fixes; retrying (${reviewFixAttemptsUsed}/${loopLimits.maxReviewFixAttempts})`,
    )
  }

  await markRunFailed(runDir, {
    phase: `task:${task.id}`,
    error: `Task ${task.id} exceeded max task-loop cycles (${loopLimits.maxCycles})`,
  })
  const recovery = await runManagerRecoveryForTask({
    failureKind: 'task_loop_cycles_exhausted',
    reason: `Task ${task.id} exceeded max loop cycles (${loopLimits.maxCycles}).`,
  })
  if (recovery.outcome === 'abort') {
    throw new Error(`Failure manager aborted recovery for task ${task.id}`)
  }
  if (recovery.outcome === 'skip_task') {
    return { skipped: true, decision: recovery.decision }
  }
  throw new Error(`Task ${task.id} exceeded max task-loop cycles (${loopLimits.maxCycles})`)
}

async function verifyTaskCommands(
  repoRoot,
  runDir,
  runId,
  task,
  taskText,
  options,
  policy,
  manifest,
  ui,
  taskDir,
  { cycleAttempt = null, resumePhaseSubstateIndex = null } = {},
) {
  const verificationDir = taskDir ?? path.join(runDir, 'phases', 'tasks', task.id)
  const logPath = path.join(verificationDir, 'verify.log')
  const relativeLogPath = path.relative(repoRoot, logPath)
  const journalRunId = resolveJournalRunId(manifest, runId)
  const normalizedCycleAttempt = Number.isFinite(cycleAttempt) ? Math.max(1, Math.trunc(cycleAttempt)) : null
  const maxTailChars = 16000

  const hasResumeCheckpoint = hasPhaseSubstateCheckpoint({
    index: resumePhaseSubstateIndex,
    phase: `task:${task.id}`,
    substate: 'phase_verification_completed',
    attempt: normalizedCycleAttempt,
  })
  if (hasResumeCheckpoint) {
    if (await fileExists(logPath)) {
      ui?.log?.(
        `task:${task.id} resumed from checkpoint (phase_verification_completed${normalizedCycleAttempt ? ` attempt=${normalizedCycleAttempt}` : ''}); skipping verification commands`,
      )
      return
    }
    ui?.log?.(
      `task:${task.id} resume checkpoint found for verification but verify.log is missing; rerunning verification commands`,
    )
  }

  const buildFixTestsContext = async (outputTail) => {
    let tail = typeof outputTail === 'string' ? outputTail : ''
    if (!tail) {
      try {
        tail = await readTextFile(logPath)
      } catch {
        tail = ''
      }
    }
    if (tail.length > maxTailChars) {
      tail = tail.slice(-maxTailChars)
    }
    const trimmed = tail.trim()
    return [
      `Log path: ${logPath}`,
      'Log tail:',
      trimmed ? trimmed : '(no output captured)',
    ].join('\n')
  }

  const commands = Array.isArray(task.verification_commands) ? task.verification_commands : []
  for (const command of commands) {
    let commandAttempt = 1
    const runVerificationCommand = async () => {
      const startedAt = new Date().toISOString()
      const result = await runInterruptibleShellCommand({
        command,
        cwd: repoRoot,
        logPath,
        runDir,
        phaseName: `task:${task.id}:verification`,
        ui,
        interactionModel: options?.interaction_model ?? 'phased',
        interactionContext: options?.interaction_context ?? null,
      })
      const endedAt = new Date().toISOString()
      if (journalRunId) {
        await appendVerificationCommandEvent({
          runDir,
          runId: journalRunId,
          phase: `task:${task.id}`,
          command,
          startedAt,
          endedAt,
          exitCode: result.exitCode,
          logPath: relativeLogPath,
          attempt: commandAttempt,
        })
      }
      commandAttempt += 1
      return result
    }

    ui?.log?.(`task:${task.id} verify running (${command}) (log=${logPath})`)
    let result = await runVerificationCommand()
    if (result.exitCode === 0) continue

    let lastOutput = await buildFixTestsContext(result.output)
    let fixed = false

    for (let attempt = 1; attempt <= options.max_fix_attempts; attempt += 1) {
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: `task:${task.id}`,
        loop: 'verification_retry',
        attempt,
        budget: options.max_fix_attempts,
        retryFamily: 'verification_retry',
        taskId: task.id,
        failureKind: 'verification_command_failed',
      })
      ui?.log?.(`task:${task.id} verify failed; attempting fix_tests (attempt ${attempt}/${options.max_fix_attempts})`)
      await runFixTestsOnce(repoRoot, runDir, runId, taskText, lastOutput, options, policy, manifest, ui)
      result = await runVerificationCommand()
      if (result.exitCode === 0) {
        fixed = true
        break
      }
      lastOutput = await buildFixTestsContext(result.output)
    }

    if (!fixed) {
      throw new VerificationError(
        `Verification command failed after ${options.max_fix_attempts} fix attempt(s): ${command}`,
        { command, logPath },
      )
    }
  }

  await logPhaseSubstate({
    runDir,
    manifest,
    runId,
    phase: `task:${task.id}`,
    substate: 'phase_verification_completed',
    attempt: normalizedCycleAttempt,
  })
}

async function runFixTestsOnce(repoRoot, runDir, runId, taskText, testOutput, options, policy, manifest, ui) {
  const attemptNumber = await nextFixAttempt(runDir)
  const fixDir = path.join(runDir, 'phases', 'fix_tests', String(attemptNumber))

  const template = await readTextFile(path.join(PROMPTS_DIR, '05-fix-tests.md'))
  const promptText = renderTemplate(template, {
    TASK: taskText.trim(),
    TEST_OUTPUT: testOutput,
  })

  const shaBefore = await getHeadSha(repoRoot)
  if (manifest) {
    updatePhase(manifest, `fix_tests/${attemptNumber}`, { status: 'running', started_at: new Date().toISOString() })
    await writeManifest(path.join(runDir, 'manifest.json'), manifest)
  }
  const { meta } = await runCodexPhaseWithPolicyGuidanceRetry({
    phaseName: `fix_tests/${attemptNumber}`,
    codexBin: options.codex_bin,
    repoRoot,
    promptText,
    schemaPath: path.join(SCHEMAS_DIR, 'fix-tests.schema.json'),
    phaseDir: fixDir,
    sandbox: options.sandbox,
    search: options.search,
    noRedact: options.no_redact,
    policy,
    policyAllowlistMode: options.policy_allowlist_mode,
    maxPolicyGuidanceRetries: options.max_review_fix_attempts,
    onEventLine: ui?.onEventLine ?? null,
    runDir,
    manifest,
    runId,
    ui,
    interactionModel: options?.interaction_model ?? 'phased',
    interactionContext: options?.interaction_context ?? null,
  })
  if (manifest) {
    updatePhase(manifest, `fix_tests/${attemptNumber}`, {
      status: 'completed',
      started_at: meta.started_at,
      ended_at: meta.ended_at,
      exit_code: meta.exit_code,
      session_id: meta.session_id ?? null,
      output_path: meta.output_path,
    })
    await writeManifest(path.join(runDir, 'manifest.json'), manifest)
  }
  const shaAfter = await getHeadSha(repoRoot)
  if (shaAfter !== shaBefore) {
    throw new Error('Fix-tests phase created git commits (forbidden)')
  }

  await enforceRepoPolicy(repoRoot, policy)
}

async function runBaselineVerificationPhase({ repoRoot, runDir, runId, options, manifest, ui }) {
  const existingState = await readState(runDir)
  const existingBaseline = existingState?.baseline_verification
  if (existingBaseline && typeof existingBaseline === 'object') {
    return existingBaseline
  }

  const completedTasks = Array.isArray(existingState?.tasks_completed) ? existingState.tasks_completed : []
  const baselineCanRunFresh = existingState?.state === 'TASK_GRAPH_DONE'
  if (!baselineCanRunFresh || completedTasks.length > 0) {
    const fallback = buildBaselineVerificationFallback()
    ui?.log?.(
      'phase:baseline_verification missing in legacy resume state after work may have started; defaulting to passed=true with no known failures',
    )
    await updateState(runDir, {
      baseline_verification: fallback,
      state: 'BASELINE_VERIFICATION_DONE',
    })
    return fallback
  }

  const ignoredSkipFlags = getBaselineSkipFlags(options)
  if (ignoredSkipFlags.length > 0) {
    ui?.log?.(`phase:baseline_verification ignoring skip flags and running anyway (${ignoredSkipFlags.join(', ')})`)
  }

  await updateState(runDir, { state: 'BASELINE_VERIFYING' })

  const phaseDir = path.join(runDir, 'phases', 'baseline_verification')
  await ensureDir(phaseDir)

  const commandPlan = await resolveVerificationCommandPlanForRepo(repoRoot, options)
  const rawResults = []

  for (const step of commandPlan) {
    const logPath = path.join(phaseDir, step.logFile)
    ui?.log?.(`baseline_verification:${step.label} running (${step.command}) (log=${logPath})`)
    const startedAt = new Date().toISOString()
    const result = await runInterruptibleShellCommand({
      command: step.command,
      cwd: repoRoot,
      logPath,
      runDir,
      phaseName: 'baseline_verification',
      ui,
      interactionModel: options?.interaction_model ?? 'phased',
      interactionContext: options?.interaction_context ?? null,
    })
    const endedAt = new Date().toISOString()

    rawResults.push({
      command: step.command,
      exitCode: result.exitCode,
      output: result.output,
    })

    const journalRunId = resolveJournalRunId(manifest, runId)
    if (journalRunId) {
      await appendVerificationCommandEvent({
        runDir,
        runId: journalRunId,
        phase: 'baseline_verification',
        command: step.command,
        startedAt,
        endedAt,
        exitCode: result.exitCode,
        logPath: path.relative(repoRoot, logPath),
        attempt: 1,
      })
    }
  }

  const baselineVerification = {
    passed: rawResults.every((result) => result.exitCode === 0),
    commands_run: rawResults.map((result) => result.command),
    results: rawResults.map((result) => ({
      command: result.command,
      exit_code: result.exitCode,
      output_summary: summarizeCommandOutput(result.output),
    })),
    known_failures: collectKnownFailureIds(rawResults),
  }

  await updateState(runDir, {
    baseline_verification: baselineVerification,
    state: 'BASELINE_VERIFICATION_DONE',
  })

  return baselineVerification
}

async function runVerificationSuite({
  repoRoot,
  runDir,
  runId,
  options,
  manifest,
  attempt = null,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const verificationDir = path.join(runDir, 'verification')
  await ensureDir(verificationDir)
  const journalRunId = resolveJournalRunId(manifest, runId)
  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : null
  const commandPlan = await resolveVerificationCommandPlanForRepo(repoRoot, options)

  const runVerificationCommand = async ({ command, logPath, attempt = 1 }) => {
    const startedAt = new Date().toISOString()
    const result = await runInterruptibleShellCommand({
      command,
      cwd: repoRoot,
      logPath,
      runDir,
      phaseName: 'verification',
      ui,
      interactionModel: options?.interaction_model ?? 'phased',
      interactionContext: options?.interaction_context ?? null,
    })
    const endedAt = new Date().toISOString()
    if (journalRunId) {
      await appendVerificationCommandEvent({
        runDir,
        runId: journalRunId,
        phase: 'verification',
        command,
        startedAt,
        endedAt,
        exitCode: result.exitCode,
        logPath: path.relative(repoRoot, logPath),
        attempt,
      })
    }
    return result
  }
  const logPathByKey = Object.fromEntries(
    commandPlan.map((step) => [step.key, path.join(verificationDir, step.logFile)]),
  )
  const hasResumeCheckpoint = hasPhaseSubstateCheckpoint({
    index: resumePhaseSubstateIndex,
    phase: 'verification',
    substate: 'phase_verification_completed',
    attempt: normalizedAttempt,
  })
  if (hasResumeCheckpoint) {
    const expectedLogs = Object.values(logPathByKey)

    let logsAvailable = true
    for (const expectedLog of expectedLogs) {
      if (!(await fileExists(expectedLog))) {
        logsAvailable = false
        break
      }
    }

    if (logsAvailable) {
      ui?.log?.(
        `verification: resumed from checkpoint (phase_verification_completed${normalizedAttempt ? ` attempt=${normalizedAttempt}` : ''}); skipping verification commands`,
      )
      await updateState(runDir, { state: 'TESTS_PASSED' })
      if (options.coverage) {
        await updateState(runDir, { state: 'COVERAGE_PASSED' })
      }
      if (options.audit) {
        await updateState(runDir, { state: 'AUDIT_PASSED' })
      }
      return {
        testLogPath: logPathByKey.tests ?? null,
        coverageLogPath: logPathByKey.coverage ?? null,
        auditLogPath: logPathByKey.audit ?? null,
      }
    }

    ui?.log?.('verification: resume checkpoint found but one or more logs are missing; rerunning verification')
  }

  for (const step of commandPlan) {
    const logPath = logPathByKey[step.key]
    ui?.log?.(`verification:${step.label} running (${step.command}) (log=${logPath})`)
    const result = await runVerificationCommand({ command: step.command, logPath, attempt: 1 })
    if (result.exitCode !== 0) {
      throw new VerificationError(`${step.label} failed (see ${logPath})`, {
        command: step.command,
        logPath,
      })
    }

    if (step.key === 'coverage') {
      const coverageOk = await enforceCoverageFloor(repoRoot, options.coverage_floor)
      if (!coverageOk) {
        throw new VerificationError(`Coverage floor not met (floor ${options.coverage_floor}%)`, {
          command: step.command,
          logPath,
        })
      }
    }

    await updateState(runDir, { state: step.state })
  }

  await logPhaseSubstate({
    runDir,
    manifest,
    runId,
    phase: 'verification',
    substate: 'phase_verification_completed',
    attempt: normalizedAttempt,
  })

  return {
    testLogPath: logPathByKey.tests ?? null,
    coverageLogPath: logPathByKey.coverage ?? null,
    auditLogPath: logPathByKey.audit ?? null,
  }
}

async function runVerificationWithReviewLoop({
  repoRoot,
  runId,
  runDir,
  taskText,
  analysis,
  architecture,
  taskGraph,
  planningContext,
  baseSha,
  policy,
  options,
  baselineKnownFailures = [],
  maxReviewFixAttempts,
  maxReviewDiffGrowthLines,
  manifest,
  resumePhaseSubstateIndex = null,
  ui,
}) {
  const reviewDir = path.join(runDir, 'phases', 'verification_review')
  const replayEvents = await readResumeJournalEvents({ runDir })
  const replayState = deriveVerificationReplayState({ events: replayEvents })
  const emittedRecoveryTaskIds = new Set(replayState.recoveryTaskIds)
  let previousReview = null
  let previousDiffLines = null
  const loopLimits = deriveTaskLoopLimits({ maxReviewFixAttempts })
  let managerAttemptsUsed = replayState.managerAttemptsUsed

  const runVerificationRecoveryTask = async ({
    taskId,
    title,
    description,
    initialReviewFeedback = '',
    initialVerificationFeedback = '',
    attemptNumber = null,
    unresolvedFailures = [],
  }) => {
    if (emittedRecoveryTaskIds.has(taskId)) {
      ui?.log?.(`verification: skipping duplicate recovery task ${taskId} from resume replay guard`)
      return { capped: false, executed: false }
    }

    const pendingCycleDecision = planSyntheticCycleEnqueue({
      state: await readState(runDir),
      policy,
      unresolvedFailures,
    })
    if (!pendingCycleDecision.allowed) {
      await applySyntheticCyclePlan(runDir, pendingCycleDecision)
      ui?.log?.(`WARN: ${pendingCycleDecision.warningMessage}`)
      return { capped: true, executed: false }
    }

    const syntheticTask = {
      id: taskId,
      title,
      type: 'refactor',
      description,
      acceptance_criteria: [`Verification passes after recovery task ${taskId}`],
      dependencies: [],
      risk_level: 'medium',
      files: { create: [], modify: [], delete: [] },
      verification_commands: [options.task_tests ?? options.tests],
    }

    const gateResult = await gateSyntheticTaskForEnqueue({
      task: syntheticTask,
      sourcePhase: 'verification_review',
      policy,
      architecture,
      mode: options.mode,
    })
    if (!gateResult.ok) {
      ui.log(`Synthetic task ${gateResult.blocked.id} blocked by gate: ${gateResult.blocked.reason}`)
      await appendSyntheticTaskBlocked(runDir, gateResult.blocked)
      if (gateResult.escalationQuestion) {
        addOpenQuestions(manifest, [gateResult.escalationQuestion])
        await appendMarkdown(path.join(runDir, 'open_questions.md'), [gateResult.escalationQuestion])
      }
      return { capped: false, executed: false }
    }

    await applySyntheticCyclePlan(runDir, pendingCycleDecision)
    emittedRecoveryTaskIds.add(taskId)
    const journalRunId = resolveJournalRunId(manifest, runId)
    if (journalRunId) {
      await appendRecoveryMarkerEvent({
        runDir,
        runId: journalRunId,
        phase: 'verification',
        recoveryTaskId: taskId,
        attempt: attemptNumber,
      })
    }

    const taskResult = await runTaskWithReviewLoop({
      repoRoot,
      runId,
      runDir,
      taskText,
      analysis,
      architecture,
      taskGraph,
      planningContext,
      task: syntheticTask,
      policy,
      options,
      baselineKnownFailures,
      maxReviewFixAttempts,
      maxReviewDiffGrowthLines,
      initialReviewFeedback,
      initialVerificationFeedback,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })

    if (!taskResult?.skipped && !options.no_commit) {
      await commitIfChanges({
        repoRoot,
        message: `codex(team): ${syntheticTask.id}`,
        ui,
        context: `task:${syntheticTask.id}`,
      })
    }

    return {
      capped: false,
      executed: !taskResult?.skipped,
    }
  }

  const runVerificationManagerRecovery = async ({
    failureKind,
    reason,
    review = null,
    blockingIssues = [],
    verificationLogPath = null,
    verificationCommand = null,
  } = {}) => {
    if (managerAttemptsUsed >= loopLimits.maxManagerAttempts) {
      await escalateFailureToUser({
        runDir,
        manifest,
        options,
        ui,
        taskId: 'verification',
        questions: [],
        fallbackReason: `Failure manager attempt budget exhausted (${loopLimits.maxManagerAttempts}). ${reason || ''}`.trim(),
      })
      return { outcome: 'continue' }
    }

    managerAttemptsUsed += 1
    return await runFailureManagerRecovery({
      repoRoot,
      runDir,
      runId,
      taskText,
      task: { id: 'verification' },
      taskDirBase: 'verification',
      failureContext: {
        failure_kind: failureKind ?? 'verification_unknown_failure',
        reason: reason ?? '',
        task_context: {
          required: true,
          affects_schema: false,
          affects_migrations: false,
        },
        manager_attempt: managerAttemptsUsed,
        manager_attempt_budget: loopLimits.maxManagerAttempts,
        review_fix_attempt_budget: maxReviewFixAttempts,
        blocking_issues: blockingIssues,
        review,
        verification: {
          command: verificationCommand ?? null,
          log_path: verificationLogPath ?? null,
        },
      },
      managerAttempt: managerAttemptsUsed,
      options,
      policy,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })
  }

  for (let attempt = 1; attempt <= maxReviewFixAttempts + loopLimits.maxManagerAttempts + 1; attempt += 1) {
    await checkpointConversationBoundary({
      runDir,
      interactionModel: options?.interaction_model ?? 'phased',
      phaseName: 'verification',
      boundaryLabel: `starting verification loop attempt ${attempt}`,
      ui,
    })
    let verificationLogs = null
    let verificationError = null
    try {
      verificationLogs = await runVerificationSuite({
        repoRoot,
        runDir,
        runId,
        options,
        manifest,
        attempt,
        resumePhaseSubstateIndex,
        ui,
      })
    } catch (error) {
      if (error instanceof VerificationError) {
        verificationError = error
      } else {
        throw error
      }
    }

    const { summary, stats } = await getDiffSummary(repoRoot, baseSha)
    const currentDiffLines = totalChangedLines(stats)
    if (previousDiffLines != null) {
      const growthCheck = diffGrowthWithinLimit({
        previousLines: previousDiffLines,
        currentLines: currentDiffLines,
        maxGrowth: maxReviewDiffGrowthLines,
      })
      if (!growthCheck.ok) {
        await markRunFailed(runDir, {
          phase: 'verification_review',
          error: `Verification diff growth exceeded max ${maxReviewDiffGrowthLines} lines (growth ${growthCheck.growth})`,
        })
        throw new Error(
          `Verification diff growth exceeded max ${maxReviewDiffGrowthLines} lines (growth ${growthCheck.growth})`,
        )
      }
    }
    previousDiffLines = currentDiffLines

    if (verificationError) {
      if (attempt > maxReviewFixAttempts) {
        const recovery = await runVerificationManagerRecovery({
          failureKind: 'verification_exhausted',
          reason: 'Verification retries exhausted.',
          verificationLogPath: verificationError.logPath ?? null,
          verificationCommand: verificationError.command ?? null,
        })
        if (recovery.outcome === 'abort') {
          await markRunFailed(runDir, {
            phase: 'verification',
            error: verificationError,
          })
          throw verificationError
        }
      if (recovery.outcome === 'skip_task') {
        continue
      }
      if (recovery.outcome === 'retry_with_feedback') {
        const recoveryTaskResult = await runVerificationRecoveryTask({
          taskId: `verification-manager-fix-${managerAttemptsUsed}-${attempt}`,
          title: `Manager-guided verification recovery (attempt ${managerAttemptsUsed})`,
          description: `Apply manager-guided fixes for verification failures.\n${recovery.decision.verification_feedback || recovery.decision.review_feedback}`,
          initialReviewFeedback: recovery.decision.review_feedback,
          initialVerificationFeedback: recovery.decision.verification_feedback,
          attemptNumber: attempt,
          unresolvedFailures: buildUnresolvedPostCycleFailuresFromVerification({
            command: verificationError.command,
            output: recovery.decision.verification_feedback || recovery.decision.review_feedback || '',
            sourcePhase: 'verification_review',
          }),
        })
        if (recoveryTaskResult.capped) {
          return { capped: true }
        }
        await logRetryTelemetry({
          runDir,
          manifest,
            runId,
            phase: 'verification',
            loop: 'failure_manager_retry',
            attempt: managerAttemptsUsed,
            budget: loopLimits.maxManagerAttempts,
            retryFamily: 'failure_manager_retry',
            taskId: 'verification',
            failureKind: 'verification_exhausted',
          })
        }
        continue
      }

      let logText = ''
      if (verificationError.logPath && (await fileExists(verificationError.logPath))) {
        logText = await readTextFile(verificationError.logPath)
      }
      const verificationFeedback = buildVerificationFeedback({
        command: verificationError.command,
        logPath: verificationError.logPath,
        logText,
        diffSummary: summary,
        options,
      })

      const recoveryTaskResult = await runVerificationRecoveryTask({
        taskId: `verification-fix-${attempt}`,
        title: `Fix verification failures (attempt ${attempt})`,
        description: `Fix verification failure:\n${verificationFeedback}`,
        initialVerificationFeedback: verificationFeedback,
        attemptNumber: attempt,
        unresolvedFailures: buildUnresolvedPostCycleFailuresFromVerification({
          command: verificationError.command,
          output: logText,
          sourcePhase: 'verification_review',
        }),
      })
      if (recoveryTaskResult.capped) {
        return { capped: true }
      }
      await logRetryTelemetry({
        runDir,
        manifest,
        runId,
        phase: 'verification',
        loop: 'verification_retry',
        attempt,
        budget: maxReviewFixAttempts,
        retryFamily: 'verification_retry',
        taskId: 'verification',
        failureKind: 'verification_failed',
      })

      continue
    }

    const logPaths = [
      verificationLogs?.testLogPath,
      verificationLogs?.coverageLogPath,
      verificationLogs?.auditLogPath,
    ]
      .filter(Boolean)
      .map((logPath) => path.relative(repoRoot, logPath))

    const review = await runReviewPhase({
      repoRoot,
      runDir,
      runId,
      reviewTarget: 'verification',
      taskText,
      baseSha,
      stepOutputPath: 'N/A',
      task: null,
      taskDir: null,
      verificationLogPaths: logPaths,
      diffSummary: summary,
      previousReview,
      reviewPhaseName: 'verification_review',
      reviewPhaseDir: reviewDir,
      attempt,
      options,
      policy,
      manifest,
      resumePhaseSubstateIndex,
      ui,
    })

    if (!reviewRequiresFix(review)) {
      return { capped: false }
    }

    if (attempt > maxReviewFixAttempts) {
      const recovery = await runVerificationManagerRecovery({
        failureKind: 'verification_review_fix_exhausted',
        reason: 'Verification review fix attempts exhausted.',
        review,
        blockingIssues: review?.blocking_issues ?? [],
      })
      if (recovery.outcome === 'abort') {
        await markRunFailed(runDir, {
          phase: 'verification_review',
          error: 'Verification review failed after max fix attempts',
          blockingIssues: review?.blocking_issues,
        })
        throw new Error('Verification review failed after max fix attempts')
      }
      if (recovery.outcome === 'skip_task') {
        continue
      }
      if (recovery.outcome === 'retry_with_feedback') {
        const recoveryTaskResult = await runVerificationRecoveryTask({
          taskId: `verification-review-manager-fix-${managerAttemptsUsed}-${attempt}`,
          title: `Manager-guided verification review recovery (attempt ${managerAttemptsUsed})`,
          description: `Apply manager-guided verification review fixes.\n${recovery.decision.review_feedback || formatReviewFeedback(review)}`,
          initialReviewFeedback: recovery.decision.review_feedback || formatReviewFeedback(review),
          initialVerificationFeedback: recovery.decision.verification_feedback,
          attemptNumber: attempt,
          unresolvedFailures: buildUnresolvedPostCycleFailuresFromIssues({
            issues: review?.blocking_issues ?? [],
            sourcePhase: 'verification_review',
          }),
        })
        if (recoveryTaskResult.capped) {
          return { capped: true }
        }
        await logRetryTelemetry({
          runDir,
          manifest,
          runId,
          phase: 'verification_review',
          loop: 'failure_manager_retry',
          attempt: managerAttemptsUsed,
          budget: loopLimits.maxManagerAttempts,
          retryFamily: 'failure_manager_retry',
          taskId: 'verification',
          reviewTarget: 'verification',
          failureKind: 'verification_review_fix_exhausted',
        })
      }
      continue
    }

    const actionableBlockingIssues = getActionableBlockingIssues(review)
    if (actionableBlockingIssues.length === 0) {
      const recovery = await runVerificationManagerRecovery({
        failureKind: 'verification_review_non_actionable',
        reason: 'Verification review requested fixes without actionable blocking issues.',
        review,
      })
      if (recovery.outcome === 'abort') {
        await markRunFailed(runDir, {
          phase: 'verification_review',
          error: 'Verification review requested fixes without actionable blocking_issues',
        })
        throw new Error('Verification review requested fixes without actionable blocking_issues')
      }
      if (recovery.outcome === 'skip_task') {
        continue
      }
      if (recovery.outcome === 'retry_with_feedback') {
        const recoveryTaskResult = await runVerificationRecoveryTask({
          taskId: `verification-review-manager-non-actionable-${managerAttemptsUsed}-${attempt}`,
          title: `Manager-guided verification review fallback (attempt ${managerAttemptsUsed})`,
          description: `Apply manager-guided fallback for non-actionable verification review feedback.\n${recovery.decision.review_feedback || recovery.decision.reason}`,
          initialReviewFeedback: recovery.decision.review_feedback,
          initialVerificationFeedback: recovery.decision.verification_feedback,
          attemptNumber: attempt,
          unresolvedFailures: buildUnresolvedPostCycleFailuresFromIssues({
            issues:
              review?.blocking_issues?.length > 0
                ? review.blocking_issues
                : [
                    {
                      id: 'verification-review-non-actionable',
                      description: recovery.decision.reason || 'Verification review requested non-actionable fixes.',
                    },
                  ],
            sourcePhase: 'verification_review',
          }),
        })
        if (recoveryTaskResult.capped) {
          return { capped: true }
        }
        await logRetryTelemetry({
          runDir,
          manifest,
          runId,
          phase: 'verification_review',
          loop: 'verification_review_non_actionable',
          attempt: managerAttemptsUsed,
          budget: loopLimits.maxManagerAttempts,
          retryFamily: 'review_non_actionable_retry',
          taskId: 'verification',
          reviewTarget: 'verification',
          failureKind: 'verification_review_non_actionable',
        })
      }
      continue
    }

    const recoveryTaskResult = await runVerificationRecoveryTask({
      taskId: `verification-review-fix-${attempt}`,
      title: `Fix verification review feedback (attempt ${attempt})`,
      description: `Fix verification review feedback:\n${jsonStringifyForPrompt(actionableBlockingIssues)}`,
      initialReviewFeedback: formatReviewFeedback(review),
      attemptNumber: attempt,
      unresolvedFailures: buildUnresolvedPostCycleFailuresFromIssues({
        issues: actionableBlockingIssues,
        sourcePhase: 'verification_review',
      }),
    })
    if (recoveryTaskResult.capped) {
      return { capped: true }
    }
    await logRetryTelemetry({
      runDir,
      manifest,
      runId,
      phase: 'verification_review',
      loop: 'verification_review_fix_retry',
      attempt,
      budget: maxReviewFixAttempts,
      retryFamily: 'verification_review_fix_retry',
      taskId: 'verification',
      reviewTarget: 'verification',
      failureKind: 'verification_review_requested_changes',
    })

    previousReview = review
  }

  await markRunFailed(runDir, {
    phase: 'verification_review',
    error: 'Verification loop exhausted without a safe recovery path.',
  })
  throw new Error('Verification loop exhausted without a safe recovery path.')
}

function createUi({ runId, verbose, prettyEvents }) {
  const enabled = Boolean(verbose)
  const prefix = `[patch-gantry:${runId}]`
  let stdoutBroken = false

  if (enabled) {
    process.stdout.on('error', (error) => {
      if (error?.code === 'EPIPE') {
        stdoutBroken = true
      }
    })
  }

  return {
    verbose: enabled,
    onEventLine: enabled
      ? (line) => {
          if (!stdoutBroken) {
            process.stdout.write(`${formatCodexEventLine(line, { pretty: Boolean(prettyEvents) })}\n`)
          }
        }
      : null,
    log: enabled
      ? (message) => {
          process.stderr.write(`${prefix} ${message}\n`)
        }
      : () => {},
  }
}

export function formatCodexEventLine(line, { pretty = false } = {}) {
  if (!pretty) {
    return line
  }
  try {
    return formatPrettyCodexEvent(JSON.parse(line))
  } catch {
    return line
  }
}

function formatPrettyCodexEvent(event) {
  return formatKnownCodexEvent(event) ?? formatHumanReadableEvent(event)
}

function formatKnownCodexEvent(event) {
  if (!event || typeof event !== 'object') {
    return null
  }

  if (event.type === 'thread.started') {
    return 'thread started'
  }
  if (event.type === 'turn.started') {
    return 'turn started'
  }
  if (event.type === 'turn.completed') {
    return formatTurnCompletedEvent(event)
  }
  if (event.type === 'turn.failed') {
    return formatTurnFailedEvent(event)
  }
  if (event.type === 'error') {
    return formatNestedErrorSummary(event.message, { fallbackPrefix: 'error' })
  }
  if (event.type === 'orchestrator.notice') {
    return formatOrchestratorNotice(event)
  }
  if (event.type === 'item.completed') {
    return formatCompletedItemEvent(event.item)
  }

  return null
}

function formatTurnCompletedEvent(event) {
  const usage = event?.usage
  if (!usage || typeof usage !== 'object') {
    return 'turn completed'
  }

  const usageParts = []
  if (typeof usage.input_tokens === 'number') {
    usageParts.push(`input ${usage.input_tokens}`)
  }
  if (typeof usage.cached_input_tokens === 'number') {
    usageParts.push(`cached ${usage.cached_input_tokens}`)
  }
  if (typeof usage.output_tokens === 'number') {
    usageParts.push(`output ${usage.output_tokens}`)
  }
  return usageParts.length > 0 ? `turn completed (${usageParts.join(', ')})` : 'turn completed'
}

function formatTurnFailedEvent(event) {
  const nestedSummary = formatNestedErrorSummary(event?.error, { fallbackPrefix: 'turn failed' })
  return nestedSummary ?? 'turn failed'
}

function formatOrchestratorNotice(event) {
  const level = typeof event?.level === 'string' && event.level.trim() ? event.level.trim().toLowerCase() : 'info'
  const message = typeof event?.message === 'string' && event.message.trim() ? event.message.trim() : 'orchestrator notice'
  return `${level}: ${message}`
}

function formatCompletedItemEvent(item) {
  if (!item || typeof item !== 'object') {
    return null
  }

  if (item.type === 'agent_message') {
    return formatAssistantMessage(item.text)
  }
  if (item.type === 'command_execution') {
    return formatCommandExecution(item)
  }
  if (item.type === 'reasoning') {
    return formatReasoningItem(item)
  }

  return null
}

function formatAssistantMessage(text) {
  if (typeof text !== 'string') {
    return 'assistant'
  }

  const embeddedJson = tryParseEmbeddedJson(text)
  if (embeddedJson) {
    return ['assistant:', ...formatHumanReadableValue(embeddedJson, 1)].join('\n')
  }

  if (/[\r\n]/.test(text)) {
    return ['assistant:', ...splitMultilineString(text).map((line) => `${indent(1)}${line}`)].join('\n')
  }

  return `assistant: ${formatScalar(text)}`
}

function formatCommandExecution(item) {
  const command = typeof item?.command === 'string' && item.command.trim() ? item.command.trim() : 'unknown command'
  const status = typeof item?.status === 'string' && item.status.trim() ? item.status.trim() : 'completed'
  const exitCode = typeof item?.exit_code === 'number' ? ` (exit ${item.exit_code})` : ''
  return `command ${status}${exitCode}: ${command}`
}

function formatReasoningItem(item) {
  const text = typeof item?.text === 'string' ? item.text.trim() : ''
  if (!text) {
    return 'reasoning'
  }

  const singleLine = text.replace(/\s+/g, ' ').trim()
  if (!singleLine) {
    return 'reasoning'
  }

  return `reasoning: ${truncateText(singleLine, 240)}`
}

function formatNestedErrorSummary(value, { fallbackPrefix }) {
  const parsed = parseEmbeddedJsonOrObject(value)
  if (parsed && typeof parsed === 'object' && !parsed.error && typeof parsed.message === 'string') {
    const nestedMessageSummary = formatNestedErrorSummary(parsed.message, { fallbackPrefix })
    if (nestedMessageSummary) {
      return nestedMessageSummary
    }
  }
  const errorPayload = parsed?.error && typeof parsed.error === 'object' ? parsed.error : parsed
  if (!errorPayload || typeof errorPayload !== 'object') {
    const fallbackMessage = typeof value === 'string' && value.trim() ? value.trim() : null
    return fallbackMessage ? `${fallbackPrefix}: ${fallbackMessage}` : null
  }

  const code = typeof errorPayload.code === 'string' && errorPayload.code.trim() ? errorPayload.code.trim() : null
  const message =
    typeof errorPayload.message === 'string' && errorPayload.message.trim() ? errorPayload.message.trim() : null

  if (code && message) {
    return `${fallbackPrefix} ${code}: ${message}`
  }
  if (message) {
    return `${fallbackPrefix}: ${message}`
  }
  return null
}

function formatHumanReadableEvent(event) {
  return formatHumanReadableValue(event, 0).join('\n')
}

function formatHumanReadableValue(value, indentLevel) {
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'string') {
      const embeddedJson = tryParseEmbeddedJson(value)
      if (embeddedJson) {
        return formatHumanReadableValue(embeddedJson, indentLevel)
      }
      if (/[\r\n]/.test(value)) {
        return formatMultilineBlock(value, indentLevel)
      }
    }
    return [`${indent(indentLevel)}${formatScalar(value)}`]
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${indent(indentLevel)}[]`]
    }
    return formatArray(value, indentLevel)
  }

  const entries = Object.entries(value)
  if (entries.length === 0) {
    return [`${indent(indentLevel)}{}`]
  }

  const lines = []
  for (const [key, entryValue] of entries) {
    const renderedKey = formatKey(key)
    const prefix = indent(indentLevel)

    if (typeof entryValue === 'string' && /[\r\n]/.test(entryValue)) {
      lines.push(`${prefix}${renderedKey}: |`)
      for (const line of splitMultilineString(entryValue)) {
        lines.push(`${prefix}${indent(1)}${line}`)
      }
      continue
    }

    if (typeof entryValue === 'string') {
      const embeddedJson = tryParseEmbeddedJson(entryValue)
      if (embeddedJson) {
        lines.push(`${prefix}${renderedKey}:`)
        lines.push(...formatHumanReadableValue(embeddedJson, indentLevel + 1))
        continue
      }
    }

    if (Array.isArray(entryValue)) {
      if (entryValue.length === 0) {
        lines.push(`${prefix}${renderedKey}: []`)
      } else {
        lines.push(`${prefix}${renderedKey}:`)
        lines.push(...formatArray(entryValue, indentLevel + 1))
      }
      continue
    }

    if (entryValue && typeof entryValue === 'object') {
      const nestedEntries = Object.entries(entryValue)
      if (nestedEntries.length === 0) {
        lines.push(`${prefix}${renderedKey}: {}`)
      } else {
        lines.push(`${prefix}${renderedKey}:`)
        lines.push(...formatHumanReadableValue(entryValue, indentLevel + 1))
      }
      continue
    }

    lines.push(`${prefix}${renderedKey}: ${formatScalar(entryValue)}`)
  }
  return lines
}

function formatArray(value, indentLevel) {
  const lines = []
  const prefix = indent(indentLevel)

  for (const item of value) {
    if (typeof item === 'string' && /[\r\n]/.test(item)) {
      lines.push(`${prefix}- |`)
      for (const line of splitMultilineString(item)) {
        lines.push(`${prefix}${indent(1)}${line}`)
      }
      continue
    }

    if (typeof item === 'string') {
      const embeddedJson = tryParseEmbeddedJson(item)
      if (embeddedJson) {
        lines.push(`${prefix}-`)
        lines.push(...formatHumanReadableValue(embeddedJson, indentLevel + 1))
        continue
      }
    }

    if (Array.isArray(item)) {
      if (item.length === 0) {
        lines.push(`${prefix}- []`)
      } else {
        lines.push(`${prefix}-`)
        lines.push(...formatArray(item, indentLevel + 1))
      }
      continue
    }

    if (item && typeof item === 'object') {
      const nestedEntries = Object.entries(item)
      if (nestedEntries.length === 0) {
        lines.push(`${prefix}- {}`)
      } else {
        lines.push(`${prefix}-`)
        lines.push(...formatHumanReadableValue(item, indentLevel + 1))
      }
      continue
    }

    lines.push(`${prefix}- ${formatScalar(item)}`)
  }

  return lines
}

function formatMultilineBlock(value, indentLevel) {
  const prefix = indent(indentLevel)
  const lines = [`${prefix}|`]
  for (const line of splitMultilineString(value)) {
    lines.push(`${prefix}${indent(1)}${line}`)
  }
  return lines
}

function splitMultilineString(value) {
  const lines = String(value).split(/\r\n|\n|\r/)
  while (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

function tryParseEmbeddedJson(value) {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const looksLikeObject = trimmed.startsWith('{') && trimmed.endsWith('}')
  const looksLikeArray = trimmed.startsWith('[') && trimmed.endsWith(']')
  if (!looksLikeObject && !looksLikeArray) {
    return null
  }
  if (trimmed.length > 250_000) {
    return null
  }
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  } catch {
    return null
  }
  return null
}

function parseEmbeddedJsonOrObject(value) {
  if (value && typeof value === 'object') {
    return value
  }
  return tryParseEmbeddedJson(value)
}

function formatScalar(value) {
  if (value === undefined) {
    return 'undefined'
  }
  return JSON.stringify(value)
}

function truncateText(value, maxLength) {
  if (typeof value !== 'string' || value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

function formatKey(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key)
}

function indent(level) {
  return '  '.repeat(level)
}

async function enforceRepoPolicy(repoRoot, policy) {
  if (!policy) {
    return
  }
  const porcelain = await getStatusPorcelain(repoRoot)
  const parsed = parseGitStatusPorcelain(porcelain)

  const deniedPaths = parsed.paths.filter((filePath) => isDeniedPath(filePath, policy))
  if (deniedPaths.length > 0) {
    throw new Error(`Policy denied path write(s): ${deniedPaths.join(', ')}`)
  }

  if (parsed.deletedFiles > policy.max_deleted_files) {
    throw new Error(`Policy max_deleted_files exceeded (${parsed.deletedFiles} > ${policy.max_deleted_files})`)
  }

  const diff = await runGitDiff(repoRoot)
  const secretMatches = detectSecretDiffMatches(diff, policy)
  if (secretMatches.length > 0) {
    const patterns = Array.from(new Set(secretMatches.map((match) => match.pattern)))
    throw new Error(`Secret-like patterns detected in diff (patterns: ${patterns.join(', ')})`)
  }
}

async function runGitDiff(repoRoot) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const { stdout: unstaged } = await execFileAsync('git', ['diff', '--no-color'], { cwd: repoRoot })
  const { stdout: staged } = await execFileAsync('git', ['diff', '--cached', '--no-color'], { cwd: repoRoot })
  return `${unstaged}\n${staged}`
}

async function resolveCoverageCommand(repoRoot) {
  const packageJson = await readJsonFile(path.join(repoRoot, 'package.json'))
  if (packageJson?.scripts?.['test:coverage']) {
    return 'npm run test:coverage'
  }
  return 'npm test -- --coverage'
}

async function enforceCoverageFloor(repoRoot, floorPercent) {
  const summaryPath = path.join(repoRoot, 'coverage', 'coverage-summary.json')
  if (!(await fileExists(summaryPath))) {
    return true
  }
  const summary = await readJsonFile(summaryPath)
  const total = summary?.total
  if (!total) {
    return true
  }
  const metrics = ['lines', 'statements', 'functions', 'branches']
  for (const metric of metrics) {
    const pct = total?.[metric]?.pct
    if (typeof pct === 'number' && pct < floorPercent) {
      return false
    }
  }
  return true
}

async function appendMarkdown(filePath, items) {
  await appendMarkdownUnique(filePath, items)
}

async function appendSyntheticTaskBlocked(runDir, blockedTask) {
  const state = await readState(runDir)
  const existing = Array.isArray(state.synthetic_tasks_blocked) ? state.synthetic_tasks_blocked : []
  await writeState(runDir, {
    ...state,
    synthetic_tasks_blocked: [...existing, blockedTask],
  })
}

async function appendInvalidRecoverySuggestion(runDir, invalidSuggestion) {
  if (!invalidSuggestion || typeof invalidSuggestion !== 'object') {
    return
  }
  const state = await readState(runDir)
  const existing = Array.isArray(state.invalid_recovery_suggestions) ? state.invalid_recovery_suggestions : []
  await writeState(runDir, {
    ...state,
    invalid_recovery_suggestions: [...existing, invalidSuggestion],
  })
}

async function applySyntheticCyclePlan(runDir, decision) {
  if (!decision?.statePatch) {
    return
  }

  const patch = {
    synthetic_cycle_count: decision.statePatch.synthetic_cycle_count,
    unresolved_post_cycle_failures: decision.statePatch.unresolved_post_cycle_failures,
  }
  if (decision.statePatch.final_status) {
    patch.final_status = decision.statePatch.final_status
  }
  await updateState(runDir, patch)
}

function resolveJournalRunId(manifest, runId) {
  if (typeof runId === 'string' && runId.trim()) {
    return runId.trim()
  }
  if (typeof manifest?.run_id === 'string' && manifest.run_id.trim()) {
    return manifest.run_id.trim()
  }
  return null
}

async function logPhaseSubstate({
  runDir,
  manifest,
  runId,
  phase,
  substate,
  attempt = null,
  gateStatus = null,
  reviewTarget = null,
  verdict = null,
}) {
  const resolvedRunId = resolveJournalRunId(manifest, runId)
  if (!resolvedRunId) {
    return
  }
  await appendPhaseSubstateEvent({
    runDir,
    runId: resolvedRunId,
    phase,
    substate,
    attempt,
    gateStatus,
    reviewTarget,
    verdict,
  })
}

async function logRetryTelemetry({
  runDir,
  manifest,
  runId,
  phase,
  loop,
  attempt = 1,
  budget = 1,
  retryFamily,
  failureKind = null,
  reviewTarget = null,
  taskId = null,
}) {
  const resolvedRunId = resolveJournalRunId(manifest, runId)
  if (!resolvedRunId) {
    return
  }

  const normalizedAttempt = Number.isFinite(attempt) ? Math.max(1, Math.trunc(attempt)) : 1
  const normalizedBudget = Number.isFinite(budget) ? Math.max(1, Math.trunc(budget)) : 1
  const event = {
    timestamp: new Date().toISOString(),
    run_id: resolvedRunId,
    phase: String(phase ?? 'unknown'),
    loop: String(loop ?? 'unknown'),
    attempt: normalizedAttempt,
    budget: normalizedBudget,
    cause_code: resolveRetryCauseCode(retryFamily),
  }

  if (failureKind) {
    event.failure_kind = String(failureKind)
  }
  if (reviewTarget) {
    event.review_target = String(reviewTarget)
  }
  if (taskId) {
    event.task_id = String(taskId)
  }

  await appendRetryEvent({ runDir, event })
}

async function readState(runDir) {
  return await readJsonFile(path.join(runDir, 'state.json'))
}

async function updateState(runDir, patch) {
  const existing = await readState(runDir)
  await writeState(runDir, { ...existing, ...patch })
}

async function writeState(runDir, state) {
  const statePath = path.join(runDir, 'state.json')
  await writeJsonFileAtomic(statePath, { ...state, updated_at: new Date().toISOString() })
}

async function nextFixAttempt(runDir) {
  const fixTestsDir = path.join(runDir, 'phases', 'fix_tests')
  await ensureDir(fixTestsDir)
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(fixTestsDir)
  const numbers = entries
    .map((entry) => parseInt(entry, 10))
    .filter((value) => Number.isFinite(value))
  const max = numbers.length === 0 ? 0 : Math.max(...numbers)
  return max + 1
}

async function preflightPrereqs(codexBin, repoRoot) {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  const subprocessEnv = buildCodexSubprocessEnv(process.env)

  try {
    await execFileAsync(codexBin, ['--version'], { env: subprocessEnv })
  } catch {
    throw new Error(`codex not installed or not found on PATH (expected: ${codexBin})`)
  }

  try {
    await execFileAsync(codexBin, ['login', 'status'], { env: subprocessEnv })
  } catch {
    throw new Error('codex not authenticated (run `codex login`)')
  }
  try {
    const contract = await detectCodexCliContract({ codexBin, repoRoot })
    if (!contract.supported) {
      throw new Error(`missing required exec flags: ${contract.missingFlags.join(', ')}`)
    }
  } catch (error) {
    throw new Error(`codex CLI is incompatible with this PatchGantry release (${error?.message ?? error})`)
  }

  try {
    await execFileAsync('node', ['-v'], { env: subprocessEnv })
    await execFileAsync('npm', ['-v'], { env: subprocessEnv })
  } catch {
    throw new Error('node/npm missing from PATH')
  }
}

async function getLastRunId(repoRoot) {
  const runsDir = path.join(repoRoot, RUNS_DIR_NAME)
  if (!(await fileExists(runsDir))) {
    return null
  }

  const { stat } = await import('node:fs/promises')
  const runRoots = await findRunRoots(runsDir)
  if (runRoots.length === 0) {
    return null
  }

  let best = null
  for (const runDir of runRoots) {
    const statePath = path.join(runDir, 'state.json')
    let mtimeMs = 0
    try {
      const s = await stat(statePath)
      mtimeMs = s.mtimeMs
    } catch {
      // ignore
    }
    let state = null
    try {
      state = await readJsonFile(statePath)
    } catch {
      // ignore
    }
    if (!state?.run_id) continue

    if (!best || mtimeMs > best.mtimeMs) {
      best = { mtimeMs, runDir, state }
    }
  }

  return best?.state?.run_id ?? null
}

export function generateRunId() {
  const now = new Date()
  const datePart = now.toISOString().split('.')[0].replaceAll(/[-:]/g, '')
  const randomPart = crypto.randomBytes(3).toString('hex')
  return `${datePart}-${randomPart}`
}

async function resolveRunDirBySelector(repoRoot, selector) {
  if (!selector || typeof selector !== 'string') {
    return null
  }

  let directRunDir = null
  try {
    const { runRelativePath } = resolveRunAndWorktreePaths({ branchName: selector })
    directRunDir = path.join(repoRoot, runRelativePath)
  } catch {
    directRunDir = null
  }

  if (directRunDir && (await fileExists(path.join(directRunDir, 'state.json')))) {
    return directRunDir
  }

  const runsDir = path.join(repoRoot, RUNS_DIR_NAME)
  if (!(await fileExists(runsDir))) {
    return null
  }

  const runRoots = await findRunRoots(runsDir)
  for (const runDir of runRoots) {
    const statePath = path.join(runDir, 'state.json')
    let state = null
    try {
      state = await readJsonFile(statePath)
    } catch {
      // ignore
    }
    if (!state) continue

    if (state.run_id === selector || state.branch_name === selector) {
      return runDir
    }
  }
  return null
}

async function findRunRoots(runsDir) {
  const { readdir } = await import('node:fs/promises')

  const roots = []

  async function walk(dir) {
    let entries = []
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    if (entries.some((entry) => entry.isFile() && entry.name === 'state.json')) {
      roots.push(dir)
      return
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      await walk(path.join(dir, entry.name))
    }
  }

  await walk(runsDir)
  return roots
}
