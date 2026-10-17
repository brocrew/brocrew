import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import AgentState from '../src/renderer/src/components/AgentState.vue'
import {
  accessibleName,
  beingCondition,
  BEING_TOKEN,
  BEINGS,
  DOINGS,
  NEEDING_GLYPH,
  NEEDING_TOKEN,
  NEEDINGS,
  priorityDotToken,
  SIZES,
  type AgentFacets,
  type Being,
  type Doing,
  type Needing,
} from '../src/renderer/src/lib/agent-state'
import { CONVERSATION_WAITS } from '../src/shared/tasks'

/**
 * The agent plate, rendered (081/082).
 *
 * ⚠️ **These are SSR renders — markup, and nothing else.** No layout, no compositing, no computed
 * styles, no media queries, no clicks (086). So this file claims only what markup can carry: that
 * the right element exists, that it names the right token, and that the accessible sentence is the
 * one `lib/agent-state.ts` composed. Everything about how it LOOKS is asserted at its source in
 * `agent-state.test.ts`, or by an eye.
 *
 * **Every negative assertion below is paired with a positive one in the same test.** A component
 * that rendered nothing at all passes `not.toContain('agent-needing')`, and this component is
 * almost entirely `v-if` — the single worst combination for that failure, and the one the dispatch
 * named. Where a pairing was not possible the test says so instead of pretending.
 */

/**
 * # 🔴 The three vocabularies as this file REGISTERS them — literals, not the exported arrays
 *
 * ⛔ **A test whose COUNT depends on the value it is testing cannot measure that value** (268 §3,
 * from `260` §5's audit of `254`'s table). Three sweeps below are `it.each(<vocabulary>)`, and the
 * vocabularies are exported by the very module under test — so a change that drops a member
 * *un-registers a case*. ⚠️ **Measured rather than reasoned**: removing `'compacting'` from
 * {@link DOINGS} makes the `desktop` project collect **2,933 tests instead of 2,934**, and the
 * mutation harness — correctly, because a run that collects fewer tests is not a run of the suite
 * under test — reports `INVALID` and never looks at the five assertions that also went red.
 *
 * ⚑ **So registration is fixed and the vocabulary is what varies.** Dropping a member now leaves the
 * same cases registered and turns the floor below red, which is a verdict instead of a collection
 * error. `agent-state.test.ts`'s `toHaveLength(7)` is the same idea one file away; this is the half
 * that keeps it reachable.
 *
 * ⚠️ **`unknown` is deliberately absent from the first list.** It is the seventh DOING and the one
 * that draws no face — see the sweep that uses it.
 */
const DRAWN_DOINGS: readonly Doing[] = [
  'idle',
  'working',
  'thinking',
  'tool',
  'compacting',
  'replying',
]
const DRAWN_BEINGS: readonly Being[] = [
  'unstarted',
  'starting',
  'live',
  'silent',
  'closing',
  'ended',
  'errored',
]
const DEMANDED: readonly Needing[] = ['permission', 'question', 'plan']

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(AgentState, props) }))

/** The opening tag for a `data-cy`, so attributes can be read without depending on SSR's ORDER —
 *  Vue emits dynamic classes before static ones, which a substring assertion silently depends on. */
function tag(html: string, cy: string): string {
  const found = html.match(new RegExp(`<[a-z]+[^>]*data-cy="${cy}"[^>]*>`))?.[0] ?? ''
  expect(found, `nothing with data-cy="${cy}" was rendered`).not.toBe('')
  return found
}

/** The class list of that element, as a set. */
function classes(html: string, cy: string): Set<string> {
  return new Set((/class="([^"]*)"/.exec(tag(html, cy))?.[1] ?? '').split(/\s+/).filter(Boolean))
}

/**
 * # ⛔ THE AXES, and the floor that makes a SEVENTH facet impossible to add quietly (645)
 *
 * ⚠️ **This registry replaces five hand-written loops, and the reason is that the hand-written ones
 * failed.** `250` added a fourth facet and widened this file by hand; `258` added a fifth and
 * widened it by hand; `636` added a SIXTH — `waiting` — and nobody widened anything, so
 * `AgentState.vue` went on receiving it as a stray fallthrough attribute until `645`, and
 * the clause `636` wrote into `accessibleName` was a branch no call site could produce.
 *
 * ⚠️ **The function itself was never untested** — `three-surfaces-read-the-new-field.test.ts` has
 * pinned that sentence since `636`. ⛔ **This file is the only one that renders the COMPONENT over
 * the whole product**, so it is the only one that could have seen the wiring missing, and it is
 * the one that was five axes wide.
 *
 * 🔴 **The floor this file already carries could not have caught it.** *"the lists this file
 * registers from ARE the vocabularies (268 §3)"* guards the MEMBERS of `DOINGS`, `BEINGS` and
 * `NEEDINGS` — it says nothing about the SET OF AXES, which is the thing that went stale.
 *
 * ⛔ **So the axes are now exhaustive over `keyof AgentFacets` at COMPILE time**, by `-?` on the
 * mapped type: a facet added to `AgentFacets` and not to this object does not type-check, and a key
 * here that is not a facet is an excess property. ⚑ **And the loop below is pinned to this object
 * at RUN time** by the floor at the foot of the file, so declaring an axis and not sweeping it is
 * a red verdict too. Both directions, because `250`'s lesson is that one of them is not enough.
 *
 * ⚠️ **`CONVERSATION_WAITS` and not a literal list**, like `agent-state.test.ts`' census: the
 * roster is filtered out of `TASK_STATES`' own `waiting-on-` prefix (`609`), so a new wait a
 * conversation can be in joins this sweep without anybody remembering
 * ([[a-loop-over-a-literal-variant-list-is-not-exhaustive]]). ⛔ **D-016 · commit 6** — the one
 * wait said on a piece only, *waiting on you*, is no conversation's, and the facet cannot hold it.
 */
const FACET_AXES = {
  doing: [...DOINGS, undefined],
  being: [...BEINGS, undefined],
  needing: [...NEEDINGS, undefined],
  detached: [true, undefined],
  scheduled: [true, undefined],
  waiting: [...CONVERSATION_WAITS, undefined],
  // ⚑ **D-006 · the seventh**, one value per standing it can raise and its absence.
  work: [{ state: 'stalled' }, { state: 'answered', outcome: 'done' }, undefined],
  // ⚑ **F036 · the eighth** — an asker, and its absence (*+N* is a words test, not a facet's).
  owes: [['Ada (the owner of W1.2 · The pages)'], undefined],
} as const satisfies { [K in keyof AgentFacets]-?: readonly (AgentFacets[K] | undefined)[] }

/**
 * ⚑ **Every state the eight axes above can hold — 24,576 of them, absent facets genuinely absent.**
 *
 * ⛔ **The old note here said *"All 512 states"* and the product had been 1,280 since `446` added a
 * fourth NEEDING** — a number that outlived its derivation
 * ([[a-number-can-survive-the-death-of-its-derivation]]). ⚠️ The count is asserted at the foot of
 * the file now instead of being described here, so it cannot drift again.
 */
const ALL: AgentFacets[] = []
for (const doing of FACET_AXES.doing) {
  for (const being of FACET_AXES.being) {
    for (const needing of FACET_AXES.needing) {
      for (const detached of FACET_AXES.detached)
        for (const scheduled of FACET_AXES.scheduled)
          for (const waiting of FACET_AXES.waiting)
            for (const work of FACET_AXES.work)
              for (const owes of FACET_AXES.owes) {
                ALL.push({
                  ...(doing ? { doing } : {}),
                  ...(being ? { being } : {}),
                  ...(needing ? { needing } : {}),
                  ...(detached ? { detached } : {}),
                  ...(scheduled ? { scheduled } : {}),
                  ...(waiting ? { waiting } : {}),
                  ...(work ? { work } : {}),
                  ...(owes ? { owes } : {}),
                })
              }
    }
  }
}

describe('every DOING draws its own face, and the seventh draws none (acceptance 2)', () => {
  it.each(DRAWN_DOINGS)('%s is an illustration', async (doing) => {
    const html = await render({ doing, being: 'live' })
    expect(html).toContain('data-cy="agent-avatar"')
    // ⚠️ The RIGHT one, not just some one. The first draft of this line was
    // `toMatch(/data-cy="agent-avatar"[^>]*|<img[^>]*${doing}/)` — an alternation whose first
    // branch always matches, so the half that checked WHICH image never ran. Six components all
    // showing the idle robot would have passed it.
    const src = /<img[^>]*src="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(src, `no image src for ${doing}`).not.toBe('')
    expect(src).toContain(`${doing}.png`)
    // …and the faceless mark is NOT there, which is the pairing that makes the next test mean
    // something.
    expect(html).not.toContain('data-cy="agent-unknown"')
  })

  it('unknown is a faceless mark and never one of the six', async () => {
    const html = await render({ doing: 'unknown', being: 'live' })
    expect(html).toContain('data-cy="agent-unknown"')
    expect(html).not.toContain('<img')
    // The pairing: the plate and the underline DID render, so the missing <img> is a deliberate
    // absence rather than a component that produced nothing.
    expect(html).toContain('data-cy="agent-plate"')
    expect(html).toContain('data-cy="agent-underline"')
    expect(html).toContain('data-doing="unknown"')
  })

  it('an ABSENT doing is the same faceless mark — the prop is optional, not required', async () => {
    const html = await render({ being: 'live' })
    expect(html).toContain('data-cy="agent-unknown"')
    expect(html).not.toContain('<img')
    expect(html).toContain('data-doing="unknown"')
    expect(html).toContain('data-cy="agent-plate"')
  })

  it('each of the six resolves to a DIFFERENT image', async () => {
    // Six identical src attributes would pass every test above.
    const sources = await Promise.all(
      DOINGS.filter((doing) => doing !== 'unknown').map(async (doing) => {
        const html = await render({ doing })
        return /<img[^>]*src="([^"]+)"/.exec(html)?.[1] ?? ''
      }),
    )
    expect(sources.every(Boolean)).toBe(true)
    expect(new Set(sources).size).toBe(6)
  })
})

describe('every BEING draws its underline, and an absent one draws none (acceptance 2)', () => {
  it.each(DRAWN_BEINGS)('%s takes its own token', async (being) => {
    const html = await render({ doing: 'idle', being })
    expect(html).toContain('data-cy="agent-underline"')
    expect(html).toContain(`var(${BEING_TOKEN[being]})`)
    expect(html).toContain(`data-being="${being}"`)
    // A drawn underline is never the hidden one.
    expect(classes(html, 'agent-underline')).not.toContain('none')
  })

  it('an absent BEING keeps the slot and paints nothing in it', async () => {
    const html = await render({ doing: 'idle' })
    expect(html).toContain('data-cy="agent-underline"')
    expect(classes(html, 'agent-underline')).toContain('none')
    expect(html).not.toContain('data-being=')
    // The pairing: with a BEING, the same element is NOT hidden and DOES carry a colour.
    const withBeing = await render({ doing: 'idle', being: 'live' })
    expect(classes(withBeing, 'agent-underline')).not.toContain('none')
    expect(withBeing).toContain(`var(${BEING_TOKEN.live})`)
  })

  it('only silent and errored add a condition badge, on the OPPOSITE corner', async () => {
    for (const being of BEINGS) {
      const html = await render({ doing: 'idle', being })
      const expected = beingCondition(being)
      if (expected) {
        expect(html, being).toContain('data-cy="agent-condition"')
        expect(html, being).toContain(expected.glyph)
        expect(html, being).toContain(`var(${expected.token})`)
      } else {
        expect(html, being).not.toContain('data-cy="agent-condition"')
        // Paired: the underline for this BEING did render, so the absence is about the badge.
        expect(html, being).toContain(`var(${BEING_TOKEN[being]})`)
      }
    }
  })
})

describe('every NEEDING draws its badge (acceptance 2)', () => {
  it.each(DEMANDED)('%s is a glyph and a token, on the attention corner', async (needing) => {
    const html = await render({ doing: 'working', being: 'live', needing })
    expect(html).toContain('data-cy="agent-needing"')
    expect(html).toContain(NEEDING_GLYPH[needing])
    expect(html).toContain(`var(${NEEDING_TOKEN[needing]})`)
    expect(html).toContain(`data-needing="${needing}"`)
  })

  it('and an absent one draws nothing — with the plate still there to prove it rendered', async () => {
    const html = await render({ doing: 'working', being: 'live' })
    expect(html).not.toContain('data-cy="agent-needing"')
    expect(html).toContain('data-cy="agent-plate"')
    expect(html).toContain('data-cy="agent-avatar"')
    expect(html).not.toContain('data-needing=')
  })

  it('the three glyphs are three different glyphs', async () => {
    const used = await Promise.all(
      NEEDINGS.map(async (needing) => {
        const html = await render({ needing })
        return /<use href="([^"]+)"/.exec(html)?.[1] ?? ''
      }),
    )
    expect(used.every(Boolean)).toBe(true)
    // ⚑ **D-016 · three again since the proposal and its badge went.** Derived from `NEEDINGS`
    // above, so the number is the only thing that had to move.
    expect(new Set(used).size).toBe(3)
  })
})

describe('errored + permission draws BOTH facts (acceptance 4)', () => {
  it('the lock top-right, the bang bottom-right, and a red line under all of it', async () => {
    const html = await render({ doing: 'idle', being: 'errored', needing: 'permission' })
    expect(html).toContain('data-cy="agent-needing"')
    expect(html).toContain('data-cy="agent-condition"')
    expect(html).toContain('#i-lock')
    expect(html).toContain('#i-bang')
    expect(html).toContain(`var(${BEING_TOKEN.errored})`)
    expect(html).toContain(`var(${NEEDING_TOKEN.permission})`)
    // Two badges, not one drawn twice.
    expect([...html.matchAll(/class="badge /g)]).toHaveLength(2)
  })

  it('and at the dot floor, where there is one slot, NEEDING wins it', async () => {
    const html = await render({
      doing: 'idle',
      being: 'errored',
      needing: 'permission',
      size: 'dot',
    })
    expect(html).toContain('data-cy="agent-dot"')
    expect(html).toContain(`var(${NEEDING_TOKEN.permission})`)
    expect(html).not.toContain(`var(${BEING_TOKEN.errored})`)
    // …and the word still carries the error, which is why that is not a loss. ⚠️ Asserted on the
    // aria-label, not on the whole HTML: the root always carries `data-being="errored"`, so a plain
    // toContain('errored') passed whether or not the sentence mentioned it. Found in review.
    expect(/aria-label="([^"]*)"/.exec(html)?.[1]).toContain('errored')
  })
})

describe('the 24px floor (acceptance 3)', () => {
  it('below it: one dot, and none of the things a plate has', async () => {
    const html = await render({
      doing: 'thinking',
      being: 'live',
      needing: 'permission',
      size: 'dot',
    })
    expect(html).toContain('data-cy="agent-dot"')
    expect(html).not.toContain('data-cy="agent-plate"')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('data-cy="agent-underline"')
    expect(html).not.toContain('data-cy="agent-needing"')
    expect(html).toContain('data-dot="true"')
    // Exactly ONE mark.
    expect([...html.matchAll(/data-cy="agent-dot"/g)]).toHaveLength(1)
  })

  it('at it: the whole plate, which is the pairing for every absence above', async () => {
    const html = await render({
      doing: 'thinking',
      being: 'live',
      needing: 'permission',
      size: 'compact',
    })
    expect(html).toContain('data-cy="agent-plate"')
    expect(html).toContain('data-cy="agent-avatar"')
    expect(html).toContain('data-cy="agent-underline"')
    expect(html).toContain('data-cy="agent-needing"')
    expect(html).not.toContain('data-cy="agent-dot"')
    expect(html).toContain('data-dot="false"')
    expect(html).toContain('--sz:24px')
  })

  it('the dot takes the priority colour, over every state there is', async () => {
    // Four literals first, so a `priorityDotToken` that returned one constant for everything could
    // not satisfy the loop below by agreeing with itself (found in review).
    expect(await render({ needing: 'permission', size: 'dot' })).toContain('var(--waiting)')
    expect(await render({ being: 'errored', size: 'dot' })).toContain('var(--danger)')
    expect(await render({ doing: 'idle', size: 'dot' })).toContain('var(--ready)')
    expect(await render({ size: 'dot' })).toContain('var(--faint)')
    for (const facets of ALL) {
      const html = await render({ ...facets, size: 'dot' })
      expect(html, JSON.stringify(facets)).toContain(`var(${priorityDotToken(facets)})`)
    }
  })

  it('🔴 the fourth facet reaches the NAME and leaks no attribute (250)', async () => {
    // ⛔ **Both halves are the defect the adversarial pass over 250's diff found.** Every caller
    // spreads the whole facets object, so before the prop was declared `detached` fell through to
    // the root element as `detached="true"` — a stray DOM attribute — and `accessibleName` never saw
    // it, making the sentence 250 added a branch nothing could produce (`222` §4).
    const html = await render({ doing: 'idle', being: 'live', detached: true, label: 'claude' })
    expect(html).toContain('aria-label="claude — idle, live, work still running"')
    expect(tag(html, 'agent-state')).not.toContain('detached=')
    // …and the paired positive for that negative: the element really rendered, with its own
    // attributes on it, so `not.toContain` is not passing over an empty string.
    expect(tag(html, 'agent-state')).toContain('data-doing="idle"')
  })

  it('🔴 the SIXTH facet reaches the NAME and leaks no attribute either (636/645)', async () => {
    // ⛔ **250's test, one facet along — and this one went unmeasured until `645`.** `636`
    // taught `accessibleName` the clause and did not declare the prop, so every `v-bind="facets"`
    // put `waiting="waiting-on-a-worker"` on the root element and the sentence never said it.
    // ⚠️ **Nothing failed**, because the cross-product above had five axes while `AgentFacets` had
    // six — which is the hole the registry at the top of this file closes.
    const html = await render({
      doing: 'idle',
      being: 'live',
      waiting: 'waiting-on-a-worker',
      label: 'brobot',
    })
    expect(html).toContain('aria-label="brobot — idle, live, waiting on a worker"')
    // ⚑ Anchored, because the accessible name legitimately CONTAINS the word `waiting` followed by
    // a space — a bare `toContain('waiting=')` would be a negative that cannot fail for the right
    // reason.
    expect(tag(html, 'agent-state')).not.toMatch(/\bwaiting="/)
    // …and the paired positive for that negative, as above.
    expect(tag(html, 'agent-state')).toContain('data-doing="idle"')
  })

  it('⚠️ …and the one wait a NEEDING already names is said ONCE, by the needing', async () => {
    // ⛔ **The skip in `accessibleName` is a COMBINATION rule**, so it is asserted as one: *waiting
    // on you (permission)* names the card, and *waiting on a person* beside it would be the app
    // saying one fact twice in one sentence.
    const both = await render({
      doing: 'idle',
      waiting: 'waiting-on-a-person',
      needing: 'permission',
      label: 'brobot',
    })
    expect(both).toContain('aria-label="brobot — idle, needs you (permission)"')
    // ⚑ **The control, and it is what makes the line above a measurement**: the same wait with no
    // card IS said — `621` F2's case, a question routed to a person that this transcript draws
    // nothing for. ⚑ **UI-008** — said in the one state's word, as the plate's word says it.
    const alone = await render({ doing: 'idle', waiting: 'waiting-on-a-person', label: 'brobot' })
    expect(alone).toContain('aria-label="brobot — idle, needs you"')
  })

  it('an arbitrary px below the floor degrades too — the rule is the number', async () => {
    expect(await render({ doing: 'idle', size: 23 })).toContain('data-cy="agent-dot"')
    expect(await render({ doing: 'idle', size: 24 })).toContain('data-cy="agent-plate"')
  })
})

describe('the plate is one white island on every surface (acceptance 5)', () => {
  it('carries the light-island scope, and only on the plate', async () => {
    const html = await render({ doing: 'idle', being: 'live', needing: 'question' })
    expect(tag(html, 'agent-plate')).toContain('data-on-white')
    // Not on the root — the underline below has to keep the surrounding surface's tokens.
    expect(tag(html, 'agent-state')).not.toContain('data-on-white')
    expect(tag(html, 'agent-underline')).not.toContain('data-on-white')
    // ONE island, not one per badge. (Comments are stripped: the source explains the attribute in
    // prose right above it, and a prose mention is not a second scope.)
    const markup = html.replace(/<!--[\s\S]*?-->/g, '')
    expect([...markup.matchAll(/data-on-white/g)]).toHaveLength(1)
  })

  it('and there is nothing per-surface about it — the same markup everywhere', async () => {
    // 081 §5 asked for a different EDGE on each of the three surfaces; this collapsed to one
    // treatment in paper tokens, so there is no surface prop to get wrong. Pinned as an absence,
    // with the positive statement of what replaced it.
    const html = await render({ doing: 'idle' })
    expect(html).not.toContain('data-surface')
    expect(html).toContain('data-cy="agent-plate"')
  })
})

describe('the accessible name reaches the DOM (081 §7, hazard 3)', () => {
  it('is a role=img with the composed sentence', async () => {
    const html = await render({
      doing: 'thinking',
      being: 'silent',
      silentSeconds: 40,
      needing: 'permission',
      label: 'claude',
    })
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="claude — thinking, silent 40s, needs you (permission)"')
  })

  // ⚠️ **645 · this title said *"all 256 states"*** and the sweep has been wider than that since
  // `250` — a count in a title that the assertion never checks
  // ([[a-title-that-names-a-count-the-assertion-never-checks]]). ⚑ It names the SWEEP now, whose
  // size is asserted at the foot of the file, so the two cannot drift apart again.
  it('is WIRED to the composer for every state the sweep holds — and only proves the wiring', async () => {
    // ⚠️ **Deliberately a tautology on the value, and it is worth saying so.** The expected side
    // calls the same function the component calls, so a bug INSIDE `accessibleName` would appear on
    // both sides and pass. What this can catch is the component drifting away from it — building
    // its own sentence, dropping a facet, or losing the binding. The value itself is pinned by the
    // literal case above and exhaustively by `agent-state.test.ts`. Named because an unlabelled
    // tautology reads as coverage it is not. (The `.replaceAll('&', '&amp;')` that used to be here
    // was removed with its comment: Vue's SSR escapes `& < > "` and not the em dash, so it was a
    // no-op that would have double-escaped the day a word contained an ampersand.)
    for (const facets of ALL) {
      const html = await render({ ...facets, label: 'claude' })
      const label = /aria-label="([^"]*)"/.exec(html)?.[1] ?? ''
      expect(label, JSON.stringify(facets)).toBe(accessibleName({ ...facets, label: 'claude' }))
      expect(label).not.toContain('undefined')
      expect(label.startsWith('claude — ')).toBe(true)
    }
  })

  it('the alt text on the avatar is EMPTY, so the picture is not read twice', async () => {
    const html = await render({ doing: 'idle', label: 'claude' })
    expect(html).toMatch(/<img[^>]*alt=""/)
    expect(html).toContain('aria-label="claude — idle"')
  })
})

describe('the text slots (081 §4)', () => {
  it('title on top, subtitle below, both optional', async () => {
    const html = await render({
      doing: 'thinking',
      being: 'live',
      size: 'card',
      title: 'claude',
      subtitle: 'opus-5 · thinking',
    })
    expect(html).toContain('data-cy="agent-title"')
    expect(html).toContain('data-cy="agent-subtitle"')
    expect(html.indexOf('agent-title')).toBeLessThan(html.indexOf('agent-plate'))
    expect(html.indexOf('agent-underline')).toBeLessThan(html.indexOf('agent-subtitle'))
  })

  it('absent when not given, and hidden entirely at the dot floor', async () => {
    const bare = await render({ doing: 'thinking', size: 'card' })
    expect(bare).not.toContain('data-cy="agent-title"')
    expect(bare).toContain('data-cy="agent-plate"')
    // ⚑ **563 · the one thing this mark says in words, at both sizes.** ⛔ The plate and the dot
    // are pictures: they carry no text node at all, so the hooks above are the whole of what a
    // string assertion can see — and a component that dropped its accessible name would keep every
    // one of them. 🔴 **`role="img"` means the NAME is the reading**, which is why 081 §7 put it
    // there; this block is where a title slot is absent, and it is the sentence that survives.
    expect(bare).toContain('aria-label="agent — thinking"')

    const dot = await render({ doing: 'thinking', size: 'dot', title: 'claude', subtitle: 'x' })
    expect(dot).not.toContain('data-cy="agent-title"')
    expect(dot).not.toContain('data-cy="agent-subtitle"')
    expect(dot).toContain('data-cy="agent-dot"')
    // ⚠️ **The same sentence below the floor**, where the title and subtitle it was GIVEN are
    // dropped — so *"hidden entirely"* is about the two slots and never about the state going
    // unsaid.
    expect(dot).toContain('aria-label="agent — thinking"')
  })
})

describe('every state the sweep holds renders (acceptance 2)', () => {
  it('at the default size, with a mark and a machine-readable state on it', async () => {
    for (const facets of ALL) {
      // ⚑ **Spread, not passed** — `AgentFacets` is an interface and so has no index signature,
      // which the old inline object type silently had. The spread is also what every other call
      // in this file does, so nothing here is a special case any more.
      const html = await render({ ...facets })
      const why = JSON.stringify(facets)
      expect(html, why).toContain('data-cy="agent-state"')
      expect(html, why).toContain('data-cy="agent-plate"')
      expect(html, why).toContain(`data-doing="${facets.doing ?? 'unknown'}"`)
      if (facets.being) expect(html, why).toContain(`data-being="${facets.being}"`)
      else expect(html, why).not.toContain('data-being=')
      if (facets.needing) expect(html, why).toContain(`data-needing="${facets.needing}"`)
      else expect(html, why).not.toContain('data-needing=')
      // Exactly one face: an avatar or the ring, never both and never neither.
      const faces = (html.includes('<img') ? 1 : 0) + (html.includes('agent-unknown') ? 1 : 0)
      expect(faces, why).toBe(1)
    }
  })

  /**
   * 🔴 **651 · the rule `250` and `645` each wrote BY HAND for one facet, written ONCE, for every
   * facet there will ever be.**
   *
   * ⛔ **The defect was written three times and shipped once, and it has one shape**: a facet is
   * added to `AgentFacets`, not declared as a prop here, and every caller's `v-bind="facets"` drops it
   * on the root element as a stray attribute. ⚑ `250` and `258` each caught it before landing; `636`
   * shipped it, and `645` declared the prop. `250`'s test asserts `not.toContain('detached=')`,
   * `645`'s the same for `waiting` — each ONE facet, so a seventh would need a seventh test somebody
   * remembered. ⚠️ **These read their facets from `FACET_AXES`**, exhaustive over `keyof AgentFacets`
   * at compile time, so the seventh facet is in both loops the moment it compiles.
   *
   * ⚑ **Two instruments, because `651`'s review found the markup alone is not enough** (#8/#26): Vue's
   * SSR LOWERCASES a fallthrough attribute (`taskWait` renders `taskwait=`), drops an object value
   * entirely, and renders a boolean one with no `=`. ⛔ So the first test asks the COMPONENT which
   * props it declares — which no spelling can hide — and the second keeps the rendered check, now
   * case-insensitive and ending on `=`, a space or the tag's close.
   */
  it('🔴 651 · every facet `AgentFacets` declares is a DECLARED prop of the plate', () => {
    const declared = Object.keys((AgentState as { props?: Record<string, unknown> }).props ?? {})
    // ⚑ Non-vacuity: the component really exposes its props, or the loop below proves nothing.
    expect(declared).toContain('size')
    for (const facet of Object.keys(FACET_AXES))
      expect(declared, `${facet} is not a declared prop`).toContain(facet)
  })

  it('🔴 651 · over EVERY state and EVERY facet, no facet ever lands on the root as an attribute', async () => {
    // ⚠️ **Attribute NAMES, never a pattern over the whole tag.** The first rewrite matched
    // `\\swaiting(?=\\s)` case-insensitively and found *"waiting on an answer"* INSIDE the accessible
    // name's value — the exact false positive the anchored `=` had been there to prevent. ⚑ Values are
    // skipped by the parse, names compared case-insensitively (SSR lowercases a fallthrough), and a
    // bare boolean attribute is a name like any other.
    const leaks = (root: string, name: string): boolean =>
      [...root.slice(1).matchAll(/\s([^\s=/>"]+)(?:="[^"]*")?/g)].some(
        (match) => match[1]!.toLowerCase() === name.toLowerCase(),
      )
    // ⛔ **The control for the negative's own pattern** (`651`'s review, #16): a prop the plate does
    // NOT declare really does fall through and really is matched — or every `false` below is vacuous.
    const planted = tag(
      await render({ doing: 'idle', label: 'claude', strayFacet: 'x' }),
      'agent-state',
    )
    expect(leaks(planted, 'strayFacet')).toBe(true)
    let checked = 0
    for (const state of ALL) {
      const root = tag(await render({ ...state, label: 'claude' }), 'agent-state')
      for (const facet of Object.keys(FACET_AXES))
        expect(leaks(root, facet), `${facet} fell through · ${JSON.stringify(state)}`).toBe(false)
      // ⚑ The paired positive, and one `tag()` does not already guarantee: the plate's own state.
      expect(root, JSON.stringify(state)).toContain(`data-doing="${state.doing ?? 'unknown'}"`)
      checked++
    }
    // ⛔ Non-vacuity, as a literal (268 §3): the loop ran over the whole product, not an empty one.
    expect(checked).toBe(24_576)
  })

  it('and at every named size', async () => {
    for (const [name, px] of Object.entries(SIZES)) {
      const html = await render({ doing: 'working', being: 'live', needing: 'plan', size: name })
      expect(html, name).toContain(`--sz:${px}px`)
      expect(html, name).toContain(`data-size="${px}"`)
    }
  })
})

/**
 * ⛔ **The floor under the three sweeps** (268 §3).
 *
 * ⚠️ Registering from a literal buys a fixed test count and costs a second spelling of each
 * vocabulary. This is what keeps the two spellings one thing: a member added to the module and not
 * to the list above would be a member nothing sweeps, which is the same silence the ROUTE floor in
 * `no-byte-authority.test.ts` exists to break.
 */
describe('the lists this file registers from ARE the vocabularies (268 §3)', () => {
  it('🔴 a member added or dropped is a red verdict here, not a case that stops existing', () => {
    // ⚑ `unknown` is the seventh DOING and draws no face, so the illustrated sweep is the other six
    // — asserted as a difference rather than assumed, or the list could quietly lose a real one.
    expect(DRAWN_DOINGS).toEqual(DOINGS.filter((doing) => doing !== 'unknown'))
    expect(DOINGS).toContain('unknown')
    expect(DRAWN_BEINGS).toEqual([...BEINGS])
    expect(DEMANDED).toEqual([...NEEDINGS])
  })

  /**
   * ⛔ **645 · the floor above guards the MEMBERS of a vocabulary. This one guards the AXES.**
   *
   * ⚠️ `636` added a sixth facet to `AgentFacets` and every sweep in this file went on passing,
   * because the axes were five hand-written loops and nothing compared them to anything. ⚑ The
   * compile-time half is the `satisfies` on `FACET_AXES`; this is the run-time half, and it is the
   * one that catches an axis DECLARED and not SWEPT.
   */
  it('🔴 645 · every facet `AgentFacets` declares is an axis, and every axis is actually swept', () => {
    const swept = new Set(ALL.flatMap((facets) => Object.keys(facets)))
    expect([...swept].sort()).toEqual(Object.keys(FACET_AXES).sort())
    // ⛔ **A literal, for 268 §3's reason** — a count computed from the axes it is checking could
    // not notice a vocabulary shrinking. ⚑ 8 doings × 8 beings × 4 needings × 2 × 2 × 4 waits ×
    // 3 works (D-006; D-016 took the proposal out of the needings).
    expect(ALL).toHaveLength(24_576)
  })
})
