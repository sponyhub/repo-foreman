/**
 * @jest-environment node
 */

const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs/promises')

describe('gate diagnostics', () => {
  test('collects gate summaries from phase outputs', async () => {
    const { collectGateSummaries } = await import('../lib/gate-diagnostics.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    const runDir = path.join(tmpDir, 'run')
    const phasesDir = path.join(runDir, 'phases')

    await fs.mkdir(path.join(phasesDir, 'analysis'), { recursive: true })
    await fs.writeFile(
      path.join(phasesDir, 'analysis', 'output.json'),
      JSON.stringify({ gate: { status: 'blocked', reasons: ['risk A'], questions: [] } }),
    )

    await fs.mkdir(path.join(phasesDir, 'architecture'), { recursive: true })
    await fs.writeFile(
      path.join(phasesDir, 'architecture', 'output.json'),
      JSON.stringify({ gate: { status: 'pass', reasons: [], questions: ['q1'] } }),
    )

    await fs.mkdir(path.join(phasesDir, 'question_capture'), { recursive: true })
    await fs.writeFile(path.join(phasesDir, 'question_capture', 'output.json'), JSON.stringify({ notes: [] }))

    const summaries = await collectGateSummaries({ runDir })

    expect(summaries).toHaveLength(2)
    expect(summaries[0]).toMatchObject({ phase: 'analysis', status: 'blocked', reasons: ['risk A'] })
    expect(summaries[1]).toMatchObject({ phase: 'architecture', status: 'pass', questions: ['q1'] })
  })

  test('formats gate summaries into readable lines', async () => {
    const { formatGateSummaries } = await import('../lib/gate-diagnostics.mjs')

    const lines = formatGateSummaries([
      { phase: 'analysis', status: 'blocked', reasons: ['risk A', 'risk B'], questions: [] },
    ])

    expect(lines.join('\n')).toContain('phase:analysis status=blocked')
    expect(lines.join('\n')).toContain('reason: risk A')
    expect(lines.join('\n')).toContain('reason: risk B')
  })

  test('collects unresolved review diagnostics with issue IDs and missing artifacts', async () => {
    const { collectLatestReviewSummaries } = await import('../lib/gate-diagnostics.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    const runDir = path.join(tmpDir, 'run')
    const reviewAttemptDir = path.join(runDir, 'phases', 'task_graph_review', 'attempts', '2')
    await fs.mkdir(reviewAttemptDir, { recursive: true })
    await fs.writeFile(
      path.join(reviewAttemptDir, 'output.json'),
      JSON.stringify({
        verdict: 'revise',
        blocking_issues: [
          {
            id: 'TG-123',
            description: 'Missing `.env.example` and `docs/infra/dev-environment.md` in docs task scope.',
            suggested_fix: 'Add `docs/infra/production-environment.md` to task files.',
          },
        ],
        docs_impact: ['.env.example'],
      }),
    )

    const summaries = await collectLatestReviewSummaries({ runDir })
    expect(summaries).toHaveLength(1)
    expect(summaries[0].phase).toBe('task_graph_review')
    expect(summaries[0].issueIds).toEqual(['TG-123'])
    expect(summaries[0].missingArtifacts).toEqual(
      expect.arrayContaining([
        '.env.example',
        'docs/infra/dev-environment.md',
        'docs/infra/production-environment.md',
      ]),
    )
  })

  test('collects task-graph coverage diagnostics for missing architecture docs', async () => {
    const { collectTaskGraphCoverageDiagnostics } = await import('../lib/gate-diagnostics.mjs')

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-orch-'))
    const runDir = path.join(tmpDir, 'run')
    const architectureDir = path.join(runDir, 'phases', 'architecture')
    const taskGraphDir = path.join(runDir, 'phases', 'task_graph')
    await fs.mkdir(architectureDir, { recursive: true })
    await fs.mkdir(taskGraphDir, { recursive: true })

    await fs.writeFile(
      path.join(architectureDir, 'output.json'),
      JSON.stringify({
        docs_to_update: ['README.md (release notes)', '`docs/infra/dev-environment.md`', '.env.example'],
        decisions: [{ id: 'D1' }, { id: 'D2' }],
      }),
    )
    await fs.writeFile(
      path.join(taskGraphDir, 'output.json'),
      JSON.stringify({
        tasks: [
          {
            files: { create: [], modify: ['README.md'], delete: [] },
            description: 'Trace D1',
            acceptance_criteria: [],
          },
          { files: { create: [], modify: ['.env.example'], delete: [] } },
        ],
      }),
    )

    const diagnostics = await collectTaskGraphCoverageDiagnostics({ runDir })
    expect(diagnostics.missingDocsToUpdate).toEqual(['docs/infra/dev-environment.md'])
    expect(diagnostics.missingDecisionCoverage).toEqual(['D2'])
    expect(diagnostics.invalidDocsToUpdate).toEqual([
      'README.md (release notes)',
      '`docs/infra/dev-environment.md`',
    ])
  })
})
