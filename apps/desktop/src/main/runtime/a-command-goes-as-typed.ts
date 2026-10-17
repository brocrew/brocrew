import type { ProviderCommandAnswer } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { providerName } from '../../shared/runtime-ipc'
import type { TurnOrigin } from './turn-origin'

/**
 * 🔴 **708 · `R42` — a person's command goes to the provider exactly as typed.**
 *
 * ## ⛔ The ruling, pasted whole (`708` §1)
 *
 * > **R42 · A person's command goes to the provider exactly as typed.** A message a PERSON sends
 * > whose first word is `/<name>`, where `<name>` is a command the provider has published for this
 * > conversation (the same list the palette offers), goes to the provider **as the person typed
 * > it**: no sender line, no direction line, no task line, nothing prepended or appended. A command
 * > is consumed by the CLI; a model never reads it, so a frame around it is not an attribution, it
 * > is what stops the command from running. `607`'s frame stays on every other message.
 * > ⛔ **A person's only.** An agent's message that begins with `/clear` or `/compact` stays framed:
 * > an agent never clears or compacts another conversation by sending it a message.
 * > ⚑ **Where the provider has not published its list yet**, ask for it (bounded). If the list
 * > still cannot be had, a message shaped like a command goes out as typed. One message without its
 * > sender line costs less than a command that does nothing while a model says it did.
 * > ⚑ **A command with attachments** is refused at the door, with a sentence the person reads saying
 * > a command takes no attachments. It is never sent with its attachment block, and never sent
 * > without telling them.
 *
 * ## 🔴 The defect it closes, measured (`704` §4)
 *
 * ⛔ **Since `607` the host framed every message a person typed**, so the Claude CLI received
 * *"Sent by a person, typed into this app. … /compact"* — and a slash command is a command only at
 * the START of the input. Nothing was compacted, and on `/clear` the model answered *"Conversation
 * context cleared."* while nothing was cleared. Steps 62 and 70 of `smoke:ui` blamed the provider
 * for it for three days.
 *
 * ## ⚑ "First word" is the CLI's
 *
 * ⚠️ **Not a guess at what a command looks like.** The CLI takes a prompt as a command when it
 * starts with `/` once trimmed; the name is what follows the slash up to the first whitespace, and
 * it is looked up by name, by user-facing name, or by alias. ⚑ **One more
 * branch of the same parser** (708's review): an MCP prompt is published as `server:prompt (MCP)`
 * and typed `/server:prompt (MCP) …`, and the CLI joins that ` (MCP)` back onto the name — see
 * {@link theCommandItNames}. And an unknown name with arguments is retried as `name:first-argument`
 * — how a plugin's sub-command is typed (`/myplugin review` runs `myplugin:review`) — which
 * {@link aPersonsCommand} mirrors. Its own shape test for a name is {@link LOOKS_LIKE_A_COMMAND}.
 * ⚠️ **Two forms the CLI resolves and the published list does not carry, stated rather than
 * guessed at**: an MCP prompt's internal name (`/mcp__server__prompt`) and, until CLI 2.1.281, a
 * resource template (`/server:scheme://…` — 2.1.287 no longer resolves that form). With the list
 * known they keep the frame, and so do not run.
 * ⛔ **So a path such as `/Users/me/notes` is not one** — its "name" contains a `/` — and it keeps
 * the frame even when no list can be had.
 *
 * ## 🔴 What "a model never reads it" is true of — and what it is not (708's review)
 *
 * ⚠️ **The ruling's reason is true of a BUILT-IN command** — `/clear`, `/compact` — which the CLI
 * consumes. ⛔ **It is not true of a PROMPT command**: a skill or a custom command such as
 * `/code-review` is expanded by the CLI into a turn a model DOES read, the person's arguments
 * included, and `/compact <instructions>` hands its instructions to the summarising model. ⚑ Both go
 * without the sender line now, which `R42` accepts as its price — reported to the PM by `708` as a
 * finding about `HO-088` §4, and ⚑ **settled by `R58` (713)**: *"R42's price is accepted… the
 * `person` stamp rides in its own field… ⛔ An agent's message is still always framed."*
 *
 * ## ⚠️ What this module is NOT
 *
 * ⛔ **Not a rail.** It decides which string a person's own words travel as; it grants nothing and
 * refuses nothing an agent could reach. ⚑ **The half that matters for safety is the `who` test**,
 * and it is {@link TurnOrigin}'s positive `a-person` arm — an agent's `/clear` is framed however
 * the words are spelled, because the words never move `from` (`662`'s rule, one layer up).
 */

/** ⚑ **`R42`'s own character** — the rule says `/<name>`, and `$` skills are not in its scope. */
export const THE_SLASH = '/'

/**
 * ⛔ **The CLI's own test for a command name**: a letter, digit or `_`, then only letters, digits,
 * `:`, `_` and `-`.
 *
 * ⚑ **It is what "shaped like a command" means when no list can be had** (`R42`'s third clause):
 * the CLI's own shape test, so a path — whose "name" carries a further `/` — is never one. ⚠️ **Not
 * the CLI's whole question**: an unknown name that passes this is still sent as a prompt when `/<name>`
 * exists on disk (`/tmp is full`), which a host cannot ask of the child's filesystem. Such a message
 * goes without its sender line when no list can be had — `R42`'s price, stated.
 */
export const LOOKS_LIKE_A_COMMAND = /^[a-zA-Z0-9_][a-zA-Z0-9:_-]*$/

/**
 * ⚑ **The CLI's marker for an MCP prompt**, which follows the name as a separate word: the CLI
 * joins it back onto the name when the arguments are that marker, or start with it and a space.
 */
const MCP_MARK = '(MCP)'

/**
 * ⚑ **The command a message's first word names, as the CLI reads it — or `null`.**
 *
 * ⛔ **Trimmed first, then the slash**: the CLI trims the input before it looks for the slash, so a
 * leading space does not stop a command and must not stop this either. The name
 * runs to the first whitespace; what follows is the command's arguments and travels with it.
 *
 * - `name` — what the CLI looks the command up by: the first word, with ` (MCP)` joined back on when
 *   the arguments are that marker or start with it (see {@link MCP_MARK}).
 * - `base` — the first word alone, which is what {@link LOOKS_LIKE_A_COMMAND} is asked of.
 * - `sub` — the first argument, or `null`: what the CLI's plugin retry joins on (`base:sub`).
 */
export function theCommandItNames(
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

/**
 * 🔴 **The whole of `R42`'s decision: the command a person's message IS, or `null`.**
 *
 * - ⛔ **Not a person → `null`.** An agent's turn and the app's own sentences keep what they had.
 * - ⚑ **A list is known → the name must be on it**, by name or alias, and the list must be a `/`
 *   list: Codex publishes `$` skills (`279`), so a `/` word is never one of them. ⚠️ **Unless the
 *   list was cut short** (`dropped`): a missing name may be one of the rows it could not carry, so it
 *   is asked the shape question instead.
 * - ⚠️ **No list could be had → the provider's own prefix must be `/` and the name must be shaped
 *   like a command** — {@link LOOKS_LIKE_A_COMMAND}.
 *
 * ⚑ **`word` is the command as typed** (`/compact`), and **`listed` says whether the provider's list
 * named it** — the refusal sentence claims only what was known.
 */
export function aPersonsCommand(
  text: string,
  from: TurnOrigin | null,
  /** The list this conversation's provider published or answered with; `null` when none could be had. */
  heard: ProviderCommandAnswer | null,
  /** The provider's own prefix — `PROVIDER_COMMAND_PREFIX[provider]`, known without any list. */
  prefix: string,
): { readonly word: string; readonly listed: boolean } | null {
  if (from === null || from.who !== 'a-person') return null
  const named = theCommandItNames(text)
  if (named === null) return null
  const word = `${THE_SLASH}${named.name}`
  const shaped = LOOKS_LIKE_A_COMMAND.test(named.base)
  if (heard === null) {
    return prefix === THE_SLASH && shaped ? { word, listed: false } : null
  }
  if (heard.prefix !== THE_SLASH) return null
  const on = (name: string): boolean =>
    heard.commands.some(
      (command) => command.name === name || (command.aliases ?? []).includes(name),
    )
  const published = on(named.name)
  if (published) return { word, listed: true }
  // ⚑ **The CLI's plugin retry**: an unknown name with arguments is looked up as `name:first`.
  if (named.sub !== null && on(`${named.base}:${named.sub}`)) return { word, listed: true }
  return (heard.dropped ?? 0) > 0 && shaped ? { word, listed: false } : null
}

/**
 * ⛔ **Whether a person's message could be a command at all — asked BEFORE the list is.**
 *
 * ⚑ **The cheap half, so the provider is asked only when the answer can matter**: a message that is
 * not a person's, or does not start with a slash, or goes to a provider whose commands are not `/`
 * commands, cannot be one whatever the list says.
 */
export function mightBeAPersonsCommand(
  text: string,
  from: TurnOrigin | null,
  prefix: string,
): boolean {
  return (
    from !== null &&
    from.who === 'a-person' &&
    prefix === THE_SLASH &&
    theCommandItNames(text) !== null
  )
}

/**
 * 🔴 **The sentence a person reads when a command carries attachments** (`R42`'s fourth clause).
 *
 * ⚑ **It names the command and ends on the fact they need**: nothing was sent. ⚠️ **Where the words
 * go next differs by door**: a send hands them back to the box (`019`); a held message that met this
 * at its flush is ended with this as its reason, and its row offers them back. ⚑ **It says what to do
 * rather than only what is wrong** — `239`'s rule that the way forward is stated in the refusal.
 *
 * ⛔ **`listed` decides how much it claims**: a command the provider's list named IS one; a word the
 * host judged only by its shape — no list could be had, or the list was cut short — merely reads
 * as one, and the sentence says so rather than calling `/etc` a command. ⚠️ **One sentence for both
 * of those causes, so it names neither**: *could not confirm it* is true of a list that never came
 * and of one that came without this name's row (708's second review).
 */
export function aCommandTakesNoAttachments(word: string, listed: boolean): string {
  const what = listed
    ? `${word} is a command`
    : `${word} reads as a command (this conversation's command list could not confirm it)`
  return (
    `${what}, and a command takes no attachments — remove them to run it, or send them in a ` +
    `message of their own. Nothing has been sent.`
  )
}

/**
 * ⛔ **The refusal, as a CLASS** — so the flush can tell it from a refusal that clears on its own.
 *
 * ⚠️ **A queued message the gate refuses is left queued and tried again at the next idle**, which is
 * right for *"not signed in yet"* and wrong for this: the same words and the same files meet the
 * same refusal at every boundary. ⚑ So {@link RuntimeHost.runFlush} ends it with this sentence,
 * as it ends a message whose file has gone.
 */
export class ACommandTakesNoAttachments extends Error {
  constructor(
    readonly word: string,
    readonly listed: boolean,
  ) {
    super(aCommandTakesNoAttachments(word, listed))
    this.name = 'ACommandTakesNoAttachments'
  }
}

/** ⚑ **713 · the word `R59` is about** — `/compact`, without its slash. */
export const THE_COMPACTION = 'compact'

/**
 * 🔴 **713 · `R59` — a person's typed `/compact`, on a conversation that compacts on request.**
 *
 * ## ⛔ The ruling, pasted whole (`713` §1)
 *
 * > **R59 (`708` H-2) · A person's typed `/compact` on Codex runs Codex's compaction.** It goes to
 * > `thread/compact/start`, never to the model as words. Typing it is the person's confirmation. The
 * > transcript shows the compaction the way it shows Claude's. `/compact <instructions>` on Codex:
 * > measure whether `thread/compact/start` takes instructions. If it does not, refuse at the door
 * > with a sentence saying Codex compacts without instructions, and never drop them silently.
 *
 * ## ⚑ What was measured (`probe:codex-command-as-typed`, bundled Codex 0.146.0)
 *
 * - ⛔ **A `/compact` MESSAGE compacts nothing**, framed or bare: the model answers the words
 *   (`708`). Codex's app-server has no slash commands (`279`).
 * - ⚑ **`thread/compact/start` runs one** — as a turn of its own, whose `contextCompaction` item is
 *   the compaction row Claude's `compact_boundary` also becomes.
 * - ⛔ **It takes no instructions.** Its params type is `{ threadId }`, and an `instructions` field
 *   was ACCEPTED and dropped: no request the model was sent carried the marker. ⚑ So they are
 *   refused here, in words, rather than lost there in silence — {@link aCompactionTakesNoInstructions}.
 *
 * ## ⚠️ "On Codex" is asked of the ADAPTER, never of the provider's name
 *
 * ⛔ **This function says only that a person's words ARE a `/compact`** — and what followed it, as
 * `instructions`, or `null` for anything else. The host asks whether the
 * conversation's handle has `SessionHandle.compact` — Codex's does; Claude's does not, because the
 * CLI compacts on its own `/compact`, which `R42` sends exactly as typed, instructions and all
 * (`R58`). ⚑ An agent's `/compact` is framed words on both: `from` never moves for the spelling.
 */
export function aPersonsCompaction(
  text: string,
  from: TurnOrigin | null,
): { readonly word: string; readonly instructions: string | null } | null {
  if (from?.who !== 'a-person') return null
  const named = theCommandItNames(text)
  if (named === null || named.base !== THE_COMPACTION) return null
  const rest = text
    .trim()
    .slice(THE_SLASH.length + THE_COMPACTION.length)
    .trim()
  return { word: `${THE_SLASH}${THE_COMPACTION}`, instructions: rest === '' ? null : rest }
}

/**
 * 🔴 **713 · the sentence a person reads when their `/compact` carries instructions the provider
 * cannot take** (`R59`'s last clause).
 *
 * ⚑ **It names the provider, says what would have happened, says what to do, and ends on the fact
 * they need** — the shape of {@link aCommandTakesNoAttachments}. ⚠️ **The name is rendered, never
 * written** (rule 8.2): `R59` is about Codex today, and the sentence is about whichever conversation
 * the door refused.
 */
export function aCompactionTakesNoInstructions(provider: Provider): string {
  return (
    `${providerName(provider)} compacts without instructions, so they would be dropped — send ` +
    `${THE_SLASH}${THE_COMPACTION} on its own to compact now. Nothing has been sent.`
  )
}

/**
 * ⛔ **713 · that refusal, as a CLASS** — so a caller and a test can tell it by type.
 *
 * ⚠️ **Not for {@link ACommandTakesNoAttachments}'s flush reason**: a held message never meets it.
 * The queue's own gate refuses `/compact <instructions>` before anything is held, and a
 * conversation's handle — which decides whether the rule applies — is fixed for its life, so the
 * flush's gate can only repeat the queue's answer. `RuntimeHost.runFlush` has no arm for it.
 */
export class ACompactionTakesNoInstructions extends Error {
  constructor(readonly provider: Provider) {
    super(aCompactionTakesNoInstructions(provider))
    this.name = 'ACompactionTakesNoInstructions'
  }
}
