/**
 * @jest-environment node
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

const RUN_FILE = path.join(__dirname, '..', 'lib', 'run.mjs')

describe('task execution resume state', () => {
  test('hydrates task execution state from legacy runs with a warning', async () => {
    const { hydrateTaskExecutionState } = await import('../lib/task-execution.mjs')

    const plan = hydrateTaskExecutionState({
      executionOrder: ['T01', 'T02', 'T03'],
      taskExecution: null,
      force: false,
    })

    expect(plan.taskExecution).toEqual({
      total: 3,
      completed_task_ids: [],
      failed_task_id: null,
      current_task_index: 0,
      last_updated: null,
    })
    expect(plan.pendingTaskIds).toEqual(['T01', 'T02', 'T03'])
    expect(plan.warningMessages).toContain(
      'task_execution not found in state - starting Phase 11 from beginning.',
    )
  })

  test('resumes from current task index and skips already committed tasks', async () => {
    const { hydrateTaskExecutionState } = await import('../lib/task-execution.mjs')

    const plan = hydrateTaskExecutionState({
      executionOrder: ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10'],
      taskExecution: {
        total: 10,
        completed_task_ids: ['T01', 'T02', 'T03', 'T04', 'T05'],
        failed_task_id: 'T06',
        current_task_index: 5,
        last_updated: '2026-03-06T09:00:00.000Z',
      },
      force: false,
    })

    expect(plan.startIndex).toBe(5)
    expect(plan.pendingTaskIds).toEqual(['T06', 'T07', 'T08', 'T09', 'T10'])
    expect(plan.completedTaskIds.has('T05')).toBe(true)
    expect(plan.resumeMessage).toBe(
      'Resuming Phase 11 from task 6 of 10 (5 already committed, skipping).',
    )
  })

  test('double-commit guard still warns and skips completed tasks when force is set', async () => {
    const { hydrateTaskExecutionState, shouldSkipCommittedTask } = await import('../lib/task-execution.mjs')

    const plan = hydrateTaskExecutionState({
      executionOrder: ['T01', 'T02', 'T03'],
      taskExecution: {
        total: 3,
        completed_task_ids: ['T01'],
        failed_task_id: null,
        current_task_index: 1,
        last_updated: '2026-03-06T09:00:00.000Z',
      },
      force: true,
    })

    expect(plan.warningMessages).toContain(
      'WARNING: --force flag detected but 1 already-committed tasks will be skipped to prevent double-commit. Use --reset-tasks to clear commit history if a full rerun is intended.',
    )
    expect(shouldSkipCommittedTask({ completedTaskIds: plan.completedTaskIds, taskId: 'T01' })).toBe(true)
    expect(shouldSkipCommittedTask({ completedTaskIds: plan.completedTaskIds, taskId: 'T02' })).toBe(false)
  })

  test('records commit and failure updates with deterministic progress', async () => {
    const { createTaskExecutionState, recordCommittedTask, recordFailedTask } = await import('../lib/task-execution.mjs')

    const initial = createTaskExecutionState(['T01', 'T02', 'T03'])
    const afterCommit = recordCommittedTask({
      taskExecution: initial,
      taskId: 'T01',
      timestamp: '2026-03-06T10:00:00.000Z',
    })
    const afterFailure = recordFailedTask({
      taskExecution: afterCommit,
      taskId: 'T02',
      timestamp: '2026-03-06T10:01:00.000Z',
    })

    expect(afterCommit).toEqual({
      total: 3,
      completed_task_ids: ['T01'],
      failed_task_id: null,
      current_task_index: 1,
      last_updated: '2026-03-06T10:00:00.000Z',
    })
    expect(afterFailure).toEqual({
      total: 3,
      completed_task_ids: ['T01'],
      failed_task_id: 'T02',
      current_task_index: 1,
      last_updated: '2026-03-06T10:01:00.000Z',
    })
  })

  test('formats task execution progress for phase 11 status output', async () => {
    const { formatTaskExecutionProgressLines } = await import('../lib/task-execution.mjs')

    expect(
      formatTaskExecutionProgressLines({
        phaseState: 'IMPLEMENTING_TASKS',
        taskExecution: {
          total: 12,
          completed_task_ids: ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07'],
          failed_task_id: 'T08',
          current_task_index: 7,
          last_updated: '2026-03-06T10:01:00.000Z',
        },
      }),
    ).toEqual([
      'Phase 11: Per-task implementation (in progress)',
      '  Tasks: 7 / 12 completed',
      '  Last completed: T07',
      '  Failed: T08',
    ])

    expect(
      formatTaskExecutionProgressLines({
        phaseState: 'INTEGRATION_REVIEW_DONE',
        taskExecution: {
          total: 12,
          completed_task_ids: ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12'],
          failed_task_id: null,
          current_task_index: 12,
          last_updated: '2026-03-06T10:05:00.000Z',
        },
      }),
    ).toEqual([
      'Phase 11: Per-task implementation (complete)',
      '  Tasks: 12 / 12 completed',
      '  Last completed: T12',
    ])
  })

  test('run pipeline wires task execution state into resume, status, and failure handling', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')

    expect(runSource).toContain('task_execution')
    expect(runSource).toContain('hydrateTaskExecutionState')
    expect(runSource).toContain('recordFailedTask')
    expect(runSource).toContain('recordCommittedTask')
    expect(runSource).toContain('Skipping task ${taskId}: already committed (double-commit guard).')
    expect(runSource).toContain('formatTaskExecutionProgressLines')
    expect(runSource).toContain('writeJsonFileAtomic(statePath')
  })
})

describe('atomic state writes', () => {
  test('writes json through a temp file rename', async () => {
    const { writeJsonFileAtomic } = await import('../lib/fs.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-state-'))
    const statePath = path.join(tmpDir, 'state.json')

    await writeJsonFileAtomic(statePath, { state: 'IMPLEMENTING_TASKS' })

    const raw = await fs.readFile(statePath, 'utf8')
    expect(JSON.parse(raw)).toEqual({ state: 'IMPLEMENTING_TASKS' })

    const entries = await fs.readdir(tmpDir)
    expect(entries).toEqual(['state.json'])
  })
})
