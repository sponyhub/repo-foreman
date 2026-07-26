const QUESTION_SEVERITIES = new Set(['low', 'medium', 'high', 'critical'])
const QUESTION_CATEGORIES = new Set(['security', 'privacy', 'gdpr', 'compliance', 'functional', 'other'])
const SENSITIVE_QUESTION_CATEGORIES = new Set(['security', 'privacy', 'gdpr', 'compliance'])

const CRITICAL_TEXT_PATTERNS = Object.freeze([
  /\[blocking\]/i,
  /\bsecurity\b/i,
  /\bprivacy\b/i,
  /\bgdpr\b/i,
  /\bcompliance\b/i,
  /\blegal\b/i,
  /\bpii\b/i,
  /\bsecret(s)?\b/i,
])

const CATEGORY_INFERENCE_RULES = Object.freeze([
  { category: 'gdpr', pattern: /\bgdpr\b/i },
  { category: 'privacy', pattern: /\bprivacy\b|\bpii\b/i },
  { category: 'security', pattern: /\bsecurity\b|\bsecret(s)?\b|\bcredential(s)?\b/i },
  { category: 'compliance', pattern: /\bcompliance\b|\blegal\b|\bregulation\b/i },
  { category: 'functional', pattern: /\bfunctional\b|\bfeature\b|\bbehavior\b|\bworkflow\b/i },
])

function normalizeText(value) {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

function normalizeSeverity(value) {
  const normalized = normalizeText(value).toLowerCase()
  return QUESTION_SEVERITIES.has(normalized) ? normalized : null
}

function normalizeCategory(value) {
  const normalized = normalizeText(value).toLowerCase()
  return QUESTION_CATEGORIES.has(normalized) ? normalized : null
}

function inferCategory(text, defaultCategory) {
  for (const rule of CATEGORY_INFERENCE_RULES) {
    if (rule.pattern.test(text)) {
      return rule.category
    }
  }
  return defaultCategory
}

function inferSeverity(text, defaultSeverity) {
  return CRITICAL_TEXT_PATTERNS.some((pattern) => pattern.test(text)) ? 'critical' : defaultSeverity
}

export function normalizeQuestion(question, options = {}) {
  const {
    defaultSeverity = 'low',
    defaultCategory = 'other',
    defaultRequiresUserInput = false,
  } = options

  const normalizedDefaultSeverity = normalizeSeverity(defaultSeverity) ?? 'low'
  const normalizedDefaultCategory = normalizeCategory(defaultCategory) ?? 'other'

  let source = 'legacy'
  let text = ''
  let severity = null
  let category = null
  let requiresUserInput = null

  if (typeof question === 'string') {
    text = normalizeText(question)
  } else if (question && typeof question === 'object') {
    source = 'structured'
    text = normalizeText(question.text)
    severity = normalizeSeverity(question.severity)
    category = normalizeCategory(question.category)
    if (typeof question.requires_user_input === 'boolean') {
      requiresUserInput = question.requires_user_input
    }
  }

  if (!text) {
    return null
  }

  const effectiveSeverity =
    severity ??
    (source === 'legacy' ? inferSeverity(text, normalizedDefaultSeverity) : normalizedDefaultSeverity)
  const effectiveCategory =
    category ??
    (source === 'legacy' ? inferCategory(text, normalizedDefaultCategory) : normalizedDefaultCategory)
  const effectiveRequiresUserInput =
    typeof requiresUserInput === 'boolean'
      ? requiresUserInput
      : effectiveSeverity === 'critical'
        ? true
        : Boolean(defaultRequiresUserInput)

  return {
    text,
    severity: effectiveSeverity,
    category: effectiveCategory,
    requires_user_input: effectiveRequiresUserInput,
    source,
  }
}

export function normalizeQuestionList(questions, options = {}) {
  if (!Array.isArray(questions)) {
    return []
  }
  return questions
    .map((question) => normalizeQuestion(question, options))
    .filter(Boolean)
}

export function extractQuestionTexts(questions, options = {}) {
  return normalizeQuestionList(questions, options).map((question) => question.text)
}

function isLegacyCriticalText(text) {
  return CRITICAL_TEXT_PATTERNS.some((pattern) => pattern.test(text))
}

export function isCriticalQuestion(question) {
  const normalized = normalizeQuestion(question)
  if (!normalized) {
    return false
  }
  if (normalized.severity === 'critical') {
    return true
  }
  if (normalized.requires_user_input && SENSITIVE_QUESTION_CATEGORIES.has(normalized.category)) {
    return true
  }
  if (normalized.source === 'legacy' && isLegacyCriticalText(normalized.text)) {
    return true
  }
  return false
}

export function hasCriticalQuestions(questions) {
  if (!Array.isArray(questions)) {
    return false
  }
  return questions.some((question) => isCriticalQuestion(question))
}
