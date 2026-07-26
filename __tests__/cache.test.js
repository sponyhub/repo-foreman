/**
 * @jest-environment node
 */

const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs/promises')

async function seedCachedPhase({ phaseDir, meta, output }) {
  await fs.mkdir(phaseDir, { recursive: true })
  await fs.writeFile(path.join(phaseDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  await fs.writeFile(path.join(phaseDir, 'output.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8')
}

describe('phase cache fingerprint safety', () => {
  test('cache miss when prompt text changes', async () => {
    const { createPhaseInputFingerprint, loadCachedPhaseWithDiagnostics } = await import('../lib/cache.mjs')

    const phaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-cache-'))
    const baselineFingerprint = createPhaseInputFingerprint({
      promptText: 'Plan task graph for feature A',
      schemaText: '{"type":"object"}',
      runtimeConfig: { review_mode: 'balanced', max_worker_attempts: 3 },
      baseSha: 'abc123',
    })

    await seedCachedPhase({
      phaseDir,
      meta: {
        exit_code: 0,
        input_fingerprint: baselineFingerprint,
      },
      output: { ok: true, source: 'cache' },
    })

    const expectedFingerprint = createPhaseInputFingerprint({
      promptText: 'Plan task graph for feature B',
      schemaText: '{"type":"object"}',
      runtimeConfig: { review_mode: 'balanced', max_worker_attempts: 3 },
      baseSha: 'abc123',
    })

    const result = await loadCachedPhaseWithDiagnostics({
      phaseDir,
      expectedInputFingerprint: expectedFingerprint,
    })

    expect(result.status).toBe('fingerprint_mismatch')
    expect(result.output).toBeNull()
    expect(result.fingerprintMismatch).toMatchObject({
      expected_fingerprint: expectedFingerprint.fingerprint,
      actual_fingerprint: baselineFingerprint.fingerprint,
    })
    expect(result.fingerprintMismatch.changed_dimensions).toContain('prompt_text_hash')
  })

  test('cache miss when schema content changes', async () => {
    const { createPhaseInputFingerprint, loadCachedPhaseWithDiagnostics } = await import('../lib/cache.mjs')

    const phaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-cache-'))
    const baselineFingerprint = createPhaseInputFingerprint({
      promptText: 'Render architecture phase',
      schemaText: '{"type":"object","required":["gate"]}',
      runtimeConfig: { review_mode: 'strict', task_tests: 'npm test' },
      baseSha: 'def456',
    })

    await seedCachedPhase({
      phaseDir,
      meta: {
        exit_code: 0,
        input_fingerprint: baselineFingerprint,
      },
      output: { ok: true, source: 'cache' },
    })

    const expectedFingerprint = createPhaseInputFingerprint({
      promptText: 'Render architecture phase',
      schemaText: '{"type":"object","required":["gate","risks"]}',
      runtimeConfig: { review_mode: 'strict', task_tests: 'npm test' },
      baseSha: 'def456',
    })

    const result = await loadCachedPhaseWithDiagnostics({
      phaseDir,
      expectedInputFingerprint: expectedFingerprint,
    })

    expect(result.status).toBe('fingerprint_mismatch')
    expect(result.output).toBeNull()
    expect(result.fingerprintMismatch.changed_dimensions).toContain('schema_hash')
  })

  test('cache miss when runtime config changes and config hashing is stable', async () => {
    const { createPhaseInputFingerprint, loadCachedPhaseWithDiagnostics } = await import('../lib/cache.mjs')

    const phaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-cache-'))

    const orderedConfigFingerprint = createPhaseInputFingerprint({
      promptText: 'Run worker',
      schemaText: '{"type":"object"}',
      runtimeConfig: { mode: 'autonomous', review_mode: 'balanced', max_worker_attempts: 3 },
      baseSha: 'fedcba',
    })

    const reorderedConfigFingerprint = createPhaseInputFingerprint({
      promptText: 'Run worker',
      schemaText: '{"type":"object"}',
      runtimeConfig: { max_worker_attempts: 3, review_mode: 'balanced', mode: 'autonomous' },
      baseSha: 'fedcba',
    })

    expect(reorderedConfigFingerprint.fingerprint).toBe(orderedConfigFingerprint.fingerprint)

    await seedCachedPhase({
      phaseDir,
      meta: {
        exit_code: 0,
        input_fingerprint: orderedConfigFingerprint,
      },
      output: { ok: true, source: 'cache' },
    })

    const changedRuntimeFingerprint = createPhaseInputFingerprint({
      promptText: 'Run worker',
      schemaText: '{"type":"object"}',
      runtimeConfig: { mode: 'autonomous', review_mode: 'strict', max_worker_attempts: 3 },
      baseSha: 'fedcba',
    })

    const result = await loadCachedPhaseWithDiagnostics({
      phaseDir,
      expectedInputFingerprint: changedRuntimeFingerprint,
    })

    expect(result.status).toBe('fingerprint_mismatch')
    expect(result.output).toBeNull()
    expect(result.fingerprintMismatch.changed_dimensions).toContain('runtime_config_hash')
  })

  test('--force bypass still skips cache hits', async () => {
    const { createPhaseInputFingerprint, maybeLoadCachedPhase } = await import('../lib/cache.mjs')

    const phaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-cache-'))
    const fingerprint = createPhaseInputFingerprint({
      promptText: 'Run analysis',
      schemaText: '{"type":"object"}',
      runtimeConfig: { mode: 'autonomous' },
      baseSha: 'aaaaaa',
    })

    const output = { ok: true, source: 'cache' }
    await seedCachedPhase({
      phaseDir,
      meta: {
        exit_code: 0,
        input_fingerprint: fingerprint,
      },
      output,
    })

    const cached = await maybeLoadCachedPhase({
      phaseDir,
      force: false,
      expectedInputFingerprint: fingerprint,
    })

    expect(cached).toEqual(output)

    const forced = await maybeLoadCachedPhase({
      phaseDir,
      force: true,
      expectedInputFingerprint: fingerprint,
    })

    expect(forced).toBeNull()
  })
})
