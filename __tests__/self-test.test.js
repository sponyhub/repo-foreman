/**
 * @jest-environment node
 */

const fs = require('node:fs/promises')
const path = require('node:path')

describe('codex orchestrator self-test', () => {
  test('package.json exposes the standalone self-test script', async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8'),
    )

    expect(packageJson.scripts['self-test']).toBe('node ./self-test.mjs')
  })

  test('evaluates the required dry-run, task execution, and synthetic gate assertions', async () => {
    const { evaluateSelfTestReport } = await import('../lib/self-test.mjs')

    const report = evaluateSelfTestReport({
      dryRun: {
        checkpoints: ['blocking_question_precheck'],
      },
      executionRun: {
        checkpoints: ['baseline_verification'],
        state: {
          baseline_verification: {
            passed: true,
            commands_run: ['node -e "process.exit(0)"'],
            results: [],
            known_failures: [],
          },
          task_execution: {
            total: 1,
            completed_task_ids: ['stub-task-1'],
          },
        },
      },
      syntheticGate: {
        blocked: true,
        reason: 'schema_invalid',
        implementationLoopProtected: true,
      },
    })

    expect(report.ok).toBe(true)
    expect(report.checks).toEqual([
      expect.objectContaining({ id: 'dry_run_blocking_question_precheck', ok: true }),
      expect.objectContaining({ id: 'execution_baseline_verification', ok: true }),
      expect.objectContaining({ id: 'execution_task_progress_written', ok: true }),
      expect.objectContaining({ id: 'synthetic_gate_blocks_before_loop', ok: true }),
    ])
  })

  test('fails when required checkpoints are missing', async () => {
    const { evaluateSelfTestReport } = await import('../lib/self-test.mjs')

    const report = evaluateSelfTestReport({
      dryRun: {
        checkpoints: [],
      },
      executionRun: {
        checkpoints: [],
        state: {
          task_execution: {
            total: 1,
            completed_task_ids: [],
          },
        },
      },
      syntheticGate: {
        blocked: false,
        reason: null,
        implementationLoopProtected: false,
      },
    })

    expect(report.ok).toBe(false)
    expect(report.failures).toEqual([
      'dry_run_blocking_question_precheck',
      'execution_baseline_verification',
      'execution_task_progress_written',
      'synthetic_gate_blocks_before_loop',
    ])
  })
})
