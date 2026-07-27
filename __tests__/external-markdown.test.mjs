/** @jest-environment node */

import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { appendMarkdownUnique, readTextFile, writeTextFile } from '../lib/fs.mjs'

describe('appendMarkdownUnique', () => {
  it('appends only new items to an existing markdown list', async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), 'codex-markdown-'))
    const filePath = path.join(runDir, 'list.md')

    await writeTextFile(filePath, '- first\n')
    await appendMarkdownUnique(filePath, ['first', 'second'])

    let content = await readTextFile(filePath)
    expect(content.match(/- first/g)?.length).toBe(1)
    expect(content).toContain('- second')

    await appendMarkdownUnique(filePath, ['second', 'third'])
    content = await readTextFile(filePath)
    expect(content.match(/- second/g)?.length).toBe(1)
    expect(content).toContain('- third')
  })
})
