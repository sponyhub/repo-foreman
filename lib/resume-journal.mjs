import crypto from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, fileExists, readTextFile } from './fs.mjs'
import { redactText } from './redact.mjs'

export const RESUME_JOURNAL_FILENAME = 'resume-journal.jsonl'
const AUTO_RESOLVE_MARKER_PREFIX = 'task-auto-resolve'

const PHASE_SUBSTATE_EVENTS = new Set([
  'phase_started',
  'phase_output_validated',
  'phase_gate_evaluated',
  'phase_review_completed',
  'phase_verification_completed',
])

function normalizeBoundedString(value, { max = 240 } = {}) {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value
    .replaceAll(/[\r\n\t]+/g, ' ')
    .replaceAll(/\s{2,}/g, ' ')
    .trim()
  if (!normalized) {
    return null
  }
  return normalized.slice(0, max)
}

function normalizeRequiredString(fieldName, value, options) {
  const normalized = normalizeBoundedString(value, options)
  if (!normalized) {
    throw new Error(`Missing ${fieldName} for resume journal entry`)
  }
  return normalized
}

function normalizeIsoTimestamp(value, fallback) {
  if (typeof value === 'string' && value.trim()) {
    const timestamp = Date.parse(value)
    if (!Number.isNaN(timestamp)) {
      return new Date(timestamp).toISOString()
    }
  }
  return fallback
}

function normalizePositiveInteger(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return null
}

function deriveFailureManagerAttemptFromPhase({ event, taskId }) {
  if (typeof taskId !== 'string' || !taskId.trim()) {
    return null
  }
  const phase = typeof event?.phase === 'string' ? event.phase.trim() : ''
  if (!phase) {
    return null
  }
  const match = new RegExp(`^tasks/${taskId}/failure_manager/attempt-(\\d+)$`).exec(phase)
  if (!match) {
    return null
  }
  const fromPhase = normalizePositiveInteger(match?.[1])
  const fromEvent = normalizePositiveInteger(event?.attempt)
  if (fromPhase != null && fromEvent != null) {
    return Math.max(fromPhase, fromEvent)
  }
  return fromPhase ?? fromEvent
}

function normalizeRecoveryTaskId(value) {
  return normalizeBoundedString(value, { max: 200 })
}

function isAutoResolveMarkerForTask(event, taskId) {
  if (event?.event_type !== 'recovery_marker') {
    return false
  }
  if (event?.phase !== `task:${taskId}`) {
    return false
  }
  const markerId = normalizeRecoveryTaskId(event?.recovery_task_id)
  if (!markerId) {
    return false
  }
  return markerId.startsWith(`${AUTO_RESOLVE_MARKER_PREFIX}:${taskId}:`)
}

export function buildAutoResolveReplayMarkerId({ taskId, questionSetSignature }) {
  const normalizedTaskId = normalizeRequiredString('task_id', taskId, { max: 120 })
  const rawSignature =
    typeof questionSetSignature === 'string'
      ? questionSetSignature.replaceAll(/\r\n/g, '\n').trim()
      : ''
  if (!rawSignature) {
    throw new Error('Missing question_set_signature for auto-resolve replay marker')
  }
  const boundedSignature = rawSignature.slice(0, 4000)
  const digest = crypto.createHash('sha256').update(boundedSignature).digest('hex').slice(0, 24)
  return `${AUTO_RESOLVE_MARKER_PREFIX}:${normalizedTaskId}:${digest}`
}

export function deriveTaskReplayState({ events, taskId }) {
  const normalizedTaskId = normalizeRequiredString('task_id', taskId, { max: 120 })
  const list = Array.isArray(events) ? events : []

  let managerAttemptsUsed = 0
  let maxAutoResolveAttempt = 0
  const autoResolveReplayMarkerIds = new Set()

  for (const event of list) {
    const managerAttempt = deriveFailureManagerAttemptFromPhase({ event, taskId: normalizedTaskId })
    if (managerAttempt != null) {
      managerAttemptsUsed = Math.max(managerAttemptsUsed, managerAttempt)
    }

    if (!isAutoResolveMarkerForTask(event, normalizedTaskId)) {
      continue
    }

    const markerId = normalizeRecoveryTaskId(event?.recovery_task_id)
    if (!markerId) {
      continue
    }

    autoResolveReplayMarkerIds.add(markerId)
    const markerAttempt = normalizePositiveInteger(event?.attempt)
    if (markerAttempt != null) {
      maxAutoResolveAttempt = Math.max(maxAutoResolveAttempt, markerAttempt)
    }
  }

  return {
    managerAttemptsUsed,
    autoResolveAttemptsUsed: maxAutoResolveAttempt || autoResolveReplayMarkerIds.size,
    autoResolveReplayMarkerIds,
  }
}

export function deriveVerificationReplayState({ events }) {
  const list = Array.isArray(events) ? events : []
  let managerAttemptsUsed = 0
  const recoveryTaskIds = new Set()

  for (const event of list) {
    const managerAttempt = deriveFailureManagerAttemptFromPhase({ event, taskId: 'verification' })
    if (managerAttempt != null) {
      managerAttemptsUsed = Math.max(managerAttemptsUsed, managerAttempt)
    }

    if (event?.event_type !== 'recovery_marker' || event?.phase !== 'verification') {
      continue
    }
    const recoveryTaskId = normalizeRecoveryTaskId(event?.recovery_task_id)
    if (recoveryTaskId) {
      recoveryTaskIds.add(recoveryTaskId)
    }
  }

  return {
    managerAttemptsUsed,
    recoveryTaskIds,
  }
}

export function buildPhaseSubstateIndex({ events }) {
  const list = Array.isArray(events) ? events : []
  const index = new Map()

  for (const event of list) {
    const eventType = normalizeBoundedString(event?.event_type, { max: 64 })
    if (!eventType || !PHASE_SUBSTATE_EVENTS.has(eventType)) {
      continue
    }

    const phase = normalizeBoundedString(event?.phase, { max: 180 })
    if (!phase) {
      continue
    }

    let phaseEntry = index.get(phase)
    if (!phaseEntry) {
      phaseEntry = new Map()
      index.set(phase, phaseEntry)
    }

    let substateEntry = phaseEntry.get(eventType)
    if (!substateEntry) {
      substateEntry = {
        hasAny: false,
        attempts: new Set(),
      }
      phaseEntry.set(eventType, substateEntry)
    }

    substateEntry.hasAny = true

    const attempt = normalizePositiveInteger(event?.attempt)
    if (attempt != null) {
      substateEntry.attempts.add(attempt)
    }
  }

  return index
}

export function hasPhaseSubstateCheckpoint({ index, phase, substate, attempt = null }) {
  if (!(index instanceof Map)) {
    return false
  }

  const normalizedPhase = normalizeBoundedString(phase, { max: 180 })
  if (!normalizedPhase) {
    return false
  }

  const normalizedSubstate = normalizeBoundedString(substate, { max: 64 })
  if (!normalizedSubstate || !PHASE_SUBSTATE_EVENTS.has(normalizedSubstate)) {
    return false
  }

  const phaseEntry = index.get(normalizedPhase)
  const substateEntry = phaseEntry?.get(normalizedSubstate)
  if (!substateEntry) {
    return false
  }

  const normalizedAttempt = normalizePositiveInteger(attempt)
  if (normalizedAttempt != null) {
    return substateEntry.attempts.has(normalizedAttempt)
  }

  return substateEntry.hasAny === true
}

function buildBaseEntry({ runId, phase, eventType, timestamp }) {
  return {
    timestamp,
    run_id: normalizeRequiredString('run_id', runId, { max: 120 }),
    phase: normalizeRequiredString('phase', phase, { max: 180 }),
    event_type: eventType,
  }
}

async function appendResumeJournalLine(runDir, entry) {
  const journalPath = path.join(runDir, RESUME_JOURNAL_FILENAME)
  await ensureDir(path.dirname(journalPath))
  await appendFile(journalPath, `${JSON.stringify(entry)}\n`, 'utf8')
}

export async function appendPhaseSubstateEvent({
  runDir,
  runId,
  phase,
  substate,
  attempt = null,
  gateStatus = null,
  reviewTarget = null,
  verdict = null,
}) {
  if (!PHASE_SUBSTATE_EVENTS.has(substate)) {
    throw new Error(`Unknown phase substate: ${substate}`)
  }

  const timestamp = new Date().toISOString()
  const entry = buildBaseEntry({ runId, phase, eventType: substate, timestamp })
  const normalizedAttempt = normalizePositiveInteger(attempt)
  if (normalizedAttempt != null) {
    entry.attempt = normalizedAttempt
  }

  const normalizedGateStatus = normalizeBoundedString(gateStatus, { max: 40 })
  if (normalizedGateStatus) {
    entry.gate_status = normalizedGateStatus
  }

  const normalizedReviewTarget = normalizeBoundedString(reviewTarget, { max: 120 })
  if (normalizedReviewTarget) {
    entry.review_target = normalizedReviewTarget
  }

  const normalizedVerdict = normalizeBoundedString(verdict, { max: 40 })
  if (normalizedVerdict) {
    entry.verdict = normalizedVerdict
  }

  await appendResumeJournalLine(runDir, entry)
}

export async function appendVerificationCommandEvent({
  runDir,
  runId,
  phase,
  command,
  startedAt,
  endedAt,
  exitCode,
  logPath,
  attempt = null,
}) {
  const timestamp = new Date().toISOString()
  const entry = buildBaseEntry({ runId, phase, eventType: 'verification_command', timestamp })

  const normalizedCommand = normalizeBoundedString(redactText(command), { max: 500 })
  if (normalizedCommand) {
    entry.command = normalizedCommand
  }

  entry.started_at = normalizeIsoTimestamp(startedAt, timestamp)
  entry.ended_at = normalizeIsoTimestamp(endedAt, timestamp)

  if (typeof exitCode === 'number' && Number.isFinite(exitCode)) {
    entry.exit_code = Math.trunc(exitCode)
  } else {
    entry.exit_code = null
  }

  const normalizedLogPath = normalizeBoundedString(redactText(logPath), { max: 260 })
  if (normalizedLogPath) {
    entry.log_path = normalizedLogPath
  }

  const normalizedAttempt = normalizePositiveInteger(attempt)
  if (normalizedAttempt != null) {
    entry.attempt = normalizedAttempt
  }

  await appendResumeJournalLine(runDir, entry)
}

export async function appendRecoveryMarkerEvent({ runDir, runId, phase, recoveryTaskId, attempt = null }) {
  const timestamp = new Date().toISOString()
  const entry = buildBaseEntry({ runId, phase, eventType: 'recovery_marker', timestamp })
  entry.recovery_task_id = normalizeRequiredString('recovery_task_id', recoveryTaskId, { max: 180 })

  const normalizedAttempt = normalizePositiveInteger(attempt)
  if (normalizedAttempt != null) {
    entry.attempt = normalizedAttempt
  }

  await appendResumeJournalLine(runDir, entry)
}

export async function readResumeJournalEvents({ runDir }) {
  const journalPath = path.join(runDir, RESUME_JOURNAL_FILENAME)
  if (!(await fileExists(journalPath))) {
    return []
  }

  const content = await readTextFile(journalPath)
  const lines = content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return lines.map((line) => JSON.parse(line))
}
