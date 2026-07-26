import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { ensureDir } from './fs.mjs'
import { redactText } from './redact.mjs'

const DEFAULT_MAX_CAPTURE_BYTES = 1024 * 1024
const SHELL_PAREN_SYNTAX = 'syntax error near unexpected token'
const SHELL_PAREN_FALLBACKS = ['syntax error', 'unexpected token', 'unexpected']

export class ShellCommandInterruptedError extends Error {
  constructor(message = 'Shell command interrupted', reason = null) {
    super(message)
    this.name = 'ShellCommandInterruptedError'
    this.reason = reason ?? null
  }
}

function escapeUnquotedParens(command) {
  let result = ''
  let inSingle = false
  let inDouble = false
  let escaped = false
  let changed = false

  for (const char of command) {
    if (escaped) {
      result += char
      escaped = false
      continue
    }
    if (char === '\\' && !inSingle) {
      result += char
      escaped = true
      continue
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      result += char
      continue
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      result += char
      continue
    }
    if (!inSingle && !inDouble && (char === '(' || char === ')')) {
      result += `\\${char}`
      changed = true
      continue
    }
    result += char
  }

  return { value: result, changed }
}

function isShellParenSyntaxError(output) {
  if (!output) return false
  const text = String(output)
  if (!(text.includes('(') || text.includes(')'))) return false
  if (text.includes(SHELL_PAREN_SYNTAX)) return true
  const lower = text.toLowerCase()
  return SHELL_PAREN_FALLBACKS.some((pattern) => lower.includes(pattern))
}

function closeLogStream(logStream) {
  return new Promise((resolve, reject) => {
    logStream.once('finish', resolve)
    logStream.once('error', reject)
    logStream.end()
  })
}

export async function runShellCommand({
  command,
  cwd,
  env,
  logPath,
  timeoutMs,
  maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
  interruptSignal = null,
}) {
  await ensureDir(path.dirname(logPath))

  const logStream = createWriteStream(logPath, { flags: 'a', mode: 0o600 })

  const runAttempt = (attemptCommand) =>
    new Promise((resolve, reject) => {
      if (interruptSignal?.aborted) {
        reject(new ShellCommandInterruptedError('Shell command interrupted', interruptSignal.reason ?? null))
        return
      }

      const child = spawn(attemptCommand, {
        cwd,
        env,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let captured = ''
      let interrupted = false
      let interruptReason = null
      const append = (chunk) => {
        captured += chunk
        if (captured.length > maxCaptureBytes) {
          captured = captured.slice(captured.length - maxCaptureBytes)
        }
      }

      const handleInterrupt = () => {
        interrupted = true
        interruptReason = interruptSignal?.reason ?? interruptReason
        child.kill('SIGTERM')
      }
      const cleanupInterrupt = () => {
        if (interruptSignal) {
          interruptSignal.removeEventListener('abort', handleInterrupt)
        }
      }
      if (interruptSignal) {
        interruptSignal.addEventListener('abort', handleInterrupt, { once: true })
      }

      child.stdout.on('data', (chunk) => {
        const text = redactText(chunk.toString('utf8'))
        logStream.write(text)
        append(text)
      })
      child.stderr.on('data', (chunk) => {
        const text = redactText(chunk.toString('utf8'))
        logStream.write(text)
        append(text)
      })

      let timeoutId
      if (timeoutMs != null) {
        timeoutId = setTimeout(() => {
          child.kill('SIGTERM')
        }, timeoutMs)
      }

      child.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId)
        cleanupInterrupt()
        reject(error)
      })

      child.on('close', (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId)
        cleanupInterrupt()
        if (interrupted) {
          reject(new ShellCommandInterruptedError('Shell command interrupted', interruptReason))
          return
        }
        resolve({
          exitCode: typeof code === 'number' ? code : 1,
          signal,
          output: captured,
        })
      })
    })

  try {
    let result = await runAttempt(command)
    if (result.exitCode !== 0 && isShellParenSyntaxError(result.output)) {
      const escaped = escapeUnquotedParens(command)
      if (escaped.changed) {
        logStream.write('\n[orchestrator] retrying with escaped parentheses\n')
        result = await runAttempt(escaped.value)
      }
    }
    return result
  } finally {
    await closeLogStream(logStream)
  }
}
