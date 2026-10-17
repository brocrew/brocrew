import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { IdentityUse } from '../../src/shared/agent-roster'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import type { WhatIsBeingDone } from '../../src/shared/what-is-being-done'
import { drawnReady } from './drawn'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * ⛔ **An empty section is one line and never a box** — `EXT-013` §2.3: *"an empty section needs
 * one line or none."* The Team card's Conversations disclosure has two such sections, an unanswered
 * list and an answered list holding none of the agent's, and each is a single `.shelf-quiet`
 * sentence.
 *
 * ⚠️ **What this file adds, and what its neighbour cannot see.** `the-avatar-is-the-status` asserts
 * the SENTENCE, its visibility and the zero rows. None of that goes red when the sentence acquires
 * a border, and a border is the `009` hazard the gap rule is about: a box says *something goes
 * here*, and nothing does. So this file measures the one thing a border is, the computed width of
 * the four sides, on the same two lines.
 *
 * ⚑ **The paired positive is the disclosure itself.** `.card-more` draws a 1px top rule, so the
 * sensor is seen to answer `1px` on the same mount that answers `0px` for the sentence.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/** ⛔ The pane floor — `--app-min-w` 1180 less `--rail-w` 208, the width every Team case uses. */
const FLOOR = 972

const NOW = Date.now()

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

const use = (slug: string, over: Partial<IdentityUse> = {}): IdentityUse => ({
  slug,
  conversations: 0,
  thisAppMintsIt: false,
  isLaunching: false,
  isStarting: false,
  runsOn: { provider: null, from: 'nothing-yet' },
  ...over,
})

/** ⚑ Ada has run before (`conversations: 4`), so her card draws the Conversations disclosure. */
const AGENTS: AgentIdentities = {
  identities: [ident('ada', { displayName: 'Ada', provider: 'claude' })],
  foldersWithoutARow: [],
  use: [use('ada', { conversations: 4 })],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const NOTHING_BEING_DONE: WhatIsBeingDone = { readAt: NOW, conversations: [] }

const listed = (over: Partial<ListedConversation> & { sessionId: string }): ListedConversation => ({
  provider: 'claude',
  label: 'Ada',
  identity: 'ada',
  place: null,
  state: { is: 'idle' },
  // ⚑ D-016 · commit 7 · R2 — a conversation holding no piece: its shelf row names no work.
  named: null,
  inAnotherWindow: false,
  updatedAt: NOW - 60_000,
  ...over,
})

const STORE = {
  renameTo: vi.fn(async () => null),
  remove: vi.fn(async () => null),
} as unknown as AgentStore

const room = async (conversations: readonly ListedConversation[] | null): Promise<Mounted> => {
  await page.viewport(FLOOR, 900)
  const m = mount(
    TeamWorkspace,
    {
      agents: AGENTS,
      store: STORE,
      beingDone: NOTHING_BEING_DONE,
      held: [],
      conversations,
    },
    { width: FLOOR, height: 900 },
  )
  await nextTick()
  await drawnReady()
  return m
}

/** ⚠️ A `<details>` toggle is an asynchronous task; the settled frame is what is measured. */
const press = async (details: HTMLDetailsElement): Promise<void> => {
  const toggled = new Promise<void>((resolve) => {
    details.addEventListener('toggle', () => resolve(), { once: true })
  })
  details.open = !details.open
  await toggled
  for (let round = 0; round < 3; round++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
  await drawnReady()
}

/** ⚑ Ada's Conversations disclosure, opened. */
const opened = async (m: Mounted): Promise<HTMLDetailsElement> => {
  const details = m
    .q('team-card-ada')
    .querySelector<HTMLElement>('[data-cy="team-conversations-ada"]')!
    .closest('details') as HTMLDetailsElement
  expect(details, 'the card draws no Conversations disclosure').not.toBeNull()
  await press(details)
  expect(details.open).toBe(true)
  return details
}

/** ⛔ Every side, because a plant may draw a rule on any one of them. */
const widths = (el: Element): Record<'Top' | 'Right' | 'Bottom' | 'Left', string> => {
  const style = getComputedStyle(el)
  return {
    Top: style.borderTopWidth,
    Right: style.borderRightWidth,
    Bottom: style.borderBottomWidth,
    Left: style.borderLeftWidth,
  }
}
const NONE = { Top: '0px', Right: '0px', Bottom: '0px', Left: '0px' }

beforeEach(() => vi.clearAllMocks())

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('⛔ an empty section is one line and never a box', () => {
  /**
   * ⚑ **The positive control, alone** — the same disclosure draws a rule on its own top edge, so a
   * border here reads as the width the sensor is looking for and not as `0px` for every element.
   */
  it('⚑ the disclosure draws a 1px rule on its top edge, so the sensor can see a border', async () => {
    const m = await room([listed({ sessionId: 'sess_old' })])
    const details = await opened(m)
    expect(visible(details)).toBe(true)
    expect(widths(details).Top, 'the control no longer draws a border to see').toBe('1px')
    // ⚠️ **And the shelf that holds rows draws no quiet line at all**, so the two absences below
    // are absences of the sentence's box and not of the shelf.
    expect(details.querySelectorAll('.shelf-row')).toHaveLength(1)
    expect(details.querySelector('.shelf-quiet')).toBeNull()
  })

  it('⛔ an answered list with none of theirs says one line, drawn without a border on any side', async () => {
    const m = await room([listed({ sessionId: 'sess_ali', identity: 'ali', label: 'Ali' })])
    const details = await opened(m)
    const quiet = details.querySelector<HTMLElement>('.shelf-quiet')
    expect(quiet, 'an empty shelf draws no sentence at all').not.toBeNull()
    expect(visible(quiet!)).toBe(true)
    expect(quiet!.textContent?.trim()).toBe('No conversation on the list runs as it.')
    expect(details.querySelectorAll('.shelf-row')).toHaveLength(0)
    // ⚠️ **Read off the same mount as the 1px above** — the disclosure around it still draws its rule.
    expect(widths(details).Top).toBe('1px')
    expect(widths(quiet!), 'the empty line is a box').toEqual(NONE)
  })

  it('⛔ a list that has not answered says one line, drawn without a border on any side', async () => {
    const m = await room(null)
    const details = await opened(m)
    const quiet = details.querySelector<HTMLElement>('.shelf-quiet')
    expect(quiet, 'an unanswered shelf draws no sentence at all').not.toBeNull()
    expect(visible(quiet!)).toBe(true)
    expect(quiet!.textContent?.trim()).toBe('The list of conversations has not answered yet.')
    expect(details.querySelectorAll('.shelf-row')).toHaveLength(0)
    expect(widths(details).Top).toBe('1px')
    expect(widths(quiet!), 'the unanswered line is a box').toEqual(NONE)
  })
})
