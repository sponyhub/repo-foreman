/** @jest-environment node */

import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runShellCommand } from '../lib/verify.mjs'

describe('runShellCommand logging', () => {
  it('appends multiple command outputs to the same log', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'codex-verify-'))
    const logPath = path.join(runDir, 'verify.log')

    await runShellCommand({ command: "node -e \"console.log('one')\"", cwd: runDir, logPath })
    await runShellCommand({ command: "node -e \"console.log('two')\"", cwd: runDir, logPath })

    const log = await readFile(logPath, 'utf8')

    expect(log).toContain('one')
    expect(log).toContain('two')
    expect(log.indexOf('one')).toBeLessThan(log.indexOf('two'))
  })

  it('captures the tail of command output when truncated', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'codex-verify-tail-'))
    const logPath = path.join(runDir, 'verify.log')

    const result = await runShellCommand({
      command: "node -e \"process.stdout.write('0123456789')\"",
      cwd: runDir,
      logPath,
      maxCaptureBytes: 4,
    })

    expect(result.output).toBe('6789')
  })
})
