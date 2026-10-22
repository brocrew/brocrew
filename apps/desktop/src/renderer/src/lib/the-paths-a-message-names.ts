import { escaped, markedValueAt, markNamesIn } from './named-in-a-reply'
import {
  MAX_MESSAGE_PATH_LENGTH,
  MAX_MESSAGE_PATHS,
  type MessagePath,
} from '../../../shared/runtime-ipc'
import {
  isLocalLinkPath,
  isNetworkPath,
  LOCAL_LINK_START,
  LOCAL_LINK_END,
  LOCAL_LABEL_END,
} from './markdown'
import type { FoundMessagePath } from './message-paths'

/**
 * Path-like text in a rendered message: found first, then marked once main said what it is.
 *
 * Only text main answered `found: true` for becomes a control. Everything else, and everything
 * while main has not answered, is the text it always was. The walk is `named-in-a-reply.ts`'s, so
 * `<pre>`, `<a>` and `<button>` are left alone and inline `<code>` is read.
 */

/**
 * One line of characters that could contain paths. Quotes, brackets and the characters a
 * Windows path cannot hold end it; markdown-it has already turned `&`, `<`, `>` and `"` into
 * entities, which the walk steps around.
 */
const A_RUN = /[^\t\r\n<>"'`()[\]{}|]+/g
const MAX_PREFIXES = 8

/** Runs are already as long as they can be, so nothing next to one makes it part of a word. */
const NOTHING = /(?!)/

/** Sentence punctuation after a path, or a `:line` or `:line:column` an agent put after a file. */
const A_TAIL = /(?:[.,:;!?]+|:\d+(?::\d+)?)$/

const A_DRIVE = /^[A-Za-z]:[\\/][^\\/]/
const FROM_HOME = /^~[\\/][^\\/]/
const FROM_ROOT = /^\/[^/]/
const FROM_HERE = /^\.\.?\/[^/]/
/** A last segment with an extension (`report.md`, `.env`), or none at all after a closing `/`. */
const A_FILE_NAME = /(?:^|\/)[^/]*\.[A-Za-z][A-Za-z0-9_-]*$/
const A_FOLDER_NAME = /[^/]\/$/

/** Splits a run into the path as written and whatever follows it that is not part of it. */
export function pathIn(run: string): { path: string; tail: string } | null {
  let path = run
  for (let tail = A_TAIL.exec(path); tail !== null && tail.index > 0; tail = A_TAIL.exec(path)) {
    path = path.slice(0, tail.index)
  }
  if (path.length < 2 || path.length > MAX_MESSAGE_PATH_LENGTH) return null
  if (!isAPath(path)) return null
  return { path, tail: run.slice(path.length) }
}

function isAPath(text: string): boolean {
  const drive = A_DRIVE.test(text)
  // A colon past a drive letter is a scheme, a `host:path`, an id like `doc:`, a drive-relative
  // `C:foo` or a stream; main resolves none of them, nor a share, a device path or `//`.
  if (text.includes(':', drive ? 2 : 0)) return false
  if (text.startsWith('\\\\') || text.startsWith('//')) return false
  if (/[*?]/.test(text)) return false
  if (drive) return true
  if (FROM_HOME.test(text) || FROM_ROOT.test(text) || FROM_HERE.test(text)) return true
  if (!text.includes('/') || text.startsWith('/')) return false
  return A_FILE_NAME.test(text) || A_FOLDER_NAME.test(text)
}

interface PathCandidate {
  start: number
  path: string
  preferred: boolean
}

interface PathBudget {
  starts: number
}

/** Bounded prefixes from each path start; file/folder endings get the first lookup slots. */
function candidatesIn(run: string, budget: PathBudget): PathCandidate[] {
  if (budget.starts === 0) return []
  const words = /[^ ]+/g
  const candidates: PathCandidate[] = []
  for (let hit = words.exec(run); hit !== null && budget.starts > 0; hit = words.exec(run)) {
    const word = hit[0]
    if (word.length > MAX_MESSAGE_PATH_LENGTH + 16) continue
    if (pathIn(word) === null && (!word.includes('/') || pathIn(`${word}/x.md`) === null)) continue
    budget.starts -= 1
    const start = hit.index
    const prefixes: PathCandidate[] = []
    let firstComplete: PathCandidate | null = null
    let complete = false
    const following = /[^ ]+/g
    following.lastIndex = start
    for (let token = following.exec(run); token !== null; token = following.exec(run)) {
      const next = token[0]
      const end = token.index + next.length
      if (end - start > MAX_MESSAGE_PATH_LENGTH + 16) break
      if (token.index > start) {
        const rooted =
          A_DRIVE.test(next) || FROM_HOME.test(next) || FROM_ROOT.test(next) || FROM_HERE.test(next)
        if (rooted || (complete && pathIn(next) !== null)) break
      }
      const found = pathIn(run.slice(start, end))
      if (found === null) continue
      const preferred = A_FILE_NAME.test(found.path) || A_FOLDER_NAME.test(found.path)
      complete ||= preferred
      const candidate = { start, path: found.path, preferred }
      if (preferred && firstComplete === null) firstComplete = candidate
      if (prefixes.length < MAX_PREFIXES) prefixes.push(candidate)
      else {
        let fallback = prefixes.length - 1
        while (fallback >= 0 && prefixes[fallback]!.preferred) fallback -= 1
        if (preferred) {
          let replace = fallback < 0 ? MAX_PREFIXES - 1 : fallback
          if (prefixes[replace] === firstComplete) replace -= 1
          if (replace >= 0) prefixes[replace] = candidate
        } else if (fallback > 0) prefixes[fallback] = candidate
      }
    }
    const fileEnd = firstComplete?.path.length ?? 0
    candidates.push(...prefixes.filter((one) => one.path.length >= fileEnd))
  }
  return candidates
}

/** Up to fifty candidates, with complete file/folder endings ahead of other prefixes. */
export function pathsNamedIn(rendered: string): string[] {
  const budget = { starts: MAX_MESSAGE_PATHS }
  const preferred = new Set<string>()
  const other = new Set<string>()
  const links = localLinksIn(rendered)
  // A link to a file on this computer is asked about by its destination, under the same rules.
  for (const link of links) {
    if (preferred.size < MAX_MESSAGE_PATHS && !isNetworkPath(link.path)) preferred.add(link.path)
  }
  // The walk reads the message with each local link held in a slot of its own.
  const html = localSlotsIn(rendered, links)
  markNamesIn(html, {
    pattern: A_RUN,
    boundary: NOTHING,
    mark: (run) => {
      for (const found of candidatesIn(run, budget)) {
        const named = found.preferred ? preferred : other
        if (named.size < MAX_MESSAGE_PATHS) named.add(found.path)
      }
      return run
    },
  })
  return [...new Set([...preferred, ...other])].slice(0, MAX_MESSAGE_PATHS)
}

/** What the markup says about where a path is shown, and whether a press may open it. */
export interface PathWords {
  /** False in a window that only shows. */
  readonly canOpen: boolean
  /** "Finder", "Explorer" or "your file manager". */
  readonly fileManager: string
}

/** The attribute the Open control carries the text on, and the Copy control's. */
export const PATH_ATTRIBUTE = 'data-message-path'
export const COPY_ATTRIBUTE = 'data-message-path-copy'

const icon = (id: string): string =>
  `<svg class="icon" aria-hidden="true"><use href="#${id}"></use></svg>`

/** The path as text a person can read and select, then its Copy control. Values arrive escaped. */
function pathAndCopy(kind: string, display: string, title: string): string {
  return (
    `<span class="message-path" data-kind="${kind}">` +
    `<span class="message-path-text" data-cy="message-path-text" title="${title}">${display}</span>` +
    `<button type="button" class="message-path-icon" data-cy="message-path-copy" ` +
    `${COPY_ATTRIBUTE}="${display}" title="Copy path" aria-label="Copy path">${icon('i-copy')}</button>`
  )
}

/**
 * One found path: its text, which is not a control, then Copy and Open. Copy takes the path as it
 * is drawn; Open sends the text as written, and main decides whether it opens or only shows.
 */
export function pathMarkup(
  found: FoundMessagePath,
  words: PathWords,
  display: string = found.text,
): string {
  const opens = words.canOpen && found.opens
  const name = opens ? 'Open file' : escaped(`Show in ${words.fileManager}`)
  return (
    pathAndCopy(found.kind, escaped(display), escaped(found.absolute)) +
    `<button type="button" class="message-path-icon" data-cy="message-path" ` +
    `${PATH_ATTRIBUTE}="${escaped(found.text)}" data-opens="${opens ? 'true' : 'false'}" ` +
    `title="${name}" aria-label="${name}">${icon(opens ? 'i-open' : 'i-folder')}</button></span>`
  )
}

/** A path main has not answered for yet: its text only, until the icons can say what they do. */
function pendingPathMarkup(path: string): string {
  const said = escaped(path)
  return (
    `<span class="message-path" data-kind="file">` +
    `<span class="message-path-text" data-cy="message-path-text" title="${said}">${said}</span></span>`
  )
}

/** A network share: main never reads one, so Open stays off and says why. */
function networkPathMarkup(path: string): string {
  const said = escaped(path)
  return (
    pathAndCopy('file', said, said) +
    `<button type="button" class="message-path-icon" data-cy="message-path-network" ` +
    `aria-disabled="true" title="Network paths can't be opened here." aria-label="Open file">` +
    `${icon('i-open')}</button></span>`
  )
}

/**
 * Marks every path main found in one message's rendered HTML.
 *
 * @param known main's answer for a text, or undefined while it has not answered.
 */
export function markPathsIn(
  rendered: string,
  known: (text: string) => MessagePath | undefined,
  words: PathWords,
): string {
  const budget = { starts: MAX_MESSAGE_PATHS }
  const links = localLinksIn(rendered)
  const html = localSlotsIn(rendered, links)
  const marked = markNamesIn(html, {
    pattern: A_RUN,
    boundary: NOTHING,
    mark: (run) => {
      const found = candidatesIn(run, budget).sort(
        (a, b) => a.start - b.start || b.path.length - a.path.length,
      )
      let out = ''
      let end = 0
      for (const candidate of found) {
        if (candidate.start < end) continue
        const answer = known(candidate.path)
        if (!answer?.found) continue
        out += run.slice(end, candidate.start) + pathMarkup(answer, words)
        end = candidate.start + candidate.path.length
      }
      return out + run.slice(end)
    },
  })
  return markLocalLinksIn(marked, links, known, words)
}

/** A rendered link to a local path, with what its destination names. */
interface LocalLink {
  /** The complete renderer placeholder and link. */
  readonly markup: string
  /** The destination as written. */
  readonly path: string
  /** The link's visible content, as rendered HTML. */
  readonly label: string
}

/** The rendered entities markdown writes in an attribute, read back to the text. */
function unescaped(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Renderer placeholders delimit complete labels, independent of tags inside them. */
function localLinksIn(html: string): LocalLink[] {
  const links: LocalLink[] = []
  let at = 0
  while (links.length < MAX_MESSAGE_PATHS) {
    const start = html.indexOf(LOCAL_LINK_START, at)
    if (start === -1) break
    const keyEnd = html.indexOf('-->', start + LOCAL_LINK_START.length)
    if (keyEnd === -1) break
    const key = html.slice(start + LOCAL_LINK_START.length, keyEnd)
    at = keyEnd + 3
    if (key.length > MAX_MESSAGE_PATH_LENGTH * 9) continue
    let path: string
    try {
      path = decodeURIComponent(key)
    } catch {
      continue
    }
    if (!isLocalLinkPath(path) && !isNetworkPath(path)) continue
    const ending = `${LOCAL_LINK_END}${key}-->`
    const end = html.indexOf(ending, at)
    if (end === -1) continue
    const body = html.slice(at, end)
    at = end + ending.length
    const labelEnd = body.indexOf(`${LOCAL_LABEL_END}${key}-->`)
    if (labelEnd === -1) continue
    const anchor = body.slice(0, labelEnd)
    if (!anchor.startsWith('<a ') || !anchor.endsWith('</a>')) continue
    const labelStart = anchor.indexOf('>') + 1
    if (labelStart === 0) continue
    links.push({ markup: html.slice(start, at), path, label: anchor.slice(labelStart, -4) })
  }
  return links
}

function localSlot(index: number): string {
  return `<a data-local-file-slot="${index}"></a>`
}

/** Keep whole labels and their disclosures out of every prose-path pass. */
function localSlotsIn(html: string, links: readonly LocalLink[]): string {
  let out = html
  links.forEach((link, index) => {
    out = out.replace(link.markup, () => localSlot(index))
  })
  return out
}

/** Controls carry the destination and display main's resolved path, never the link's label. */
function markLocalLinksIn(
  html: string,
  links: readonly LocalLink[],
  known: (text: string) => MessagePath | undefined,
  words: PathWords,
): string {
  let out = html
  links.forEach((link, index) => {
    const network = isNetworkPath(link.path)
    const answer = network ? undefined : known(link.path)
    const label = link.label.trim()
    const sameAsPath = label === '' || unescaped(label) === link.path
    const caption = sameAsPath ? '' : `<span class="message-path-label">${link.label}</span> `
    out = out.replace(localSlot(index), () =>
      network
        ? caption + networkPathMarkup(link.path)
        : answer === undefined
          ? caption + pendingPathMarkup(link.path)
          : caption +
            (answer.found
              ? pathMarkup(answer, words, answer.absolute)
              : `<span title="${escaped(link.path)}">${escaped(link.path)}</span>`),
    )
  })
  return out
}

/** Which control a click landed on, and the text it names. */
export function pathClicked(
  target: EventTarget | null,
): { text: string; pressed: 'open' | 'copy' } | null {
  const copied = markedValueAt(target, COPY_ATTRIBUTE)
  if (copied !== null) return { text: copied, pressed: 'copy' }
  const opened = markedValueAt(target, PATH_ATTRIBUTE)
  return opened === null ? null : { text: opened, pressed: 'open' }
}
