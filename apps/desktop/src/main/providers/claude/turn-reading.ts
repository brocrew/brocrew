import type {
  AsSentPart,
  AsSentRecord,
  ContextSectionsPlacement,
} from '../../../shared/turn-as-sent'
import {
  TurnAsked,
  TurnReadingOptions,
  TurnReading,
  Json,
  isRecord,
  asText,
  kept,
  blocksOf,
  textOf,
  parsed,
  whatItLeavesOut,
  notInTheRecord,
} from '../../archive/turn-reading'
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

export function readingClaude(asked: TurnAsked, options: TurnReadingOptions): TurnReading {
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
              part: titled({
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
            part: titled({ author: 'the-provider', label, role, text }),
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
        titled({ author: 'the-message', label: 'user', role: 'user', text: message }),
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

function titleOf(part: AsSentPart): string | null {
  if (part.author === 'the-message') return 'The message'

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

function titled(part: AsSentPart): AsSentPart {
  const title = titleOf(part)
  return title === null ? part : { ...part, title }
}
