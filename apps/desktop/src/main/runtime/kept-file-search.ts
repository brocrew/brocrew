import type { KeptFile } from '../../shared/runtime-ipc'

/**
 * 🔴 **D-037 · what `find_files` asks** — where to look, the words a file must hold (lower-cased,
 * each once; none lists), and the file the last answer ended at, to go on from.
 */
export interface FindFilesAsked {
  readonly where: 'tree' | 'everywhere'
  readonly words: readonly string[]
  readonly olderThan: string | null
}

/** ⚑ **D-037 · where a word was found**: the file's own words, its maker, its piece, or its text. */
export type FoundIn = 'title' | 'name' | 'maker' | 'piece' | 'text'

/** ⚑ **D-037 · one file `find_files` answers with.** */
export interface FoundFile {
  readonly file: KeptFile
  /** Where the words were found, in {@link FoundIn}'s order — empty in a list. */
  readonly foundIn: readonly FoundIn[]
  /** ⚑ The text around the first word found only in it, or `null`. */
  readonly excerpt: string | null
}

/**
 * 🔴 **D-037 · what `find_files` answers** — or the one thing it cannot do: go on from a file this
 * app keeps no record of.
 */
export type FoundFiles =
  | { readonly ok: false; readonly reason: 'older-than-names-no-file' }
  | {
      readonly ok: true
      readonly files: readonly FoundFile[]
      /** How many files this answer looked through — for a list, the ones it names. */
      readonly looked: number
      /**
       * How many files in the scope are older than the last one looked through — counted up to
       * {@link OLDER_FILES_COUNTED}, and no further.
       */
      readonly older: number
      /** The file to go on from (`older_than`), or `null` when nothing older is left. */
      readonly goOnFrom: string | null
      /** ⚠️ Files whose text could not be read, so only their names and pieces were searched. */
      readonly textUnread: number
      /** ⚑ When this was read — what a kept time is said as of. */
      readonly readAt: number
    }

/** ⚑ **D-037 · the characters an excerpt keeps on each side of the word it shows.** */
const EXCERPT_SIDE = 80

/** ⚑ **D-037 · the order {@link FoundFile.foundIn} says places in**: the file's, then its text. */
const FOUND_IN_ORDER: readonly FoundIn[] = ['title', 'name', 'maker', 'piece', 'text']

export function inFoundOrder(found: ReadonlySet<FoundIn>): FoundIn[] {
  return FOUND_IN_ORDER.filter((where) => found.has(where))
}

/**
 * ⚑ **D-037 · who made a file, as a search reads it** — the agent's name and the profile a give
 * names it by, or `person` for a person. ⛔ **Nothing for an agent this app cannot name**: its words
 * (*an agent this app cannot name*) would be found by every search for *agent* or *name*.
 */
function makerSearched(file: KeptFile): string {
  if (file.addedBy === null) return 'person'
  if (file.addedBy.identity === null) return ''
  return `${file.addedBy.name} ${file.addedBy.identity}`
}

/**
 * ⚑ **D-037 · which of `words` one kept file holds outside its text**, and where — its title, its
 * name, its maker ({@link makerSearched}), and its piece's label and title. ⚑ Case is ignored:
 * `words` are lower-cased, and so is each place.
 */
export function wordsOutsideTheText(
  file: KeptFile,
  words: readonly string[],
): { readonly foundIn: ReadonlySet<FoundIn>; readonly missing: readonly string[] } {
  const places: readonly (readonly [FoundIn, string])[] = [
    ['title', file.title],
    ['name', file.name],
    ['maker', makerSearched(file)],
    ['piece', `${file.label} ${file.pieceTitle ?? ''}`],
  ]
  const lower = places.map(([where, text]) => [where, text.toLowerCase()] as const)
  const foundIn = new Set<FoundIn>()
  const missing: string[] = []
  for (const word of words) {
    const at = lower.filter(([, text]) => text.includes(word))
    if (at.length === 0) missing.push(word)
    for (const [where] of at) foundIn.add(where)
  }
  return { foundIn, missing }
}

/**
 * ⚑ **D-037 · what one file's text says about the words of a search** — which of them it holds,
 * and the words around each one's first place: all a search keeps of a text once it has read it.
 */
export interface TextHolds {
  readonly holds: ReadonlySet<string>
  readonly around: ReadonlyMap<string, string | null>
}

/**
 * ⚑ **D-037 · read `words` in one text, ignoring case** — and for each one found, the text around
 * its first place on one line, {@link EXCERPT_SIDE} characters each side, with `…` where it was cut.
 * ⚠️ **Placed only where lower-casing kept the text's length**, so a place found in the lower-cased
 * copy is the same place in the text: a character that grows when lower-cased (`İ`) leaves the word
 * found and its excerpt `null`. ⛔ Never cut inside a surrogate pair.
 */
export function wordsInTheText(text: string, words: readonly string[]): TextHolds {
  const lower = text.toLowerCase()
  const placeable = lower.length === text.length
  const holds = new Set<string>()
  const around = new Map<string, string | null>()
  for (const word of words) {
    const at = lower.indexOf(word)
    if (at < 0) continue
    holds.add(word)
    if (!placeable) {
      around.set(word, null)
      continue
    }
    let start = Math.max(0, at - EXCERPT_SIDE)
    let end = Math.min(text.length, at + word.length + EXCERPT_SIDE)
    if (start > 0 && /[\udc00-\udfff]/.test(text.charAt(start))) start += 1
    if (end < text.length && /[\ud800-\udbff]/.test(text.charAt(end - 1))) end -= 1
    const said = text.slice(start, end).replace(/\s+/g, ' ').trim()
    around.set(word, `${start > 0 ? '…' : ''}${said}${end < text.length ? '…' : ''}`)
  }
  return { holds, around }
}
