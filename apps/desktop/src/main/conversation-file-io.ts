import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { retrying } from './recovery/files'
/**
 * The provider's own files for one conversation, found in its agent's provider home and nowhere
 * else, and removed only after each is checked again to be inside that home.
 *
 * Claude Code keeps, per session id: its transcript, a folder of the same name beside it (tool
 * results, its own sub-agents' transcripts, workflow runs), and folders named by the id under the
 * home (`file-history`, `tasks`, `session-env`) and a debug log. Codex keeps a rollout file the
 * thread index names, and a folder of the pictures it generated. Each is listed only when it is
 * there; a link where one is expected is never followed or listed.
 *
 * A person's own Claude Code or Codex folder is never reached here: the home is always the app's
 * provider home for the conversation's agent.
 */

/** A provider's file or folder for a conversation. */
export interface ProviderFile {
  readonly path: string
  readonly kind: 'file' | 'folder'
  readonly bytes: number
}

/** A memory note an agent's conversation created, by the provider's own stamp in the note. */
export interface MemoryNote {
  readonly path: string
  /** Its `name` front-matter, else the file's name. */
  readonly name: string
  readonly description: string | null
  readonly bytes: number
}

/** The fields of a note's front-matter this reads: its name, description and origin session. */
export function frontMatterOf(text: string): {
  readonly name: string | null
  readonly description: string | null
  readonly originSessionId: string | null
} {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? ''
  const field = (key: string, indented: boolean): string | null => {
    const at = new RegExp(`^${indented ? '[ \\t]+' : ''}${key}:[ \\t]*(.+?)[ \\t]*$`, 'm').exec(
      block,
    )?.[1]
    if (at === undefined) return null
    const unquoted = /^(["'])(.*)\1$/.exec(at)?.[2] ?? at
    return unquoted === '' ? null : unquoted
  }
  return {
    name: field('name', false),
    description: field('description', false),
    originSessionId: field('originSessionId', true),
  }
}

/** A file or folder a removal left, with why, in words a person reads. */
export interface FileLeft {
  readonly path: string
  readonly why: string
}

/**
 * Removes `paths` from `home`, each checked again first to be in it and not a link, and retried
 * while another program briefly holds it; answers what it left. One already gone is not left.
 */
export async function removeFromHome(home: string, paths: readonly string[]): Promise<FileLeft[]> {
  const left: FileLeft[] = []
  for (const path of paths) {
    if (entryAt(home, path) === null) {
      if (isThere(path)) {
        left.push({ path, why: 'it changed since the list was read, so BroCrew left it' })
      }
      continue
    }
    try {
      await retrying(() => rm(path, { recursive: true, force: true }))
    } catch (error) {
      left.push({ path, why: whyNotRemoved(error) })
    }
  }
  return left
}

export function isThere(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

export function whyNotRemoved(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') {
    return 'another program has it open, or this user may not remove it'
  }
  return `it could not be removed (${code ?? 'an error'})`
}

/**
 * What is at `path`, when it is inside `home` (by its spelling and where it really is) and is a
 * file or a folder rather than a link; null otherwise, or when nothing is there.
 */
export function entryAt(home: string, path: string): ProviderFile | null {
  const lexicalHome = resolve(home)
  const lexical = resolve(path)
  if (!lexical.startsWith(lexicalHome + sep)) return null
  let stats
  try {
    stats = lstatSync(lexical)
  } catch {
    return null
  }
  if (stats.isSymbolicLink() || !(stats.isFile() || stats.isDirectory())) return null
  try {
    if (!realpathSync.native(lexical).startsWith(realpathSync.native(lexicalHome) + sep)) {
      return null
    }
  } catch {
    return null
  }
  return stats.isFile()
    ? { path: lexical, kind: 'file', bytes: stats.size }
    : { path: lexical, kind: 'folder', bytes: bytesIn(lexical) }
}

/** The bytes of every file in `folder`, following no link. */
function bytesIn(folder: string): number {
  let total = 0
  let names: string[]
  try {
    names = readdirSync(folder)
  } catch {
    return 0
  }
  for (const name of names) {
    const path = join(folder, name)
    try {
      const stats = lstatSync(path)
      if (stats.isFile()) total += stats.size
      else if (stats.isDirectory()) total += bytesIn(path)
    } catch {
      // Gone since the folder was listed.
    }
  }
  return total
}

export function isOneSegment(value: string): boolean {
  return value !== '' && value !== '.' && value !== '..' && !/[\\/\0]/.test(value)
}
