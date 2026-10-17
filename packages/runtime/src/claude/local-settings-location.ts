import { execFileSync } from 'node:child_process'
import { statSync, realpathSync } from 'node:fs'
import { devNull, homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

function canonicalFolder(folder: string): string {
  try {
    return realpathSync(folder)
  } catch {
    return resolve(folder)
  }
}

function ownedBy(path: string, uid: number, optional = false): boolean {
  try {
    return statSync(path).uid === uid
  } catch (error) {
    return optional && (error as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

function settingsFolder(cwd: string): string {
  const startingFolder = resolve(cwd)
  if (process.platform === 'win32' || process.getuid === undefined) return startingFolder

  let checkout: string
  try {
    const records = execFileSync(
      'git',
      ['-C', startingFolder, 'worktree', 'list', '--porcelain', '-z'],
      {
        encoding: 'utf8',
        timeout: 1_000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: {
          PATH: process.env['PATH'],
          GIT_CONFIG_GLOBAL: devNull,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_OPTIONAL_LOCKS: '0',
        },
      },
    ).split('\0')
    const first = records[0]
    if (first === undefined || !first.startsWith('worktree ')) return startingFolder
    if (records.slice(1, records.indexOf('')).includes('bare')) return startingFolder
    checkout = first.slice('worktree '.length)
    if (!isAbsolute(checkout)) return startingFolder
  } catch {
    return startingFolder
  }

  if (canonicalFolder(checkout) === canonicalFolder(homedir())) return startingFolder
  const uid = process.getuid()
  if (
    !ownedBy(checkout, uid) ||
    !ownedBy(join(checkout, '.git'), uid) ||
    !ownedBy(join(checkout, '.claude'), uid, true)
  ) {
    return startingFolder
  }
  return checkout
}

/** The terminal local-settings destination, including repository and worktree routing. */
export function projectLocalSettingsFile(cwd: string): string {
  return join(settingsFolder(cwd), '.claude', 'settings.local.json')
}

/** Routed settings and starting-folder settings, each listed once in precedence order. */
export function localSettingsFilesOf(cwd: string): { files: string[]; folders: string[] } {
  const files = [
    ...new Set([
      projectLocalSettingsFile(cwd),
      join(resolve(cwd), '.claude', 'settings.local.json'),
    ]),
  ]
  return { files, folders: files.map((file) => dirname(file)) }
}
