import { providerValue, type Provider } from '@brobot2/shared'
import type {
  AsSentPart,
  AsSentRecord,
  ContextSectionsPlacement,
  TurnAsSent,
  WhatTheRecordLeavesOut,
} from '../../shared/turn-as-sent'
import { codexMessageAsKept, codexTextAsKept, splitCodexMessage } from './codex-injected'
import { messageText } from './import-codex'
import { THIS_CONVERSATION_HEADER } from '../runtime/instructions'
import { WHAT_CHANGED_HEADER } from '../runtime/codex-lead'

/**
 * 🔴 **W4.164 · F093 R1 — reading one turn out of a provider's own file, a line at a time.**
 *
 * The turn is the message BroBot handed over, found by **the exact text it handed over** — the
 * ledger's `user_turn.sent` (F093 R2), which each provider keeps as it got it: a message's text
 * blocks are that text, character for character, and nothing else is ({@link textOf}). ⚑ Which of
 * the messages with that text it is: each earlier message of this provider conversation (`life`)
 * with the same text takes the first record its own rule finds, in order, and the turn is the next
 * one its rule finds ({@link TurnAsked.before}); a `/clear`, or a new thread, starts again. ⛔ W4.172 ·
 * never by words inside a message: those found a message that only quoted them. On both rules, the
 * saved methods' lines in this app's Codex lead are compared as the ledger keeps them
 * (`codexMessageAsKept`).
 *
 * ⚑ **A turn this app read from the provider's record itself** — a conversation adopted from a
 * provider's home, whose ledger was read from that record — is found by the text its importer took
 * from that record, by the importer's own rule: Claude Code's string content as it is, Codex's message
 * text split from what Codex put around it (`import-claude.ts`, `import-codex.ts`). Exact too.
 *
 * ⚑ **Each provider keeps its turn its own way**:
 *  - **Claude Code**: the message is a `user` record; its reminders and context follow it as
 *    `attachment` records, each with the text it was rendered as (`rendered`) and its role
 *    (`renderedRole`): one in the user's role went at the head of the message. One in the system's
 *    went in the context message after it, unwrapped, on a model that takes one, and at the head of
 *    the message, wrapped, on a model that takes none (Haiku) — which this reader asks of the model
 *    the turn's answer names ({@link TurnReadingOptions.hasAContextMessage}). Until the model's answer.
 *  - **Codex**: a turn runs from `task_started` to `task_complete`; its messages to the model are
 *    `response_item` messages — each content block as sent — up to the model's first output. Its
 *    base prompt is in the file's `session_meta`, in front of every request.
 *
 * ⛔ **A record this build does not know is kept raw**, never dropped, and so is one it knows is
 * sent but cannot render; what the provider keeps for itself (a queue, a cost, a token count) is
 * named and marked not sent.
 */

/** Which turn: the message with this text, after the earlier ones, in the provider conversation `life`. */
export interface TurnAsked {
  /**
   * Which text: the text BroBot handed over for the turn, exactly (`user_turn.sent`), or — for a
   * turn read from this record (`its-own-record`) — the text its importer took from it.
   */
  readonly by: 'handed-over' | 'its-own-record'
  readonly text: string
  /**
   * 🔴 **W4.204 · the earlier messages of this conversation with the same text, in order, each by
   * how it is found** — each takes the first record ITS rule finds, before this turn's is looked for.
   * ⛔ A count of one kind only was wrong: a record read from the provider's own file and one this
   * app handed over can carry the same text, and the file cannot say which is which — so a message
   * handed over after a read one was answered with the read one's record.
   */
  readonly before: readonly TurnAsked['by'][]
  /** The provider's id for the conversation the turn was in; `null` when the ledger names none. */
  readonly life: string | null
}

/**
 * ⚑ **What a reading may ask of this build**: whether a Claude model, as a turn's answer names it,
 * takes a context message — `true`, `false`, or `null`: this build holds no snapshot of it.
 */
export interface TurnReadingOptions {
  readonly hasAContextMessage?: (model: string) => boolean | null
}

/** A reading in progress: fed one line at a time, until it has the turn. */
export interface TurnReading {
  /** One line of the file; `done` once the turn is whole and nothing after it matters. */
  line(text: string): 'more' | 'done'
  /** The turn, or why there is none. */
  answer(): TurnAsSent
}

/** How much of a record this build cannot read is kept for the window: enough to see what it is. */
const RAW_MAX = 20_000

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A record kept as written — or its first characters, for one too large to carry whole. */
function kept(raw: unknown): unknown {
  const written = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return written.length <= RAW_MAX ? raw : { cutAt: RAW_MAX, start: written.slice(0, RAW_MAX) }
}

/** A block of a message's content, as sent: a text block's text, or an image named, never read. */
interface Block {
  readonly text: string
  readonly isText: boolean
}

const TEXT_BLOCKS = new Set(['text', 'input_text', 'output_text'])

/** A message's content, block by block, as sent. */
function blocksIn(content: unknown): Block[] {
  if (typeof content === 'string') return [{ text: content, isText: true }]
  if (!Array.isArray(content)) return []
  return content.flatMap((block: unknown): Block[] => {
    if (!isRecord(block)) return []
    const kind = asText(block['type'])
    if (TEXT_BLOCKS.has(kind)) return [{ text: asText(block['text']), isText: true }]
    if (kind === 'image' || kind === 'input_image') return [{ text: '[an image]', isText: false }]
    return []
  })
}

/** The blocks of a message's content, one text per block; an image named, never read. */
const blocksOf = (content: unknown): string[] => blocksIn(content).map((block) => block.text)

/**
 * 🔴 **The text a message carried, to match against what BroBot handed over** — its text blocks
 * alone, joined as they are rendered; an image beside them is no part of it.
 */
function textOf(content: unknown): string {
  return blocksIn(content)
    .filter((block) => block.isText)
    .map((block) => block.text)
    .join('\n\n')
}

/** One line of a provider's file, parsed — or kept as text when it is not JSON. */
function parsed(text: string): Json | { readonly unreadable: string } {
  try {
    const value = JSON.parse(text) as unknown
    return isRecord(value) ? value : { unreadable: text }
  } catch {
    return { unreadable: text }
  }
}

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

/**
 * ⚑ Claude Code's own records, known by how their text opens, in plain words — ⛔ a later change to
 * one (*"…no longer available…"*) opens otherwise, and is left to its provider name.
 */
const CLAUDE_TITLES: readonly (readonly [string, string, string])[] = [
  [
    'environment',
    '# Environment',
    'The environment, as Claude Code describes it: the folder, platform and shell',
  ],
  ['model', 'You are powered by the model', 'The model Claude Code says it runs'],
  [
    'agent_listing_delta',
    'Available agent types for the Agent tool',
    'The kinds of sub-agent Claude Code can start',
  ],
  ['skill_listing', 'The following skills are available', 'The skills Claude Code offers'],
  ['total_tokens_reminder', '<total_tokens>', 'How many tokens are left'],
  ['date', "Today's date is", 'Today’s date'],
]

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

/** A reminder's text, without the `<system-reminder>` line Claude Code opens it with. */
const opening = (text: string): string => text.replace(/^<system-reminder>\n/, '')

/** ⚑ What Claude Code's instruction-files reminder carries, in plain words. */
function instructionFilesTitle(text: string): string {
  // ⚑ A notice of files gone alone; one that also re-sends changed files is a re-send.
  if (text.includes('Instructions no longer present') && !text.includes('\nContents of ')) {
    return 'Claude Code’s notice that instruction files it had sent are gone'
  }
  // ⚑ "Its memory index" only when that is the one file it carries: a conversation found in a
  // person's own Claude home carries their own instruction files here too.
  const onlyTheIndex =
    text.split('\nContents of ').length - 1 === 1 && text.includes('/MEMORY.md (')
  const again =
    text.includes('Instruction files were re-read') ||
    text.includes('These instruction files changed')
  if (again) {
    return onlyTheIndex
      ? 'This agent’s memory index, sent again because it changed'
      : 'Instruction files Claude Code read again, sent because they changed'
  }
  return onlyTheIndex
    ? 'This agent’s memory index, as Claude Code sends it'
    : 'Instruction files Claude Code read itself'
}

/**
 * ⚑ **W4.177 — what one part is, in plain words** ({@link AsSentPart.title}), for a part this build
 * knows by how its text opens; ⛔ none for one it does not know.
 */
function titleOf(provider: Provider, part: AsSentPart): string | null {
  if (part.author === 'the-message') {
    // ⚑ "The message" alone: a conversation found in a person's own provider home was typed there.
    if (providerValue(provider, { claude: true, codex: false })) return 'The message'
    if (THIS_CONVERSATION_LINES.some((line) => part.text.startsWith(`${line}\n\n`))) {
      return 'What is true of this conversation, then the message'
    }
    // ⚑ A reopened thread is sent only the sections that changed since it got them.
    return THIS_CONVERSATION_CHANGED_LINES.some((line) => part.text.startsWith(`${line}\n\n`))
      ? 'What changed in what is true of this conversation, then the message'
      : 'The message'
  }
  if (providerValue(provider, { claude: true, codex: false })) {
    const said = opening(part.text)
    if (part.label === 'instructions') return instructionFilesTitle(part.text)
    if (part.label === 'meta') return 'Text Claude Code added in the user’s role'
    if (part.label === 'session_context') {
      return said.includes('# gitStatus')
        ? 'The folder’s git status, as Claude Code attached it'
        : 'Context Claude Code attached'
    }
    if (said.startsWith('Attribution for git commits')) {
      return 'Claude Code’s instructions on attribution lines for commits and pull requests'
    }
    // ⚑ BroBot's among them only when they are: a person's own conversation has none of its tools.
    if (said.startsWith('The following deferred tools are now available')) {
      // ⚑ In the first section only: a later one may list tools that are no longer available.
      return (said.split('\n\n')[0] ?? '').includes('mcp__brobot__')
        ? 'The tools the agent can load by name, BroCrew’s among them'
        : 'The tools the agent can load by name'
    }
    if (said.startsWith('# MCP Server Instructions')) {
      return said.includes('\n## brobot\n')
        ? 'The tool servers’ own instructions, BroCrew’s paragraph among them'
        : 'The tool servers’ own instructions'
    }
    return (
      CLAUDE_TITLES.find(([label, start]) => part.label === label && said.startsWith(start))?.[2] ??
      null
    )
  }
  if (part.label === 'base_instructions') return 'Codex’s base prompt'
  if (/^# AGENTS\.md instructions(?: for |\r?\n)/.test(part.text)) {
    return part.text.includes('These AGENTS.md instructions replace all previously provided')
      ? 'The AGENTS files Codex read, sent again because they changed'
      : 'The AGENTS files Codex read, as it sent them'
  }
  return CODEX_TITLES.find(([start]) => part.text.startsWith(start))?.[1] ?? null
}

/** A part with its plain title, when this build knows what it is. */
function titled(provider: Provider, part: AsSentPart): AsSentPart {
  const title = titleOf(provider, part)
  return title === null ? part : { ...part, title }
}

// ──────────────────────────────────────────────── Claude ───

/** Claude Code's records it keeps for itself, never sent to the model. */
const CLAUDE_NOT_SENT = new Set([
  'queue-operation',
  'atis-latch',
  'last-prompt',
  'cost-state',
  'file-history-snapshot',
  'custom-title',
  'tag',
  'mode',
])

/** Claude Code's `system` records it keeps for itself: its own lines in its own window. */
const CLAUDE_SYSTEM_NOT_SENT = new Set([
  'stop_hook_summary',
  'turn_duration',
  'api_error',
  'informational',
  'local_command',
])

/** Claude Code's attachments that carry no text to send: what it keeps about the session. */
const CLAUDE_ATTACHMENT_NOT_SENT = new Set(['session_context'])

const contentOf = (record: Json): unknown =>
  isRecord(record['message']) ? record['message']['content'] : undefined

/**
 * Whether a `user` record is a message BroBot handed over: a string, or text beside an image. ⛔
 * Not a tool's answer, not the harness speaking in the user's name (`isMeta`, a compaction's
 * summary, an array of text blocks alone), not a sub-agent's.
 */
function isHandedOver(record: Json): boolean {
  if (record['isMeta'] === true || record['isCompactSummary'] === true) return false
  if (record['isSidechain'] === true) return false
  const content = contentOf(record)
  if (typeof content === 'string') return true
  if (!Array.isArray(content)) return false
  const kinds = content.map((block: unknown) => (isRecord(block) ? asText(block['type']) : ''))
  return !kinds.includes('tool_result') && kinds.includes('image') && kinds.includes('text')
}

/** A section as Claude Code's transcript renders it, without its `<system-reminder>` wrapping. */
function unwrapped(text: string): string {
  return /^<system-reminder>\n([\s\S]*)\n<\/system-reminder>$/.exec(text)?.[1] ?? text
}

/**
 * 🔴 **Claude's turn in the order its model got it** — the message, the reminders at its head, and
 * the sections Claude Code rendered in the system's role, which went where this model's kind puts
 * them (measured on 2.1.287, `probe:provider-snapshots`):
 *  - a model that takes a context message (`hasAContextMessage` true) got them in it, after the
 *    message, unwrapped, joined by a blank line;
 *  - one that takes none (false, Haiku) got them wrapped, at the head of the message, among the
 *    reminders in the record's order;
 *  - unknown (null): as the record keeps them — wrapped, after the message — and said so.
 * ⚑ `contextSections` is `null` when the turn has no section. A `meta` record stays after the message.
 */
export function claudePartsAsTheModelGotThem(
  added: readonly { readonly as: 'reminder' | 'section' | 'meta'; readonly part: AsSentPart }[],
  theMessage: AsSentPart,
  model: string | null,
  hasAContextMessage: boolean | null,
): { readonly parts: AsSentPart[]; readonly contextSections: ContextSectionsPlacement | null } {
  const of = (...kinds: readonly ('reminder' | 'section' | 'meta')[]): AsSentPart[] =>
    added.filter((one) => kinds.includes(one.as)).map((one) => one.part)
  const sections = of('section')
  if (sections.length === 0) {
    return { parts: [...of('reminder'), theMessage, ...of('meta')], contextSections: null }
  }
  if (hasAContextMessage === true) {
    return {
      parts: [
        ...of('reminder'),
        theMessage,
        ...added
          .filter((one) => one.as !== 'reminder')
          .map((one) =>
            one.as === 'section' ? { ...one.part, text: unwrapped(one.part.text) } : one.part,
          ),
      ],
      contextSections: {
        as: 'context-message',
        model,
        said: `${String(model)} takes a context message, so Claude Code sent these sections in it, after the message, without their reminder lines — unless its server refused one, when Claude Code sends them as reminders instead, which its record does not show.`,
      },
    }
  }
  if (hasAContextMessage === false) {
    return {
      parts: [...of('reminder', 'section'), theMessage, ...of('meta')],
      contextSections: {
        as: 'reminders',
        model,
        said: `${String(model)} takes no context message, so Claude Code sent these sections as reminders at the head of the message.`,
      },
    }
  }
  return {
    parts: [...of('reminder'), theMessage, ...of('section', 'meta')],
    contextSections: {
      as: 'not-known',
      model,
      said:
        model === null
          ? 'The model has not answered this message yet, so it is not known how these sections reached it: in a context message after the message, without their reminder lines, or as reminders at its head. They are shown as Claude Code’s record keeps them.'
          : `This app holds no snapshot of ${model}, so it is not known how these sections reached it: in a context message after the message, without their reminder lines, or as reminders at its head. They are shown as Claude Code’s record keeps them.`,
    },
  }
}

function readingClaude(asked: TurnAsked, options: TurnReadingOptions): TurnReading {
  /** How many of {@link TurnAsked.before} have taken their records. */
  let taken = 0
  let state: 'looking' | 'in-turn' | 'done' = 'looking'
  let message: string | null = null
  let version: string | null = null
  /** The model the turn's answer names, once it is read. */
  let model: string | null = null
  /** What Claude Code added around the message, in its record's order, each with what it is. */
  const added: { readonly as: 'reminder' | 'section' | 'meta'; readonly part: AsSentPart }[] = []
  const records: AsSentRecord[] = []
  return {
    line(text) {
      if (state === 'done') return 'done'
      if (text.trim() === '') return 'more'
      const record = parsed(text)
      if ('unreadable' in record) {
        if (state === 'in-turn') {
          records.push({ label: 'a line that is not JSON', kind: 'unknown', raw: kept(text) })
        }
        return 'more'
      }
      const type = asText(record['type'])
      if (state === 'looking') {
        if (type !== 'user' || !isHandedOver(record)) return 'more'
        // ⚑ Another provider conversation's record; one that names none is not refused for it.
        const its = record['sessionId']
        if (asked.life !== null && typeof its === 'string' && its !== asked.life) return 'more'
        const content = contentOf(record)
        // ⚑ The rule of the message this record would be next: an earlier one, else this turn.
        const by = asked.before[taken] ?? asked.by
        const isIt =
          by === 'handed-over'
            ? textOf(content) === asked.text
            : typeof content === 'string' && content === asked.text
        if (!isIt) return 'more'
        if (taken++ < asked.before.length) return 'more'
        message = blocksOf(contentOf(record)).join('\n\n')
        version = typeof record['version'] === 'string' ? record['version'] : null
        state = 'in-turn'
        return 'more'
      }
      // ⚑ In the turn: everything up to the model's answer, or the next message.
      if (type === 'assistant') {
        const said = isRecord(record['message']) ? record['message']['model'] : undefined
        model = typeof said === 'string' && said !== '' ? said : null
        state = 'done'
        return 'done'
      }
      if (type === 'user') {
        if (record['isMeta'] === true && record['isSidechain'] !== true) {
          for (const said of blocksOf(contentOf(record))) {
            added.push({
              as: 'meta',
              part: titled('claude', {
                author: 'the-provider',
                label: 'meta',
                role: 'user',
                text: said,
              }),
            })
          }
          return 'more'
        }
        state = 'done'
        return 'done'
      }
      if (type === 'attachment') {
        const attachment = isRecord(record['attachment']) ? record['attachment'] : {}
        const label = asText(attachment['type']) || 'attachment'
        version ??= typeof record['version'] === 'string' ? record['version'] : null
        const rendered = record['rendered']
        if (!Array.isArray(rendered)) {
          records.push(
            CLAUDE_ATTACHMENT_NOT_SENT.has(label)
              ? { label: `attachment: ${label}`, kind: 'not-sent', raw: null }
              : { label: `attachment: ${label}`, kind: 'unknown', raw: kept(record) },
          )
          return 'more'
        }
        const role = asText(record['renderedRole']) || 'user'
        // ⚑ What it is: a reminder in the user's role, or a section in the system's, which went where
        // the model's kind puts it ({@link claudePartsAsTheModelGotThem}).
        for (const one of rendered) {
          const text = isRecord(one) ? blocksOf(one['content']).join('\n\n') : ''
          added.push({
            as: role === 'user' ? 'reminder' : 'section',
            part: titled('claude', { author: 'the-provider', label, role, text }),
          })
        }
        return 'more'
      }
      if (CLAUDE_NOT_SENT.has(type)) {
        records.push({ label: type, kind: 'not-sent', raw: null })
        return 'more'
      }
      const subtype = asText(record['subtype'])
      if (type === 'system' && CLAUDE_SYSTEM_NOT_SENT.has(subtype)) {
        records.push({ label: `system: ${subtype}`, kind: 'not-sent', raw: null })
        return 'more'
      }
      records.push({
        label: subtype === '' ? type || 'a record with no type' : `${type}: ${subtype}`,
        kind: 'unknown',
        raw: kept(record),
      })
      return 'more'
    },
    answer() {
      if (message === null) {
        return { found: false, why: notInTheRecord('Claude Code', asked) }
      }
      const { parts, contextSections } = claudePartsAsTheModelGotThem(
        added,
        titled('claude', { author: 'the-message', label: 'user', role: 'user', text: message }),
        model,
        model === null ? null : (options.hasAContextMessage?.(model) ?? null),
      )
      return {
        found: true,
        provider: 'claude',
        version,
        whole: state === 'done',
        message,
        parts,
        ...(contextSections === null ? {} : { contextSections }),
        standing: [],
        leavesOut: whatItLeavesOut([]),
        records,
      }
    },
  }
}

/**
 * ⚑ What a reading holds none of: a system prompt where it read none, and what came after the
 * model's first answer, where every reading stops.
 */
function whatItLeavesOut(standing: readonly AsSentPart[]): WhatTheRecordLeavesOut[] {
  return [
    ...(standing.length === 0 ? ['the-system-prompt' as const] : []),
    'after-its-first-answer',
  ]
}

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

function readingCodex(asked: TurnAsked): TurnReading {
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
            titled('codex', {
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
              titled('codex', {
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

/**
 * ⚑ Why a turn is not found, in what is true either way: no message has its text — whether the
 * provider never got it or kept it otherwise.
 */
function notInTheRecord(provider: string, asked: TurnAsked): string {
  return asked.by === 'handed-over'
    ? `No message in ${provider}’s own record of the conversation has exactly the text this app handed over.`
    : `No message in ${provider}’s own record of the conversation has the text this app read from it.`
}

/** A reading of one turn, for the provider whose file it is. */
export function readingATurn(
  provider: Provider,
  asked: TurnAsked,
  options: TurnReadingOptions = {},
): TurnReading {
  return providerValue(provider, { claude: true, codex: false })
    ? readingClaude(asked, options)
    : readingCodex(asked)
}
