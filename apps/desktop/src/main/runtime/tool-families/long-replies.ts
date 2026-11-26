import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type AgentToolAnswer } from '@brobot2/runtime'

/**
 * **484 · a long list or record says its actionable lines inline, and where the rest is.**
 *
 * Majid, 25 Nov: when a reply would be long, the tool answers with a short form that ends
 * `Full reply: <path>`, and the whole reply goes to a fresh file in the system temp folder. Agents
 * on both providers open it with their own tools; the folder is the system's to clear, so nothing
 * here keeps or prunes these files. The text is made here, above both providers' adapters, so they
 * send the same words.
 */
export const SHORT_REPLY_CHARACTERS = 1_500

/** The last line of a shortened reply. */
const fullReplyAt = (path: string): string => `Full reply: ${path}`

/** An answer with the shorter form its tool would say instead of `text` when `text` is long. */
export interface AnswerWithAShortForm extends AgentToolAnswer {
  readonly short: string
}

export const withAShortForm = (answered: AgentToolAnswer, short: string): AnswerWithAShortForm => ({
  ...answered,
  short,
})

/** The short form a tool gave its answer, if it gave one. */
export const shortFormOf = (answered: AgentToolAnswer): string | undefined =>
  'short' in answered && typeof answered.short === 'string' ? answered.short : undefined

const folderOfReplies = (): string => join(tmpdir(), 'brocrew-tool-replies')

/**
 * The folder, made, by its real path. On macOS the temp folder is reached through the `/var` →
 * `/private/var` symlink; the folder Claude is given and every `Full reply:` path are spelled the
 * same way, so they match however Claude compares them.
 */
function madeFolderOfReplies(): string {
  const folder = folderOfReplies()
  mkdirSync(folder, { recursive: true })
  return realpathSync.native(folder)
}

/**
 * The folder long replies go in, made now when it can be. Composition adds it to the folders a
 * Claude agent may read without asking, beside card 483's kept files; the app starts whether or not
 * the temp folder could be written, and each long reply makes it again before writing.
 */
export function toolRepliesFolder(): string {
  try {
    return madeFolderOfReplies()
  } catch (error) {
    console.warn(`tool replies: ${folderOfReplies()} could not be made yet: ${String(error)}`)
    return folderOfReplies()
  }
}

/**
 * Writes a whole reply to a new file in the system temp folder and returns its path: a fresh folder
 * a call, so a later read never finds another call's reply.
 */
/**
 * What a short reply leaves for the line naming its temp file: the folder the writer uses, by its
 * real path, and more than enough for the call's own folder and file below it.
 */
export const roomForTheReplyPath = (): number => toolRepliesFolder().length + 80

/** How long one item's line may be in a short list. */
const ITEM_LINE_CHARACTERS = 160

/** An item on one line, cut at a whole character when it is longer than a line may be. */
function oneLine(item: string): string {
  const characters = [...item.replace(/\s+/g, ' ').trim()]
  return characters.length <= ITEM_LINE_CHARACTERS
    ? characters.join('')
    : `${characters.slice(0, ITEM_LINE_CHARACTERS - 1).join('')}…`
}

/** Said instead of the lines that say how to go on, when they are too long to go inline. */
export const HOW_TO_GO_ON_IS_IN_THE_FILE =
  'How to go on is in the full reply: read it before continuing.'

/**
 * A long list's short form: how many there are, as many of its items as fit, each on one line,
 * then what must stay whole — how to go on, and what could not be read. When those alone would
 * make the reply long, it says where they are instead, and they stay in the file.
 */
export function shortList(
  counted: (shown: number) => string,
  items: readonly string[],
  whole: readonly string[],
): string {
  const budget = SHORT_REPLY_CHARACTERS - roomForTheReplyPath()
  const all = whole.join('\n\n')
  const kept =
    all === '' || counted(0).length + 2 + all.length <= budget ? all : HOW_TO_GO_ON_IS_IN_THE_FILE
  const room = budget - (kept === '' ? 0 : kept.length + 2)
  const lines: string[] = []
  for (const item of items) {
    const line = `- ${oneLine(item)}`
    if ([counted(lines.length + 1), ...lines, line].join('\n').length > room) break
    lines.push(line)
  }
  return [[counted(lines.length), ...lines].join('\n'), ...(kept === '' ? [] : [kept])].join('\n\n')
}

function writeTheFullReply(tool: string, text: string): string {
  const folder = madeFolderOfReplies()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = join(mkdtempSync(join(folder, `${stamp}-`)), `${tool}.txt`)
  writeFileSync(path, text, 'utf8')
  return path
}

/**
 * The reply as the model reads it: unchanged when it is short, when its tool gave no short form,
 * when the whole reply could not be written, or when the short form with its path would be no
 * shorter than the whole (a list already a line an item); otherwise the short form, then the path of
 * the file holding the whole reply.
 */
export function shortenedIfLong(
  tool: string,
  finished: AgentToolAnswer,
  short: string | undefined,
  write: (tool: string, text: string) => string = writeTheFullReply,
): AgentToolAnswer {
  if (
    short === undefined ||
    finished.text.length <= SHORT_REPLY_CHARACTERS ||
    short.length >= finished.text.length
  )
    return finished
  let path: string
  try {
    path = write(tool, finished.text)
  } catch (error) {
    console.warn(
      `${tool}: the whole reply could not be written, so it is answered whole: ${String(error)}`,
    )
    return finished
  }
  const text = `${short}\n\n${fullReplyAt(path)}`
  // Its file stays for the system to clear, like every other.
  if (text.length >= finished.text.length) return finished
  return finished.structured === undefined ? { text } : { text, structured: finished.structured }
}
