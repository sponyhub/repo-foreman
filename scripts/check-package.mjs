#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORCHESTRATOR_VERSION } from '../lib/manifest.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
const failures = []
const publicDocumentPaths = [
  'README.md',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'docs/architecture.md',
  'docs/artifacts-and-privacy.md',
  'docs/configuration.md',
  'docs/easy-configuration.md',
  'docs/orchestrator-reference.md',
  'docs/releasing.md',
]

function requireValue(condition, message) {
  if (!condition) failures.push(message)
}

requireValue(packageJson.name === 'repo-foreman', 'package name must be repo-foreman')
requireValue(packageJson.version === '0.1.0-beta.1', 'package version must be 0.1.0-beta.1')
requireValue(packageJson.version === ORCHESTRATOR_VERSION, 'package and runtime manifest versions must match')
requireValue(
  packageJson.description === 'Gated workflow orchestrator for Codex CLI.',
  'package description must match the tagline',
)
requireValue(packageJson.license === 'Apache-2.0', 'package license must be Apache-2.0')
requireValue(packageJson.bin?.['repo-foreman'] === './cli.mjs', 'repo-foreman bin must point to ./cli.mjs')
requireValue(Object.keys(packageJson.dependencies ?? {}).length === 0, 'runtime dependencies must remain empty')
requireValue(packageJson.engines?.node === '>=22.14.0', 'Node engine must be >=22.14.0')

for (const relativePath of [
  'cli.mjs',
  'self-test.mjs',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
]) {
  try {
    await access(path.join(repoRoot, relativePath))
  } catch {
    failures.push(`required package file is missing: ${relativePath}`)
  }
}

const cli = await readFile(path.join(repoRoot, 'cli.mjs'), 'utf8')
requireValue(cli.startsWith('#!/usr/bin/env node\n'), 'cli.mjs must start with a Node shebang')

const privateSourcePatterns = [
  /\/Users\/[^/\s]+\/projects\//i,
  /[A-Z]:\\Users\\/i,
  /tools\/[^/\s]*orchestrator/i,
  /npm run [^`\n]*:team/i,
  /check:[^`\n]*migration/i,
]
for (const relativePath of publicDocumentPaths) {
  const document = await readFile(path.join(repoRoot, relativePath), 'utf8')
  for (const pattern of privateSourcePatterns) {
    requireValue(!pattern.test(document), `public documentation contains source-repository text: ${relativePath}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`)
  process.exit(1)
}

console.log('PASS package metadata and required files')
