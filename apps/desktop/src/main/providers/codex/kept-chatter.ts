import { isRecord, type KeptChatterTable, type RepeatingWarning } from '../kept-chatter-shape'

const only = (value: Record<string, unknown>, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).every((key) => keys.has(key))

/** The fields a `userMessage` item is known to carry, its timing included; anything else is kept. */
const USER_MESSAGE_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'id',
  'clientId',
  'content',
  'startedAtMs',
  'completedAtMs',
])

/**
 * A `userMessage` item's text when it is plain text and nothing more: every part a text part with
 * no rendered or persisted spans (`text_elements`) and no other field.
 */
function plainUserMessageText(raw: unknown): string | null {
  if (!isRecord(raw) || raw['type'] !== 'userMessage') return null
  if (!only(raw, USER_MESSAGE_FIELDS)) return null
  // Known fields keep their wire types; an unfamiliar value keeps the row.
  if (raw['id'] !== undefined && typeof raw['id'] !== 'string') return null
  if (
    raw['clientId'] !== undefined &&
    raw['clientId'] !== null &&
    typeof raw['clientId'] !== 'string'
  )
    return null
  for (const key of ['startedAtMs', 'completedAtMs'])
    if (raw[key] !== undefined && raw[key] !== null && typeof raw[key] !== 'number') return null
  const content = raw['content']
  if (!Array.isArray(content) || content.length === 0) return null
  let text = ''
  for (const part of content) {
    if (!isRecord(part) || part['type'] !== 'text' || typeof part['text'] !== 'string') return null
    const spans = part['text_elements']
    if (spans !== undefined && !(Array.isArray(spans) && spans.length === 0)) return null
    if (Object.keys(part).some((key) => !['type', 'text', 'text_elements'].includes(key)))
      return null
    text += part['text']
  }
  return text === '' ? null : text
}

const METADATA_SECTIONS: ReadonlySet<string> = new Set([
  'prompt',
  'generation',
  'tool_call',
  'tool_response',
  'commentary',
])
/** The sections every moderation record on the wire carries, each possibly empty. */
const REQUIRED_SECTIONS = ['prompt', 'generation', 'tool_call', 'tool_response'] as const
const PROTECTION_FIELDS: ReadonlySet<string> = new Set(['protection_type', 'outputs'])
const OUTPUT_FIELDS: ReadonlySet<string> = new Set([
  'results',
  'is_blocked',
  'cyber_trusted_access',
])
const RESULT_FIELDS: ReadonlySet<string> = new Set(['category_flags'])

/** One check's output that clearly passed: not blocked, every category flag clear. */
function outputPassed(output: unknown): boolean {
  if (!isRecord(output) || !only(output, OUTPUT_FIELDS) || output['is_blocked'] !== false)
    return false
  const access = output['cyber_trusted_access']
  if (access !== undefined && typeof access !== 'boolean') return false
  const results = output['results']
  return (
    Array.isArray(results) &&
    results.every(
      (result) =>
        isRecord(result) &&
        only(result, RESULT_FIELDS) &&
        isRecord(result['category_flags']) &&
        Object.values(result['category_flags']).every((flag) => flag === false),
    )
  )
}

/**
 * A moderation record in the shape the wire contract carries in `metadata`, where every check that
 * ran clearly passed. A record where no check ran is clear too. A block, an error, a flag, or any
 * unfamiliar section, field or value keeps the record.
 */
function moderationPassed(raw: unknown): boolean {
  const params = isRecord(raw) ? raw['params'] : undefined
  const metadata = isRecord(params) ? params['metadata'] : undefined
  if (!isRecord(metadata) || !only(metadata, METADATA_SECTIONS)) return false
  if (!REQUIRED_SECTIONS.every((section) => isRecord(metadata[section]))) return false
  return Object.values(metadata).every(
    (section) =>
      isRecord(section) &&
      Object.values(section).every(
        (protection) =>
          isRecord(protection) &&
          only(protection, PROTECTION_FIELDS) &&
          typeof protection['protection_type'] === 'string' &&
          Array.isArray(protection['outputs']) &&
          protection['outputs'].length > 0 &&
          protection['outputs'].every(outputPassed),
      ),
  )
}

/** A tool server that started, without an error. */
function serverReady(raw: unknown): boolean {
  const params = isRecord(raw) ? raw['params'] : undefined
  return (
    isRecord(params) &&
    params['status'] === 'ready' &&
    (params['error'] ?? null) === null &&
    (params['failureReason'] ?? null) === null
  )
}

export const CODEX_KEPT_CHATTER: KeptChatterTable = {
  userMessage: { category: 'echo', newest: 0, echoed: plainUserMessageText },
  'turn/moderationMetadata': { category: 'lifecycle', newest: 0, routine: moderationPassed },
  'mcpServer/startupStatus/updated': { category: 'lifecycle', newest: 0, routine: serverReady },
  'skills/changed': { category: 'lifecycle', newest: 0 },
  'remoteControl/status/changed': { category: 'lifecycle', newest: 0 },
  'thread/readState/changed': { category: 'lifecycle', newest: 0 },
  'account/rateLimits/updated': { category: 'lifecycle', newest: 1 },
  'account/rateLimits/read': { category: 'lifecycle', newest: 1 },
  'account/updated': { category: 'lifecycle', newest: 1 },
  'thread/status/changed': { category: 'lifecycle', newest: 1 },
  'thread/goal/updated': { category: 'lifecycle', newest: 1 },
  'thread/goal/cleared': { category: 'lifecycle', newest: 1 },
}

/** The wording the runtime's Codex rate-limit notice writes, and Codex's own reconnect notice. */
export const CODEX_REPEATING_WARNINGS: readonly RepeatingWarning[] = [
  {
    kind: 'usage close',
    said: (message) => message.startsWith('codex is approaching its rate limit'),
  },
  { kind: 'reconnecting', said: (message) => /^Reconnecting\.\.\. \d+\/\d+$/.test(message) },
]
