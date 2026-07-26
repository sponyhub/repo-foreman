import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { toPosixPath } from './fs.mjs'

const ALLOWLIST_MODES = new Set(['off', 'monitor', 'enforce'])
export const DEFAULT_MAX_SYNTHETIC_CYCLES = 3
const MIN_MAX_SYNTHETIC_CYCLES = 1
const MAX_MAX_SYNTHETIC_CYCLES = 10

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isSingleTokenCommandPattern(pattern) {
  if (typeof pattern !== 'string' || !pattern.endsWith(' ')) {
    return false
  }
  const token = pattern.trim()
  return token.length > 0 && !token.includes(' ')
}

function extractVariableAssignments(text) {
  const assignments = []
  const assignmentRegex =
    /(?:^|[;&|\n]\s*|['"]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;&|\n]+))/g

  let match
  while ((match = assignmentRegex.exec(text)) !== null) {
    const variable = match[1]
    const rawValue = (match[2] ?? match[3] ?? match[4] ?? '').trim()
    const mktempMatch = rawValue.match(/^\$\(\s*mktemp\b([^)]*)\)$/)
    const mktempArgs = mktempMatch?.[1] ?? ''
    const isMktempDir = Boolean(mktempMatch) && (/(^|\s)-d(\s|$)/.test(mktempArgs) || /(^|\s)--directory(\s|$)/.test(mktempArgs))

    assignments.push({
      variable,
      index: match.index,
      isMktempDir,
    })
  }

  return assignments
}

function extractRmRfVariableCleanupTargets(text) {
  const targets = []
  const cleanupRegex =
    /(?:^|[;&|\n]\s*)rm\s+-rf\s+(?:--\s+)?(?:"\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?"|'\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?'|\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?)(?=\s*(?:[;&|\n)'"]|$))/g

  let match
  while ((match = cleanupRegex.exec(text)) !== null) {
    const variable = match[1] ?? match[2] ?? match[3]
    if (variable) {
      targets.push({
        variable,
        index: match.index,
      })
    }
  }

  return targets
}

function countRmRfCommands(text) {
  const rmRfRegex = /(?:^|[;&|\n]\s*)rm\s+-rf\b/g
  let count = 0
  while (rmRfRegex.exec(text) !== null) {
    count += 1
  }
  return count
}

function isSafeMktempDirectoryCleanup(text) {
  const assignments = extractVariableAssignments(text)
  if (assignments.length === 0) {
    return false
  }

  const cleanupTargets = extractRmRfVariableCleanupTargets(text)
  if (cleanupTargets.length === 0) {
    return false
  }

  if (cleanupTargets.length !== countRmRfCommands(text)) {
    return false
  }

  return cleanupTargets.every((target) => {
    const previousAssignments = assignments.filter(
      (assignment) => assignment.variable === target.variable && assignment.index < target.index,
    )
    const lastAssignment = previousAssignments[previousAssignments.length - 1]
    return Boolean(lastAssignment?.isMktempDir)
  })
}

function detectSubstringViolation(text, substring) {
  if (!substring) {
    return false
  }

  if (substring === 'rm -rf' && isSafeMktempDirectoryCleanup(text)) {
    return false
  }

  if (!isSingleTokenCommandPattern(substring)) {
    return text.includes(substring)
  }

  const commandToken = substring.trim()
  // Match command tokens at shell-like boundaries to avoid false positives
  // such as `async ` containing `nc `.
  const tokenRegex = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegex(commandToken)}(?=\\s|$|[;|&)])`)
  return tokenRegex.test(text)
}

export function normalizeSandboxMode(sandboxMode) {
  if (sandboxMode === 'unrestricted') {
    return 'danger-full-access'
  }
  if (sandboxMode === 'read-only' || sandboxMode === 'workspace-write' || sandboxMode === 'danger-full-access') {
    return sandboxMode
  }
  throw new Error(`Unsupported sandbox mode: ${sandboxMode}`)
}

export function resolveMaxSyntheticCycles(policy, { onWarning } = {}) {
  const rawValue = policy?.max_synthetic_cycles
  if (rawValue == null) {
    return DEFAULT_MAX_SYNTHETIC_CYCLES
  }
  if (typeof rawValue !== 'number' || Number.isNaN(rawValue)) {
    throw new Error('Policy.max_synthetic_cycles must be a number when provided')
  }

  const normalized = Math.trunc(rawValue)
  if (normalized < MIN_MAX_SYNTHETIC_CYCLES) {
    onWarning?.(
      `Policy.max_synthetic_cycles=${normalized} is outside ${MIN_MAX_SYNTHETIC_CYCLES}-${MAX_MAX_SYNTHETIC_CYCLES}; clamped to ${MIN_MAX_SYNTHETIC_CYCLES}.`,
    )
    return MIN_MAX_SYNTHETIC_CYCLES
  }
  if (normalized > MAX_MAX_SYNTHETIC_CYCLES) {
    onWarning?.(
      `Policy.max_synthetic_cycles=${normalized} is outside ${MIN_MAX_SYNTHETIC_CYCLES}-${MAX_MAX_SYNTHETIC_CYCLES}; clamped to ${MAX_MAX_SYNTHETIC_CYCLES}.`,
    )
    return MAX_MAX_SYNTHETIC_CYCLES
  }
  return normalized
}

export function validatePolicyObject(policy, { onWarning } = {}) {
  if (!policy || typeof policy !== 'object') {
    throw new Error('Policy must be an object')
  }
  if (policy.version !== 2) {
    throw new Error('Unsupported policy version')
  }
  if (typeof policy.name !== 'string' || !policy.name.trim()) {
    throw new Error('Policy name is required')
  }

  const arrayFields = [
    'deny_substrings',
    'deny_regex',
    'deny_path_globs',
    'allow_path_globs',
    'deny_diff_regex',
  ]
  for (const field of arrayFields) {
    if (!Array.isArray(policy[field])) {
      throw new Error(`Policy.${field} must be an array`)
    }
  }
  if (typeof policy.max_deleted_files !== 'number' || Number.isNaN(policy.max_deleted_files)) {
    throw new Error('Policy.max_deleted_files must be a number')
  }
  const maxSyntheticCycles = resolveMaxSyntheticCycles(policy, { onWarning })
  if (policy.allow_command_prefixes != null) {
    if (!Array.isArray(policy.allow_command_prefixes)) {
      throw new Error('Policy.allow_command_prefixes must be an array when provided')
    }
    for (const prefix of policy.allow_command_prefixes) {
      if (typeof prefix !== 'string' || !prefix.trim()) {
        throw new Error('Policy.allow_command_prefixes values must be non-empty strings')
      }
    }
  }
  return {
    ...policy,
    max_synthetic_cycles: maxSyntheticCycles,
  }
}

export function normalizePolicyAllowlistMode(allowlistMode) {
  if (allowlistMode == null) {
    return 'off'
  }
  if (typeof allowlistMode !== 'string') {
    throw new Error(`Unsupported policy allowlist mode type: ${typeof allowlistMode}`)
  }
  const normalized = allowlistMode.trim().toLowerCase()
  if (!ALLOWLIST_MODES.has(normalized)) {
    throw new Error(`Unsupported policy allowlist mode: ${allowlistMode}`)
  }
  return normalized
}

function extractCommandToken(command) {
  const normalized = String(command ?? '').trim()
  if (!normalized) {
    return 'unknown'
  }
  const firstWhitespace = normalized.search(/\s/)
  if (firstWhitespace === -1) {
    return normalized
  }
  return normalized.slice(0, firstWhitespace)
}

function matchesAllowCommandPrefix(command, prefix) {
  const normalizedCommand = String(command ?? '').trim()
  const normalizedPrefix = String(prefix ?? '').trim()
  if (!normalizedCommand || !normalizedPrefix) {
    return false
  }
  return normalizedCommand === normalizedPrefix || normalizedCommand.startsWith(`${normalizedPrefix} `)
}

function hasAllowlistedCommandPrefix(command, policy) {
  const prefixes = Array.isArray(policy?.allow_command_prefixes) ? policy.allow_command_prefixes : []
  if (prefixes.length === 0) {
    return null
  }
  for (const prefix of prefixes) {
    if (matchesAllowCommandPrefix(command, prefix)) {
      return true
    }
  }
  return false
}

export function evaluateCommandPolicy({ command, policy, allowlistMode = 'off' } = {}) {
  const normalizedAllowlistMode = normalizePolicyAllowlistMode(allowlistMode)
  const enforceViolations = detectForbiddenContent(command, policy)
  const monitorViolations = []

  if (!policy || normalizedAllowlistMode === 'off') {
    return {
      enforceViolations,
      monitorViolations,
    }
  }

  const allowlistMatch = hasAllowlistedCommandPrefix(command, policy)
  if (allowlistMatch === false) {
    const commandToken = extractCommandToken(command)
    const violation = {
      kind: 'allowlist_miss',
      pattern: commandToken,
    }
    if (normalizedAllowlistMode === 'enforce') {
      enforceViolations.push(violation)
    } else {
      monitorViolations.push(violation)
    }
  }

  return {
    enforceViolations,
    monitorViolations,
  }
}

export async function loadPolicy({ policyName, policyFilePath, policiesDir, onWarning } = {}) {
  if (policyFilePath) {
    const raw = await readFile(policyFilePath, 'utf8')
    const parsed = JSON.parse(raw)
    return validatePolicyObject(parsed, { onWarning })
  }

  if (!policyName || policyName === 'off') {
    return null
  }

  const filename = `${policyName}.policy.json`
  const resolvedPath = path.join(policiesDir, filename)
  const raw = await readFile(resolvedPath, 'utf8')
  const parsed = JSON.parse(raw)
  return validatePolicyObject(parsed, { onWarning })
}

export function detectForbiddenContent(text, policy) {
  if (!policy) {
    return []
  }
  validatePolicyObject(policy)

  const violations = []
  for (const substring of policy.deny_substrings) {
    if (detectSubstringViolation(text, substring)) {
      violations.push({ kind: 'deny_substring', pattern: substring })
    }
  }

  for (const pattern of policy.deny_regex) {
    if (!pattern) {
      continue
    }
    const regex = new RegExp(pattern)
    if (regex.test(text)) {
      violations.push({ kind: 'deny_regex', pattern })
    }
  }

  return violations
}

export function detectSecretDiffMatches(diffText, policy) {
  if (!policy) {
    return []
  }
  validatePolicyObject(policy)

  const matches = []
  for (const pattern of policy.deny_diff_regex) {
    if (!pattern) {
      continue
    }
    const regex = new RegExp(pattern, 'g')
    const seen = new Set()
    let match
    while ((match = regex.exec(diffText)) !== null) {
      const value = match[0]
      if (seen.has(value)) {
        continue
      }
      seen.add(value)
      matches.push({ pattern, match: value })
    }
  }
  return matches
}

function globToRegExp(glob) {
  const normalized = toPosixPath(glob)
  let regexSource = '^'
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const next = normalized[index + 1]
    const nextNext = normalized[index + 2]

    if (char === '*' && next === '*') {
      if (nextNext === '/') {
        regexSource += '(?:.*\\/)?'
        index += 2
        continue
      }
      regexSource += '.*'
      index += 1
      continue
    }
    if (char === '*') {
      regexSource += '[^/]*'
      continue
    }
    if (char === '?') {
      regexSource += '[^/]'
      continue
    }
    if ('\\.[]{}()+-^$|'.includes(char)) {
      regexSource += `\\${char}`
      continue
    }
    regexSource += char
  }
  regexSource += '$'
  return new RegExp(regexSource)
}

function matchesAnyGlob(filePath, globs) {
  const normalizedPath = toPosixPath(filePath)
  for (const glob of globs ?? []) {
    if (!glob) {
      continue
    }
    const regex = globToRegExp(glob)
    if (regex.test(normalizedPath)) {
      return glob
    }
  }
  return null
}

export function isDeniedPath(filePath, policy) {
  if (!policy) {
    return false
  }
  validatePolicyObject(policy)

  const deniedBy = matchesAnyGlob(filePath, policy.deny_path_globs)
  if (!deniedBy) {
    return false
  }
  const allowedBy = matchesAnyGlob(filePath, policy.allow_path_globs)
  return !allowedBy
}

export function parseGitStatusPorcelain(porcelainOutput) {
  const lines = String(porcelainOutput ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)

  const paths = []
  let deletedFiles = 0

  for (const line of lines) {
    const status = line.slice(0, 2)
    const rest = line.slice(3).trim()

    if (status.includes('D')) {
      deletedFiles += 1
    }

    if (!rest) {
      continue
    }

    if (rest.includes(' -> ')) {
      const [, toPath] = rest.split(' -> ')
      if (toPath) {
        paths.push(toPath.trim())
      }
      continue
    }

    paths.push(rest)
  }

  return { paths, deletedFiles }
}
