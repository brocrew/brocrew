import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { page } from 'vitest/browser'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { IdentityUse } from '../../src/shared/agent-roster'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import {
  NOTHING_HAS_ARRIVED,
  type ConversationAtWork,
  type WhatIsBeingDone,
} from '../../src/shared/what-is-being-done'
import { drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **588's inversion, on the Team card** — `EXT-013` §2.4 measured a row that carried four facts,
 * none of them the one a person wants, which is *what is she doing right now*. The repair is a line
 * that is READ FIRST: bigger and bolder than the quiet facts under it (its age, and the honest
 * "nothing published" line).
 *
 * ## ⛔ Why this file exists
 *
 * `588`'s own paint tests went with the project page at D-016, and the surviving Team card compared
 * only its STATE line (`.team-now`) with the slug. The doing line — `.team-doing` — was declared
 * "`588`'s, declaration for declaration" in a comment and measured nowhere, so dropping it to the
 * size and weight of the age beside it turned nothing red.
 *
 * ## ⚑ What it asserts
 *
 * A RELATION between two elements of one row in one mount, in both axes of weight (size and
 * boldness), for both tones the line has and against both quiet lines it can sit above. ⛔ Never a
 * pinned `--text-2xs`: a number goes green the day the scale moves; the inversion is what is
 * guarded.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/** ⛔ The pane floor — `--app-min-w` 1180 less `--rail-w` 208, the arithmetic `588` used. */
const FLOOR = 972

/** ⚑ Anchored to the wall clock: the page measures every age it draws from the live minute. */
const NOW = Date.now()

const CHOSEN = {
  maxDepth: 'default',
  canMessage: 'default',
  canAssignWork: 'default',
  canCreateAgents: 'default',
  canWriteRules: 'default',
} as unknown as AgentIdentity['chosen']

const ADA: AgentIdentity = {
  id: 'aid:ada',
  slug: 'ada',
  displayName: 'Ada',
  createdAt: NOW - 86_400_000,
  createdBy: null,
  provider: 'claude',
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: CHOSEN,
}

const ADA_USE: IdentityUse = {
  slug: 'ada',
  conversations: 4,
  thisAppMintsIt: false,
  isLaunching: false,
  isStarting: false,
  runsOn: { provider: 'claude', from: 'saved' },
}

const AGENTS: AgentIdentities = {
  identities: [ADA],
  foldersWithoutARow: [],
  use: [ADA_USE],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
}

const STORE = {
  renameTo: vi.fn(async () => null),
  remove: vi.fn(async () => null),
} as unknown as AgentStore

/** ⚑ A conversation that published an activity — `phase: 'waiting'` draws the second tone. */
const publishing = (
  conversation: string,
  phase: 'tool' | 'waiting',
  detail: string | null,
): ConversationAtWork => ({
  conversation,
  identity: 'ada',
  told: { said: 'an-activity', phase, detail },
  status: 'working',
  streaming: false,
  since: NOW - 4_000,
  context: null,
})

/** ⚑ A conversation this app is running and has heard NOTHING from — it draws the quiet line. */
const silent = (conversation: string): ConversationAtWork => ({
  conversation,
  identity: 'ada',
  told: NOTHING_HAS_ARRIVED,
  status: 'idle',
  streaming: false,
  since: NOW - 4_000,
  context: null,
})

const done = (rows: readonly ConversationAtWork[]): WhatIsBeingDone => ({
  readAt: NOW,
  conversations: rows,
})

const room = async (rows: readonly ConversationAtWork[]): Promise<Mounted> => {
  await page.viewport(FLOOR, 900)
  const m = mount(
    TeamWorkspace,
    { agents: AGENTS, store: STORE, beingDone: done(rows), held: [], conversations: [] },
    { width: FLOOR, height: 900 },
  )
  await nextTick()
  await drawnReady()
  return m
}

const q = (root: HTMLElement, cy: string): HTMLElement => {
  const el = root.querySelector<HTMLElement>(`[data-cy="${cy}"]`)
  expect(el, `nothing with data-cy="${cy}" is inside this card`).not.toBeNull()
  return el!
}

const size = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize)
const weight = (el: Element): number => Number.parseInt(getComputedStyle(el).fontWeight, 10)

beforeEach(() => vi.clearAllMocks())

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('588 · the doing line is what a person reads first on the Team card', () => {
  /**
   * 🔴 **Against the age beside it, in the same row** — `.doing-since` is the quiet fact on the
   * line itself, so the comparison is one row against itself and cannot be satisfied by a
   * neighbour. ⚑ Measured on the WORD (the ink a person reads) and on the row that carries it.
   */
  it('🔴 the words are larger and bolder than the age on the same line, in both tones', async () => {
    const m = await room([
      publishing('sess_tool', 'tool', 'Bash'),
      publishing('sess_wait', 'waiting', null),
    ])
    const card = m.q('team-card-ada')
    const tones: readonly [string, string, string][] = [
      ['the running tone', 'team-doing-sess_tool', ''],
      ['the waiting tone', 'team-doing-sess_wait', 'waiting'],
    ]
    for (const [what, cy, tone] of tones) {
      const row = q(card, cy)
      // ⛔ **The premise**: each row really is the tone it is named for, so the loop is not
      // measuring one arm twice.
      expect(row.classList.contains('waiting'), `${what} is not the tone it was mounted as`).toBe(
        tone === 'waiting',
      )
      const word = row.querySelector<HTMLElement>('.doing-word')!
      const age = row.querySelector<HTMLElement>('.doing-since')!
      expect(word.textContent?.trim().length, `${what} draws no words`).toBeGreaterThan(0)
      expect(age.textContent, `${what} draws no age`).toMatch(/\S/)
      // ⚑ **The quiet fact is a real, drawn size** — a comparison against 0 or NaN is vacuous.
      expect(size(age), `the age has no font size in ${what}`).toBeGreaterThan(0)
      expect(size(word), `the words are not larger than the age in ${what}`).toBeGreaterThan(
        size(age),
      )
      expect(weight(word), `the words are not bolder than the age in ${what}`).toBeGreaterThan(
        weight(age),
      )
      // ⛔ **The row carries the declaration** and the word only inherits it, so the row is read
      // too: a repair that sized the word alone would leave the dot and the age on the old step.
      expect(size(row), `the row is not larger than the age in ${what}`).toBeGreaterThan(size(age))
      expect(weight(row), `the row is not bolder than the age in ${what}`).toBeGreaterThan(
        weight(age),
      )
    }
  })

  /**
   * 🔴 **Against the honest line for a conversation that has said nothing** — the other quiet fact
   * on the card, drawn in the same list by a sibling row. ⚑ The pair is one mount, so the loud line
   * and the quiet one are drawn under the same cascade at the same width.
   *
   * ⚠️ **Paired negative**: the silent row is asserted to be the quiet register itself (it draws no
   * doing line at all), so the comparison is loud-against-quiet and never loud-against-loud.
   */
  it('🔴 the words are larger and bolder than the "nothing published" line beside them', async () => {
    const m = await room([publishing('sess_tool', 'tool', 'Bash'), silent('sess_quiet')])
    const card = m.q('team-card-ada')
    const quiet = q(card, 'team-quiet-sess_quiet')
    expect(quiet.textContent, 'the silent row did not say it published nothing').toMatch(
      /Nothing published/,
    )
    expect(
      card.querySelector('[data-cy="team-doing-sess_quiet"]'),
      'the silent row drew a doing line as well, so it is not the quiet register',
    ).toBeNull()
    const word = q(card, 'team-doing-sess_tool').querySelector<HTMLElement>('.doing-word')!
    expect(size(quiet), 'the quiet line has no font size').toBeGreaterThan(0)
    expect(size(word), 'the words are not larger than the quiet line').toBeGreaterThan(size(quiet))
    expect(weight(word), 'the words are not bolder than the quiet line').toBeGreaterThan(
      weight(quiet),
    )
  })
})
