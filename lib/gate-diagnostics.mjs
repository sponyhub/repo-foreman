import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { fileExists, readJsonFile } from './fs.mjs'
import {
  findInvalidArchitectureDocsToUpdateEntries,
  findMissingArchitectureDocsToUpdate,
} from './task-graph-coverage.mjs'
import { findMissingArchitectureDecisionCoverage } from './task-graph-traceability.mjs'
import { extractQuestionTexts } from './questions.mjs'

function normalizeStringList(items) {
  if (!Array.isArray(items)) {
    return []
  }
  const out = []
  for (const item of items) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    out.push(trimmed)
  }
  return out
}

export async function collectGateSummaries({ runDir }) {
  const phasesDir = path.join(runDir, 'phases')
  if (!(await fileExists(phasesDir))) {
    return []
  }

  const entries = await readdir(phasesDir, { withFileTypes: true })
  const summaries = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const outputPath = path.join(phasesDir, entry.name, 'output.json')
    if (!(await fileExists(outputPath))) continue

    let output = null
    try {
      output = await readJsonFile(outputPath)
    } catch {
      continue
    }

    const gate = output?.gate
    if (!gate || typeof gate.status !== 'string') continue

    summaries.push({
      phase: entry.name,
      status: gate.status,
      reasons: normalizeStringList(gate.reasons),
      questions: extractQuestionTexts(gate.questions),
    })
  }

  summaries.sort((a, b) => a.phase.localeCompare(b.phase))
  return summaries
}

export function formatGateSummaries(summaries) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return []
  }

  const lines = []
  for (const summary of summaries) {
    lines.push(`phase:${summary.phase} status=${summary.status}`)
    for (const reason of summary.reasons ?? []) {
      lines.push(`  reason: ${reason}`)
    }
    for (const question of summary.questions ?? []) {
      lines.push(`  question: ${question}`)
    }
  }
  return lines
}

function normalizeIssueIds(items) {
  if (!Array.isArray(items)) {
    return []
  }
  const ids = []
  for (const item of items) {
    if (typeof item?.id !== 'string') continue
    const trimmed = item.id.trim()
    if (!trimmed) continue
    ids.push(trimmed)
  }
  return ids
}

function extractArtifactCandidatesFromText(text) {
  if (typeof text !== 'string') {
    return []
  }

  const candidates = new Set()
  const backtickPattern = /`([^`]+)`/g
  let match = null
  while ((match = backtickPattern.exec(text)) !== null) {
    const candidate = match[1]?.trim()
    if (!candidate) continue
    if (candidate.includes('/') || candidate.includes('.md') || candidate.includes('.env')) {
      candidates.add(candidate)
    }
  }

  return Array.from(candidates)
}

function isLikelyPath(text) {
  if (typeof text !== 'string') {
    return false
  }
  const trimmed = text.trim()
  if (!trimmed || /\s/.test(trimmed)) {
    return false
  }
  return trimmed.startsWith('.') || trimmed.includes('/') || /\.[A-Za-z0-9]+$/.test(trimmed)
}

function extractMissingArtifacts(review) {
  const artifacts = new Set()
  for (const item of normalizeStringList(review?.docs_impact)) {
    if (isLikelyPath(item)) {
      artifacts.add(item)
    }
    for (const candidate of extractArtifactCandidatesFromText(item)) {
      artifacts.add(candidate)
    }
  }

  const issues = Array.isArray(review?.blocking_issues) ? review.blocking_issues : []
  for (const issue of issues) {
    for (const value of [issue?.file, issue?.description, issue?.suggested_fix]) {
      for (const candidate of extractArtifactCandidatesFromText(value)) {
        artifacts.add(candidate)
      }
    }
  }

  return Array.from(artifacts)
}

async function readLatestReviewOutput(reviewDir) {
  const attemptsDir = path.join(reviewDir, 'attempts')
  if (!(await fileExists(attemptsDir))) {
    return null
  }

  const entries = await readdir(attemptsDir, { withFileTypes: true })
  const attempts = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => Number.parseInt(entry.name, 10))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)
  if (attempts.length === 0) {
    return null
  }

  const latestPath = path.join(attemptsDir, String(attempts[0]), 'output.json')
  if (!(await fileExists(latestPath))) {
    return null
  }
  try {
    return await readJsonFile(latestPath)
  } catch {
    return null
  }
}

export async function collectLatestReviewSummaries({ runDir }) {
  const phasesDir = path.join(runDir, 'phases')
  if (!(await fileExists(phasesDir))) {
    return []
  }

  const entries = await readdir(phasesDir, { withFileTypes: true })
  const summaries = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.endsWith('_review')) continue

    const reviewOutput = await readLatestReviewOutput(path.join(phasesDir, entry.name))
    if (!reviewOutput) continue

    const verdict = typeof reviewOutput?.verdict === 'string' ? reviewOutput.verdict : ''
    if (verdict === 'approve') continue

    summaries.push({
      phase: entry.name,
      verdict,
      issueIds: normalizeIssueIds(reviewOutput?.blocking_issues),
      missingArtifacts: extractMissingArtifacts(reviewOutput),
    })
  }

  summaries.sort((a, b) => a.phase.localeCompare(b.phase))
  return summaries
}

export function formatReviewSummaries(summaries) {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return []
  }

  const lines = []
  for (const summary of summaries) {
    lines.push(`review:${summary.phase} verdict=${summary.verdict}`)
    if (summary.issueIds.length > 0) {
      lines.push(`  issue_ids: ${summary.issueIds.join(', ')}`)
    }
    if (summary.missingArtifacts.length > 0) {
      lines.push(`  missing_artifacts: ${summary.missingArtifacts.join(', ')}`)
    }
  }
  return lines
}

export async function collectTaskGraphCoverageDiagnostics({ runDir }) {
  const architecturePath = path.join(runDir, 'phases', 'architecture', 'output.json')
  const taskGraphPath = path.join(runDir, 'phases', 'task_graph', 'output.json')
  if (!(await fileExists(architecturePath)) || !(await fileExists(taskGraphPath))) {
    return { missingDocsToUpdate: [], missingDecisionCoverage: [], invalidDocsToUpdate: [] }
  }

  let architecture = null
  let taskGraph = null
  try {
    architecture = await readJsonFile(architecturePath)
    taskGraph = await readJsonFile(taskGraphPath)
  } catch {
    return { missingDocsToUpdate: [], missingDecisionCoverage: [], invalidDocsToUpdate: [] }
  }

  return {
    missingDocsToUpdate: findMissingArchitectureDocsToUpdate({ architecture, taskGraph }),
    missingDecisionCoverage: findMissingArchitectureDecisionCoverage({ architecture, taskGraph }),
    invalidDocsToUpdate: findInvalidArchitectureDocsToUpdateEntries(architecture),
  }
}
