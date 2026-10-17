import type { AgentToolAnswer } from '@brobot2/runtime'
import { agentLink, conversationLink, pieceLink } from '../../shared/links'

export const NAVIGATION_TOOL_NAMES: ReadonlySet<string> = new Set([
  'give_work',
  'list_tasks',
  'search_work',
  'list_profiles',
  'list_agents',
  'get_agent_status',
  'find_files',
  'take_on_work',
  'ask_question',
])

interface NavigationNames {
  readonly conversationName: (id: string) => string
  readonly conversationVisible: (id: string) => boolean
  readonly conversationProfile: (id: string) => string | null
  readonly piece: (
    spelled: string,
  ) => { readonly id: string; readonly label: string; readonly title: string | null } | null
  readonly identity: (profile: string) => { readonly id: string; readonly name: string } | null
}

const object = (value: unknown): Readonly<Record<string, unknown>> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

// These containers hold app-composed metadata, never a brief, message or document body.
const CONTAINERS = new Set([
  'agents',
  'archived',
  'profiles',
  'conversations',
  'pieces',
  'files',
  'root',
  'you_hold',
  'you_gave',
  'children',
  'hits',
  'piece',
  'agent',
  'owner',
  'giver',
  'started_by',
  'given_by',
  'replaced_by',
  'added_by',
  'inItsPlace',
  'named',
  'whose',
  'parent',
  'held',
  'last_exchange',
  'received',
  'from',
  'came_with',
  'last_turn_took',
  'open_questions',
  'request',
])
const CONVERSATION_FIELDS = [
  'agent',
  'owner',
  'giver',
  'parent',
  'spawnedBy',
  'conversation',
  'replaced_by',
  'went_to',
  'carrying_words_of',
  'asked_by',
  'askedBy',
] as const

/** Adds ready-to-copy links after the unchanged answer; it never writes a work record. */
export function withNavigationLinks(
  tool: string,
  answered: AgentToolAnswer,
  names: NavigationNames,
  args: Readonly<Record<string, unknown>> = {},
): AgentToolAnswer {
  if (!NAVIGATION_TOOL_NAMES.has(tool) || answered.structured === undefined) return answered
  // The move answer and its receipt are composed together by the move owner.
  if (tool === 'ask_question') return answered
  const refused = answered.structured['outcome'] === 'refused'
  const links = new Map<string, string>()
  const add = (kind: 'conversation' | 'agent', id: string, title: string): void => {
    const key = `${kind}:${id}`
    if (!links.has(key))
      links.set(key, kind === 'conversation' ? conversationLink(id, title) : agentLink(id, title))
  }
  const addPiece = (id: string, label: string, title: string | null): void => {
    const key = `piece:${id}`
    if (!links.has(key)) links.set(key, pieceLink(id, label, title ?? ''))
  }
  const identities = new Map<string, ReturnType<NavigationNames['identity']>>()
  const profile = (slug: string): void => {
    const identity = identities.has(slug) ? (identities.get(slug) ?? null) : names.identity(slug)
    identities.set(slug, identity)
    if (identity !== null) add('agent', identity.id, identity.name)
  }
  const walk = (value: unknown, top = false): void => {
    if (Array.isArray(value)) {
      value.forEach((one) => walk(one))
      return
    }
    const row = object(value)
    if (row === null) return
    const id = text(row['piece'])
    const label = text(row['label'])
    const title =
      text(row['piece_title']) ??
      text(row['title']) ??
      (top && tool === 'give_work' ? text(args['title']) : null)
    if (id !== null && (refused || label === null) && !links.has(`piece:${id}`)) {
      const known = names.piece(id)
      if (known !== null) addPiece(known.id, known.label, known.title)
    } else if (id !== null && label !== null) addPiece(id, label, title)
    for (const field of CONVERSATION_FIELDS) {
      if (field === 'went_to' && tool !== 'give_work') continue
      const conversation = text(row[field])
      if (
        conversation !== null &&
        !links.has(`conversation:${conversation}`) &&
        (!refused || names.conversationVisible(conversation))
      ) {
        add('conversation', conversation, names.conversationName(conversation))
        const slug = names.conversationProfile(conversation)
        if (slug !== null) profile(slug)
      }
    }
    const slug = text(row['profile']) ?? text(row['profileId'])
    if (slug !== null) profile(slug)
    for (const [key, child] of Object.entries(row)) if (CONTAINERS.has(key)) walk(child)
  }
  walk(refused ? answered.structured['detail'] : answered.structured, true)
  const labels = ['stalled', 'held_by_archived'].flatMap((field) => {
    const values = answered.structured?.[field]
    return Array.isArray(values) ? values : []
  })
  for (const spelled of [refused ? undefined : answered.structured['under'], ...labels]) {
    if (typeof spelled !== 'string') continue
    const row = names.piece(spelled)
    if (row !== null) addPiece(row.id, row.label, row.title)
  }
  if (links.size === 0) return answered
  return { ...answered, text: `${answered.text}\n${[...links.values()].join('\n')}` }
}
