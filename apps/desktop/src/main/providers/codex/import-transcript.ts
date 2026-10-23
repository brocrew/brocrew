import type { ResolveImagePath } from '../../archive/transcript-types'
import type { TranscriptEvent } from '../../../shared/runtime-ipc'
import { FileEdits, wrapUnknown } from '@brobot2/runtime'
import { codexMessageAsKept, splitCodexMessage } from './codex-injected'
import {
  truncate,
  type ImportedEntry,
  type ImportedTranscript,
} from '../../archive/transcript-types'

/**
 * Turn a Codex ROLLOUT file into the entries our ledger holds (036) — the counterpart to
 * `import-claude.ts`, and the thing 088 deferred with *"importing it would mean a second normalizer
 * written against a format nothing else here reads"*. It is written now because the same parser
 * that reads a finished rollout is the one that tails a running sub-agent's.
 *
 * ## It is NOT the app-server protocol
 *
 * `codex-runtime.ts` normalizes the JSON-RPC `thread/*` stream. A rollout is a different format
 * entirely — the CLI's own record — and that is why no existing code could be reused. Measured
 * against the 1,811 rollouts on this machine, every line is
 * `{type, timestamp, payload}` with four values of `type`:
 *
 * ```
 * session_meta    the thread's identity: {id, timestamp, cwd, originator, cli_version, git, …}
 * turn_context    {cwd, approval_policy, sandbox_policy, model, effort, summary} — per turn
 * response_item   the MODEL transcript: message | reasoning | function_call | function_call_output
 * event_msg       the CLI's own view: user_message | agent_message | agent_reasoning | token_count
 * ```
 *
 * ## `response_item` is read, and exactly one kind of `event_msg`
 *
 * `response_item` and `event_msg` OVERLAP: an assistant turn appears as both a
 * `response_item{message, role:'assistant'}` and an `event_msg{agent_message}`, and reasoning
 * appears as both `response_item{reasoning}` and `event_msg{agent_reasoning}`. Reading both would
 * render every message twice.
 *
 * `response_item` is the one to keep because it is the only one that is COMPLETE: tool calls
 * (`function_call`) and their results (`function_call_output`) appear there and nowhere else. A
 * transcript built from `event_msg` would be prose with the work missing — which is precisely the
 * misattribution 029 spent a task removing.
 *
 * ⚠️ **`image_generation_end` is the exception, and it is one because it does not overlap** (065,
 * closing 067's gap). A generated image appears as an `event_msg` and **nowhere else** — measured on
 * both rollouts that have one on this machine, and the reason a swept or re-derived Codex session
 * showed no pictures at all while the PNGs sat on disk the whole time. There is no
 * `response_item` to double it against, so reading it renders nothing twice.
 *
 * The rule this file follows is therefore not "only `response_item`". It is **read whatever is not
 * already said elsewhere**, and `event_msg` happens to be a duplicate of `response_item` for
 * everything except this.
 *
 * ## What it deliberately does not do
 *
 *  - **No lifecycle.** Like the Claude importer: the file records what was said, not a session
 *    machine's transitions. `session`/`turn`/`status` are the live adapter's to emit.
 *  - **No deltas.** The file holds finished messages; the partial stream was never written to it.
 *  - **No status inference.** A rollout that stops is a file that stops. See `session-reader.ts`.
 */

type Record_ = Record<string, unknown>

function isRecord(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: unknown, key: string): string {
  const value = isRecord(source) ? source[key] : undefined
  return typeof value === 'string' ? value : ''
}

/** Epoch ms from the line's own ISO-8601 `timestamp`, or null when it does not carry a readable one. */
function parseAt(record: Record_): number | null {
  const raw = record['timestamp']
  if (typeof raw !== 'string') return null
  const at = Date.parse(raw)
  return Number.isNaN(at) ? null : at
}

/**
 * The text of a `message` payload. Codex spells the block types by DIRECTION —
 * `input_text` on the way in, `output_text` on the way back — and both carry `text`. Anything else
 * (images, refusals) contributes nothing rather than being stringified into the conversation.
 * ⚑ R1 finds an imported turn by it too (`turn-as-sent.ts`): one rule for the turn and its finding.
 */
export function messageText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (!isRecord(block)) continue
    const type = block['type']
    if (type !== 'input_text' && type !== 'output_text' && type !== 'text') continue
    if (typeof block['text'] === 'string') text += block['text']
  }
  return text
}

/**
 * The first line of a reasoning payload's summary — the same "a count, or a summary, never invented
 * words" rule 027 set. `content` is usually null and `encrypted_content` is opaque by design; only
 * `summary[].text` is anything a reader could be shown.
 */
function reasoningText(payload: Record_): string {
  const summary = payload['summary']
  if (!Array.isArray(summary)) return ''
  let text = ''
  for (const part of summary) {
    if (isRecord(part) && typeof part['text'] === 'string') text += part['text']
  }
  return text
}

/**
 * A shell call's command, for the row's summary. `arguments` is a JSON STRING (not an object), and
 * a malformed one yields the raw string rather than throwing: an unreadable argument list is still
 * evidence that the call happened.
 */
function callSummary(payload: Record_): string {
  const raw = readString(payload, 'arguments')
  if (!raw) return ''
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return raw
    const command = parsed['command']
    if (Array.isArray(command)) return command.filter((c) => typeof c === 'string').join(' ')
    if (typeof command === 'string') return command
    return raw
  } catch {
    return raw
  }
}

/** The `output` of a `function_call_output`, which is itself a JSON string wrapping `{output}`. */
function outputSummary(payload: Record_): string {
  const raw = payload['output']
  if (typeof raw !== 'string') return typeof raw === 'undefined' ? '' : JSON.stringify(raw)
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && typeof parsed['output'] === 'string') return parsed['output']
    return raw
  } catch {
    return raw
  }
}

/** One line's events, in source order. */
function lineEvents(payload: Record_): TranscriptEvent[] {
  switch (payload['type']) {
    case 'message': {
      // The saved methods' lines in this app's own lead are the agent's words, which no record keeps.
      const message = codexMessageAsKept(payload)
      const text = messageText(message['content'])
      if (!text) return []
      // Role decides WHOSE words these are, and getting it wrong is the one unrecoverable error
      // here: an environment block Codex injects is not something the user typed.
      if (message['role'] === 'assistant') return [{ type: 'assistant_message', text }]
      // ⛔ **This used to end here, with a `user_turn` for EVERY non-assistant role** (214 §2, from
      // 213 finding 2). The comment that stood in this spot predicted the defect and shipped it
      // anyway: *"the test is `role !== 'assistant'`, so EVERY role Codex ever adds — and every role
      // a writer of this file invents — speaks in the user's name by default."* Measured on 120 real
      // rollouts, that is 822 `developer` lines plus 704 injected `user` ones: **1,526 messages
      // rendered as "You (per the transcript)"** ahead of a one-line prompt.
      //
      // ⚑ **`splitCodexMessage` decides; this only spends its answer** — and it spends it the way
      // `import-claude.ts` has since 074: the harness's words are `unknown{echo}`, which is out of
      // both transcript modes and whole in the Events tab, and the person's words are the user turn.
      const parts = splitCodexMessage(message['role'], text)
      const events: TranscriptEvent[] = []
      // The WHOLE line as `raw`, not the preamble alone: Events shows what the file holds, and a
      // trimmed copy there would be this importer editing the record it exists to carry. Only the
      // saved methods' lines are kept out of it, as above.
      if (parts.injected) {
        events.push(wrapUnknown('codex', message, 'echo', 'injected context') as TranscriptEvent)
      }
      // Marked for the same reason the Claude importer marks its own (074, from 069 §2.4): this
      // file is the only source, and a file inside a provider home is writable by anything that
      // reaches it. The mark says *a file claimed this*; the split above says *and this part of it
      // was not even claimed of you*.
      if (parts.said !== null) {
        events.push({ type: 'user_turn', text: parts.said, attribution: 'provider_transcript' })
      }
      return events
    }
    case 'reasoning': {
      const text = reasoningText(payload)
      // A reasoning item with nothing readable is still a statement that it thought — the same
      // distinction 027 draws between "no words" and "no thinking".
      return [{ type: 'thinking', phase: 'complete', ...(text ? { text } : { redacted: true }) }]
    }
    case 'function_call': {
      const id = readString(payload, 'call_id')
      if (!id) return []
      return [
        {
          type: 'tool_call',
          id,
          name: readString(payload, 'name') || 'tool',
          summary: callSummary(payload),
        },
      ]
    }
    case 'function_call_output': {
      const id = readString(payload, 'call_id')
      if (!id) return []
      // No `ok` on the wire here: a rollout records the output, not whether the caller judged it a
      // success. Reported as ok rather than guessing a failure that was never stated.
      return [{ type: 'tool_result', id, summary: outputSummary(payload), ok: true }]
    }
    default:
      return []
  }
}

export interface CodexImportOptions {
  resolveImage?: ResolveImagePath | undefined
}

/**
 * The longest `call_id` an image item may carry before it is refused as malformed.
 *
 * Both measured ids are 28 and 41 characters (`call_FefXSBqxpzAw3EgxSeGZt6gC`,
 * `exec-297ad8c6-8e4e-403d-a8af-4d6a5e025cb2`), and the format caps nothing. 200 is generous enough
 * that no real id could reach it and small enough that the value can never become a payload.
 */
const MAX_IMAGE_ID_CHARS = 200

/**
 * A generated image, from the one `event_msg` that is not a duplicate of anything (065/067).
 *
 * ⚠️ **The feature is which field is NOT read.** The measured lines are 2.15 MB and 2.92 MB, and
 * essentially all of it is `result` — the whole PNG as base64. Three small reads and it is never
 * touched: the id, the path claim and the prompt come out, and the bytes stay in the provider's
 * file where the verbatim copy belongs. The same rule `codex/normalize.ts` follows on the live wire, for
 * the same reason: the provider hands us the picture twice, and the useful copy is the file.
 *
 * `call_id` is the id, and it is the id BECAUSE it is the filename: both files on disk are named
 * `<call_id>.png` — `call_FefXSBqxpzAw3EgxSeGZt6gC.png` and `exec-297ad8c6-….png`. So the same value
 * that identifies the item is the one the naming convention looks a file up by.
 */
function imageEvent(payload: Record_, resolveImage?: ResolveImagePath): TranscriptEvent[] {
  const imageId = readString(payload, 'call_id')
  // No id is no image: there is nothing to name it by and nothing to look a file up with. Dropped
  // rather than surfaced as `unknown{raw}` — that path would drag the base64 back in, which is the
  // one thing this whole function exists not to do.
  //
  // ⚠️ **And an absurd id is treated the same way** (review). Unlike `revised_prompt` below, an id
  // cannot be truncated — a shortened id is a WRONG id, naming a file that is not the one meant. So
  // it is refused instead, at a bound two orders of magnitude above the measured 28-character
  // values. Without it the string rides unbounded into the ledger, across IPC for the life of the
  // session, and into a filesystem path — the exact retention 052 spent a task removing, through a
  // field nobody thought to cap because ids are short in every file anybody has looked at.
  if (!imageId || imageId.length > MAX_IMAGE_ID_CHARS) return []
  const savedPath = readString(payload, 'saved_path')
  const path = resolveImage?.({ imageId, ...(savedPath ? { savedPath } : {}) }) ?? null
  // Bounded like every other provider string that becomes a caption: 745 and 915 characters in the
  // two measured cases, with nothing in the format capping it.
  const prompt = truncate(readString(payload, 'revised_prompt').trim())
  return [
    {
      type: 'image',
      imageId,
      ...(path ? { path } : {}),
      ...(prompt ? { prompt } : {}),
    },
  ]
}

/**
 * The whole rollout, in order. Same contract as {@link importClaudeTranscript}: raw lines in,
 * `{at, event}` out, and `unreadable` counts lines that were not JSON at all rather than hiding
 * them.
 *
 * `fallbackAt` is REQUIRED for the same reason it is there: a file naming no time would otherwise
 * render a confident "12:00 AM" on every line of a conversation dated to 1970.
 */
export function importCodexRollout(
  frames: string[],
  fallbackAt: number,
  options: CodexImportOptions = {},
): ImportedTranscript {
  const entries: ImportedEntry[] = []
  let unreadable = 0
  let lastAt = fallbackAt

  for (const frame of frames) {
    if (frame.trim() === '') continue
    let record: unknown
    try {
      record = JSON.parse(frame)
    } catch {
      unreadable += 1
      continue
    }
    if (!isRecord(record)) {
      unreadable += 1
      continue
    }
    const at = parseAt(record)
    if (at !== null) lastAt = at
    const payload = record['payload']
    if (!isRecord(payload)) continue
    // `event_msg` is otherwise a DUPLICATE of what `response_item` already says, and rendering it
    // quietly would render every assistant message twice — but a generated image appears here and
    // NOWHERE else, so skipping the whole line type was 067's missing picture. Named exactly, so a
    // second `event_msg` kind cannot arrive through the same door by accident.
    if (record['type'] === 'event_msg') {
      if (payload['type'] !== 'image_generation_end') continue
      for (const event of imageEvent(payload, options.resolveImage))
        entries.push({ at: lastAt, event })
      continue
    }
    // `session_meta`/`turn_context` are configuration, and the reader surfaces the meta separately
    // rather than as a line of conversation.
    if (record['type'] !== 'response_item') continue
    for (const event of lineEvents(payload)) entries.push({ at: lastAt, event })
  }

  // 096: Codex's file changes come off `turn/diff/updated`, which is self-contained per line, so
  // there is nothing in flight to carry — an empty registry says exactly that. The field is on the
  // shared shape because both importers return it; only one has state to keep.
  return { entries, unreadable, lastAt, edits: new FileEdits() }
}

/** What a rollout says about itself, from its `session_meta` line. Null when it has none. */
export interface CodexRolloutMeta {
  threadId: string
  cwd: string
  at: number | null
}

/**
 * Read the identity line without parsing the whole file — the reader needs it to bind a rollout to
 * a thread, and a rollout can be megabytes.
 */
export function readCodexRolloutMeta(frames: string[]): CodexRolloutMeta | null {
  for (const frame of frames) {
    if (frame.trim() === '') continue
    let record: unknown
    try {
      record = JSON.parse(frame)
    } catch {
      continue
    }
    if (!isRecord(record) || record['type'] !== 'session_meta') continue
    const payload = record['payload']
    if (!isRecord(payload)) continue
    const threadId = readString(payload, 'id')
    if (!threadId) return null
    return { threadId, cwd: readString(payload, 'cwd'), at: parseAt(record) }
  }
  return null
}
