/**
 * @jest-environment node
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

describe('status and explain conversational reporting', () => {
  test('surface conversational control state and aborted runs', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-orch-status-'))
    const previousCwd = process.cwd()
    const runId = 'run-123'
    const branchName = 'feature/run-123'
    const runDir = path.join(tmpDir, '.patch-gantry', 'runs', 'feature', 'run-123')
    const phasesDir = path.join(runDir, 'phases', 'analysis')

    try {
      execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'ignore' })
      fs.mkdirSync(phasesDir, { recursive: true })

      await fsp.writeFile(
        path.join(runDir, 'state.json'),
        JSON.stringify(
          {
            run_id: runId,
            branch_name: branchName,
            state: 'STOPPED_ABORTED',
            final_status: 'failed',
            failure_reason: 'Run aborted from terminal control command.',
            failed_phase: 'analysis',
          },
          null,
          2,
        ),
        'utf8',
      )
      await fsp.writeFile(
        path.join(runDir, 'conversation-state.json'),
        JSON.stringify(
          {
            interaction_model: 'conversational',
            conversation_state: 'aborted',
            control_state: 'aborted',
            active_phase: 'analysis',
            active_session_id: 'session-123',
            active_command: 'npm run lint',
            active_command_phase: 'baseline_verification',
            active_command_started_at: '2026-03-06T11:59:00.000Z',
            pending_replan: true,
            pending_steering_messages: [{ text: 'Refocus on retries.', source: 'terminal', timestamp: '2026-03-06T12:00:00.000Z' }],
            applied_steering_messages: [],
            waiting_state: 'paused',
            waiting_phase: 'analysis',
            waiting_detail: 'Paused before replaying analysis with updated steering.',
            waiting_started_at: '2026-03-06T12:00:00.500Z',
            terminal_broker_state: 'active',
            live_interaction_supported: false,
            live_interaction_mode: 'interrupt-replay',
            live_interaction_summary:
              'True live in-place steering is unavailable on this Codex CLI; using interrupt-and-replay.',
            live_interaction_blockers: [
              'exec_has_no_documented_live_input_channel',
              'resume_missing_output_schema',
              'resume_missing_sandbox',
              'resume_missing_cd',
            ],
            live_interaction_checked_at: '2026-03-06T11:58:30.000Z',
            live_interaction_cli_version: 'codex-cli 0.111.0',
            last_control_command: 'abort',
            last_control_at: '2026-03-06T12:00:01.000Z',
            abort_reason: 'Run aborted from terminal control command.',
          },
          null,
          2,
        ),
        'utf8',
      )
      await fsp.writeFile(
        path.join(phasesDir, 'output.json'),
        JSON.stringify({
          gate: {
            status: 'needs_user_input',
            reasons: ['Need confirmation on retry budget.'],
            questions: ['Should retries stay capped at 3?'],
          },
        }),
        'utf8',
      )

      process.chdir(tmpDir)
      const { statusCommand, explainCommand } = await import('../lib/run.mjs')
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})

      await statusCommand({ run_id: runId })
      const statusOutput = logSpy.mock.calls.map((call) => call.join(' ')).join('\n')
      expect(statusOutput).toContain('"state": "STOPPED_ABORTED"')
      expect(statusOutput).toContain('Conversation control:')
      expect(statusOutput).toContain('control_state: aborted')
      expect(statusOutput).toContain('pending_replan: yes')
      expect(statusOutput).toContain('active_session_id: session-123')
      expect(statusOutput).toContain('active_command: npm run lint')
      expect(statusOutput).toContain('waiting_state: paused')
      expect(statusOutput).toContain('terminal_broker_state: active')
      expect(statusOutput).toContain('live_interaction_supported: no')
      expect(statusOutput).toContain('live_interaction_mode: interrupt-replay')
      expect(statusOutput).toContain('live_interaction_blockers: exec_has_no_documented_live_input_channel, resume_missing_output_schema, resume_missing_sandbox, resume_missing_cd')

      logSpy.mockClear()

      await explainCommand({ run_id: runId })
      const explainOutput = logSpy.mock.calls.map((call) => call.join(' ')).join('\n')
      expect(explainOutput).toContain('Gate summary')
      expect(explainOutput).toContain('Conversation control:')
      expect(explainOutput).toContain('last_control_command: abort')
      expect(explainOutput).toContain('waiting_detail: Paused before replaying analysis with updated steering.')
      expect(explainOutput).toContain('live_interaction_summary: True live in-place steering is unavailable on this Codex CLI; using interrupt-and-replay.')
      expect(explainOutput).toContain('Failure diagnostics:')
      expect(explainOutput).toContain('failed_phase: analysis')

      logSpy.mockRestore()
    } finally {
      process.chdir(previousCwd)
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
