import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { CreatedSession, ReleasedSession } from '../src/shared/runtime-ipc'
import SessionHeader from '../src/renderer/src/components/SessionHeader.vue'
import {
  HAND_IT_BACK,
  handBackOffer,
  handedBackSays,
} from '../src/renderer/src/lib/handing-it-back'

/**
 * 🔴 **523 · the surface half — the press that undoes *Take it over and open it*.**
 *
 * ## ⛔ What this file measures, and what `a-look-he-can-take-back.test.ts` measures instead
 *
 * The companion test checks the host action, its refusals, and the conversation remaining
 * where it started. This renderer test checks the controls a person can see and whether any
 * can be mistaken for ending the conversation; the bar has no such control or cost line.
 *
 * ⛔ **These are SSR renders — no DOM, no clicks** (086's rule for this project), so every negative
 * below is paired with a positive on the same markup: `not.toContain('hand-it-back')` passes against
 * a component that rendered nothing at all. ⚑ The one claim SSR genuinely cannot make — *one press
 * reaches the host, with nothing armed in front of it* — is in
 * `dom/a-look-he-can-take-back.dom.test.ts`, because it is a claim about presses.
 */

const liveness = {
  state: 'live' as const,
  since: 1_700_000_000_000,
  signInSuperseded: false,
}

/** A conversation an agent started, that this window has taken over — the population Q3 admits. */
const CLAIMED: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/checkout',
  providerHome: '/homes/claude',
  profileId: 'default',
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  ref: null,
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'm',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  queued: [],
  liveness,
  hasACommander: true,
  startedWithoutAWindow: true,
  mayHandItBack: true,
}

/**
 * ⛔ **The control one fact over** — the same conversation, started by this window.
 *
 * ⚠️ Both fields move together here because that is what the host answers for a slot a window
 * reserved; the point of the pair below is that the SURFACE decides on `mayHandItBack` alone.
 */
const STARTED_HERE: CreatedSession = {
  ...CLAIMED,
  startedWithoutAWindow: false,
  mayHandItBack: false,
}

/**
 * 🔴 **The markup with the component's own prose taken out of it.**
 *
 * ⛔ **Vue's SSR renderer KEEPS `<!-- -->` comments**, and this bar is one of the most heavily
 * commented templates in the app — including a paragraph that names this control and quotes its
 * words. ⚠️ So `not.toContain('Hand it back')` over the raw string is a negative that reads the
 * docblock ARGUING for the button rather than the button, and it fails on a pane that correctly drew
 * nothing. ⚑ Same shape as `a-source-census-must-strip-prose-before-it-asserts`, one layer up:
 * strip the prose before asserting about the words.
 *
 * ⛔ **Narrowly, and `data-cy` assertions deliberately use the RAW string**, because an attribute
 * cannot hide inside a comment and a strip that was too wide would be invisible here.
 */
const visible = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, '')

const header = (session: CreatedSession | null, over: Record<string, unknown> = {}) =>
  renderToString(
    createSSRApp({
      render: () =>
        h(SessionHeader as never, {
          session,
          status: 'idle',
          debug: false,
          facets: { doing: 'idle' as const, being: 'live' as const },
          ...over,
        }),
    }),
  )

describe('§1 · Q3 · the control is absent where the press would be refused', () => {
  it('🔴 a conversation this window took over offers it; the same pane for one it STARTED does not', async () => {
    const claimed = await header(CLAIMED)
    expect(claimed).toContain('data-cy="hand-it-back"')
    expect(visible(claimed)).toContain(HAND_IT_BACK)

    const mine = await header(STARTED_HERE)
    // ⚑ **Paired with a positive on the SAME markup**, so the absence is about this control rather
    // than about a render that produced nothing: the pane is fully drawn, and the drawer toggle
    // beside it is exactly where it was.
    expect(mine).toContain('data-cy="toggle-session-panel"')
    expect(mine).not.toContain('data-cy="hand-it-back"')
    expect(visible(mine)).not.toContain(HAND_IT_BACK)
  })

  it('⛔ the launcher — a header with no conversation under it — offers neither', async () => {
    const empty = await header(null)
    expect(empty).not.toContain('data-cy="hand-it-back"')
    expect(empty).not.toContain('data-cy="toggle-session-panel"')
    // ⚑ **563 · the pair, and it is a READING rather than a mount.** The two lines above were the
    // only assertions in this block, so they passed against a header that rendered nothing at all —
    // and a `toContain('data-cy="session-header"')` beside them would only have moved that up one
    // tier. ⛔ **What a person actually reads on the launcher is the heading**, and it is the
    // heading that makes the absences facts about these two controls (⚑ D-017b: the drawer toggle
    // stands in for the End press, which no header draws any more).
    expect(visible(empty)).toContain('New conversation')
  })

  it('⚠️ it is `mayHandItBack` that decides, not the origin beside it', () => {
    // 🔴 **The two fields are not one fact.** The origin is frozen for the life of the conversation;
    // releasability begins at a claim and ends at a release. A surface that keyed on the origin would
    // draw this control on a conversation this window is merely reading about.
    expect(handBackOffer({ mayHandItBack: true })).toEqual({ action: HAND_IT_BACK })
    expect(handBackOffer({ mayHandItBack: false })).toBeNull()
    expect(handBackOffer(null)).toBeNull()
  })
})

describe('§3 · Q1 · it cannot be read as the control that ends the conversation', () => {
  it('🔴 D-017b · there is no control on the bar that ends it — the press is the only one of its kind', async () => {
    // ⛔ **The subject of `519` F2 is gone, not solved by distance.** It was a person unable to tell
    // the safe act from the destructive one beside it; since D-017b a conversation is never ended,
    // so the bar draws no End press (and no door in front of one) to mistake this for.
    const html = await header(CLAIMED, { drawerOpen: false, tools: undefined })
    // ⚑ **The positive on the SAME markup**: the bar is fully drawn, with this press and the two
    // controls that stand beside it.
    for (const cy of ['hand-it-back', 'toggle-debug-mode', 'toggle-session-panel']) {
      expect(html, `nothing with data-cy="${cy}" was rendered`).toContain(`data-cy="${cy}"`)
    }
    expect(html).not.toContain('data-cy="close-session"')
    expect(html).not.toContain('data-cy="ending-door"')
  })

  it('⛔ the word names the conversation, and it is not a word about ending', () => {
    // ⚠️ `taking-over.ts` supplies *"Take it over and open it"*; this is the half that undoes it, and
    // the pair is legible without either of them mentioning the other.
    expect(HAND_IT_BACK).toBe('Hand it back')
    for (const ending of ['End', 'Close', 'Stop', 'Delete', 'Remove']) {
      expect(HAND_IT_BACK).not.toContain(ending)
    }
  })
})

describe('§4 · what a person is told afterwards is computed from the outcome', () => {
  const released = (over: Partial<ReleasedSession> = {}): ReleasedSession => ({
    sessionId: 'sess_1',
    running: 'unwatched',
    waitingForAHuman: false,
    ...over,
  })

  it('🔴 a release that did not take is REPORTED as not having taken', () => {
    // ⛔ **Standing rule 18**: the surface may not say *done* from the absence of a throw. Every word
    // below comes from the host's own post-write read, so this arm exists at all.
    expect(handedBackSays(released({ running: 'in-a-window' }))).toContain('did not hand')
    expect(handedBackSays(released())).toContain('Handed back')
  })

  it('⚑ …and it carries the standing question through to the sentence', () => {
    expect(handedBackSays(released({ waitingForAHuman: true }))).toContain('cannot be answered')
    expect(handedBackSays(released({ waitingForAHuman: false }))).not.toContain(
      'cannot be answered',
    )
    // ⚠️ The pair that stops the first arm being a constant: both say what this window gave up —
    // ⚑ D-017b: the view stays on screen, so never *not open in any window* — and ⚑ D-017 · F024
    // neither says whether anything runs (`05` rule 5).
    for (const waiting of [true, false]) {
      const said = handedBackSays(released({ waitingForAHuman: waiting }))
      expect(said).toContain('this window no longer holds it')
      expect(said).not.toContain('not open in any window')
      expect(said).not.toContain('running')
    }
  })
})
