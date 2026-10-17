import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { APP_WIDE_HOOKS, TAB_OF_HOOK, TAB_OF_HOOK_PREFIX } from '../lib/tab-flow.mjs'

/**
 * **A hook the table claims must be reachable from that tab and from NOWHERE ELSE** (097).
 *
 * ⚠️ This test exists because of a mistake the DOM conformance test could not catch, and made
 * likelier by it. `apps/desktop/test/dom/tab-flow.dom.test.ts` mounts the drawer and reports every
 * hook it sees under the tab that mounted it — so it happily demanded `agent-state`, `agent-plate`,
 * `agent-avatar` and the rest be filed under `open`. They were. Then the live smoke's step 48 —
 * *"the agent plate is white on EVERY surface"* — turned out to read those exact hooks from the side
 * rail, the header and the conversation pane, none of which is a tab. The walk would have failed a
 * correct step, which is the one thing a harness must never do.
 *
 * Mounting a component can prove a hook is THERE. Only the import graph can say it is nowhere else.
 *
 * The graph is read straight off the `.vue` sources rather than from a list, so a component that
 * starts being used somewhere new is caught by the same run that introduces it.
 */

const COMPONENTS = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../apps/desktop/src/renderer/src/components',
)

/** The component each tab's body mounts — the arms of `SessionDrawer.vue`'s `.drawer-body`. */
const PANEL_OF_TAB = {
  open: 'SessionPanel.vue',
  events: 'EventStream.vue',
  info: 'SessionInfo.vue',
  changes: 'SessionChanges.vue',
  // 508 · what this conversation handed out to other agents.
  work: 'SessionWork.vue',
}

const files = readdirSync(COMPONENTS).filter((name) => name.endsWith('.vue'))
const source = new Map(files.map((name) => [name, readFileSync(join(COMPONENTS, name), 'utf8')]))

/** Which components each component imports, by filename. */
const imports = new Map(
  [...source].map(([name, text]) => [
    name,
    new Set(
      [...text.matchAll(/^import\s+\w+\s+from\s+['"]\.\/([\w.]+\.vue)['"]/gm)].map((m) => m[1]),
    ),
  ]),
)

/** Every component reachable from `root`, including itself. */
function reachableFrom(root) {
  const seen = new Set([root])
  const queue = [root]
  while (queue.length > 0) {
    for (const next of imports.get(queue.pop()) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

/** The components whose own template declares `hook`, exactly or as a template-literal family. */
function declaredIn(hook) {
  const exact = new RegExp(`data-cy="${hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`)
  const family = new RegExp(`:data-cy="\`${hook.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  return files.filter((name) => exact.test(source.get(name)) || family.test(source.get(name)))
}

describe('tab-flow: every claimed hook is reachable from exactly one tab', () => {
  it('the five panel components all exist', () => {
    // Non-vacuity for everything below: if a filename were wrong, `reachableFrom` would return a
    // one-element set and every "reachable from one tab" check would silently pass over nothing.
    for (const panel of Object.values(PANEL_OF_TAB)) {
      expect(source.has(panel), `${panel} is not a component in this tree`).toBe(true)
    }
    expect(files.length, 'no components were read at all').toBeGreaterThan(10)
  })

  it('the import graph really has edges', () => {
    // The graph is parsed with a regex, so a change to the import style would quietly flatten it
    // and make every reachability check trivially true. This is the guard against that.
    const withImports = [...imports.values()].filter((set) => set.size > 0).length
    expect(withImports, 'no component imports another — the graph parse is broken').toBeGreaterThan(
      3,
    )
    expect(reachableFrom('SessionPanel.vue').size, 'SessionPanel imports nothing').toBeGreaterThan(
      1,
    )
  })

  it('no claimed hook is rendered by a component another tab can also reach', () => {
    const reach = new Map(
      Object.entries(PANEL_OF_TAB).map(([tab, panel]) => [tab, reachableFrom(panel)]),
    )
    const problems = []
    let checked = 0
    for (const [hook, tab] of Object.entries(TAB_OF_HOOK)) {
      const owners = declaredIn(hook)
      if (owners.length === 0) continue // a hook built somewhere other than a template literal
      checked += 1
      for (const owner of owners) {
        const tabsThatReachIt = [...reach].filter(([, set]) => set.has(owner)).map(([t]) => t)
        if (!tabsThatReachIt.includes(tab)) {
          problems.push(`${hook}: table says ${tab}, but ${tab} cannot reach ${owner}`)
        }
        const strangers = tabsThatReachIt.filter((t) => t !== tab)
        if (strangers.length > 0) {
          problems.push(`${hook}: ${owner} is also reachable from ${strangers.join(', ')}`)
        }
        // ⚠️ **The check that would have caught `agent-state`**: a component the drawer renders is
        // fine; a component that ANY surface outside the drawer also renders is not, because the
        // hook is then on screen with no tab selected at all.
        const outside = files.filter(
          (name) =>
            name !== owner &&
            imports.get(name)?.has(owner) &&
            ![...reach.values()].some((set) => set.has(name)) &&
            name !== 'SessionDrawer.vue',
        )
        if (outside.length > 0) {
          problems.push(
            `${hook}: ${owner} is also rendered outside the drawer by ${outside.join(', ')}`,
          )
        }
      }
    }
    expect(problems).toEqual([])
    // Positive pair: the loop above has to have looked at most of the table, or `problems` being
    // empty says nothing at all.
    expect(checked, 'almost nothing in the table could be located in a template').toBeGreaterThan(
      Object.keys(TAB_OF_HOOK).length / 2,
    )
  })

  it('every APP-WIDE exemption really is rendered outside the drawer', () => {
    // ⚠️ **The exemption has to keep earning itself.** `APP_WIDE_HOOKS` is what lets the DOM
    // conformance test stop demanding these hooks be claimed by a tab — so if one of them ever
    // became drawer-only, the list would be hiding a genuine omission instead of describing a real
    // constraint. This is the assertion that notices.
    const reach = new Map(
      Object.entries(PANEL_OF_TAB).map(([tab, panel]) => [tab, reachableFrom(panel)]),
    )
    const insideTheDrawer = new Set([...reach.values()].flatMap((set) => [...set]))
    for (const hook of APP_WIDE_HOOKS) {
      const owners = declaredIn(hook)
      expect(owners.length, `${hook} is declared by no component template`).toBeGreaterThan(0)
      for (const owner of owners) {
        const outsiders = files.filter(
          (name) => imports.get(name)?.has(owner) && !insideTheDrawer.has(name),
        )
        expect(
          outsiders.length,
          `${hook} (${owner}) is exempt as app-wide, but nothing outside the drawer renders it`,
        ).toBeGreaterThan(0)
      }
      // …and it must not be in the table too: one answer per hook.
      expect(Object.hasOwn(TAB_OF_HOOK, hook), `${hook} is both exempt and claimed`).toBe(false)
    }
  })

  it('the same rule holds for the hook FAMILIES', () => {
    const reach = new Map(
      Object.entries(PANEL_OF_TAB).map(([tab, panel]) => [tab, reachableFrom(panel)]),
    )
    let checked = 0
    for (const [prefix, tab] of Object.entries(TAB_OF_HOOK_PREFIX)) {
      const owners = declaredIn(prefix)
      expect(owners.length, `${prefix} is declared by no component template`).toBeGreaterThan(0)
      checked += owners.length
      for (const owner of owners) {
        expect(reach.get(tab)?.has(owner), `${tab} cannot reach ${owner} (${prefix})`).toBe(true)
      }
    }
    expect(checked).toBe(Object.keys(TAB_OF_HOOK_PREFIX).length)
  })
})
