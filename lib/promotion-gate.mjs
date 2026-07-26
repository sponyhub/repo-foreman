import path from 'node:path'
import { fileExists, readJsonFile } from './fs.mjs'
import { readRetryEvents, rollupRetryEvents } from './retry-telemetry.mjs'

const VERIFICATION_PASS_STATES = new Set(['TESTS_PASSED', 'COVERAGE_PASSED', 'AUDIT_PASSED'])
const MANUAL_CHECKS = Object.freeze(['security_gdpr_defect_catch_quality'])

function parseIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return Number.NaN
  }
  return Date.parse(value)
}

function toFixedMetric(value) {
  if (!Number.isFinite(value)) {
    return null
  }
  return Number(value.toFixed(6))
}

function median(values) {
  const list = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
  if (list.length === 0) {
    return null
  }
  const mid = Math.floor(list.length / 2)
  if (list.length % 2 === 0) {
    return Math.round((list[mid - 1] + list[mid]) / 2)
  }
  return list[mid]
}

function compareMetric({ baseline, candidate, direction }) {
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate)) {
    return { status: 'unavailable', baseline: baseline ?? null, candidate: candidate ?? null }
  }
  if (candidate === baseline) {
    return { status: 'unchanged', baseline, candidate }
  }
  if (direction === 'lower') {
    return { status: candidate < baseline ? 'improved' : 'regressed', baseline, candidate }
  }
  return { status: candidate > baseline ? 'improved' : 'regressed', baseline, candidate }
}

function normalizeString(value, fallback = 'unknown') {
  if (typeof value !== 'string') {
    return fallback
  }
  const normalized = value.trim()
  return normalized || fallback
}

function buildProfileIdentity(manifest) {
  const reviewMode = normalizeString(manifest?.review_mode)
  const policyPreset = normalizeString(manifest?.policy?.preset, 'off')
  const runtimeConfig = manifest?.runtime_config ?? {}
  const policyAllowlistMode = normalizeString(runtimeConfig.policy_allowlist_mode, 'off')
  const taskTests = normalizeString(runtimeConfig.task_tests, 'npm test')
  const finalTests = normalizeString(runtimeConfig.final_tests, 'npm test')

  const profile = {
    review_mode: reviewMode,
    policy_preset: policyPreset,
    policy_allowlist_mode: policyAllowlistMode,
    task_tests: taskTests,
    final_tests: finalTests,
  }

  return {
    ...profile,
    key: [
      `review_mode=${profile.review_mode}`,
      `policy_preset=${profile.policy_preset}`,
      `policy_allowlist_mode=${profile.policy_allowlist_mode}`,
      `task_tests=${profile.task_tests}`,
      `final_tests=${profile.final_tests}`,
    ].join(';'),
  }
}

async function loadRunSummary(runDir) {
  const statePath = path.join(runDir, 'state.json')
  const manifestPath = path.join(runDir, 'manifest.json')

  if (!(await fileExists(statePath)) || !(await fileExists(manifestPath))) {
    return null
  }

  const state = await readJsonFile(statePath)
  const manifest = await readJsonFile(manifestPath)
  const retryEvents = await readRetryEvents({ runDir })
  const retryRollup = rollupRetryEvents(retryEvents)

  const createdAtMs = parseIsoTimestamp(manifest.created_at)
  const updatedAtMs = parseIsoTimestamp(state.updated_at)
  const durationMs = Number.isFinite(createdAtMs) && Number.isFinite(updatedAtMs) && updatedAtMs >= createdAtMs
    ? updatedAtMs - createdAtMs
    : null

  return {
    run_id: normalizeString(state.run_id),
    run_dir: runDir,
    updated_at: Number.isFinite(updatedAtMs) ? new Date(updatedAtMs).toISOString() : null,
    updated_at_ms: Number.isFinite(updatedAtMs) ? updatedAtMs : Number.NaN,
    duration_ms: durationMs,
    verification_passed: VERIFICATION_PASS_STATES.has(normalizeString(state.state)),
    retry_rollup: retryRollup,
    profile: buildProfileIdentity(manifest),
  }
}

function computeWindowMetrics(runs) {
  const totalRuns = runs.length
  const totalRetryEvents = runs.reduce((sum, run) => sum + (run.retry_rollup?.total_events ?? 0), 0)
  const structuralRetryEvents = runs.reduce((sum, run) => sum + (run.retry_rollup?.structural_events ?? 0), 0)
  const verificationPassed = runs.reduce((sum, run) => sum + (run.verification_passed ? 1 : 0), 0)
  const durations = runs.map((run) => run.duration_ms).filter((value) => Number.isFinite(value))
  const structuralRetryRate = totalRetryEvents > 0 ? structuralRetryEvents / totalRetryEvents : 0
  const verificationSuccessRate = totalRuns > 0 ? verificationPassed / totalRuns : null

  return {
    run_count: totalRuns,
    total_retry_events: totalRetryEvents,
    structural_retry_events: structuralRetryEvents,
    structural_retry_rate: toFixedMetric(structuralRetryRate),
    median_run_duration_ms: median(durations),
    verification_success_rate: toFixedMetric(verificationSuccessRate),
    oldest_run_id: totalRuns > 0 ? runs[0].run_id : null,
    newest_run_id: totalRuns > 0 ? runs[totalRuns - 1].run_id : null,
  }
}

function evaluateProfilePromotionGate({ profile, runs, minSampleSize }) {
  const sortedRuns = [...runs].sort((left, right) => left.updated_at_ms - right.updated_at_ms)
  const requiredRuns = minSampleSize * 2

  const candidateRuns = sortedRuns.slice(-minSampleSize)
  const baselineStart = Math.max(0, sortedRuns.length - requiredRuns)
  const baselineRuns = sortedRuns.slice(baselineStart, sortedRuns.length - minSampleSize)

  const blockers = []
  if (sortedRuns.length < requiredRuns || baselineRuns.length < minSampleSize || candidateRuns.length < minSampleSize) {
    blockers.push('INSUFFICIENT_SAMPLE_SIZE')
  }

  const baselineMetrics = computeWindowMetrics(baselineRuns)
  const candidateMetrics = computeWindowMetrics(candidateRuns)

  const structuralRetryComparison = compareMetric({
    baseline: baselineMetrics.structural_retry_rate,
    candidate: candidateMetrics.structural_retry_rate,
    direction: 'lower',
  })
  const runDurationComparison = compareMetric({
    baseline: baselineMetrics.median_run_duration_ms,
    candidate: candidateMetrics.median_run_duration_ms,
    direction: 'lower',
  })
  const verificationSuccessComparison = compareMetric({
    baseline: baselineMetrics.verification_success_rate,
    candidate: candidateMetrics.verification_success_rate,
    direction: 'higher',
  })

  if (structuralRetryComparison.status === 'regressed') {
    blockers.push('STRUCTURAL_RETRY_REGRESSION')
  }
  if (runDurationComparison.status === 'regressed') {
    blockers.push('RUN_DURATION_REGRESSION')
  }
  if (verificationSuccessComparison.status === 'regressed') {
    blockers.push('VERIFICATION_PASS_RATE_REGRESSION')
  }

  return {
    profile_key: profile.key,
    profile: {
      review_mode: profile.review_mode,
      policy_preset: profile.policy_preset,
      policy_allowlist_mode: profile.policy_allowlist_mode,
      task_tests: profile.task_tests,
      final_tests: profile.final_tests,
    },
    run_count: sortedRuns.length,
    sample_size: {
      minimum_required_per_window: minSampleSize,
      baseline_window: baselineRuns.length,
      candidate_window: candidateRuns.length,
    },
    baseline_metrics: baselineMetrics,
    candidate_metrics: candidateMetrics,
    comparisons: {
      structural_retry_rate: structuralRetryComparison,
      median_run_duration_ms: runDurationComparison,
      verification_success_rate: verificationSuccessComparison,
    },
    gate: {
      status: blockers.length > 0 ? 'block' : 'pass',
      blockers,
      manual_checks: MANUAL_CHECKS,
    },
  }
}

function normalizeSampleSize(value) {
  const parsed = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error('minSampleSize must be a positive integer')
  }
  return parsed
}

export async function evaluatePromotionGateFromRunDirs({ runDirs, minSampleSize = 30 }) {
  const sampleSize = normalizeSampleSize(minSampleSize)
  const list = Array.isArray(runDirs) ? runDirs : []

  const summaries = (await Promise.all(list.map((runDir) => loadRunSummary(runDir)))).filter(Boolean)
  const grouped = new Map()
  for (const summary of summaries) {
    if (!grouped.has(summary.profile.key)) {
      grouped.set(summary.profile.key, { profile: summary.profile, runs: [] })
    }
    grouped.get(summary.profile.key).runs.push(summary)
  }

  const profileReports = Array.from(grouped.values())
    .map(({ profile, runs }) => evaluateProfilePromotionGate({ profile, runs, minSampleSize: sampleSize }))
    .sort((left, right) => left.profile_key.localeCompare(right.profile_key))

  const passProfiles = profileReports.filter((profile) => profile.gate.status === 'pass').length
  const blockProfiles = profileReports.length - passProfiles

  const blockers = []
  if (profileReports.length === 0) {
    blockers.push('NO_PROFILE_DATA')
  }
  if (blockProfiles > 0) {
    blockers.push('PROFILE_GATE_BLOCKED')
  }

  return {
    generated_at: new Date().toISOString(),
    min_sample_size: sampleSize,
    profiles: profileReports,
    summary: {
      overall_status: blockers.length > 0 ? 'block' : 'pass',
      profile_count: profileReports.length,
      pass_profiles: passProfiles,
      block_profiles: blockProfiles,
      blockers,
      manual_checks: MANUAL_CHECKS,
    },
  }
}
