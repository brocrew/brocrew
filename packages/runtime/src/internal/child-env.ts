/**
 * The **allow-list** of runtime essentials copied from the inherited environment
 * into a provider child (026, fixing 023 P1-G). A denylist can't enumerate every
 * ambient secret — `*_TOKEN`, `*_KEY`, `*_SECRET`, `ANTHROPIC_*`, `OPENAI_*`,
 * `AWS_*`, `GITHUB_*`, `GOOGLE_*`/`GCP_*`, `CLAUDE_CODE_OAUTH_TOKEN`, an ssh-agent
 * socket, … — so the child starts from ONLY these keys and the caller layers the
 * intended provider vars (per-profile home + the 022 token) explicitly via `add`.
 * Each entry is a deliberate runtime need, not a convenience:
 */
export const ESSENTIAL_ENV_KEYS = new Set<string>([
  'PATH', // locate node / the claude & codex CLIs and any Bash-tool binaries
  'HOME', // OS home dir (the per-profile provider home is pinned separately via `add`)
  'SHELL', // the Bash tool needs a login shell
  'USER', // process identity some tools/CLIs read
  'LOGNAME', // process identity (portable alias of USER)
  // Locale — an EXPLICIT set of the POSIX locale categories, never an `LC_` prefix wildcard
  // (040, fixing 036 P1-G): a wildcard also carried a secret-shaped `LC_GITHUB_TOKEN` straight
  // through the allow-list. These are the only real locale vars, and none is credential-shaped.
  'LANG', // locale
  'LANGUAGE', // locale (GNU gettext preference list)
  'LC_ALL',
  'LC_CTYPE',
  'LC_COLLATE',
  'LC_MESSAGES',
  'LC_MONETARY',
  'LC_NUMERIC',
  'LC_TIME',
  'LC_PAPER',
  'LC_ADDRESS',
  'LC_TELEPHONE',
  'LC_MEASUREMENT',
  'LC_IDENTIFICATION',
  'LC_NAME',
  'TZ', // timezone for timestamps
  'TERM', // terminal type for TTY-aware output
  'TERMINFO', // terminfo database location for TERM
  'TMPDIR', // temp dir (Unix)
  'TMP', // temp dir (fallback)
  'TEMP', // temp dir (fallback)
  'HTTP_PROXY', // egress proxy (deliberately kept so isolation doesn't break corporate egress)
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy',
  'SSL_CERT_FILE', // TLS trust anchors (kept so custom CAs still validate)
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'CURL_CA_BUNDLE',
  'GIT_SSL_CAINFO',
])

/**
 * ⚑ **F072 — what a program needs on Windows**, which none of the names above provide there:
 * without `SystemRoot` a Windows program cannot load its system libraries or reach the network;
 * `USERPROFILE`, `APPDATA` and `LOCALAPPDATA` are its home; `PATHEXT` and `ComSpec` are how a
 * command is found and run; and `CLAUDE_CODE_GIT_BASH_PATH` is how the Claude CLI finds the Git Bash
 * its Bash tool runs in. None is credential-shaped, and the veto below still runs over them.
 * Written upper-case, as {@link isEssential} compares on Windows.
 */
export const WINDOWS_ESSENTIAL_ENV_KEYS = new Set<string>([
  'SYSTEMROOT',
  'WINDIR',
  'SYSTEMDRIVE',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'COMMONPROGRAMFILES(X86)',
  'HOMEDRIVE',
  'HOMEPATH',
  'USERNAME',
  'USERDOMAIN',
  'COMSPEC',
  'PATHEXT',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
  'CLAUDE_CODE_GIT_BASH_PATH',
])

/** {@link ESSENTIAL_ENV_KEYS}, upper-cased, for Windows' case-blind names. */
const ESSENTIAL_UPPER = new Set([...ESSENTIAL_ENV_KEYS].map((key) => key.toUpperCase()))

/**
 * ⚑ **F072 — on Windows a variable's name has no case**: the system spells the search path `Path`,
 * and a child handed no `Path` finds no program at all. So there a name is compared upper-cased, and
 * Windows' own essentials join the list; elsewhere the comparison stays exact.
 */
function isEssential(key: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return ESSENTIAL_ENV_KEYS.has(key)
  const upper = key.toUpperCase()
  return ESSENTIAL_UPPER.has(upper) || WINDOWS_ESSENTIAL_ENV_KEYS.has(upper)
}

/**
 * Credential-shaped name fragments. Any INHERITED key containing one of these (case-insensitive)
 * is vetoed no matter what the allow-list says (040, fixing 036 P1-G) — a name rule a prefix
 * wildcard must never be able to override. Defense-in-depth: the allow-list above is explicit and
 * finite, so nothing should reach this today; the veto is what keeps a future entry (or a prefix
 * rule someone re-adds) from silently carrying a secret into the agent and its subprocesses.
 *
 * `PASS` subsumes `PASSWORD`/`PASSWD`/`PASSPHRASE`/`DB_PASS` (the explicit forms are kept for
 * readability). Deliberately ABSENT because they would veto a legitimate essential: `PAT` (matches
 * `PATH`) and `CERT` (matches `SSL_CERT_FILE`/`NODE_EXTRA_CA_CERTS`) — the
 * `veto never strips an essential` test below is the standing guard against exactly that mistake.
 */
const SECRET_NAME_FRAGMENTS = [
  'TOKEN',
  'KEY',
  'SECRET',
  'PASS', // subsumes PASSWORD / PASSWD / PASSPHRASE
  'PASSWORD',
  'PASSWD',
  'CREDENTIAL',
  'AUTH',
  'SESSION',
  'BEARER',
  'PRIVATE',
  'SIGNATURE',
  'COOKIE',
]

/** True when a key NAME looks like it carries a credential (case-insensitive substring match). */
function isSecretName(key: string): boolean {
  const upper = key.toUpperCase()
  return SECRET_NAME_FRAGMENTS.some((fragment) => upper.includes(fragment))
}

/**
 * Build a sanitized environment for a provider child process as an **allow-list**
 * (026, from the 015/021 isolation policy). Copies from `base` (default
 * `process.env`) ONLY the {@link ESSENTIAL_ENV_KEYS} runtime essentials — **every
 * other inherited variable is dropped**, so no ambient credential can pass through
 * to the agent or its Bash/hook/MCP subprocesses. Then layers the intended provider
 * vars in `add` (the per-profile `CLAUDE_CONFIG_DIR`/`CODEX_HOME` and the Claude
 * login token) — the ONLY way a token or home reaches the child. The Claude CLI then
 * keeps that token out of what its own subprocesses inherit, which `pnpm run probe:token-reach`
 * measures.
 *
 * **Ordering matters (040, fixing 036 P1-G).** The {@link isSecretName} veto runs over the
 * INHERITED, allow-listed result only; `add` is layered **after** it. So a credential-shaped
 * ambient var can never survive, while the *intended* provider token (022's
 * `CLAUDE_CODE_OAUTH_TOKEN` from the Keychain bridge) still crosses — it is supplied
 * deliberately by the caller, not inherited.
 *
 * Returns a NEW object — the parent `process.env` is never mutated, so provider
 * vars live only on the child and concurrent profiles can't race on a shared
 * global (015 environment policy).
 */
export function buildChildEnv(
  add: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
  /** ⚑ **F072** — whose naming rules apply ({@link isEssential}); a seam for tests. */
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    // Allow-list first, then the credential-name veto — a name rule the allow-list cannot override.
    if (value === undefined || !isEssential(key, platform) || isSecretName(key)) continue
    env[key] = value
  }
  // `add` is layered AFTER the veto: the intended provider token is never stripped.
  return Object.assign(env, add)
}
