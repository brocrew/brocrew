import {
  truncate,
  type ImportedEntry,
  type ImportedTranscript,
} from '../../archive/transcript-types'
import {
  assistantErrorWords,
  FileEdits,
  THE_CLIS_OWN_MODEL,
  wrapUnknown,
  type RuntimeEvent,
} from '@brobot2/runtime'
import type { TranscriptEvent } from '../../../shared/runtime-ipc'

/**
 * Turn Claude's own transcript records into the entries our ledger holds (088), so an adopted
 * session shows the conversation it already had instead of an empty chat.
 *
 * **The records are SDK messages in an envelope** — measured across every real transcript on this
 * machine, not assumed. An `assistant` record's `message` is the same `{role, content:[blocks]}`
 * the live adapter normalizes, and a `user` record's is too. The envelope adds file bookkeeping
 * (`uuid`, `parentUuid`, `cwd`, `sessionId`, `timestamp`, `version`, `gitBranch`, …) which the
 * mapping ignores.
 *
 * The file also holds record types the SDK never sends — `queue-operation`, `attachment`,
 * `last-prompt`, `ai-title` — which are the CLI's own bookkeeping. They are classified as chatter
 * rather than dropped or shouted about: the provider's file keeps them verbatim either way, and a
 * transcript that screamed about six `queue-operation`s would bury the conversation (049).
 *
 * What it deliberately does NOT do:
 *  - **invent lifecycle.** The file has no `session`/`turn`/`status` records, so none are written.
 *    An imported ledger is the conversation, and the replay path adds nothing to it.
 *  - **invent deltas.** The file stores finished messages; the live stream's partial deltas were
 *    never written to it. An imported transcript therefore reads as complete messages — which is
 *    what the provider itself kept.
 *
 * The mapping of the two SDK-shaped record types is pinned against the runtime's own normalizer
 * in `import-claude.test.ts`, over the real transcripts, so the two cannot quietly diverge.
 */

/** One archived line, parsed. Anything unparseable never reaches here. */
type Record_ = Record<string, unknown>

/**
 * The whole file, in order. Ordinals are assigned by the caller when it writes the ledger, so a
 * record that maps to two entries (text, then a tool call) simply yields two.
 *
 * **The times are the provider's**, parsed from each record's own ISO-8601 `timestamp` — an
 * imported conversation should read as having happened when it happened, not when it was
 * imported. Measured on the real transcripts: 25 of 27 records carry one, and the two that do not
 * are the CLI's own bookkeeping (`ai-title`, `last-prompt`). Those inherit the last time seen,
 * which is the most that can be said truthfully about a record that does not say: it happened at
 * or after the thing before it. `fallbackAt` covers a file that names no time at all, and is
 * REQUIRED: defaulting it to 0 would quietly date such a conversation to January 1970 and render
 * a confident "12:00 AM" on every line of it.
 */
export function importClaudeTranscript(
  frames: string[],
  fallbackAt: number,
  carry?: FileEdits,
): ImportedTranscript {
  const entries: ImportedEntry[] = []
  let unreadable = 0
  let at = fallbackAt
  // 096: which file edits are in flight, across records. An adopted conversation's Changes tab was
  // empty no matter how many files it edited — this file deliberately re-implements the normalizer
  // rather than calling it (see the header), so the live path's `file_change` emission did not come
  // along for free. Review found it; the line-at-a-time conformance pass could not, because both
  // sides were silent. Carried in and out for the same reason `lastAt` is — see the field.
  const edits = carry ?? new FileEdits()

  for (const frame of frames) {
    let record: Record_
    try {
      record = JSON.parse(frame) as Record_
    } catch {
      unreadable++
      continue
    }
    at = recordTime(record) ?? at
    for (const event of recordToEvents(record, edits)) entries.push({ at, event })
  }

  return { entries, unreadable, lastAt: at, edits }
}

/** The record's own time, or null if it does not carry a readable one. */
function recordTime(record: Record_): number | null {
  const raw = record['timestamp']
  if (typeof raw !== 'string') return null
  const parsed = Date.parse(raw)
  // An unparseable timestamp is worse than none: it would silently become NaN and sort a message
  // to nowhere. Treated as absent, so the previous time carries forward.
  return Number.isFinite(parsed) ? parsed : null
}

function recordToEvents(record: Record_, edits: FileEdits): TranscriptEvent[] {
  switch (record['type']) {
    case 'assistant':
      return assistantEvents(record, edits)
    case 'user':
      return userEvents(record, edits)
    // The CLI's own bookkeeping. Quiet, classified, and still carried whole.
    case 'queue-operation':
    case 'last-prompt':
      return [chatter(record, 'lifecycle')]
    case 'ai-title':
    case 'attachment':
      return [chatter(record, 'activity')]
    default:
      // Something we have never seen in a transcript. Loud on purpose: a new record type is
      // exactly the thing that should be looked at rather than filed away (049).
      return [chatter(record, 'unrecognized')]
  }
}

/**
 * An assistant record, in SOURCE ORDER: a run of text is flushed whenever a tool interrupts it,
 * so `[text, tool, text]` never collapses into one message with the tool moved in front of it
 * (058). This mirrors the live normalizer, which the conformance test holds it to.
 */
function assistantEvents(record: Record_, edits: FileEdits): TranscriptEvent[] {
  const events: TranscriptEvent[] = []
  const content = messageContent(record)
  // ⛔ **No sub-agent attribution is made here** — see the block above {@link summarizeToolInput},
  // where `subAgentParent` used to be. The key it read exists in none of the 13,862 native
  // transcripts on this machine (131, ruling 130's §3).
  let run = ''
  const flush = (): void => {
    if (run) events.push({ type: 'assistant_message', text: run })
    run = ''
  }

  if (typeof content === 'string') {
    run = content
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        run += block['text']
      } else if (block['type'] === 'tool_use' && typeof block['id'] === 'string') {
        flush()
        const name = typeof block['name'] === 'string' ? block['name'] : 'tool'
        events.push({
          type: 'tool_call',
          id: block['id'],
          name,
          summary: summarizeToolInput(name, block['input']),
        })
        edits.called(block['id'], name, block['input'])
      }
    }
  }
  flush()

  const message = record['message']
  const error = isRecord(message) ? record['error'] : undefined
  // ⚑ The CLI's own message, marked as an error by a word or — on a record with none — by the
  // `isApiErrorMessage` the archive carries (680's review: a notice can arrive with no word).
  const theClis = isRecord(message) && message['model'] === THE_CLIS_OWN_MODEL
  const theClisNotice =
    theClis && (typeof error === 'string' || record['isApiErrorMessage'] === true)
  if (typeof error === 'string' || theClisNotice) {
    // 🔴 **A refusal is not the speaker's words here EITHER, for every error word** (680, PM ruling
    // R28a — 110 found this for the credential word alone). The live path decides by the frame's
    // marker, `model: "<synthetic>"`, and so does this: the archived record carries it too (110
    // read it there, with `usage` all zeroes). ⛔ Not by "one text block and nothing else", which the
    // model's partial reply before a `max_output_tokens` notice also is — and that one names its real
    // model and keeps its text. The provider's whole sentence rides on `message` (R28b); our words stand in only when
    // the record held no notice at all.
    //
    // ⚠️ **No `refusal` values, and that is the ruling's own fallback rather than a gap** (R28c): the
    // version the CLI ran is read from a live `system/init`, which a file does not replay — so an
    // imported refusal is shown as the provider's sentence, never with guessed advice.
    let notice = ''
    if (theClisNotice) {
      const theModels = events.filter((event) => event.type !== 'assistant_message')
      notice = events
        .flatMap((event) => (event.type === 'assistant_message' ? [event.text] : []))
        .join('\n')
      events.length = 0
      events.push(...theModels)
    }
    // ⚠️ **Deliberately NOT the live path's `fatal` + `auth_stale`, and this is the one divergence.**
    // Those say two things about a session we launched: that the child cannot recover, because we
    // know it holds a snapshot token it cannot refresh, and that reopening THIS conversation fixes
    // it. Neither is knowable about a file. An archived record may come from a `claude` CLI session
    // that refreshed itself and carried on, and marking it fatal would end the transcript at a line
    // the session survived — hiding everything after it.
    //
    // ⚠️ The conformance pass in `raw-archive-import.test.ts` holds this file's output equal to the
    // live normalizer's, and its fixture contains no record with an `error` field. If one is ever
    // added it will go red HERE, on `fatal`/`cause` and nothing else — the divergence is this
    // paragraph, not a mistake to be fixed by making the two agree.
    events.push({
      type: 'error',
      message: notice.trim()
        ? notice
        : assistantErrorWords(typeof error === 'string' ? error : 'unknown'),
      fatal: false,
    })
  }
  return events
}

/**
 * A `user` record is two different things in one type, which is why this is not just the live
 * normalizer's `user` case:
 *
 *  - **tool results** coming back from the harness — array content with `tool_result` blocks. The
 *    live path produces exactly these, and so does this.
 *  - **what the person actually typed** — STRING content, and only string content. The live path
 *    produces nothing for these, because live it is the HOST that records our own turn (084).
 *    Replaying a file has no host to ask, so the record itself is the only source: it becomes the
 *    same `user_turn` entry the live path would have written, which is what makes an imported
 *    transcript read like a conversation rather than a monologue.
 *
 * A user record whose content is an ARRAY of text blocks is neither: measured across the real
 * transcripts, those are the harness speaking in the user's name — `[Request interrupted by
 * user]` and the like. They are carried as chatter. Rendering one as a user bubble would put
 * words in someone's mouth that they never typed, which is the exact failure this file is
 * otherwise built to avoid.
 */
function userEvents(record: Record_, edits: FileEdits): TranscriptEvent[] {
  const content = messageContent(record)

  if (typeof content === 'string') {
    return content.trim() === '' ? [] : [userTurn(record, content)]
  }
  if (!Array.isArray(content)) return []

  const events: TranscriptEvent[] = []
  let injected = false
  for (const block of content) {
    if (!isRecord(block)) continue
    if (block['type'] === 'tool_result' && typeof block['tool_use_id'] === 'string') {
      const ok = block['is_error'] !== true
      events.push({
        type: 'tool_result',
        id: block['tool_use_id'],
        summary: summarizeToolResult(block['content']),
        ok,
      })
      const edit = edits.settled(block['tool_use_id'], ok)
      if (edit) events.push({ type: 'file_change', changes: [edit.change], source: edit.tool })
    } else if (block['type'] === 'text' && typeof block['text'] === 'string') {
      injected = true
    }
  }
  // Kept, classified, and not spoken: the record is carried whole in `raw`, so nothing is lost.
  if (injected) events.unshift(chatter(record, 'echo'))
  return events
}

/**
 * `isMeta` marks context injected by the harness in the user's name. Keep its content as chatter so it is not rendered as words the person typed.
 */
function userTurn(record: Record_, text: string): TranscriptEvent {
  return record['isMeta'] === true
    ? chatter(record, 'echo')
    : // ⚠️ **Marked, because this app did not watch it happen** (074, from 069 §2.4). Everything the
      // block above says about `isMeta` and about array content is a filter on WHICH lines get to
      // speak in the user's name; none of them is evidence that the person typed the one that got
      // through. This file is the only source, and a file inside the provider home is writable by
      // anything that reaches it. So the provenance travels WITH the turn — see
      // `UserTurnEvent.attribution`, and `UserMessage.vue`, which is where a reader finally sees it.
      { type: 'user_turn', text, attribution: 'provider_transcript' }
}

/**
 * Through `wrapUnknown` rather than built literally (052), because that is where the size bound on
 * `unknown{raw}` lives. An imported record is provider data of unknown size like any other — a
 * transcript on disk can hold the same multi-megabyte payload a live stream can — and a second way
 * to construct the variant would be a second way to skip the ceiling. The structural check that no
 * production source builds the variant directly lives in `unknown-payload-bound.test.ts`.
 */
function chatter(
  record: Record_,
  category: 'lifecycle' | 'activity' | 'echo' | 'unrecognized',
): Extract<RuntimeEvent, { type: 'unknown' }> {
  const label = typeof record['type'] === 'string' ? record['type'] : 'record'
  return wrapUnknown('claude', record, category, label) as Extract<
    RuntimeEvent,
    { type: 'unknown' }
  >
}

function messageContent(record: Record_): unknown {
  const message = record['message']
  return isRecord(message) ? message['content'] : undefined
}

/* The two summarizers below mirror the runtime's, and the conformance test asserts they agree
   over every tool call in every real transcript — an imported tool card must read exactly like
   the live one it is standing in for. */

/*
 * ## Why there is no `subAgentParent` here (131, ruling 130's §3)
 *
 * There was one, from 029, and 128 gave it a second consumer. It read `record.parent_tool_use_id`
 * off the envelope *"exactly as it does on the live SDK message"* — and that sentence was the
 * whole mistake. **A native transcript is not an SDK message.** Measured twice, once by 130 and
 * once again here before removing anything:
 *
 * | key                    | files, of the 13,862 `.jsonl` under `~/.claude/projects` |
 * |------------------------|----------------------------------------------------------|
 * | `parent_tool_use_id`   | **0**                                                    |
 * | `parentToolUseID`      | **0** — 128's own claim about disk, refuted             |
 * | `parentToolUseId`      | **0**                                                    |
 *
 * Zero again over the **107** files discovery can actually reach. 136 re-measured the corpus after
 * it had grown — **13,900** files, 110 immediate and 13,790 nested — and found zero of all three
 * keys again.
 *
 * ⚠️ **THREE production call sites, not four** (136 correcting 131's inventory). They are the
 * child-work viewer (`runtime-host.ts`), the disk-reader helper (`session-reader.ts`) and the
 * derivation (`derive-ledger.ts`). The import from a provider home **is not a fourth**: it calls
 * `deriveLedger`, which calls this. All three parse lines off disk. **No live envelope
 * has ever reached this parser**, so the lookup could not fire and the two spreads it fed could not
 * either.
 *
 * ⚠️ **And every one of them imports ONE file per call**, which is the fact 136 found the
 * conformance test contradicting — see `raw-archive-import.test.ts`.
 *
 * ⛔ **The test said otherwise, and that is why this is a removal rather than a comment.** The
 * conformance case manufactured the live shape and handed the same invented records to both
 * normalizers, proving equality on its own fixture. An inert feature plus a test claiming coverage
 * is worse than neither: it is a reason not to look again.
 *
 * ## What attribution would actually cost here
 *
 * The parentage exists on disk, in a shape nothing in this file can see. A child's own record says
 * `isSidechain: true` and carries an `agentId`, **in a different file** —
 * `<parent>/subagents/agent-<agentId>.jsonl` — and the mapping from that `agentId` to the
 * dispatching tool-use id lives in the parent transcript's Agent result and task notification. So
 * it is a two-FILE join, and a key rename would not begin it:
 *
 *  - discovery reads only immediate `<project>/*.jsonl` (`adopt/discover-sessions.ts`);
 *  - an import deliberately excludes the nested subagent transcripts, and they are **13,755 of the
 *    13,862 files on this machine** — 99.2%, ~1.33 GB it has always been out of scope for;
 *  - `child-work.ts` opens those files through a separate resolver, one child at a time, on request.
 *
 * That is a feature with an import-scope decision inside it, not a fix. The live path is unaffected:
 * `normalize.ts` has its own `subAgentParent` reading the real SDK envelope, it works, and post-
 * `c7b6096` ledger rows prove it survives normalization and persistence.
 */

function summarizeToolInput(name: string, input: unknown): string {
  if (isRecord(input)) {
    const command = input['command']
    if (typeof command === 'string') return truncate(command)
    const filePath = input['file_path']
    if (typeof filePath === 'string') return filePath
    // Parity with the live normalizer (029): a sub-agent dispatch carries only
    // `{description, prompt, subagent_type}`, so without this it fell to a JSON dump.
    const description = input['description']
    if (typeof description === 'string' && description) return truncate(description)
  }
  try {
    return truncate(JSON.stringify(input) ?? name)
  } catch {
    return name
  }
}

/**
 * ⚑ **675 · the live normalizer's rule, mirrored**: the row is the first text part that says
 * anything, so a rebuilt ledger draws the same row the live one did — an app tool answers its prose
 * and then its payload as two blocks, and a join would weld the JSON onto every short answer.
 */
function summarizeToolResult(content: unknown): string {
  const first = textParts(content).find((part) => part.trim() !== '')
  return first === undefined ? 'done' : truncate(first)
}

function textParts(content: unknown): readonly string[] {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const block of content) {
    if (isRecord(block) && block['type'] === 'text' && typeof block['text'] === 'string') {
      parts.push(block['text'])
    }
  }
  return parts
}

function isRecord(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null
}
