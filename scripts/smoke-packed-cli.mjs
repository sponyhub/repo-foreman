#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'patch-gantry-package-smoke-'))

async function run(command, args, cwd) {
  return await execFileAsync(command, args, {
    cwd,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  })
}

try {
  const packDir = path.join(tempRoot, 'pack')
  const consumerDir = path.join(tempRoot, 'consumer')
  await mkdir(packDir, { recursive: true })
  await mkdir(consumerDir, { recursive: true })
  await writeFile(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify({ name: 'patch-gantry-smoke-consumer', version: '1.0.0', private: true }, null, 2)}\n`,
    'utf8',
  )

  const packed = await run(
    npmBin,
    ['pack', '--ignore-scripts', '--json', '--pack-destination', packDir],
    repoRoot,
  )
  const packReport = JSON.parse(packed.stdout)
  const filename = packReport?.[0]?.filename
  if (typeof filename !== 'string' || !filename.endsWith('.tgz')) {
    throw new Error('npm pack did not report a tarball filename')
  }

  const tarballPath = path.join(packDir, filename)
  await run(
    npmBin,
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', tarballPath],
    consumerDir,
  )

  const installedBin = path.join(consumerDir, 'node_modules', '.bin', 'patch-gantry')
  const help = await run(installedBin, ['help'], consumerDir)
  if (!help.stdout.includes('PatchGantry v0.1.0-beta.1') || !help.stdout.includes('patch-gantry <command>')) {
    throw new Error('installed patch-gantry bin returned unexpected help output')
  }

  console.log(`PASS packed CLI install and help (${filename})`)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
