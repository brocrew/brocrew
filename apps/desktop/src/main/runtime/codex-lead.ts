import type { InstructionSpan } from '../../shared/whose-text'
import type { LeadInFront } from '../../shared/runtime-ipc'
import type { ThreadLeadRow } from '../db/session-store'
import { conversationBlock } from './instructions'

/**
 * 🔴 **W4.179 — what a Codex thread already holds of this conversation's own text, and what a new
 * life of it still owes.**
 *
 * ⚑ **Why.** On Codex, BroBot's text about this conversation (`## The brobot tools`, `## This
 * conversation`, `## What you have been granted`) rides in front of the first message of every life
 * (`HostedSession.firstTurnLead`), and a Codex thread keeps its whole history. So every reopen, idle
 * stop and app restart added another 2.5–2.7k characters, and the old copies stayed: measured, five
 * lives of one thread held five copies, 12,763 characters.
 *
 * ⚑ **The rule.** A life whose thread already holds the lead sends nothing again when it is the
 * same, and only the sections that changed when it is not — under a line that says they replace the
 * ones of the same name ({@link WHAT_CHANGED_HEADER}). A thread that holds none, or whose history a
 * compaction rewrote, gets the whole of it, as before. ⚠️ What a thread holds is read back from the
 * conversation's own record ({@link LeadRow}): each launch's text (`launched.given`, R2) and which
 * messages carried it (`user_turn.lead`, or for a row from before this, `sent` opening with the
 * launch's whole block). ⛔ A record that cannot say is read as holding nothing, so the whole lead
 * goes: redundant at worst, never missing.
 */

/** ⚑ The line above the sections of this conversation's text that changed since the thread got it. */
export const WHAT_CHANGED_HEADER =
  'Composed by BroCrew for this conversation at this launch. These sections replace the ones of the same name you were given earlier in this conversation:'

/** ⚑ What every lead opens with — the two headers' common start — for the record's read. */
export const LEADS_OPEN_WITH = ((one: string, other: string): string => {
  let at = 0
  while (at < one.length && one[at] === other[at]) at += 1
  return one.slice(0, at)
})(conversationBlock(''), WHAT_CHANGED_HEADER)

/** The opening retained by leads recorded before the app was renamed. */
export const HISTORICAL_LEADS_OPEN_WITH = 'Composed by BroBot for this conversation at this launch'

/** This conversation's text as a launch composed it, with its sections. */
export interface ThisConversationComposed {
  readonly text: string
  readonly sections: readonly InstructionSpan[]
}

/** Its sections by heading, each as it reads, without the blank line after it. */
export type LeadSections = ReadonlyMap<string, string>

/**
 * One row of a conversation's record that bears on what its thread holds, oldest first: a launch,
 * a message, a turn's ending, or its history rewritten (a compaction, a new thread).
 */
export type LeadRow =
  | {
      readonly ordinal: number
      readonly kind: 'a-launch'
      /** That launch's own text for this conversation (`launched.given.thisConversation`). */
      readonly conversation: ThisConversationComposed | null
    }
  | {
      readonly ordinal: number
      readonly kind: 'a-message'
      /** Whether its row kept what it handed over (`sent`) at all. */
      readonly handedOver: boolean
      /** What it handed over, when that opens with this conversation's text; else `null`. */
      readonly sent: string | null
      readonly lead: LeadInFront | null
    }
  | { readonly ordinal: number; readonly kind: 'a-turn-ended'; readonly failedByThisApp: boolean }
  | { readonly ordinal: number; readonly kind: 'its-history-rewritten' }

/** ⚑ A launch's sections, by heading; ⛔ a span with no heading is not one. */
export function sectionsOf(composed: ThisConversationComposed): LeadSections {
  const sections = new Map<string, string>()
  for (const span of composed.sections) {
    if (span.heading === null) continue
    sections.set(span.heading, composed.text.slice(span.start, span.end).trimEnd())
  }
  return sections
}

/** ⚑ The block that carries only the sections that changed. */
export function whatChangedBlock(sections: readonly string[]): string {
  return `${WHAT_CHANGED_HEADER}\n\n${sections.join('\n\n')}`
}

/** One lead a message carried, where it rode, and what it was. */
export interface ALeadCarried {
  readonly ordinal: number
  readonly is: LeadInFront['is']
  readonly text: string
  /** Whether it rode the first message of its launch. */
  readonly firstOfItsLaunch: boolean
}

/** What a thread holds: the leads it was handed since its history was last rewritten, oldest first. */
export interface WhatTheThreadHolds {
  /** Each lead its messages carried, which it still holds; empty: none. */
  readonly carried: readonly ALeadCarried[]
  /** The sections it holds, the newest of each; `null` when the record cannot say. */
  readonly sections: LeadSections | null
}

/**
 * 🔴 **What a Codex thread holds of this conversation's text, read from its record** — up to `before`
 * (exclusive). ⚑ A compaction or a new thread empties it; ⛔ a lead whose turn this app ended as
 * failed (`wordOf: 'this-app'`: its provider never began it, or died under it) is taken as not held,
 * as `HostedSession.firstTurnLead` owes it again within a life. ⚠️ A message whose launch kept no
 * record of its text leaves what is held unknown (`sections: null`).
 */
export function whatTheThreadHolds(rows: readonly LeadRow[], before: number): WhatTheThreadHolds {
  let carried: ALeadCarried[] = []
  let sections: Map<string, string> | null = new Map()
  let launch: ThisConversationComposed | null = null
  let launchAt = -1
  let sawAMessageThisLaunch = false
  /** Whether a lead has ridden since this launch, or since its history was last rewritten. */
  let leadSinceLaunch = false
  /** What was held before the newest lead, while its turn's ending is not yet read. */
  let pending: { carried: ALeadCarried[]; sections: Map<string, string> | null } | null = null
  for (const row of rows) {
    if (row.ordinal >= before) break
    if (row.kind === 'its-history-rewritten') {
      carried = []
      sections = new Map()
      pending = null
      leadSinceLaunch = false
      continue
    }
    if (row.kind === 'a-launch') {
      launch = row.conversation
      launchAt = row.ordinal
      sawAMessageThisLaunch = false
      leadSinceLaunch = false
      pending = null
      continue
    }
    if (row.kind === 'a-turn-ended') {
      if (pending !== null && row.failedByThisApp) {
        carried = pending.carried
        sections = pending.sections
        leadSinceLaunch = false
      }
      pending = null
      continue
    }
    // ⚑ A message: did it carry a lead, and which?
    const first = !sawAMessageThisLaunch && launchAt >= 0
    sawAMessageThisLaunch = true
    const lead = theLeadOn(row, launch)
    if (lead === null) {
      // ⛔ **What it carried cannot be told**: a text that opens with this conversation's own line
      // and is not one this record knows, or — before any lead of its launch — a row that kept no
      // text at all, which may have taken the life's lead with it. The record no longer says what
      // the thread holds, so the next life sends the whole.
      if (row.sent !== null || (!row.handedOver && !leadSinceLaunch)) sections = null
      continue
    }
    leadSinceLaunch = true
    pending = { carried: [...carried], sections: sections === null ? null : new Map(sections) }
    carried = [...carried, { ordinal: row.ordinal, ...lead, firstOfItsLaunch: first }]
    if (lead.is === 'whole') sections = new Map()
    if (launch === null) sections = null
    else if (sections !== null)
      for (const [heading, text] of sectionsOf(launch)) sections.set(heading, text)
  }
  return { carried, sections }
}

/** ⚑ The lead in front of a message's text, as recorded — or, on a row from before, as its launch's whole block. */
function theLeadOn(
  row: Extract<LeadRow, { kind: 'a-message' }>,
  launch: ThisConversationComposed | null,
): { readonly is: LeadInFront['is']; readonly text: string } | null {
  if (row.sent === null) return null
  if (row.lead !== null && row.lead.chars > 0 && row.lead.chars <= row.sent.length) {
    return { is: row.lead.is, text: row.sent.slice(0, row.lead.chars) }
  }
  if (launch === null) return null
  const whole = conversationBlock(launch.text)
  if (row.sent.startsWith(`${whole}\n\n`)) return { is: 'whole', text: whole }
  const historicalWhole = `${HISTORICAL_LEADS_OPEN_WITH}${whole.slice(LEADS_OPEN_WITH.length)}`
  return row.sent.startsWith(`${historicalWhole}\n\n`)
    ? { is: 'whole', text: historicalWhole }
    : null
}

/**
 * 🔴 **What a new life of a Codex thread owes its first message** — the whole lead when the thread
 * holds none (or its record cannot say), nothing when it holds every section as this launch has it,
 * and only the sections that changed (or are new) otherwise, in this launch's order.
 */
export function theLeadOwed(
  held: WhatTheThreadHolds,
  composed: ThisConversationComposed,
): { readonly text: string; readonly is: LeadInFront['is'] } | null {
  const whole = conversationBlock(composed.text)
  if (held.sections === null || held.sections.size === 0) return { text: whole, is: 'whole' }
  // ⛔ A section the thread holds that this launch no longer has (renamed, dropped) would stand: only
  // the whole replaces what it has.
  const now = sectionsOf(composed)
  if ([...held.sections.keys()].some((heading) => !now.has(heading))) {
    return { text: whole, is: 'whole' }
  }
  const changed = [...sectionsOf(composed)].filter(
    ([heading, text]) => held.sections?.get(heading) !== text,
  )
  if (changed.length === 0) return null
  return { text: whatChangedBlock(changed.map(([, text]) => text)), is: 'what-changed' }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** ⚑ A launch's stored text for this conversation, checked; ⛔ anything else is `null`. */
function aComposition(value: unknown): ThisConversationComposed | null {
  if (!isRecord(value) || typeof value['text'] !== 'string' || !Array.isArray(value['sections'])) {
    return null
  }
  const text = value['text']
  const sections: InstructionSpan[] = []
  for (const one of value['sections']) {
    if (!isRecord(one)) return null
    const { whose, heading, start, end } = one
    if (typeof whose !== 'string' || (heading !== null && typeof heading !== 'string')) return null
    if (typeof start !== 'number' || typeof end !== 'number') return null
    if (start < 0 || end < start || end > text.length) return null
    sections.push({ whose: whose as InstructionSpan['whose'], heading, start, end })
  }
  return { text, sections }
}

/** ⚑ A message's stored lead, checked; ⛔ anything else is `null`. */
function aLead(value: unknown): LeadInFront | null {
  if (!isRecord(value)) return null
  const { is, chars } = value
  if ((is !== 'whole' && is !== 'what-changed') || typeof chars !== 'number') return null
  return Number.isInteger(chars) && chars > 0 ? { is, chars } : null
}

/** ⚑ **The store's rows, each field checked** ({@link LeadRow}). */
export function leadRowsFrom(rows: readonly ThreadLeadRow[]): LeadRow[] {
  return rows.map((row): LeadRow => {
    const { ordinal } = row
    if (row.rowType === 'launched') {
      return { ordinal, kind: 'a-launch', conversation: aComposition(row.conversation) }
    }
    if (row.rowType === 'turn')
      return { ordinal, kind: 'a-turn-ended', failedByThisApp: row.failedByThisApp }
    if (row.rowType === 'compaction' || row.rowType === 'conversation_reset') {
      return { ordinal, kind: 'its-history-rewritten' }
    }
    return {
      ordinal,
      kind: 'a-message',
      handedOver: row.handedOver,
      sent: row.sent,
      lead: aLead(row.lead),
    }
  })
}
