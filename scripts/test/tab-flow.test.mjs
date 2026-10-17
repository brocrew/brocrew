import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTIVE_TAB_EXPRESSION,
  DRAWER_TABS,
  TAB_OF_HOOK,
  TAB_OF_HOOK_PREFIX,
  WIDE_READ_MARK,
  assertTabFlow,
  hooksIn,
  tabFlowViolation,
  tabOfHook,
  unreadableSelectorIn,
} from '../lib/tab-flow.mjs'

/** The repo root, from this file — `scripts/test/` is two levels down. */
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * The walk itself (097). The table's agreement with the real app is a DIFFERENT test —
 * `apps/desktop/test/dom/tab-flow.dom.test.ts`, which mounts the drawer and clicks through it.
 * This file is only about the rule: given a table and a selected tab, what fires and what does not.
 */

describe('hooksIn — what counts as naming a hook', () => {
  it('finds unquoted, double-quoted and single-quoted attribute values', () => {
    expect(hooksIn(`document.querySelector('[data-cy=session-cwd]')`)).toEqual(['session-cwd'])
    expect(hooksIn(`document.querySelector('[data-cy="session-cwd"]')`)).toEqual(['session-cwd'])
    expect(hooksIn(`document.querySelector("[data-cy='session-cwd']")`)).toEqual(['session-cwd'])
  })

  it('finds every hook in an expression, once each', () => {
    const found = hooksIn(`
      const a = document.querySelector('[data-cy=session-cwd]')
      const b = document.querySelector('[data-cy=session-ref]')
      const c = document.querySelector('[data-cy=session-cwd]')
      return Boolean(a && b && c)
    `)
    expect(found.sort()).toEqual(['session-cwd', 'session-ref'])
  })

  // ⚠️ The positive half of the pair: `^=` is skipped, and a plain `=` on the SAME prefix string is
  // still found. Without the second assertion this test would pass over a regex that found nothing.
  it('skips prefix scans and keeps exact reads', () => {
    expect(hooksIn(`document.querySelectorAll('[data-cy^=drawer-tab-]')`)).toEqual([])
    expect(hooksIn(`document.querySelectorAll('[data-cy*=changes-row]')`)).toEqual([])
    expect(hooksIn(`document.querySelector('[data-cy=drawer-tab-info]')`)).toEqual([
      'drawer-tab-info',
    ])
  })

  it('finds nothing in an expression that names no hook', () => {
    expect(hooksIn(`return document.title`)).toEqual([])
  })

  // ⚠️ 097 review, finding 8: a hook name built at runtime used to match the quoted alternative and
  // yield `" + name + "` as a hook — which `tabOfHook` answers `null` for, so the read looked
  // uninteresting rather than unreadable and sailed past the guard with no signal at all.
  it('refuses to call a runtime-built fragment a hook name', () => {
    expect(hooksIn(`document.querySelector('[data-cy=' + name + ']')`)).toEqual([])
    expect(hooksIn('document.querySelector(`[data-cy=changes-row-${p}]`)')).toEqual([])
    // Paired: the same shapes written literally ARE hooks, so the rule is about the fragment.
    expect(hooksIn(`document.querySelector('[data-cy=changes-row-src/main.ts]')`)).toEqual([
      'changes-row-src/main.ts',
    ])
  })
})

describe('unreadableSelectorIn — a check that cannot run must not look like one that passed', () => {
  it('names a selector whose hook is built at runtime and COULD be a drawer hook', () => {
    // No literal prefix at all — it could be anything, including anything owned.
    expect(unreadableSelectorIn(`document.querySelector('[data-cy=' + name + ']')`)).toContain(
      'data-cy=',
    )
    // A prefix an owned FAMILY starts with — this is the read the walk exists to refuse.
    expect(unreadableSelectorIn('document.querySelector(`[data-cy=changes-row-${p}]`)')).toContain(
      'data-cy=',
    )
    expect(
      unreadableSelectorIn(`document.querySelector('[data-cy=work-row-' + id + ']')`),
    ).toContain('data-cy=')
    // A prefix that could still grow into an owned hook is refused too — `session-cwd` starts with
    // `session-`, so the walk cannot rule it out and does not pretend to.
    expect(unreadableSelectorIn(`document.querySelector('[data-cy=session-' + x + ']')`)).toContain(
      'data-cy=',
    )
  })

  it('allows a built selector whose prefix no owned hook could ever start with', () => {
    // ⚠️ The half that keeps this from failing correct steps. `resumable-status-…` and
    // `library-read-…` are real reads in the live smokes, on surfaces that are not the drawer at
    // all — refusing them would have made the walk a nuisance rather than a guard.
    for (const ok of [
      `document.querySelector('[data-cy=resumable-status-' + id + ']')`,
      `document.querySelector('[data-cy="library-read-' + row.id + '"]')`,
      // ⚑ **572 · `rail-project-` was the rail's fixture family and `EXT-008` §1 deleted it**, and
      // the board's `projects-row-` went with projects at D-016. The example is the person's queue
      // family now, so this list names hooks that exist.
      `document.querySelector('[data-cy=persons-queue-row-' + n + ']')`,
    ]) {
      expect(unreadableSelectorIn(ok), ok).toBeNull()
    }
  })

  it('says nothing about the selectors real steps actually write', () => {
    for (const ok of [
      `document.querySelector('[data-cy=session-cwd]')`,
      `document.querySelector('[data-cy="session-cwd"]')`,
      `document.querySelectorAll('[data-cy^=drawer-tab-]')`,
      `card.querySelector('[data-cy^=permission-allow], [data-cy=permission-deny]')`,
      `[...document.querySelectorAll('[data-cy=event-log] li')]`,
      `document.querySelector('[data-cy=changes-row-src/main.ts]')`,
      `return document.title`,
    ]) {
      expect(unreadableSelectorIn(ok), ok).toBeNull()
    }
  })

  it('the walk REFUSES an unreadable read rather than skipping it', () => {
    const built = `document.querySelector('[data-cy=' + path + ']')`
    // Whatever tab it is on: the answer does not depend on one, which is the point.
    for (const tab of ['events', 'changes', null]) {
      expect(tabFlowViolation(tab, built), String(tab)).toContain('builds a hook name at runtime')
    }
    // …and the marked wide read is still the one way out, so the escape hatch has not moved.
    expect(tabFlowViolation('events', `// ${WIDE_READ_MARK}\n${built}`)).toBeNull()
  })
})

describe('tabOfHook — ownership', () => {
  it('answers null for everything outside the drawer body', () => {
    // The strip, the attention bar and the composer are on screen whatever tab is selected. A table
    // that claimed one of them would fail correct steps, so this is the load-bearing negative — and
    // it is paired with a positive so it cannot pass over a table that answers null to everything.
    for (const chrome of [
      'drawer-tabs',
      'drawer-tab-info',
      'drawer-attention-bar',
      'drawer-show-open',
      'toggle-session-panel',
      'composer-input',
    ]) {
      expect(tabOfHook(chrome), chrome).toBeNull()
    }
    expect(tabOfHook('session-cwd')).toBe('info')
  })

  it('matches a family by prefix, and the longest prefix wins', () => {
    expect(tabOfHook('changes-row-src/main.ts')).toBe('changes')
    expect(tabOfHook('session-agent-Claude')).toBe('info')
    expect(tabOfHook('work-row-abc123')).toBe('work')
    expect(tabOfHook('config-file-CLAUDE.md')).toBe('info')
  })

  // The exact table is consulted BEFORE the prefixes, which is what keeps `session-panel-empty`
  // from being eaten by a family and `session-panel` from swallowing it.
  it('prefers an exact entry over a prefix that would also match', () => {
    expect(tabOfHook('session-panel')).toBe('open')
    expect(tabOfHook('session-panel-empty')).toBe('open')
  })

  it('every tab in the table is a real drawer tab', () => {
    const named = new Set([...Object.values(TAB_OF_HOOK), ...Object.values(TAB_OF_HOOK_PREFIX)])
    for (const tab of named) expect(DRAWER_TABS).toContain(tab)
    // …and every tab owns at least one hook, or the table is silently missing a panel.
    for (const tab of DRAWER_TABS) expect(named, `${tab} owns nothing`).toContain(tab)
  })

  it('every prefix ends in a dash', () => {
    for (const prefix of Object.keys(TAB_OF_HOOK_PREFIX)) expect(prefix.endsWith('-')).toBe(true)
  })
})

describe('tabFlowViolation — the rule', () => {
  const readCwd = `return Boolean(document.querySelector('[data-cy=session-cwd]'))`

  it('passes a read on the tab that owns it', () => {
    expect(tabFlowViolation('info', readCwd)).toBeNull()
  })

  // THE test this whole item exists for: the shape of 093's twenty-one steps.
  it('fails a read of an Info hook while sitting on Events', () => {
    const violation = tabFlowViolation('events', readCwd)
    expect(violation).toContain('session-cwd')
    expect(violation).toContain('info')
    expect(violation).toContain('the drawer is on events')
    expect(violation).toContain("ensureTab(cdp, 'info')")
  })

  it('fails a read of a drawer hook while the drawer is shut', () => {
    expect(tabFlowViolation(null, readCwd)).toContain('the drawer is SHUT')
  })

  it('says nothing about a read that names no drawer hook', () => {
    expect(tabFlowViolation('events', `return document.querySelectorAll('li').length`)).toBeNull()
    expect(
      tabFlowViolation(null, `return Boolean(document.querySelector('[data-cy=drawer-tabs]'))`),
    ).toBeNull()
  })

  it('names every offending hook, not just the first', () => {
    const violation = tabFlowViolation(
      'events',
      `return [document.querySelector('[data-cy=session-cwd]'),
               document.querySelector('[data-cy=changes-files]')].filter(Boolean).length`,
    )
    expect(violation).toContain('session-cwd')
    expect(violation).toContain('changes-files')
  })

  // The exemption exists and is narrow: it must take the marker, and the SAME expression without
  // the marker must fail — otherwise this test proves nothing about the exemption at all.
  it('exempts a marked wide read, and only a marked one', () => {
    const wide = `
      return {
        cwd: Boolean(document.querySelector('[data-cy=session-cwd]')),
        log: Boolean(document.querySelector('[data-cy=event-log]')),
      }
    `
    expect(tabFlowViolation('events', `// ${WIDE_READ_MARK}\n${wide}`)).toBeNull()
    expect(tabFlowViolation('events', wide)).toContain('session-cwd')
  })

  it('fires on a family hook the same way it fires on a named one', () => {
    expect(
      tabFlowViolation('events', `document.querySelector('[data-cy=changes-row-a.ts]')`),
    ).toContain('changes')
  })

  /**
   * ⛔ **What the model was TOLD is an Info read, and until 178 the walk had never heard of it.**
   *
   * `SessionInstructions` had been on the Info tab since 158 and no step in either live script
   * opened it — `session-instructions` appeared **zero** times in both — so nothing ever exercised
   * the gap. A step reading it off Events would have found `null` and asserted against an absence it
   * caused, which is the whole class 097 exists to remove, left open on the one block whose entire
   * subject is disclosure.
   *
   * ## 🔴 527 · re-aimed, and the assertion turned over
   *
   * ⚑ **`HO-050` §1.1 took the block off the tab.** It is on `AgentInstructionsSheet`, which
   * `ConversationPane` raises on the overlay layer — reachable from whichever tab is selected, and
   * mounted by none of them.
   *
   * ⛔ **So the right answer for those hooks is now `null` from EVERY tab, and that is what is
   * asserted.** Leaving them filed under `info` would be the 097 defect with the sign flipped: the
   * walk would fail a CORRECT step, and the fix somebody reached for would be to delete the guard.
   * ⚠️ **Deleting this test instead would have left both directions unmeasured** — standing rule
   * 26: strip AND re-aim.
   *
   * ⚑ **The half that stays is the DOOR.** The index entry is on the Info tab and nowhere else, so
   * it is still refused from another tab and still permitted from its own — which is what keeps a
   * step from pressing a button that is not on screen.
   */
  it('guards the index ENTRY, and frees the block that left the drawer body', () => {
    // ⛔ The door: on the tab, so the walk still owns it.
    const onTheTab = ['told-index', 'told-index-title', 'session-subject-agent']
    for (const hook of onTheTab) {
      const read = `document.querySelector('[data-cy=${hook}]')`
      // …refused from anywhere else,
      expect(tabFlowViolation('events', read), hook).toContain('info')
      // …and permitted from the tab that mounts it. Without this half the assertion above would
      // pass over a table that answered "info" to everything.
      expect(tabFlowViolation('info', read), hook).toBeNull()
    }

    // ⚑ …and everything behind it, which no tab mounts any more. Named hooks AND both families,
    // because the table can be wrong in two ways and a dropped prefix is a different mistake from
    // a dropped entry.
    const onTheSheet = [
      'session-instructions',
      'refused-instruction',
      'provider-instruction',
      'provider-instructions-lead',
      'instructions-note',
      'provider-scope',
      'provider-open',
      'provider-reveal',
      'provider-read',
      'provider-instructions-absent',
      'instructions-why',
      'instructions-why-body',
      'told-composition',
      'told-sentence',
      'told-earlier',
      'told-register',
      'told-appended-nothing',
      'told-withheld',
      'told-why',
      'told-order',
      // ⚑ **583 · the five `injected-…` names here were dead** and this list did not notice,
      // because `tabOfHook` answers `null` for a hook in NEITHER table — so a renamed hook made
      // every assertion below vacuous rather than red (`a-positive-assertion-must-differ-from-
      // the-default`). ⛔ The names are the live ones now AND the vacuity is closed by the
      // census under this array.
      'told-block',
      'told-block-toggle',
      'told-block-label',
      'told-block-link',
      'memory-reach-prompt',
      'told-tabs',
      'told-tab-factory',
      'told-size',
      'told-nothing-of-yours',
      'told-layer-provider-base',
      'told-why-app-composed',
      'told-says-agent-store',
      'told-count-published-tools',
      'told-bytes-app-composed',
    ]

    /**
     * 🔴 **583 · every name above is a hook the component really draws.**
     *
     * ⛔ **Without this the list is a wish.** `tabOfHook` returns `null` for a name nothing has
     * ever heard of, so a hook renamed on the sheet keeps passing here for ever — which is what
     * happened to five of them between `527` and `583`. ⚠️ A family hook is bound through a
     * template literal, so its LITERAL PREFIX is what the source can be asked for.
     */
    const panel = readFileSync(
      join(REPO, 'apps/desktop/src/renderer/src/components/SessionInstructions.vue'),
      'utf8',
    )
    const bindings = [...panel.matchAll(/:data-cy="`([a-z-]+)\$\{/g)].map((hit) => hit[1])
    const missing = onTheSheet.filter(
      (hook) =>
        !panel.includes(`data-cy="${hook}"`) && !bindings.some((head) => hook.startsWith(head)),
    )
    expect(
      missing,
      `this list names hooks the sheet has stopped drawing: ${missing.join(', ')}`,
    ).toEqual([])
    expect(
      bindings.length,
      'no family bindings were read — the census read nothing',
    ).toBeGreaterThan(0)
    for (const hook of onTheSheet) {
      const read = `document.querySelector('[data-cy=${hook}]')`
      expect(tabOfHook(hook), `${hook} is still filed under a tab`).toBeNull()
      // ⛔ **From every tab, and from a SHUT drawer**, which is the state a step reading the sheet
      // is really in — it opened a modal over whatever was there.
      for (const where of [...DRAWER_TABS, null])
        expect(tabFlowViolation(where, read), `${hook} from ${where ?? 'a shut drawer'}`).toBeNull()
    }

    // ⛔ **`told-index` is an EXACT entry and `told-why-…` is gone**, so no prefix answers for the
    // sheet's hooks by accident — the thing that would make every assertion above vacuous.
    expect(tabOfHook('told-index')).toBe('info')
    expect(tabOfHook('told-why-anything')).toBeNull()
  })
})

/**
 * **The wiring, not just the rule** (097, from review).
 *
 * The walk was first written twice — once in each live-smoke script — and the two copies had already
 * drifted in their active-tab query on the day they were written. It is one function now, and this
 * is what holds it: `assertTabFlow` is the piece `Cdp.evaluate` actually calls, and until this test
 * existed the only thing exercising it was a live step in one of the two scripts.
 */
describe('assertTabFlow — the piece Cdp.evaluate calls', () => {
  /** A fake raw evaluate that answers with `tab` and records what it was asked. */
  const pageOn = (tab) => {
    const asked = []
    return {
      asked,
      read: (probe) => {
        asked.push(probe)
        return Promise.resolve(tab)
      },
    }
  }

  it('does not even ask which tab it is on when no drawer hook is named', async () => {
    const page = pageOn('events')
    await assertTabFlow(`return document.title`, page.read)
    // The round trip is skipped entirely — this is what keeps the ordinary read unchanged.
    expect(page.asked).toEqual([])
  })

  it('asks, and passes, when the read is on the tab that owns it', async () => {
    const page = pageOn('info')
    await assertTabFlow(`document.querySelector('[data-cy=session-cwd]')`, page.read)
    expect(page.asked).toHaveLength(1)
    // The probe it sends must be a SCAN, or the walk would recurse on its own question.
    expect(hooksIn(page.asked[0])).toEqual([])
    expect(page.asked[0]).toBe(ACTIVE_TAB_EXPRESSION)
  })

  it('throws the walk’s own message when the read is on the wrong tab', async () => {
    const page = pageOn('events')
    await expect(
      assertTabFlow(`document.querySelector('[data-cy=session-cwd]')`, page.read),
    ).rejects.toThrow(/tab-flow: this step reads \[data-cy=session-cwd\]/)
  })

  it('throws when the drawer is shut', async () => {
    await expect(
      assertTabFlow(`document.querySelector('[data-cy=event-log]')`, pageOn(null).read),
    ).rejects.toThrow(/the drawer is SHUT/)
  })

  it('the probe it sends really answers with a tab id, against a real strip', () => {
    // ⚠️ The expression is a string evaluated in a page, so nothing typechecks it. Run it against a
    // hand-built DOM shaped like the strip and check it returns the ACTIVE tab rather than the
    // first one — a `find` on the wrong predicate would pass every test above and be wrong live.
    const buttons = ['open', 'info', 'events'].map((id, i) => ({
      dataset: { active: String(i === 2), cy: `drawer-tab-${id}` },
      getAttribute: () => `drawer-tab-${id}`,
    }))
    const document = { querySelectorAll: () => buttons }
    const answer = new Function('document', `return (() => { ${ACTIVE_TAB_EXPRESSION} })()`)(
      document,
    )
    expect(answer).toBe('events')
    // …and shut, which is the state that has its own message.
    expect(
      new Function('document', `return (() => { ${ACTIVE_TAB_EXPRESSION} })()`)({
        querySelectorAll: () => [],
      }),
    ).toBeNull()
  })
})
