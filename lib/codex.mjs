import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { ensureDir, readTextFile, writeJsonFile, writeTextFile } from './fs.mjs'
import { DEFAULT_MODEL, DEFAULT_MODEL_REASONING_EFFORT } from './manifest.mjs'
import { redactText } from './redact.mjs'
import { evaluateCommandPolicy, normalizePolicyAllowlistMode, normalizeSandboxMode } from './policy.mjs'
import { buildCodexSubprocessEnv } from './env.mjs'

const ALLOWED_REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const DEFAULT_MAX_EVENT_LINE_LENGTH = 1024 * 1024
const MAX_REDACTED_COMMAND_OUTPUT_CHARS = 2000
const LIVE_INPUT_HINT_FLAGS = new Set(['--interactive-stdin', '--stdin-events', '--continue-stdin', '--input-fd'])
const REQUIRED_EXEC_FLAGS = Object.freeze([
  '--ask-for-approval',
  '--cd',
  '--json',
  '--output-last-message',
  '--output-schema',
  '--sandbox',
  '--search',
])

function parseHelpOptionNames(helpText) {
  if (typeof helpText !== 'string' || !helpText.trim()) {
    return new Set()
  }
  return new Set(helpText.match(/--[a-z0-9-]+/gi) ?? [])
}

async function readCodexCliText(codexBin, args, { cwd }) {
  const child = spawn(codexBin, args, {
    cwd,
    env: buildCodexSubprocessEnv(process.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const exit = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal }))
  })
  if (exit.code !== 0) {
    throw new Error(`Codex command failed (${[codexBin, ...args].join(' ')}): ${(stderr || stdout).trim()}`)
  }
  return stdout || stderr
}

export class CodexPhaseInterruptedError extends Error {
  constructor(message = 'Codex phase interrupted') {
    super(message)
    this.name = 'CodexPhaseInterruptedError'
  }
}

function normalizeReasoningEffort(reasoningEffort) {
  if (reasoningEffort == null) {
    return DEFAULT_MODEL_REASONING_EFFORT
  }
  if (typeof reasoningEffort !== 'string') {
    throw new Error(`Invalid reasoningEffort type: ${typeof reasoningEffort}`)
  }
  const trimmed = reasoningEffort.trim()
  if (!ALLOWED_REASONING_EFFORTS.has(trimmed)) {
    throw new Error(`Unsupported reasoningEffort: ${reasoningEffort}`)
  }
  return trimmed
}

function extractPolicyScanTargets(event) {
  if (!event || typeof event !== 'object') {
    return []
  }
  const targets = []
  const item = event.item
  if (item && typeof item === 'object' && item.type === 'command_execution' && typeof item.command === 'string') {
    targets.push(item.command)
  }
  return targets
}

function truncateRedactedCommandOutput(value) {
  if (typeof value !== 'string' || value.length <= MAX_REDACTED_COMMAND_OUTPUT_CHARS) {
    return { text: value, truncated: false }
  }

  const remainingChars = value.length - MAX_REDACTED_COMMAND_OUTPUT_CHARS
  return {
    text: `${value.slice(0, MAX_REDACTED_COMMAND_OUTPUT_CHARS)}\n...[truncated ${remainingChars} chars]`,
    truncated: true,
  }
}

function sanitizeEventForRedactedStream(event) {
  if (!event || typeof event !== 'object') {
    return event
  }

  const item = event.item
  if (!item || typeof item !== 'object' || item.type !== 'command_execution') {
    return event
  }

  const { text, truncated } = truncateRedactedCommandOutput(item.aggregated_output)
  if (!truncated) {
    return event
  }

  return {
    ...event,
    item: {
      ...item,
      aggregated_output: text,
      aggregated_output_truncated: true,
    },
  }
}

export function createEventLineProcessor({ maxLineLength = DEFAULT_MAX_EVENT_LINE_LENGTH, onLine, onTruncatedLine }) {
  const decoder = new StringDecoder('utf8')
  let buffer = ''
  let dropping = false
  let droppedBytes = 0

  const emitTruncated = () => {
    if (dropping && droppedBytes > 0 && typeof onTruncatedLine === 'function') {
      onTruncatedLine(droppedBytes)
    }
    dropping = false
    droppedBytes = 0
  }

  const handleText = (text) => {
    if (!text) return
    let chunk = text

    if (dropping) {
      const newlineIndex = chunk.indexOf('\n')
      if (newlineIndex === -1) {
        droppedBytes += chunk.length
        return
      }
      droppedBytes += newlineIndex + 1
      emitTruncated()
      chunk = chunk.slice(newlineIndex + 1)
      if (!chunk) return
    }

    buffer += chunk
    while (true) {
      const newlineIndex = buffer.indexOf('\n')
      if (newlineIndex === -1) {
        if (buffer.length > maxLineLength) {
          droppedBytes += buffer.length
          buffer = ''
          dropping = true
        }
        return
      }

      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      if (line.length > maxLineLength) {
        if (typeof onTruncatedLine === 'function') {
          onTruncatedLine(line.length + 1)
        }
        continue
      }
      if (typeof onLine === 'function') {
        onLine(line)
      }
    }
  }

  return {
    write(chunk) {
      const text = typeof chunk === 'string' ? chunk : decoder.write(chunk)
      handleText(text)
    },
    end() {
      const remaining = decoder.end()
      if (remaining) {
        handleText(remaining)
      }
      if (dropping) {
        emitTruncated()
        return
      }
      if (buffer) {
        if (buffer.length > maxLineLength) {
          if (typeof onTruncatedLine === 'function') {
            onTruncatedLine(buffer.length)
          }
        } else if (typeof onLine === 'function') {
          onLine(buffer)
        }
        buffer = ''
      }
    },
  }
}

export function buildCodexExecArgs({ repoRoot, schemaPath, outputPath, sandbox, search, model, reasoningEffort }) {
  const normalizedSandbox = normalizeSandboxMode(sandbox)
  const normalizedModel = typeof model === 'string' && model.trim() ? model.trim() : DEFAULT_MODEL
  const normalizedReasoningEffort = normalizeReasoningEffort(reasoningEffort)

  const args = [
    'exec',
    '--ask-for-approval',
    'on-request',
    '-c',
    'sandbox_workspace_write.network_access=false',
    '--model',
    normalizedModel,
    '-c',
    `model_reasoning_effort="${normalizedReasoningEffort}"`,
  ]
  args.push(
    ...(search ? ['--search'] : ['-c', 'web_search="disabled"']),
    '--json',
    '--sandbox',
    normalizedSandbox,
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath,
    '--cd',
    repoRoot,
    '-',
  )

  return args
}

export function assessCodexLiveInteractionSupport({ cliVersion = null, execHelpText = '', execResumeHelpText = '' } = {}) {
  const execOptionNames = parseHelpOptionNames(execHelpText)
  const resumeOptionNames = parseHelpOptionNames(execResumeHelpText)
  const blockers = []

  const documentsSinglePromptInput =
    /\[PROMPT\]/.test(execHelpText) && /instructions are read from stdin/i.test(execHelpText)
  const documentsLiveInputFlag = [...LIVE_INPUT_HINT_FLAGS].some((flag) => execOptionNames.has(flag))
  if (documentsSinglePromptInput && !documentsLiveInputFlag) {
    blockers.push('exec_has_no_documented_live_input_channel')
  }
  if (!resumeOptionNames.has('--output-schema')) {
    blockers.push('resume_missing_output_schema')
  }
  if (!resumeOptionNames.has('--sandbox')) {
    blockers.push('resume_missing_sandbox')
  }
  if (!resumeOptionNames.has('--cd')) {
    blockers.push('resume_missing_cd')
  }

  const supported = blockers.length === 0
  return {
    supported,
    mode: supported ? 'live-in-place' : 'interrupt-replay',
    blockers,
    summary: supported
      ? 'True live in-place steering is available for structured phases.'
      : 'True live in-place steering is unavailable on this Codex CLI; using interrupt-and-replay.',
    cliVersion: typeof cliVersion === 'string' && cliVersion.trim() ? cliVersion.trim() : null,
    checkedAt: new Date().toISOString(),
  }
}

export function assessCodexCliContract({ cliVersion = null, execHelpText = '' } = {}) {
  const execOptionNames = parseHelpOptionNames(execHelpText)
  const missingFlags = REQUIRED_EXEC_FLAGS.filter((flag) => !execOptionNames.has(flag))
  return {
    supported: missingFlags.length === 0,
    cliVersion: typeof cliVersion === 'string' && cliVersion.trim() ? cliVersion.trim() : null,
    missingFlags,
  }
}

export async function detectCodexCliContract({ codexBin, repoRoot }) {
  const resolvedCodexBin = typeof codexBin === 'string' && codexBin.trim() ? codexBin.trim() : 'codex'
  const [cliVersion, execHelpText] = await Promise.all([
    readCodexCliText(resolvedCodexBin, ['--version'], { cwd: repoRoot }),
    readCodexCliText(resolvedCodexBin, ['exec', '--help'], { cwd: repoRoot }),
  ])
  return assessCodexCliContract({ cliVersion, execHelpText })
}

export async function detectCodexLiveInteractionSupport({ codexBin, repoRoot }) {
  const resolvedCodexBin = typeof codexBin === 'string' && codexBin.trim() ? codexBin.trim() : 'codex'
  const [cliVersion, execHelpText, execResumeHelpText] = await Promise.all([
    readCodexCliText(resolvedCodexBin, ['--version'], { cwd: repoRoot }),
    readCodexCliText(resolvedCodexBin, ['exec', '--help'], { cwd: repoRoot }),
    readCodexCliText(resolvedCodexBin, ['exec', 'resume', '--help'], { cwd: repoRoot }),
  ])
  return assessCodexLiveInteractionSupport({
    cliVersion,
    execHelpText,
    execResumeHelpText,
  })
}

export async function runCodexPhase({
  codexBin,
  repoRoot,
  promptText,
  schemaPath,
  phaseDir,
  sandbox,
  search = false,
  model = null,
  reasoningEffort,
  noRedact = false,
  policy = null,
  policyAllowlistMode = 'off',
  onEventLine = null,
  inputFingerprint = null,
  cacheFingerprintDiagnostics = null,
  interruptSignal = null,
}) {
  const normalizedSandbox = normalizeSandboxMode(sandbox)
  const normalizedPolicyAllowlistMode = normalizePolicyAllowlistMode(policyAllowlistMode)
  await ensureDir(phaseDir)

  const promptPath = path.join(phaseDir, 'prompt.txt')
  const eventsPath = path.join(phaseDir, 'events.jsonl')
  const rawEventsPath = path.join(phaseDir, 'events.raw.jsonl')
  const outputPath = path.join(phaseDir, 'output.json')
  const metaPath = path.join(phaseDir, 'meta.json')
  const stderrPath = path.join(phaseDir, 'stderr.log')

  await writeTextFile(promptPath, redactText(promptText))

  const args = buildCodexExecArgs({
    repoRoot,
    schemaPath,
    outputPath,
    sandbox: normalizedSandbox,
    search,
    model,
    reasoningEffort,
  })

  const startedAt = new Date().toISOString()
  const stderrStream = createWriteStream(stderrPath, { flags: 'w', mode: 0o600 })
  const eventsStream = createWriteStream(eventsPath, { flags: 'w', mode: 0o600 })
  const rawEventsStream = noRedact ? createWriteStream(rawEventsPath, { flags: 'w', mode: 0o600 }) : null

  const child = spawn(codexBin, args, {
    cwd: repoRoot,
    env: buildCodexSubprocessEnv(process.env),
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let interrupted = false
  let interruptReason = null
  const handleInterrupt = () => {
    interrupted = true
    interruptReason = interruptSignal?.reason ?? interruptReason
    child.kill('SIGTERM')
  }
  if (interruptSignal) {
    if (interruptSignal.aborted) {
      handleInterrupt()
    } else {
      interruptSignal.addEventListener('abort', handleInterrupt, { once: true })
    }
  }

  child.stdin.on('error', () => {
    // Avoid crashing on EPIPE if Codex exits early or is terminated by policy enforcement.
  })
  child.stdin.end(promptText)

  child.stderr.on('data', (chunk) => {
    stderrStream.write(redactText(chunk.toString('utf8')))
  })

  let sessionId = null
  const policyViolations = []
  const policyMonitorDiagnostics = []

  const lineProcessor = createEventLineProcessor({
    maxLineLength: DEFAULT_MAX_EVENT_LINE_LENGTH,
    onLine: (line) => {
    if (rawEventsStream) {
      rawEventsStream.write(`${line}\n`)
    }

    let parsedEvent = null
    try {
      parsedEvent = JSON.parse(line)
    } catch {
      // ignore non-JSON lines
    }

    const lineForRedactedStream = parsedEvent ? JSON.stringify(sanitizeEventForRedactedStream(parsedEvent)) : line
    const redacted = redactText(lineForRedactedStream)
    eventsStream.write(`${redacted}\n`)
    if (typeof onEventLine === 'function') {
      onEventLine(redacted)
    }

    if (policy) {
      const targets = parsedEvent ? extractPolicyScanTargets(parsedEvent) : []
      for (const target of targets) {
        const { enforceViolations, monitorViolations } = evaluateCommandPolicy({
          command: target,
          policy,
          allowlistMode: normalizedPolicyAllowlistMode,
        })
        if (monitorViolations.length > 0) {
          policyMonitorDiagnostics.push({
            command_token: target.trim().split(/\s+/, 1)[0] ?? 'unknown',
            violations: monitorViolations,
          })
        }
        if (enforceViolations.length > 0) {
          policyViolations.push(...enforceViolations)
          child.kill('SIGTERM')
          break
        }
      }
    }

    if (!sessionId) {
      sessionId = parsedEvent?.session_id ?? parsedEvent?.sessionId ?? sessionId
    }
    },
    onTruncatedLine: (droppedBytes) => {
      const notice = JSON.stringify({
        type: 'orchestrator.notice',
        level: 'warn',
        message: 'Codex event line exceeded max length; dropped',
        dropped_bytes: droppedBytes,
        max_line_length: DEFAULT_MAX_EVENT_LINE_LENGTH,
      })
      if (rawEventsStream) {
        rawEventsStream.write(`${notice}\n`)
      }
      const redacted = redactText(notice)
      eventsStream.write(`${redacted}\n`)
      if (typeof onEventLine === 'function') {
        onEventLine(redacted)
      }
    },
  })

  let lineProcessorClosed = false
  const closeLineProcessor = () => {
    if (lineProcessorClosed) return
    lineProcessorClosed = true
    lineProcessor.end()
  }

  child.stdout.on('data', (chunk) => {
    lineProcessor.write(chunk)
  })
  child.stdout.on('end', closeLineProcessor)

  const exit = await new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code, signal) => resolve({ code, signal }))
  })

  closeLineProcessor()
  stderrStream.end()
  eventsStream.end()
  rawEventsStream?.end()

  const endedAt = new Date().toISOString()
  const exitCode = typeof exit.code === 'number' ? exit.code : 1

  const meta = {
    started_at: startedAt,
    ended_at: endedAt,
    exit_code: exitCode,
    signal: exit.signal ?? null,
    session_id: sessionId,
    sandbox: normalizedSandbox,
    search_enabled: Boolean(search),
    schema_path: schemaPath,
    output_path: outputPath,
    prompt_path: promptPath,
    events_path: eventsPath,
    events_raw_path: rawEventsStream ? rawEventsPath : null,
    stderr_path: stderrPath,
    codex_bin: codexBin,
    codex_args: args,
    policy_allowlist_mode: normalizedPolicyAllowlistMode,
    policy_violations: policyViolations,
    policy_monitor_diagnostics: policyMonitorDiagnostics,
  }

  if (inputFingerprint && typeof inputFingerprint === 'object' && !Array.isArray(inputFingerprint)) {
    meta.input_fingerprint = inputFingerprint
  }

  if (
    cacheFingerprintDiagnostics &&
    typeof cacheFingerprintDiagnostics === 'object' &&
    !Array.isArray(cacheFingerprintDiagnostics)
  ) {
    meta.expected_fingerprint =
      typeof cacheFingerprintDiagnostics.expected_fingerprint === 'string'
        ? cacheFingerprintDiagnostics.expected_fingerprint
        : null
    meta.actual_fingerprint =
      typeof cacheFingerprintDiagnostics.actual_fingerprint === 'string'
        ? cacheFingerprintDiagnostics.actual_fingerprint
        : null
    meta.changed_dimensions = Array.isArray(cacheFingerprintDiagnostics.changed_dimensions)
      ? cacheFingerprintDiagnostics.changed_dimensions
          .filter((entry) => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean)
      : []
  }

  await writeJsonFile(metaPath, meta)

  if (interruptSignal) {
    interruptSignal.removeEventListener('abort', handleInterrupt)
  }

  if (interrupted) {
    const reason =
      interruptReason instanceof Error
        ? interruptReason.message
        : typeof interruptReason === 'string'
          ? interruptReason
          : 'Interrupted by conversational steering'
    throw new CodexPhaseInterruptedError(reason)
  }

  if (policyViolations.length > 0) {
    throw new Error(
      `Policy violation detected in Codex event stream: ${policyViolations
        .map((violation) => `${violation.kind}:${violation.pattern}`)
        .join(', ')}`,
    )
  }

  if (exitCode !== 0) {
    throw new Error(`Codex phase failed (exit ${exitCode}). See ${stderrPath}`)
  }

  let outputJson = null
  try {
    const redactedOutput = redactText(await readTextFile(outputPath))
    outputJson = JSON.parse(redactedOutput)
    await writeTextFile(outputPath, `${JSON.stringify(outputJson, null, 2)}\n`)
  } catch (error) {
    throw new Error(`Codex output parse failed (${outputPath}): ${error?.message ?? String(error)}`)
  }
  return { output: outputJson, meta }
}
