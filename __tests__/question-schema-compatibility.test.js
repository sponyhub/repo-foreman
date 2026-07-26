/**
 * @jest-environment node
 */

const path = require('node:path')
const fs = require('node:fs/promises')
const Ajv = require('ajv')

const SCHEMAS_DIR = path.join(__dirname, '..', 'schemas')

const STRUCTURED_QUESTION = {
  text: 'Need GDPR approval before proceeding.',
  severity: 'critical',
  category: 'gdpr',
  requires_user_input: true,
}

async function loadValidator(schemaName) {
  const schema = JSON.parse(await fs.readFile(path.join(SCHEMAS_DIR, schemaName), 'utf8'))
  const ajv = new Ajv({ allErrors: true, strict: false })
  return ajv.compile(schema)
}

describe('question payload schema compatibility', () => {
  test('structured question schemas require all metadata keys and allow null when unknown', async () => {
    const schemaNames = [
      'analysis.schema.json',
      'architecture.schema.json',
      'task-graph.schema.json',
      'assumption-hint-capture.schema.json',
      'worker-result.schema.json',
      'failure-manager.schema.json',
      'question-capture.schema.json',
    ]

    for (const schemaName of schemaNames) {
      const schema = JSON.parse(await fs.readFile(path.join(SCHEMAS_DIR, schemaName), 'utf8'))
      const structuredQuestionBranch = schema.$defs.question_item.anyOf.find((entry) => entry.type === 'object')
      expect(structuredQuestionBranch.required).toEqual(['text', 'severity', 'category', 'requires_user_input'])
      expect(structuredQuestionBranch.properties.severity.type).toEqual(['string', 'null'])
      expect(structuredQuestionBranch.properties.category.type).toEqual(['string', 'null'])
      expect(structuredQuestionBranch.properties.requires_user_input.type).toEqual(['boolean', 'null'])
    }
  })

  test('accepts mixed legacy and structured question payloads in targeted schemas', async () => {
    const cases = [
      {
        schema: 'analysis.schema.json',
        payload: {
          gate: {
            status: 'needs_user_input',
            reasons: ['Need explicit data-retention decision.'],
            questions: ['Legacy question', STRUCTURED_QUESTION],
          },
          task: 'Implement feature',
          repo_context_summary: 'Summary',
          scope: { in_scope: [], out_of_scope: [], non_goals: [] },
          assumptions: [],
          risks: [],
          key_files_to_review: [],
          suggested_verification_commands: [],
          stop_conditions: [],
        },
      },
      {
        schema: 'architecture.schema.json',
        payload: {
          gate: {
            status: 'needs_user_input',
            reasons: ['Need compliance approval.'],
            questions: [STRUCTURED_QUESTION],
          },
          architecture_summary: 'Summary',
          decisions: [],
          interface_boundaries: [],
          test_strategy: { unit: [], integration: [], e2e: [] },
          docs_to_update: [],
          open_questions: ['Legacy open question', STRUCTURED_QUESTION],
        },
      },
      {
        schema: 'task-graph.schema.json',
        payload: {
          gate: {
            status: 'needs_user_input',
            reasons: ['Need user input'],
            questions: [STRUCTURED_QUESTION],
          },
          execution_order: [],
          tasks: [],
        },
      },
      {
        schema: 'assumption-hint-capture.schema.json',
        payload: {
          assumptions: [],
          task_hints: [],
          notes: [],
          questions: ['Legacy non-blocking question'],
        },
      },
      {
        schema: 'worker-result.schema.json',
        payload: {
          task_id: 'T1',
          status: 'blocked',
          summary: 'Blocked',
          files_touched: [],
          notes: [],
          followups: [],
          questions: ['Legacy question', STRUCTURED_QUESTION],
        },
      },
      {
        schema: 'failure-manager.schema.json',
        payload: {
          action: 'escalate',
          reason: 'Need explicit input.',
          review_feedback: '',
          verification_feedback: '',
          questions: [STRUCTURED_QUESTION],
          answers: [],
          notes: [],
        },
      },
    ]

    for (const testCase of cases) {
      const validate = await loadValidator(testCase.schema)
      const ok = validate(testCase.payload)
      expect(ok).toBe(true)
    }
  })

  test('rejects structured question entries without text', async () => {
    const validate = await loadValidator('analysis.schema.json')
    const payload = {
      gate: {
        status: 'needs_user_input',
        reasons: ['Need user decision'],
        questions: [{ severity: 'critical', category: 'gdpr', requires_user_input: true }],
      },
      task: 'Implement feature',
      repo_context_summary: 'Summary',
      scope: { in_scope: [], out_of_scope: [], non_goals: [] },
      assumptions: [],
      risks: [],
      key_files_to_review: [],
      suggested_verification_commands: [],
      stop_conditions: [],
    }

    expect(validate(payload)).toBe(false)
  })

  test('accepts structured question entries with null metadata fields', async () => {
    const validate = await loadValidator('analysis.schema.json')
    const payload = {
      gate: {
        status: 'needs_user_input',
        reasons: ['Need user decision'],
        questions: [{ text: 'Need user decision', severity: null, category: null, requires_user_input: null }],
      },
      task: 'Implement feature',
      repo_context_summary: 'Summary',
      scope: { in_scope: [], out_of_scope: [], non_goals: [] },
      assumptions: [],
      risks: [],
      key_files_to_review: [],
      suggested_verification_commands: [],
      stop_conditions: [],
    }

    expect(validate(payload)).toBe(true)
  })

  test('assumption and hint capture schema rejects legacy blocking_questions field', async () => {
    const validate = await loadValidator('assumption-hint-capture.schema.json')
    const payload = {
      assumptions: [],
      task_hints: [],
      notes: [],
      questions: [],
      blocking_questions: ['Should not be accepted here'],
    }

    expect(validate(payload)).toBe(false)
  })
})
