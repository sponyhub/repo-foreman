import path from 'node:path'
import {
  defaultMaxReviewFixAttemptsForMode,
  executionProfileForReviewMode,
  normalizeExecutionProfile,
  normalizeReviewMode,
  reviewModeForExecutionProfile,
} from './review-mode.mjs'
import { normalizeReviewerIndependenceMode } from './reviewer-independence.mjs'

const DEFAULT_VERIFICATION_COMMAND = 'npm test'
const ALLOWED_REASONING_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const ALLOWED_SANDBOX_MODES = new Set(['read-only', 'workspace-write', 'danger-full-access'])
const SAFE_RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/

const BOOLEAN_FLAGS = new Set([
  '--search',
  '--no-search',
  '--coverage',
  '--audit',
  '--dry-run',
  '--no-redact',
  '--verbose',
  '--pretty-events',
  '--force',
  '--no-commit',
  '--autostash',
  '--worktree',
  '--no-worktree',
  '--unsafe-host-access',
  '--copy-env-files',
  '--help',
  '-h',
])

const VALUE_FLAGS = new Set([
  '--task',
  '--task-file',
  '--run-id',
  '--codex-bin',
  '--model',
  '--effort',
  '--sandbox',
  '--branch-name-strategy',
  '--max-task-graph-attempts',
  '--max-worker-attempts',
  '--max-fix-attempts',
  '--max-review-fix-attempts',
  '--max-review-diff-growth-lines',
  '--prompt-json-max-chars',
  '--tests',
  '--task-tests',
  '--final-tests',
  '--coverage-floor',
  '--policy',
  '--policy-file',
  '--policy-allowlist-mode',
  '--mode',
  '--interaction-model',
  '--execution-profile',
  '--review-mode',
  '--reviewer-independence',
  '--answers-mode',
  '--git-author-name',
  '--git-author-email',
  '--task-graph-max-files-per-task',
  '--task-graph-max-acceptance-criteria-per-task',
  '--task-graph-max-description-chars',
  '--task-graph-max-verification-commands-per-task',
  '--worktree-deps',
  '--promotion-sample-size',
])

export function parseArgs(argv) {
  const args = [...argv]
  const command = args.shift()

  if (!command || command.startsWith('-')) {
    return { command: 'help', options: {} }
  }

  const options = {}
  while (args.length > 0) {
    const token = args.shift()
    if (BOOLEAN_FLAGS.has(token)) {
      if (token === '--help' || token === '-h') {
        options.help = true
      } else {
        options[flagKey(token)] = true
      }
      continue
    }
    if (VALUE_FLAGS.has(token)) {
      const value = args.shift()
      if (value == null) {
        throw new Error(`Missing value for ${token}`)
      }
      options[flagKey(token)] = value
      continue
    }
    throw new Error(`Unknown option: ${token}`)
  }

  normalizeOptions(command, options)
  return { command, options }
}

function flagKey(flag) {
  return flag.replace(/^--/, '').replaceAll('-', '_')
}

function normalizeOptions(command, options) {
  options.command = command
  const runningInCi = isCiEnvironment()
  const explicitTests = options.tests != null
  const explicitFinalTests = options.final_tests != null

  const explicitSearch = Boolean(options.search)
  const explicitNoSearch = Boolean(options.no_search)
  if (explicitSearch && explicitNoSearch) {
    throw new Error('Use only one of --search or --no-search')
  }
  if (explicitNoSearch) {
    options.search = false
  } else if (explicitSearch) {
    options.search = true
  } else {
    options.search = false
  }

  if (options.task_file) {
    options.task_file = path.resolve(options.task_file)
  }
  if (options.policy_file) {
    options.policy_file = path.resolve(options.policy_file)
  }
  if (options.codex_bin) {
    options.codex_bin = options.codex_bin.trim()
  } else {
    options.codex_bin = 'codex'
  }

  if (options.run_id != null && !SAFE_RUN_ID_PATTERN.test(String(options.run_id))) {
    throw new Error('--run-id must be 1-80 ASCII letters, numbers, underscores, or hyphens and may not contain path separators')
  }

  if (options.model != null) {
    options.model = String(options.model).trim()
    if (!options.model) {
      throw new Error('--model must be a non-empty model identifier')
    }
  }
  if (options.effort != null) {
    options.effort = String(options.effort).trim().toLowerCase()
    if (!ALLOWED_REASONING_EFFORTS.has(options.effort)) {
      throw new Error('--effort must be minimal|low|medium|high|xhigh|max|ultra')
    }
  }
  if (options.sandbox == null) {
    options.sandbox = 'workspace-write'
  }
  if (!ALLOWED_SANDBOX_MODES.has(options.sandbox)) {
    throw new Error('--sandbox must be read-only|workspace-write|danger-full-access')
  }
  if (options.sandbox === 'danger-full-access' && !options.unsafe_host_access) {
    throw new Error('--sandbox danger-full-access requires explicit --unsafe-host-access acknowledgement')
  }
  if (options.unsafe_host_access) {
    options.sandbox = 'danger-full-access'
  }

  if (!options.branch_name_strategy) {
    options.branch_name_strategy = 'opaque'
  }
  if (!['opaque', 'codex', 'heuristic'].includes(options.branch_name_strategy)) {
    throw new Error('--branch-name-strategy must be opaque|heuristic|codex')
  }

  if (options.max_fix_attempts != null) {
    options.max_fix_attempts = parseInt(options.max_fix_attempts, 10)
    if (!Number.isFinite(options.max_fix_attempts) || options.max_fix_attempts < 0) {
      throw new Error('--max-fix-attempts must be a non-negative integer')
    }
  } else {
    options.max_fix_attempts = 5
  }

  if (options.max_task_graph_attempts != null) {
    options.max_task_graph_attempts = parseInt(options.max_task_graph_attempts, 10)
    if (!Number.isFinite(options.max_task_graph_attempts) || options.max_task_graph_attempts < 1) {
      throw new Error('--max-task-graph-attempts must be a positive integer')
    }
  } else {
    options.max_task_graph_attempts = 7
  }

  if (options.max_worker_attempts != null) {
    options.max_worker_attempts = parseInt(options.max_worker_attempts, 10)
    if (!Number.isFinite(options.max_worker_attempts) || options.max_worker_attempts < 1) {
      throw new Error('--max-worker-attempts must be a positive integer')
    }
  } else {
    options.max_worker_attempts = 3
  }

  if (options.max_review_fix_attempts != null) {
    options.max_review_fix_attempts = parseInt(options.max_review_fix_attempts, 10)
    if (!Number.isFinite(options.max_review_fix_attempts) || options.max_review_fix_attempts < 0) {
      throw new Error('--max-review-fix-attempts must be a non-negative integer')
    }
  }

  if (options.max_review_diff_growth_lines != null) {
    options.max_review_diff_growth_lines = parseInt(options.max_review_diff_growth_lines, 10)
    if (!Number.isFinite(options.max_review_diff_growth_lines) || options.max_review_diff_growth_lines < 0) {
      throw new Error('--max-review-diff-growth-lines must be a non-negative integer')
    }
  } else {
    options.max_review_diff_growth_lines = 1200
  }

  if (options.prompt_json_max_chars != null) {
    options.prompt_json_max_chars = parseInt(options.prompt_json_max_chars, 10)
    if (!Number.isFinite(options.prompt_json_max_chars) || options.prompt_json_max_chars < 1) {
      throw new Error('--prompt-json-max-chars must be a positive integer')
    }
  }

  if (options.task_graph_max_files_per_task != null) {
    options.task_graph_max_files_per_task = parseInt(options.task_graph_max_files_per_task, 10)
    if (!Number.isFinite(options.task_graph_max_files_per_task) || options.task_graph_max_files_per_task < 0) {
      throw new Error('--task-graph-max-files-per-task must be a non-negative integer')
    }
  }

  if (options.task_graph_max_acceptance_criteria_per_task != null) {
    options.task_graph_max_acceptance_criteria_per_task = parseInt(options.task_graph_max_acceptance_criteria_per_task, 10)
    if (
      !Number.isFinite(options.task_graph_max_acceptance_criteria_per_task) ||
      options.task_graph_max_acceptance_criteria_per_task < 0
    ) {
      throw new Error('--task-graph-max-acceptance-criteria-per-task must be a non-negative integer')
    }
  }

  if (options.task_graph_max_description_chars != null) {
    options.task_graph_max_description_chars = parseInt(options.task_graph_max_description_chars, 10)
    if (!Number.isFinite(options.task_graph_max_description_chars) || options.task_graph_max_description_chars < 0) {
      throw new Error('--task-graph-max-description-chars must be a non-negative integer')
    }
  }

  if (options.task_graph_max_verification_commands_per_task != null) {
    options.task_graph_max_verification_commands_per_task = parseInt(
      options.task_graph_max_verification_commands_per_task,
      10,
    )
    if (
      !Number.isFinite(options.task_graph_max_verification_commands_per_task) ||
      options.task_graph_max_verification_commands_per_task < 0
    ) {
      throw new Error('--task-graph-max-verification-commands-per-task must be a non-negative integer')
    }
  }

  if (options.coverage_floor != null) {
    options.coverage_floor = parseInt(options.coverage_floor, 10)
    if (!Number.isFinite(options.coverage_floor) || options.coverage_floor < 0) {
      throw new Error('--coverage-floor must be a non-negative integer')
    }
  } else {
    options.coverage_floor = 40
  }

  if (!options.tests) {
    options.tests = 'npm test'
  }

  if (options.task_tests) {
    options.task_tests = options.task_tests.trim()
  }
  if (options.final_tests) {
    options.final_tests = options.final_tests.trim()
  }
  if (runningInCi && !explicitTests && !explicitFinalTests) {
    options.final_tests = DEFAULT_VERIFICATION_COMMAND
  }
  options.task_tests = options.task_tests || options.tests
  if (!options.final_tests) {
    options.final_tests = explicitTests ? options.tests : DEFAULT_VERIFICATION_COMMAND
  }

  if (!options.policy) {
    options.policy = 'strict'
  }
  if (!['strict', 'balanced', 'off'].includes(options.policy)) {
    throw new Error('--policy must be strict|balanced|off')
  }
  if (!options.policy_allowlist_mode) {
    options.policy_allowlist_mode = 'monitor'
  }
  if (!['off', 'monitor', 'enforce'].includes(options.policy_allowlist_mode)) {
    throw new Error('--policy-allowlist-mode must be off|monitor|enforce')
  }

  if (!options.mode) {
    options.mode = 'autonomous'
  }
  if (!['autonomous', 'interactive'].includes(options.mode)) {
    throw new Error('--mode must be autonomous|interactive')
  }

  if (!options.interaction_model) {
    options.interaction_model = 'phased'
  }
  if (!['phased', 'conversational'].includes(options.interaction_model)) {
    throw new Error('--interaction-model must be phased|conversational')
  }

  if (runningInCi && options.coverage == null) {
    options.coverage = true
  }
  if (runningInCi && options.audit == null) {
    options.audit = true
  }

  if (options.verbose == null) {
    options.verbose = true
  }
  if (options.pretty_events == null) {
    options.pretty_events = true
  }

  const hasExplicitExecutionProfile = options.execution_profile != null
  const hasExplicitReviewMode = options.review_mode != null

  if (hasExplicitExecutionProfile) {
    try {
      options.execution_profile = normalizeExecutionProfile(options.execution_profile)
    } catch {
      throw new Error('--execution-profile must be fast|standard|strict')
    }
    const mappedReviewMode = reviewModeForExecutionProfile(options.execution_profile)
    if (hasExplicitReviewMode) {
      const normalizedReviewMode = normalizeReviewMode(options.review_mode)
      if (mappedReviewMode !== normalizedReviewMode) {
        throw new Error(
          `--execution-profile ${options.execution_profile} maps to --review-mode ${mappedReviewMode}, but got ${normalizedReviewMode}`,
        )
      }
      options.review_mode = normalizedReviewMode
    } else {
      options.review_mode = mappedReviewMode
    }
  } else {
    options.review_mode = normalizeReviewMode(options.review_mode ?? (runningInCi ? 'strict' : undefined))
  }
  options.execution_profile = executionProfileForReviewMode(options.review_mode)
  if (options.max_review_fix_attempts == null) {
    options.max_review_fix_attempts = defaultMaxReviewFixAttemptsForMode(options.review_mode)
  }

  try {
    options.reviewer_independence = normalizeReviewerIndependenceMode(options.reviewer_independence)
  } catch {
    throw new Error('--reviewer-independence must be linked|isolated')
  }

  if (runningInCi && options.prompt_json_max_chars == null) {
    options.prompt_json_max_chars = 32000
  }

  if (!options.answers_mode) {
    options.answers_mode = 'auto'
  }
  if (!['auto', 'file', 'console'].includes(options.answers_mode)) {
    throw new Error('--answers-mode must be auto|file|console')
  }

  const explicitWorktree = Boolean(options.worktree)
  const explicitNoWorktree = Boolean(options.no_worktree)
  if (explicitWorktree && explicitNoWorktree) {
    throw new Error('Use only one of --worktree or --no-worktree')
  }
  if (explicitNoWorktree) {
    options.worktree = false
  } else if (explicitWorktree) {
    options.worktree = true
  } else {
    options.worktree = true
  }

  if (!options.worktree_deps) {
    options.worktree_deps = 'none'
  }
  if (!['auto', 'link', 'npm-ci', 'none'].includes(options.worktree_deps)) {
    throw new Error('--worktree-deps must be auto|link|npm-ci|none')
  }

  if (options.dry_run) {
    if (options.unsafe_host_access) {
      throw new Error('--dry-run cannot be combined with --unsafe-host-access')
    }
    if (options.copy_env_files) {
      throw new Error('--dry-run cannot be combined with --copy-env-files')
    }
    if (options.worktree_deps !== 'none') {
      throw new Error('--dry-run requires --worktree-deps none')
    }
    options.sandbox = 'read-only'
  }

  if (options.promotion_sample_size != null) {
    options.promotion_sample_size = parseInt(options.promotion_sample_size, 10)
    if (!Number.isFinite(options.promotion_sample_size) || options.promotion_sample_size < 1) {
      throw new Error('--promotion-sample-size must be a positive integer')
    }
  } else {
    options.promotion_sample_size = 30
  }
}

function isCiEnvironment() {
  const value = process.env.CI
  if (value == null) {
    return false
  }
  const normalized = String(value).trim().toLowerCase()
  if (!normalized) {
    return false
  }
  return !['0', 'false', 'no'].includes(normalized)
}
