import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { DRAWER_TABS, RESERVED_TABS, type DrawerTab } from '../../src/renderer/src/lib/drawer'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import { PROFILE_OWNS } from '../../src/renderer/src/lib/profile-words'
import { META, drawerProps, mount, unmountAll } from './harness'
import { DEFAULT_PROFILE_LABEL } from '../../src/shared/runtime-ipc'

/**
 * **One tab at a time, proved by clicking** (083 §3.1).
 *
 * 080's review found four bugs in the live-smoke scripts and they were *"the same mistake in four
 * costumes: a tabbed drawer shows one body at a time, and a script that used to read everything off
 * one screen now has to say which tab it wants."* One of them — a baseline read on the wrong tab —
 * left a check *"passing, having stopped checking anything"* for any ordinal including zero.
 *
 * The mechanical guard 080 added (`conversation-chrome.test.ts`) names its own limit: *"it cannot
 * prove a script selects the right TAB first — that needs a DOM."* This is that DOM. It does two
 * things the SSR renders cannot: it **clicks** the tab (so the strip is proved wired, not just
 * drawn), and it establishes **which tab owns which hook** from what the app actually mounts.
 */

afterEach(unmountAll)

/**
 * The drawer takes `tab` as a prop and emits `update:tab` — it does not own the state. So a click
 * changes nothing unless someone holds it, which is the app's arrangement and has to be this test's
 * too: without the wrapper, every click would appear to do nothing and the test would pass by
 * asserting that four identical renders are identical.
 */
const Harness = defineComponent({
  setup() {
    const tab = ref<DrawerTab>('open')
    // `as never` for the same reason `conversation-chrome.render.test.ts` uses it: the props are a
    // plain record, and spreading one into a typed SFC is not something TS can reconcile.
    return () =>
      h(SessionDrawer as never, {
        ...drawerProps({ tab: tab.value }),
        'onUpdate:tab': (next: DrawerTab) => {
          tab.value = next
        },
      })
  },
})

/** Every `data-cy` inside the drawer's BODY — the tab strip itself is on screen for all of them. */
function bodyHooks(host: HTMLElement): Set<string> {
  const body = host.querySelector('.drawer-body')
  expect(body, 'no .drawer-body — the drawer did not render its tab body at all').not.toBeNull()
  return new Set([...body!.querySelectorAll('[data-cy]')].map((el) => el.getAttribute('data-cy')!))
}

/**
 * Click a tab and wait for the body to swap. Returns the hooks now on screen.
 *
 * ⚠️ **It refuses to be handed the tab that is already open**, and that is not fussiness. Review
 * found the guard below was vacuous whenever the requested tab was already active: the button
 * carries `data-active="true"` from the initial render, so `click()` on a DEAD handler still left
 * the assertion passing. Requiring a real transition is what makes it mean "the strip is wired".
 */
async function show(host: HTMLElement, tab: DrawerTab): Promise<Set<string>> {
  const button = host.querySelector<HTMLElement>(`[data-cy="drawer-tab-${tab}"]`)
  expect(button, `no [data-cy=drawer-tab-${tab}] to click`).not.toBeNull()
  expect(
    button!.dataset.active,
    `drawer-tab-${tab} was ALREADY active — clicking it proves nothing about the handler`,
  ).toBe('false')

  button!.click()
  await nextTick()

  expect(button!.dataset.active, `clicking drawer-tab-${tab} did not select it`).toBe('true')
  return bodyHooks(host)
}

describe('the drawer shows one body at a time, and a click is what moves it', () => {
  it('every tab mounts its own hooks and none of anyone else’s', async () => {
    const m = mount(Harness, {}, { width: 380, height: 700 })

    // The Harness opens on `open`, so that one is read where it sits and every other tab is
    // reached by a click that genuinely moves — see `show`.
    const byTab = new Map<DrawerTab, Set<string>>([['open', bodyHooks(m.host)]])
    for (const tab of DRAWER_TABS.filter((t) => t.id !== 'open')) {
      byTab.set(tab.id, await show(m.host, tab.id))
    }
    expect(byTab.size, 'a tab was dropped from the sweep').toBe(DRAWER_TABS.length)

    // Non-vacuity first: a tab whose body rendered nothing is disjoint from everything, so the
    // real assertion below would pass over four empty sets.
    for (const [tab, hooks] of byTab) {
      expect(hooks.size, `the ${tab} tab rendered no hooks at all`).toBeGreaterThan(0)
    }

    // ⚠️ **The fact that made all four smoke bugs possible**: you cannot read an Info row while
    // sitting on Events, because it is not in the document. Pinned as a property over every pair
    // rather than as the one example that happened to bite.
    for (const [a, hooksA] of byTab) {
      for (const [b, hooksB] of byTab) {
        if (a === b) continue
        const both = [...hooksA].filter((cy) => hooksB.has(cy))
        expect(both, `${a} and ${b} both render: ${both.join(', ')}`).toEqual([])
      }
    }
  })

  it('the ordinals and the session ref really are on different tabs — 080’s two timeouts', async () => {
    const m = mount(Harness, {}, { width: 380, height: 700 })

    const info = await show(m.host, 'info')
    expect(info, 'the Info tab no longer carries the session ref').toContain('session-ref')

    const events = await show(m.host, 'events')
    // The negative, paired: Events rendered a body of its own, so the absence above is a choice
    // rather than a drawer that failed to mount.
    expect(events.size).toBeGreaterThan(0)
    expect(events).not.toContain('session-ref')
  })

  /**
   * **The ref row says whether it is a ref, and the text alone cannot** (163, from `smoke:ui` 44).
   *
   * A Claude session has no ref until its first turn's `system/init`, so the row renders a
   * placeholder until then — *"— (not announced yet)"*, which is a **non-empty string**. Step 44
   * waited for `textContent.length > 0` before killing the app, read that em-dash as a thread id,
   * and so killed it during exactly the window it was written to wait past. Every reading of that
   * step since has been about a session the provider had never named.
   *
   * `data-announced` is the answer that is not prose: it cannot drift with the copy, and a test
   * asking "has the ref landed" cannot accidentally ask "is this row on screen".
   */
  it('says whether the ref has been announced, not only what it would say', () => {
    const announced = mount(SessionDrawer as never, drawerProps({ tab: 'info' }), {
      width: 380,
      height: 700,
    })
    const withRef = announced.host.querySelector<HTMLElement>('[data-cy=session-ref]')
    expect(withRef, 'the Info tab no longer renders a ref row').not.toBeNull()
    expect(withRef!.dataset.announced).toBe('yes')
    expect(withRef!.textContent?.trim()).toBe(META.ref!.sessionId)

    const waiting = mount(SessionDrawer as never, drawerProps({ tab: 'info', sessionRef: null }), {
      width: 380,
      height: 700,
    })
    const withoutRef = waiting.host.querySelector<HTMLElement>('[data-cy=session-ref]')
    expect(withoutRef, 'the row disappears entirely when there is no ref').not.toBeNull()
    expect(withoutRef!.dataset.announced).toBe('no')
    // ⛔ The trap, pinned: the placeholder is not empty, so a length check reads it as an id.
    expect(withoutRef!.textContent?.trim().length).toBeGreaterThan(0)
    expect(withoutRef!.textContent).not.toContain(META.ref!.sessionId)
  })

  /**
   * ⚠️ **This test has now outlived its subject, and says so rather than being deleted.**
   *
   * It began as *"a reserved tab cannot be selected by clicking it"*. It clicked `context`; 087 made
   * that tab real and the click started selecting it, so it was retargeted onto `changes` — *"the one
   * slot that still has to obey it."* 096 made `changes` real too, and `RESERVED_TABS` is now
   * **empty**. There is no reserved slot left to click, which means the rule has no subject: a test
   * that kept clicking `drawer-tab-changes` and asserting nothing happened would be asserting the
   * opposite of the truth, and one that looped over the empty list would pass over nothing at all.
   *
   * So it asserts the inversion — the slot became real and clicking it now SELECTS it — plus the
   * fact that makes the old rule inapplicable. When a slot is next reserved, this is where its
   * coverage comes back, and the assertion below is what will fail to remind whoever adds it.
   */
  it('the last reserved slot became real — clicking Changes selects it', async () => {
    const m = mount(Harness, {}, { width: 380, height: 700 })
    const before = bodyHooks(m.host)

    const changes = m.host.querySelector<HTMLElement>('[data-cy="drawer-tab-changes"]')
    expect(changes, 'no Changes tab on the strip').not.toBeNull()
    expect(changes!.hasAttribute('disabled'), 'and it is no longer disabled').toBe(false)
    changes!.click()
    await nextTick()

    expect(changes!.getAttribute('data-active'), 'the click selected it').toBe('true')
    expect(m.host.querySelector('[data-cy="drawer-tab-open"]')!.getAttribute('data-active')).toBe(
      'false',
    )
    const after = bodyHooks(m.host)
    expect(after.has('session-changes'), 'and its body is what the drawer mounted').toBe(true)
    expect([...after]).not.toEqual([...before])

    // The reserved-slot rule has nothing to cover. Stated as an assertion so the next reserved tab
    // trips it, rather than as a comment nobody reads at the moment it stops being true.
    expect(
      RESERVED_TABS,
      'a slot is reserved again — restore the "a reserved tab cannot be selected" test above it',
    ).toEqual([])
  })
})

/**
 * 167 §4 · the drawer's Info tab, for a session that is not BroBot's.
 *
 * ⚑ **The one surface a running conversation has for saying whose agent it is**, and it says three
 * things now instead of one. `085` wrote *"sessions in this profile share what the provider
 * remembers"*, which was the whole truth then and has not been since: `158` gave a profile its own
 * `CLAUDE.md` and `166` made the memory follow the profile across every project rather than one
 * working directory. Two surfaces describing one boundary differently is exactly the drift `032` is
 * about, so this line and the launcher's now name the same three things.
 */
describe('whose agent this conversation is (167 §4)', () => {
  // `CreatedSession` has no index signature, so it is not a `Record<string, unknown>`; the prop bag
  // is one. Typed as the session it really is and widened at the call, which keeps the fixture
  // spreads below type-checked against the real shape.
  const panel = (session: CreatedSession): ReturnType<typeof mount> =>
    mount(SessionDrawer as never, drawerProps({ tab: 'info', session }), {
      width: 380,
      height: 700,
    })

  const info = (session: CreatedSession): HTMLElement => panel(session).q('session-profile')

  it('names a non-default profile as itself, beside the home it means', () => {
    const said = info({ ...META, profileId: 'developer', providerHome: '/homes/developer/claude' })
    expect(said.textContent).toContain('developer')
    expect(said.textContent).not.toContain('BroBot')
  })

  it('…and the default one as BroBot, the word `profileLabel` gives every surface', () => {
    // ⚑ **It read "the same word the launcher offers it under" until 417** (HO-022 §2): the
    // launcher's profile menu drew its rows through `profileLabel` too, and it is gone. The word is
    // still shared — `SessionShelf`, `SessionInfo` and `ResumableSessions` all take it from
    // `agentName` since `714`, which falls back to that one function in `shared/runtime-ipc.ts` —
    // so what the title named has moved, not lapsed.
    const said = info(META)
    expect(said.textContent).toContain(DEFAULT_PROFILE_LABEL)
  })

  it('says all three things a profile owns, not only what the provider remembers', async () => {
    // ⚑ **Behind the row's disclosure since 356 §1**: the ROW keeps the data — which profile, and
    // which variable pins its home — and the sentence explaining what a profile *is* moved one press
    // away. What 167 §4 protects is unchanged: the three things, in `PROFILE_OWNS`'s own words.
    //
    // 🔴 **And `CLAUDE.md` is gone from those words on purpose** (356, from 357). It is one
    // provider's filename and it was stated for both; the other reads a different name from a home,
    // and this app authors neither. The sentence names the THING — it was corrected on this surface
    // and on the launcher in one commit, because 032's drift is what a one-sided correction would
    // be, and 417 has since left this surface as the only one that says it at all.
    const view = panel(META)
    view.q('info-why-home').click()
    await nextTick()
    const said = view.host.textContent?.replace(/\s+/g, ' ') ?? ''

    expect(said).toContain('the conversations it runs there')
    expect(said).toContain('its own instruction file')
    expect(said).toMatch(/remembers/)
    // ⚠️ **`166`'s flip, in this sentence too.** The memory follows the profile into every folder it
    // works in; a line still implying it is scoped to this conversation's folder would be describing
    // the app as it was before `166`. (D-016 took projects out of the sentence, not the fact.)
    expect(said).toMatch(/every folder it works in/)
    // 🔴 **384 §1.1 turned the pointer below into an assertion.** It used to read: *"that the
    // LAUNCHER says the same words is asserted where the sources can be read — a browser test cannot
    // open `NewConversation.vue`, and hand-copying its sentence here would be two strings nothing
    // keeps equal."* ⚑ The constant is importable now, so this surface is checked against the
    // object itself — and there is no second string left to keep equal.
    //
    // ⚑ **417 (HO-022 §2) left this surface as the ONLY one that says it.** The launcher's profile
    // picker and the `profile-owns` note under it were removed together — *"Opening a new
    // conversation opens a conversation with BroBot. That is all."* — so `PROFILE_OWNS` has one
    // renderer now. ⛔ **Which makes the assertion below stronger, not weaker**: it is no longer
    // one of a pair agreeing, it is the whole of what the product says about a profile, measured
    // against the constant rather than against a sibling that could drift with it.
    expect(said).toContain(PROFILE_OWNS)
    // ⚠️ …and this surface's own trailing clause is still ITS own and not part of the shared line.
    expect(PROFILE_OWNS).not.toContain('The variable beside it')
    expect(said).toContain('The variable beside it is what pins that home.')
  })
})
