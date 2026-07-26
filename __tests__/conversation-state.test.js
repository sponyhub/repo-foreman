/**
 * @jest-environment node
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

describe('conversation state', () => {
  test('creates default conversational artifacts and records steering history', async () => {
    const {
      createConversationArtifacts,
      readConversationState,
      enqueueSteeringMessage,
      consumePendingSteeringMessages,
      buildConversationPromptSuffix,
    } = await import('../lib/conversation-state.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-'))

    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })

    expect(await readConversationState(runDir)).toEqual({
      interaction_model: 'conversational',
      active_phase: null,
      active_session_id: null,
      active_command: null,
      active_command_phase: null,
      active_command_started_at: null,
      conversation_state: 'idle',
      control_state: 'running',
      pending_question: null,
      pending_steering_messages: [],
      applied_steering_messages: [],
      waiting_state: null,
      waiting_phase: null,
      waiting_detail: null,
      waiting_started_at: null,
      terminal_broker_state: null,
      pending_replan: false,
      last_control_command: null,
      last_control_at: null,
      abort_reason: null,
      interrupt_requested: false,
      last_steer_at: null,
      live_interaction_supported: null,
      live_interaction_mode: null,
      live_interaction_summary: null,
      live_interaction_blockers: [],
      live_interaction_checked_at: null,
      live_interaction_cli_version: null,
    })

    await enqueueSteeringMessage(runDir, {
      text: 'Prioritize Docker image size reduction before test runtime optimization.',
      source: 'terminal',
    })

    const consumed = await consumePendingSteeringMessages(runDir)
    expect(consumed).toHaveLength(1)
    expect(consumed[0].text).toContain('Docker image size')

    const state = await readConversationState(runDir)
    expect(state.pending_steering_messages).toEqual([])
    expect(state.applied_steering_messages).toHaveLength(1)
    expect(state.interrupt_requested).toBe(false)

    const suffix = await buildConversationPromptSuffix(runDir)
    expect(suffix).toContain('User steering updates')
    expect(suffix).toContain('Docker image size')
  })

  test('tracks pending questions separately from steering messages', async () => {
    const {
      createConversationArtifacts,
      readConversationState,
      setPendingQuestion,
      clearPendingQuestion,
    } = await import('../lib/conversation-state.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })

    await setPendingQuestion(runDir, {
      phase: 'analysis',
      questions: ['Which constraint matters more: cost ceiling or latency?'],
    })

    let state = await readConversationState(runDir)
    expect(state.pending_question).toEqual({
      phase: 'analysis',
      questions: ['Which constraint matters more: cost ceiling or latency?'],
    })

    await clearPendingQuestion(runDir)
    state = await readConversationState(runDir)
    expect(state.pending_question).toBe(null)
  })

  test('tracks pause and resume control state transitions', async () => {
    const {
      createConversationArtifacts,
      readConversationState,
      pauseConversation,
      resumeConversation,
    } = await import('../lib/conversation-state.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })

    await pauseConversation(runDir, { source: 'terminal' })

    let state = await readConversationState(runDir)
    expect(state.control_state).toBe('paused')
    expect(state.interrupt_requested).toBe(true)
    expect(state.last_control_command).toBe('pause')

    await resumeConversation(runDir, { source: 'terminal' })

    state = await readConversationState(runDir)
    expect(state.control_state).toBe('running')
    expect(state.interrupt_requested).toBe(false)
    expect(state.last_control_command).toBe('resume')
  })

  test('tracks abort control state transitions durably', async () => {
    const {
      createConversationArtifacts,
      readConversationState,
      abortConversation,
    } = await import('../lib/conversation-state.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })

    await abortConversation(runDir, {
      source: 'terminal',
      reason: 'User requested abort from terminal.',
    })

    const state = await readConversationState(runDir)
    expect(state.control_state).toBe('aborted')
    expect(state.interrupt_requested).toBe(true)
    expect(state.abort_reason).toBe('User requested abort from terminal.')
    expect(state.last_control_command).toBe('abort')
  })

  test('tracks active command, wait state, and terminal broker status', async () => {
    const {
      createConversationArtifacts,
      readConversationState,
      setActiveConversationCommand,
      setConversationTerminalState,
      setConversationWaitState,
    } = await import('../lib/conversation-state.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })

    await setActiveConversationCommand(runDir, {
      command: 'npm test',
      phaseName: 'verification',
    })
    await setConversationWaitState(runDir, {
      waitState: 'paused',
      phaseName: 'verification',
      detail: 'Waiting for /resume before continuing verification.',
    })
    await setConversationTerminalState(runDir, 'suspended')

    let state = await readConversationState(runDir)
    expect(state.active_command).toBe('npm test')
    expect(state.active_command_phase).toBe('verification')
    expect(state.waiting_state).toBe('paused')
    expect(state.waiting_phase).toBe('verification')
    expect(state.waiting_detail).toContain('/resume')
    expect(state.terminal_broker_state).toBe('suspended')

    await setActiveConversationCommand(runDir, { command: null })
    await setConversationWaitState(runDir, { waitState: null })
    await setConversationTerminalState(runDir, null)

    state = await readConversationState(runDir)
    expect(state.active_command).toBe(null)
    expect(state.waiting_state).toBe(null)
    expect(state.terminal_broker_state).toBe(null)
  })

  test('stores live interaction capability verdict durably for truthful operator reporting', async () => {
    const {
      createConversationArtifacts,
      readConversationState,
      setLiveInteractionCapability,
    } = await import('../lib/conversation-state.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-conversation-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })

    await setLiveInteractionCapability(runDir, {
      supported: false,
      mode: 'interrupt-replay',
      summary: 'True live in-place steering is unavailable on this Codex CLI; using interrupt-and-replay.',
      blockers: ['resume_missing_output_schema', 'resume_missing_sandbox'],
      cliVersion: 'codex-cli 0.111.0',
      checkedAt: '2026-03-06T12:34:56.000Z',
    })

    const state = await readConversationState(runDir)
    expect(state.live_interaction_supported).toBe(false)
    expect(state.live_interaction_mode).toBe('interrupt-replay')
    expect(state.live_interaction_summary).toContain('interrupt-and-replay')
    expect(state.live_interaction_blockers).toEqual(['resume_missing_output_schema', 'resume_missing_sandbox'])
    expect(state.live_interaction_cli_version).toBe('codex-cli 0.111.0')
    expect(state.live_interaction_checked_at).toBe('2026-03-06T12:34:56.000Z')
  })
})
