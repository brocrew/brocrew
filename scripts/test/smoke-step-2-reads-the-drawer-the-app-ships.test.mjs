import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * # ⚑ 717 · `smoke:ui` steps 2 and 50 read the drawer the app ships (`713` F-1)
 *
 * 🔴 **Step 2 was red in every batch from `508` to `717`, and step 50 with it.** Step 2's exact list
 * of live drawer tabs was `open,controls,events,info,context,changes` and its count six; step 50
 * walked and counted six too; the drawer had grown a seventh, `work` (`705da960`, *"the work this
 * conversation gave out"*). ⚠️ A red step is recorded and the run goes on, so the steps after them
 * still ran — but only a live batch could say either was red, which is how it went unseen for two
 * hundred dispatches.
 *
 * ⚑ **So the smoke's list is held to the product's here, where `ci` runs.** The list stays EXACT on
 * purpose (the step's own note: *"what this catches is a tab appearing, vanishing or changing order
 * without anyone saying so"*) — and now the commit that adds a tab is the commit that says so. Both
 * sides are read as text: the step's literal, and `DRAWER_TABS` / `RESERVED_TABS` in
 * `renderer/src/lib/drawer.ts`, which the step's note already names as its source.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const SMOKE = readFileSync(join(ROOT, 'scripts/ui-live-smoke.mjs'), 'utf8')
const DRAWER = readFileSync(join(ROOT, 'apps/desktop/src/renderer/src/lib/drawer.ts'), 'utf8')

/** The ids of one exported array in `drawer.ts`, in order — each entry's own `id:`, at its depth. */
function idsOf(source, name) {
  const start = source.indexOf(`export const ${name}`)
  if (start === -1) throw new Error(`${name} is not in drawer.ts`)
  const open = source.indexOf('= [', start)
  const end = source.indexOf('\n]', open)
  return [...source.slice(open, end).matchAll(/^ {4}id: '([\w-]+)',?$/gm)].map((one) => one[1])
}

/** The body of the step whose title starts `title`, up to the next step. */
function stepBody(source, title) {
  const start = source.indexOf(`'${title}`)
  const end = source.indexOf('await step(', start)
  if (start === -1 || end === -1) throw new Error(`step ${title} is not where this reads it`)
  return source.slice(start, end)
}

/** What step 50 asserts about the strip: how many tabs it walks, and how many it counts. */
function stepFifty(source) {
  const body = stepBody(source, '50 the tab strip fits')
  const walks = /walkable\.length < (\d+)\)/.exec(body)?.[1]
  const counts = /strip\.tabs !== (\d+)\)/.exec(body)?.[1]
  return { walks: walks && Number(walks), counts: counts && Number(counts) }
}

/** What step 2 asserts about the strip: its exact live list, and how many tabs it expects. */
function stepTwo(source) {
  const start = source.indexOf("'2 create a Claude session")
  const end = source.indexOf("await step('2b ", start)
  if (start === -1 || end === -1) throw new Error('step 2 is not where this reads it')
  const body = source.slice(start, end)
  const list = /live\.join\(','\) !== '([^']*)'/.exec(body)?.[1]
  const count = /strip\.length !== (\d+)\)/.exec(body)?.[1]
  return { list, count: count === undefined ? undefined : Number(count) }
}

describe('717 · smoke step 2 reads the drawer the app ships (`713` F-1)', () => {
  const live = idsOf(DRAWER, 'DRAWER_TABS')
  const reserved = idsOf(DRAWER, 'RESERVED_TABS')

  it('⛔ its exact list IS the drawer’s live tabs, in the drawer’s order', () => {
    expect(stepTwo(SMOKE).list).toBe(live.join(','))
  })

  it('⛔ …and its count is every tab the strip lays out, live and reserved', () => {
    expect(stepTwo(SMOKE).count).toBe(live.length + reserved.length)
  })

  it('⛔ step 50 walks every live tab and counts every tab laid out — the same tabs', () => {
    expect(stepFifty(SMOKE)).toEqual({
      walks: live.length,
      counts: live.length + reserved.length,
    })
  })

  it('⚑ the readers read: the drawer ships `open` first and `work` among five, none reserved', () => {
    // ⚑ Non-vacuity, not a second pin of the drawer: a reader that found nothing would make the two
    // comparisons above agree about an empty strip.
    expect(live[0]).toBe('open')
    expect(live).toContain('work')
    // ⚑ W4.208 · six since the Context tab left for a popup; five since the Controls tab left for
    // the agent card.
    expect(live.length).toBeGreaterThanOrEqual(5)
    expect(reserved).toEqual([])
  })

  it('🔴 the readers on planted sources — a nested `id` is not a tab, a reserved one counts, a missing one is caught', () => {
    const drawer = [
      'export const DRAWER_TABS = [',
      '  {',
      "    id: 'open',",
      "    nested: { id: 'not-a-tab' },",
      '    more: {',
      "      id: 'not-one-either',",
      '    },',
      '  },',
      '  {',
      "    id: 'work',",
      '  },',
      '] as const',
      '',
      'export const RESERVED_TABS: readonly {',
      '  readonly id: string',
      '}[] = [',
      '  {',
      "    id: 'soon',",
      '  },',
      ']',
    ].join('\n')
    expect(idsOf(drawer, 'DRAWER_TABS')).toEqual(['open', 'work'])
    expect(idsOf(drawer, 'RESERVED_TABS')).toEqual(['soon'])
    const step = (list, count) =>
      [
        "  await step(\n    '2 create a Claude session in the chosen cwd',",
        `      if (live.join(',') !== '${list}') {`,
        `      if (strip.length !== ${count}) throw new Error('x')`,
        "  await step('2b the config block', async () => {",
      ].join('\n')
    expect(stepTwo(step('open,work', 3))).toEqual({ list: 'open,work', count: 3 })
    // ⚑ The shape `713` F-1 found: a tab the drawer grew and the step never named.
    expect(stepTwo(step('open', 2)).list).not.toBe(idsOf(drawer, 'DRAWER_TABS').join(','))
  })
})
