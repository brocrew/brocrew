import { lstat, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import {
  MAX_MESSAGE_PATH_LENGTH,
  type MessagePath,
  type OpenMessagePathResult,
  type RevealResult,
} from '../shared/runtime-ipc'

/**
 * Paths written in a message, for the window to draw as links: what each names, and what a press on
 * it may do. The renderer names a conversation and the text as written; the path is resolved here,
 * again on every press, and a press opens only a document on the allowlist. Anything else (a
 * folder, a program, a script, an app bundle) is only shown in the file manager. Nothing is run.
 */

/** Where a path is read from: the computer's home and platform, and its file system. */
export interface MessagePathPlace {
  readonly home: string
  readonly platform: NodeJS.Platform
  readonly fs: {
    /** Does not follow a link, like `fs.lstat`. */
    lstat(at: string): Promise<{ isFile(): boolean; isDirectory(): boolean; mode: number }>
    realpath(at: string): Promise<string>
  }
}

export const THIS_COMPUTER: MessagePathPlace = {
  home: homedir(),
  platform: process.platform,
  fs: { lstat: (at) => lstat(at), realpath: (at) => realpath(at) },
}

/**
 * The document types a press opens in their default app, by extension. A browser runs the scripts
 * in HTML, SVG and XML, and the older Office formats and RTF can carry macros, so none of them is
 * here, and no program, script, shortcut or bundle is.
 */
export const OPENS_IN_ITS_APP: ReadonlySet<string> = new Set([
  'txt',
  'md',
  'markdown',
  'log',
  'pdf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'heic',
  'csv',
  'tsv',
  'json',
  'yaml',
  'yml',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'pages',
  'numbers',
  'key',
])

/** A Windows path from a drive's root: `C:\…` or `C:/…`. */
const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]/
/** Execute permission, for its owner, group or anyone. */
const ANY_EXECUTE_BIT = 0o111

/**
 * The absolute path a message's text names, or `null` when it names none: an absolute path, `~/…`
 * from the home, or a path relative to the conversation's working folder (`null` reads none).
 *
 * On Windows, only a drive's root (`C:\…`). A share, a device or a `\\?\` path is no path here:
 * reading it to draw a message would reach out to the network, or to a pipe, before any press. A
 * path without its drive's root (`\x`, `C:x`) names no folder of the conversation's, and a colon
 * after the drive names a stream, not a file.
 */
export function messagePathOf(
  text: string,
  workingFolder: string | null,
  place: Pick<MessagePathPlace, 'home' | 'platform'>,
): string | null {
  const said = text.trim()
  if (said === '' || said.length > MAX_MESSAGE_PATH_LENGTH || said.includes('\0')) return null
  const windows = place.platform === 'win32'
  const paths = windows ? path.win32 : path.posix
  if (said === '~') return place.home
  if (said.startsWith('~/') || (windows && said.startsWith('~\\'))) {
    if (windows && said.slice(2).includes(':')) return null
    return paths.join(place.home, said.slice(2))
  }
  if (said.startsWith('~')) return null
  if (windows) {
    const afterTheDrive = WINDOWS_DRIVE_ROOT.test(said) ? said.slice(2) : said
    if (afterTheDrive.includes(':') || said.startsWith('\\') || said.startsWith('//')) return null
    if (WINDOWS_DRIVE_ROOT.test(said)) return paths.normalize(said)
    if (paths.isAbsolute(said)) return null
  } else if (said.startsWith('/')) {
    return paths.normalize(said)
  }
  if (workingFolder === null || workingFolder === '') return null
  return paths.resolve(workingFolder, said)
}

/** What is at a path now: file or folder, where its links lead, and whether a press opens it. */
interface WhatIsThere {
  readonly kind: 'file' | 'folder'
  /** The path with every link followed: what a press would open. */
  readonly real: string
  readonly opens: boolean
}

async function whatIsAt(absolute: string, place: MessagePathPlace): Promise<WhatIsThere | null> {
  let real: string
  let info: { isFile(): boolean; isDirectory(): boolean; mode: number }
  try {
    // One lookup for both questions: where the links lead, then what is there, unfollowed.
    real = await place.fs.realpath(absolute)
    info = await place.fs.lstat(real)
  } catch {
    return null
  }
  const kind = info.isDirectory() ? 'folder' : info.isFile() ? 'file' : null
  if (kind === null) return null
  // Judged by where its links lead: a link named like a document may point at a program. An app
  // bundle is a folder on disk, so it is never opened. On macOS and Linux a file someone may run
  // is only shown, whatever its name: the app that opens a file can be set on the file itself.
  const paths = place.platform === 'win32' ? path.win32 : path.posix
  const type = paths.extname(real).slice(1).toLowerCase()
  const runnable = place.platform !== 'win32' && (info.mode & ANY_EXECUTE_BIT) !== 0
  return { kind, real, opens: kind === 'file' && !runnable && OPENS_IN_ITS_APP.has(type) }
}

/** One answer per text, in order. `opens` is `false` everywhere a press may only show. */
export async function resolveMessagePaths(
  texts: readonly string[],
  workingFolder: string | null,
  place: MessagePathPlace,
  { mayOpen }: { mayOpen: boolean },
): Promise<MessagePath[]> {
  return Promise.all(
    texts.map(async (text): Promise<MessagePath> => {
      const absolute = messagePathOf(text, workingFolder, place)
      const there = absolute === null ? null : await whatIsAt(absolute, place)
      if (absolute === null || there === null) return { text, found: false }
      const paths = place.platform === 'win32' ? path.win32 : path.posix
      return {
        text,
        found: true,
        absolute,
        name: paths.basename(absolute) || absolute,
        kind: there.kind,
        opens: mayOpen && there.opens,
      }
    }),
  )
}

/**
 * A press on a path: resolved and checked again now, then opened if it is still a document on the
 * allowlist, else shown in the file manager.
 */
export async function openMessagePath(
  text: string,
  workingFolder: string | null,
  place: MessagePathPlace,
  doors: { open?(real: string): Promise<string>; reveal?(absolute: string): void },
): Promise<OpenMessagePathResult> {
  const absolute = messagePathOf(text, workingFolder, place)
  if (absolute === null) return { ok: false, reason: 'no-path' }
  const there = await whatIsAt(absolute, place)
  if (there === null) return { ok: false, reason: 'gone' }
  if (there.opens && doors.open !== undefined) {
    // What was judged is what is opened: the path with its links followed.
    const failed = await doors.open(there.real).catch((error: unknown) => String(error))
    return failed === '' ? { ok: true, did: 'opened' } : { ok: false, reason: 'failed' }
  }
  if (doors.reveal === undefined) return { ok: false, reason: 'failed' }
  doors.reveal(absolute)
  return { ok: true, did: 'shown' }
}

/** A press on "show": the path as written, shown in the file manager, never opened. */
export async function revealMessagePath(
  text: string,
  workingFolder: string | null,
  place: MessagePathPlace,
  reveal: ((absolute: string) => void) | undefined,
): Promise<RevealResult> {
  const absolute = messagePathOf(text, workingFolder, place)
  if (absolute === null) return { ok: false, reason: 'no-path' }
  if ((await whatIsAt(absolute, place)) === null) return { ok: false, reason: 'gone' }
  reveal?.(absolute)
  return { ok: true, path: absolute }
}
