/**
 * @jest-environment node
 */

const path = require('node:path')
const fs = require('node:fs/promises')

const RUN_FILE = path.join(__dirname, '..', 'lib', 'run.mjs')
const SUMMARY_PROMPT_FILE = path.join(__dirname, '..', 'prompts', '06-summary.md')
const SUMMARY_SCHEMA_FILE = path.join(__dirname, '..', 'schemas', 'summary.schema.json')

function createValidSyntheticTask(overrides = {}) {
  return {
    id: 'review-fix-1',
    title: 'Address integration issue',
    type: 'refactor',
    description: 'Fix the reported issue.',
    acceptance_criteria: ['Issue is fixed'],
    dependencies: [],
    risk_level: 'medium',
    files: { create: [], modify: ['lib/run.mjs'], delete: [] },
    verification_commands: ['npm test'],
    ...overrides,
  }
}

describe('synthetic task gate', () => {
  test('blocks synthetic tasks that exceed the delete limit', async () => {
    const { gateSyntheticTaskForEnqueue } = await import('../lib/synthetic-task-gate.mjs')

    const result = await gateSyntheticTaskForEnqueue({
      task: createValidSyntheticTask({
        files: { create: [], modify: [], delete: ['a.ts', 'b.ts'] },
      }),
      sourcePhase: 'integration_review',
      policy: { max_deleted_files: 1 },
      architecture: { docs_to_update: ['README.md'] },
      mode: 'autonomous',
    })

    expect(result).toMatchObject({
      ok: false,
      blocked: {
        id: 'review-fix-1',
        reason: 'delete_limit_exceeded',
        source_phase: 'integration_review',
      },
    })
  })

  test('blocks synthetic tasks with invalid schema', async () => {
    const { gateSyntheticTaskForEnqueue } = await import('../lib/synthetic-task-gate.mjs')

    const task = createValidSyntheticTask()
    delete task.acceptance_criteria

    const result = await gateSyntheticTaskForEnqueue({
      task,
      sourcePhase: 'integration_review',
      policy: { max_deleted_files: 1 },
      architecture: { docs_to_update: ['README.md'] },
      mode: 'autonomous',
    })

    expect(result).toMatchObject({
      ok: false,
      blocked: {
        id: 'review-fix-1',
        reason: 'schema_invalid',
        source_phase: 'integration_review',
      },
    })
  })

  test('blocks architecture drift and produces an interactive escalation question', async () => {
    const { gateSyntheticTaskForEnqueue } = await import('../lib/synthetic-task-gate.mjs')

    const result = await gateSyntheticTaskForEnqueue({
      task: createValidSyntheticTask({
        docs_to_update: ['README.md', 'docs/new-contract.md'],
      }),
      sourcePhase: 'verification_review',
      policy: { max_deleted_files: 1 },
      architecture: { docs_to_update: ['README.md'] },
      mode: 'interactive',
    })

    expect(result).toMatchObject({
      ok: false,
      blocked: {
        id: 'review-fix-1',
        reason: 'architecture_drift',
        source_phase: 'verification_review',
      },
      escalationQuestion: expect.stringContaining('docs/new-contract.md'),
    })
  })

  test('passes valid synthetic tasks through unchanged', async () => {
    const { gateSyntheticTaskForEnqueue } = await import('../lib/synthetic-task-gate.mjs')

    const task = createValidSyntheticTask({
      docs_to_update: ['README.md'],
    })

    const result = await gateSyntheticTaskForEnqueue({
      task,
      sourcePhase: 'verification_review',
      policy: { max_deleted_files: 1 },
      architecture: { docs_to_update: ['README.md'] },
      mode: 'autonomous',
    })

    expect(result).toEqual({
      ok: true,
      task,
    })
  })

  test('run pipeline gates both integration and verification synthetic tasks before execution', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')
    const gateCalls = runSource.match(/gateSyntheticTaskForEnqueue\(/g) ?? []

    expect(gateCalls).toHaveLength(2)
  })

  test('summary prompt and schema expose blocked synthetic tasks', async () => {
    const [runSource, summaryPromptRaw, summarySchemaRaw] = await Promise.all([
      fs.readFile(RUN_FILE, 'utf8'),
      fs.readFile(SUMMARY_PROMPT_FILE, 'utf8'),
      fs.readFile(SUMMARY_SCHEMA_FILE, 'utf8'),
    ])
    const summarySchema = JSON.parse(summarySchemaRaw)

    expect(summaryPromptRaw).toContain('synthetic_tasks_blocked')
    expect(summaryPromptRaw).toContain('{{STATE_PATH}}')
    expect(runSource).toContain('STATE_PATH:')
    expect(summarySchema.properties.synthetic_tasks_blocked).toBeDefined()
    expect(summarySchema.required).toContain('synthetic_tasks_blocked')
  })
})
