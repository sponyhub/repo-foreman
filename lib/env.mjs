const DEFAULT_INCLUDE_ONLY = Object.freeze([
  'PATH',
  'HOME',
  'CI',
  'NODE_ENV',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'TMPDIR',
  'PWD',
  'TZ',
  'XDG_CONFIG_HOME',
  'CODEX_HOME',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'npm_config_user_agent',
])

const DEFAULT_INCLUDE_PREFIXES = Object.freeze([])

export function buildCodexSubprocessEnv(
  baseEnv = process.env,
  { includeOnly = DEFAULT_INCLUDE_ONLY, includePrefixes = DEFAULT_INCLUDE_PREFIXES } = {},
) {
  const env = {}
  for (const key of includeOnly) {
    if (baseEnv[key] != null) {
      env[key] = String(baseEnv[key])
    }
  }

  const prefixes = Array.isArray(includePrefixes) ? includePrefixes : []
  for (const [key, value] of Object.entries(baseEnv ?? {})) {
    if (value == null || key in env) {
      continue
    }
    if (!prefixes.some((prefix) => typeof prefix === 'string' && prefix.length > 0 && key.startsWith(prefix))) {
      continue
    }
    env[key] = String(value)
  }

  return env
}
