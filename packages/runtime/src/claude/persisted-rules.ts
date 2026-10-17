import { execFile } from 'node:child_process'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * 🔴 **736 · R95 / 740 · R99 — the rules a person chose to keep beyond one conversation, read back as
 * the Claude CLI reads them.**
 *
 * ⚑ **Two files, and 740 made the second the one *always* writes.**
 *
 * - **The PROJECT's local settings** — `<project>/.claude/settings.local.json`, the CLI's
 *   `localSettings`. 🔴 **740 · R99 (`736` F-4)**: *"an always rule is kept where the CLI keeps it"*.
 *   ⚑ Measured on the INTERACTIVE CLI (2.1.281, loopback, `740`'s pty arms K3–K5, outside `/tmp`):
 *   its *"don't ask again"* for `make build`, a WebFetch host and an MCP tool each wrote exactly this
 *   file — held at the next launch in that project, asked again in another folder of the same
 *   identity. The host hands the CLI that update at its own destination, and the CLI writes the file
 *   (`local-settings-location.ts` says where).
 * - **The provider home's `settings.json`** — the CLI's `userSettings`, where `736` (R95) kept an
 *   *always*, before R99 moved it to the project. Still read: it is this identity's own settings
 *   file, and the CLI honours its rules in every folder.
 *
 * ⚑ **Measured** (`736`'s loopback, bundled CLI 2.1.281, `settingSources: []`): an update the host
 * hands back with a file destination IS written by the CLI — ⛔ but with `settingSources: []` the CLI
 * neither applies it in the running session nor loads it at the next launch (both arms asked again);
 * ⚑ passed back as FLAG settings at the next launch, it held — the same command ran unasked and a
 * different one was still asked.
 *
 * ⚠️ **Why the flag layer and not `settingSources`**: opening a source loads that file WHOLE — hooks,
 * env, plugins, skills — which `156` §5 went through field by field and ruled out (and row `158 M18`
 * guards). This reads the permission rules out of it, and nothing else.
 *
 * 🔴 **740 · the rules, not only `allow`**: a project's local settings are where a person's own CLI
 * keeps rules too, and the CLI honours its `deny` and `ask` beside its `allow`. ⛔ Read `allow` alone
 * and a command that person both allowed and denied there would run unasked in BroBot and be refused
 * in their own CLI; so all three lists are read, and nothing else of the file. ⚠️ **And its `allow`
 * only as the CLI reads it with no trust recorded**: never from a file the REPOSITORY carries
 * ({@link carriedByTheRepository}) — BroBot records no trust for a folder, so it takes the CLI's
 * untrusted reading.
 *
 * ⛔ **Bounded, and silent on anything it cannot read.** A file the workload itself can write is not
 * ours to trust: past {@link MAX_SETTINGS_BYTES} nothing is read, and an unreadable or malformed file
 * is no rules at all — never a failed launch, which is the CLI's own behaviour with a settings file
 * it cannot parse. ⛔ And opened `O_NONBLOCK`, then checked to be a regular file: a FIFO planted at
 * the name would otherwise hang the process that opens it, at every launch (`736`'s review).
 */

/** A settings file this large is not one the CLI wrote for a person's choices. */
export const MAX_SETTINGS_BYTES = 256 * 1024

/** The provider home's own `settings.json` — the CLI's `userSettings` for this identity. */
export function persistedRulesFile(providerHome: string): string {
  return join(providerHome, 'settings.json')
}

function realOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * 🔴 **740 · the CLI's gate on a local-settings file the REPOSITORY carries** (`740`'s review): with
 * no trust recorded for the folder — and BroBot records none — the CLI ignores
 * the `allow` rules of its local settings when either folder's `.claude` or `settings.local.json` is
 * a symbolic link, when `.claude/.git` exists, or when git tracks `.claude/settings.local.json`
 * (*"Ignoring N permissions.allow entries from .claude/settings.local.json: this workspace has not
 * been trusted"*). ⛔ Without it, a repository that commits `{"allow":["Bash(curl *)"]}` there would
 * run `curl` unasked in its first BroBot conversation. ⚑ Its `deny` and `ask` are never gated. A git
 * that is missing answers *untracked*, and one that stalls or fails answers *tracked*, as the CLI's.
 * ⚑ Git is asked asynchronously: a launch on Electron's main process never waits on it.
 */
async function carriedByTheRepository(folder: string, signal?: AbortSignal): Promise<boolean> {
  if (realOrResolved(folder) === realOrResolved(homedir())) return false
  for (const one of [join(folder, '.claude'), join(folder, '.claude', 'settings.local.json')]) {
    try {
      if (lstatSync(one).isSymbolicLink()) return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true
    }
  }
  try {
    lstatSync(join(folder, '.claude', '.git'))
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true
  }
  const git = await gitTracks(folder, signal)
  if ((git.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return false
  if (git.signal !== null || git.error !== undefined) return true
  if (git.status === 0) return true
  if (git.status === 1) return false
  if (git.status === 128) return !/^fatal: not a git repository/.test(git.stderr)
  return true
}

/** What `git ls-files` said about the folder's local settings, in the terms a spawn reports. */
interface GitAnswer {
  readonly error: NodeJS.ErrnoException | undefined
  readonly signal: NodeJS.Signals | null
  readonly status: number | null
  readonly stderr: string
}

/** Whether git tracks the folder's `.claude/settings.local.json`, asked without blocking. */
function gitTracks(folder: string, signal?: AbortSignal): Promise<GitAnswer> {
  return new Promise((done) => {
    execFile(
      'git',
      ['-C', folder, 'ls-files', '--error-unmatch', '--', ':(icase).claude/settings.local.json'],
      {
        cwd: folder,
        encoding: 'utf8',
        timeout: 2_000,
        windowsHide: true,
        ...(signal === undefined ? {} : { signal }),
        env: {
          PATH: process.env['PATH'] ?? '/usr/bin:/bin',
          HOME: homedir(),
          LC_ALL: 'C',
          GIT_LITERAL_PATHSPECS: '',
        },
      },
      (error, _stdout, stderr) => {
        if (error === null) {
          done({ error: undefined, signal: null, status: 0, stderr })
          return
        }
        // ⚑ An exit with a status is git's answer; a git that could not start, was stopped or ran
        // past its time is an error, as a spawn would report it.
        const exited = typeof error.code === 'number' && !error.killed
        done({
          error: exited ? undefined : (error as NodeJS.ErrnoException),
          signal: error.signal ?? null,
          status: exited ? (error.code as number) : null,
          stderr,
        })
      },
    )
  })
}

/** The permission rules one settings file keeps — each list as the CLI would read it, or empty. */
export interface KeptRules {
  readonly allow: readonly string[]
  readonly deny: readonly string[]
  readonly ask: readonly string[]
}

const NO_RULES: KeptRules = { allow: [], deny: [], ask: [] }

/** `permissions.allow` out of the provider home's `settings.json`, or `[]`. */
export function persistedAllowRules(providerHome: string): string[] {
  return [...keptRulesIn(persistedRulesFile(providerHome)).allow]
}

/**
 * 🔴 **740 · everything a launch reads back** — the provider home's rules, then the project's, each
 * list in that order and once. Empty lists are left out. `localFiles` are the launch's local settings
 * files as it found them (`localSettingsFilesOf`, once per launch), or `null` for a launch that runs
 * in no project (the model list). ⚑ Never holds the thread: many conversations starting at once on
 * Electron's main process never wait on the repository gate's git in turn.
 */
export async function keptRulesForALaunch(
  providerHome: string,
  localFiles: readonly string[] | null,
  signal?: AbortSignal,
): Promise<{ allow?: string[]; deny?: string[]; ask?: string[] }> {
  const read = [
    keptRulesIn(persistedRulesFile(providerHome)),
    ...(localFiles === null ? [] : [await projectRulesFor(localFiles, signal)]),
  ]
  const merged: { allow?: string[]; deny?: string[]; ask?: string[] } = {}
  for (const list of ['allow', 'deny', 'ask'] as const) {
    const rules = [...new Set(read.flatMap((one) => one[list]))]
    if (rules.length > 0) merged[list] = rules
  }
  return merged
}

/** The local settings' rules, as the CLI reads them with no trust recorded — see above. */
async function projectRulesFor(files: readonly string[], signal?: AbortSignal): Promise<KeptRules> {
  // ⚑ The repository gate asks of each project folder: the one that holds each file's `.claude`.
  const folders = files.map((file) => dirname(dirname(file)))
  const read = files.map(keptRulesIn)
  const allow = read.flatMap((one) => one.allow)
  return {
    // ⚑ Asked only when there is an `allow` to gate, so a launch with none spawns no git.
    allow: allow.length > 0 && (await anyCarried(folders, signal)) ? [] : allow,
    deny: read.flatMap((one) => one.deny),
    ask: read.flatMap((one) => one.ask),
  }
}

/** Whether any of these folders carries its local settings in its repository — asked in turn. */
async function anyCarried(folders: readonly string[], signal?: AbortSignal): Promise<boolean> {
  for (const folder of folders) {
    if (await carriedByTheRepository(folder, signal)) return true
  }
  return false
}

function keptRulesIn(file: string): KeptRules {
  const text = readSmall(file)
  if (text === undefined) return NO_RULES
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return NO_RULES
    const permissions = (parsed as { permissions?: unknown }).permissions
    if (typeof permissions !== 'object' || permissions === null) return NO_RULES
    const list = (key: keyof KeptRules): string[] => {
      const rules = (permissions as Record<string, unknown>)[key]
      return Array.isArray(rules)
        ? rules.filter((rule): rule is string => typeof rule === 'string' && rule !== '')
        : []
    }
    return { allow: list('allow'), deny: list('deny'), ask: list('ask') }
  } catch {
    return NO_RULES
  }
}

/** A regular file of at most {@link MAX_SETTINGS_BYTES}, read whole — or `undefined`. */
function readSmall(file: string): string | undefined {
  let fd: number | null = null
  try {
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    const size = stat.size
    if (!stat.isFile() || size > MAX_SETTINGS_BYTES) return undefined
    const buffer = Buffer.alloc(size)
    let read = 0
    while (read < size) {
      const got = readSync(fd, buffer, read, size - read, read)
      if (got === 0) break
      read += got
    }
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return undefined
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
