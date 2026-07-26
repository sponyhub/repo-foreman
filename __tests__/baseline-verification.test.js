/**
 * @jest-environment node
 */

const path = require('node:path')
const fs = require('node:fs/promises')

const RUN_FILE = path.join(__dirname, '..', 'lib', 'run.mjs')
const WORKER_PROMPT_FILE = path.join(__dirname, '..', 'prompts', '03-worker-implement-task.md')
const SUMMARY_PROMPT_FILE = path.join(__dirname, '..', 'prompts', '06-summary.md')
const SUMMARY_SCHEMA_FILE = path.join(__dirname, '..', 'schemas', 'summary.schema.json')

describe('baseline verification', () => {
  test('extracts known baseline failures and falls back to unparseable command markers', async () => {
    const {
      collectKnownFailureIds,
      classifyVerificationFailures,
      summarizeCommandOutput,
    } = await import('../lib/baseline-verification.mjs')

    const results = [
      {
        command: 'npm run type-check',
        exitCode: 2,
        output: 'src/app.ts(7,2): error TS2322: Type string is not assignable to type number.',
      },
      {
        command: 'npm test',
        exitCode: 1,
        output: 'FAIL __tests__/worker.test.ts\n  ● worker retries existing failure',
      },
      {
        command: 'npm run lint',
        exitCode: 1,
        output: 'lint blew up without structured output',
      },
    ]

    expect(collectKnownFailureIds(results)).toEqual([
      'TS2322',
      'worker retries existing failure',
      'npm run lint:unparseable',
    ])
    expect(summarizeCommandOutput(results[0].output)).toContain('TS2322')
    expect(
      classifyVerificationFailures({
        baselineKnownFailures: ['TS2322'],
        currentFailures: ['TS2322', 'TS7006'],
      }),
    ).toEqual([
      { failure: 'TS2322', status: 'pre_existing' },
      { failure: 'TS7006', status: 'introduced_by_task' },
    ])
  })

  test('run pipeline records baseline verification before the task implementation loop', async () => {
    const runSource = await fs.readFile(RUN_FILE, 'utf8')

    expect(runSource).toContain("state: 'BASELINE_VERIFYING'")
    expect(runSource).toContain("state: 'BASELINE_VERIFICATION_DONE'")
    expect(runSource).toContain('baseline_verification')
    expect(runSource).toContain('const baselineVerification = await runBaselineVerificationPhase({')

    const baselineIndex = runSource.indexOf('const baselineVerification = await runBaselineVerificationPhase({')
    const taskLoopIndex = runSource.indexOf("state: 'IMPLEMENTING_TASKS'")
    expect(baselineIndex).toBeGreaterThan(-1)
    expect(taskLoopIndex).toBeGreaterThan(-1)
    expect(baselineIndex).toBeLessThan(taskLoopIndex)
  })

  test('worker prompt receives baseline known failures and summary schema classifies failures', async () => {
    const [runSource, workerPromptRaw, summaryPromptRaw, summarySchemaRaw] = await Promise.all([
      fs.readFile(RUN_FILE, 'utf8'),
      fs.readFile(WORKER_PROMPT_FILE, 'utf8'),
      fs.readFile(SUMMARY_PROMPT_FILE, 'utf8'),
      fs.readFile(SUMMARY_SCHEMA_FILE, 'utf8'),
    ])
    const summarySchema = JSON.parse(summarySchemaRaw)

    expect(workerPromptRaw).toContain('baseline before your task ran')
    expect(workerPromptRaw).toContain('{{BASELINE_KNOWN_FAILURES}}')
    expect(runSource).toContain('BASELINE_KNOWN_FAILURES')
    expect(summaryPromptRaw).toContain('pre_existing')
    expect(summaryPromptRaw).toContain('introduced_by_task')
    expect(summarySchema.properties.verification_failures).toBeDefined()
    expect(summarySchema.required).toContain('verification_failures')
  })
})
