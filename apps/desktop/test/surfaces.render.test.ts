import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import WaitingOnYou from '../src/renderer/src/components/WaitingOnYou.vue'
import RecentActivity from '../src/renderer/src/components/RecentActivity.vue'
import type { AttentionRequest } from '../src/renderer/src/lib/attention'
import { DEFAULT_ACTIVITY_WINDOW_MS } from '../src/renderer/src/lib/recent-activity'

/**
 * The surfaces, rendered (Slice 2 · 009).
 *
 * The claim these have to earn is the one the typed foundation was built for: **the surface reads
 * fields**. So the tests below hand the components a world and watch what they draw — which is
 * something no amount of reading the markup can tell you.
 *
 * ⚑ **D-016** deleted Home and the project workspace, the demo seed they drew and its fixtures, so
 * every case about them went with them. What remains is the two destinations `606` gave the
 * overview (`EXT-008` §3) — *Waiting on you* and *Recent activity* — and what each says when it
 * is empty.
 */

const render = (component: unknown, props: Record<string, unknown> = {}): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(component as never, props) }))

const TO = 1_760_000_000_000
const notReadYet = { reading: null, windowMs: DEFAULT_ACTIVITY_WINDOW_MS, clock: TO }
const nothingRecorded = {
  ...notReadYet,
  reading: {
    window: { from: TO - DEFAULT_ACTIVITY_WINDOW_MS, to: TO },
    read: { walk: 'one-window-over-every-agents-conversation', ledgers: 4, rowsUnread: 0 },
    lines: [],
    capped: false,
  },
}

describe('the two destinations say their own half', () => {
  it('goes quiet when nothing needs you — each destination saying its own half', async () => {
    // ⚑ **606 · the quiet state is spread over the destinations** (`EXT-008` §3), and each one is
    // asserted where it lives. ⛔ Reading only one of them would be
    // `a-negative-is-only-as-strong-as-the-search-shape`: the sentences moved.
    const waiting = await render(WaitingOnYou, { needsYou: [] })
    const away = await render(RecentActivity, notReadYet)

    expect(waiting).toContain('All clear')
    // ⚠️ **`attention-empty` is gone and this is its replacement** (305 §1). The panel's own clear
    // block is what says the region is empty, and it is what 067 asks for.
    expect(waiting).toContain('data-cy="attention-clear"')
    // ⛔ **`'Everything is quiet'` until 211 §2**, and Recent activity keeps the rule: with nothing
    // read it says so, which is a different and narrower thing than a calm sentence.
    expect(away).toContain('data-cy="activity-not-read"')
  })

  it('⛔ the quiet reassurance states what the queue MEANS and enumerates no vocabulary (250)', async () => {
    // ⚠️ **Held by nothing until 250's adversarial pass said so.** This line read *"Every open
    // conversation is either working or idle"* — a list of two over a vocabulary that already had
    // `waiting`, `unknown` and `errored` in it and that 250 gave an eighth entry. A grep for either
    // sentence across `src`, `test` and `scripts` matched only the component itself, so it could be
    // reverted, mistyped or left stale and every gate would pass.
    //
    // The claim is absence of a standings enumeration: a list of state words becomes stale as
    // the vocabulary grows. The positive pins the current sentence while the negatives pin
    // its shape; draw it at the destination owning the described population.
    const html = await render(WaitingOnYou, { needsYou: [] })

    // ⚠️ **Read from the paragraph, not from the page.** Vue's SSR emits HTML comments, and this
    // component's own comment quotes the sentence it replaced — so a whole-page `not.toContain`
    // would fail on the explanation of why the string is gone. Scoping it is the difference between
    // asserting the SURFACE and asserting the file.
    const from = html.indexOf('waiting-intro')
    expect(from, 'the attention intro did not render').toBeGreaterThan(-1)
    // ⚑ **606 · backwards, because the handle now sits ON the paragraph** rather than on a wrapper
    // above it — a forward search finds the NEXT paragraph, which is the bound sentence beside it.
    const opens = html.lastIndexOf('<p', from)
    const closes = html.indexOf('</p>', opens)
    expect(opens, 'the intro has no paragraph').toBeGreaterThan(-1)
    const intro = html.slice(opens, closes)
    expect(intro).toContain('Nothing here is blocked on an answer from you.')
    expect(intro).not.toContain('either working or idle')
    expect(intro).not.toContain('working, idle, or')
  })
})

describe('a fresh install renders empty, and says so (012)', () => {
  it('a fresh install: zero everywhere, on each destination', async () => {
    // ⚑ **606 · one screen became several** (`EXT-008` §3), and `012`'s claim is about all of them:
    // every empty region says it is empty. ⛔ Asserting it on one would leave the other unmeasured.
    const waiting = await render(WaitingOnYou, { needsYou: [] })
    const away = await render(RecentActivity, notReadYet)

    expect(waiting).toContain('All clear')
    // ⚠️ **`attention-empty` → `attention-clear`** (305 §1): the panel's own clear block is the one
    // that says the region is empty, which is the claim 012 and 067 actually make.
    expect(waiting).toContain('data-cy="attention-clear"')
    expect(waiting).toContain('Nothing needs you.')
    // ⚑ **438 · the digest on a fresh install has not been READ, which is not a zero.** A "0"
    // here would have been the strongest thing this screen could say about a database it has
    // not opened.
    expect(away).toContain('data-cy="activity-not-read"')
    expect(away).toContain('This isn’t the same as nothing having happened.')
    // ⛔ **Both destinations are wired and say so** — `§3.2`'s rule: a placeholder mark on
    // something wired is as false as a missing mark on something that is not.
    expect(waiting).toContain('data-wired="true"')
    expect(away).toContain('data-wired="true"')
  })
})

const WHOLE_APP_CLAIMS = ['Everything is quiet', 'All caught up', 'safe to close the app'] as const

const PENDING: AttentionRequest = {
  key: 'sess_codex_1:perm_1',
  sessionId: 'sess_codex_1',
  requestId: 'perm_1',
  itemId: 'item_1',
  kind: 'permission',
  where: 'workspace-a',
  hasACommander: false,
  provider: 'codex',
  profileId: 'default',
  who: 'default',
  standing: 'waiting on you (permission)',
  asked: 'apply_patch · edit summarize.mjs',
  scope: ['write /Users/alex/dev/workspace-a/summarize.mjs'],
  underDisclosed: false,
  detailOmitted: null,
  noPositive: null,
  at: TO - 165_700,
  decisions: [{ kind: 'permission', label: 'Allow', decision: { outcome: 'allow' } }],
  limit: null,
  sent: false,
  refused: null,
}

describe('neither destination claims the whole app is quiet (211 §2)', () => {
  it('⛔ with a live request waiting, no whole-app claim is on either screen', async () => {
    const queue = await render(WaitingOnYou, { needsYou: [PENDING] })
    const away = await render(RecentActivity, nothingRecorded)

    // The positives, so the negatives below are not asserted over a blank page.
    expect(queue).toContain('data-cy="attention-request-sess_codex_1"')
    expect(queue).toMatch(/data-cy="waiting-stat"[^>]*>\s*1 item/)
    expect(away).toContain('data-cy="activity-empty"')
    for (const claim of WHOLE_APP_CLAIMS) {
      expect(away, `Recent activity claims "${claim}" while 1 item is waiting`).not.toContain(claim)
      expect(queue, `the queue claims "${claim}" while 1 item is waiting`).not.toContain(claim)
    }
  })

  it('⛔ with nothing waiting and nothing recorded, neither says anything about the app', async () => {
    const queue = await render(WaitingOnYou, { needsYou: [] })
    const away = await render(RecentActivity, nothingRecorded)

    expect(queue).toMatch(/data-cy="waiting-stat"[^>]*>\s*All clear/)
    expect(away).toContain('No activity recorded in the last 12 hours.')
    for (const claim of WHOLE_APP_CLAIMS) {
      expect(away, `the quiet page claims "${claim}"`).not.toContain(claim)
      expect(queue, `the quiet queue claims "${claim}"`).not.toContain(claim)
    }
  })
})
