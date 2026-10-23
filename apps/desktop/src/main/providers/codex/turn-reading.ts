import type { AsSentPart, AsSentRecord } from '../../../shared/turn-as-sent'
import {
  TurnAsked,
  TurnReading,
  isRecord,
  asText,
  kept,
  blocksIn,
  parsed,
  whatItLeavesOut,
  notInTheRecord,
} from '../../archive/turn-reading'
import { THIS_CONVERSATION_HEADER, WHAT_CHANGED_HEADER } from '../../runtime/instruction-headings'
import { codexMessageAsKept, codexTextAsKept, splitCodexMessage } from './codex-injected'
import { messageText } from './import-transcript'
// ──────────────────────────────────────────────── what each part is ───

/** Conversation headers recognized in recorded Codex messages. */
const THIS_CONVERSATION_LINES = [
  THIS_CONVERSATION_HEADER,
  'Composed by BroBot for this conversation at this launch:',
] as const

const THIS_CONVERSATION_CHANGED_LINES = [
  WHAT_CHANGED_HEADER,
  'Composed by BroBot for this conversation at this launch. These sections replace the ones of the same name you were given earlier in this conversation:',
] as const

/** ⚑ Codex's own blocks, known by how they begin, in plain words. */
const CODEX_TITLES: readonly (readonly [string, string])[] = [
  ['## Memory', 'Codex’s memory instructions, with this agent’s memory summary'],
  ['<skills_instructions>', 'The skills Codex offers'],
  ['<permissions instructions>', 'Codex’s sandbox and approval rules'],
  ['<collaboration_mode>', 'Codex’s collaboration mode'],
  ['<multi_agent_role>', 'Codex’s note on the sub-agents it can start'],
  ['<multi_agent_mode>', 'Codex’s rule on when to start sub-agents'],
  [
    '<environment_context>',
    'The environment, as Codex describes it: the folder, shell, date and sandbox',
  ],
]

// ──────────────────────────────────────────────── Codex ───

/** Codex's records it keeps for itself, never sent to the model as text. */
const CODEX_NOT_SENT = new Set(['turn_context', 'world_state', 'token_usage_record'])

/** Codex's own events about a turn, never sent to the model. */
const CODEX_EVENTS_NOT_SENT = new Set([
  'task_started',
  'task_complete',
  'turn_aborted',
  'item_started',
  'item_completed',
  'token_count',
  'thread_settings_applied',
  'user_message',
  'agent_message',
  'agent_message_delta',
  'agent_reasoning',
  'agent_reasoning_delta',
  'agent_reasoning_raw_content',
  'exec_command_begin',
  'exec_command_end',
  'exec_command_output_delta',
  'patch_apply_begin',
  'patch_apply_end',
  'mcp_tool_call_begin',
  'mcp_tool_call_end',
  'web_search_begin',
  'web_search_end',
  'plan_update',
  'background_event',
])

/** Codex's own output in a turn: the model has answered, so what it got is whole. */
const CODEX_OUTPUT = new Set([
  'reasoning',
  'function_call',
  'custom_tool_call',
  'local_shell_call',
  'web_search_call',
  'tool_search_call',
])

export function readingCodex(asked: TurnAsked): TurnReading {
  /** How many of {@link TurnAsked.before} have taken their records. */
  let taken = 0
  /** The rule of the message the next matching record would be: an earlier one, else this turn. */
  const next = (): TurnAsked['by'] => asked.before[taken] ?? asked.by
  let state: 'looking' | 'in-turn' | 'done' = 'looking'
  let message: string | null = null
  let version: string | null = null
  /** The provider conversation the lines are in now, as its `session_meta` names it. */
  let life: string | null = null
  const standing: AsSentPart[] = []
  /** This turn's parts and records so far — the turn the message turns out to be in. */
  let parts: AsSentPart[] = []
  let records: AsSentRecord[] = []
  const startTurn = (): void => {
    parts = []
    records = []
  }
  return {
    line(text) {
      if (state === 'done') return 'done'
      if (text.trim() === '') return 'more'
      const record = parsed(text)
      if ('unreadable' in record) {
        records.push({ label: 'a line that is not JSON', kind: 'unknown', raw: kept(text) })
        return 'more'
      }
      const type = asText(record['type'])
      const payload = isRecord(record['payload']) ? record['payload'] : {}
      const kind = asText(payload['type'])
      if (type === 'session_meta') {
        life = asText(payload['id']) || life
        version = typeof payload['cli_version'] === 'string' ? payload['cli_version'] : version
        const base = payload['base_instructions']
        const said = isRecord(base) ? asText(base['text']) : asText(base)
        if (said !== '' && (asked.life === null || life === asked.life)) {
          standing.splice(
            0,
            standing.length,
            titled({
              author: 'the-provider',
              label: 'base_instructions',
              role: 'instructions',
              text: said,
            }),
          )
        }
        return 'more'
      }
      if (type === 'event_msg') {
        if (kind === 'task_started' && state === 'looking') startTurn()
        if ((kind === 'task_complete' || kind === 'task_started') && state === 'in-turn') {
          state = 'done'
          return 'done'
        }
        records.push(
          CODEX_EVENTS_NOT_SENT.has(kind)
            ? { label: `event_msg: ${kind}`, kind: 'not-sent', raw: null }
            : { label: `event_msg: ${kind}`, kind: 'unknown', raw: kept(record) },
        )
        return 'more'
      }
      if (type === 'response_item') {
        if (kind === 'message') {
          const role = asText(payload['role'])
          if (role === 'assistant') {
            if (state === 'in-turn') {
              state = 'done'
              return 'done'
            }
            // ⚑ An earlier turn's answer: what came before it was that turn's, not this one's.
            startTurn()
            return 'more'
          }
          const candidate = state === 'looking' && (asked.life === null || life === asked.life)
          // ⚑ Read from this record: the whole message, by the importer's own rule. ⛔ A record an
          // earlier message read from the record took whole is not looked at again (W4.204); one
          // whose block an earlier handed-over message took keeps its other blocks open.
          let takenHere = false
          let isTheRecord = false
          if (
            candidate &&
            next() === 'its-own-record' &&
            splitCodexMessage(role, messageText(codexMessageAsKept(payload)['content'])).said ===
              asked.text
          ) {
            if (taken < asked.before.length) {
              taken += 1
              takenHere = true
            } else isTheRecord = true
          }
          if (isTheRecord) {
            message = messageText(payload['content'])
            state = 'in-turn'
          }
          for (const block of blocksIn(payload['content'])) {
            let isTheMessage = isTheRecord && block.isText
            if (
              !isTheRecord &&
              !takenHere &&
              candidate &&
              state === 'looking' &&
              next() === 'handed-over' &&
              role === 'user' &&
              block.isText &&
              codexTextAsKept(block.text) === asked.text
            ) {
              if (taken < asked.before.length) taken += 1
              else {
                isTheMessage = true
                message = block.text
                state = 'in-turn'
              }
            }
            parts.push(
              titled({
                author: isTheMessage ? 'the-message' : 'the-provider',
                label: role,
                role,
                text: block.text,
              }),
            )
          }
          return 'more'
        }
        if (CODEX_OUTPUT.has(kind) || kind.endsWith('_call_output')) {
          if (state === 'in-turn') {
            state = 'done'
            return 'done'
          }
          startTurn()
          return 'more'
        }
      }
      if (CODEX_NOT_SENT.has(type)) {
        records.push({ label: type, kind: 'not-sent', raw: null })
        return 'more'
      }
      // ⚑ Kept whole — a compaction's summary among them, which stands in for the history it replaced.
      records.push({
        label: kind === '' ? type || 'a record with no type' : `${type}: ${kind}`,
        kind: 'unknown',
        raw: kept(record),
      })
      return 'more'
    },
    answer() {
      if (message === null) {
        return { found: false, why: notInTheRecord('Codex', asked) }
      }
      return {
        found: true,
        provider: 'codex',
        version,
        whole: state === 'done',
        message,
        parts,
        standing,
        leavesOut: whatItLeavesOut(standing),
        records,
      }
    },
  }
}

function titleOf(part: AsSentPart): string | null {
  if (part.author === 'the-message') {
    if (THIS_CONVERSATION_LINES.some((line) => part.text.startsWith(`${line}\n\n`))) {
      return 'What is true of this conversation, then the message'
    }
    // ⚑ A reopened thread is sent only the sections that changed since it got them.
    return THIS_CONVERSATION_CHANGED_LINES.some((line) => part.text.startsWith(`${line}\n\n`))
      ? 'What changed in what is true of this conversation, then the message'
      : 'The message'
  }

  if (part.label === 'base_instructions') return 'Codex’s base prompt'
  if (/^# AGENTS\.md instructions(?: for |\r?\n)/.test(part.text)) {
    return part.text.includes('These AGENTS.md instructions replace all previously provided')
      ? 'The AGENTS files Codex read, sent again because they changed'
      : 'The AGENTS files Codex read, as it sent them'
  }
  return CODEX_TITLES.find(([start]) => part.text.startsWith(start))?.[1] ?? null
}

function titled(part: AsSentPart): AsSentPart {
  const title = titleOf(part)
  return title === null ? part : { ...part, title }
}
