import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import type { WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import { drawnReady } from './drawn'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * 🔴 **`588` M21 · a disclosure whose UA triangle is suppressed must draw its own mark** (`106` — a
 * control a person cannot see is a control they do not have).
 *
 * ## ⚑ The rule
 *
 * `.card-more > summary` sets `list-style: none` and blanks `::marker`, so the browser's own
 * triangle is GONE from both disclosures on a Team card (the conversations door and the
 * details-name-and-removal door). ⛔ The only thing left on that line to say it opens is the `›`
 * that `.card-more > summary::before` draws. Take that one declaration away and the summary reads as
 * a bare line of text: nothing in the markup changes, nothing in the open / closed state changes, and
 * every other test in this directory (the tab-stop count, the open-and-close cases, the paint sweeps)
 * stays green.
 *
 * ## ⚠️ What is measured, and why it is a computed style
 *
 * ⛔ **A pseudo-element is not in the DOM**, so no `querySelector` and no `textContent` can see it —
 * only `getComputedStyle(summary, '::before').content` can. Chromium computes an absent `content` on
 * `::before` as `none`, which is exactly what the plant produces.
 *
 * ⚑ **Every negative is paired.** The suppression (`list-style-type: none`) is the reason the mark
 * is owed, so it is asserted on the SAME summaries as the mark; and the sheet door (`.card-door`,
 * which the stylesheet says wears NO marker on purpose) is measured on the same mount as the control
 * that says the sensor can answer `none`.
 */

const NOW = Date.now()
const FLOOR = 972
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

const CHOSEN = {
  maxDepth: 'default',
  canMessage: 'default',
  canAssignWork: 'default',
  canCreateAgents: 'default',
  canWriteRules: 'default',
} as unknown as AgentIdentity['chosen']

const ident = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName: null,
  createdAt: NOW - 86_400_000,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: CHOSEN,
  ...over,
})

const AGENTS: AgentIdentities = {
  identities: [ident('ada', { displayName: 'Ada', provider: 'claude' })],
  foldersWithoutARow: [],
  use: [
    {
      slug: 'ada',
      conversations: 1,
      thisAppMintsIt: false,
      isLaunching: false,
      isStarting: false,
      runsOn: { provider: 'claude', from: 'saved' },
    },
  ],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const NOTHING_DOING: WhatIsBeingDone = { readAt: NOW, conversations: [] }

const LIST: readonly ListedConversation[] = [
  {
    sessionId: 'sess_old',
    provider: 'claude',
    label: 'Ada',
    identity: 'ada',
    place: null,
    state: { is: 'idle' },
    // ⚑ D-016 · commit 7 · R2 — a conversation holding no piece.
    named: null,
    inAnotherWindow: false,
    updatedAt: NOW - 60_000,
  },
]

const STORE = {
  renameTo: vi.fn(async () => null),
  remove: vi.fn(async () => null),
} as unknown as AgentStore

const room = async (): Promise<Mounted> => {
  await page.viewport(FLOOR, 900)
  const m = mount(
    TeamWorkspace,
    { agents: AGENTS, store: STORE, beingDone: NOTHING_DOING, held: [], conversations: LIST },
    { width: FLOOR, height: 900 },
  )
  await nextTick()
  await drawnReady()
  return m
}

/** ⚑ The two `summary` elements of the card that the rule draws a mark for — by `data-cy`, so a
 *  restyle cannot move which two are measured. */
const summariesOf = (m: Mounted): Record<string, HTMLElement> => ({
  'the conversations door': m.q('team-conversations-ada'),
  'the details, name and removal door': m.q('team-more-ada'),
})

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('588 M21 · a disclosure whose browser triangle is suppressed draws a mark of its own', () => {
  it('🔴 both disclosures on a card draw the › on their summary line', async () => {
    const m = await room()
    const doors = summariesOf(m)
    expect(Object.keys(doors)).toHaveLength(2)
    for (const [name, summary] of Object.entries(doors)) {
      // ⚑ The premise: the summary is on screen, and the UA's own marker is suppressed — which is
      // the whole reason a mark of ours is owed.
      expect(visible(summary), `${name} is not drawn`).toBe(true)
      expect(getComputedStyle(summary).listStyleType, `${name} still has the UA marker`).toBe(
        'none',
      )
      // ⛔ The claim: with the UA marker gone, the pseudo-element is the only mark on the line.
      const mark = getComputedStyle(summary, '::before')
      expect(mark.content, `${name} draws no mark of its own`).toContain('›')
      expect(mark.display, `${name}'s mark is not a box that takes room`).toBe('inline-block')
    }
  })

  it('🔴 an opened disclosure still wears its mark, and a shut one beside it does too', async () => {
    const m = await room()
    const doors = summariesOf(m)
    const first = doors['the conversations door']!.closest('details') as HTMLDetailsElement
    const second = doors['the details, name and removal door']!.closest(
      'details',
    ) as HTMLDetailsElement
    expect(first.open).toBe(false)
    expect(second.open).toBe(false)
    const toggled = new Promise<void>((resolve) => {
      first.addEventListener('toggle', () => resolve(), { once: true })
    })
    first.open = true
    await toggled
    await nextTick()
    await drawnReady()
    // ⚑ The pair: one open, one shut, on one mount — the mark does not depend on the state. ⛔ The
    // shut one is READ, not only counted shut: its words are still the line a person sees.
    expect(first.open).toBe(true)
    expect(second.open).toBe(false)
    expect(doors['the conversations door']!.textContent?.trim()).toBe('Conversations')
    expect(doors['the details, name and removal door']!.textContent?.trim()).toBe(
      'Details, name and removal',
    )
    expect(getComputedStyle(doors['the conversations door']!, '::before').content).toContain('›')
    expect(
      getComputedStyle(doors['the details, name and removal door']!, '::before').content,
    ).toContain('›')
  })

  it('⛔ the sheet door beside them wears no such mark, so the sensor can say none', async () => {
    const m = await room()
    const door = m.q('team-shapes-ada')
    expect(visible(door)).toBe(true)
    // ⚑ The control: `.card-door` is a button that opens a sheet, and the stylesheet says it draws
    // NO caret — a caret promises *more of this card is below*. If this read `›` the case above
    // would prove nothing about the summary.
    expect(getComputedStyle(door, '::before').content).toBe('none')
  })
})
