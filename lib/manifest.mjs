import { createRequire } from 'node:module'
import { writeJsonFile } from './fs.mjs'
import { extractQuestionTexts } from './questions.mjs'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json')

export const ORCHESTRATOR_VERSION = packageJson.version
export const DEFAULT_MODEL = 'gpt-5.6-sol'
export const DEFAULT_MODEL_REASONING_EFFORT = 'xhigh'
export const BRANCH_NAME_REASONING_EFFORT = 'low'

export function createManifest({
  runId,
  mode,
  reviewMode,
  createdAt,
  baseSha,
  branchName,
  worktreePath,
  taskSource,
  policyPreset,
  policyFilePath,
  runtimeConfig,
}) {
  const resolvedRuntimeConfig = {
    ...(runtimeConfig ?? {}),
    model: runtimeConfig?.model ?? DEFAULT_MODEL,
    reasoning_effort: runtimeConfig?.reasoning_effort ?? DEFAULT_MODEL_REASONING_EFFORT,
  }

  return {
    run_id: runId,
    version: ORCHESTRATOR_VERSION,
    mode,
    review_mode: reviewMode,
    created_at: createdAt,
    base_sha: baseSha,
    branch_name: branchName,
    worktree_path: worktreePath ?? null,
    model: resolvedRuntimeConfig.model,
    model_reasoning_effort: resolvedRuntimeConfig.reasoning_effort,
    task_source: taskSource,
    policy: {
      preset: policyPreset,
      file_path: policyFilePath ?? null,
    },
    runtime_config: resolvedRuntimeConfig,
    phases: {},
    assumptions: [],
    mitigations: [],
    task_hints: [],
    open_questions: [],
  }
}

export function updatePhase(manifest, phaseName, patch) {
  manifest.phases[phaseName] = {
    ...(manifest.phases[phaseName] ?? {}),
    ...patch,
  }
}

export function addAssumptions(manifest, assumptions) {
  for (const assumption of assumptions ?? []) {
    if (typeof assumption === 'string' && assumption.trim() && !manifest.assumptions.includes(assumption)) {
      manifest.assumptions.push(assumption)
    }
  }
}

export function addMitigations(manifest, mitigations) {
  for (const mitigation of mitigations ?? []) {
    if (typeof mitigation === 'string' && mitigation.trim() && !manifest.mitigations.includes(mitigation)) {
      manifest.mitigations.push(mitigation)
    }
  }
}

export function addTaskHints(manifest, taskHints) {
  for (const taskHint of taskHints ?? []) {
    if (typeof taskHint === 'string' && taskHint.trim() && !manifest.task_hints.includes(taskHint)) {
      manifest.task_hints.push(taskHint)
    }
  }
}

export function addOpenQuestions(manifest, questions) {
  const normalizedQuestions = extractQuestionTexts(questions)
  for (const question of normalizedQuestions) {
    if (!manifest.open_questions.includes(question)) {
      manifest.open_questions.push(question)
    }
  }
}

export async function writeManifest(manifestPath, manifest) {
  await writeJsonFile(manifestPath, manifest)
}
