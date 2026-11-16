import type { TranscriptEvent } from '../../../shared/conversation-events'
import type { ImportedEntry, ImportedTranscript } from '../../archive/transcript-types'
import {
  assistantErrorWords,
  FileEdits,
  summarizeToolInput,
  summarizeToolResult,
  takeAssistantNotice,
  THE_CLIS_OWN_MODEL,
} from '@brobot2/runtime/claude'
import { wrapUnknown, type RuntimeEvent } from '@brobot2/runtime'

type Record_ = Record<string, unknown>

export function importClaudeTranscript(
  frames: string[],
  fallbackAt: number,
  carry?: object,
): ImportedTranscript {
  const entries: ImportedEntry[] = []
  let unreadable = 0
  let at = fallbackAt
  const edits = (carry as FileEdits | undefined) ?? new FileEdits()

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

function recordTime(record: Record_): number | null {
  const raw = record['timestamp']
  if (typeof raw !== 'string') return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : null
}

function recordToEvents(record: Record_, edits: FileEdits): TranscriptEvent[] {
  switch (record['type']) {
    case 'assistant':
      return assistantEvents(record, edits)
    case 'user':
      return userEvents(record, edits)
    case 'queue-operation':
    case 'last-prompt':
      return [chatter(record, 'lifecycle')]
    case 'ai-title':
    case 'attachment':
      return [chatter(record, 'activity')]
    default:
      return [chatter(record, 'unrecognized')]
  }
}

function assistantEvents(record: Record_, edits: FileEdits): TranscriptEvent[] {
  const events: TranscriptEvent[] = []
  const content = messageContent(record)
  const message = record['message']
  const final =
    isRecord(message) &&
    message['stop_reason'] === 'end_turn' &&
    record['error'] === undefined &&
    record['aborted'] !== true &&
    (typeof content === 'string' ||
      (Array.isArray(content) &&
        !content.some((block) => isRecord(block) && block['type'] === 'tool_use')))
  let run = ''
  const flush = (): void => {
    if (run)
      events.push({
        type: 'assistant_message',
        text: run,
        ...(final ? { phase: 'final' as const } : {}),
      })
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

  const error = isRecord(message) ? record['error'] : undefined
  const theClis = isRecord(message) && message['model'] === THE_CLIS_OWN_MODEL
  const theClisNotice =
    theClis && (typeof error === 'string' || record['isApiErrorMessage'] === true)
  if (typeof error === 'string' || theClisNotice) {
    const notice = theClisNotice ? takeAssistantNotice(events) : ''
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
  if (injected) events.unshift(chatter(record, 'echo'))
  return events
}

function userTurn(record: Record_, text: string): TranscriptEvent {
  return record['isMeta'] === true
    ? chatter(record, 'echo')
    : { type: 'user_turn', text, attribution: 'provider_transcript' }
}

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

function isRecord(value: unknown): value is Record_ {
  return typeof value === 'object' && value !== null
}
