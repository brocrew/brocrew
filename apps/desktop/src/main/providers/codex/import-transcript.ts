import type { TranscriptEvent } from '../../../shared/conversation-events'
import type { ResolveImagePath } from '../../archive/transcript-types'

import { wrapUnknown } from '@brobot2/runtime'
import { splitCodexMessage } from './codex-injected'
import {
  truncate,
  type ImportedEntry,
  type ImportedTranscript,
} from '../../archive/transcript-types'

/**
 * Turn a Codex rollout file into the entries our ledger holds, the counterpart to
 * `claude/import-transcript.ts`. The same parser reads a finished rollout and tails a running
 * sub-agent's.
 *
 * A rollout is the CLI's own record, not the app-server protocol `codex-runtime.ts` normalizes. Each
 * line is `{type, timestamp, payload}` with `type` one of `session_meta`, `turn_context`,
 * `response_item` (the model transcript: message, reasoning, function_call, function_call_output)
 * and `event_msg` (the CLI's own view).
 *
 * `response_item` is read because it is complete: tool calls and their results appear only there.
 * `event_msg` duplicates it (messages and reasoning would render twice), except
 * `image_generation_end`, which appears nowhere else. The rule is to read whatever is not already
 * said elsewhere.
 *
 * It emits no lifecycle (the file records what was said, not session transitions), no deltas (only
 * finished messages are written) and no status inference (a rollout that stops is a file that
 * stops; see `session-reader.ts`).
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
 * The first line of a reasoning payload's summary; never invented words. `content` is usually null
 * and `encrypted_content` is opaque, so only `summary[].text` can be shown.
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
      const text = messageText(payload['content'])
      if (!text) return []

      if (payload['role'] === 'assistant') return [{ type: 'assistant_message', text }]

      const parts = splitCodexMessage(
        payload['role'],
        text,
        payload['internal_chat_message_metadata_passthrough'],
      )
      const events: TranscriptEvent[] = []

      if (parts.injected) {
        events.push(wrapUnknown('codex', payload, 'echo', 'injected context') as TranscriptEvent)
      }

      if (parts.said !== null) {
        events.push({ type: 'user_turn', text: parts.said, attribution: 'provider_transcript' })
      }
      return events
    }
    case 'reasoning': {
      const text = reasoningText(payload)
      // A reasoning item with nothing readable still says it thought, so it is marked redacted.
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
      // A rollout records the output, not whether the caller judged it a success, so ok is assumed.
      return [{ type: 'tool_result', id, summary: outputSummary(payload), ok: true }]
    }
    default:
      return []
  }
}

export interface CodexImportOptions {
  resolveImage?: ResolveImagePath | undefined
}

/** The longest `call_id` an image item may carry before it is refused as malformed. Real ids are under 50 characters. */
const MAX_IMAGE_ID_CHARS = 200

/**
 * A generated image, from the one `event_msg` that duplicates nothing. The `result` field is the
 * whole PNG as base64 (megabytes) and is never read; only the id, the path claim and the prompt
 * are, and the bytes stay in the provider's file. `call_id` is the id because the provider names
 * the file `<call_id>.png`.
 */
function imageEvent(payload: Record_, resolveImage?: ResolveImagePath): TranscriptEvent[] {
  const imageId = readString(payload, 'call_id')
  // No id is no image, so nothing to name or look up. Dropped rather than surfaced as
  // `unknown{raw}`, which would pull the base64 back in. An oversized id is refused too: it cannot
  // be truncated (a shortened id names the wrong file) and would otherwise ride unbounded into the
  // ledger, over IPC and into a filesystem path.
  if (!imageId || imageId.length > MAX_IMAGE_ID_CHARS) return []
  const savedPath = readString(payload, 'saved_path')
  const path = resolveImage?.({ imageId, ...(savedPath ? { savedPath } : {}) }) ?? null
  // Bounded like every other provider string that becomes a caption.
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
 * `{at, event}` out, and `unreadable` counts lines that were not JSON. `fallbackAt` is required so
 * a file naming no time does not render a confident "12:00 AM" dated to 1970.
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
    // `event_msg` duplicates `response_item`, except a generated image, which appears only here.
    // Named exactly so a second `event_msg` kind cannot arrive through the same door.
    if (record['type'] === 'event_msg') {
      if (payload['type'] !== 'image_generation_end') continue
      for (const event of imageEvent(payload, options.resolveImage))
        entries.push({ at: lastAt, event })
      continue
    }
    // `session_meta`/`turn_context` are configuration; the reader surfaces the meta separately.
    if (record['type'] !== 'response_item') continue
    for (const event of lineEvents(payload)) entries.push({ at: lastAt, event })
  }

  // Codex file changes come off `turn/diff/updated`, self-contained per line, so there is no state
  // to carry. The field exists because both importers return the shared shape.
  return { entries, unreadable, lastAt, edits: undefined }
}

/** What a rollout says about itself, from its `session_meta` line. Null when it has none. */
export interface CodexRolloutMeta {
  threadId: string
  cwd: string
  at: number | null
}

/** Read the identity line without parsing the whole file, which can be megabytes. */
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
