import { didIt } from '../../../shared/who-did-it'
// ⛔ **`READING_NOTE` is the SHARED copy** — the host returns the same string on the answer, and
// two spellings is how the artefact comes to promise something the popup does not.
import { THE_APP_IS_THE_AUTHOR } from '../../../shared/app-notice'
import { READING_NOTE } from '../../../shared/runtime-ipc'
// ⛔ **The author words the SCREEN draws** — see `AUTHOR`, where `624`'s ruling is argued.
import { GO_AHEAD_SENDER } from './plan-mode'
import { THE_GO_AHEAD_WAS_NOT_SENT } from '../../../shared/the-go-ahead'
import { AN_UNNAMED_RELAYER, RELAYED_MARK } from './relayed-turn'
import { WORK_REPORT_MARK } from './work-report'
import type { HistoryWindow, PersistedEventInfo } from '../../../shared/runtime-ipc'
import { toldClause, type TranscriptItem } from './transcript'
// ⚑ **The ONE public fold** — see `readWholeConversation`. ⛔ Not a second reader of the ledger.
import { foldWindow } from './transcript-window'

/**
 * Compose a readable conversation export from the UI's own fold.
 *
 * > ⚑ ***"I need a way to export a conversation into text (so I can have the PO read the
 * > conversation). It should be an md file that shows the same as what the ui shows… however,
 * > including the mcp tool calls and bash commands should be an option."***
 *
 * ## ⛔ Why it lives HERE, in the renderer, beside the fold
 *
 * ⚠️ **"The same as what the UI shows" is `TranscriptItem[]`**, and that is what `applyEvent`
 * produces. ⛔ **`HO-095` §4 — *never two sources of truth*** — so the export does not re-read the
 * ledger into a second shape of its own: it takes the items the screen is made of and arranges
 * them.
 *
 * 🔴 **And it re-derives almost nothing, which is what makes that claim checkable.** Every item
 * already carries the words the screen draws — `text`, `summary`, `note` — so the switch below is a
 * LAYOUT over strings the fold produced, not a second reading of the events. ⚑ Where it does reach
 * for a shared fold (`didIt`), it is the same one the components reach for.
 *
 * ## ⚠️ What this module is NOT
 *
 * ⛔ **It does not read the ledger and it does not write a file.** It is pure over
 * `TranscriptItem[]`, so it is testable with no host, no database and no window — and the two
 * things it cannot do are exactly the two the renderer may not do.
 *
 * ## 🔴 The exhaustive switch is the point
 *
 * ⛔ **Every member of `TranscriptItem` is named below.** ⚑ A new item kind cannot ship without
 * somebody deciding what a person reads in the export — which is
 * `a-closed-vocabulary-guards-what-a-member-says` applied to a projection rather than to a rail,
 * and it is why the `default` arm is a compile-time `never` rather than a shrug.
 */

/**
 * The export option controls one tool-activity category.
 *
 * ## ⛔ Measured: `mcp tool calls` and `bash commands` are one item kind
 *
 * ⚠️ **`TranscriptItem` has a single `tool` kind and the provider's tool NAME is what tells them
 * apart** — `BackgroundCommand` says so in its own words: *"The tool's own name, as `ToolEntry`
 * prints it — `Bash`, `Agent`."* ⛔ So a switch per thing he named would be two spellings of one
 * predicate, free to disagree the first time somebody added a third tool family.
 *
 * ## ⛔ And it is NOT `TranscriptMode`, which is the toggle the brief asked me to check
 *
 * 🔴 **`isVisibleIn` keeps `tool` rows in BOTH modes** — only a `superseded` one drops — because
 * that toggle cleaves on LIFECYCLE CHROME: `notice` at `info` and the `unknown` payloads the
 * runtime classified `lifecycle`. ⚠️ **`211` §4 moved it there deliberately**, after a debug view
 * that showed everything drowned a plan in 208 repeated markers.
 *
 * Use a separate axis from transcript mode because the export groups activity differently. Omit details readers do not need while preserving information they may need to act on.
 */
export interface ReadableOptions {
  /**
   * ⚑ **Whether the tool activity is in the file** — every `tool` row, MCP and shell alike.
   *
   * ⛔ **Default OFF, and `633` §7 is why**: the primary case is the PO reading a conversation and
   * the debug case is the option. *"If a design choice trades prose quality for diagnostic
   * completeness, choose prose and put the completeness behind the toggle."*
   */
  readonly toolActivity: boolean
}

/** ⚠️ **Said in the file when the option was off**, so a reader is never left inferring silence. */
export const TOOL_ACTIVITY_WAS_LEFT_OUT =
  '_Tool calls and shell commands were left out of this export._'

/** ⚑ **…and the opposite, so the file always states which of the two it is.** */
export const TOOL_ACTIVITY_IS_INCLUDED = '_Tool calls and shell commands are included below._'

/**
 * 🔴 **Who a row is FROM, RENDERED from the constants the screen renders** (633 §3.2, `624`).
 *
 * ## ⛔ Not a table of my own words, and `624` is why
 *
 * ⚠️ **The first draft of this table headed the app's own row `BroBot`, and that is the exact
 * thing `624` corrected.** ⛔ `THE_APP_IS_THE_AUTHOR`'s own note carries the PO's words:
 * *"And the app sent it, not BroBot"* — and the argument beneath them, which is about this
 * artefact as much as about the screen:
 *
 * > ⛔ ***"BroBot is an AGENT in the conversation this carrier lands in… so a row headed BroBot
 * > inside BroBot's conversation claims the agent wrote words it in fact RECEIVED."***
 *
 * 🔴 **So every heading here is a constant the SCREEN already draws**, which is standing rule 8 at
 * the one place `633` §3.2 says it bites: *"an export that flattens everything into `user:` /
 * `assistant:` would undo `624` in the one artefact the PO reads."* ⚑ A heading written here would
 * be a second spelling, free to disagree with the conversation it claims to reproduce.
 *
 * ⚠️ **`user` and `assistant` have no constant of their own**, because the screen draws them as
 * layout rather than as a named author — so those two are this module's, and they are the two no
 * ruling has ever been made about.
 */
const AUTHOR: Readonly<Record<string, string>> = {
  // ⚑ A0 · a person is `You`, as the screen's own held row says it (`QueuedMessage.vue`), never a name.
  user: 'You',
  assistant: 'the agent',
  thinking: 'the agent (thinking)',
  // ⚑ **`plan-mode.ts`' own constant, whose docblock argues the name**: this row is *BroBot
  // speaking FOR the person*, which is a different act from the app reporting.
  continuation: GO_AHEAD_SENDER,
  // 🔴 **624's ruling, and it is `This app` rather than `BroBot`** — see the block above.
  appNotice: THE_APP_IS_THE_AUTHOR,
  // ⚠️ **`work-report.ts`' own mark, carried verbatim.** `624` swept it, reported it and left it
  // — *"renaming a row this dispatch does not own is a ruling about what the product calls
  // itself"* — so this export reproduces what the screen says rather than deciding for it.
  workReport: WORK_REPORT_MARK,
  queued: 'You',
  // ⚑ **`relayed-turn.ts`' own word for a relayer this app cannot name**, and the mark beside it
  // is the one the screen puts on the row.
  relayed: AN_UNNAMED_RELAYER,
}

const heading = (who: string, at: number | undefined): string =>
  at === undefined ? `### ${who}` : `### ${who} · ${new Date(at).toISOString()}`

const block = (who: string, at: number | undefined, body: string): string =>
  `${heading(who, at)}\n\n${body.trim()}\n`

/**
 * 🔴 **The whole conversation, not the window the reader is looking at** (633 §2.1).
 *
 * ## ⛔ The measurement that forced this door to exist
 *
 * The live window releases history beyond `WINDOW_MAX_EVENTS` (5,000), so it may hold only part of a longer conversation. Export must read the whole history separately rather than assume the current window is complete.
 *
 * 🔴 **So "compose from what the UI is showing" would export a SLAB and call it a conversation** —
 * the silent truncation `633` §2.1 forbids by name. ⚑ This pages back to the beginning through the
 * door the UI already scrolls with, so there is still exactly one projection and it is fed
 * everything.
 *
 * ## ⚠️ Page-fetchers rather than the store, and that is what makes it testable
 *
 * ⛔ **It takes two functions and touches no global.** A caller wires `window.api.runtime`; a test
 * hands it two arrays. ⚑ The renderer's own `session-store` is not imported here at all — this
 * module stays pure over its arguments, exactly as its note says.
 *
 * ## ⛔ It REFUSES rather than truncating, with the number in it
 *
 * ⚑ `read-bundle.ts`' discipline, copied: *"Nothing is silently truncated: past this size the
 * answer is `no`, with the size in it."* ⚠️ The bound here is a count of EVENTS rather than bytes,
 * because that is what this loop accumulates and what a caller can act on.
 */
export const MAX_READABLE_EVENTS = 200_000

export type WholeConversation =
  | { readonly ok: true; readonly items: readonly TranscriptItem[]; readonly events: number }
  | { readonly ok: false; readonly reason: string }

export async function readWholeConversation(input: {
  readonly sessionId: string
  readonly liveFrom: number | null
  readonly latest: (said: { sessionId: string }) => Promise<HistoryWindow>
  readonly earlier: (said: { sessionId: string; before: number }) => Promise<HistoryWindow>
}): Promise<WholeConversation> {
  const newest = await input.latest({ sessionId: input.sessionId })
  let entries: PersistedEventInfo[] = [...newest.entries]
  let from = newest.from
  let hasOlder = newest.hasOlder
  // ⚠️ **A guard on the LOOP and not only on the total.** A `hasOlder` that never goes false — a
  // page that answers the same cursor twice — would spin for ever; the count is what stops it, and
  // it is the same number the refusal names.
  while (hasOlder) {
    if (entries.length > MAX_READABLE_EVENTS) {
      return {
        ok: false,
        reason:
          `this conversation is more than ${String(MAX_READABLE_EVENTS)} events, and BroCrew ` +
          'composes a readable export in one piece',
      }
    }
    const older = await input.earlier({ sessionId: input.sessionId, before: from })
    // ⛔ **An empty page with `hasOlder` still true is a door that cannot answer**, and saying so
    // is better than looping — `34`'s rule: a check that cannot run and one that found nothing look
    // identical, so this one says which.
    if (older.entries.length === 0) {
      return { ok: false, reason: 'this conversation could not be read back to its beginning' }
    }
    entries = [...older.entries, ...entries]
    from = older.from
    hasOlder = older.hasOlder
  }
  // ⚑ **The ONE public fold**, over every event rather than over a window — `foldWindow` is what
  // the live transcript is built with, and `liveFrom` is applied inside it for `064`'s reason.
  const state = foldWindow(
    entries.map((entry) => ({
      sessionId: input.sessionId,
      ordinal: entry.ordinal,
      at: entry.at,
      event: entry.event,
    })),
    input.liveFrom,
  )
  return { ok: true, items: state.items, events: entries.length }
}

/**
 * 🔴 **One conversation, as Markdown.**
 *
 * ⚠️ **`items` is the WHOLE conversation's fold and this function does not check that.** ⛔ The
 * renderer's live window holds at most `WINDOW_MAX_EVENTS` and releases past it, so a caller that
 * handed it `session.window.entries` would export a slab and call it a conversation. ⚑
 * `readWholeConversation` is the door that reads every page; this takes what it produced.
 */
export function composeReadable(
  title: string,
  items: readonly TranscriptItem[],
  options: ReadableOptions,
): string {
  const lines: string[] = [
    `# ${title}`,
    '',
    `_${READING_NOTE}_`,
    '',
    options.toolActivity ? TOOL_ACTIVITY_IS_INCLUDED : TOOL_ACTIVITY_WAS_LEFT_OUT,
    '',
  ]
  for (const item of items) {
    const said = readableItem(item, options)
    if (said !== null) lines.push(said)
  }
  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * ⛔ **What ONE item reads as, or `null` when it is not content a person reads.**
 *
 * ⚠️ **`null` is a decision per kind and never a fall-through.** ⚑ The arms that answer it are the
 * ones whose fact is already on the screen twice or is pure machinery — and each says so.
 */
function readableItem(item: TranscriptItem, options: ReadableOptions): string | null {
  switch (item.kind) {
    // ── the words, and whose they are ──────────────────────────────────────────────────────────
    case 'user':
      return block(AUTHOR.user ?? 'You', item.at, item.text)
    case 'assistant':
      return block(AUTHOR.assistant ?? 'the agent', item.at, item.text)
    // ⚑ **`continuation` is BroBot's own words that really started a turn** (`278` §1), and
    // `transcript-mode.ts` shows it in both modes for that reason. ⛔ It is not chrome.
    case 'continuation':
      return block(AUTHOR.continuation ?? GO_AHEAD_SENDER, item.at, item.text)
    // Keep the app notice in the app's voice in exports, matching the UI instead of attributing it to the person.
    case 'appNotice':
      return block(AUTHOR.appNotice ?? THE_APP_IS_THE_AUTHOR, item.at, item.text)
    case 'workReport':
      return block(AUTHOR.workReport ?? WORK_REPORT_MARK, item.at, item.text)
    // ⚠️ **A relayed message says it was relayed**, because `HO-009` §2.2 makes *relayed from user*
    // the authorization — so who it came from is the load-bearing half of the row.
    case 'relayed':
      return block(
        `${item.relayedFromProfile ?? AUTHOR.relayed ?? AN_UNNAMED_RELAYER} · ${RELAYED_MARK}`,
        item.at,
        item.text,
      )
    // Export whether held words were sent or cancelled; cancelled words never reached the agent. Match the author of the delivered reply, notice, relay or go-ahead instead of attributing every queued message to the person.
    case 'queued':
      return block(
        // ⛔ **The REPORT first, as the screen heads it** (`688`'s review): a child's reply is held
        // with its report AND its relayer, and `QueuedMessage` heads it by the piece — asking the
        // relay first signed BroBot's sentence about the reply as the child's words.
        item.report !== undefined
          ? (AUTHOR.workReport ?? WORK_REPORT_MARK)
          : item.relayed === true
            ? `${item.relayedFromProfile ?? AUTHOR.relayed ?? AN_UNNAMED_RELAYER} · ${RELAYED_MARK}`
            : item.appNotice !== undefined
              ? (AUTHOR.appNotice ?? THE_APP_IS_THE_AUTHOR)
              : item.goAhead === true
                ? (AUTHOR.continuation ?? GO_AHEAD_SENDER)
                : (AUTHOR.queued ?? 'You'),
        item.at,
        // ⚑ **688 · R33** — a go-ahead taken back says the act and what followed, in main's words.
        // ⚠️ The FACT half only: an export is read after the conversation, where *type your next
        // message* instructs nobody.
        `${item.text}\n\n_${
          item.outcome === null
            ? 'waiting to be sent'
            : item.goAhead === true && item.outcome === 'cancelled'
              ? `you took it back — ${THE_GO_AHEAD_WAS_NOT_SENT}`
              : `this message was ${item.outcome}`
        }${
          // ⚑ **701 · and WHY, where the row says why** (`690`'s GAP) — `retracted` always carries
          // the app's reason, and an `abandoned` one can; the screen draws both as *not sent · …*.
          // ⚠️ Only an ENDING carries a detail (the fold sets it from `message_unqueued`), so a
          // waiting row never meets this arm.
          item.detail === undefined ? '' : ` — ${item.detail}`
        }._`,
      )
    // ⚠️ **Thinking is the agent's and it is SHOWN on screen** (`027` made it a first-class item),
    // so it is in the export — under a heading that says which it is.
    case 'thinking':
      return item.redacted
        ? block(AUTHOR.thinking ?? 'the agent (thinking)', item.at, '_(redacted by the provider)_')
        : block(AUTHOR.thinking ?? 'the agent (thinking)', item.at, item.text)

    // ── the cards, and their outcomes — §3.1's *questions asked* ────────────────────────────────
    // ⚑ **A question asked of a person, and the answer.** ⚠️ The DETAIL is what approving
    // authorizes (`071`) and it belongs in a debugging artefact rather than in prose — so it rides
    // with the tool option, which is the same axis.
    case 'permission': {
      const asked = item.request.summary ?? item.request.action
      const detail = options.toolActivity ? `\n\n\`\`\`\n${item.request.detail}\n\`\`\`` : ''
      const answer =
        item.refused !== null
          ? item.refused
          : item.outcome === null
            ? 'waiting on a person.'
            : `answered ${item.outcome}${item.by === undefined ? '' : ` by ${didIt(item.by)}`}.`
      return block('a question for a person', item.at, `${asked}${detail}\n\n_${answer}_`)
    }
    case 'userInput': {
      const answer =
        item.refused !== null
          ? item.refused
          : item.answered === null
            ? 'waiting on a person.'
            : `${item.answered}${item.by === undefined ? '' : ` by ${didIt(item.by)}`}.`
      return block('a question for a person', item.at, `${item.request.prompt}\n\n_${answer}_`)
    }

    // ── the tool activity — the OPTION ─────────────────────────────────────────────────────────
    // ⛔ **One kind for MCP calls and shell commands alike**, which is the measurement this
    // module's own note records. ⚠️ **A superseded row is out of BOTH arms**, because
    // `transcript-mode.ts` already rules it is the same fact twice and the screen shows it in
    // neither mode — including it here would be the export disagreeing with the screen.
    case 'tool': {
      if (!options.toolActivity || item.superseded === true) return null
      const outcome = item.unfinished === true ? 'did not finish' : (item.result?.summary ?? null)
      return block(
        `tool · ${item.name}`,
        item.at,
        outcome === null ? item.summary : `${item.summary}\n\n_${outcome}_`,
      )
    }
    // ⚑ **A sub-agent card is tool activity by a different name** — it is what one tool call
    // produced — so it rides the same switch rather than a second one.
    case 'subAgent':
      return options.toolActivity
        ? block(
            `sub-agent · ${item.card.title ?? item.card.kind ?? item.card.agentId}`,
            item.at,
            item.card.summary ??
              (item.card.running
                ? '_running._'
                : `_${item.card.outcome ?? 'no summary was reported'}._`),
          )
        : null

    // ── content that is neither prose nor a card ───────────────────────────────────────────────
    // ⚠️ **A plan is what the agent said it would do**, and the screen shows it in both modes.
    case 'plan': {
      const steps = item.steps.map((step) => `- [${step.status}] ${step.text}`).join('\n')
      return block(
        'the agent’s plan',
        item.at,
        item.body === undefined ? steps : `${item.body}\n\n${steps}`,
      )
    }
    // ⛔ **A notice at `info` is lifecycle chrome and the reading view drops it** — so this export
    // drops it too, in both arms. ⚑ `warn` and `error` STAY, for `transcript-mode.ts`' own reason:
    // a failed turn, a rate-limit notice and a stall warning all live there, and *a user who
    // cannot see those is being lied to by omission*.
    case 'notice':
      // ⚑ **685 · with what a refused call was told** — the notice's own clause, the one the screen
      // draws. ⚠️ **A refused OUTGOING call carries none**: its act is on its card, and the card is a
      // tool row, which the default export leaves out with every other (`633` §7).
      // ⚑ F035 · …except the scheduled job that woke a turn, which the screen shows in both modes.
      return item.level === 'info' && item.wokenByAJob !== true
        ? null
        : block(
            `This app · ${item.level}`,
            item.at,
            `${item.text}${toldClause(item.told, item.toldInPart === true)}`,
          )
    // ⚠️ **A compaction is the moment earlier turns left the model's head**, which is content by
    // `transcript-mode.ts`' own argument — and a reader of a long conversation needs to know it
    // happened.
    case 'compaction':
      return block(
        'the conversation was compacted',
        item.at,
        '_earlier turns left the model’s context._',
      )
    case 'reset':
      return block(
        'the conversation was reset',
        item.at,
        '_the provider started this thread over._',
      )
    // ⚑ **An image is a path and not bytes** — `216`'s ruling that this app hands over a path and
    // never opens it, carried into the export unchanged.
    case 'image':
      return block(
        'an image',
        item.at,
        item.path === undefined ? `_(image ${item.imageId})_` : `\`${item.path}\``,
      )
    // 🔴 **Memory rows are content and they are the subject of a live PO document** (`EXT-015`).
    // ⛔ A conversation exported for the PO with the memory rows missing would be missing the
    // thing `HO-095` §3's whole chain ended in.
    case 'memoryNote':
      return block(
        'the agent wrote to its memory',
        item.at,
        item.notes.map((note) => `- \`${note.path}\``).join('\n'),
      )
    case 'memoryRecall':
      return block(
        'the agent recalled from its memory',
        item.at,
        item.entries
          .map(
            (entry) => `- \`${entry.path}\`${entry.note === undefined ? '' : ` — ${entry.note}`}`,
          )
          .join('\n'),
      )
    case 'memoryLoaded':
      return block(
        'this conversation opened with memory in the prompt',
        item.at,
        `\`${item.index}\` — ${String(item.beside)} more in that store when this app looked.`,
      )
    // ⛔ **An UNRECOGNISED payload stays loud and a recognised one does not** — which is
    // `transcript-mode.ts`' own split, and `a surprise swallowed is the whole point of that
    // variant`. ⚠️ The raw payload rides the tool option, because that is what it is for.
    case 'unknown':
      return item.category !== 'unrecognized' && !options.toolActivity
        ? null
        : block(
            `${item.provider} · ${item.label ?? item.category}`,
            item.at,
            options.toolActivity
              ? `\`\`\`json\n${JSON.stringify(item.raw, null, 2)}\n\`\`\``
              : '_an unrecognised payload._',
          )
    default: {
      // ⛔ **The compile-time exhaustiveness, and it is the whole discipline of this module.** A
      // new `TranscriptItem` member cannot ship until somebody has decided what a person reads.
      const exhaustive: never = item
      void exhaustive
      return null
    }
  }
}
