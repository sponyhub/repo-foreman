/** @jest-environment node */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

describe('RepoForeman git helpers', () => {
  it('detects clean vs dirty worktrees', async () => {
    const { hasChanges } = await import('../lib/git.mjs')

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-orch-git-'))
    try {
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' })

      expect(await hasChanges(tmpDir)).toBe(false)

      fs.writeFileSync(path.join(tmpDir, 'README.md'), 'test\n')
      expect(await hasChanges(tmpDir)).toBe(true)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
