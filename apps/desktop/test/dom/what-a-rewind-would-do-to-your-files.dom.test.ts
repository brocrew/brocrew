import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { CHANGES_OFF_THE_SCALE, CHANGES_TEXT } from '../../src/renderer/src/lib/drawer-tab-roles'
import { DRAWER_W_MAX, DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { ROLE_ORDER, ROLE_SIZE, type TextRole } from '../../src/renderer/src/lib/text-roles'
import {
  applyEvent,
  createTranscript,
  markPermissionAnswered,
  type TranscriptState,
} from '../../src/renderer/src/lib/transcript'
import type { ProviderCapabilityMap, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE, CLAUDE_REWIND_REASON } from '../provider-capability-fixture'
import { drawerProps, mount, unmountAll, visible, type Mounted } from './harness'
import { drawnReady, describeClip, lineCount, notDrawn, titleRecovers } from './drawn'

/**
 * 🔴 **541 · what a rewind would do to your files, at the width the drawer opens at.**
 *
 * ⛔ **`525` measured this tab and ordered the work**: *"its paths are already correctly prominent,
 * but the **416-character rewind disclosure** is assigned **8/8.5 px** prose roles."* ⚑ `526` and
 * `529` had already built the answer for three other tabs — a roster of ROLES, a bridge of custom
 * properties, and a per-element test that asks the ENGINE what a thing came out at — so this file
 * is that instrument pointed at the fourth.
 *
 * ## ⚠️ Two questions, and only one of them is a size
 *
 * 1. 🔴 **Is the disclosure at a reading size?** On `main` it is **8 px** — `--text-5xs`, *micro
 *    chips* — for 416 characters saying that a rewind **writes to your files**. `HO-050` §1.2
 *    rules that a rewind is a PRESS and §2 keeps its disclosure beside it; `514` F1 is why the
 *    size decides whether it was given at all.
 * 2. ⛔ **Is it DRAWN?** `531` measured that an assertion can pass over a string the browser
 *    clipped and `530` found a value that had never fitted its column — so every claim below about
 *    what a person reads goes through `drawn.ts`'s ink sensor and not through `toContain`.
 *
 * ⚑ **The second question is the one that changed the answer.** The sensor found the file NAME cut
 * by 85.59 px at the shipped `--drawer-w` with nothing to recover it — a defect a size histogram
 * cannot see, on the half of `525`'s sentence that said the paths were already right.
 *
 * ⚠️ **And it was the only such text in a sweep of all seven tabs, which is a claim with a shape.**
 * `541` mounted each tab in turn at `--drawer-w` with ONE populated fixture and swept every visible
 * carrier; ⛔ a state those fixtures do not reach is outside it, so *"the only one"* means *the only
 * one that sweep could see* and not *the only one there is*.
 */

/* ------------------------------------------------------------------ the corpus */

const AT = 1_700_000_000_000

/**
 * ⚑ **The rewind declaration as bytes**, checked against `capabilitiesFor('claude')` in
 * `press-read-and-a-word.test.ts` — the dom project cannot import the real map (`@brobot2/runtime`
 * pulls `node:fs` in and Vite externalises it), so *a fixture must plant what the subject eats*.
 */
const CAPS = {
  ...(CAPABILITY_FIXTURE as unknown as Record<string, unknown>),
} as unknown as ProviderCapabilityMap

const DIFF = ['@@ -1,3 +1,3 @@', ' alpha', '-beta', '+BETA', ' gamma'].join('\n')

/**
 * ⛔ **`525`'s fixture: fourteen distinct files**, and every state a row has — the five statuses,
 * a net-unchanged write, an oversize diff, a crowded-out one, a Claude row with no diff at all,
 * and a directory deep enough to be ellipsised. ⚠️ A corpus of short paths would make every
 * assertion about a cut vacuous, which is `531`'s own lesson about the rail.
 */
const FILES = [
  {
    path: 'apps/desktop/src/renderer/src/components/SessionChanges.vue',
    status: 'modified',
    added: 31,
    removed: 9,
    diff: DIFF,
  },
  {
    path: 'apps/desktop/src/renderer/src/lib/changes.ts',
    status: 'modified',
    added: 58,
    removed: 2,
    diff: DIFF,
  },
  {
    path: 'apps/desktop/src/renderer/src/lib/drawer-tab-roles.ts',
    status: 'added',
    added: 120,
    removed: 0,
    diff: DIFF,
  },
  {
    path: 'apps/desktop/test/dom/changes-tab.dom.test.ts',
    status: 'modified',
    added: 9,
    removed: 9,
    diff: DIFF,
  },
  { path: 'packages/runtime/src/claude/capabilities.ts', status: 'modified', added: 4, removed: 1 },
  {
    path: 'packages/shared/src/legacy/very/deeply/nested/path/that/goes/on/ChangeReport.ts',
    status: 'renamed',
    added: 12,
    removed: 12,
    oldPath: 'packages/shared/src/ChangeReport.ts',
  },
  {
    path: 'apps/desktop/src/main/runtime/runtime-host.ts',
    status: 'modified',
    added: 0,
    removed: 0,
    diff: DIFF,
  },
  {
    path: 'scripts/mutations/541/mutations.py',
    status: 'added',
    added: 210,
    removed: 0,
    oversize: true,
  },
  {
    path: 'docs/development.md',
    status: 'modified',
    added: 3,
    removed: 3,
    crowdedOut: true,
  },
  { path: 'apps/desktop/src/renderer/src/assets/tokens.css', status: 'touched' },
  {
    path: 'apps/desktop/out/renderer/index.html',
    status: 'deleted',
    added: 0,
    removed: 41,
    diff: DIFF,
  },
  { path: 'README.md', status: 'modified', added: 1, removed: 1 },
  {
    path: 'apps/desktop/src/renderer/src/components/EventStream.vue',
    status: 'modified',
    added: 77,
    removed: 40,
    diff: DIFF,
  },
  {
    path: 'apps/desktop/src/renderer/src/lib/text-roles.ts',
    status: 'modified',
    added: 6,
    removed: 2,
  },
] as const

/** Codex's real under-disclosure: a file change approved without the files being named (092 §3). */
const undisclosed = (id: string): TranscriptEvent =>
  ({
    type: 'permission_request',
    id,
    kind: 'file',
    action: 'apply_patch',
    detail: 'write',
    scope: {
      cwd: '/work',
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny', 'cancel'],
      underDisclosed: true,
    },
  }) as never

/**
 * ⛔ **Every block this pane can draw, in one mount.** ⚠️ `dropped` and `droppedReports` are two
 * different sentences (files a report named beyond the cap; whole observations released), and a
 * roster checked against a state that draws neither would pass over both.
 */
function populated(): TranscriptState {
  const state = createTranscript()
  const events: TranscriptEvent[] = [
    { type: 'user_turn', text: 'go' } as never,
    undisclosed('req_a'),
    undisclosed('req_b'),
    {
      type: 'file_change',
      changes: FILES.slice(0, 7),
      source: 'turn/diff/updated',
      dropped: 3,
    } as never,
    { type: 'file_change', changes: FILES.slice(7), source: 'Edit' } as never,
  ]
  events.forEach((event, index) => applyEvent(state, event, AT + index * 1000, index))
  markPermissionAnswered(state, 'req_a', 'allow')
  markPermissionAnswered(state, 'req_b', 'allow')
  state.changes = { ...state.changes, dropped: 2 }
  return state
}

/* ------------------------------------------------------------------ the instruments */

const px = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize)

const name = (el: Element): string =>
  (el as HTMLElement).dataset?.cy ?? `${el.tagName.toLowerCase()}.${String(el.className) || '—'}`

const words = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

/**
 * ⛔ **The token, resolved by the engine, in the place the element sits** (529's helper, same
 * argument). A planted `<span>` takes the same cascade and the same used-value rounding the
 * subject took; `getPropertyValue` would hand back the authored token stream and never pass
 * through `font-size` computation at all.
 */
function tokenPx(token: string, beside: Element): number {
  const probe = document.createElement('span')
  probe.style.fontSize = `var(${token})`
  ;(beside.parentElement ?? document.body).append(probe)
  const resolved = Number.parseFloat(getComputedStyle(probe).fontSize)
  probe.remove()
  expect(resolved, `${token} resolved to nothing beside ${name(beside)}`).toBeGreaterThan(0)
  return resolved
}

/** Direct text only, so a wrapper is not counted again for the words inside its child. */
const ownsText = (el: Element): boolean =>
  [...el.childNodes].some(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  )

/**
 * ⛔ **`525`'s counting rule, stopping at the diff paper.** An expanded row mounts `DiffBody`,
 * which is a CODE reading surface with a register of its own; `CHANGES_TEXT`'s docblock says why
 * it is out and which one sentence inside it is in.
 */
const textBearing = (root: HTMLElement): HTMLElement[] =>
  [root, ...root.querySelectorAll<HTMLElement>('*')].filter(
    (el) =>
      ownsText(el) &&
      visible(el) &&
      (el.closest('[data-cy="diff-body"]') === null || el.matches('[data-cy="diff-banner"]')),
  )

const rolesOf = (el: Element): TextRole[] =>
  CHANGES_TEXT.filter((entry) => el.matches(entry.selector)).map((entry) => entry.role)

const offScale = (el: Element): boolean =>
  CHANGES_OFF_THE_SCALE.some((entry) => el.matches(entry.selector))

/* ------------------------------------------------------------------ the mounts */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/**
 * ⛔ **Every width the drawer is ever drawn at.** `DRAWER_W_MIN` is the comfortable track a person
 * actually gets today; `DRAWER_W_MIN` is both the narrow fit and the overlay, which `525` §4
 * measured as unreachable at the current 1,180 px app minimum and which is still a shipped
 * constant this component is drawn at. ⚑ 368 is what `525` MOUNTED at, kept so every number here
 * is comparable with the measurement this repairs.
 */
const WIDTHS = [DRAWER_W_MIN, 460, DRAWER_W_MAX] as const

/**
 * ⛔ **The DRAWER, not the panel bare.** This panel lives in a 320–380 px column inside the
 * drawer's own scope, and a size read outside it is a size read somewhere the component never
 * sits. ⚑ `waiting: 3` puts the cross-tab attention bar on the strip, which is the state `525`
 * measured and the one that costs the body its 39 px.
 */
async function changesAt(
  width: number = DRAWER_W_MIN,
  over: Record<string, unknown> = {},
): Promise<Mounted> {
  await page.viewport(1440, 1100)
  // ⛔ **Every number below is a wrap count in disguise**, and a wrap count depends on the font
  // actually being there. `drawnReady` asks for the face rather than waiting on whatever is in
  // flight, then takes the frame after it.
  await drawnReady()
  const state = populated()
  const m = mount(
    SessionDrawer,
    drawerProps({
      tab: 'changes',
      waiting: 3,
      state,
      shown: state,
      capabilities: CAPS,
      fit: 'docked',
      ...over,
    }),
    { width, height: 1000 },
  )
  await nextTick()
  await nextTick()
  return m
}

const blank = (): Record<string, unknown> => {
  const state = createTranscript()
  return { state, shown: state }
}

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ------------------------------------------------------------------ §1 the roster */

describe('541 §1 · the roster answers for every text on this tab, and for nothing else', () => {
  it('⛔ every visible text matches exactly one role, or is listed off the scale', async () => {
    const m = await changesAt()
    const panel = m.q('session-changes')
    const drawn = textBearing(panel)

    // ⚑ The premise: the fixture really drew a populated tab, or everything below measures a
    // handful. `525` counted 75 here with its own fourteen files.
    expect(drawn.length, '525 counted 75 here; this drew almost nothing').toBeGreaterThan(60)

    const uncovered = drawn.filter((el) => rolesOf(el).length === 0 && !offScale(el))
    expect(uncovered.map(name), 'these are on the tab and in no role').toEqual([])
    for (const el of drawn.filter((el) => !offScale(el))) {
      expect(rolesOf(el), `${name(el)} is in more than one role`).toHaveLength(1)
    }

    // ⛔ …and the exemption is honoured rather than skipped: it is on the tab, it is counted, and
    // it is strictly LOUDER than reading text. An off-scale size that drifted BELOW the reading
    // size would be the defect wearing an exemption.
    for (const entry of CHANGES_OFF_THE_SCALE) {
      const found = [...panel.querySelectorAll<HTMLElement>(entry.selector)].filter(visible)
      expect(found.length, `${entry.selector} is listed off the scale and drew nothing`).toBe(1)
      expect(drawn, 'the off-scale element is not even in the walk').toContain(found[0])
      expect(px(found[0]!)).toBeGreaterThan(tokenPx(ROLE_SIZE[entry.largerThan], found[0]!))
    }
  })

  /**
   * ⛔ **No single mount draws this roster.** The empty state and the list are mutually exclusive
   * by construction (`blank` is `rows.length === 0 && !showUndisclosed`), the banner needs a
   * deleted file EXPANDED, and the two "we were told and did not keep" sentences need a report
   * that dropped rows. ⚑ So the claim is over the UNION of the states the tab has —
   * `a-loop-over-a-literal-variant-list-is-not-exhaustive` is what one mount would be.
   */
  it('⚑ …and every entry matches something across the states the tab has', async () => {
    const matched = new Set<string>()
    const states: Record<string, unknown>[] = [{}, blank()]
    for (const over of states) {
      const m = await changesAt(DRAWER_W_MIN, over)
      const panel = m.q('session-changes')
      for (const entry of CHANGES_TEXT) {
        if ([...panel.querySelectorAll(entry.selector)].some((el) => visible(el))) {
          matched.add(entry.selector)
        }
      }
      m.unmount()
    }

    // ⚑ The banner needs a press: the deleted row, expanded, is the only state that draws it.
    const m = await changesAt()
    const deleted = m.q('changes-row-apps/desktop/out/renderer/index.html')
    deleted.click()
    await nextTick()
    await nextTick()
    const panel = m.q('session-changes')
    expect(m.all('diff-banner'), 'the deleted row drew no banner').toHaveLength(1)
    for (const entry of CHANGES_TEXT) {
      if ([...panel.querySelectorAll(entry.selector)].some((el) => visible(el))) {
        matched.add(entry.selector)
      }
    }

    const unused = CHANGES_TEXT.filter((entry) => !matched.has(entry.selector))
    expect(
      unused.map((entry) => entry.selector),
      'these roles match nothing on any state',
    ).toEqual([])
  })
})

/* ------------------------------------------------------------------ §2 the sizes */

describe('541 §2 · each element reads at its role’s token', () => {
  it('🔴 element by element, resolved where it sits', async () => {
    const m = await changesAt()
    const panel = m.q('session-changes')
    let measured = 0
    for (const entry of CHANGES_TEXT) {
      for (const el of [...panel.querySelectorAll<HTMLElement>(entry.selector)].filter(visible)) {
        expect(px(el), `${name(el)} (${entry.role}) is not on ${ROLE_SIZE[entry.role]}`).toBe(
          tokenPx(ROLE_SIZE[entry.role], el),
        )
        measured += 1
      }
    }
    expect(measured, 'the sweep touched too little to be one').toBeGreaterThan(50)
  })

  /**
   * 🔴 **The assertion above compares `ROLE_SIZE` with itself, and this one does not.**
   *
   * ⛔ **A per-element equality is blind to every edit of `ROLE_SIZE` by construction** — both
   * sides read the map, so putting every role back on `--text-6xs` passes all of it. ⚑ The floors
   * are typed HERE. ⚠️ They are FLOORS and not equalities: raising a role is a decision somebody
   * can make without touching this file; lowering one is the drift `525` measured, and it cannot.
   */
  it('🔴 no role may drift DOWN — floors that do not come from the map they check', async () => {
    const m = await changesAt()
    const panel = m.q('session-changes')

    const FLOOR: Record<TextRole, number> = {
      // `tokens.css` §9: reading lives at 11-12 px, and the deferred foot is a safety sentence.
      prose: 11,
      // The step `tokens.css` itself calls the *DEFAULT UI label & button text*.
      label: 10,
      // §9's own floor: *"sizes < 9px are micro-labels/badges/table-heads only."*
      value: 9,
      // The micro end — a directory prefix, a tag about the row rather than in it.
      meta: 8,
      // ⛔ Unworn on this tab, and held to the same floor `529` set for the two it repaired.
      field: 7.5,
    }

    for (const role of ROLE_ORDER) {
      expect(
        tokenPx(ROLE_SIZE[role], panel),
        `${role} is on ${ROLE_SIZE[role]}, below the floor these tabs were repaired to`,
      ).toBeGreaterThanOrEqual(FLOOR[role])
    }

    // The control: the floors are not satisfied by everything. No token is under 12 px now, so it
    // plants 7.5 px, the tab's smallest text before the floor, which clears none of them.
    panel.style.setProperty('--probe-under', '7.5px')
    const bottom = tokenPx('--probe-under', panel.firstElementChild!)
    panel.style.removeProperty('--probe-under')
    for (const role of ROLE_ORDER) {
      if (role === 'field') continue
      expect(bottom, `${role}'s floor is satisfied by the size 525 measured`).toBeLessThan(
        FLOOR[role],
      )
    }
  })

  /**
   * 🔴 **…and the stylesheet actually GOES THROUGH the bridge, which nothing else asks.**
   *
   * ⛔ **Hard-code every size back to a `--text-*` and the sweep above still passes**, because it
   * compares the element against `ROLE_SIZE` and both would agree. ⚠️ Worse for `prose`:
   * `base.css` puts `--text-base` on `body`, so deleting `font-size` from a prose rule changes
   * nothing a size assertion can see. ⚑ Driving the custom property and watching the elements
   * MOVE is the only reading that can tell.
   */
  it('🔴 every role is wired THROUGH --role-*, or the module decides nothing', async () => {
    const m = await changesAt()
    const panel = m.q('session-changes')
    // ⛔ **Every element carrying the bridge, not only the panel's root.** `DiffBody` declares
    // `ROLE_PROPERTIES` on its OWN root for the banner — *a component that names a role declares
    // the bridge* — so a child's inline property beats the parent's.
    const deleted = m.q('changes-row-apps/desktop/out/renderer/index.html')
    deleted.click()
    await nextTick()
    await nextTick()

    const carriers = [panel, ...panel.querySelectorAll<HTMLElement>('[style*="--role-"]')]
    expect(carriers.length, 'nothing on this tab carries the bridge').toBeGreaterThan(1)

    for (const role of ROLE_ORDER) {
      const wearers = CHANGES_TEXT.filter((entry) => entry.role === role).flatMap((entry) =>
        [...panel.querySelectorAll<HTMLElement>(entry.selector)].filter(visible),
      )
      if (wearers.length === 0) continue

      // ⚠️ **Put back, never removed.** The property is an INLINE style Vue wrote from
      // `ROLE_PROPERTIES`, and Vue does not re-apply it until the component re-renders —
      // `removeProperty` would strip the bridge for the rest of the mount and the elements would
      // fall back to `body`'s `--text-base`, which looks exactly like a working `prose`.
      const authored = carriers.map((el) => el.style.getPropertyValue(`--role-${role}`))
      expect(authored[0], `--role-${role} is not an inline property of the panel`).not.toBe('')
      for (const el of carriers) el.style.setProperty(`--role-${role}`, '23px')
      try {
        for (const el of wearers) {
          expect(px(el), `${name(el)} did not follow --role-${role}`).toBe(23)
        }
      } finally {
        carriers.forEach((el, i) => el.style.setProperty(`--role-${role}`, authored[i]!))
      }
      for (const el of wearers) expect(px(el)).toBe(tokenPx(ROLE_SIZE[role], panel))
    }
  })

  it('⚑ …and the sweep is proven by VIOLATING it', async () => {
    const m = await changesAt()
    const panel = m.q('session-changes')
    const floor = tokenPx('--text-3xs', panel)

    // ⛔ A sweep nobody has made fail is a sweep nobody has measured. `--text-5xs` is where `525`
    // found the rewind disclosure, planted on the path the walk takes.
    const planted = document.createElement('p')
    planted.textContent = 'the deferred foot as 525 measured it'
    planted.style.fontSize = '8px'
    panel.append(planted)
    try {
      const caught = textBearing(panel).filter(
        (el) => px(el) < floor && rolesOf(el).length === 0 && !offScale(el),
      )
      expect(caught).toHaveLength(1)
      expect(caught[0]).toBe(planted)
    } finally {
      planted.remove()
    }
  })
})

/* ------------------------------------------------------------------ §3 the ink */

describe('541 §3 · the disclosure is DRAWN, at every width the drawer opens at', () => {
  it.each(WIDTHS)('🔴 what a rewind would do to your files, at %i px', async (width) => {
    const m = await changesAt(width)
    const why = m.q('changes-revert-why')

    // ⚑ The premise: this really is the 416-character sentence `525` measured, composed from the
    // adapter's own reason rather than from prose written in a test.
    expect(words(why)).toContain(CLAUDE_REWIND_REASON)
    expect(words(why)).toHaveLength(416)

    // 🔴 **The claim, and it is about ink.** Nothing of this sentence is cut, at any shipped
    // width, by a box a person cannot scroll — `notDrawn` is `cutsOf` plus *never drawn at all*,
    // which is the hole `531`'s own repair walked into.
    expect(
      notDrawn(why, m.host).map(describeClip),
      'part of the rewind disclosure is on screen nowhere',
    ).toEqual([])

    // ⛔ **…and it is drawn at a READING size.** On `main` this is `--text-5xs` — 8 px, *micro
    // chips* — which is what `525` measured and what `HO-050` §1.2 and `514` F1 are about.
    expect(px(why), 'the rewind disclosure is not at the reading size').toBe(
      tokenPx(ROLE_SIZE.prose, why),
    )

    // ⚑ The wrap count is the consequence a person sees: more lines at 11.5 px than at 8, and the
    // narrower the column the more of them. It is here so the trade is asserted rather than
    // described — and so that a later change collapsing the sentence onto one line reddens.
    expect(lineCount(why), 'a 416-character sentence drew as one line').toBeGreaterThan(4)
  })

  /**
   * 🔴 **The half a size histogram cannot see.** `531`'s sensor over every carrier on this tab:
   * a person either reads the whole string, or the pointer recovers it.
   *
   * ⛔ **On `main` this is RED**, and it is the finding this dispatch did not go looking for: the
   * file NAME was cut by 85.59 px at `DRAWER_W_MIN` with no `title` anywhere above it, and at
   * `DRAWER_W_MIN` a path column measuring 0.00 px — none of that name drawn at all.
   */
  it.each(WIDTHS)('🔴 nothing on this tab is cut and unreachable, at %i px', async (width) => {
    const m = await changesAt(width)
    const panel = m.q('session-changes')
    expect(panel.querySelectorAll('button.row')).toHaveLength(FILES.length)
    expect(words(m.q('changes-revert-why'))).toContain(CLAUDE_REWIND_REASON)

    // This clipping measurement depends on the Mac font; the rows and disclosure stay checked everywhere.
    if (/mac/i.test(navigator.platform)) {
      const lost = textBearing(panel)
        .map((el) => ({ el, clips: notDrawn(el, m.host) }))
        .filter(({ el, clips }) => clips.length > 0 && !titleRecovers(el, m.host))
        .map(
          ({ el, clips }) => `${name(el)} “${words(el)}” · ${clips.map(describeClip).join(' · ')}`,
        )

      expect(lost, 'these are drawn short and nothing gets the rest back').toEqual([])
    }
  })

  /**
   * ⚑ **The positive control, and every sweep needs one**
   * (`a-positive-assertion-must-differ-from-the-default`). ⛔ *Nothing is lost* is a measurement
   * only if this sensor says so about something on the same page that IS.
   */
  it('⚑ …and the sensor is the reason that is a measurement', async () => {
    const m = await changesAt(DRAWER_W_MIN)
    const panel = m.q('session-changes')

    // ⛔ A path long enough that the column cannot hold it, with no title above it — the exact
    // shape the assertion above forbids, planted where the walk goes.
    const planted = document.createElement('div')
    planted.className = 'path'
    planted.style.width = '40px'
    planted.style.overflowX = 'hidden'
    const inner = document.createElement('span')
    inner.className = 'name'
    inner.style.whiteSpace = 'nowrap'
    inner.textContent = 'a-file-name-no-column-in-this-drawer-could-hold.ts'
    planted.append(inner)
    panel.append(planted)
    try {
      const clips = notDrawn(inner, m.host)
      expect(
        clips.map(describeClip),
        'the sensor found nothing wrong with a 40 px column',
      ).not.toEqual([])
      expect(clips[0]!.kind).toBe('cut')
      expect(clips[0]!.reach).toBe('never')
      expect(titleRecovers(inner, m.host), 'nothing was told, and the helper said it was').toBe(
        false,
      )
    } finally {
      planted.remove()
    }
  })

  /**
   * ⛔ **The title and the row cannot disagree about what the row says.** `rowTitle` composes the
   * path with the same three helpers the template branches on — `row.status`, `isNetUnchanged`,
   * `whyClosed` — and this is the only thing binding them.
   */
  it('⛔ every row’s title carries its path and whatever tag it drew', async () => {
    const m = await changesAt()
    const panel = m.q('session-changes')
    const rows = [...panel.querySelectorAll<HTMLElement>('button.row')]
    expect(rows.length, 'the fixture drew no rows').toBe(14)

    let tagged = 0
    for (const row of rows) {
      const pathText = words(row.querySelector('.path')!)
      const title = row.title
      expect(title, `${pathText} has no title`).not.toBe('')
      // ⚑ The name and the directory are both inside the title, which is what makes the pointer a
      // recovery for either half.
      expect(title, `${pathText}'s title is not about its path`).toContain(
        words(row.querySelector('.name')!),
      )
      const tag = row.querySelector('.tag')
      if (tag) {
        expect(title, `${pathText} drew “${words(tag)}” and its title does not say so`).toContain(
          words(tag),
        )
        tagged += 1
      }
    }
    // ⛔ The control: the corpus really exercises all three tag branches, or the loop above is
    // asserting about rows that have none.
    expect(tagged, 'no row drew a tag, so the title/tag claim is vacuous').toBeGreaterThan(8)
    const kinds = new Set(
      rows.flatMap((row) => [...row.querySelectorAll('.tag')].map((tag) => words(tag))),
    )
    expect([...kinds].sort()).toEqual([
      'deleted',
      'diff not kept — long report',
      'large diff — open in editor',
      'net unchanged',
      'no diff reported',
    ])
  })
})

/* ------------------------------------------------------------------ §4 nothing to show */

describe('541 §4 · what the tab reads when there is nothing in it', () => {
  /**
   * On a clean base, the empty tab still explains what belongs there, what will populate it,
   * and what the deferred press would do. Read all three at a usable text size so silence
   * cannot make the feature appear gone.
   */
  it('⛔ it says what it is, what would fill it, and what a rewind would do', async () => {
    const m = await changesAt(DRAWER_W_MIN, blank())
    const panel = m.q('session-changes')
    const empty = m.q('changes-empty')

    expect(words(m.q('changes-empty'))).toContain('No file changes in this conversation')
    expect(m.all('changes-files'), 'an empty tab drew a count').toHaveLength(0)

    const reading = tokenPx(ROLE_SIZE.prose, panel)
    for (const hook of ['.t', '.s'] as const) {
      const el = empty.querySelector<HTMLElement>(hook)!
      expect(px(el), `the empty state's ${hook} is not at the reading size`).toBe(reading)
      expect(notDrawn(el, m.host).map(describeClip), `the empty state's ${hook} is cut`).toEqual([])
    }

    // ⚑ The head note and the deferred foot are drawn on an empty tab too — the tab is not silent
    // about what it is just because it has nothing to list.
    expect(px(m.q('changes-revert-why'))).toBe(reading)
    expect(notDrawn(m.q('changes-revert-why'), m.host).map(describeClip)).toEqual([])
    expect(px(panel.querySelector<HTMLElement>('.note')!)).toBe(reading)

    // ⛔ …and every text on the empty tab is in the roster too, or the completeness walk only ever
    // answered for a populated one.
    const uncovered = textBearing(panel).filter((el) => rolesOf(el).length === 0 && !offScale(el))
    expect(uncovered.map(name), 'these are on the empty tab and in no role').toEqual([])
  })

  /**
   * ⚠️ **The empty state is about the SCOPE, and the two sentences are different offers** — a
   * conversation with changes in turn 1 and none in turn 4 is not *"no file changes in this
   * conversation"*. ⛔ So this mount is the one that can say the other sentence at all: a
   * conversation that HAS changed files, on a turn that has not.
   *
   * 🔴 **And this state is where `541` found something it was not sent for, recorded as a finding
   * rather than asserted here.** The head is `v-if="!blank"`, and `blank` is computed on the
   * SCOPED rows — so choosing *This turn* on a quiet turn removes the scope switch that chose it.
   * ⛔ Nothing below pins that, because an assertion pins what the code DOES and reads afterwards
   * like a ruling about what it MAY do.
   */
  it('⚑ …and the turn scope says something different from the conversation one', async () => {
    const state = createTranscript()
    const events: TranscriptEvent[] = [
      { type: 'user_turn', text: 'one' } as never,
      { type: 'file_change', changes: [FILES[11]], source: 'turn/diff/updated' } as never,
      { type: 'user_turn', text: 'two' } as never,
    ]
    events.forEach((event, index) => applyEvent(state, event, AT + index * 1000, index))

    const m = await changesAt(DRAWER_W_MIN, { state, shown: state })
    expect(m.all('changes-empty'), 'the whole conversation drew as empty').toHaveLength(0)
    m.q('changes-scope-turn').click()
    await nextTick()
    expect(words(m.q('changes-empty'))).toContain('No file changes in this turn')
    expect(px(m.q('changes-empty').querySelector<HTMLElement>('.t')!)).toBe(
      tokenPx(ROLE_SIZE.prose, m.q('session-changes')),
    )
  })
})
