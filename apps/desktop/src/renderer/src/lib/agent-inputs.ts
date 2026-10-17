import type { InjectionKey } from 'vue'
import type {
  GivenLaunch,
  GivenMade,
  ModelGotWhere,
  PartSize,
  WhatTheModelGot,
} from '../../../shared/what-this-agent-was-given'
import { groupTokens } from './context-meter'
import type { TranscriptState } from './transcript'

/**
 * 🔴 **F093 · the words and small folds "What this agent receives" draws** over the one read,
 * `whatThisAgentWasGiven` (`shared/what-this-agent-was-given.ts`). ⛔ Nothing here invents a fact:
 * a part the app does not record yet says {@link NOT_YET}.
 */

/** ⚑ The plain words for a part the app does not record yet. */
export const NOT_YET = 'Not yet recorded.'

export function sizeWords(size: PartSize): string {
  return `${groupTokens(size.characters)} characters · ${groupTokens(size.words)} words · ≈${groupTokens(size.tokens)} tokens`
}

/** ⚑ A share of the context window: "≈2.4%", and "<0.1%" for a sliver, never "≈0.0%". */
export function shareWords(share: number): string {
  if (share > 0 && share < 0.001) return '<0.1%'
  return `≈${(share * 100).toFixed(1)}%`
}

export const MADE_WORDS: Readonly<Record<GivenMade, string>> = {
  shipped: 'Shipped with BroCrew',
  'own-instructions': 'The agent’s own instructions',
  'composed-at-launch': 'Composed by BroCrew at launch, for this conversation',
}

export const PLACEMENT_WORDS: Readonly<Record<'system-prompt' | 'first-message', string>> = {
  'system-prompt': 'BroCrew’s text goes in the system prompt.',
  'first-message': 'BroCrew’s text goes in the first message.',
}

/** A go-ahead whose turn handed over more than its words: it went out with the closing block. */
export const SENT_WITH_THE_CLOSING_BLOCK = 'Sent with the closing block.'

/** What a provider's own record of a turn leaves out, in its words: `Codex’s record: first answer only.` */
export function recordLeavesOutWords(
  name: string,
  leavesOut: readonly ('the-system-prompt' | 'after-its-first-answer')[],
): string | null {
  const parts = [
    ...(leavesOut.includes('the-system-prompt') ? ['no system prompt'] : []),
    ...(leavesOut.includes('after-its-first-answer') ? ['first answer only'] : []),
  ]
  return parts.length === 0 ? null : `${name}’s record: ${parts.join(', ')}.`
}

/** ⚑ Which launch the answer describes, in one sentence — and whether it was composed now. */
export function launchWords(launch: GivenLaunch, when: (at: number) => string): string {
  if (launch.recorded)
    return `What its last launch gave it, ${when(launch.at)}${launch.thisBuild ? '' : ', by an older build of BroCrew'}.`
  switch (launch.why) {
    case 'before-this-build':
      return 'Its last launch wasn’t one this app recorded, so this is composed now: what its next start would get.'
    case 'not-kept':
      return 'Its last launch couldn’t keep a record, so this is composed now: what its next start would get.'
    case 'never-launched':
      return 'It hasn’t been launched yet: this is what its first start would get.'
  }
}

/** One argument of a tool, from its JSON Schema. */
export interface ToolArgument {
  readonly name: string
  readonly valueType: string
  readonly required: boolean
  readonly description: string
}

/** ⚑ A tool's arguments as rows, where its schema is an object with properties; else `null`. */
export function argumentsOf(schema: unknown): ToolArgument[] | null {
  if (typeof schema !== 'object' || schema === null) return null
  const { properties, required } = schema as { properties?: unknown; required?: unknown }
  if (typeof properties !== 'object' || properties === null) return null
  const needed = new Set(Array.isArray(required) ? required.map(String) : [])
  return Object.entries(properties as Record<string, unknown>).map(([name, value]) => {
    const one = (typeof value === 'object' && value !== null ? value : {}) as {
      type?: unknown
      description?: unknown
    }
    return {
      name,
      valueType: Array.isArray(one.type) ? one.type.join(' | ') : String(one.type ?? ''),
      required: needed.has(name),
      description: typeof one.description === 'string' ? one.description : '',
    }
  })
}

/**
 * ⚑ **The per-message read, `whatTheModelGot`, for the conversation on screen** — provided by
 * `ConversationPane`, which knows the session; a message names itself by its ledger ordinal.
 * ⛔ Absent where nothing provides it (a recording in the library): the switch then draws the
 * whole text BroBot kept on the message (`sent`).
 */
export const READ_WHAT_THE_MODEL_GOT: InjectionKey<(ordinal: number) => Promise<WhatTheModelGot>> =
  Symbol('read-what-the-model-got')

export const MODEL_GOT_WHERE_WORDS: Readonly<Record<ModelGotWhere, string>> = {
  'system-prompt': 'In every request',
  'first-message': 'In the first message of its launch, which every request re-sends',
  'an-earlier-message': 'In an earlier message of its launch',
  'this-message': 'In this message',
}

/** ⚑ Why a message has no whole text kept: it is from before BroBot kept it. */
export const SENT_NOT_KEPT_YET = 'This message is from before BroCrew kept the whole text it sent.'
/** ⚑ …or BroBot never sent it: a person's turn read back from the provider's own transcript. */
export const SENT_BY_THE_PROVIDERS_TRANSCRIPT =
  'This message was read from the provider’s own transcript: BroCrew didn’t send it, so it has no text of its own for it.'

/** ⚑ Why an item has no `sent`, where the reason is not "from before it was kept". */
export function noSentBecause(item: { attribution?: string }): string | undefined {
  return item.attribution === 'provider_transcript' ? SENT_BY_THE_PROVIDERS_TRANSCRIPT : undefined
}

/** Who wrote a part of what the agent receives. */
export const AUTHOR = {
  provider: 'Provider',
  brobot: 'BroCrew',
  memory: 'Agent’s memory',
  person: 'Person',
  sender: 'Sending agent',
  agent: 'Agent',
  repository: 'Repository',
  unknown: 'Unknown',
  providerAndBrobot: 'Provider + BroCrew',
  providerAndMemory: 'Provider + agent’s memory',
} as const

/** One message that reached the agent, and what it was handed with it. */
export interface InputMessage {
  readonly itemId: string
  readonly words: string
  /** The whole text the provider was handed for it — absent on turns from before it was kept. */
  readonly sent: string | undefined
  /** Handed over in one text with the other messages of its turn. */
  readonly together: boolean
  /** Why there is no `sent`, where not "from before it was kept". */
  readonly why: string | undefined
  readonly attached: readonly string[]
  readonly from: string
  /** Who wrote its words. */
  readonly author: string
  /** Its ledger ordinal, the address the per-message read takes. */
  readonly ordinal: number | undefined
  /** The go-ahead this app sent so the agent carries on. */
  readonly goAhead: boolean
}

/** ⚑ The messages that reached the agent in this window's transcript, oldest first. */
export function messagesOf(state: TranscriptState | null): InputMessage[] {
  const found: InputMessage[] = []
  for (const item of state?.items ?? []) {
    if (
      item.kind !== 'user' &&
      item.kind !== 'relayed' &&
      item.kind !== 'continuation' &&
      item.kind !== 'appNotice' &&
      item.kind !== 'workReport'
    )
      continue
    if (item.text.trim() === '') continue
    found.push({
      itemId: item.id,
      words: item.text,
      // ⚑ A continuation's text IS the sentence that went to the provider, where its turn kept none.
      sent: item.kind === 'continuation' ? (item.sent ?? item.text) : item.sent,
      together: item.sentWithOthers === true,
      why: item.kind === 'user' ? noSentBecause(item) : undefined,
      attached: item.kind === 'user' ? (item.attachments ?? []).map((one) => one.path) : [],
      ordinal: item.ordinal,
      goAhead: item.kind === 'continuation',
      author:
        item.kind === 'user'
          ? AUTHOR.person
          : item.kind === 'relayed' || (item.kind === 'workReport' && item.relayedFrom)
            ? AUTHOR.sender
            : AUTHOR.brobot,
      from:
        item.kind === 'relayed' || item.kind === 'workReport'
          ? 'Another agent or this app'
          : item.kind === 'appNotice'
            ? 'This app'
            : item.kind === 'continuation'
              ? 'This app, so the agent carries on'
              : 'A person',
    })
  }
  return found
}

/**
 * What this app added around the messages it handed over, in this window's transcript: each turn's
 * whole text less the words of the messages in it, counted once per turn. A turn is known by its
 * ledger ordinal, which every row one turn drew shares. A message with no ordinal counts as its own
 * turn when it was handed over alone; one handed over with others is left out, since its turn
 * can't be told.
 */
export function wrappersOf(messages: readonly InputMessage[]): number {
  const turns = new Map<string, { sent: string; words: number }>()
  for (const one of messages) {
    if (one.sent === undefined) continue
    if (one.ordinal === undefined && one.together) continue
    const turn = one.ordinal === undefined ? `item ${one.itemId}` : `ordinal ${String(one.ordinal)}`
    const held = turns.get(turn)
    if (held === undefined) turns.set(turn, { sent: one.sent, words: one.words.length })
    else held.words += one.words.length
  }
  let characters = 0
  for (const { sent, words } of turns.values()) characters += Math.max(0, sent.length - words)
  return characters
}
