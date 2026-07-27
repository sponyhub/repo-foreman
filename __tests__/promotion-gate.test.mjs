/**
 * @jest-environment node
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'

function buildRetryEvent({ runId, timestamp, causeCode }) {
  return {
    timestamp,
    run_id: runId,
    phase: 'task_execution',
    loop: 'worker_retry',
    attempt: 1,
    budget: 3,
    cause_code: causeCode,
  }
}

async function seedRun({
  rootDir,
  runId,
  createdAt,
  updatedAt,
  state = 'TESTS_PASSED',
  retryEvents = [],
  reviewMode = 'balanced',
  policyPreset = 'strict',
  policyAllowlistMode = 'off',
}) {
  const runDir = path.join(rootDir, runId)
  await mkdir(runDir, { recursive: true })
  await writeFile(
    path.join(runDir, 'state.json'),
    `${JSON.stringify({ run_id: runId, state, branch_name: `codex/${runId}`, updated_at: updatedAt }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    path.join(runDir, 'manifest.json'),
    `${JSON.stringify(
      {
        run_id: runId,
        created_at: createdAt,
        review_mode: reviewMode,
        policy: { preset: policyPreset },
        runtime_config: {
          policy_allowlist_mode: policyAllowlistMode,
          task_tests: 'npm test',
          final_tests: 'npm test',
        },
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  if (retryEvents.length > 0) {
    await writeFile(path.join(runDir, 'retry-events.jsonl'), `${retryEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8')
  }

  return runDir
}

describe('promotion gate baseline comparison', () => {
  test('blocks when there are not enough runs for baseline and candidate windows', async () => {
    const { evaluatePromotionGateFromRunDirs } = await import('../lib/promotion-gate.mjs')
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'promotion-gate-'))

    const runDirs = []
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-1',
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-01T10:10:00.000Z',
      }),
    )
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-2',
        createdAt: '2026-03-01T11:00:00.000Z',
        updatedAt: '2026-03-01T11:10:00.000Z',
      }),
    )
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-3',
        createdAt: '2026-03-01T12:00:00.000Z',
        updatedAt: '2026-03-01T12:10:00.000Z',
      }),
    )

    const report = await evaluatePromotionGateFromRunDirs({ runDirs, minSampleSize: 2 })

    expect(report.summary.overall_status).toBe('block')
    expect(report.profiles[0].gate.blockers).toContain('INSUFFICIENT_SAMPLE_SIZE')
  })

  test('passes when candidate window improves retry rate and duration with stable verification outcomes', async () => {
    const { evaluatePromotionGateFromRunDirs } = await import('../lib/promotion-gate.mjs')
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'promotion-gate-'))
    const runDirs = []

    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-1',
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-01T10:12:00.000Z',
        retryEvents: [
          buildRetryEvent({
            runId: 'run-1',
            timestamp: '2026-03-01T10:02:00.000Z',
            causeCode: 'structural_review_non_actionable',
          }),
          buildRetryEvent({
            runId: 'run-1',
            timestamp: '2026-03-01T10:03:00.000Z',
            causeCode: 'productive_defect_found',
          }),
        ],
      }),
    )
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-2',
        createdAt: '2026-03-01T11:00:00.000Z',
        updatedAt: '2026-03-01T11:12:00.000Z',
        retryEvents: [
          buildRetryEvent({
            runId: 'run-2',
            timestamp: '2026-03-01T11:02:00.000Z',
            causeCode: 'structural_policy_churn',
          }),
          buildRetryEvent({
            runId: 'run-2',
            timestamp: '2026-03-01T11:03:00.000Z',
            causeCode: 'productive_defect_found',
          }),
        ],
      }),
    )
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-3',
        createdAt: '2026-03-01T12:00:00.000Z',
        updatedAt: '2026-03-01T12:08:00.000Z',
        retryEvents: [
          buildRetryEvent({
            runId: 'run-3',
            timestamp: '2026-03-01T12:02:00.000Z',
            causeCode: 'productive_defect_found',
          }),
        ],
      }),
    )
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-4',
        createdAt: '2026-03-01T13:00:00.000Z',
        updatedAt: '2026-03-01T13:08:00.000Z',
        retryEvents: [
          buildRetryEvent({
            runId: 'run-4',
            timestamp: '2026-03-01T13:02:00.000Z',
            causeCode: 'productive_defect_found',
          }),
        ],
      }),
    )

    const report = await evaluatePromotionGateFromRunDirs({ runDirs, minSampleSize: 2 })

    expect(report.summary.overall_status).toBe('pass')
    expect(report.profiles[0].gate.status).toBe('pass')
    expect(report.profiles[0].comparisons.structural_retry_rate.status).toBe('improved')
    expect(report.profiles[0].comparisons.median_run_duration_ms.status).toBe('improved')
    expect(report.profiles[0].comparisons.verification_success_rate.status).toBe('unchanged')
  })

  test('blocks when verification success rate regresses', async () => {
    const { evaluatePromotionGateFromRunDirs } = await import('../lib/promotion-gate.mjs')
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'promotion-gate-'))
    const runDirs = []

    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-1',
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-01T10:10:00.000Z',
      }),
    )
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-2',
        createdAt: '2026-03-01T11:00:00.000Z',
        updatedAt: '2026-03-01T11:10:00.000Z',
      }),
    )
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-3',
        createdAt: '2026-03-01T12:00:00.000Z',
        updatedAt: '2026-03-01T12:08:00.000Z',
      }),
    )
    runDirs.push(
      await seedRun({
        rootDir,
        runId: 'run-4',
        createdAt: '2026-03-01T13:00:00.000Z',
        updatedAt: '2026-03-01T13:08:00.000Z',
        state: 'FAILED',
      }),
    )

    const report = await evaluatePromotionGateFromRunDirs({ runDirs, minSampleSize: 2 })

    expect(report.summary.overall_status).toBe('block')
    expect(report.profiles[0].gate.blockers).toContain('VERIFICATION_PASS_RATE_REGRESSION')
  })
})
