import { extractQuestionTexts, normalizeQuestionList } from './questions.mjs'

export const RECOVERY_ACTIONS = Object.freeze({
  retry: Object.freeze({
    description: 'Retry the current task with concise actionable feedback.',
    constraints: [],
  }),
  auto_answer_noncritical: Object.freeze({
    description: 'Answer non-sensitive questions automatically when the answer type is valid.',
    constraints: ['not_security', 'not_gdpr', 'not_privacy'],
  }),
  escalate: Object.freeze({
    description: 'Escalate to explicit user input when safe recovery is unclear.',
    constraints: [],
  }),
  abort: Object.freeze({
    description: 'Abort when continuation would violate hard constraints.',
    constraints: [],
  }),
  skip_task: Object.freeze({
    description: 'Skip the current task only when it is optional and does not affect schema or migrations.',
    constraints: ['not_required', 'not_schema_migration'],
  }),
})

const RECOVERY_ACTION_ALIASES = Object.freeze({
  retry_task_with_feedback: 'retry',
  auto_answer_noncritical_questions: 'auto_answer_noncritical',
  escalate_user_input: 'escalate',
})

const UNSAFE_RECOVERY_PATTERNS = Object.freeze([
  /\bdisable\b.{0,20}\btest/i,
  /\bskip\b.{0,20}\btest/i,
  /\bignore\b.{0,20}\btest/i,
  /\bturn off\b.{0,20}\bcoverage/i,
  /\b--no-verify\b/i,
  /\bnpm\s+test\b.{0,15}\b(skip|off|disable)\b/i,
])

const ALLOWED_ANSWER_TYPES = new Set(['boolean', 'enum', 'free_text'])
const SENSITIVE_CATEGORIES = new Set(['security', 'privacy', 'gdpr'])

function normalizeText(value) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return []
  }
  return values
    .map((value) => normalizeText(value))
    .filter(Boolean)
}

function normalizeQuestionPayload(question) {
  if (typeof question === 'string') {
    const text = normalizeText(question)
    return text || null
  }
  if (!question || typeof question !== 'object') {
    return null
  }

  const text = normalizeText(question.text)
  if (!text) {
    return null
  }

  const normalized = { text }
  if (typeof question.severity === 'string' && question.severity.trim()) {
    normalized.severity = question.severity.trim()
  }
  if (typeof question.category === 'string' && question.category.trim()) {
    normalized.category = question.category.trim()
  }
  if (typeof question.requires_user_input === 'boolean') {
    normalized.requires_user_input = question.requires_user_input
  }
  return normalized
}

function normalizeQuestionPayloadList(values) {
  if (!Array.isArray(values)) {
    return []
  }
  return values.map((value) => normalizeQuestionPayload(value)).filter(Boolean)
}

function normalizeAnswerValue(value) {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim()
    return normalized || null
  }
  if (value && typeof value === 'object' && typeof value.text === 'string') {
    const normalized = value.text.trim()
    return normalized || null
  }
  return null
}

function normalizeAnswerArray(values) {
  if (!Array.isArray(values)) {
    return []
  }
  return values.map((value) => normalizeAnswerValue(value)).filter((value) => value !== null)
}

function normalizeRecoveryActionName(value) {
  const normalized = normalizeText(value)
  if (!normalized) {
    return ''
  }
  return RECOVERY_ACTION_ALIASES[normalized] ?? normalized
}

function hasUnsafeRecoveryInstruction(value) {
  if (!value) {
    return false
  }
  return UNSAFE_RECOVERY_PATTERNS.some((pattern) => pattern.test(value))
}

function normalizeContextQuestion(question) {
  if (typeof question === 'string') {
    const normalized = normalizeQuestionList([question])[0]
    if (!normalized) {
      return null
    }
    return {
      text: normalized.text,
      security: false,
      privacy: false,
      gdpr: false,
      answer_type: 'free_text',
      options: [],
    }
  }

  if (!question || typeof question !== 'object') {
    return null
  }

  const normalizedQuestion = normalizeQuestionList([question])[0]
  const text = typeof question.text === 'string' ? question.text.trim() : normalizedQuestion?.text ?? ''
  if (!text) {
    return null
  }

  const rawAnswerType =
    normalizeText(question.answer_type) ||
    normalizeText(question.question_type) ||
    normalizeText(question.type) ||
    'free_text'
  const answerType = ALLOWED_ANSWER_TYPES.has(rawAnswerType) ? rawAnswerType : 'free_text'
  const options = Array.isArray(question.options)
    ? question.options.filter((value) => typeof value === 'string' || typeof value === 'boolean')
    : []
  const category = normalizeText(question.category).toLowerCase()

  return {
    text,
    security: question.security === true || category === 'security',
    privacy: question.privacy === true || category === 'privacy',
    gdpr: question.gdpr === true || category === 'gdpr',
    answer_type: answerType,
    options,
  }
}

function normalizeContextQuestions(questions, fallbackQuestions = []) {
  const source = Array.isArray(questions) && questions.length > 0 ? questions : fallbackQuestions
  return source.map((question) => normalizeContextQuestion(question)).filter(Boolean)
}

function resolveTaskContext(context) {
  const task = context?.task && typeof context.task === 'object' ? context.task : {}
  return {
    id: typeof task.id === 'string' && task.id.trim() ? task.id.trim() : null,
    required: task.required === true,
    affects_schema: task.affects_schema === true,
    affects_migrations: task.affects_migrations === true,
  }
}

function answerMatchesQuestion(answer, question) {
  if (question.answer_type === 'boolean') {
    return typeof answer === 'boolean'
  }
  if (question.answer_type === 'enum') {
    return question.options.includes(answer)
  }
  return typeof answer === 'string'
}

export function validateFailureManagerDecision(rawDecision) {
  if (!rawDecision || typeof rawDecision !== 'object') {
    return { ok: false, error: 'Failure manager response must be a JSON object.' }
  }

  const action = normalizeRecoveryActionName(rawDecision.action ?? rawDecision.decision)
  if (!action) {
    return { ok: false, error: 'Failure manager response must include a non-empty action.' }
  }

  const questions = normalizeQuestionPayloadList(rawDecision.questions)
  const answers = normalizeAnswerArray(rawDecision.answers)
  const notes = normalizeStringArray(rawDecision.notes)

  if (Array.isArray(rawDecision.answers) && answers.length !== rawDecision.answers.length) {
    return { ok: false, error: 'answers must contain only non-empty strings or booleans.' }
  }

  const normalized = {
    action,
    decision: action,
    reason: normalizeText(rawDecision.reason) || 'No reason provided.',
    review_feedback: normalizeText(rawDecision.review_feedback),
    verification_feedback: normalizeText(rawDecision.verification_feedback),
    questions,
    answers,
    notes,
  }

  if (normalized.action === 'retry' && !normalized.review_feedback && !normalized.verification_feedback) {
    return {
      ok: false,
      error: 'retry requires review_feedback or verification_feedback.',
      decision: normalized,
    }
  }

  if (normalized.action === 'escalate' && normalized.questions.length === 0) {
    normalized.questions = [
      'Failure manager could not produce a safe actionable recovery plan. Provide guidance.',
    ]
  }

  return { ok: true, decision: normalized }
}

export function validateRecoveryAction(suggestion, context = {}) {
  const action = normalizeRecoveryActionName(suggestion?.action ?? suggestion?.decision)
  if (!Object.hasOwn(RECOVERY_ACTIONS, action)) {
    return { valid: false, reason: 'action_not_in_allowlist' }
  }

  if (
    hasUnsafeRecoveryInstruction(suggestion?.review_feedback) ||
    hasUnsafeRecoveryInstruction(suggestion?.verification_feedback)
  ) {
    return { valid: false, reason: 'unsafe_recovery_instruction' }
  }

  if (action === 'auto_answer_noncritical') {
    if ((context?.mode ?? 'autonomous') !== 'autonomous') {
      return { valid: false, reason: 'auto_answer_requires_autonomous_mode' }
    }

    const questions = normalizeContextQuestions(context?.questions, suggestion?.questions ?? [])
    const answers = normalizeAnswerArray(suggestion?.answers)
    if (questions.length === 0 || answers.length !== questions.length) {
      return { valid: false, reason: 'answer_type_mismatch' }
    }

    if (questions.some((question) => question.security || question.privacy || question.gdpr)) {
      return { valid: false, reason: 'auto_answer_blocked_sensitive_question' }
    }

    if (questions.some((question, index) => !answerMatchesQuestion(answers[index], question))) {
      return { valid: false, reason: 'answer_type_mismatch' }
    }
  }

  if (action === 'skip_task') {
    const task = resolveTaskContext(context)
    if (task.required) {
      return { valid: false, reason: 'skip_blocked_required_task' }
    }
    if (task.affects_schema || task.affects_migrations) {
      return { valid: false, reason: 'skip_blocked_schema_task' }
    }
  }

  return { valid: true, reason: 'ok' }
}

export function resolveRecoveryAction({ suggestion, context = {}, timestamp = new Date().toISOString() } = {}) {
  const normalizedSuggestion = {
    ...(suggestion ?? {}),
    action: normalizeRecoveryActionName(suggestion?.action ?? suggestion?.decision),
  }
  const validation = validateRecoveryAction(normalizedSuggestion, context)

  if (validation.valid) {
    return {
      decision: normalizedSuggestion,
      validation,
      invalidRecoverySuggestion: null,
    }
  }

  const questionFallback = normalizeQuestionPayloadList(context?.questions ?? normalizedSuggestion.questions ?? [])
  const fallbackDecision = {
    ...normalizedSuggestion,
    action: 'escalate',
    decision: 'escalate',
    reason: `Invalid recovery suggestion blocked: ${validation.reason}`,
    questions:
      questionFallback.length > 0
        ? questionFallback
        : ['Failure manager could not produce a safe actionable recovery plan. Provide guidance.'],
    answers: [],
  }

  return {
    decision: fallbackDecision,
    validation,
    invalidRecoverySuggestion: {
      action:
        normalizeText(suggestion?.action ?? suggestion?.decision) ||
        normalizedSuggestion.action ||
        '(empty)',
      reason: validation.reason,
      task_id: resolveTaskContext(context).id,
      timestamp,
    },
  }
}

export function extractRecoveryQuestionTexts(questions) {
  return extractQuestionTexts(questions)
}
