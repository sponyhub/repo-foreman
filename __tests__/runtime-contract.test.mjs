/**
 * @jest-environment node
 */

import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(import.meta.dirname, '..')

describe('orchestrator runtime contract', () => {
  test('CLI help advertises the public package and safe runtime defaults', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(repoRoot, 'cli.mjs'), 'help'],
      { cwd: repoRoot },
    )

    expect(stdout).toContain('RepoForeman v0.1.0-beta.1')
    expect(stdout).toContain('Model: gpt-5.6-sol')
    expect(stdout).toContain('Default reasoning effort: xhigh')
    expect(stdout).toContain('Sandbox: read-only for planning/review; workspace-write for implementation')
    expect(stdout).toContain('Host-wide access: danger-full-access requires --unsafe-host-access')
    expect(stdout).toContain('Web search: disabled')
    expect(stdout).toContain('Branch names: opaque repo-foreman/run-<RUN_ID>')
  })
})
