import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import EventStream from '../src/renderer/src/components/EventStream.vue'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import { createWindow, type WindowState } from '../src/renderer/src/lib/transcript-window'
import type { TranscriptItem } from '../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * 211 §4 · **The tab that still sees what the conversation stopped drawing.**
 *
 * ⛔ **Why this file exists at all.** `transcript-mode.ts` now keeps recognized chatter out of the
 * conversation in BOTH views — correctly; 210 read a Codex plan through 208 `item/plan/delta`
 * markers. But the live smoke's step `7b` measured the 049 classification by reading
 * `chatter-entry`'s `data-category` off the transcript, and after the fix most of those rows are not
 * there: *"no plan chatter on screen"* and *"no plan chatter at all"* would read the same.
 *
 * ⚠️ **A filter can blind the instrument that justifies it.** So the category moved onto the raw
 * row, where nothing is filtered, and step `7b` reads it there — upstream of the thing it is
 * measuring. These tests are what stop that attribute being renamed or dropped without a red.
 */

/**
 * ⚠️ **The component takes the WINDOW now, not the entries** (237 §1) — so the default here is a
 * complete one, and the tests below that care about completeness build their own.
 */
const render = (
  messages: RuntimeEventMessage[],
  over: Partial<WindowState> = {},
): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(EventStream as never, { window: { ...createWindow(), entries: messages, ...over } }),
    }),
  )

const at = 1_700_000_000_000

const message = (ordinal: number, event: RuntimeEventMessage['event']): RuntimeEventMessage => ({
  sessionId: 'sess_a',
  ordinal,
  at: at + ordinal,
  event,
})

const unknown = (ordinal: number, category: string): RuntimeEventMessage =>
  message(ordinal, {
    type: 'unknown',
    provider: 'codex',
    category,
    label: 'item/plan/delta',
    raw: { ordinal },
  } as RuntimeEventMessage['event'])

/** The categories the conversation drops — the ones this tab is the only place to count. */
const DROPPED = ['reasoning', 'plan', 'activity', 'echo'] as const

describe('a raw row says how its payload was classified', () => {
  it('an `unknown` row carries its category, and a lifecycle frame carries none', async () => {
    const html = await render([
      message(0, {
        type: 'session',
        state: 'started',
        ref: { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      }),
      unknown(1, 'plan'),
    ])

    expect(html).toContain('data-category="plan"')
    // ⚑ The paired positive AND the shape of the absence: the `session` row is rendered, and it has
    // no category at all rather than an empty one. A `data-` bound to `undefined` is not emitted,
    // which is what keeps "no question asked" from reading as "the answer is blank".
    expect(html).toContain('data-type="session"')
    expect(html).not.toContain('data-category=""')
  })

  it('⛔ every category the conversation drops is countable HERE', async () => {
    const messages = DROPPED.map((category, index) => unknown(index, category))
    const html = await render(messages)

    for (const category of DROPPED) {
      // The two halves of the claim, side by side: the conversation refuses it…
      const item: TranscriptItem = {
        kind: 'unknown',
        id: `u_${category}`,
        provider: 'codex',
        category,
        raw: {},
      }
      expect(isVisibleIn('debug', item), `${category} is drawn in the lifecycle view`).toBe(false)
      expect(isVisibleIn('normal', item), `${category} is drawn in the conversation`).toBe(false)
      // …and this tab names it, which is the only reason the refusal above is measurable live.
      expect(html, `${category} is not countable in the raw stream`).toContain(
        `data-category="${category}"`,
      )
    }
  })

  it('the two categories the conversation DOES draw are here as well — it filters nothing', async () => {
    // The tab's `what this is` disclosure says *"Nothing here is filtered out"* — 526 moved it
    // off the standing head — and this is that sentence as an assertion: the rows the conversation
    // keeps are not special-cased out of the stream.
    const html = await render([unknown(0, 'lifecycle'), unknown(1, 'unrecognized')])

    for (const category of ['lifecycle', 'unrecognized']) {
      expect(html).toContain(`data-category="${category}"`)
    }
    expect(html).toMatch(/2 events/)
  })
})

/**
 * ⛔ **A BOUNDED tab can blind the instrument that justifies an absence** (237 §1, from `230` H1).
 *
 * ⚠️ **This is the file above's own argument, one level up, and it took a reviewer to see it.** The
 * category moved onto the raw row so a filtered conversation could not blind the instrument that
 * justified the filter. But the array under both surfaces is ONE bounded window — 2,500 events a
 * page, two pages held, the oldest 1,251 released on event 5,001 — and this tab said *"Here you
 * always see everything"* over it. So *"no `Bash` row in the ledger"* could mean the model never
 * called it, or that the row had been released; the live smoke's three absence steps could not tell,
 * and neither could a person.
 *
 * ⚑ **The fact rides on the list it is about.** Not on a sibling, which could describe a different
 * moment, and not from main, which is a different process answering *"how far does the ledger go"*
 * rather than *"was the array I just read whole"*.
 */
describe('the raw tab says whether it is the whole ledger (237 §1)', () => {
  it('⚑ a complete window says so, on the list and in words', async () => {
    const html = await render([unknown(0, 'plan')])

    expect(html).toContain('data-whole="true"')
    expect(html).toContain('data-has-older="false"')
    expect(html).toContain('data-at-tail="true"')
    expect(html).toContain('This is the whole ledger')
    // ⛔ The promise that was false is gone, and the true half of it stays.
    expect(html).not.toContain('you always see everything')
    expect(html).toContain('Nothing here is filtered out')
  })

  /**
   * 🔴 **526 split that note, and this assertion is what stops the split from being silent.**
   *
   * ⛔ **The clause above — *"Nothing here is filtered out"* — now lives inside a disclosure that
   * is SHUT on arrival**, and it is still in the markup because the fold is `v-show`. ⚠️ So the
   * `toContain` two lines up went on passing about a sentence a person no longer sees, which is
   * exactly `brobot2-ssr-tests-pass-vacuously`: this project renders markup and has no layout, so
   * *"in the HTML"* and *"on the screen"* stopped being the same claim on this element.
   *
   * ⚑ **The two facts did NOT move**, and that is the load-bearing half. `237 §1` put the count
   * and the reach sentence on this tab because a reader could not otherwise tell a complete ledger
   * from a window onto one, and `scripts/ui-live-smoke.mjs` refuses a run whose
   * `[data-cy=event-log-reach]` does not say *whole ledger* in words. A fold that could swallow
   * either would be `237`'s defect rebuilt as a gesture.
   *
   * 🔴 **What is SEEN rather than merely emitted is asserted in the engine** —
   * `test/dom/the-tab-with-241-things.dom.test.ts` §4, which is the only project that can tell.
   */
  it('🔴 …and 526 put the EXPLANATION behind a shut disclosure, never the two facts', async () => {
    const html = await render([unknown(0, 'plan')])

    // The trigger ships shut, and the block it controls ships hidden rather than absent.
    expect(html).toContain('data-cy="event-log-why"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/data-cy="event-log-explanation"[^>]*style="display:\s*none/)

    // ⛔ The reach sentence and the count are OUTSIDE it — asserted as a position in the markup,
    // not as presence, because presence is what the shut block also has.
    const explanation = html.indexOf('data-cy="event-log-explanation"')
    const reach = html.indexOf('data-cy="event-log-reach"')
    expect(explanation, 'the explanation is not in the markup at all').toBeGreaterThan(-1)
    expect(reach, 'the reach sentence is not in the markup at all').toBeGreaterThan(-1)
    expect(reach, 'the reach sentence moved inside the fold').toBeLessThan(explanation)
    expect(html.slice(explanation)).not.toContain('event-log-reach')

    // ⚑ …and the explanation really is the half that folded, or the assertion above is about
    // nothing: this is the clause the test before this one still finds in the bytes.
    expect(html.slice(explanation)).toContain('Nothing here is filtered out')
  })

  it('⛔ a RELEASED window says it is a window, and where it begins', async () => {
    const html = await render([unknown(1_251, 'plan')], { from: 1_251, hasOlder: true })

    expect(html).toContain('data-whole="false"')
    expect(html).toContain('data-has-older="true"')
    expect(html).toContain('data-from="1251"')
    expect(html).toContain('WINDOW onto the ledger, beginning at ordinal 1251')
    expect(html).not.toContain('This is the whole ledger')
  })

  it('⛔ …and a window cut mid-turn says THAT, rather than implying a boundary', async () => {
    const html = await render([unknown(9, 'plan')], {
      from: 9,
      hasOlder: true,
      turnAligned: false,
    })
    expect(html).toContain('cut mid-turn')
  })

  /**
   * ⚠️ **The cheaper, quieter half.** Off the tail the array FREEZES — live events go to the control
   * tail instead — while this tab stays mounted and its count stops moving. Nothing on this surface
   * said so; the only cue was `transcript-behind`, which is in the conversation, not here.
   */
  it('⛔ a window off the tail says how much it is missing', async () => {
    const html = await render([unknown(0, 'plan')], { atTail: false, behind: 12 })

    expect(html).toContain('data-whole="false"')
    expect(html).toContain('data-at-tail="false"')
    expect(html).toContain('data-behind="12"')
    expect(html).toContain('12 newer events have arrived and are not in this list')
    // ⚑ …and the count beside it is still the number of ROWS, which is why the sentence is needed:
    // `1 event` next to a ledger of thirteen is exactly the reading this fixes.
    expect(html).toMatch(/1 event\b/)
  })

  /**
   * ⚠️ **`behind: 1` is the value between the two the other cases cover, and it read wrong.**
   * `12` and `0` were both fine and the sentence in between said *"1 newer event **have** arrived"*.
   * That is `coverage-that-jumps-over-the-middle` on a string: the boundary is the singular.
   */
  it('⚑ …and one is one, in the verb as well as the noun', async () => {
    const html = await render([unknown(0, 'plan')], { atTail: false, behind: 1 })
    expect(html).toContain('1 newer event has arrived and is not in this list')
    expect(html).not.toContain('1 newer event have')
    expect(html).toContain('data-behind="1"')
  })

  it('⚑ off the tail with nothing counted yet still refuses to claim completeness', async () => {
    const html = await render([unknown(0, 'plan')], { atTail: false, behind: 0 })
    expect(html).toContain('data-whole="false"')
    expect(html).toContain('it no longer holds the newest event')
  })
})

/**
 * ⛔ **The fold is a CLASS, not a filter** (255 §2).
 *
 * ⚠️ **This file's job here is the MARKUP half and nothing else.** Whether the fold is worth
 * anything — layout skipped, a scrollbar that means what it says, the rows you scrolled to being
 * the rows that get drawn — is a question `renderToString` cannot be asked, and
 * `test/dom/event-fold.dom.test.ts` asks it in a real engine (`251` §0, and the standing note that
 * an SSR assertion can pass over a component the browser could not render at all).
 *
 * ⚑ **What CAN be asserted from a string is the one thing that had to not change**: the row, its
 * three data attributes and its detail are emitted for every event in the window, whether or not
 * anything is drawing it. That is what `ledgerRows` (093), `235`'s erasure marker and `ledgerReach`
 * read, and a fold that removed rows would have blinded all three at once.
 */
describe('a folded row is still a row (255 §2)', () => {
  /** Comfortably past the 60 rows the component decorates before it has measured anything. */
  const LONG = Array.from({ length: 140 }, (_unused, index) => unknown(index, 'plan'))

  it('⛔ every row in the window is emitted, decorated or not', async () => {
    const html = await render(LONG)

    expect(html.match(/data-type="unknown"/g)).toHaveLength(140)
    expect(html.match(/data-category="plan"/g)).toHaveLength(140)
    expect(html.match(/class="rdetail"/g)).toHaveLength(140)
    // ⚑ Every row's ordinal, including the last — a fold that sliced would stop at 60.
    expect(html).toContain('data-ordinal="139"')
  })

  it('⛔ …and the ones past the fold have lost the DECORATION, which is the point', async () => {
    const html = await render(LONG)

    // 60 rows keep the timestamp and the type chip; the other 80 are folded and keep neither.
    expect(html.match(/class="rts"/g)).toHaveLength(60)
    expect(html.match(/class="rtype"/g)).toHaveLength(60)
    // ⚠️ **Matched inside the CLASS attribute rather than on the bare word.** `folded` also appears
    // in the template's own comments, which SSR emits, so a `toContain` here (and the negative in
    // the next test) would be answering a question about prose. ⚑ And not anchored on `raw-event`
    // either: Vue puts the DYNAMIC classes first, so the attribute reads `k-unknown folded
    // raw-event` — an assertion that assumed the order failed, which is how this was found.
    expect(html.match(/class="[^"]*\bfolded\b[^"]*"/g)).toHaveLength(80)
    expect(html).toContain('data-drawn="60"')
  })

  it('⚑ a window shorter than the fold folds nothing, and says so', async () => {
    // The paired positive: `folded` is not a word this component always emits, and `data-drawn` is
    // not always the same number — both would be true of a component that had stopped folding.
    const html = await render([unknown(0, 'plan'), unknown(1, 'plan')])

    expect(html).not.toMatch(/class="[^"]*\bfolded\b[^"]*"/)
    expect(html).toContain('data-drawn="2"')
    expect(html.match(/class="rts"/g)).toHaveLength(2)
  })
})

/**
 * 263 §3 · **A quiet level is drawn quietly.**
 *
 * ⛔ **`kindOf` used to end in `default: return ''`, and three events took it.** `workflow_run`,
 * `background_work` and `scheduled_work` are all LEVELS — *"here is what exists"* frames — and the
 * default gave every one of them the bright CONTENT ink, so the raw screen drew a background-task
 * roster as loudly as an assistant message. ⚠️ Nothing dropped and nothing crashed; the failure is
 * that the screen said the wrong thing, and that the next variant would inherit the same unruled
 * decision without anyone choosing it.
 *
 * ⚑ **The compiler now forces the ruling** — `EVENT_KIND` is a `Record` over the whole union with no
 * default arm — but a compiler cannot say WHICH way a ruling went. These assertions do.
 */
describe('the colour key is ruled for every event, not defaulted (263 §3)', () => {
  const classOf = (html: string, type: string): string => {
    const found = new RegExp(`<li class="([^"]*)"[^>]*data-type="${type}"`).exec(html)
    expect(found, `no row with data-type="${type}" in the markup`).toBeTruthy()
    return found![1]!
  }

  const LEVELS: RuntimeEventMessage['event'][] = [
    { type: 'workflow_run', taskId: 'wf_1', source: 'task_started' },
    { type: 'background_work', running: [], source: 'background_tasks_changed' },
    { type: 'scheduled_work', jobs: [], source: 'hook/Stop' },
  ] as never

  it('⛔ the three level events are lifecycle, not content', async () => {
    const html = await render(LEVELS.map((event, index) => message(index, event)))

    for (const event of LEVELS) {
      expect(classOf(html, event.type), `${event.type} is drawn as content`).toContain(
        'k-lifecycle',
      )
    }
  })

  it('⚑ …and the classes they were missing are real — a tool call and a message still differ', async () => {
    // The paired positive (193). Asserting `k-lifecycle` above says nothing unless SOME row gets a
    // different key and SOME row deliberately gets none: a component that stamped `k-lifecycle` on
    // everything would satisfy the test above and be just as wrong.
    const html = await render([
      message(0, { type: 'tool_call', name: 'Bash', id: 'c1', input: {} } as never),
      message(1, { type: 'assistant_message', text: 'hello' } as never),
      message(2, { type: 'error', fatal: false, message: 'nope' } as never),
    ])

    expect(classOf(html, 'tool_call')).toContain('k-tool')
    expect(classOf(html, 'error')).toContain('k-error')
    // Content carries no colour key at all — that is a ruling too, and `''` is how it is spelled.
    expect(classOf(html, 'assistant_message')).not.toMatch(/\bk-/)
  })
})
