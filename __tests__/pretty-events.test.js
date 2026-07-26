/**
 * @jest-environment node
 */

describe('pretty event formatting', () => {
  test('pretty formatter renders assistant payloads without wrapper noise', async () => {
    const { formatCodexEventLine } = await import('../lib/run.mjs')

    const eventLine = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'agent_message',
        text: JSON.stringify({
          task_id: 'homepage-add-how-it-works-section',
          status: 'done',
          notes: ['first', 'second'],
        }),
      },
    })

    const output = formatCodexEventLine(eventLine, { pretty: true })

    expect(output).toContain('assistant:')
    expect(output).toContain('task_id: "homepage-add-how-it-works-section"')
    expect(output).toContain('notes:')
    expect(output).toContain('- "first"')
    expect(output).not.toContain('item:')
    expect(output).not.toContain('id: "item_1"')
  })

  test('pretty formatter does not expand non-JSON strings', async () => {
    const { formatCodexEventLine } = await import('../lib/run.mjs')

    const eventLine = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_1',
        type: 'agent_message',
        text: 'hello {not json}',
      },
    })

    const output = formatCodexEventLine(eventLine, { pretty: true })
    expect(output).toContain('assistant: "hello {not json}"')
  })

  test('pretty formatter compresses nested error payloads into a short summary', async () => {
    const { formatCodexEventLine } = await import('../lib/run.mjs')

    const eventLine = JSON.stringify({
      type: 'error',
      message: JSON.stringify({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          code: 'invalid_json_schema',
          message: 'Invalid schema for response_format codex_output_schema',
          param: 'text.format.schema',
        },
        status: 400,
      }),
    })

    const output = formatCodexEventLine(eventLine, { pretty: true })

    expect(output).toBe('error invalid_json_schema: Invalid schema for response_format codex_output_schema')
  })

  test('pretty formatter compresses turn failure payloads into a short summary', async () => {
    const { formatCodexEventLine } = await import('../lib/run.mjs')

    const eventLine = JSON.stringify({
      type: 'turn.failed',
      error: {
        message: JSON.stringify({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            code: 'invalid_json_schema',
            message: 'Invalid schema for response_format codex_output_schema',
          },
          status: 400,
        }),
      },
    })

    const output = formatCodexEventLine(eventLine, { pretty: true })

    expect(output).toBe('turn failed invalid_json_schema: Invalid schema for response_format codex_output_schema')
  })

  test('pretty formatter summarizes command execution events without full command output', async () => {
    const { formatCodexEventLine } = await import('../lib/run.mjs')

    const eventLine = JSON.stringify({
      type: 'item.completed',
      item: {
        id: 'item_2',
        type: 'command_execution',
        command: "/bin/zsh -lc 'echo ok'",
        aggregated_output: 'line 1\nline 2\nline 3',
        exit_code: 0,
        status: 'completed',
      },
    })

    const output = formatCodexEventLine(eventLine, { pretty: true })

    expect(output).toBe("command completed (exit 0): /bin/zsh -lc 'echo ok'")
  })
})
