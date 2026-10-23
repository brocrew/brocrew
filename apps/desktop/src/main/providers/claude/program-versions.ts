import { execFile } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  ProviderProgram,
  ProviderProgramCopy,
  ProviderProgramFrom,
  ProviderProgramStanding,
  ProviderVersion,
} from '../../../shared/runtime-ipc'
import { CLAUDE_CODE_SETUP_URL, type ClaudeCopy, type ClaudeProgram } from './program'
import { VERSION_TIMEOUT_MS } from '../program-policy'
import TESTED from './claude-code-tested.json'

/**
 * The oldest and newest Claude Code versions this build was tested with (a start, a tool call, a
 * resume, the model list, hooks and the API key's hand-over). A program outside them still runs,
 * and the Providers screen says so — as a warning only when it is older ({@link A_STANDING_WARNS}).
 * CI reads the same file to install them.
 */
export const CLAUDE_CODE_TESTED: { readonly oldest: string; readonly newest: string } = TESTED

/** Bind once without resolving a program; cache only the same file's answers. */
export function claudeVersionReader(
  claudeProgram: () => ClaudeProgram,
): () => Promise<ProviderVersion> {
  /**
   * Each Claude Code file's answer, while that same file answers. ⚑ The running copy's silence is
   * asked again at the next read; another copy's is kept, so a copy that never answers costs one ask
   * per file, never one per read.
   */
  let claudeSaid = new Map<string, string | null>()
  /** Asks still running, by file, so two reads at once share one. */
  const asking = new Map<string, Promise<string | null>>()
  /** The running copy's last version, and the one before it while it last changed. */
  let lastRun: string | null = null
  let updatedFrom: string | null = null
  const claudeNow = async (): Promise<ProviderVersion> => {
    let program: ClaudeProgram
    try {
      program = claudeProgram()
    } catch (error) {
      claudeSaid = new Map()
      return claudeMissing(error)
    }
    const kept = claudeSaid
    const read = new Map<string, string | null>()
    const versionOf = async (path: string, keepSilence: boolean): Promise<string | null> => {
      const file = theFileItRuns(path)
      if (kept.has(file)) {
        const known = kept.get(file) ?? null
        read.set(file, known)
        return known
      }
      let going = asking.get(file)
      if (going === undefined) {
        going = askClaudeCodeItsVersion(path).finally(() => asking.delete(file))
        asking.set(file, going)
      }
      const version = await going
      if (version !== null || keepSilence) read.set(file, version)
      return version
    }
    const [version, ...others] = await Promise.all([
      versionOf(program.path, false),
      ...program.others.map((copy) => versionOf(copy.path, true)),
    ])
    // ⚑ Only the files this read met are kept, so an old version's answer goes with its file.
    claudeSaid = read
    // ⚑ An update that landed is said until the next one: the version before it stays beside it.
    if (version !== null && version !== undefined) {
      if (lastRun !== null && lastRun !== version) updatedFrom = lastRun
      lastRun = version
    }
    return claudeAnswer(
      program,
      version ?? null,
      program.others.map((copy, at) => ({ ...copy, version: others[at] ?? null })),
      CLAUDE_CODE_TESTED,
      updatedFrom,
    )
  }
  return claudeNow
}

/**
 * Which file a path runs now: where it points, and that file's identity, size and time. Anthropic's installer
 * updates by pointing `~/.local/bin/claude` at the new version; npm and Homebrew replace the file
 * in place.
 */
function theFileItRuns(path: string): string {
  try {
    const real = realpathSync(path)
    const stat = statSync(real, { bigint: true })
    return `${path}\n${real}\n${String(stat.dev)}\n${String(stat.ino)}\n${String(stat.size)}\n${String(stat.mtimeNs)}\n${String(stat.ctimeNs)}`
  } catch {
    return path
  }
}

const FROM: Readonly<Record<ProviderProgramFrom, string>> = {
  given: 'given to this launch',
  'development-checkout': 'the copy this development checkout carries',
  'native-installer': 'installed with Anthropic’s installer',
  homebrew: 'installed with Homebrew',
  winget: 'installed with WinGet',
  npm: 'installed with npm',
  path: 'found on this computer',
  carried: 'the copy BroCrew carries',
}

function helpFor(standing: ProviderProgramStanding): ProviderProgram['help'] {
  return {
    label:
      standing === 'missing'
        ? 'How to install Claude Code'
        : standing === 'older-than-tested'
          ? 'How to update Claude Code'
          : 'Installing and updating Claude Code',
    url: CLAUDE_CODE_SETUP_URL,
  }
}

function claudeMissing(error: unknown): ProviderVersion {
  // `ClaudeUnavailableError`'s message is already a person's sentence, with where to get it.
  const said = error instanceof Error ? error.message : String(error)
  return {
    version: null,
    reason: said,
    program: {
      standing: 'missing',
      from: null,
      path: null,
      version: null,
      tested: CLAUDE_CODE_TESTED,
      said,
      help: helpFor('missing'),
      update: null,
      others: [],
      updatedFrom: null,
    },
  }
}

/** `-1`, `0` or `1` as `a` is older than, the same as or newer than `b` — numbers, part by part. */
export function versionOrder(a: string, b: string): number {
  const parts = (version: string): number[] =>
    version.split(/[.+-]/, 3).map((part) => Number.parseInt(part, 10) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i += 1) {
    const step = (x[i] ?? 0) - (y[i] ?? 0)
    if (step !== 0) return Math.sign(step)
  }
  return 0
}

/** How `version` stands against what this build was tested with. */
export function standingOf(
  version: string,
  tested: { readonly oldest: string; readonly newest: string } = CLAUDE_CODE_TESTED,
): 'tested' | 'older-than-tested' | 'newer-than-tested' {
  if (versionOrder(version, tested.oldest) < 0) return 'older-than-tested'
  if (versionOrder(version, tested.newest) > 0) return 'newer-than-tested'
  return 'tested'
}

/** What one Claude Code program prints for `--version`, or `null` when it does not say. */
async function askClaudeCodeItsVersion(path: string): Promise<string | null> {
  let home: string | null = null
  let printed: string | null = null
  try {
    const own = mkdtempSync(join(tmpdir(), 'brobot-claude-version-'))
    home = own
    printed = await new Promise<string>((resolve, reject) => {
      execFile(
        path,
        ['--version'],
        {
          env: {
            HOME: own,
            CLAUDE_CONFIG_DIR: own,
            // A person's own program: asking its version must not update it.
            DISABLE_AUTOUPDATER: '1',
            PATH: process.platform === 'win32' ? (process.env.PATH ?? '') : '/usr/bin:/bin',
            ...(process.platform === 'win32'
              ? { USERPROFILE: own, SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' }
              : {}),
          },
          windowsHide: true,
          timeout: VERSION_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          encoding: 'utf8',
        },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      )
    })
  } catch (error) {
    console.warn(
      `could not ask Claude Code its version: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    if (home !== null) rmSync(home, { recursive: true, force: true })
  }
  return printed === null ? null : (/(\d+\.\d+\.\d+)/.exec(printed)?.[1] ?? null)
}

/**
 * The Claude Code a launch runs, as a person reads it: its version, where it came from and its path
 * — and, beside other copies, that it is the first one BroBot finds — and how it stands against the
 * versions tested. ⚑ Newer than tested is said quietly ({@link A_STANDING_WARNS}).
 */
export function claudeAnswer(
  program: ClaudeCopy,
  version: string | null,
  others: readonly (ClaudeCopy & { readonly version: string | null })[],
  tested: { readonly oldest: string; readonly newest: string } = CLAUDE_CODE_TESTED,
  /** The version it ran before it last changed while this app ran, or `null`. */
  updatedFrom: string | null = null,
): ProviderVersion {
  const where =
    `${FROM[program.from]}, at ${program.path}` +
    (others.length === 0
      ? ''
      : `, the first of ${String(others.length + 1)} copies BroCrew finds, and the one it runs`)
  const copies = others.map((copy): ProviderProgramCopy => ({
    from: copy.from,
    path: copy.path,
    version: copy.version,
    said: `${copy.version ?? 'Did not say its version'}, ${FROM[copy.from]}, at ${copy.path}`,
  }))
  if (version === null) {
    const said =
      `Claude Code, ${where}, did not say which version it is, so it may not run. If a ` +
      'conversation does not start, reinstall it.'
    return {
      version: null,
      reason: said,
      program: {
        standing: 'unreadable',
        from: program.from,
        path: program.path,
        version: null,
        tested,
        said,
        help: helpFor('unreadable'),
        update: program.update,
        others: copies,
        updatedFrom: null,
      },
    }
  }
  const standing = standingOf(version, tested)
  const said =
    `Claude Code ${version}, ${where}.` +
    (standing === 'older-than-tested'
      ? ` It is older than the versions BroCrew was tested with (${tested.oldest} to ` +
        `${tested.newest}), so something may not work; updating it is the fix.`
      : standing === 'newer-than-tested'
        ? ` It is newer than the versions BroCrew was tested with, up to ${tested.newest}.`
        : '')
  return {
    version,
    program: {
      standing,
      from: program.from,
      path: program.path,
      version,
      tested,
      said,
      help: helpFor(standing),
      update: program.update,
      others: copies,
      updatedFrom: updatedFrom === version ? null : updatedFrom,
    },
  }
}
