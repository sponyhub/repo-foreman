/**
 * @jest-environment node
 */

const path = require('node:path')
const fs = require('node:fs/promises')

const RUN_FILE = path.join(__dirname, '..', 'lib', 'run.mjs')
const REVIEW_PROMPT_FILE = path.join(__dirname, '..', 'prompts', '04-task-graph-review.md')
const REVIEW_SCHEMA_FILE = path.join(__dirname, '..', 'schemas', 'review.schema.json')

function createTask(id, overrides = {}) {
  return {
    id,
    title: `Task ${id}`,
    type: 'code',
    description: `Update shared file in ${id}`,
    acceptance_criteria: ['shared file updated'],
    dependencies: [],
    risk_level: 'low',
    files: {
      create: [],
      modify: ['lib/run.mjs'],
      delete: [],
    },
    verification_commands: ['npm test'],
    ...overrides,
  }
}

describe('task graph file conflicts', () => {
  test('classifies sequential shared-file tasks with explicit dependency as safe', async () => {
    const { detectFileConflicts } = await import('../lib/task-graph-file-conflicts.mjs')

    const result = detectFileConflicts({
      execution_order: ['T1', 'T2'],
      tasks: [
        createTask('T1'),
        createTask('T2', {
          dependencies: ['T1'],
          acceptance_criteria: ['T1 output is extended safely'],
        }),
      ],
    })

    expect(result).toEqual({
      safe: [
        {
          file: 'lib/run.mjs',
          task_ids: ['T1', 'T2'],
          reason: expect.stringContaining('explicit dependency'),
        },
      ],
      review_required: [],
      blocked: [],
    })
  })

  test('classifies sequential shared-file tasks without documented dependency as review_required', async () => {
    const { detectFileConflicts } = await import('../lib/task-graph-file-conflicts.mjs')

    const result = detectFileConflicts({
      execution_order: ['T1', 'T2'],
      tasks: [createTask('T1'), createTask('T2')],
    })

    expect(result.safe).toEqual([])
    expect(result.blocked).toEqual([])
    expect(result.review_required).toEqual([
      {
        file: 'lib/run.mjs',
        task_ids: ['T1', 'T2'],
        reason: expect.stringContaining('without an explicit dependency'),
      },
    ])
  })

  test('classifies shared-file tasks without a stable execution order as blocked', async () => {
    const { detectFileConflicts } = await import('../lib/task-graph-file-conflicts.mjs')

    const result = detectFileConflicts({
      execution_order: ['T1'],
      tasks: [createTask('T1'), createTask('T2')],
    })

    expect(result.safe).toEqual([])
    expect(result.review_required).toEqual([])
    expect(result.blocked).toEqual([
      {
        file: 'lib/run.mjs',
        task_ids: ['T1', 'T2'],
        reason: expect.stringContaining('stable execution order'),
      },
    ])
  })

  test('treats tasks with no files field as empty file lists', async () => {
    const { detectFileConflicts } = await import('../lib/task-graph-file-conflicts.mjs')

    const result = detectFileConflicts({
      execution_order: ['T1', 'T2'],
      tasks: [createTask('T1', { files: undefined }), createTask('T2', { files: undefined })],
    })

    expect(result).toEqual({
      safe: [],
      review_required: [],
      blocked: [],
    })
  })

  test('returns an empty conflict map for a single-task graph', async () => {
    const { detectFileConflicts } = await import('../lib/task-graph-file-conflicts.mjs')

    const result = detectFileConflicts({
      execution_order: ['T1'],
      tasks: [createTask('T1')],
    })

    expect(result).toEqual({
      safe: [],
      review_required: [],
      blocked: [],
    })
  })

  test('detects missing reviewer acknowledgements for review_required conflicts', async () => {
    const { findMissingConflictAcknowledgements } = await import('../lib/task-graph-file-conflicts.mjs')

    const missing = findMissingConflictAcknowledgements({
      reviewRequiredConflicts: [
        { file: 'lib/run.mjs', task_ids: ['T1', 'T2'], reason: 'shared file' },
        { file: 'README.md', task_ids: ['T2', 'T3'], reason: 'shared docs file' },
      ],
      review: {
        acknowledged_conflicts: ['README.md'],
      },
    })

    expect(missing).toEqual(['lib/run.mjs'])
  })

  test('run pipeline persists file conflicts and task-graph review prompt/schema expose acknowledgements', async () => {
    const [runSource, reviewPromptRaw, reviewSchemaRaw] = await Promise.all([
      fs.readFile(RUN_FILE, 'utf8'),
      fs.readFile(REVIEW_PROMPT_FILE, 'utf8'),
      fs.readFile(REVIEW_SCHEMA_FILE, 'utf8'),
    ])
    const reviewSchema = JSON.parse(reviewSchemaRaw)

    expect(runSource).toContain('detectFileConflicts')
    expect(runSource).toContain('file_conflict_map')
    expect(runSource).toContain('findMissingConflictAcknowledgements')
    expect(reviewPromptRaw).toContain('{{REVIEW_REQUIRED_CONFLICTS}}')
    expect(reviewPromptRaw).toContain('acknowledged_conflicts')
    expect(reviewSchema.properties.acknowledged_conflicts).toBeDefined()
  })
})
