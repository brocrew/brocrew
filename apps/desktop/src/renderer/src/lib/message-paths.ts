import type {
  MessagePath,
  MessagePathAsk,
  MessagePathTarget,
  OpenMessagePathResult,
  RevealResult,
} from '../../../shared/runtime-ipc'

/**
 * Paths named in a message, as main answers for them.
 *
 * The window finds path-like text and asks main what each one is. Main alone resolves it, checks it
 * and decides what a press may do: the window never sends main an absolute path to open, only the
 * conversation and the text as written, and main resolves it again on every press.
 */

export type FoundMessagePath = Extract<MessagePath, { found: true }>

/** The calls one window makes for its messages' paths. */
export interface PathCalls {
  resolve(ask: MessagePathAsk): Promise<MessagePath[]>
  reveal(target: MessagePathTarget): Promise<RevealResult>
  /** Null in a window that only shows. */
  open: ((target: MessagePathTarget) => Promise<OpenMessagePathResult>) | null
}

/** What the computer's file manager is called, from `navigator.platform`. */
export function fileManagerWord(platform: string): string {
  if (/mac/i.test(platform)) return 'Finder'
  if (/win/i.test(platform)) return 'Explorer'
  return 'your file manager'
}

export const showName = (name: string, fileManager: string): string =>
  `Show ${name} in ${fileManager}`

/** Main's answer for the text at one place in the ask; a missing or mismatched one is not found. */
export function answerFor(text: string, answer: MessagePath | undefined): MessagePath {
  return answer !== undefined && answer.text === text ? answer : { text, found: false }
}

const capitalised = (words: string): string => words.charAt(0).toUpperCase() + words.slice(1)

/** The plain line shown under a message when a press did not do what it said. */
export function pressFailedWords(
  reason: 'gone' | 'no-path' | 'failed',
  kind: 'file' | 'folder',
  fileManager: string,
  pressed: 'open' | 'show',
): string {
  if (reason === 'gone') return `That ${kind} isn't there any more. Ask the agent where it is now.`
  if (reason === 'no-path') {
    return `BroCrew can't tell where that ${kind} is from here. Ask the agent for its full path.`
  }
  if (pressed === 'open') {
    return `That ${kind} didn't open. Copy its path and open it from ${fileManager}.`
  }
  return `${capitalised(fileManager)} didn't show that ${kind}. Try again.`
}
