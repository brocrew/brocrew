import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import StateBadge, { TASK_OUTCOME_LOOK } from '../src/renderer/src/components/StateBadge.vue'
import { TASK_OUTCOMES } from '../src/shared/tasks'

/**
 * The one place a state's colour is decided (Slice 2 · 007).
 *
 * These RENDER the component rather than reading the map beside it: the claim is not "the map says
 * green", it is "a done task comes out green". The colour is bound as a custom property naming a
 * TOKEN, so what the assertions read is the token — a component that hand-picked a hex would fail
 * here even if its map were right.
 *
 * ⚑ **D-016** deleted the demo seed's three vocabularies (`Lifecycle`, `Condition`, `Outcome`, from
 * `entities.ts`) and their looks with it; the task outcome (406) is the one this component draws.
 */

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(StateBadge, props) }))

/**
 * Every task outcome, and the token it must come out in (406).
 *
 * Written out rather than derived from the map, so that a transposed or mistyped token in
 * `StateBadge.vue` fails here instead of being compared against itself. Completeness is what the
 * test at the bottom of the file checks — this list and the map must name the same states, or a
 * value ships with a colour nothing ever renders (089).
 *
 * ⚑ **Two of the three take one hue and `tokens.css` §4 already says so** — *failed /
 * no-response / blocked → `--danger`* — which is why the distinctness check below is about the
 * LABEL and not the colour.
 */
const TASK_OUTCOME_ROWS = [
  ['done', '--success'],
  ['blocked', '--danger'],
  ['failed', '--danger'],
] as const

describe('StateBadge draws the prototype’s colours, from tokens', () => {
  it.each(TASK_OUTCOME_ROWS)('renders task outcome %s in var(%s)', async (taskOutcome, token) => {
    const html = await render({ taskOutcome })
    expect(html).toContain(`--badge:var(${token})`)
    expect(html).toContain(`data-token="${token}"`)
    expect(html).toContain('data-cy="state-taskOutcome"')
    // The label too: two outcomes that share a colour — blocked and failed are both red — can only
    // be told apart by what they say, so a transposed label has to fail here.
    expect(html).toContain(TASK_OUTCOME_LOOK[taskOutcome as keyof typeof TASK_OUTCOME_LOOK].label)
  })

  it('says which state it is, not just what colour: every label is distinct', () => {
    // Blocked and Failed are both red. Colour narrows a state down, the word decides it — so no two
    // may share a label.
    const taskLabels = Object.values(TASK_OUTCOME_LOOK).map((look) => look.label)
    expect(new Set(taskLabels).size).toBe(taskLabels.length)
  })

  it('draws nothing for a facet that has nothing to say', async () => {
    // No outcome is the absence of one, not a state — a badge saying so would be one more thing to
    // read on a row with nothing to report. ⚑ Paired: the same render with an outcome draws one.
    expect(await render({})).not.toContain('state-badge')
    expect(await render({ taskOutcome: 'done' })).toContain('state-badge')
  })

  it('carries no colour of its own — every value resolves through a token', () => {
    const looks = Object.values(TASK_OUTCOME_LOOK)
    expect(looks.length).toBeGreaterThan(0)
    for (const look of looks) {
      expect(look.token).toMatch(/^--[a-z0-9-]+$/)
      expect(look.tint).toMatch(/^--[a-z0-9-]+$/)
    }
  })

  it('has a look for every value in the vocabulary, and no others', () => {
    // A new state must be given a colour here rather than defaulting into an invisible one.
    expect(Object.keys(TASK_OUTCOME_LOOK).sort()).toEqual([...TASK_OUTCOMES].sort())
  })

  /**
   * ⚠️ **And a look is not coverage** (089). The check above would have passed `auto_approve`
   * through with a token, a tint and a label that no test ever rendered, because the `it.each`
   * tables at the top of this file were hand-written lists rather than the vocabulary. Having a
   * colour and being drawn correctly in it are two claims, and only one of them had a guard.
   *
   * This asserts the table is COMPLETE without replacing it: the hard-coded rows still pin which
   * token each state actually takes, which a table derived from the map could not.
   */
  it('every state that draws a badge has a row in the tables above', () => {
    const rows = (table: ReadonlyArray<readonly [string, string]>): string[] =>
      table.map(([name]) => name).sort()
    expect(Object.keys(TASK_OUTCOME_LOOK).sort()).toEqual(rows(TASK_OUTCOME_ROWS))
  })
})
