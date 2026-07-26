import path from 'node:path'
import {
  fileExists,
  readJsonFile,
  readTextFile,
  writeJsonFileAtomic,
  writeTextFileAtomic,
} from './fs.mjs'

const STATE_FILENAME = 'conversation-state.json'
const TRANSCRIPT_FILENAME = 'conversation.jsonl'
const MAX_STEERING_MESSAGES_IN_PROMPT = 8
const CONTROL_STATES = new Set(['running', 'paused', 'aborted'])
const TERMINAL_BROKER_STATES = new Set(['active', 'suspended', 'stopped', 'unavailable'])

function conversationStatePath(runDir) {
  return path.join(runDir, STATE_FILENAME)
}

function transcriptPath(runDir) {
  return path.join(runDir, TRANSCRIPT_FILENAME)
}

function defaultConversationState(interactionModel = 'phased') {
  return {
    interaction_model: interactionModel === 'conversational' ? 'conversational' : 'phased',
    active_phase: null,
    active_session_id: null,
    active_command: null,
    active_command_phase: null,
    active_command_started_at: null,
    conversation_state: 'idle',
    control_state: 'running',
    pending_question: null,
    pending_steering_messages: [],
    applied_steering_messages: [],
    waiting_state: null,
    waiting_phase: null,
    waiting_detail: null,
    waiting_started_at: null,
    terminal_broker_state: null,
    pending_replan: false,
    last_control_command: null,
    last_control_at: null,
    abort_reason: null,
    interrupt_requested: false,
    last_steer_at: null,
    live_interaction_supported: null,
    live_interaction_mode: null,
    live_interaction_summary: null,
    live_interaction_blockers: [],
    live_interaction_checked_at: null,
    live_interaction_cli_version: null,
  }
}

function normalizeMessageEntry(entry, fallbackSource = 'system') {
  if (!entry || typeof entry !== 'object') {
    return null
  }
  const text = typeof entry.text === 'string' ? entry.text.trim() : ''
  if (!text) {
    return null
  }
  const source = typeof entry.source === 'string' && entry.source.trim() ? entry.source.trim() : fallbackSource
  const timestamp = typeof entry.timestamp === 'string' && entry.timestamp.trim() ? entry.timestamp : new Date().toISOString()
  return {
    text,
    source,
    timestamp,
  }
}

async function appendConversationEntry(runDir, entry) {
  const transcriptFile = transcriptPath(runDir)
  const existing = (await fileExists(transcriptFile)) ? await readTextFile(transcriptFile) : ''
  await writeTextFileAtomic(transcriptFile, `${existing}${JSON.stringify(entry)}\n`)
}

function normalizeControlState(value) {
  return CONTROL_STATES.has(value) ? value : 'running'
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeTerminalBrokerState(value) {
  return TERMINAL_BROKER_STATES.has(value) ? value : null
}

function deriveConversationState(state) {
  if (state.control_state === 'aborted') {
    return 'aborted'
  }
  if (state.control_state === 'paused') {
    return 'paused'
  }
  if (typeof state.conversation_state === 'string' && state.conversation_state.trim()) {
    return state.conversation_state.trim()
  }
  if (state.pending_replan) {
    return 'replanning'
  }
  if (state.pending_question) {
    return 'awaiting_user'
  }
  if (state.active_phase) {
    return 'awaiting_model'
  }
  return 'idle'
}

function normalizeConversationStateSnapshot(snapshot) {
  const merged = {
    ...defaultConversationState(snapshot?.interaction_model),
    ...(snapshot && typeof snapshot === 'object' ? snapshot : {}),
  }

  merged.control_state = normalizeControlState(merged.control_state)
  merged.active_command = normalizeOptionalText(merged.active_command)
  merged.active_command_phase = normalizeOptionalText(merged.active_command_phase)
  merged.active_command_started_at = normalizeOptionalText(merged.active_command_started_at)
  merged.pending_steering_messages = Array.isArray(merged.pending_steering_messages)
    ? merged.pending_steering_messages.map((entry) => normalizeMessageEntry(entry, 'terminal')).filter(Boolean)
    : []
  merged.applied_steering_messages = Array.isArray(merged.applied_steering_messages)
    ? merged.applied_steering_messages.map((entry) => normalizeMessageEntry(entry, 'terminal')).filter(Boolean)
    : []
  merged.waiting_state = normalizeOptionalText(merged.waiting_state)
  merged.waiting_phase = normalizeOptionalText(merged.waiting_phase)
  merged.waiting_detail = normalizeOptionalText(merged.waiting_detail)
  merged.waiting_started_at = normalizeOptionalText(merged.waiting_started_at)
  merged.terminal_broker_state = normalizeTerminalBrokerState(merged.terminal_broker_state)
  merged.pending_replan = Boolean(merged.pending_replan)
  merged.last_control_command = normalizeOptionalText(merged.last_control_command)
  merged.last_control_at = normalizeOptionalText(merged.last_control_at)
  merged.abort_reason = normalizeOptionalText(merged.abort_reason)
  merged.live_interaction_supported =
    typeof merged.live_interaction_supported === 'boolean' ? merged.live_interaction_supported : null
  merged.live_interaction_mode = normalizeOptionalText(merged.live_interaction_mode)
  merged.live_interaction_summary = normalizeOptionalText(merged.live_interaction_summary)
  merged.live_interaction_blockers = Array.isArray(merged.live_interaction_blockers)
    ? merged.live_interaction_blockers
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []
  merged.live_interaction_checked_at = normalizeOptionalText(merged.live_interaction_checked_at)
  merged.live_interaction_cli_version = normalizeOptionalText(merged.live_interaction_cli_version)
  merged.conversation_state = deriveConversationState(merged)
  merged.interrupt_requested =
    merged.control_state !== 'running' || merged.pending_replan || merged.pending_steering_messages.length > 0

  return merged
}

async function appendControlEntry(runDir, { command, source = 'system', argument = '', timestamp }) {
  const normalizedTimestamp = typeof timestamp === 'string' && timestamp.trim() ? timestamp : new Date().toISOString()
  await appendConversationEntry(runDir, {
    role: 'user',
    kind: 'control',
    command,
    argument,
    source,
    timestamp: normalizedTimestamp,
  })
  return normalizedTimestamp
}

export async function createConversationArtifacts(runDir, { interactionModel = 'phased' } = {}) {
  const stateFile = conversationStatePath(runDir)
  if (!(await fileExists(stateFile))) {
    await writeJsonFileAtomic(stateFile, defaultConversationState(interactionModel))
  }
  const transcriptFile = transcriptPath(runDir)
  if (!(await fileExists(transcriptFile))) {
    await writeTextFileAtomic(transcriptFile, '')
  }
}

export async function readConversationState(runDir) {
  const stateFile = conversationStatePath(runDir)
  if (!(await fileExists(stateFile))) {
    return defaultConversationState()
  }
  const parsed = await readJsonFile(stateFile)
  return normalizeConversationStateSnapshot(parsed)
}

export async function updateConversationState(runDir, patch) {
  const existing = await readConversationState(runDir)
  const next = normalizeConversationStateSnapshot(
    typeof patch === 'function'
      ? patch(existing)
      : {
          ...existing,
          ...(patch && typeof patch === 'object' ? patch : {}),
        },
  )
  await writeJsonFileAtomic(conversationStatePath(runDir), next)
  return next
}

export async function enqueueSteeringMessage(runDir, { text, source = 'terminal' } = {}) {
  const entry = normalizeMessageEntry({ text, source }, source)
  if (!entry) {
    return null
  }

  await appendConversationEntry(runDir, {
    role: 'user',
    kind: 'steering',
    ...entry,
  })

  await updateConversationState(runDir, (state) => ({
    ...state,
    pending_steering_messages: [...state.pending_steering_messages, entry],
    interrupt_requested: true,
    last_steer_at: entry.timestamp,
  }))

  return entry
}

export async function consumePendingSteeringMessages(runDir) {
  let consumed = []
  await updateConversationState(runDir, (state) => {
    consumed = Array.isArray(state.pending_steering_messages) ? state.pending_steering_messages : []
    return {
      ...state,
      pending_steering_messages: [],
      applied_steering_messages: [...state.applied_steering_messages, ...consumed],
      conversation_state: consumed.length > 0 && state.control_state === 'running' ? 'replanning' : state.conversation_state,
    }
  })
  return consumed
}

export async function consumePendingReplanRequest(runDir) {
  let consumed = false
  await updateConversationState(runDir, (state) => {
    consumed = Boolean(state.pending_replan)
    return {
      ...state,
      pending_replan: false,
      conversation_state: consumed && state.control_state === 'running' ? 'replanning' : state.conversation_state,
    }
  })
  return consumed
}

export async function setPendingQuestion(runDir, { phase = null, questions = [] } = {}) {
  const normalizedQuestions = Array.isArray(questions)
    ? questions
        .filter((entry) => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : []

  await appendConversationEntry(runDir, {
    role: 'assistant',
    kind: 'question',
    phase,
    questions: normalizedQuestions,
    timestamp: new Date().toISOString(),
  })

  return await updateConversationState(runDir, (state) => ({
    ...state,
    pending_question:
      normalizedQuestions.length > 0
        ? {
            phase,
            questions: normalizedQuestions,
          }
        : null,
    conversation_state: normalizedQuestions.length > 0 ? 'awaiting_user' : state.conversation_state,
  }))
}

export async function clearPendingQuestion(runDir) {
  return await updateConversationState(runDir, (state) => ({
    ...state,
    pending_question: null,
    conversation_state: state.control_state === 'running' ? (state.active_phase ? 'awaiting_model' : 'idle') : state.conversation_state,
  }))
}

export async function recordAnswerMessage(runDir, { text, source = 'terminal' } = {}) {
  const entry = normalizeMessageEntry({ text, source }, source)
  if (!entry) {
    return null
  }
  await appendConversationEntry(runDir, {
    role: 'user',
    kind: 'answer',
    ...entry,
  })
  return entry
}

export async function setActiveConversationPhase(runDir, { phaseName = null, conversationState = 'awaiting_model' } = {}) {
  return await updateConversationState(runDir, (state) => ({
    ...state,
    active_phase: phaseName,
    conversation_state:
      state.control_state === 'running'
        ? phaseName
          ? conversationState
          : state.pending_question
            ? 'awaiting_user'
            : 'idle'
        : state.conversation_state,
  }))
}

export async function setConversationSessionId(runDir, sessionId) {
  return await updateConversationState(runDir, (state) => ({
    ...state,
    active_session_id: typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : state.active_session_id,
  }))
}

export async function setActiveConversationCommand(runDir, { command = null, phaseName = null } = {}) {
  const normalizedCommand = normalizeOptionalText(command)
  return await updateConversationState(runDir, (state) => ({
    ...state,
    active_command: normalizedCommand,
    active_command_phase: normalizedCommand ? normalizeOptionalText(phaseName) : null,
    active_command_started_at: normalizedCommand ? new Date().toISOString() : null,
  }))
}

export async function setConversationWaitState(runDir, { waitState = null, phaseName = null, detail = null } = {}) {
  const normalizedWaitState = normalizeOptionalText(waitState)
  return await updateConversationState(runDir, (state) => ({
    ...state,
    waiting_state: normalizedWaitState,
    waiting_phase: normalizedWaitState ? normalizeOptionalText(phaseName) : null,
    waiting_detail: normalizedWaitState ? normalizeOptionalText(detail) : null,
    waiting_started_at: normalizedWaitState ? new Date().toISOString() : null,
  }))
}

export async function setConversationTerminalState(runDir, terminalState = null) {
  const normalizedTerminalState = normalizeTerminalBrokerState(terminalState)
  return await updateConversationState(runDir, (state) => ({
    ...state,
    terminal_broker_state: normalizedTerminalState,
  }))
}

export async function setLiveInteractionCapability(
  runDir,
  { supported = null, mode = null, summary = null, blockers = [], checkedAt = null, cliVersion = null } = {},
) {
  return await updateConversationState(runDir, (state) => ({
    ...state,
    live_interaction_supported: typeof supported === 'boolean' ? supported : null,
    live_interaction_mode: normalizeOptionalText(mode),
    live_interaction_summary: normalizeOptionalText(summary),
    live_interaction_blockers: Array.isArray(blockers)
      ? blockers
          .filter((entry) => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [],
    live_interaction_checked_at:
      typeof checkedAt === 'string' && checkedAt.trim() ? checkedAt.trim() : new Date().toISOString(),
    live_interaction_cli_version: normalizeOptionalText(cliVersion),
  }))
}

export async function pauseConversation(runDir, { source = 'system' } = {}) {
  const timestamp = await appendControlEntry(runDir, {
    command: 'pause',
    source,
  })
  return await updateConversationState(runDir, (state) => ({
    ...state,
    control_state: 'paused',
    conversation_state: 'paused',
    last_control_command: 'pause',
    last_control_at: timestamp,
    abort_reason: null,
  }))
}

export async function resumeConversation(runDir, { source = 'system' } = {}) {
  const timestamp = await appendControlEntry(runDir, {
    command: 'resume',
    source,
  })
  return await updateConversationState(runDir, (state) => ({
    ...state,
    control_state: 'running',
    conversation_state: state.pending_replan ? 'replanning' : state.active_phase ? 'awaiting_model' : state.pending_question ? 'awaiting_user' : 'idle',
    last_control_command: 'resume',
    last_control_at: timestamp,
    abort_reason: null,
  }))
}

export async function abortConversation(runDir, { source = 'system', reason = null } = {}) {
  const timestamp = await appendControlEntry(runDir, {
    command: 'abort',
    source,
  })
  return await updateConversationState(runDir, (state) => ({
    ...state,
    control_state: 'aborted',
    conversation_state: 'aborted',
    abort_reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'Conversation aborted.',
    last_control_command: 'abort',
    last_control_at: timestamp,
  }))
}

export async function requestConversationReplan(runDir, { source = 'system', text = '' } = {}) {
  const timestamp = await appendControlEntry(runDir, {
    command: 'replan',
    source,
    argument: typeof text === 'string' ? text.trim() : '',
  })

  const message = normalizeMessageEntry(
    {
      text,
      source,
      timestamp,
    },
    source,
  )

  if (message) {
    await appendConversationEntry(runDir, {
      role: 'user',
      kind: 'steering',
      ...message,
    })
  }

  return await updateConversationState(runDir, (state) => ({
    ...state,
    pending_steering_messages: message ? [...state.pending_steering_messages, message] : state.pending_steering_messages,
    pending_replan: true,
    conversation_state: state.control_state === 'running' ? 'replanning' : state.conversation_state,
    last_control_command: 'replan',
    last_control_at: timestamp,
    abort_reason: null,
  }))
}

export async function buildConversationPromptSuffix(runDir) {
  const state = await readConversationState(runDir)
  if (state.interaction_model !== 'conversational') {
    return ''
  }

  const appliedMessages = Array.isArray(state.applied_steering_messages) ? state.applied_steering_messages : []
  const pendingMessages = Array.isArray(state.pending_steering_messages) ? state.pending_steering_messages : []
  const effectiveMessages = [...appliedMessages, ...pendingMessages]
  if (effectiveMessages.length === 0) {
    return ''
  }

  const recentMessages = effectiveMessages.slice(-MAX_STEERING_MESSAGES_IN_PROMPT)
  const lines = ['Conversation mode is active.', 'User steering updates (apply these unless they conflict with repo guardrails):']
  for (const message of recentMessages) {
    lines.push(`- ${message.text}`)
  }
  return lines.join('\n')
}
