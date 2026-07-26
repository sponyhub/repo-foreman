export function renderTemplate(template, variables) {
  if (typeof template !== 'string') {
    throw new Error('Template must be a string')
  }
  if (!variables || typeof variables !== 'object') {
    throw new Error('variables must be an object')
  }

  return template.replaceAll(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!(key in variables)) {
      throw new Error(`Missing template variable: ${key}`)
    }
    return String(variables[key])
  })
}

export const DEFAULT_PROMPT_JSON_MAX_CHARS = 32000

function normalizePromptMaxChars(maxChars) {
  return Number.isFinite(maxChars) ? Math.max(Math.floor(maxChars), 1) : DEFAULT_PROMPT_JSON_MAX_CHARS
}

function truncatePromptText(text, { maxChars, label }) {
  if (text.length <= maxChars) {
    return {
      text,
      truncated: false,
      originalChars: text.length,
      maxChars,
      label,
    }
  }

  const marker = `\n... [TRUNCATED ${label}: original_chars=${text.length}, max_chars=${maxChars}]\n`
  const remainingBudget = Math.max(0, maxChars - marker.length)
  const headBudget = Math.ceil(remainingBudget / 2)
  const tailBudget = Math.max(0, remainingBudget - headBudget)
  const head = text.slice(0, headBudget)
  const tail = tailBudget > 0 ? text.slice(-tailBudget) : ''

  return {
    text: `${head}${marker}${tail}`,
    truncated: true,
    originalChars: text.length,
    maxChars,
    label,
  }
}

export function renderJsonForPrompt(value, { maxChars = DEFAULT_PROMPT_JSON_MAX_CHARS, label = 'JSON' } = {}) {
  const serialized = JSON.stringify(value ?? null, null, 2)
  const normalizedMaxChars = normalizePromptMaxChars(maxChars)
  return truncatePromptText(serialized, { maxChars: normalizedMaxChars, label })
}

export function renderTextForPrompt(value, { maxChars = DEFAULT_PROMPT_JSON_MAX_CHARS, label = 'TEXT' } = {}) {
  const text = typeof value === 'string' ? value : String(value ?? '')
  const normalizedMaxChars = normalizePromptMaxChars(maxChars)
  return truncatePromptText(text, { maxChars: normalizedMaxChars, label })
}

export function jsonStringifyForPrompt(value, options = {}) {
  return renderJsonForPrompt(value, options).text
}
