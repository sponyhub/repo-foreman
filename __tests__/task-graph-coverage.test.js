/**
 * @jest-environment node
 */

describe('task graph coverage against architecture docs', () => {
  test('detects docs_to_update paths that are missing in task file lists', async () => {
    const { findMissingArchitectureDocsToUpdate } = await import('../lib/task-graph-coverage.mjs')

    const architecture = {
      docs_to_update: ['README.md', 'docs/infra/dev-environment.md', '.env.example'],
    }
    const taskGraph = {
      tasks: [
        {
          id: 'T1',
          files: {
            create: [],
            modify: ['README.md'],
            delete: [],
          },
        },
      ],
    }

    const missing = findMissingArchitectureDocsToUpdate({ architecture, taskGraph })
    expect(missing).toEqual(['docs/infra/dev-environment.md', '.env.example'])
  })

  test('returns empty list when all architecture docs are covered by task files', async () => {
    const { findMissingArchitectureDocsToUpdate } = await import('../lib/task-graph-coverage.mjs')

    const architecture = {
      docs_to_update: ['README.md', 'docs/infra/dev-environment.md', '.env.example'],
    }
    const taskGraph = {
      tasks: [
        {
          id: 'T1',
          files: {
            create: [],
            modify: ['README.md', 'docs/infra/dev-environment.md'],
            delete: [],
          },
        },
        {
          id: 'T2',
          files: {
            create: [],
            modify: ['.env.example'],
            delete: [],
          },
        },
      ],
    }

    const missing = findMissingArchitectureDocsToUpdate({ architecture, taskGraph })
    expect(missing).toEqual([])
  })

  test('normalizes descriptive docs_to_update entries to file paths while strict validator flags them', async () => {
    const {
      collectArchitectureDocsToUpdate,
      findInvalidArchitectureDocsToUpdateEntries,
      findMissingArchitectureDocsToUpdate,
    } = await import(
      '../lib/task-graph-coverage.mjs'
    )

    const architecture = {
      docs_to_update: [
        'README.md (feature behavior and limits).',
        '`docs/security-overview.md` add AI guard chain notes.',
        { path: 'docs/compliance/dpa-register.md', reason: 'processor onboarding' },
      ],
    }
    const taskGraph = {
      tasks: [
        {
          id: 'T1',
          files: {
            create: [],
            modify: ['README.md', 'docs/security-overview.md'],
            delete: [],
          },
        },
      ],
    }

    expect(collectArchitectureDocsToUpdate(architecture)).toEqual([
      'README.md',
      'docs/security-overview.md',
      'docs/compliance/dpa-register.md',
    ])
    expect(findInvalidArchitectureDocsToUpdateEntries(architecture)).toEqual([
      'README.md (feature behavior and limits).',
      '`docs/security-overview.md` add AI guard chain notes.',
      '{"path":"docs/compliance/dpa-register.md","reason":"processor onboarding"}',
    ])
    expect(findMissingArchitectureDocsToUpdate({ architecture, taskGraph })).toEqual([
      'docs/compliance/dpa-register.md',
    ])
  })

  test('reports invalid docs_to_update entries that cannot be normalized', async () => {
    const { findInvalidArchitectureDocsToUpdateEntries } = await import('../lib/task-graph-coverage.mjs')

    const architecture = {
      docs_to_update: ['update privacy policy docs', '', null, { reason: 'missing path' }],
    }

    expect(findInvalidArchitectureDocsToUpdateEntries(architecture)).toEqual([
      'update privacy policy docs',
      '',
      'null',
      '{"reason":"missing path"}',
    ])
  })
})
