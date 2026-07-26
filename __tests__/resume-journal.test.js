/**
 * @jest-environment node
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

describe('resume journal', () => {
  test('derives task replay state from journal events for bounded resume guards', async () => {
    const { buildAutoResolveReplayMarkerId, deriveTaskReplayState } = await import('../lib/resume-journal.mjs')

    const markerA = buildAutoResolveReplayMarkerId({
      taskId: 'T01',
      questionSetSignature: 'Can I proceed?\nDo I need migrations?',
    })
    const markerB = buildAutoResolveReplayMarkerId({
      taskId: 'T01',
      questionSetSignature: 'Any rollback requirements?',
    })

    const state = deriveTaskReplayState({
      events: [
        {
          event_type: 'phase_started',
          phase: 'tasks/T01/failure_manager/attempt-1',
        },
        {
          event_type: 'phase_output_validated',
          phase: 'tasks/T01/failure_manager/attempt-2',
        },
        {
          event_type: 'recovery_marker',
          phase: 'task:T01',
          recovery_task_id: markerA,
          attempt: 1,
        },
        {
          event_type: 'recovery_marker',
          phase: 'task:T01',
          recovery_task_id: markerB,
          attempt: 2,
        },
        {
          event_type: 'recovery_marker',
          phase: 'task:T99',
          recovery_task_id: 'task-auto-resolve:T99:abc',
          attempt: 5,
        },
      ],
      taskId: 'T01',
    })

    expect(state.managerAttemptsUsed).toBe(2)
    expect(state.autoResolveAttemptsUsed).toBe(2)
    expect(state.autoResolveReplayMarkerIds.has(markerA)).toBe(true)
    expect(state.autoResolveReplayMarkerIds.has(markerB)).toBe(true)
    expect(state.autoResolveReplayMarkerIds.has('task-auto-resolve:T99:abc')).toBe(false)
  })

  test('derives verification replay state with recovery-task dedupe ids', async () => {
    const { deriveVerificationReplayState } = await import('../lib/resume-journal.mjs')

    const state = deriveVerificationReplayState({
      events: [
        {
          event_type: 'phase_started',
          phase: 'tasks/verification/failure_manager/attempt-3',
        },
        {
          event_type: 'recovery_marker',
          phase: 'verification',
          recovery_task_id: 'verification-fix-1',
          attempt: 1,
        },
        {
          event_type: 'recovery_marker',
          phase: 'verification',
          recovery_task_id: 'verification-manager-fix-3-9',
          attempt: 9,
        },
        {
          event_type: 'recovery_marker',
          phase: 'task:T01',
          recovery_task_id: 'task-auto-resolve:T01:xyz',
          attempt: 1,
        },
      ],
    })

    expect(state.managerAttemptsUsed).toBe(3)
    expect(state.recoveryTaskIds.has('verification-fix-1')).toBe(true)
    expect(state.recoveryTaskIds.has('verification-manager-fix-3-9')).toBe(true)
    expect(state.recoveryTaskIds.has('task-auto-resolve:T01:xyz')).toBe(false)
  })

  test('appends phase substate events as jsonl entries', async () => {
    const { appendPhaseSubstateEvent, readResumeJournalEvents } = await import('../lib/resume-journal.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    await appendPhaseSubstateEvent({
      runDir: tmpDir,
      runId: 'run-1',
      phase: 'analysis',
      substate: 'phase_started',
      attempt: 1,
    })
    await appendPhaseSubstateEvent({
      runDir: tmpDir,
      runId: 'run-1',
      phase: 'analysis',
      substate: 'phase_output_validated',
      attempt: 1,
    })

    const events = await readResumeJournalEvents({ runDir: tmpDir })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      run_id: 'run-1',
      phase: 'analysis',
      event_type: 'phase_started',
      attempt: 1,
    })
    expect(events[1]).toMatchObject({
      run_id: 'run-1',
      phase: 'analysis',
      event_type: 'phase_output_validated',
      attempt: 1,
    })
  })

  test('records verification command execution with redaction and bounds', async () => {
    const { appendVerificationCommandEvent, readResumeJournalEvents } = await import('../lib/resume-journal.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    await appendVerificationCommandEvent({
      runDir: tmpDir,
      runId: 'run-verify',
      phase: 'verification',
      command: `node -e "console.log('Bearer aaaaaaaaaa')"`,
      startedAt: '2026-03-03T10:00:00.000Z',
      endedAt: '2026-03-03T10:00:01.000Z',
      exitCode: 1,
      logPath: 'verification/npm-test.log',
      attempt: 2,
      prompt_text: 'must-not-be-persisted',
    })

    const [entry] = await readResumeJournalEvents({ runDir: tmpDir })
    expect(entry.event_type).toBe('verification_command')
    expect(entry.command).toContain('[REDACTED]')
    expect(entry.command).not.toContain('Bearer aaaaaaaaaa')
    expect(entry.log_path).toBe('verification/npm-test.log')
    expect(entry).toMatchObject({
      run_id: 'run-verify',
      phase: 'verification',
      started_at: '2026-03-03T10:00:00.000Z',
      ended_at: '2026-03-03T10:00:01.000Z',
      exit_code: 1,
      attempt: 2,
    })
    expect(entry.prompt_text).toBeUndefined()
  })

  test('records recovery marker entries for verification synthetic tasks', async () => {
    const { appendRecoveryMarkerEvent, readResumeJournalEvents } = await import('../lib/resume-journal.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    await appendRecoveryMarkerEvent({
      runDir: tmpDir,
      runId: 'run-recovery',
      phase: 'verification',
      recoveryTaskId: 'verification-fix-3',
      attempt: 3,
      note: 'ignored',
    })

    const [entry] = await readResumeJournalEvents({ runDir: tmpDir })
    expect(entry).toMatchObject({
      event_type: 'recovery_marker',
      run_id: 'run-recovery',
      phase: 'verification',
      recovery_task_id: 'verification-fix-3',
      attempt: 3,
    })
    expect(entry.note).toBeUndefined()
  })

  test('rejects unknown phase substates', async () => {
    const { appendPhaseSubstateEvent } = await import('../lib/resume-journal.mjs')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))

    await expect(
      appendPhaseSubstateEvent({
        runDir: tmpDir,
        runId: 'run-1',
        phase: 'analysis',
        substate: 'not-a-substate',
      }),
    ).rejects.toThrow(/unknown phase substate/i)
  })

  test('builds phase substate index with attempt-aware checkpoints', async () => {
    const { buildPhaseSubstateIndex, hasPhaseSubstateCheckpoint } = await import('../lib/resume-journal.mjs')

    const index = buildPhaseSubstateIndex({
      events: [
        {
          event_type: 'phase_output_validated',
          phase: 'analysis',
        },
        {
          event_type: 'phase_review_completed',
          phase: 'review',
          attempt: 1,
        },
        {
          event_type: 'phase_verification_completed',
          phase: 'verification',
          attempt: 2,
        },
        {
          event_type: 'verification_command',
          phase: 'verification',
          attempt: 2,
        },
      ],
    })

    expect(hasPhaseSubstateCheckpoint({ index, phase: 'analysis', substate: 'phase_output_validated' })).toBe(true)
    expect(hasPhaseSubstateCheckpoint({ index, phase: 'review', substate: 'phase_review_completed', attempt: 1 })).toBe(
      true,
    )
    expect(hasPhaseSubstateCheckpoint({ index, phase: 'verification', substate: 'phase_verification_completed' })).toBe(
      true,
    )
    expect(
      hasPhaseSubstateCheckpoint({ index, phase: 'verification', substate: 'phase_verification_completed', attempt: 2 }),
    ).toBe(true)
    expect(
      hasPhaseSubstateCheckpoint({ index, phase: 'verification', substate: 'phase_verification_completed', attempt: 1 }),
    ).toBe(false)
    expect(hasPhaseSubstateCheckpoint({ index, phase: 'verification', substate: 'verification_command' })).toBe(false)
  })

  test('attempt lookup fails closed when historical events do not include attempt metadata', async () => {
    const { buildPhaseSubstateIndex, hasPhaseSubstateCheckpoint } = await import('../lib/resume-journal.mjs')

    const index = buildPhaseSubstateIndex({
      events: [
        {
          event_type: 'phase_verification_completed',
          phase: 'task:T01',
        },
      ],
    })

    expect(hasPhaseSubstateCheckpoint({ index, phase: 'task:T01', substate: 'phase_verification_completed' })).toBe(true)
    expect(
      hasPhaseSubstateCheckpoint({ index, phase: 'task:T01', substate: 'phase_verification_completed', attempt: 1 }),
    ).toBe(false)
  })
})
