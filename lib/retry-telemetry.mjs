import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, fileExists, readTextFile } from './fs.mjs'
import { redactText } from './redact.mjs'

export const RETRY_EVENTS_FILENAME = 'retry-events.jsonl'

export const RETRY_TELEMETRY_REQUIRED_FIELDS = Object.freeze([
  'timestamp',
  'run_id',
  'phase',
  'loop',
  'attempt',
  'budget',
  'cause_code',
])

export const RETRY_TELEMETRY_OPTIONAL_FIELDS = Object.freeze(['failure_kind', 'review_target', 'task_id'])

const ALLOWED_FIELDS = new Set([...RETRY_TELEMETRY_REQUIRED_FIELDS, ...RETRY_TELEMETRY_OPTIONAL_FIELDS])
const DISALLOWED_FIELDS = new Set([
  'prompt',
  'prompt_text',
  'raw_output',
  'raw_command_output',
  'command_output',
  'output',
  'user_answer',
  'user_answers',
  'answers',
])

const SECRET_LIKE_FIELD_PATTERN =
  /(secret|token|password|authorization|api[_-]?key|private[_-]?key|credential|bearer)/i

export const RETRY_CAUSE_CODES = Object.freeze([
  'structural_prompt_context',
  'structural_cache_mismatch',
  'structural_review_non_actionable',
  'structural_policy_churn',
  'structural_gate_ambiguity',
  'productive_defect_found',
  'unknown_retry_cause',
])

const RETRY_CAUSE_CODE_SET = new Set(RETRY_CAUSE_CODES)
const STRUCTURAL_CAUSE_CODES = new Set(
  RETRY_CAUSE_CODES.filter((causeCode) => causeCode.startsWith('structural_')),
)

const RETRY_FAMILY_TO_CAUSE_CODE = Object.freeze({
  policy_guidance_retry: 'structural_policy_churn',
  cache_mismatch_retry: 'structural_cache_mismatch',
  prompt_context_retry: 'structural_prompt_context',
  gate_wait_for_user: 'structural_gate_ambiguity',
  auto_resolve_retry: 'structural_gate_ambiguity',
  task_graph_budget_replan: 'structural_review_non_actionable',
  review_non_actionable_retry: 'structural_review_non_actionable',
  failure_manager_retry: 'structural_review_non_actionable',
  worker_retry: 'productive_defect_found',
  verification_retry: 'productive_defect_found',
  review_fix_retry: 'productive_defect_found',
  verification_review_fix_retry: 'productive_defect_found',
})

function normalizeBoundedString(value, { fieldName, max = 180 } = {}) {
  if (typeof value !== 'string') {
    throw new Error(`Missing required retry telemetry field: ${fieldName}`)
  }
  const normalized = redactText(value)
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
  if (!normalized) {
    throw new Error(`Missing required retry telemetry field: ${fieldName}`)
  }
  return normalized.slice(0, max)
}

function normalizeOptionalBoundedString(value, { max = 180 } = {}) {
  if (value == null) {
    return null
  }
  if (typeof value !== 'string') {
    throw new Error('Optional retry telemetry fields must be strings when provided')
  }
  const normalized = redactText(value)
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
  if (!normalized) {
    return null
  }
  return normalized.slice(0, max)
}

function normalizePositiveInteger(value, { fieldName }) {
  const parsed =
    typeof value === 'number' && Number.isFinite(value)
      ? Math.trunc(value)
      : typeof value === 'string' && value.trim()
        ? Number.parseInt(value, 10)
        : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid retry telemetry field: ${fieldName}`)
  }
  return parsed
}

function normalizeTimestamp(value) {
  const timestamp =
    typeof value === 'string' && value.trim() ? Date.parse(value) : Number.NaN
  if (Number.isNaN(timestamp)) {
    throw new Error('Invalid retry telemetry field: timestamp')
  }
  return new Date(timestamp).toISOString()
}

function validateFieldNames(payload) {
  for (const key of Object.keys(payload)) {
    if (ALLOWED_FIELDS.has(key)) {
      continue
    }
    if (DISALLOWED_FIELDS.has(key)) {
      throw new Error(`Disallowed retry telemetry field: ${key}`)
    }
    if (SECRET_LIKE_FIELD_PATTERN.test(key)) {
      throw new Error(`Secret-like retry telemetry field: ${key}`)
    }
    throw new Error(`Unsupported retry telemetry field: ${key}`)
  }
}

export function validateRetryEventContract(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Retry telemetry payload must be an object')
  }

  validateFieldNames(payload)

  const event = {
    timestamp: normalizeTimestamp(payload.timestamp),
    run_id: normalizeBoundedString(payload.run_id, { fieldName: 'run_id', max: 120 }),
    phase: normalizeBoundedString(payload.phase, { fieldName: 'phase', max: 180 }),
    loop: normalizeBoundedString(payload.loop, { fieldName: 'loop', max: 120 }),
    attempt: normalizePositiveInteger(payload.attempt, { fieldName: 'attempt' }),
    budget: normalizePositiveInteger(payload.budget, { fieldName: 'budget' }),
    cause_code: normalizeBoundedString(payload.cause_code, { fieldName: 'cause_code', max: 64 }),
  }

  if (!RETRY_CAUSE_CODE_SET.has(event.cause_code)) {
    throw new Error(`Invalid retry telemetry field: cause_code (${event.cause_code})`)
  }

  const failureKind = normalizeOptionalBoundedString(payload.failure_kind, { max: 120 })
  if (failureKind) {
    event.failure_kind = failureKind
  }

  const reviewTarget = normalizeOptionalBoundedString(payload.review_target, { max: 180 })
  if (reviewTarget) {
    event.review_target = reviewTarget
  }

  const taskId = normalizeOptionalBoundedString(payload.task_id, { max: 120 })
  if (taskId) {
    event.task_id = taskId
  }

  return event
}

function normalizeRetryFamily(retryFamily) {
  if (typeof retryFamily !== 'string') {
    return ''
  }
  return retryFamily
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_')
}

function sortCountsObject(counts) {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)))
}

export function resolveRetryCauseCode(retryFamily) {
  const normalizedFamily = normalizeRetryFamily(retryFamily)
  if (!normalizedFamily) {
    return 'unknown_retry_cause'
  }
  return RETRY_FAMILY_TO_CAUSE_CODE[normalizedFamily] ?? 'unknown_retry_cause'
}

export async function appendRetryEvent({ runDir, event }) {
  if (typeof runDir !== 'string' || !runDir.trim()) {
    throw new Error('Missing runDir for retry telemetry append')
  }
  const normalizedEvent = validateRetryEventContract(event)
  const retryEventsPath = path.join(runDir, RETRY_EVENTS_FILENAME)
  await ensureDir(path.dirname(retryEventsPath))
  await appendFile(retryEventsPath, `${JSON.stringify(normalizedEvent)}\n`, 'utf8')
  return normalizedEvent
}

export async function readRetryEvents({ runDir }) {
  if (typeof runDir !== 'string' || !runDir.trim()) {
    throw new Error('Missing runDir for retry telemetry read')
  }
  const retryEventsPath = path.join(runDir, RETRY_EVENTS_FILENAME)
  if (!(await fileExists(retryEventsPath))) {
    return []
  }

  const content = await readTextFile(retryEventsPath)
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.map((line) => validateRetryEventContract(JSON.parse(line)))
}

export function rollupRetryEvents(events) {
  const list = Array.isArray(events) ? events : []
  const byCause = {}
  const byPhase = {}
  let structuralEvents = 0
  let productiveEvents = 0
  let unknownEvents = 0

  for (const candidate of list) {
    const event = validateRetryEventContract(candidate)
    byCause[event.cause_code] = (byCause[event.cause_code] ?? 0) + 1
    byPhase[event.phase] = (byPhase[event.phase] ?? 0) + 1

    if (STRUCTURAL_CAUSE_CODES.has(event.cause_code)) {
      structuralEvents += 1
    } else if (event.cause_code === 'productive_defect_found') {
      productiveEvents += 1
    } else {
      unknownEvents += 1
    }
  }

  return {
    total_events: list.length,
    structural_events: structuralEvents,
    productive_events: productiveEvents,
    unknown_events: unknownEvents,
    by_cause: sortCountsObject(byCause),
    by_phase: sortCountsObject(byPhase),
  }
}
