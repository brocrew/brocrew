import { readSizedUtf8Sync } from '../sized-read'
import { MAX_SETTINGS_BYTES } from '../settings-limits'
export { MAX_SETTINGS_BYTES } from '../settings-limits'
import { execFile } from 'node:child_process'
import { closeSync, constants, fstatSync, lstatSync, openSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Settings } from '@anthropic-ai/claude-agent-sdk'

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

interface GitAnswer {
  readonly error: NodeJS.ErrnoException | undefined
  readonly signal: NodeJS.Signals | null
  readonly status: number | null
  readonly stderr: string
}

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

export interface KeptRules {
  readonly allow: readonly string[]
  readonly deny: readonly string[]
  readonly ask: readonly string[]
}

const NO_RULES: KeptRules = { allow: [], deny: [], ask: [] }

export type KeptRuleLists = { allow?: string[]; deny?: string[]; ask?: string[] }

export interface KeptLaunchSettings {
  readonly permissions: KeptRuleLists
  readonly hooks?: Settings['hooks']
}

export function persistedAllowRules(providerHome: string): string[] {
  return [...rulesFrom(settingsIn(persistedRulesFile(providerHome))['permissions']).allow]
}

export async function keptSettingsForALaunch(
  providerHome: string,
  localFiles: readonly string[] | null,
  signal?: AbortSignal,
): Promise<KeptLaunchSettings> {
  const profile = settingsIn(persistedRulesFile(providerHome))
  const read = [
    rulesFrom(profile['permissions']),
    ...(localFiles === null ? [] : [await projectRulesFor(localFiles, signal)]),
  ]
  const permissions: KeptRuleLists = {}
  for (const list of ['allow', 'deny', 'ask'] as const) {
    const rules = [...new Set(read.flatMap((one) => one[list]))]
    if (rules.length > 0) permissions[list] = rules
  }
  const hooks = profile['hooks']
  return {
    permissions,
    ...(typeof hooks === 'object' && hooks !== null && !Array.isArray(hooks)
      ? { hooks: hooks as NonNullable<Settings['hooks']> }
      : {}),
  }
}

async function projectRulesFor(files: readonly string[], signal?: AbortSignal): Promise<KeptRules> {
  const folders = files.map((file) => dirname(dirname(file)))
  const read = files.map((file) => rulesFrom(settingsIn(file)['permissions']))
  const allow = read.flatMap((one) => one.allow)
  return {
    allow: allow.length > 0 && (await anyCarried(folders, signal)) ? [] : allow,
    deny: read.flatMap((one) => one.deny),
    ask: read.flatMap((one) => one.ask),
  }
}

async function anyCarried(folders: readonly string[], signal?: AbortSignal): Promise<boolean> {
  for (const folder of folders) {
    if (await carriedByTheRepository(folder, signal)) return true
  }
  return false
}

function settingsIn(file: string): Record<string, unknown> {
  const text = readSmall(file)
  if (text === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function rulesFrom(permissions: unknown): KeptRules {
  if (typeof permissions !== 'object' || permissions === null) return NO_RULES
  const list = (key: keyof KeptRules): string[] => {
    const rules = (permissions as Record<string, unknown>)[key]
    return Array.isArray(rules)
      ? rules.filter((rule): rule is string => typeof rule === 'string' && rule !== '')
      : []
  }
  return { allow: list('allow'), deny: list('deny'), ask: list('ask') }
}

function readSmall(file: string): string | undefined {
  let fd: number | null = null
  try {
    // Nonblocking open prevents a workload-created FIFO from hanging a launch.
    fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    const size = stat.size
    if (!stat.isFile() || size > MAX_SETTINGS_BYTES) return undefined
    return readSizedUtf8Sync(fd, size)
  } catch {
    return undefined
  } finally {
    if (fd !== null) closeSync(fd)
  }
}
