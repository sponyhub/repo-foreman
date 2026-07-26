import path from 'node:path'
import readline from 'node:readline'
import { fileExists, readJsonFile } from './fs.mjs'
import {
  abortConversation,
  enqueueSteeringMessage,
  pauseConversation,
  readConversationState,
  requestConversationReplan,
  resumeConversation,
  setConversationTerminalState,
} from './conversation-state.mjs'

const COMMANDS = new Set(['status', 'pause', 'resume', 'abort', 'replan', 'help'])

async function readRunState(runDir) {
  const statePath = path.join(runDir, 'state.json')
  if (!(await fileExists(statePath))) {
    return null
  }
  return await readJsonFile(statePath)
}

function formatTaskProgress(runState) {
  const taskExecution = runState?.task_execution
  const total = Number.isFinite(taskExecution?.total) ? Math.max(0, Math.trunc(taskExecution.total)) : 0
  if (total <= 0) {
    return null
  }
  const completed = Array.isArray(taskExecution?.completed_task_ids) ? taskExecution.completed_task_ids.length : 0
  return `${completed}/${total}`
}

export function formatTerminalStatusLine({ runState = null, conversationState = null } = {}) {
  const pendingSteers = Array.isArray(conversationState?.pending_steering_messages)
    ? conversationState.pending_steering_messages.length
    : 0
  const segments = [
    'conversation:',
    `run_state=${runState?.state ?? 'unknown'}`,
    `conversation=${conversationState?.conversation_state ?? 'unknown'}`,
    `control=${conversationState?.control_state ?? 'unknown'}`,
    `phase=${conversationState?.active_phase ?? 'none'}`,
    `command=${conversationState?.active_command ?? 'none'}`,
    `command_phase=${conversationState?.active_command_phase ?? 'none'}`,
    `wait=${conversationState?.waiting_state ?? 'none'}`,
    `broker=${conversationState?.terminal_broker_state ?? 'unknown'}`,
  ]

  const taskProgress = formatTaskProgress(runState)
  if (taskProgress) {
    segments.push(`tasks=${taskProgress}`)
  }
  if (typeof runState?.task_execution?.failed_task_id === 'string' && runState.task_execution.failed_task_id.trim()) {
    segments.push(`failed_task=${runState.task_execution.failed_task_id.trim()}`)
  }
  if (typeof conversationState?.live_interaction_mode === 'string' && conversationState.live_interaction_mode.trim()) {
    segments.push(`live=${conversationState.live_interaction_mode.trim()}`)
  }

  segments.push(`pending_steers=${pendingSteers}`)
  segments.push(`pending_replan=${conversationState?.pending_replan ? 'yes' : 'no'}`)
  return segments.join(' ')
}

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  })
}

export function parseTerminalInput(input) {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!text) {
    return null
  }
  if (!text.startsWith('/')) {
    return {
      type: 'steering',
      text,
    }
  }

  const [commandToken] = text.split(/\s+/, 1)
  const command = commandToken.slice(1).trim().toLowerCase()
  const argument = text.slice(commandToken.length).trim()
  if (!COMMANDS.has(command)) {
    return {
      type: 'unknown_command',
      command,
      argument,
    }
  }

  return {
    type: 'command',
    command,
    argument,
  }
}

export function startTerminalInputBroker({ runDir, interactionModel = 'phased', interactionContext, ui } = {}) {
  if (interactionModel !== 'conversational') {
    return null
  }
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    void setConversationTerminalState(runDir, 'unavailable')
    ui?.log?.('conversation: terminal steering disabled (TTY unavailable)')
    return null
  }

  let rl = null
  let stopped = false
  let suspended = false
  let processing = Promise.resolve()

  const closeInterface = () => {
    if (!rl) {
      return
    }
    rl.close()
    rl = null
  }

  const ensureInterface = () => {
    if (stopped || suspended || rl) {
      return
    }
    rl = createInterface()
    rl.on('line', (line) => {
      processing = processing.catch(() => {}).then(async () => {
        const parsed = parseTerminalInput(line)
        if (!parsed) {
          return
        }

        if (parsed.type === 'unknown_command') {
          ui?.log?.(`conversation: unknown command /${parsed.command}`)
          return
        }

        if (parsed.type === 'command' && parsed.command === 'status') {
          const runState = await readRunState(runDir)
          const state = await readConversationState(runDir)
          ui?.log?.(formatTerminalStatusLine({ runState, conversationState: state }))
          return
        }

        if (parsed.type === 'command') {
          if (parsed.command === 'help') {
            ui?.log?.('conversation: commands=/help /status /pause /resume /abort /replan [optional guidance]')
            return
          }
          if (parsed.command === 'pause') {
            await pauseConversation(runDir, { source: 'terminal' })
            ui?.log?.('conversation: paused; current phase will wait for /resume')
          } else if (parsed.command === 'resume') {
            await resumeConversation(runDir, { source: 'terminal' })
            ui?.log?.('conversation: resumed')
          } else if (parsed.command === 'abort') {
            await abortConversation(runDir, {
              source: 'terminal',
              reason: 'Run aborted from terminal control command.',
            })
            ui?.log?.('conversation: abort requested')
          } else if (parsed.command === 'replan') {
            await requestConversationReplan(runDir, {
              source: 'terminal',
              text: parsed.argument,
            })
            ui?.log?.(
              parsed.argument
                ? `conversation: replan requested (${parsed.argument})`
                : 'conversation: replan requested',
            )
          }

          if (parsed.command === 'pause' || parsed.command === 'abort' || parsed.command === 'replan') {
            const controller = interactionContext?.currentInterruptController
            if (controller && !controller.signal.aborted) {
              controller.abort(new Error(`terminal ${parsed.command}`))
            }
          }
          return
        }

        const message = await enqueueSteeringMessage(runDir, {
          text: parsed.text,
          source: 'terminal',
        })
        if (!message) {
          return
        }

        ui?.log?.(`conversation: queued steering message (${message.text})`)
        const controller = interactionContext?.currentInterruptController
        if (controller && !controller.signal.aborted) {
          controller.abort(new Error('terminal steering'))
        }
      })
    })
  }

  ensureInterface()
  void setConversationTerminalState(runDir, 'active')
  ui?.log?.(
    'conversation: terminal steering enabled; type /help for commands or plain text at any time to steer the run',
  )

  return {
    suspend() {
      suspended = true
      closeInterface()
      void setConversationTerminalState(runDir, 'suspended')
    },
    resume() {
      if (stopped) {
        return
      }
      suspended = false
      ensureInterface()
      void setConversationTerminalState(runDir, 'active')
    },
    stop() {
      stopped = true
      closeInterface()
      void setConversationTerminalState(runDir, 'stopped')
    },
  }
}
