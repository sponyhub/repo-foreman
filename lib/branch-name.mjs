function toAsciiLower(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

export function extractTaskSummaryLine(taskText) {
  const raw = String(taskText ?? '')
  const lines = raw.split(/\r?\n/g)
  let inCodeBlock = false
  const contextLines = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue
    if (trimmed === '---') continue
    const cleaned = trimmed
      .replace(/^#+\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .trim()
    if (cleaned) contextLines.push(cleaned)
  }
  if (contextLines.length > 0) {
    return contextLines.join(' ')
  }
  return raw.trim()
}

const STOPWORDS_GLUE = new Set([
  // English glue
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
  // Polish glue (common in tasks)
  'i',
  'oraz',
  'w',
  'na',
  'do',
  'z',
  'ze',
  'za',
  'dla',
  'od',
  'pod',
  'nad',
  'bez',
  'przez',
  'po',
  'przy',
  'o',
  'u',
])

const GENERIC_VERBS = new Set([
  'add',
  'create',
  'change',
  'enable',
  'disable',
  'fix',
  'implement',
  'improve',
  'refactor',
  'remove',
  'rename',
  'support',
  'update',
])

const STOPWORDS_URLISH = new Set([
  'http',
  'https',
  'www',
  'com',
  'net',
  'org',
  'io',
  'pl',
])

const STOPWORDS_STRICT = new Set([...STOPWORDS_GLUE, ...GENERIC_VERBS, ...STOPWORDS_URLISH])

function tokenize(text) {
  const normalized = toAsciiLower(text)
  const matches = normalized.match(/[a-z0-9]+/g)
  return matches ? matches.filter(Boolean) : []
}

function looksLikeIdishToken(token) {
  if (!token) return true
  if (token.length > 24) return true
  const digitRuns = token.match(/\d{6,}/g)
  if (digitRuns && digitRuns.length > 0) return true
  return false
}

function filterTokens(tokens, { strict }) {
  const filtered = []
  for (const token of tokens) {
    if (!token) continue
    if (token === 'v' || token === 'vs') continue
    if (looksLikeIdishToken(token)) continue

    if (strict) {
      if (STOPWORDS_STRICT.has(token)) continue
      if (token.length < 3) continue
    } else {
      if (STOPWORDS_STRICT.has(token) && token.length <= 2) continue
      if (token.length < 2) continue
    }
    filtered.push(token)
  }
  return filtered
}

function pickUpToFive(tokens) {
  if (tokens.length <= 5) return tokens
  return tokens.slice(0, 5)
}

function ensureAtLeastTwoWords(tokens) {
  if (tokens.length >= 2) return tokens
  return ['codex', 'task']
}

export function getBranchNameCandidateTokens(taskText, { maxTokens = 32 } = {}) {
  const contextText = extractTaskSummaryLine(taskText)
  const rawTokens = tokenize(contextText)

  const seen = new Set()
  const candidates = []
  for (const token of rawTokens) {
    if (!token) continue
    if (token === 'v' || token === 'vs') continue
    if (STOPWORDS_GLUE.has(token)) continue
    if (STOPWORDS_URLISH.has(token)) continue
    if (looksLikeIdishToken(token)) continue
    if (token.length < 2) continue
    if (seen.has(token)) continue

    candidates.push(token)
    seen.add(token)

    if (candidates.length >= maxTokens) {
      break
    }
  }

  return candidates
}

export function deriveBranchDescriptorWords(taskText) {
  const contextText = extractTaskSummaryLine(taskText)
  const rawTokens = tokenize(contextText)

  const strictTokens = pickUpToFive(filterTokens(rawTokens, { strict: true }))
  if (strictTokens.length >= 2) {
    return strictTokens
  }

  const relaxedTokens = pickUpToFive(filterTokens(rawTokens, { strict: false }))
  return ensureAtLeastTwoWords(relaxedTokens)
}

export function makeRunBranchName({ runId, taskText }) {
  if (!runId || typeof runId !== 'string') {
    throw new Error('makeRunBranchName: runId must be a non-empty string')
  }
  const words = deriveBranchDescriptorWords(taskText)
  const slug = words.join('-')
  return `${slug}-${runId}`
}
