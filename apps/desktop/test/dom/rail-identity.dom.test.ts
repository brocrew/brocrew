import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import {
  acceptEvent,
  createSessionRecord,
  openWindow,
} from '../../src/renderer/src/lib/session-record'
import type { HistoryWindow, RuntimeEventMessage } from '../../src/shared/runtime-ipc'
import { drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import { DEFAULT_PROFILE_ID, DEFAULT_PROFILE_LABEL } from '../../src/shared/runtime-ipc'

/**
 * 211 §3 · **Two live conversations must not be indistinguishable** (from 210 finding 4).
 *
 * > *"Both rail rows read exactly `workspace-a / codex · idle`. No title, no age, no identity cue.
 * > The explorer had to open each to find out which was which."*
 *
 * ⚠️ **In the DOM project.** The claim is about two rows a person is looking at, so what is asserted
 * is the rendered text of both — one string is not evidence that two rows differ, and the
 * `brobot2-ssr-tests-pass-vacuously` rule says a negative over markup proves nothing on its own.
 *
 * ⛔ **The negative control comes first**: two conversations with the same profile, the same folder
 * and the same provider, and nothing said in either. Those rows ARE identical, and they are supposed
 * to be — nothing has happened in them to tell them apart. That is what makes the second test a
 * measurement rather than a coincidence.
 */

const NOW = Date.now()
const FOLDER = '/Users/alex/dev/workspace-a'

const page = (over: Partial<HistoryWindow> = {}): HistoryWindow => ({
  entries: [],
  from: 0,
  hasOlder: false,
  turnAligned: true,
  ...over,
})

/** An open conversation the rail can draw — same profile, same folder, same provider, every time. */
function conversation(
  sessionId: string,
  said: string | null,
  resumedPartWayIn = false,
  // ⚑ **449 · who and where, defaulted to the values every test above already assumed**, so nothing
  // in 211 §3 changed shape when this file gained a second subject.
  who = DEFAULT_PROFILE_ID,
  where = FOLDER,
): unknown {
  const record = createSessionRecord(sessionId)
  record.meta = {
    sessionId,
    provider: 'codex',
    cwd: where,
    profileId: who,
    ref: { provider: 'codex', sessionId: 'live', cwd: where, rotation: 0 },
    approvalMode: 'ask',
    liveness: { state: 'live', since: NOW },
  } as never
  if (resumedPartWayIn) openWindow(record, page({ from: 900, hasOlder: true }))
  if (said !== null) {
    acceptEvent(record, {
      sessionId,
      ordinal: resumedPartWayIn ? 900 : 0,
      at: NOW,
      event: { type: 'user_turn', text: said },
    } as RuntimeEventMessage)
  }
  return record
}

/** The rail, at the 200px column it really is, with the host's list stubbed out. */
async function rail(
  open: unknown[],
  agents: unknown = null,
  // ⚑ **449 · the rail's OTHER two lists**, so a claim about *the rail* is not a claim about one
  // of its three sections — which is what two surviving mutation rows measured about this file.
  recorded: unknown[] = [],
): Promise<Mounted> {
  const stub = window as unknown as { api?: unknown }
  stub.api = {
    runtime: {
      listResumable: () => Promise.resolve(recorded),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const m = mount(
    SideRail,
    { open, activeId: null, place: null, agents },
    { width: 200, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return m
}

/** ⚑ **449 · the roster BOTH surfaces draw from** — the rail's rows and the Team page's cards,
 *  since `EXT-008` §4.4 moved the list off the rail at `570` — as the wire shape. */
const roster = (...slugs: [string, string | null][]): unknown => ({
  identities: slugs.map(([slug, displayName]) => ({
    id: `aid:${slug}`,
    slug,
    displayName,
    createdAt: NOW,
    capabilities: DEFAULT_CAPABILITIES,
    chosen: {},
    provider: null,
  })),
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  // ⚑ **516** — the registry rides the same read; empty is the answer every install starts with.
  externalMcpServers: [],
})

/** Everything a person can read in the row, whitespace-collapsed the way they would read it. */
const rowText = (m: Mounted, sessionId: string): string =>
  (m.q(`open-session-${sessionId}`).textContent ?? '').replace(/\s+/g, ' ').trim()

/** ⚑ **449 · the row's own name**, which is WHO is in it. */
const nameOf = (m: Mounted, sessionId: string): string =>
  m.q(`open-session-${sessionId}`).querySelector('strong')?.textContent?.trim() ?? ''

/** ⚑ **449 · WHERE it is working**, read off the hook rather than parsed out of the line. */
const placeOf = (m: Mounted, sessionId: string): string | null =>
  (
    m.q(`open-session-${sessionId}`).querySelector('small[data-standing]') as HTMLElement
  ).getAttribute('data-place')

afterEach(() => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
})

describe('211 §3 · a rail row says which conversation it is', () => {
  it('⛔ THE BUG: same profile, same folder, nothing said — the two rows are the same string', async () => {
    const m = await rail([conversation('sess_bug', null), conversation('sess_plan', null)])

    expect(rowText(m, 'sess_bug')).toBe(rowText(m, 'sess_plan'))
    // …and this is what they both read, which is 210's sentence.
    expect(rowText(m, 'sess_bug')).toContain('workspace-a')
    expect(rowText(m, 'sess_bug')).toContain('codex')
  })

  it('⛔ THE FIX: the same two, once each has been asked something, are tellable apart', async () => {
    const m = await rail([
      conversation('sess_bug', 'Fix the line count in summarize.mjs'),
      conversation('sess_plan', 'Propose a JSON-output plan. Do not edit anything.'),
    ])

    const bug = rowText(m, 'sess_bug')
    const plan = rowText(m, 'sess_plan')

    expect(bug).not.toBe(plan)
    expect(bug).toContain('Fix the line count in summarize.mjs')
    expect(plan).toContain('Propose a JSON-output plan.')
    // ⚑ **The folder and the status did NOT move.** The row gained a fact; it did not trade one for
    // another, and 099's `data-standing` hook is still where every cross-surface test reads it.
    for (const text of [bug, plan]) {
      expect(text).toContain('workspace-a')
      expect(text).toContain('codex')
    }
    const row = m.q('open-session-sess_bug')
    expect(
      row.querySelector('small[data-standing]'),
      'the status line lost its hook',
    ).not.toBeNull()

    // ⛔ **The row now holds TWO `small`s, and that is what broke two live-smoke readers** (211 §3,
    // found by running it). `snapshot()` and step 13 both read `row.querySelector('small')` — a
    // POSITIONAL selector, unambiguous for as long as there was one line and silently wrong the
    // moment there were two. Step 13's failure quoted this step's own prompt back where it expected
    // a provider name. Both read `small[data-standing]` now, and this is the fact they rely on:
    // there is more than one, and only one of them is the status.
    expect(row.querySelectorAll('small')).toHaveLength(2)
    expect(row.querySelector('small')).not.toBe(row.querySelector('small[data-standing]'))
  })

  it('the whole prompt is one hover away when the row had to cut it', async () => {
    const long = `Rewrite ${'the very long instruction '.repeat(20)}and then stop.`
    const m = await rail([conversation('sess_long', long)])
    const line = m.q('session-opening-sess_long')
    await drawnReady()

    expect(line.textContent?.trim().endsWith('…')).toBe(true)
    expect(line.getAttribute('title')?.endsWith('…')).toBe(true)
    // The excerpt stays on one line, with the complete excerpt in its hover text.
    expect(getComputedStyle(line).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
    expect(line.title).toBe(line.textContent?.trim())
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth)
    expect(line.getBoundingClientRect().height).toBeGreaterThan(0)
    const row = m.q('open-session-sess_long').getBoundingClientRect()
    const status = m
      .q('open-session-sess_long')
      .querySelector('small[data-standing]')!
      .getBoundingClientRect()
    expect(status.top).toBeGreaterThanOrEqual(line.getBoundingClientRect().bottom - 1)
    expect(status.bottom).toBeLessThanOrEqual(row.bottom + 1)
  })

  it('⛔ a conversation whose beginning we never saw says nothing extra', async () => {
    // A session reopened part-way through a long ledger. It has a `user_turn` on screen and it is
    // NOT the first one, so the row declines to name the conversation after it.
    const m = await rail([
      conversation('sess_partial', '…and now the third thing', true),
      conversation('sess_whole', 'Fix the line count in summarize.mjs'),
    ])

    expect(m.all('session-opening-sess_partial')).toHaveLength(0)
    expect(rowText(m, 'sess_partial')).not.toContain('and now the third thing')
    // The paired positive, in the same rail: the row beside it does carry one, so the absence above
    // is about that conversation and not about the rail having stopped drawing the line.
    expect(m.all('session-opening-sess_whole')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ 449 §A · who is in it */

/**
 * 🔴 **449 §A · a row says WHO is in it, and the folder is what tells two of one agent apart.**
 *
 * The conversation rail must identify each agent’s role rather than repeat the shared
 * `brobot-workspace` folder name. Role names such as `default`, `project-manager`, and
 * `worker` distinguish conversations started in that one workspace.
 *
 * ⚠️ **At 200px, which is the column the rail really is** — the same width every test above uses,
 * and `421` §5.1 paid for a test that measured a different one.
 */
describe('449 §A · the row names the agent, and still places it', () => {
  /**
   * ⛔ **THE DEFECT, reproduced as the thing a person actually saw**: three conversations, three
   * different agents, one folder. ⚑ Before this dispatch all three rows were the same string.
   */
  it('⛔ THE DEFECT: three agents in one folder are three different rows now', async () => {
    const m = await rail(
      [
        conversation('sess_bro', null, false, DEFAULT_PROFILE_ID),
        conversation('sess_pm', null, false, 'project-manager'),
        conversation('sess_worker', null, false, 'worker'),
      ],
      roster([DEFAULT_PROFILE_ID, null], ['project-manager', 'Project manager'], ['worker', null]),
    )

    const said = ['sess_bro', 'sess_pm', 'sess_worker'].map((id) => rowText(m, id))
    expect(new Set(said).size, said.join(' | ')).toBe(3)
    expect(nameOf(m, 'sess_bro')).toBe(DEFAULT_PROFILE_LABEL)
    // ⚑ **The display name `423` gave a person a control for**, preferred over the slug.
    expect(nameOf(m, 'sess_pm')).toBe('Project manager')
    // ⚠️ …and the slug when nobody named it, which is the other half of the same `??`.
    expect(nameOf(m, 'sess_worker')).toBe('worker')

    // 🔴 **THE TRAP: the folder did not go away.** It is the one fact that tells two conversations
    // of ONE agent apart, so dropping it would have rebuilt `210` finding 4 with the axes swapped.
    for (const id of ['sess_bro', 'sess_pm', 'sess_worker']) {
      expect(rowText(m, id), id).toContain('workspace-a')
    }
  })

  /**
   * ⛔ **THE NEGATIVE §3 asks for: two conversations in different PLACES cannot read as one.**
   *
   * ⚑ **One agent, two folders, nothing said in either** — which is precisely the state `211 §3`'s
   * control shows is indistinguishable when the only difference is invisible.
   */
  it('🔴 THE NEGATIVE: one agent in two places is two rows, and the place is the difference', async () => {
    const m = await rail(
      [
        conversation('sess_here', null, false, 'project-manager', '/Users/alex/dev/workspace-a'),
        conversation('sess_there', null, false, 'project-manager', '/Users/alex/dev/acme'),
      ],
      roster(['project-manager', 'Project manager']),
    )

    expect(rowText(m, 'sess_here')).not.toBe(rowText(m, 'sess_there'))
    // ⚑ **They agree about WHO**, which is what makes the difference above be about WHERE.
    expect(nameOf(m, 'sess_here')).toBe(nameOf(m, 'sess_there'))
    expect(placeOf(m, 'sess_here')).toBe('workspace-a')
    expect(placeOf(m, 'sess_there')).toBe('acme')
  })

  /**
   * 🔴 **ONE SPELLING, measured across the two lists that draw an identity in this window.**
   *
   * ⛔ **They disagreed until 449**: the conversation row read `basenameOf(cwd)` and the AGENTS row
   * read the display-name fallback, so a person could not connect a row to the agent that was in
   * it — which is `099`'s defect, one subject over.
   *
   * ## ⚠️ 570 · the second list left the rail, and the property got harder rather than weaker
   *
   * ⛔ **`EXT-008` §4.4 took the AGENTS section out of the navigation column**, so the two lists
   * are no longer two sections of one component: they are the rail's conversation rows and
   * `TeamWorkspace`'s cards. ⚑ **Both are mounted here, from ONE roster object**, which is what
   * keeps this an equality between surfaces rather than two independent readings that happen to
   * agree. 🔴 **This is the assertion that would have caught the defect `570` found in `568`'s
   * fold** — it wrote `identity.displayName ?? identity.slug`, so `default` read `default` on the
   * page while the rail called the same identity `BroBot (default)`, and nothing in the repo was
   * looking at both at once.
   */
  it('⚑ the conversation row and the Team card name one identity identically', async () => {
    const list = roster(['project-manager', 'Project manager'], [DEFAULT_PROFILE_ID, null])
    const m = await rail([conversation('sess_pm', null, false, 'project-manager')], list)
    const team = mount(
      TeamWorkspace,
      {
        agents: list,
        store: {
          renameTo: () => {
            throw new Error('a naming test must not write')
          },
          remove: () => {
            throw new Error('a naming test must not write')
          },
        },
      },
      { width: 1100, height: 900 },
    )
    await nextTick()
    expect(nameOf(m, 'sess_pm')).toBe(team.q('team-name-project-manager').textContent?.trim())
    // ⚠️ **The pairing, on the identity nobody named**, so the equality above is not about one
    // display name being present in two places. ⛔ **And it is the one slug where the two
    // expressions differ**: `agentName` answers `BroBot (default)` and a literal `?? slug` answers
    // `default`, which `167 §2` ruled must never be shown.
    expect(team.q(`team-name-${DEFAULT_PROFILE_ID}`).textContent?.trim()).toBe(
      DEFAULT_PROFILE_LABEL,
    )
    expect(nameOf(m, 'sess_pm')).toBe('Project manager')
  })

  /**
   * The place is last: the row's own word (*waiting on you*, and which kind) is what a glance must
   * land on first. The complete status and folder remain on hover when the line is shortened.
   */
  it('⛔ the place comes after the word, and the whole of it is one hover away', async () => {
    const long = 'a-very-long-directory-name-that-will-not-fit-in-two-hundred-pixels'
    const m = await rail(
      [conversation('sess_long', null, false, DEFAULT_PROFILE_ID, `/Users/alex/dev/${long}`)],
      roster([DEFAULT_PROFILE_ID, null]),
    )
    const line = m.q('open-session-sess_long').querySelector('small[data-standing]') as HTMLElement
    await drawnReady()
    expect(line.textContent?.trim().startsWith('codex · ')).toBe(true)
    expect(line.textContent?.trim().endsWith(long)).toBe(true)
    expect(line.getAttribute('title')).toContain(long)
    // The status is shortened visually; the full status and folder remain on hover.
    expect(getComputedStyle(line).whiteSpace).toBe('nowrap')
    expect(getComputedStyle(line).textOverflow).toBe('ellipsis')
    expect(line.title).toBe(line.textContent?.trim())
    expect(line.scrollWidth).toBeGreaterThan(line.clientWidth)
    expect(line.getBoundingClientRect().height).toBeGreaterThan(0)
    const row = m.q('open-session-sess_long').getBoundingClientRect()
    expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(row.right + 1)
    expect(line.getBoundingClientRect().bottom).toBeLessThanOrEqual(row.bottom + 1)
  })

  /**
   * ⛔ **The OTHER null, and it must not be folded into the first one.**
   *
   * ⚑ **A record this window has made and the host has not answered for yet has no `meta` at all**,
   * so there is no identity to read. ⚠️ Naming it *BroBot (default)* on the strength of that would
   * be inventing one — which is precisely what `profileLabel`'s own note forbids, one null over.
   */
  it('⛔ a conversation the host has not answered for yet is named by its id, not by an agent', async () => {
    const bare = createSessionRecord('sess_pending')
    const m = await rail([bare], roster([DEFAULT_PROFILE_ID, null]))
    expect(nameOf(m, 'sess_pending')).toBe('sess_pending')
    // ⚑ **The pairing in the same mount**: a record that DOES have meta is named by its agent, so
    // the line above is about the absence rather than about the rail having stopped naming things.
    const both = await rail(
      [bare, conversation('sess_real', null, false, DEFAULT_PROFILE_ID)],
      roster([DEFAULT_PROFILE_ID, null]),
    )
    expect(nameOf(both, 'sess_pending')).toBe('sess_pending')
    expect(nameOf(both, 'sess_real')).toBe(DEFAULT_PROFILE_LABEL)
  })

  /**
   * 🔴 **THE OTHER TWO LISTS, and two mutation rows survived this file for want of them.**
   *
   * ⛔ **The rail drew conversations in THREE sections until D-017b** — open, *Not open in this
   * window* (`421`) and the recorded ones. ⚑ **D-017b folded them into ONE list**, and it still has
   * two derivations: a row this window holds is drawn from its record, and every other row from the
   * host's list (`conversation-list.ts`). ⚠️ Every test above this one stubs the host's list out, so
   * a change that reached only the held rows would read as a change to the rail.
   *
   * ⚑ **Both facts on both kinds of host row, in one mount**, which is also what proves the roster
   * reaches the fold rather than only the component.
   */
  it('🔴 the recorded and the unwatched rows say who and where too, from the same roster', async () => {
    const recorded = (sessionId: string, running: string, cwd: string): unknown => ({
      sessionId,
      provider: 'claude',
      ref: { provider: 'claude', sessionId: `th_${sessionId}`, cwd, rotation: 0 },
      cwd,
      status: 'idle',
      running,
      // ⚑ **D-017 · R11** — the one state the host says of it, which the row draws.
      state: { is: 'idle' },
      // ⚑ **D-016 · commit 7 · R2 — it holds no piece**, so its row is titled by its agent.
      named: null,
      approvalMode: 'ask',
      profileId: 'project-manager',
      reasoningEffort: null,
      model: null,
      planMode: null,
      adoptedAt: null,
      hasTranscript: true,
      lastEnding: 'completed',
      child: null,
      updatedAt: NOW - 240_000,
      resumeRefusal: null,
    })
    const m = await rail([], roster(['project-manager', 'Project manager']), [
      recorded('sess_done', 'not-running', '/Users/alex/dev/acme'),
      recorded('sess_live', 'unwatched', '/Users/alex/dev/workspace-a'),
    ])
    // ⚑ **D-017b · no section to open** — both are rows of the one list, under the same hook as a
    // held row (`m.q` throws if either is missing).
    for (const [id, where] of [
      ['sess_done', 'acme'],
      ['sess_live', 'workspace-a'],
    ] as const) {
      const row = m.q(`open-session-${id}`)
      // ⛔ **The display name a person set, on a row the roster had to reach through the fold.**
      expect(nameOf(m, id), id).toBe('Project manager')
      // ⚑ **And WHERE** — on the hook a held row carries it on, and in the words a person reads.
      expect(placeOf(m, id), id).toBe(where)
      expect(rowText(m, id), id).toContain(where)
      // ⚠️ **One `<small>`**: the status line. The opening line is absent, because this window never
      // saw the conversation's beginning (`211 §3`'s rule, on a host row).
      expect(row.querySelectorAll('small'), id).toHaveLength(1)
    }
  })

  /**
   * ⚑ **A cold rail has no roster** — the agents read has not landed, or there is no database — and
   * the row must say LESS rather than something else.
   */
  it('⚠️ with no roster the row still says who, in the words the rest of the app uses', async () => {
    const m = await rail([conversation('sess_pm', null, false, 'project-manager')])
    expect(nameOf(m, 'sess_pm')).toBe('project-manager')
    expect(placeOf(m, 'sess_pm')).toBe('workspace-a')
  })
})
