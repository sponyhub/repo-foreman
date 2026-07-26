/**
 * @jest-environment node
 */

const path = require('node:path')
const fs = require('node:fs/promises')

const PROMPTS_DIR = path.join(__dirname, '..', 'prompts')
const RUN_FILE = path.join(__dirname, '..', 'lib', 'run.mjs')

describe('codex orchestrator prompt coverage', () => {
  test('core prompts include user answer directives', async () => {
    const promptFiles = [
      '00-analysis.md',
      '01-architecture.md',
      '02-task-graph.md',
      '02-assumption-hint-capture.md',
      '03-worker-implement-task.md',
      '08-failure-manager.md',
    ]

    const missing = []
    for (const file of promptFiles) {
      const contents = await fs.readFile(path.join(PROMPTS_DIR, file), 'utf8')
      if (!contents.includes('{{USER_ANSWERS_DIRECTIVES}}')) {
        missing.push(file)
      }
    }

    expect(missing).toEqual([])
  })

  test('failure manager prompt documents the allowlisted recovery actions and escalation fallback', async () => {
    const failureManager = await fs.readFile(path.join(PROMPTS_DIR, '08-failure-manager.md'), 'utf8')
    expect(failureManager).toContain('Allowlisted actions')
    expect(failureManager).toContain('`retry`')
    expect(failureManager).toContain('`auto_answer_noncritical`')
    expect(failureManager).toContain('`skip_task`')
    expect(failureManager).toContain('If no safe actionable recovery exists, choose `escalate`')
    expect(failureManager).not.toContain('Never propose disabling tests')
  })

  test('manager loop wiring keeps planning loop bounded and extends verification recovery budget', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')

    expect(runSource).toMatch(
      /for \(let attempt = 1; attempt <= maxReviewFixAttempts \+ 1; attempt \+= 1\) \{[\s\S]*?const userInput = await loadUserInputContext\(runDir\)[\s\S]*?analysis = await runOrLoadPhase/,
    )
    expect(runSource).toContain(
      'for (let attempt = 1; attempt <= maxReviewFixAttempts + loopLimits.maxManagerAttempts + 1; attempt += 1)',
    )
  })

  test('worker prompt includes planning context', async () => {
    const contents = await fs.readFile(path.join(PROMPTS_DIR, '03-worker-implement-task.md'), 'utf8')
    expect(contents).toContain('{{PLANNING_CONTEXT_JSON}}')
  })

  test('worker prompt variables include planning context', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')
    expect(runSource).toContain('PLANNING_CONTEXT_JSON:')
    expect(runSource).toContain('renderPromptJsonText(planningContext ?? {}, {')
  })

  test('worker prompt variables truncate free-form review and verification feedback', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')
    expect(runSource).toContain("REVIEW_FEEDBACK: renderPromptText(reviewFeedback ?? '', { options, label: 'REVIEW_FEEDBACK' })")
    expect(runSource).toContain("VERIFICATION_FEEDBACK: renderPromptText(verificationFeedback ?? '', {")
    expect(runSource).toContain("label: 'VERIFICATION_FEEDBACK'")
  })

  test('generic orchestrator phases thread conversational interrupt context into codex launches', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')
    const runOrLoadPhaseSource = runSource.slice(
      runSource.indexOf('async function runOrLoadPhase({'),
      runSource.indexOf('export async function runCodexPhaseWithPolicyGuidanceRetry({'),
    )

    expect(runOrLoadPhaseSource).toMatch(/async function runOrLoadPhase\(\{[\s\S]*?interactionContext = null,[\s\S]*?\}\)/)
    expect(runOrLoadPhaseSource).toMatch(
      /runCodexPhaseWithPolicyGuidanceRetry\(\{[\s\S]*?interactionModel: manifest\?\.runtime_config\?\.interaction_model \?\? 'phased',[\s\S]*?interactionContext,[\s\S]*?\}\)/,
    )
    expect(runOrLoadPhaseSource).not.toContain('interactionContext: options?.interaction_context ?? null')
  })

  test('fix-tests launches keep conversational interrupt wiring during verification recovery', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')
    const runFixTestsSource = runSource.slice(
      runSource.indexOf('async function runFixTestsOnce('),
      runSource.indexOf('async function runBaselineVerificationPhase('),
    )

    expect(runFixTestsSource).toContain("interactionModel: options?.interaction_model ?? 'phased'")
    expect(runFixTestsSource).toContain('interactionContext: options?.interaction_context ?? null')
  })

  test('branch-name selection and preflight dependency install keep conversational control wiring', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')

    expect(runSource).toMatch(
      /await createConversationArtifacts\(bootstrapRunDir, \{ interactionModel: options\.interaction_model \}\)/,
    )
    expect(runSource).toMatch(
      /branchName = await resolveRunBranchName\(\{[\s\S]*?interactionContext: options\?\.interaction_context \?\? null,[\s\S]*?ui,[\s\S]*?\}\)/,
    )
    expect(runSource).toMatch(
      /phaseName: 'branch_name'[\s\S]*?interactionModel: options\?\.interaction_model \?\? 'phased'[\s\S]*?interactionContext,[\s\S]*?\}/,
    )
    expect(runSource).toMatch(
      /const result = await runInterruptibleShellCommand\(\{[\s\S]*?command: 'npm ci --ignore-scripts'[\s\S]*?phaseName: 'preflight'[\s\S]*?interactionModel,[\s\S]*?interactionContext,[\s\S]*?\}\)/,
    )
  })

  test('contract-critical prompt JSON callsites fail closed on truncation', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')

    expect(runSource).toMatch(
      /phaseName: 'analysis'[\s\S]*?USER_ANSWERS_DIRECTIVES: renderPromptJsonText\(userInput\.userAnswerDirectives \?\? \{\}, \{[\s\S]*?label: 'USER_ANSWERS_DIRECTIVES'[\s\S]*?failOnTruncation: true[\s\S]*?\}\)/,
    )
    expect(runSource).toMatch(
      /PHASE_OUTPUT_JSON: renderPromptJsonText\(phaseOutput, \{[\s\S]*?label: 'PHASE_OUTPUT_JSON'[\s\S]*?failOnTruncation: true[\s\S]*?\}\)/,
    )
    expect(runSource).toMatch(
      /TASK_JSON: renderPromptJsonText\(task, \{[\s\S]*?label: 'TASK_JSON'[\s\S]*?failOnTruncation: true[\s\S]*?\}\)/,
    )
    expect(runSource).toMatch(
      /PLANNING_CONTEXT_JSON: renderPromptJsonText\(planningContext \?\? \{\}, \{[\s\S]*?label: 'PLANNING_CONTEXT_JSON'[\s\S]*?failOnTruncation: true[\s\S]*?\}\)/,
    )
    expect(runSource).toMatch(
      /USER_ANSWERS_DIRECTIVES: renderPromptJsonText\(userInput\.userAnswerDirectives \?\? \{\}, \{[\s\S]*?label: 'USER_ANSWERS_DIRECTIVES'[\s\S]*?failOnTruncation: true[\s\S]*?\}\)/,
    )
  })

  test('planning prompts steer away from unnecessary blocking when docs already specify decisions', async () => {
    const analysis = await fs.readFile(path.join(PROMPTS_DIR, '00-analysis.md'), 'utf8')
    const architecture = await fs.readFile(path.join(PROMPTS_DIR, '01-architecture.md'), 'utf8')
    const taskGraph = await fs.readFile(path.join(PROMPTS_DIR, '02-task-graph.md'), 'utf8')
    const assumptionHintCapture = await fs.readFile(path.join(PROMPTS_DIR, '02-assumption-hint-capture.md'), 'utf8')

    expect(analysis).toContain('Treat explicit requirements in task docs/repo docs as authoritative.')
    expect(analysis).toContain('Do not set `needs_user_input` due to read-only role')
    expect(architecture).toContain('{{BLOCKING_QUESTIONS_RESOLVED}}')
    expect(architecture).toContain('Architecture phase blocked: unresolved blocking questions from pre-check phase.')
    expect(architecture).toContain('Do not ask for input when the decision is already specified in task docs/repo docs.')
    expect(taskGraph).toContain('Do not set `needs_user_input` for decisions already specified in task docs/repo docs.')
    expect(assumptionHintCapture).toContain('Do not repeat questions already answered in task docs/repo docs')
    expect(assumptionHintCapture).toContain('Do not output blocking questions')
    expect(assumptionHintCapture).not.toContain('Put blocking questions in `blocking_questions`')
  })

  test('question-producing prompts document mixed string-or-structured question compatibility', async () => {
    const analysis = await fs.readFile(path.join(PROMPTS_DIR, '00-analysis.md'), 'utf8')
    const architecture = await fs.readFile(path.join(PROMPTS_DIR, '01-architecture.md'), 'utf8')
    const taskGraph = await fs.readFile(path.join(PROMPTS_DIR, '02-task-graph.md'), 'utf8')
    const assumptionHintCapture = await fs.readFile(path.join(PROMPTS_DIR, '02-assumption-hint-capture.md'), 'utf8')
    const worker = await fs.readFile(path.join(PROMPTS_DIR, '03-worker-implement-task.md'), 'utf8')
    const failureManager = await fs.readFile(path.join(PROMPTS_DIR, '08-failure-manager.md'), 'utf8')

    for (const prompt of [analysis, architecture, taskGraph, assumptionHintCapture, worker, failureManager]) {
      expect(prompt).toContain('Use either legacy strings or structured question objects')
    }
  })

  test('run pipeline executes blocking-question pre-check before architecture and renames assumption/hint phase', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')
    const precheckIndex = runSource.indexOf('phase:blocking_question_precheck starting')
    const architectureIndex = runSource.indexOf('phase:architecture starting')
    const assumptionHintIndex = runSource.indexOf('phase:assumption_hint_capture starting')
    const taskGraphIndex = runSource.indexOf('phase:task_graph starting')

    expect(precheckIndex).toBeGreaterThan(-1)
    expect(architectureIndex).toBeGreaterThan(-1)
    expect(assumptionHintIndex).toBeGreaterThan(-1)
    expect(taskGraphIndex).toBeGreaterThan(-1)
    expect(precheckIndex).toBeLessThan(architectureIndex)
    expect(assumptionHintIndex).toBeGreaterThan(architectureIndex)
    expect(assumptionHintIndex).toBeLessThan(taskGraphIndex)
  })

  test('worker, fix-tests, and review prompts enforce stronger execution and feedback quality', async () => {
    const worker = await fs.readFile(path.join(PROMPTS_DIR, '03-worker-implement-task.md'), 'utf8')
    const fixTests = await fs.readFile(path.join(PROMPTS_DIR, '05-fix-tests.md'), 'utf8')
    const reviewPrompts = [
      '04-analysis-review.md',
      '04-architecture-review.md',
      '04-task-graph-review.md',
      '04-task-review.md',
      '04-integration-review.md',
      '04-verification-review.md',
    ]

    expect(worker).toContain('Update docs whenever behavior, APIs, UX, config, security, or compliance posture changes')
    expect(worker).toContain('Do not ask for permission to execute out-of-scope follow-up work')
    expect(fixTests).toContain('Do not disable, skip, or weaken tests unless the test is provably incorrect')

    for (const file of reviewPrompts) {
      const contents = await fs.readFile(path.join(PROMPTS_DIR, file), 'utf8')
      expect(contents).toContain(
        'If verdict is `revise` or `block`, include at least one actionable `blocking_issues` entry',
      )
      expect(contents).toContain('required fields: `id`, `severity`, `file`, `description`, `suggested_fix`')
    }
  })

  test('summary prompt and wiring include run artifacts for grounded output', async () => {
    const summaryPrompt = await fs.readFile(path.join(PROMPTS_DIR, '06-summary.md'), 'utf8')
    const runSource = await fs.readFile(RUN_FILE, 'utf8')

    expect(summaryPrompt).toContain('{{RUN_DIR}}')
    expect(summaryPrompt).toContain('{{MANIFEST_PATH}}')
    expect(summaryPrompt).toContain('{{VERIFICATION_LOG_PATHS}}')

    expect(runSource).toContain("phaseName: 'summary'")
    expect(runSource).toContain('RUN_DIR:')
    expect(runSource).toContain('MANIFEST_PATH:')
    expect(runSource).toContain('VERIFICATION_LOG_PATHS:')
  })

  test('branch naming prompt de-prioritizes low-signal tokens', async () => {
    const branchPrompt = await fs.readFile(path.join(PROMPTS_DIR, '07-branch-name.md'), 'utf8')
    expect(branchPrompt).toContain('Avoid low-signal tokens when better alternatives exist')
    expect(branchPrompt).toContain('read')
    expect(branchPrompt).toContain('docs')
    expect(branchPrompt).toContain('todo')
  })
})
