/**
 * @jest-environment node
 */

const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

describe('run conversational control helpers', () => {
  test('checkpointConversationBoundary waits at a paused safe boundary until resumed', async () => {
    const {
      createConversationArtifacts,
      pauseConversation,
      readConversationState,
      resumeConversation,
    } = await import('../lib/conversation-state.mjs')
    const { checkpointConversationBoundary } = await import('../lib/run.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-run-controls-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })
    await pauseConversation(runDir, { source: 'terminal' })

    const checkpoint = checkpointConversationBoundary({
      runDir,
      interactionModel: 'conversational',
      phaseName: 'review',
      boundaryLabel: 'starting integration review',
      ui: { log: jest.fn() },
      pollMs: 25,
    })

    let pausedState = null
    for (let attempt = 0; attempt < 20; attempt += 1) {
      pausedState = await readConversationState(runDir)
      if (pausedState.waiting_state === 'paused') {
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }

    expect(pausedState.waiting_state).toBe('paused')
    expect(pausedState.waiting_phase).toBe('review')
    expect(pausedState.waiting_detail).toContain('starting integration review')

    setTimeout(async () => {
      await resumeConversation(runDir, { source: 'terminal' })
    }, 75)

    await checkpoint

    const finalState = await readConversationState(runDir)
    expect(finalState.waiting_state).toBe(null)
    expect(finalState.waiting_phase).toBe(null)
    expect(finalState.waiting_detail).toBe(null)
  })

  test('checkpointConversationBoundary consumes queued replan updates before new work starts', async () => {
    const {
      createConversationArtifacts,
      readConversationState,
      requestConversationReplan,
    } = await import('../lib/conversation-state.mjs')
    const { checkpointConversationBoundary } = await import('../lib/run.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-run-controls-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })
    await requestConversationReplan(runDir, {
      source: 'terminal',
      text: 'Shift attention to recovery-loop checkpoints.',
    })

    await checkpointConversationBoundary({
      runDir,
      interactionModel: 'conversational',
      phaseName: 'verification',
      boundaryLabel: 'starting verification recovery',
      ui: { log: jest.fn() },
      pollMs: 25,
    })

    const state = await readConversationState(runDir)
    expect(state.pending_replan).toBe(false)
    expect(state.pending_steering_messages).toEqual([])
    expect(state.applied_steering_messages).toHaveLength(1)
    expect(state.applied_steering_messages[0].text).toContain('recovery-loop checkpoints')
  })

  test('checkpointConversationBoundary aborts before starting new work', async () => {
    const {
      abortConversation,
      createConversationArtifacts,
    } = await import('../lib/conversation-state.mjs')
    const { checkpointConversationBoundary, RunAbortedError } = await import('../lib/run.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-run-controls-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })
    await abortConversation(runDir, {
      source: 'terminal',
      reason: 'User aborted before the next stage started.',
    })

    await expect(
      checkpointConversationBoundary({
        runDir,
        interactionModel: 'conversational',
        phaseName: 'summary',
        boundaryLabel: 'starting summary generation',
        ui: { log: jest.fn() },
        pollMs: 25,
      }),
    ).rejects.toBeInstanceOf(RunAbortedError)
  })

  test('sleepWithConversationControl waits through pause until resumed', async () => {
    const {
      createConversationArtifacts,
      pauseConversation,
      resumeConversation,
    } = await import('../lib/conversation-state.mjs')
    const { sleepWithConversationControl } = await import('../lib/run.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-run-controls-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })
    await pauseConversation(runDir, { source: 'terminal' })

    const startedAt = Date.now()
    const sleeper = sleepWithConversationControl({
      runDir,
      interactionModel: 'conversational',
      phaseName: 'answers',
      ui: { log: jest.fn() },
      ms: 50,
      pollMs: 25,
    })

    setTimeout(async () => {
      await resumeConversation(runDir, { source: 'terminal' })
    }, 150)

    await sleeper
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(140)
  })

  test('sleepWithConversationControl aborts non-codex waits cleanly', async () => {
    const {
      createConversationArtifacts,
      abortConversation,
    } = await import('../lib/conversation-state.mjs')
    const { RunAbortedError, sleepWithConversationControl } = await import('../lib/run.mjs')

    const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-run-controls-'))
    await createConversationArtifacts(runDir, { interactionModel: 'conversational' })

    const sleeper = sleepWithConversationControl({
      runDir,
      interactionModel: 'conversational',
      phaseName: 'answers',
      ui: { log: jest.fn() },
      ms: 500,
      pollMs: 25,
    })

    setTimeout(async () => {
      await abortConversation(runDir, {
        source: 'terminal',
        reason: 'User aborted while waiting for answers.',
      })
    }, 75)

    await expect(sleeper).rejects.toBeInstanceOf(RunAbortedError)
  })
})
