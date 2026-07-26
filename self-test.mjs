#!/usr/bin/env node

import { runSelfTest } from './lib/self-test.mjs'

const report = await runSelfTest()

console.log('RepoForeman self-test')
for (const check of report.checks) {
  console.log(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`)
}

if (!report.ok) {
  console.error(`\nSelf-test failed: ${report.failures.join(', ')}`)
  process.exit(1)
}
