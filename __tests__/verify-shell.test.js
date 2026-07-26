/**
 * @jest-environment node
 */

import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile } from 'node:fs/promises'

describe('runShellCommand', () => {
  test('retries with escaped parentheses on shell syntax error', async () => {
    const { runShellCommand } = await import('../lib/verify.mjs')
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    const logPath = path.join(tmpDir, 'verify.log')

    const result = await runShellCommand({
      command: 'echo __tests__/app/(auth)/register/page.test.tsx',
      cwd: process.cwd(),
      logPath,
    })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('__tests__/app/(auth)/register/page.test.tsx')
    const log = await readFile(logPath, 'utf8')
    expect(log).toContain('__tests__/app/(auth)/register/page.test.tsx')
  })

  test('interrupts a running shell command when the interaction signal aborts', async () => {
    const { runShellCommand, ShellCommandInterruptedError } = await import('../lib/verify.mjs')
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    const logPath = path.join(tmpDir, 'verify.log')
    const controller = new AbortController()

    setTimeout(() => {
      controller.abort(new Error('terminal abort'))
    }, 100)

    await expect(
      runShellCommand({
        command: "node -e \"setTimeout(() => console.log('late'), 5000)\"",
        cwd: process.cwd(),
        logPath,
        interruptSignal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(ShellCommandInterruptedError)
  })
})
