import { describe, expect, it } from 'vitest'
import {
  attentionTraces,
  DEFAULT_TAB,
  drawerFit,
  DRAWER_TABS,
  DRAWER_W_MAX,
  DRAWER_W_MIN,
  drawerWidth,
  isDrawerTab,
  RESERVED_TABS,
  tracesOutsideDrawer,
  TRANSCRIPT_COMFORT,
  TRANSCRIPT_MIN,
  type DrawerTab,
} from '../src/renderer/src/lib/drawer'
import {
  usePersistentChoice,
  usePersistentToggle,
  type ToggleStorage,
} from '../src/renderer/src/composables/usePersistentToggle'
import { LIFECYCLE_TOGGLE_TITLE } from '../src/renderer/src/lib/transcript-mode'
import type { SessionStatus } from '../src/shared/runtime-ipc'

/**
 * The rules half of 080 — the drawer's arithmetic, its memory, and the attention model.
 *
 * The chrome itself is asserted next door in `conversation-chrome.render.test.ts`; this is
 * everything that can be decided without rendering anything, which is deliberately most of it.
 * Chrome is the part of a UI that gets verified by eye, and 067 has still not bought us a DOM
 * harness — so every rule that COULD be a function is one, and this file is why.
 */

describe('the tab set', () => {
  it('is 079’s four, plus Changes and Work, in strip order, and Open is where you land', () => {
    // `context` joined them in 087 and `changes` in 096 — 079 reserved both slots, 086/092 designed
    // the bodies. They sit LAST rather than beside `open`: both are things you go and look at, and
    // putting them earlier would move tabs people already know where to find.
    // 🔴 **508 · `work` is the seventh and it was reserved by nobody** — the first tab this strip
    // has gained without 079 having held a slot for it. It sits last for the same reason the two
    // before it do.
    // ⚑ **W4.208 · `context` left**: its meter is the Context popup on the Open tab's card.
    // ⚑ **`controls` left too**: its model, plan and approval mode are on the same card.
    expect(DRAWER_TABS.map((tab) => tab.id)).toEqual(['open', 'events', 'info', 'changes', 'work'])
    expect(DEFAULT_TAB).toBe('open')
  })

  it('the last reserved slot became real, and one tab arrived with no slot held for it', () => {
    // 079 §2 shipped `changes` dimmed so the layout that got tested was the one this would have.
    // 096 built it, and this is the assertion that says the bet paid: the reserved list is EMPTY
    // now. `context` left it in 087 the same way.
    expect(RESERVED_TABS.map((slot) => slot.id)).toEqual([])
    // ⛔ **508 · the count moved and the STRIP had to be re-measured rather than re-asserted.**
    // 079's bet was that a six-tab layout tested icon-only would survive whatever filled the
    // reserved slots; `work` is outside that bet, so its width was measured in the dom project
    // before this number changed — see `drawer.ts`' `work` entry and
    // `the-work-this-conversation-gave-out.dom.test.ts`, which is where the fit is pinned.
    expect(DRAWER_TABS.length + RESERVED_TABS.length).toBe(5)
    // …and the tab that arrived is the one that was reserved, on the glyph that was reserved for it.
    expect(DRAWER_TABS.find((tab) => tab.id === 'changes')?.icon).toBe('#i-diff')
  })

  it('every tab has a distinct icon — a strip that goes icon-only cannot repeat one', () => {
    // At the narrow floor the labels are gone and the glyph is the whole of the affordance, so two
    // tabs sharing one would be two controls that are literally indistinguishable.
    const icons = [...DRAWER_TABS, ...RESERVED_TABS].map((tab) => tab.icon)
    expect(new Set(icons).size).toBe(icons.length)
  })

  it('the lifecycle toggle and the Events tab do NOT share a glyph', () => {
    // ⚠️ The pair 079 §3 is about. They are the two halves the old debug eye used to be — marks in
    // the conversation, and the unfiltered stream — and drawing them the same way would rebuild
    // exactly the ambiguity that retired the eye. Asserted because they are one character apart in
    // the sprite and a copy-paste would never be noticed by eye.
    const events = DRAWER_TABS.find((tab) => tab.id === 'events')!.icon
    expect(events).toBe('#i-activity')
    expect(events).not.toBe('#i-lifecycle')
  })
})

describe('a remembered tab is validated, never trusted', () => {
  const fake = (seed: Record<string, string> = {}): ToggleStorage & { seen: typeof seed } => ({
    seen: seed,
    getItem: (key) => seed[key] ?? null,
    setItem: (key, value) => {
      seed[key] = value
    },
  })

  it('accepts every live tab and rejects anything else', () => {
    for (const tab of DRAWER_TABS) expect(isDrawerTab(tab.id)).toBe(true)
    // ⚠️ The `for (const slot of RESERVED_TABS)` loop that asserted these were NOT selectable is
    // gone: 096 emptied the list, so it iterated zero times while reading as coverage (review). The
    // rule outlives it and comes back with the next reserved slot — this is what says so, and
    // `changes`, which used to be rejected here, must now be accepted.
    expect(RESERVED_TABS, 'a slot is reserved again — restore the rejection loop').toEqual([])
    expect(isDrawerTab('changes')).toBe(true)
    expect(isDrawerTab('paths')).toBe(false)
    expect(isDrawerTab('')).toBe(false)
    expect(isDrawerTab(null)).toBe(false)
    expect(isDrawerTab(undefined)).toBe(false)
  })

  it('restores a tab that was left open', () => {
    const store = fake({ 'brobot2.drawerTab': 'events' })
    expect(
      usePersistentChoice<DrawerTab>('brobot2.drawerTab', 'open', isDrawerTab, store).value,
    ).toBe('events')
  })

  it('falls back to Open when the stored value is one a LATER build retired', () => {
    // ⚠️ The case the validation exists for. A preference outlives the build that wrote it: rename
    // a tab and every machine that had it selected opens the drawer on nothing, with the cause
    // sitting in a store nobody thinks to look in.
    const store = fake({ 'brobot2.drawerTab': 'paths' })
    expect(
      usePersistentChoice<DrawerTab>('brobot2.drawerTab', 'open', isDrawerTab, store).value,
    ).toBe('open')
  })

  it('a remembered Controls tab lands on Open, where its settings went', () => {
    // The retired tab a real machine holds: its model, plan and approval mode are on the Open tab's
    // agent card, so the fallback is also where a person finds them.
    expect(isDrawerTab('controls')).toBe(false)
    const store = fake({ 'brobot2.drawerTab': 'controls' })
    expect(
      usePersistentChoice<DrawerTab>('brobot2.drawerTab', DEFAULT_TAB, isDrawerTab, store).value,
    ).toBe('open')
    // The control: a tab that still exists is restored by the same call.
    const kept = fake({ 'brobot2.drawerTab': 'info' })
    expect(
      usePersistentChoice<DrawerTab>('brobot2.drawerTab', DEFAULT_TAB, isDrawerTab, kept).value,
    ).toBe('info')
  })

  it('survives having no storage at all — a preference must not break a render', () => {
    expect(
      usePersistentChoice<DrawerTab>('brobot2.drawerTab', 'info', isDrawerTab, null).value,
    ).toBe('info')
  })

  /**
   * The drawer defaults to visible, but either stored toggle choice overrides that default.
   * In particular, a stored `false` must survive launch.
   */
  it('the drawer starts OPEN on a machine that has never opened it (385 §2)', () => {
    expect(usePersistentToggle('brobot2.drawerOpen', true, fake()).value).toBe(true)
    // ⚑ …and a person who shut it keeps it shut. Without this, "flip the default" and "open the
    // drawer on every launch" are the same test.
    expect(
      usePersistentToggle('brobot2.drawerOpen', true, fake({ 'brobot2.drawerOpen': 'false' }))
        .value,
    ).toBe(false)
  })
})

describe('the squeeze: the transcript always wins (079 §4, W4.183)', () => {
  /**
   * The docked drawer responds within 360–560 px; preview widths of 463 and 532 px lie inside
   * those bounds.
   */
  it('docks from the floor’s room up, and the boundary is exact', () => {
    expect(drawerFit(TRANSCRIPT_MIN + DRAWER_W_MIN)).toBe('docked')
    expect(drawerFit(TRANSCRIPT_MIN + DRAWER_W_MIN - 1)).toBe('overlay')
    expect(drawerFit(2400)).toBe('docked')
  })

  it('is fluid between its floor and its ceiling, and never past either', () => {
    expect(drawerWidth(TRANSCRIPT_MIN + DRAWER_W_MIN)).toBe(DRAWER_W_MIN)
    expect(drawerWidth(TRANSCRIPT_COMFORT + DRAWER_W_MIN)).toBe(DRAWER_W_MIN)
    expect(drawerWidth(TRANSCRIPT_COMFORT + 463)).toBe(463)
    expect(drawerWidth(TRANSCRIPT_COMFORT + 532)).toBe(532)
    expect(drawerWidth(TRANSCRIPT_COMFORT + DRAWER_W_MAX)).toBe(DRAWER_W_MAX)
    expect(drawerWidth(2400)).toBe(DRAWER_W_MAX)
  })

  /**
   * ⚑ **The conversation gets its width before the panel does**: the panel
   * grows past its floor only once the transcript has its comfortable width, and below that it is
   * the transcript that gives way, down to its own floor.
   */
  it('the panel grows past its floor only once the transcript is comfortable', () => {
    for (let width = TRANSCRIPT_MIN + DRAWER_W_MIN; width < 2200; width += 7) {
      const drawer = drawerWidth(width)
      if (drawer > DRAWER_W_MIN) {
        expect(width - drawer, `the panel grew at ${width}px first`).toBeGreaterThanOrEqual(
          TRANSCRIPT_COMFORT,
        )
      } else {
        expect(
          width,
          `the panel kept its floor at ${width}px with room to grow`,
        ).toBeLessThanOrEqual(TRANSCRIPT_COMFORT + DRAWER_W_MIN)
      }
    }
  })

  it('the reading column NEVER computes below its floor while the drawer is docked', () => {
    // The property, rather than examples of it: for every width where the drawer is still a column,
    // what is left for the transcript is at least the floor. This is the whole promise.
    for (let width = TRANSCRIPT_MIN + DRAWER_W_MIN; width < 2200; width += 7) {
      expect(drawerFit(width)).toBe('docked')
      expect(width - drawerWidth(width), `transcript crushed at ${width}px`).toBeGreaterThanOrEqual(
        TRANSCRIPT_MIN,
      )
    }
  })
})

describe('the attention model: a waiting card is never traceless (079 §5)', () => {
  const STATUSES: (SessionStatus | null)[] = [
    'idle',
    'working',
    'waiting_permission',
    'ended',
    'errored',
    null,
  ]
  const TABS: DrawerTab[] = DRAWER_TABS.map((tab) => tab.id)

  it('with the drawer SHUT, the count and the amber pill both still say so', () => {
    const traces = attentionTraces({
      waiting: 1,
      status: 'waiting_permission',
      drawerOpen: false,
      tab: 'open',
    })
    expect(traces.badge).toBe(true)
    expect(traces.urgent).toBe(true)
    expect(traces.statusPill).toBe(true)
    expect(tracesOutsideDrawer(traces)).toBe(2)
    // Nothing INSIDE it, because there is no inside to mark.
    expect(traces.tabDot).toBe(false)
    expect(traces.crossTab).toBe(false)
  })

  it('with the drawer OPEN on Info, the tab is dotted AND the bar names it', () => {
    const traces = attentionTraces({
      waiting: 1,
      status: 'waiting_permission',
      drawerOpen: true,
      tab: 'info',
    })
    expect(traces.tabDot).toBe(true)
    expect(traces.crossTab).toBe(true)
    // ⚠️ A waiting card is never MERELY a dot — that is the sentence 079 wrote and this is it.
    // The two outside traces do not stand down just because the drawer happens to be open.
    expect(tracesOutsideDrawer(traces)).toBe(2)
    // The toggle stops shouting: the drawer is open, and the dot has located it more precisely.
    expect(traces.urgent).toBe(false)
  })

  it('on the Open tab there is no cross-tab bar — you are already looking at the list', () => {
    const traces = attentionTraces({
      waiting: 2,
      status: 'waiting_permission',
      drawerOpen: true,
      tab: 'open',
    })
    expect(traces.crossTab).toBe(false)
    expect(traces.tabDot).toBe(true)
  })

  it('answered clears every trace in the same tick', () => {
    for (const drawerOpen of [true, false]) {
      for (const tab of TABS) {
        const traces = attentionTraces({ waiting: 0, status: 'working', drawerOpen, tab })
        expect(Object.values(traces).every((on) => on === false)).toBe(true)
      }
    }
  })

  it('THE TEST: nothing waiting is ever without a trace outside the drawer', () => {
    // Exhaustive over every place the drawer can be and every status the host can report. This is
    // the acceptance criterion, and it is the reason a shut default is defensible at all: closing
    // the drawer may hide the LIST, and may never hide the FACT.
    for (const waiting of [1, 2, 9]) {
      for (const status of STATUSES) {
        for (const drawerOpen of [true, false]) {
          for (const tab of TABS) {
            const traces = attentionTraces({ waiting, status, drawerOpen, tab })
            const where = `waiting=${waiting} status=${status} open=${drawerOpen} tab=${tab}`
            expect(tracesOutsideDrawer(traces), where).toBeGreaterThanOrEqual(1)
            expect(traces.badge, where).toBe(true)
            // And inside it, attention is always LOCATED: either the tab is dotted, or the drawer
            // is shut and there is no tab to dot.
            expect(traces.tabDot || !drawerOpen, where).toBe(true)
          }
        }
      }
    }
  })

  it('the pill is the HOST’s word, not a second reading of our own count', () => {
    // ⚠️ **Found by a surviving mutant.** Replacing `status === 'waiting_permission'` with the
    // count passed every test in this file, because every other case here has the two agreeing —
    // so the one property that makes this trace worth having was untested. They are two facts from
    // two sources, and the whole reason the pill is read from the session rather than recomputed is
    // that where they disagree, the host is right about the session.
    //
    // The disagreement is REACHABLE, in both directions. A card lands in the fold a tick before the
    // status event: count 1, status still `working`. And a status can say `waiting_permission`
    // while our fold holds nothing — a reader paged back past the card, or a card the projection
    // has already settled.
    const early = attentionTraces({ waiting: 1, status: 'working', drawerOpen: false, tab: 'open' })
    expect(early.badge).toBe(true)
    expect(early.statusPill).toBe(false)
    // Still traced, and that is the guarantee: the badge alone carries the frame.
    expect(tracesOutsideDrawer(early)).toBe(1)

    const late = attentionTraces({
      waiting: 0,
      status: 'waiting_permission',
      drawerOpen: false,
      tab: 'open',
    })
    expect(late.badge).toBe(false)
    expect(late.statusPill).toBe(true)
    // Nothing of OURS is claimed — no badge, no dot, no bar — while the bar still states the
    // session's own status. A pill recomputed from the count would have gone quiet here and
    // contradicted the header beside it.
    expect(late.tabDot).toBe(false)
    expect(late.urgent).toBe(false)
  })

  it('…and it is TWO traces whenever the host agrees, which is every steady state', () => {
    // The badge is ours, off the control projection; the pill is the host's word. Both adapters
    // hold one wait count across permissions AND questions (076, 122), so `waiting_permission` is what a
    // blocked session reports — the pair only differ for the frame between the card arriving and
    // the status event landing, and in that frame the badge is already up.
    for (const drawerOpen of [true, false]) {
      for (const tab of TABS) {
        const traces = attentionTraces({
          waiting: 1,
          status: 'waiting_permission',
          drawerOpen,
          tab,
        })
        expect(tracesOutsideDrawer(traces)).toBe(2)
      }
    }
  })
})

describe('the top bar states, and the drawer acts (079 §1)', () => {
  it('the debug toggle is the lifecycle toggle now, and says so in words', () => {
    // The hook is deliberately unchanged (079 §3 allows it) — what changed is the meaning, and the
    // meaning has to be readable on the control rather than known by whoever moved it.
    expect(LIFECYCLE_TOGGLE_TITLE).toContain('Show lifecycle events in the conversation')
  })
})
