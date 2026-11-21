import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Claude's missing program, as a type, so callers choose the wording by type and never by matching
 * message text. The SDK's own `Error` for a missing native binary has no code or class. This error's
 * message is meant for a person (a class crossing the window's IPC loses its name); the SDK's text is
 * the `cause`. `CodexUnavailableError` is the same fact for Codex.
 */
export class ClaudeUnavailableError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ClaudeUnavailableError'
  }
}

/** The SDK the adapter runs, whose own directory is where its platform packages resolve from. */
const CLAUDE_SDK = '@anthropic-ai/claude-agent-sdk'

/**
 * The candidates the SDK itself tries, in its order, when `pathToClaudeCodeExecutable` is not set
 * (the adapter sets it whenever it is given a program; a development checkout uses this lookup):
 * `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`, `.exe` on Windows, and on Linux the
 * `-musl` build first when the process has no glibc. Read at call time, as the SDK reads them.
 */
export function claudeProgramCandidates(
  platform: string = process.platform,
  arch: string = process.arch,
  musl: boolean = platform === 'linux' && noGlibc(),
): string[] {
  const pkg = `${CLAUDE_SDK}-`
  const exe = platform === 'win32' ? '.exe' : ''
  const packages =
    platform === 'android'
      ? [`${pkg}linux-${arch}-android`]
      : platform === 'linux'
        ? musl
          ? [`${pkg}linux-${arch}-musl`, `${pkg}linux-${arch}`]
          : [`${pkg}linux-${arch}`, `${pkg}linux-${arch}-musl`]
        : [`${pkg}${platform}-${arch}`]
  return packages.map((name) => `${name}/claude${exe}`)
}

function noGlibc(): boolean {
  const report =
    typeof process.report?.getReport === 'function'
      ? (process.report.getReport() as { header?: { glibcVersionRuntime?: string } })
      : null
  return report !== null && report.header?.glibcVersionRuntime === undefined
}

/**
 * Where the SDK would find its program, or `null`: its own resolution, asked from the SDK's own
 * directory (under pnpm a platform package is visible only from the SDK's `node_modules`). A download
 * carries no platform package, so only a development checkout asks this.
 */
export function claudeProgramWhereTheSdkLooks(
  candidates: readonly string[] = claudeProgramCandidates(),
  resolveFromTheSdk: (specifier: string) => string = sdkResolver(),
): string | null {
  for (const candidate of candidates) {
    try {
      const path = resolveFromTheSdk(candidate)
      if (existsSync(path)) return path
    } catch {
      // not installed — the SDK moves on to its next candidate too
    }
  }
  return null
}

function sdkEntry(): string {
  // `import.meta.url` works under vitest (real ESM) and in the electron-vite main bundle (rewritten to a file URL).
  return createRequire(import.meta.url).resolve(CLAUDE_SDK)
}

function sdkResolver(): (specifier: string) => string {
  const entry = sdkEntry()
  return (specifier) => createRequire(entry).resolve(specifier)
}

/**
 * Does the SDK ship a program for this computer at all (its `optionalDependencies`, checked against
 * the first candidate's package)? A shipped program missing from the checkout is fixed by reinstalling
 * dependencies; one never shipped is not. Unreadable answers `true`, so the reinstall is offered.
 */
export function claudeProgramShipsHere(
  candidates: readonly string[] = claudeProgramCandidates(),
): boolean {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(sdkEntry()), 'package.json'), 'utf8'),
    ) as { optionalDependencies?: Record<string, string> }
    const shipped = Object.keys(manifest.optionalDependencies ?? {})
    return candidates.some((candidate) =>
      shipped.includes(candidate.slice(0, candidate.lastIndexOf('/'))),
    )
  } catch {
    return true
  }
}

/**
 * The Claude Code version the SDK carries, as its own manifest declares it (`claudeCodeVersion`):
 * the copy a development checkout runs, and the one the shipped snapshot of what Claude Code puts
 * in front of a model was captured from. `null` when the manifest cannot be read or names none.
 */
export function claudeVersionTheSdkShips(): string | null {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dirname(sdkEntry()), 'package.json'), 'utf8'),
    ) as { claudeCodeVersion?: unknown }
    const version = manifest.claudeCodeVersion
    return typeof version === 'string' && version !== '' ? version : null
  } catch {
    return null
  }
}

/**
 * The SDK refused before it spawned: was it the missing program? Returns this adapter's typed error
 * if so, else the SDK's own error untouched. Asked only after `query()` threw, so a launch that works
 * never pays for it, and never by matching the SDK's text: if the program is where the SDK looks,
 * the failure was something else.
 */
export function aProgramTheSdkCouldNotFind(
  thrown: unknown,
  whereTheSdkLooks: () => string | null = () => claudeProgramWhereTheSdkLooks(),
  shipsHere: () => boolean = () => claudeProgramShipsHere(),
): unknown {
  if (whereTheSdkLooks() !== null) return thrown
  const computer = `${process.platform}-${process.arch}`
  return new ClaudeUnavailableError(
    shipsHere()
      ? `Claude Code isn't available — the copy the Agent SDK carries for this computer ` +
          `(${computer}) is missing, so no Claude conversation can start. Reinstall the checkout's ` +
          'dependencies without skipping optional ones.'
      : `Claude Code isn't available — the Agent SDK carries no Claude Code for this computer ` +
          `(${computer}), so no Claude conversation can start here.`,
    { cause: thrown },
  )
}

/**
 * Errnos a spawn reports for a launch's circumstances, not for its program: a folder that is gone
 * or is a file, a machine that ran short. Other checks say those in their own words
 * (`whyALaunchWasRefused`, the folder-it-ran-in-is-gone check), so they go on as they came.
 */
const NOT_THE_PROGRAMS = new Set([
  'ENOENT',
  'ENOTDIR',
  'EACCES',
  'EAGAIN',
  'EMFILE',
  'ENFILE',
  'ENOMEM',
])

/**
 * When the Claude Code a launch was given could not be started at all, the error a person reads in
 * its place; anything else is returned untouched.
 *
 * Node throws some spawn errors synchronously, out of `query()`: a Windows script that is not a
 * `.exe` (`EINVAL`), a file that is not a program for this computer (`ENOEXEC`, `EBADARCH`: an
 * Intel-only build with no Rosetta, or npm's placeholder left where its install scripts never ran).
 * Each is the program's, and installing Claude Code again fixes it. An error with no system errno
 * (a bad option, a bug) is not the program's, so it goes on as it came.
 */
export function aProgramThatCouldNotRun(program: string, thrown: unknown): unknown {
  const code =
    typeof thrown === 'object' && thrown !== null && 'code' in thrown ? thrown.code : undefined
  if (typeof code !== 'string' || !/^E[A-Z0-9]+$/.test(code) || NOT_THE_PROGRAMS.has(code)) {
    return thrown
  }
  return new ClaudeUnavailableError(
    `Claude Code isn't available — the program at ${program} could not be started (${code}), so ` +
      'no Claude conversation can start. Install Claude Code again from ' +
      'https://code.claude.com/docs/en/setup, then try again.',
    { cause: thrown },
  )
}
