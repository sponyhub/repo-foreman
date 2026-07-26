import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const FINGERPRINT_VERSION = 1
const FINGERPRINT_DIMENSIONS = Object.freeze([
  'prompt_text_hash',
  'schema_hash',
  'runtime_config_hash',
  'base_sha',
])

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry))
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  return Object.keys(value)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = sortJsonValue(value[key])
      return accumulator
    }, {})
}

function stableJsonStringify(value) {
  return JSON.stringify(sortJsonValue(value))
}

function normalizeFingerprintCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null
  }

  if (typeof candidate.fingerprint !== 'string' || !candidate.fingerprint.trim()) {
    return null
  }

  const normalized = {
    version: Number.isFinite(candidate.version) ? Number(candidate.version) : FINGERPRINT_VERSION,
    fingerprint: candidate.fingerprint.trim(),
  }
  for (const dimension of FINGERPRINT_DIMENSIONS) {
    normalized[dimension] = typeof candidate[dimension] === 'string' ? candidate[dimension].trim() : ''
  }
  return normalized
}

function resolveFingerprintChangedDimensions(expected, actual) {
  const changedDimensions = []
  for (const dimension of FINGERPRINT_DIMENSIONS) {
    if ((expected?.[dimension] ?? '') !== (actual?.[dimension] ?? '')) {
      changedDimensions.push(dimension)
    }
  }
  if (
    changedDimensions.length === 0 &&
    (expected?.fingerprint ?? '') !== (actual?.fingerprint ?? '')
  ) {
    changedDimensions.push('fingerprint')
  }
  return changedDimensions
}

export function createPhaseInputFingerprint({ promptText, schemaText, runtimeConfig, baseSha }) {
  const normalizedPrompt = typeof promptText === 'string' ? promptText : String(promptText ?? '')
  const normalizedSchema = typeof schemaText === 'string' ? schemaText : String(schemaText ?? '')
  const normalizedRuntimeConfig = runtimeConfig && typeof runtimeConfig === 'object' ? runtimeConfig : {}
  const normalizedBaseSha = typeof baseSha === 'string' ? baseSha.trim() : ''

  const payload = {
    prompt_text_hash: sha256(normalizedPrompt),
    schema_hash: sha256(normalizedSchema),
    runtime_config_hash: sha256(stableJsonStringify(normalizedRuntimeConfig)),
    base_sha: normalizedBaseSha,
  }

  return {
    version: FINGERPRINT_VERSION,
    ...payload,
    fingerprint: sha256(stableJsonStringify(payload)),
  }
}

export async function loadCachedPhaseWithDiagnostics({
  phaseDir,
  force = false,
  expectedInputFingerprint = null,
}) {
  if (force) {
    return { status: 'force_miss', output: null, meta: null, fingerprintMismatch: null }
  }

  const metaPath = path.join(phaseDir, 'meta.json')
  const outputPath = path.join(phaseDir, 'output.json')

  let metaRaw
  let outputRaw
  try {
    metaRaw = await readFile(metaPath, 'utf8')
    outputRaw = await readFile(outputPath, 'utf8')
  } catch {
    return { status: 'miss', output: null, meta: null, fingerprintMismatch: null }
  }

  let meta
  try {
    meta = JSON.parse(metaRaw)
  } catch {
    return { status: 'miss', output: null, meta: null, fingerprintMismatch: null }
  }

  if (meta?.exit_code !== 0) {
    return { status: 'miss', output: null, meta, fingerprintMismatch: null }
  }

  let output = null
  try {
    output = JSON.parse(outputRaw)
  } catch {
    return { status: 'miss', output: null, meta, fingerprintMismatch: null }
  }

  const normalizedExpectedFingerprint = normalizeFingerprintCandidate(expectedInputFingerprint)
  if (!normalizedExpectedFingerprint) {
    return { status: 'hit', output, meta, fingerprintMismatch: null }
  }

  const normalizedActualFingerprint = normalizeFingerprintCandidate(meta?.input_fingerprint)
  if (!normalizedActualFingerprint) {
    return {
      status: 'fingerprint_missing',
      output: null,
      meta,
      fingerprintMismatch: {
        expected_fingerprint: normalizedExpectedFingerprint.fingerprint,
        actual_fingerprint: null,
        changed_dimensions: ['input_fingerprint'],
      },
    }
  }

  const changedDimensions = resolveFingerprintChangedDimensions(
    normalizedExpectedFingerprint,
    normalizedActualFingerprint,
  )
  if (changedDimensions.length > 0) {
    return {
      status: 'fingerprint_mismatch',
      output: null,
      meta,
      fingerprintMismatch: {
        expected_fingerprint: normalizedExpectedFingerprint.fingerprint,
        actual_fingerprint: normalizedActualFingerprint.fingerprint,
        changed_dimensions: changedDimensions,
      },
    }
  }

  return { status: 'hit', output, meta, fingerprintMismatch: null }
}

export async function maybeLoadCachedPhase({ phaseDir, force = false, expectedInputFingerprint = null }) {
  const result = await loadCachedPhaseWithDiagnostics({
    phaseDir,
    force,
    expectedInputFingerprint,
  })
  return result.status === 'hit' ? result.output : null
}
