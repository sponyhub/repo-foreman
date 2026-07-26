/**
 * @jest-environment node
 */

const path = require('node:path')
const fs = require('node:fs/promises')

const RUN_FILE = path.join(__dirname, '..', 'lib', 'run.mjs')
const SUMMARY_PROMPT_FILE = path.join(__dirname, '..', 'prompts', '06-summary.md')

describe('synthetic cycle cap', () => {
  test('first synthetic cycle increments from 0 to 1 after a batch is accepted', async () => {
    const { planSyntheticCycleEnqueue } = await import('../lib/synthetic-cycle-cap.mjs')

    const result = planSyntheticCycleEnqueue({
      state: { synthetic_cycle_count: 0 },
      policy: { max_synthetic_cycles: 3 },
      unresolvedFailures: [],
    })

    expect(result.allowed).toBe(true)
    expect(result.statePatch.synthetic_cycle_count).toBe(1)
  })

  test('third cycle is allowed and fourth is blocked when max_synthetic_cycles is 3', async () => {
    const { planSyntheticCycleEnqueue } = await import('../lib/synthetic-cycle-cap.mjs')

    let state = { synthetic_cycle_count: 0 }
    for (let index = 0; index < 3; index += 1) {
      const allowedResult = planSyntheticCycleEnqueue({
        state,
        policy: { max_synthetic_cycles: 3 },
        unresolvedFailures: [],
      })
      expect(allowedResult.allowed).toBe(true)
      state = { ...state, ...allowedResult.statePatch }
    }

    const blockedResult = planSyntheticCycleEnqueue({
      state,
      policy: { max_synthetic_cycles: 3 },
      unresolvedFailures: [
        {
          failure_id: 'VERIFY-1',
          description: 'Remaining verification failure',
          source_phase: 'verification_review',
        },
      ],
    })

    expect(blockedResult.allowed).toBe(false)
    expect(blockedResult.statePatch.synthetic_cycle_count).toBe(3)
    expect(blockedResult.warningMessage).toBe(
      'Synthetic fix cycle cap reached (3). 1 failures remain unresolved. Final status: partial.',
    )
  })

  test('cap hit records unresolved failures with source phase and cycle count at cap', async () => {
    const {
      buildUnresolvedPostCycleFailuresFromIssues,
      planSyntheticCycleEnqueue,
    } = await import('../lib/synthetic-cycle-cap.mjs')

    const unresolvedFailures = buildUnresolvedPostCycleFailuresFromIssues({
      issues: [
        {
          id: 'INT-001',
          description: 'Integration review found a remaining docs mismatch.',
        },
      ],
      sourcePhase: 'integration_review',
      cycleCountAtCap: 3,
    })

    const blockedResult = planSyntheticCycleEnqueue({
      state: { synthetic_cycle_count: 3 },
      policy: { max_synthetic_cycles: 3 },
      unresolvedFailures,
    })

    expect(blockedResult.statePatch.unresolved_post_cycle_failures).toEqual([
      {
        failure_id: 'INT-001',
        description: 'Integration review found a remaining docs mismatch.',
        source_phase: 'integration_review',
        cycle_count_at_cap: 3,
      },
    ])
    expect(blockedResult.statePatch.final_status).toBe('partial')
  })

  test('integration and verification phases share the same synthetic cycle counter', async () => {
    const { planSyntheticCycleEnqueue } = await import('../lib/synthetic-cycle-cap.mjs')

    const afterIntegrationBatch = planSyntheticCycleEnqueue({
      state: { synthetic_cycle_count: 0 },
      policy: { max_synthetic_cycles: 3 },
      unresolvedFailures: [],
    })
    const afterVerificationBatch = planSyntheticCycleEnqueue({
      state: afterIntegrationBatch.statePatch,
      policy: { max_synthetic_cycles: 3 },
      unresolvedFailures: [],
    })

    expect(afterIntegrationBatch.statePatch.synthetic_cycle_count).toBe(1)
    expect(afterVerificationBatch.statePatch.synthetic_cycle_count).toBe(2)
  })

  test('runtime and summary prompt surface unresolved failures when the cycle cap is reached', async () => {
    const [runSource, summaryPromptRaw] = await Promise.all([
      fs.readFile(RUN_FILE, 'utf8'),
      fs.readFile(SUMMARY_PROMPT_FILE, 'utf8'),
    ])

    expect(runSource).toContain('synthetic_cycle_count')
    expect(runSource).toContain('unresolved_post_cycle_failures')
    expect(runSource).toContain('final_status')
    expect(summaryPromptRaw).toContain('Unresolved failures (cycle cap reached)')
    expect(summaryPromptRaw).toContain("Final status is 'partial'")
  })
})
