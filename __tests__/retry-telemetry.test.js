/**
 * @jest-environment node
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp } from 'node:fs/promises'

describe('retry telemetry contract', () => {
  test('fails validation when required fields are missing', async () => {
    const { validateRetryEventContract } = await import('../lib/retry-telemetry.mjs')

    expect(() =>
      validateRetryEventContract({
        timestamp: '2026-03-04T10:00:00.000Z',
        phase: 'analysis',
        loop: 'task_graph',
        attempt: 1,
        budget: 3,
        cause_code: 'unknown_retry_cause',
      }),
    ).toThrow(/missing required retry telemetry field: run_id/i)
  })

  test('rejects disallowed and secret-like payload fields', async () => {
    const { validateRetryEventContract } = await import('../lib/retry-telemetry.mjs')

    expect(() =>
      validateRetryEventContract({
        timestamp: '2026-03-04T10:00:00.000Z',
        run_id: 'run-123',
        phase: 'analysis',
        loop: 'task_graph',
        attempt: 1,
        budget: 3,
        cause_code: 'unknown_retry_cause',
        prompt_text: 'full prompt should never be persisted',
      }),
    ).toThrow(/disallowed retry telemetry field/i)

    expect(() =>
      validateRetryEventContract({
        timestamp: '2026-03-04T10:00:00.000Z',
        run_id: 'run-123',
        phase: 'analysis',
        loop: 'task_graph',
        attempt: 1,
        budget: 3,
        cause_code: 'unknown_retry_cause',
        api_token: 'not-a-secret',
      }),
    ).toThrow(/secret-like retry telemetry field/i)
  })

  test('maps retry families to canonical cause codes with unknown fallback', async () => {
    const { resolveRetryCauseCode } = await import('../lib/retry-telemetry.mjs')

    expect(resolveRetryCauseCode('policy_guidance_retry')).toBe('structural_policy_churn')
    expect(resolveRetryCauseCode('task_graph_budget_replan')).toBe('structural_review_non_actionable')
    expect(resolveRetryCauseCode('worker_retry')).toBe('productive_defect_found')
    expect(resolveRetryCauseCode('gate_wait_for_user')).toBe('structural_gate_ambiguity')
    expect(resolveRetryCauseCode('unknown-family')).toBe('unknown_retry_cause')
  })

  test('appends retry events and computes deterministic rollups from artifacts', async () => {
    const { appendRetryEvent, readRetryEvents, rollupRetryEvents, RETRY_EVENTS_FILENAME } = await import(
      '../lib/retry-telemetry.mjs'
    )
    const { fileExists } = await import('../lib/fs.mjs')

    const runDir = await mkdtemp(path.join(os.tmpdir(), 'retry-telemetry-'))

    await appendRetryEvent({
      runDir,
      event: {
        timestamp: '2026-03-04T12:00:00.000Z',
        run_id: 'run-123',
        phase: 'analysis',
        loop: 'policy_guidance',
        attempt: 1,
        budget: 4,
        cause_code: 'structural_policy_churn',
      },
    })
    await appendRetryEvent({
      runDir,
      event: {
        timestamp: '2026-03-04T12:01:00.000Z',
        run_id: 'run-123',
        phase: 'analysis',
        loop: 'review_fix',
        attempt: 2,
        budget: 4,
        cause_code: 'productive_defect_found',
      },
    })
    await appendRetryEvent({
      runDir,
      event: {
        timestamp: '2026-03-04T12:02:00.000Z',
        run_id: 'run-123',
        phase: 'task:verification',
        loop: 'gate_wait_for_user',
        attempt: 1,
        budget: 4,
        cause_code: 'structural_gate_ambiguity',
      },
    })

    expect(await fileExists(path.join(runDir, RETRY_EVENTS_FILENAME))).toBe(true)

    const events = await readRetryEvents({ runDir })
    expect(events).toHaveLength(3)

    expect(rollupRetryEvents(events)).toEqual({
      total_events: 3,
      structural_events: 2,
      productive_events: 1,
      unknown_events: 0,
      by_cause: {
        productive_defect_found: 1,
        structural_gate_ambiguity: 1,
        structural_policy_churn: 1,
      },
      by_phase: {
        analysis: 2,
        'task:verification': 1,
      },
    })
  })
})
