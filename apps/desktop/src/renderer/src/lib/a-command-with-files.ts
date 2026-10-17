import type { CommandRegistry } from './transcript'

/**
 * 🔴 **714 · `708` H-3a — the composer says, BEFORE the press, that a command takes no attachments.**
 *
 * ## ⛔ The ruling, the part the composer meets (`R42`, `704` H-1)
 *
 * > a person's message whose first word is a command the provider published goes out exactly as
 * > typed. ⚑ **A command with attachments is refused at the door, with a sentence the person reads
 * > saying a command takes no attachments.** It is never sent with its attachment block, and never
 * > sent without telling them.
 *
 * ⚑ **`708` built the door**: the host refuses the press and hands the words and files back, with a
 * sentence ending *"Nothing has been sent."* ⛔ **Until `714` Send was lit over a message the host
 * was going to refuse**, and the sentence arrived only after the gesture had been made and undone —
 * `106`'s *no control that cannot act*.
 *
 * ## ⚠️ The HOST stays the authority, and this is only the window's copy of its question
 *
 * ⛔ **The window's command list is not always the host's** (`708` H-3a, and the row in
 * `send-refusals.ts`): the host's list is per LIFE and starts empty at every reopen while this
 * window's fold keeps the last life's until the new child publishes; the host may decide on its own
 * bounded ASK before this window has seen the answer; and with no list at all the host judges by the
 * CLI's shape test, which a `set: null` here says nothing about. ⚑ **So this answers only where the
 * window HOLDS a list, and answers `null` everywhere else** — and a refusal it did not predict still
 * reaches the person, as the host's own sentence beside the conversation (`session-error`), with the
 * words and files back in the box.
 *
 * ## ⛔ A copy of the host's rule, held to it by a test rather than by a memory
 *
 * ⚠️ **The host's decision is `aPersonsCommand` in `main/runtime/a-command-goes-as-typed.ts`**, which
 * the renderer cannot import. ⚑ So {@link aCommandInTheBox} is that function over the window's list,
 * for a person — and `a-command-in-the-box.test.ts` runs BOTH over one corpus and asserts they agree
 * wherever the window holds a list, so the day either one moves the other goes red.
 */

/** ⚑ `R42`'s own character — the rule says `/<name>`, and `$` skills are not in its scope. */
const THE_SLASH = '/'

/**
 * ⛔ **The CLI's own test for a command name**, as the host states it — asked only of a name a
 * list that was cut short did not carry.
 */
const SHAPED_LIKE_A_COMMAND = /^[a-zA-Z0-9_][a-zA-Z0-9:_-]*$/

/** ⚑ The CLI's marker for an MCP prompt, which follows the name as a separate word. */
const MCP_MARK = '(MCP)'

/**
 * ⚑ **What a message's first word names, as the CLI reads it — or `null`.** Trimmed first, then the
 * slash; the name runs to the first whitespace, with ` (MCP)` joined back on, and `sub` is the first
 * argument the CLI's plugin retry joins on (`base:sub`).
 */
function theCommandItNames(
  text: string,
): { readonly name: string; readonly base: string; readonly sub: string | null } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith(THE_SLASH)) return null
  const rest = trimmed.slice(THE_SLASH.length)
  const end = rest.search(/\s/)
  const base = end === -1 ? rest : rest.slice(0, end)
  if (base === '') return null
  const args = end === -1 ? '' : rest.slice(end + 1).trim()
  const mcp =
    args === MCP_MARK || (args.startsWith(MCP_MARK) && /\s/.test(args.charAt(MCP_MARK.length)))
  const sub = mcp || args === '' ? null : (args.split(/\s/)[0] ?? null)
  return { name: mcp ? `${base} ${MCP_MARK}` : base, base, sub }
}

/** The command the box holds: as typed, and whether the provider's list named it. */
export interface ACommandInTheBox {
  /** The command as typed — `/compact`. */
  readonly word: string
  /** ⚑ Whether the list named it; `false` when a list cut short only could not rule it out. */
  readonly listed: boolean
}

/**
 * 🔴 **The command a person's message would be, judged against the list this window HOLDS — or
 * `null`.**
 *
 * - ⛔ **No list (`set: null`) → `null`.** The host asks for one, or judges by shape; this window
 *   cannot know which, and a gate on a guess is `118`'s opposite defect.
 * - ⚑ **A list → the name must be on it** (by name or alias, or as the CLI's `name:first-argument`
 *   plugin retry), and it must be a `/` list: a `$` list never holds a `/` word.
 * - ⚠️ **A list cut short (`dropped`) → a name shaped like a command** may be a row it did not carry,
 *   and the host refuses it as one that merely *reads* as a command.
 */
export function aCommandInTheBox(text: string, commands: CommandRegistry): ACommandInTheBox | null {
  const set = commands.set
  if (set === null || set.prefix !== THE_SLASH) return null
  const named = theCommandItNames(text)
  if (named === null) return null
  const word = `${THE_SLASH}${named.name}`
  const on = (name: string): boolean =>
    set.commands.some((command) => command.name === name || (command.aliases ?? []).includes(name))
  if (on(named.name)) return { word, listed: true }
  if (named.sub !== null && on(`${named.base}:${named.sub}`)) return { word, listed: true }
  return commands.dropped > 0 && SHAPED_LIKE_A_COMMAND.test(named.base)
    ? { word, listed: false }
    : null
}

/**
 * 🔴 **The sentence beside the dark Send** — why it is dark, and what would light it.
 *
 * ⚠️ **The host's sentence LESS its last clause** — the host's is said AFTER a press and ends
 * *"Nothing has been sent."*; this one is said BEFORE any press, when nothing has been tried, so it
 * cannot say that. ⚑ Everything else is the host's word for word — the rule's clause, *a command
 * takes no attachments*, and the remedy — and `listed` decides how much it claims exactly as the
 * host's does: a word the list could only fail to rule out *reads as* a command.
 * `a-command-in-the-box.test.ts` §2 asserts the host's sentence IS this one and that clause, so the
 * two cannot drift apart.
 */
export function aCommandTakesNoAttachmentsYet(command: ACommandInTheBox): string {
  const what = command.listed
    ? `${command.word} is a command`
    : `${command.word} reads as a command (this conversation's command list could not confirm it)`
  return `${what}, and a command takes no attachments — remove them to run it, or send them in a message of their own.`
}
