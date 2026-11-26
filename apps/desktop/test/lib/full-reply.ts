import { readFileSync } from 'node:fs'

/** **484 · the path a long reply names** on its last line, spaces and all; `null` when it names none. */
export function fullReplyPath(text: string): string | null {
  return /\n\nFull reply: ([^\n]+)$/.exec(text)?.[1] ?? null
}

/**
 * **484 · the whole reply a tool gave**: the text itself, or — when it was long and ends
 * `Full reply: <path>` — what that file holds.
 */
export function wholeReply(text: string): string {
  const path = fullReplyPath(text)
  return path === null ? text : readFileSync(path, 'utf8')
}

/** A reply with its temp file's path left out, so the replies of two calls compare. */
export function theFileUnnamed(text: string): string {
  const path = fullReplyPath(text)
  return path === null ? text : `${text.slice(0, -path.length)}<file>`
}
