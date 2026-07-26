/** @jest-environment node */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

describe('PatchGantry cache', () => {
  it('returns cached output when present and not forced', async () => {
    const { maybeLoadCachedPhase } = await import('../lib/cache.mjs')

    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'patch-gantry-cache-'))
    try {
      const phaseDir = path.join(tmpDir, 'analysis')
      rmSync(phaseDir, { recursive: true, force: true })
      // mkdirSync via writeFileSync parent creation is not automatic; create dir.
      await import('node:fs/promises').then(({ mkdir }) => mkdir(phaseDir, { recursive: true }))

      writeFileSync(path.join(phaseDir, 'meta.json'), JSON.stringify({ exit_code: 0 }), 'utf8')
      writeFileSync(path.join(phaseDir, 'output.json'), JSON.stringify({ gate: { status: 'pass' } }), 'utf8')

      await expect(maybeLoadCachedPhase({ phaseDir, force: false })).resolves.toEqual({
        gate: { status: 'pass' },
      })
      await expect(maybeLoadCachedPhase({ phaseDir, force: true })).resolves.toBeNull()
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
