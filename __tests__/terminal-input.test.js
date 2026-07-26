/**
 * @jest-environment node
 */

describe('terminal input broker commands', () => {
  test('formats compact terminal status with pipeline state and task progress', async () => {
    const { formatTerminalStatusLine } = await import('../lib/terminal-input.mjs')

    const line = formatTerminalStatusLine({
      runState: {
        state: 'IMPLEMENTING_TASKS',
        task_execution: {
          total: 3,
          completed_task_ids: ['task-1'],
        },
      },
      conversationState: {
        conversation_state: 'paused',
        control_state: 'paused',
        active_phase: 'analysis',
        active_command: 'npm test',
        active_command_phase: 'verification',
        waiting_state: 'paused',
        terminal_broker_state: 'active',
        pending_steering_messages: [{ text: 'Refocus verification', source: 'terminal' }],
        pending_replan: true,
        live_interaction_mode: 'interrupt-replay',
      },
    })

    expect(line).toContain('run_state=IMPLEMENTING_TASKS')
    expect(line).toContain('control=paused')
    expect(line).toContain('phase=analysis')
    expect(line).toContain('command=npm test')
    expect(line).toContain('command_phase=verification')
    expect(line).toContain('tasks=1/3')
    expect(line).toContain('pending_steers=1')
    expect(line).toContain('pending_replan=yes')
    expect(line).toContain('live=interrupt-replay')
  })

  test('parses explicit conversational control commands', async () => {
    const { parseTerminalInput } = await import('../lib/terminal-input.mjs')

    expect(parseTerminalInput('/pause')).toEqual({
      type: 'command',
      command: 'pause',
      argument: '',
    })
    expect(parseTerminalInput('/resume')).toEqual({
      type: 'command',
      command: 'resume',
      argument: '',
    })
    expect(parseTerminalInput('/abort')).toEqual({
      type: 'command',
      command: 'abort',
      argument: '',
    })
    expect(parseTerminalInput('/help')).toEqual({
      type: 'command',
      command: 'help',
      argument: '',
    })
    expect(parseTerminalInput('/replan focus on docs')).toEqual({
      type: 'command',
      command: 'replan',
      argument: 'focus on docs',
    })
  })

  test('treats non-command text as steering input', async () => {
    const { parseTerminalInput } = await import('../lib/terminal-input.mjs')

    expect(parseTerminalInput('Prioritize resumability over retry speed.')).toEqual({
      type: 'steering',
      text: 'Prioritize resumability over retry speed.',
    })
  })
})
