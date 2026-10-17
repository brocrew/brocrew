import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * 🔴 **716 · R66 — Claude's missing program, as a TYPE** (`710` F-2).
 *
 * ⚑ **PM ruling R66:** *"A host step a person must fix … and Claude's 'Native CLI binary … not
 * found', thrown before any spawn, get R51's permanent word, not a broken tool. … The Claude adapter
 * throws a typed error for the missing binary, so the word is chosen by type, never by matching
 * message text."*
 *
 * ⛔ **What it was until `716`**: the SDK's own `Error`, with no code and no class — *"Native CLI
 * binary for darwin-arm64 not found. Reinstall @anthropic-ai/claude-agent-sdk without
 * --omit=optional, or set options.pathToClaudeCodeExecutable."* `spawn_agent` answered it as a broken
 * tool, a person's New Conversation read it whole, and a wake could only say its provider *could not
 * resume it*. ⚑ `CodexUnavailableError` (`apps/desktop/src/main/runtime/codex-binary.ts`) is the same
 * fact for Codex, and `716` (R67) gives both the one word.
 *
 * ⚑ **Its message is a person's**, as Codex's is: a class that crosses a window's IPC loses its name
 * (`withoutItsClassName`) and a person reads the message. The SDK's own text is the `cause`.
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
 * 🔴 **The candidates the SDK itself tries, in its order** — the resolver `query()` runs when
 * `pathToClaudeCodeExecutable` is not set (the adapter sets it whenever it is
 * given a program, which the app always does; a development checkout's lookup uses this one):
 * `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`, `.exe` on Windows, and on Linux the
 * `-musl` build first when the process has no glibc (`process.report`'s `glibcVersionRuntime`).
 * ⚑ Read at CALL time, as the SDK reads them, so a test that moves `process.arch` moves both.
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
 * 🔴 **Where the SDK would find its program, or `null` when it would not** — the SDK's own
 * resolution, asked from the SDK's own directory.
 *
 * ⚠️ **From the SDK's entry, never from this file**: under pnpm a platform package is visible only
 * from the SDK's own `node_modules`, so a lookup from `@brobot2/runtime` would miss a binary the SDK
 * finds. `existsSync`, as the SDK asks it. A download carries no platform package, so only a
 * development checkout asks this (`claude-program.ts` never does in a packaged app).
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
  // `import.meta.url` survives both worlds this module runs in — vitest executes it as real ESM, and
  // the electron-vite main bundle rewrites it to a file URL (`codex-binary.ts` says the same).
  return createRequire(import.meta.url).resolve(CLAUDE_SDK)
}

function sdkResolver(): (specifier: string) => string {
  const entry = sdkEntry()
  return (specifier) => createRequire(entry).resolve(specifier)
}

/**
 * ⚑ **Does the SDK ship a program for this computer at all?** — its own `optionalDependencies`,
 * asked of the first candidate's package. The difference is what a developer can do: a program the
 * SDK ships and this checkout lacks comes back with a reinstall of its dependencies; one it never
 * ships does not.
 * ⛔ Unreadable is answered `true`, so the reinstall is offered — the sentence it picks is still true.
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
 * 🔴 **716 · the SDK refused before it spawned — was it the missing program?** The error this adapter
 * throws in its place when it was, or the SDK's own error, untouched, when it was not.
 *
 * ⚑ **Asked only AFTER `query()` threw**, so a launch that would work never pays for it and can never
 * be refused by it: the SDK's resolver is the one that decides whether a launch runs, and this reads
 * the same places afterwards to name why it did not. ⛔ **Never by the SDK's text** (R66): if the
 * program is where the SDK looks, whatever the SDK threw was something else, and goes on as it came.
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
