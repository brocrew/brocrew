import { accessSync, constants, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import {
  ClaudeUnavailableError,
  claudeCommandIn,
  claudeProgramWhereTheSdkLooks,
} from '@brobot2/runtime'
import type { ProviderProgramFrom, ProviderProgramUpdate } from '../../shared/runtime-ipc'

/**
 * Finds the Claude Code program a launch runs. The app carries none: a person installs it, and
 * every Claude conversation runs it with this app's own `CLAUDE_CONFIG_DIR`, never theirs.
 *
 * The order, first that runs wins:
 *
 *  1. `--brobot-claude-code=<absolute path>` on Electron's command line. A switch rather than an
 *     environment variable, so it reaches only the launch that was given it.
 *  2. In a development checkout, the copy the Agent SDK carries in `node_modules`, so a checkout
 *     runs the version its tests ran. `--brobot-claude-code=installed` skips it.
 *  3. What is installed: Anthropic's own installer first, then Homebrew or WinGet, then npm's
 *     global folder, then the folders on `PATH`.
 *
 * It reads the file system only and starts no shell: an app opened from Finder has launchd's short
 * `PATH`, so the installers' folders are looked at by name.
 *
 * A launch passes the path found, not the file it points to: Anthropic's installer updates by
 * pointing `~/.local/bin/claude` at the new version. Where the program came from is read from its
 * real path ({@link fromWhere}), so a `PATH` entry that is really Homebrew's npm is named as npm.
 */

/** Where Anthropic says how to install Claude Code — said wherever it is missing or untested. */
export const CLAUDE_CODE_SETUP_URL = 'https://code.claude.com/docs/en/setup'

/** The switch, without its dashes — the spelling `app.commandLine.getSwitchValue` takes. */
export const CLAUDE_CODE_SWITCH = 'brobot-claude-code'

/** The switch's value that skips a development checkout's own copy and looks as a download does. */
export const LOOK_FOR_THE_INSTALLED_ONE = 'installed'

/** One copy of Claude Code: its path, where it came from, and the command that updates it. */
export interface ClaudeCopy {
  readonly path: string
  readonly from: ProviderProgramFrom
  readonly update: ProviderProgramUpdate | null
}

/**
 * The program found: the path every launch passes and where it came from, and the other copies
 * installed on this computer that a launch does not run — each its own file, in the order they are
 * looked for. ⚑ None for a program given to the launch or a checkout's own: nothing else is looked for.
 */
export interface ClaudeProgram extends ClaudeCopy {
  readonly others: readonly ClaudeCopy[]
}

/**
 * What the lookup needs to know about where it runs. Plain data and seams, no `electron` import, so
 * the module and its tests load under node; the composition root fills it.
 */
export interface ClaudeProgramContext {
  readonly isPackaged: boolean
  /** The launch's `--brobot-claude-code` value, or `undefined` when it was given none. */
  readonly given: string | undefined
  readonly platform: NodeJS.Platform
  readonly homedir: string
  /** `PATH`, `APPDATA`, `LOCALAPPDATA`, `USERPROFILE` and `NVM_DIR`, as this process has them. */
  readonly env: Readonly<Record<string, string | undefined>>
  /** Seams for tests; the real file system by default. */
  readonly runs?: (path: string) => boolean
  readonly realpath?: (path: string) => string
  readonly readText?: (path: string) => string | null
  readonly list?: (folder: string) => readonly string[]
  readonly whereTheSdkLooks?: () => string | null
  /**
   * Look on past the first copy for every other one, as the Providers page reads them. ⚑ A launch
   * does not: it runs the first, and stops looking there.
   */
  readonly everyCopy?: boolean
}

/**
 * The program every Claude launch runs, or a {@link ClaudeUnavailableError} whose message a person
 * reads — where to get it, never a raw `spawn ENOENT`. Asked at every launch: a program installed,
 * moved or removed while the app runs is seen by the next one.
 */
export function findClaudeProgram(context: ClaudeProgramContext): ClaudeProgram {
  const runs = context.runs ?? runsHere
  const given = context.given?.trim() ?? ''
  if (given !== '' && given !== LOOK_FOR_THE_INSTALLED_ONE) {
    const path = pathsFor(context.platform)
    const instead =
      `Start BroCrew without --${CLAUDE_CODE_SWITCH} to run the Claude Code installed on this ` +
      'computer, or give it the absolute path of a Claude Code program.'
    if (!path.isAbsolute(given)) {
      throw new ClaudeUnavailableError(
        `Claude Code isn't available — this launch was given --${CLAUDE_CODE_SWITCH}=${given}, ` +
          `which is neither "${LOOK_FOR_THE_INSTALLED_ONE}" nor an absolute path. ${instead}`,
      )
    }
    // On Windows only a `.exe` starts without a shell: npm's `claude.cmd` is a script, which Node
    // will not spawn directly.
    if (context.platform === 'win32' && !/\.exe$/i.test(given)) {
      throw new ClaudeUnavailableError(
        `Claude Code isn't available — this launch was given ${given}, which Windows cannot start ` +
          `as a program: it is not a .exe. ${instead}`,
      )
    }
    if (!runs(given)) {
      throw new ClaudeUnavailableError(
        `Claude Code isn't available — this launch was given ${given} as its Claude Code, and ` +
          `there is no program there that can run. ${instead}`,
      )
    }
    return { path: given, from: 'given', update: null, others: [] }
  }
  if (!context.isPackaged && given !== LOOK_FOR_THE_INSTALLED_ONE) {
    const carried = (context.whereTheSdkLooks ?? claudeProgramWhereTheSdkLooks)()
    if (carried !== null && runs(carried)) {
      return { path: carried, from: 'development-checkout', update: null, others: [] }
    }
  }
  // ⚑ Every copy that runs, each file once — a link and the file it points to are one copy, and on
  // a Mac or Windows two spellings of one path differ only in case: the first is the one a launch
  // runs, and the rest say why an update of another did not take.
  const realOf = (candidate: Candidate): string => {
    let real: string
    try {
      real = (context.realpath ?? realpathSync)(candidate.path)
    } catch {
      real = candidate.path
    }
    return context.platform === 'linux' ? real : real.toLowerCase()
  }
  const seen = new Set<string>()
  const copies: ClaudeCopy[] = []
  for (const candidate of installedCandidates(context)) {
    if (!runs(candidate.path)) continue
    const real = realOf(candidate)
    if (seen.has(real)) continue
    seen.add(real)
    const from = fromWhere(candidate, context)
    const run = claudeCommandIn(candidate.path, context.platform)
    copies.push({ path: candidate.path, from, update: updateCommandFor(from, real, run) })
    if (context.everyCopy !== true) break
  }
  const [first, ...others] = copies
  if (first !== undefined) return { ...first, others }
  // "Where its installers put it", not "on this computer": one installed some other way (Volta,
  // bun, pnpm's global folder) is on the computer but in none of these places.
  throw new ClaudeUnavailableError(
    'BroCrew found no Claude Code where its installers put it, so no Claude conversation can ' +
      `start. Install it from ${CLAUDE_CODE_SETUP_URL}, then try again.`,
  )
}

/**
 * {@link findClaudeProgram} for this process — its platform, home folder and environment; the
 * composition root says whether it is packaged and what the launch was given.
 */
export function findClaudeProgramHere(launch: {
  readonly isPackaged: boolean
  readonly given: string | undefined
  readonly everyCopy?: boolean
}): ClaudeProgram {
  return findClaudeProgram({
    ...launch,
    platform: process.platform,
    homedir: homedir(),
    env: {
      PATH: process.env.PATH,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      USERPROFILE: process.env.USERPROFILE,
      NVM_DIR: process.env.NVM_DIR,
    },
  })
}

/** One place an installer puts Claude Code, and what is installed there unless it points elsewhere. */
interface Candidate {
  readonly path: string
  readonly from: ProviderProgramFrom
}

/** The places, in the order they are tried: each installer's own, then `PATH`. */
export function installedCandidates(context: ClaudeProgramContext): Candidate[] {
  const path = pathsFor(context.platform)
  const env = context.env
  const onPath = (env.PATH ?? env.Path ?? '')
    .split(context.platform === 'win32' ? ';' : ':')
    .filter((folder) => folder !== '' && path.isAbsolute(folder))
  if (context.platform === 'win32') {
    const profile = env.USERPROFILE ?? context.homedir
    const npmGlobal = (folder: string): string =>
      path.join(folder, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    return [
      { path: path.join(profile, '.local', 'bin', 'claude.exe'), from: 'native-installer' },
      ...(env.LOCALAPPDATA === undefined
        ? []
        : [
            {
              path: path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'claude.exe'),
              from: 'winget' as const,
            },
          ]),
      ...(env.APPDATA === undefined
        ? []
        : [{ path: npmGlobal(path.join(env.APPDATA, 'npm')), from: 'npm' as const }]),
      // npm's `claude.cmd` cannot start without a shell, so each folder is also asked for the
      // `.exe` that shim runs.
      ...onPath.flatMap((folder) => [
        { path: path.join(folder, 'claude.exe'), from: 'path' as const },
        { path: npmGlobal(folder), from: 'npm' as const },
      ]),
    ]
  }
  const home = context.homedir
  const npmPrefix = npmPrefixIn(context)
  return [
    { path: path.join(home, '.local', 'bin', 'claude'), from: 'native-installer' },
    { path: '/opt/homebrew/bin/claude', from: 'homebrew' },
    { path: '/usr/local/bin/claude', from: 'path' },
    ...(npmPrefix === null
      ? []
      : [{ path: path.join(npmPrefix, 'bin', 'claude'), from: 'npm' as const }]),
    ...nvmFolders(context).map((folder) => ({
      path: path.join(folder, 'bin', 'claude'),
      from: 'npm' as const,
    })),
    ...onPath.map((folder) => ({ path: path.join(folder, 'claude'), from: 'path' as const })),
  ]
}

/**
 * The command that updates one copy, as Anthropic's setup page gives it for the way it was installed
 * (https://code.claude.com/docs/en/setup: "Update manually", the Homebrew and WinGet tabs, and
 * "Install with npm"), or `null` where BroBot cannot say how it was installed. Homebrew has two
 * casks, `claude-code` and `claude-code@latest`, and each is upgraded by its own name.
 * ⚑ The installer's own copy updates itself, so its command runs that copy as the person's shell
 * runs it (`run`, `claudeCommandIn`): a bare `claude` may be another copy, or one the shell does
 * not find.
 */
export function updateCommandFor(
  from: ProviderProgramFrom,
  realPath: string,
  run: string,
): ProviderProgramUpdate | null {
  switch (from) {
    case 'native-installer':
      return { command: `${run} update` }
    case 'homebrew':
      return {
        command: realPath
          .replaceAll('\\', '/')
          .toLowerCase()
          .includes('/caskroom/claude-code@latest/')
          ? 'brew upgrade claude-code@latest'
          : 'brew upgrade claude-code',
      }
    case 'winget':
      return { command: 'winget upgrade Anthropic.ClaudeCode' }
    case 'npm':
      return { command: 'npm install -g @anthropic-ai/claude-code@latest' }
    case 'given':
    case 'development-checkout':
    case 'path':
    case 'carried':
      return null
  }
}

/**
 * Where a program came from, read from its real path: a `PATH` entry or Homebrew's folder is often
 * npm's global install underneath. Otherwise the place it was found in answers.
 */
function fromWhere(candidate: Candidate, context: ClaudeProgramContext): ProviderProgramFrom {
  let real: string
  try {
    real = (context.realpath ?? realpathSync)(candidate.path)
  } catch {
    return candidate.from
  }
  const said = real.replaceAll('\\', '/').toLowerCase()
  if (said.includes('/.local/share/claude/')) return 'native-installer'
  if (said.includes('/caskroom/')) return 'homebrew'
  if (said.includes('/microsoft/winget/')) return 'winget'
  if (said.includes('/node_modules/@anthropic-ai/claude-code/')) return 'npm'
  return candidate.from
}

/** npm's global folder when `~/.npmrc` moves it (`prefix=`), else `null` — npm's default is above. */
function npmPrefixIn(context: ClaudeProgramContext): string | null {
  const path = pathsFor(context.platform)
  const text = (context.readText ?? readTextHere)(path.join(context.homedir, '.npmrc'))
  if (text === null) return null
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*prefix\s*=\s*(.+?)\s*$/.exec(line)
    if (match?.[1] === undefined) continue
    const prefix = match[1]
      .replace(/^~(?=\/|$)/, context.homedir)
      .replace(/^\$\{?HOME\}?/, context.homedir)
    return path.isAbsolute(prefix) ? prefix : null
  }
  return null
}

/**
 * nvm's Node folders, the default one first: npm's global install lives under the Node that ran it,
 * and nvm keeps one per version. The default alias (`~/.nvm/alias/default`, a version or its
 * prefix) is the one a new terminal gets; the rest follow, newest Node first.
 */
function nvmFolders(context: ClaudeProgramContext): string[] {
  const path = pathsFor(context.platform)
  const root = context.env.NVM_DIR ?? path.join(context.homedir, '.nvm')
  const versions = path.join(root, 'versions', 'node')
  let names: readonly string[]
  try {
    names = (context.list ?? listHere)(versions)
  } catch {
    return []
  }
  const numbers = (name: string): number[] =>
    name
      .replace(/^v/, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10) || 0)
  const newestFirst = [...names]
    .filter((name) => /^v\d/.test(name))
    .sort((a, b) => {
      const [x, y] = [numbers(a), numbers(b)]
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const step = (y[i] ?? 0) - (x[i] ?? 0)
        if (step !== 0) return step
      }
      return 0
    })
  const alias = ((context.readText ?? readTextHere)(path.join(root, 'alias', 'default')) ?? '')
    .trim()
    .replace(/^v/, '')
  const isTheDefault = (name: string): boolean =>
    /^\d/.test(alias) && (name === `v${alias}` || name.startsWith(`v${alias}.`))
  return [
    ...newestFirst.filter(isTheDefault),
    ...newestFirst.filter((name) => !isTheDefault(name)),
  ].map((name) => path.join(versions, name))
}

function pathsFor(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

/** A regular file this process may run. On Windows `X_OK` only checks that it exists. */
function runsHere(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

function readTextHere(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function listHere(folder: string): readonly string[] {
  return readdirSync(folder)
}
