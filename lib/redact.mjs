const DEFAULT_REDACTIONS = [
  /AKIA[0-9A-Z]{16}/g,
  /ASIA[0-9A-Z]{16}/g,
  /sk-[A-Za-z0-9]{20,}/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bnpm_[A-Za-z0-9]{20,}\b/g,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /-----BEGIN (?:RSA|EC|OPENSSH|DSA)? ?PRIVATE KEY-----[\s\S]*?-----END (?:RSA|EC|OPENSSH|DSA)? ?PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:/]+:[^@\s]+@[^\s]+/gi,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password|passwd|secret)\b\s*[:=]\s*["']?[^"'\s,;]{8,}/gi,
  /\b(?:cookie|set-cookie):\s*[^\r\n]+/gi,
]

export function redactText(text, { patterns = DEFAULT_REDACTIONS } = {}) {
  if (typeof text !== 'string') {
    return text
  }
  let redacted = text
  for (const pattern of patterns) {
    redacted = redacted.replaceAll(pattern, '[REDACTED]')
  }
  return redacted
}
