import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCodexPhase } from './codex.mjs'
import { ensureDir, readTextFile } from './fs.mjs'
import { extractTaskSummaryLine, getBranchNameCandidateTokens } from './branch-name.mjs'
import { BRANCH_NAME_REASONING_EFFORT } from './manifest.mjs'
import { jsonStringifyForPrompt, renderTemplate } from './templates.mjs'

const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROMPTS_DIR = path.join(TOOL_ROOT, 'prompts')
const SCHEMAS_DIR = path.join(TOOL_ROOT, 'schemas')

const WORD_PATTERN = /^[a-z0-9]{2,20}$/
const GENERIC_VERBS = new Set([
  'add',
  'change',
  'create',
  'disable',
  'enable',
  'fix',
  'implement',
  'improve',
  'refactor',
  'remove',
  'rename',
  'support',
  'update',
])

export function validateCodexBranchWords({ output, candidateTokens }) {
  const candidateSet = new Set(Array.isArray(candidateTokens) ? candidateTokens : [])
  const rawWords = output && typeof output === 'object' ? output.words : null
  if (!Array.isArray(rawWords)) {
    return null
  }

  const words = []
  const seen = new Set()
  for (const raw of rawWords) {
    if (typeof raw !== 'string') return null
    const word = raw.trim().toLowerCase()
    if (!WORD_PATTERN.test(word)) return null
    if (!candidateSet.has(word)) return null
    if (seen.has(word)) continue
    words.push(word)
    seen.add(word)
  }

  const withoutGenericVerbs = words.filter((word) => !GENERIC_VERBS.has(word))
  const finalWords = withoutGenericVerbs.length >= 2 ? withoutGenericVerbs : words

  if (finalWords.length < 2 || finalWords.length > 5) {
    return null
  }
  return finalWords
}

export async function pickBranchDescriptorWordsWithCodex({
  codexBin,
  repoRoot,
  runDir,
  taskText,
  model = null,
  runPhase = runCodexPhase,
}) {
  if (!codexBin || typeof codexBin !== 'string') {
    throw new Error('pickBranchDescriptorWordsWithCodex: codexBin must be a non-empty string')
  }
  if (!repoRoot || typeof repoRoot !== 'string') {
    throw new Error('pickBranchDescriptorWordsWithCodex: repoRoot must be a non-empty string')
  }
  if (!runDir || typeof runDir !== 'string') {
    throw new Error('pickBranchDescriptorWordsWithCodex: runDir must be a non-empty string')
  }

  const contextText = extractTaskSummaryLine(taskText)
  const candidateTokens = getBranchNameCandidateTokens(taskText)
  if (candidateTokens.length < 2) {
    throw new Error('pickBranchDescriptorWordsWithCodex: insufficient candidate tokens')
  }

  const phaseDir = path.join(runDir, 'phases', 'branch_name')
  await ensureDir(phaseDir)

  const template = await readTextFile(path.join(PROMPTS_DIR, '07-branch-name.md'))
  const promptText = renderTemplate(template, {
    TASK_SUMMARY_LINE: contextText,
    CANDIDATE_TOKENS_JSON: jsonStringifyForPrompt(candidateTokens),
  })
  const schemaPath = path.join(SCHEMAS_DIR, 'branch-name.schema.json')

  const { output } = await runPhase({
    codexBin,
    repoRoot,
    promptText,
    schemaPath,
    phaseDir,
    sandbox: 'read-only',
    search: false,
    model,
    reasoningEffort: BRANCH_NAME_REASONING_EFFORT,
    noRedact: false,
    policy: null,
    onEventLine: null,
  })

  const words = validateCodexBranchWords({ output, candidateTokens })
  if (!words) {
    throw new Error('pickBranchDescriptorWordsWithCodex: invalid output words')
  }

  return words
}
