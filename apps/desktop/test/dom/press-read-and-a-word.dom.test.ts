import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { DROPPED_OFF_THE_SCALE, DROPPED_TEXT } from '../../src/renderer/src/lib/drawer-tab-roles'
import { DRAWER_TABS, DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { ROLE_ORDER, ROLE_SIZE, type TextRole } from '../../src/renderer/src/lib/text-roles'
import type { ContextReading, CreatedSession, TranscriptEvent } from '../../src/shared/runtime-ipc'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import {
  drawerProps,
  META,
  mount,
  paneProps,
  record,
  unmountAll,
  visible,
  type Mounted,
} from './harness'

/**
 * 🔴 **529 · things you press, things you read, and a word that means the wrong thing.**
 *
 * ⛔ **Two rulings, both from `HO-050`, and neither is a redesign.**
 *
 * - **§1.2 · *Controls are things you press. Info is things you read.*** The blanket grants and
 *   the commander disclosure were neither pressable nor manageable and are on the Info surface
 *   now; the yolo disclosure stayed, because `514` F1 is *a caveat placed after the verdict
 *   argues with a decision the reader has already taken*.
 * - **§1.3 · the context meter leads with the consequence** — what is dropped, not the window
 *   arithmetic. ⚑ It was the Dropped tab, and is the Context popup since W4.208.
 *
 * ⚑ **And `526`'s lever applies to both**: every size on either surface names a ROLE, and the two
 * places the meter repeats a row sit in a line box declared as a fixed LENGTH, so what a row costs
 * stopped depending on the size of the text inside it.
 *
 * ## ⛔ Why this is per ELEMENT and in the engine, and not a source census
 *
 * ⚠️ **`389` asserted six `SessionShelf` cells with one `toContain` over one file and a mutation
 * on the fifth survived**, because three neighbours still carried the word it looked for. ⛔ And
 * `base.css` puts `font-size: var(--text-base)` on `body`, so a per-file `toContain('--text-sm')`
 * would pass over a tab where nothing was the size it claimed. ⚑ So: a real drawer, in Chromium,
 * with the shipped cascade, and every token resolved BY THE ENGINE WHERE THE ELEMENT SITS.
 */

/* ------------------------------------------------------------------ the corpus */

/**
 * ⚠️ **`NOT_ASKED_AGAIN` is `739`'s** (`730` F-1: the grants row's label), and this runner links
 * native modules — a static import of a name `main` does not export fails the WHOLE file there, every
 * control with it (`739` review #16). ⚑ So it is reached through `import.meta.glob`, awaited only
 * inside the one subject that pins it (§4), beside the literal it is typed as once, here.
 */
type GrantWords = typeof import('../../src/renderer/src/lib/standing-grants')
const GRANT_WORDS = import.meta.glob<GrantWords>('../../src/renderer/src/lib/standing-grants.ts')
/** ⚑ The label `739` gave the grants row — verbatim ONCE; §4's subject pins it by the export. */
const NOT_ASKED_AGAIN_WORDS = 'not asked again'

const AT = 1_700_000_000_000

/**
 * ⛔ **`525`'s fixture, rebuilt from its own list** — *three models, pending model/effort/plan
 * changes, pending approval change, four blanket grants, commander disclosure* — so every number
 * this file reports is comparable with the measurement it repairs.
 */
const LOUD: CreatedSession = {
  ...META,
  approvalMode: 'ask',
  pendingApprovalMode: 'auto',
  approvalNote: 'approvals: ask',
  blanketGrants: ['Bash', 'Write', 'Edit', 'WebFetch'],
  hasACommander: true,
  settings: {
    model: 'claude-opus-5',
    pendingModel: { value: 'claude-sonnet-5' },
    reasoningEffort: 'high',
    pendingReasoningEffort: { value: 'medium' },
    planMode: false,
    pendingPlanMode: null,
  },
}

const reading = (r: ContextReading): TranscriptEvent[] => [
  { type: 'context_reading', reading: r, source: 'thread/tokenUsage/updated' } as never,
]

const compaction = (id: string, before: number, after: number): TranscriptEvent =>
  ({ type: 'compaction', source: 'compact_boundary', id, at: AT, before, after }) as never

/** ⚑ `525`'s Dropped fixture: a live proportional reading and three compactions. */
const DROPPED_EVENTS: TranscriptEvent[] = [
  ...reading({ kind: 'proportional', used: 128_000, window: 200_000 }),
  compaction('c1', 180_000, 96_000),
  compaction('c2', 176_000, 88_000),
  compaction('c3', 172_000, 84_000),
]

/* ------------------------------------------------------------------ the instruments */

const px = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize)

const name = (el: Element): string =>
  (el as HTMLElement).dataset?.cy ?? `${el.tagName.toLowerCase()}.${el.className || '—'}`

/**
 * ⛔ **The token, resolved by the engine, in the place the element sits.** A planted `<span>` with
 * `font-size: var(--token)` takes the same cascade, the same scope and the same used-value
 * rounding the subject took, so the comparison is engine-to-engine — `getPropertyValue` would hand
 * back the authored token stream and never pass through `font-size` computation at all.
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

/** ⚑ `525`'s own counting rule, so every count below is comparable with its table. */
const textBearing = (root: HTMLElement): HTMLElement[] =>
  [root, ...root.querySelectorAll<HTMLElement>('*')].filter((el) => ownsText(el) && visible(el))

const rolesOf = (
  roster: readonly { selector: string; role: TextRole }[],
  el: Element,
): TextRole[] => roster.filter((entry) => el.matches(entry.selector)).map((entry) => entry.role)

const offScale = (el: Element): boolean =>
  DROPPED_OFF_THE_SCALE.some((entry) => el.matches(entry.selector))

/* ------------------------------------------------------------------ the mounts */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

/**
 * ⛔ **The DRAWER, not the panel bare.** These panels live in a 320–380 px column inside the
 * drawer's own scope, and a size read outside it is a size read somewhere the component never
 * sits. ⚑ `waiting: 3` puts the cross-tab attention bar on the strip, which is the state `525`
 * measured and the one that costs the body its 39 px — `921 = 1000 − 40 − 39`.
 */
async function drawerAt(
  tab: 'open' | 'info',
  over: Record<string, unknown> = {},
  width = 368,
): Promise<Mounted> {
  await page.viewport(1440, 1100)
  // ⛔ **Every number below is a wrap count in disguise**, and a wrap count depends on the font
  // actually being there: `base.css` loads Inter with `font-display: swap`.
  await document.fonts.ready
  const m = mount(
    SessionDrawer,
    drawerProps({
      tab,
      waiting: 3,
      session: LOUD,
      // ⚑ UI-012 · what the screen hands every live conversation: a model pick, carried out.
      pickModel: () => Promise.resolve(),
      capabilities: CAPABILITY_FIXTURE,
      // 🔴 **718 · the conversation behind the drawer** — `R60`'s "Compact now…" is offered on a live
      // idle one, so the foot measured here is the sentence a person reads beside a LIVE control,
      // and not the *no conversation to send it to* a drawer mounted alone would draw.
      compaction: LIVE_AND_IDLE,
      fit: 'docked',
      ...over,
    }),
    { width, height: 1000 },
  )
  await nextTick()
  await nextTick()
  return m
}

/**
 * 🔴 **W4.208 · the context meter, in its popup** — the drawer on its Open tab, and the card's
 * context figure pressed. ⚑ The meter is the Dropped tab's body, whole, so its rosters still answer
 * for every text on it.
 */
async function contextAt(over: Record<string, unknown> = {}): Promise<Mounted> {
  const m = await drawerAt('open', over)
  m.q('card-run-context').click()
  await nextTick()
  m.q('context-dialog')
  return m
}

/** ⚑ **718** — the facts `ConversationPane` hands the drawer for an idle, live conversation. */
const LIVE_AND_IDLE = {
  state: 'idle',
  closing: false,
  signInSuperseded: false,
  hasQueued: false,
  compactionIsWaiting: false,
  who: 'BroBot',
} as const

/** ⚑ **718 · the meter with `R60`'s question open** — the state the door's texts live in. */
async function withTheQuestionOpen(m: Mounted): Promise<Mounted> {
  m.q('context-compact-now').click()
  await nextTick()
  m.q('compact-door')
  return m
}

/**
 * ⛔ **Stamped, because `clockTime(undefined)` is an empty string.** `record()` folds events with
 * no `at`, so every compaction row's clock renders nothing, owns no text, and drops out of the
 * walk — the roster entry for `.hist-row .when` then matches nothing and the completeness check
 * passes over an element that is really there. ⚠️ Found by the roster's own both-directions half.
 */
const withHistory = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const state = createTranscript()
  DROPPED_EVENTS.forEach((event, index) => applyEvent(state, event, AT + index * 60_000, index))
  return { state, shown: state, ...over }
}

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/* ------------------------------------------------------------------ §1 the rosters */

describe('529 §1 · each roster answers for every text on its tab, and for nothing else', () => {
  it('⛔ Dropped · every visible text matches exactly one role, or is listed off the scale', async () => {
    // ⚑ **718 · with `R60`'s question OPEN**, so the door's four texts are in the walk as well.
    const m = await withTheQuestionOpen(await contextAt(withHistory()))
    const panel = m.q('session-context')
    const drawn = textBearing(panel)

    expect(drawn.length, '525 counted 27 here; this drew almost nothing').toBeGreaterThan(20)

    const uncovered = drawn.filter((el) => rolesOf(DROPPED_TEXT, el).length === 0 && !offScale(el))
    expect(uncovered.map(name), 'these are on the tab and in no role').toEqual([])
    for (const el of drawn.filter((el) => !offScale(el))) {
      expect(rolesOf(DROPPED_TEXT, el), `${name(el)} is in more than one role`).toHaveLength(1)
    }

    // ⛔ …and the exemption is honoured rather than skipped: it is on the tab, it is counted, and
    // it is strictly LOUDER than reading text. An off-scale size that drifted below `prose` would
    // be the defect wearing an exemption.
    for (const entry of DROPPED_OFF_THE_SCALE) {
      const found = [...panel.querySelectorAll<HTMLElement>(entry.selector)].filter(visible)
      expect(found.length, `${entry.selector} is listed off the scale and drew nothing`).toBe(1)
      expect(drawn, 'the off-scale element is not even in the walk').toContain(found[0])
      expect(px(found[0]!)).toBeGreaterThan(tokenPx(ROLE_SIZE[entry.largerThan], found[0]!))
    }
  })

  it('⚑ …and every Dropped entry matches something across the states the tab has', async () => {
    // ⛔ The empty history draws `.none` and no rows; the populated one draws the rows and the
    // reclaim chip. Neither state alone covers the roster. ⚑ **718** — and the door's texts exist
    // only while `R60`'s question is open, so the populated state is measured with it open; the
    // foot's bold lead exists only where the press is WITHHELD, so a conversation taking up a change
    // is a third (⚑ D-017b: it was an ENDED one, and nothing is ended now — every one takes it).
    const states = [
      withHistory(),
      {},
      { ...withHistory(), compaction: { ...LIVE_AND_IDLE, closing: true } },
    ]
    const matched = new Set<string>()
    for (const over of states) {
      const m = await contextAt(over)
      if (over === states[0]) await withTheQuestionOpen(m)
      const panel = m.q('session-context')
      for (const entry of DROPPED_TEXT) {
        if ([...panel.querySelectorAll(entry.selector)].some((el) => visible(el))) {
          matched.add(entry.selector)
        }
      }
      m.unmount()
    }
    const unused = DROPPED_TEXT.filter((entry) => !matched.has(entry.selector))
    expect(
      unused.map((entry) => entry.selector),
      'these roles match nothing on any state',
    ).toEqual([])
  })
})

/* ------------------------------------------------------------------ §2 the sizes */

describe('529 §2 · each element reads at its role’s token', () => {
  it('🔴 Dropped, element by element, resolved where it sits', async () => {
    // ⚑ **718 · across the states the tab's texts live in** (`718`'s review): the confirm's texts
    // exist only while `R60`'s question is open, and the foot's bold lead only where the press is
    // withheld — so one mount measured neither, and every entry must be measured at least once.
    const states: { over: Record<string, unknown>; open: boolean }[] = [
      { over: withHistory(), open: true },
      // ⚑ **D-017b** — withheld by a change being taken up; an `ended` state withholds nothing now.
      { over: { ...withHistory(), compaction: { ...LIVE_AND_IDLE, closing: true } }, open: false },
      // ⚑ …and an empty history, where `.none` is the whole of what the history says.
      { over: {}, open: false },
    ]
    let measured = 0
    const seen = new Set<string>()
    for (const state of states) {
      const m = await contextAt(state.over)
      if (state.open) await withTheQuestionOpen(m)
      const panel = m.q('session-context')
      for (const entry of DROPPED_TEXT) {
        for (const el of [...panel.querySelectorAll<HTMLElement>(entry.selector)].filter(visible)) {
          expect(px(el), `${name(el)} (${entry.role}) is not on ${ROLE_SIZE[entry.role]}`).toBe(
            tokenPx(ROLE_SIZE[entry.role], el),
          )
          measured += 1
          seen.add(entry.selector)
        }
      }
      m.unmount()
    }
    expect(measured, 'the sweep touched too little to be one').toBeGreaterThan(20)
    expect(
      DROPPED_TEXT.filter((entry) => !seen.has(entry.selector)).map((entry) => entry.selector),
      'these roles were measured on no state',
    ).toEqual([])
  })

  /**
   * 🔴 **The assertions above compare `ROLE_SIZE` with itself, and this one does not.**
   *
   * ⛔ **A per-element equality is blind to every edit of `ROLE_SIZE` by construction** — both
   * sides read the map, so putting every role back on `--text-6xs` passes all of it. ⚑ So the
   * floors are typed HERE, in the test: this is the only place in the repo that does not read
   * `ROLE_SIZE` to find out what `ROLE_SIZE` should be. ⚠️ They are FLOORS and not equalities:
   * raising a role is a decision somebody can make without touching this file; lowering one is
   * the drift `525` measured, and it cannot.
   */
  it('🔴 no role may drift DOWN — floors that do not come from the map they check', async () => {
    const m = await contextAt(withHistory())
    const panel = m.q('session-context')

    const FLOOR: Record<TextRole, number> = {
      // `tokens.css` §9: reading lives at 11-12 px, and the yolo disclosure is a safety sentence.
      prose: 11,
      // The step `tokens.css` itself calls the *DEFAULT UI label & button text*.
      label: 10,
      // §9's own floor: *"sizes < 9px are micro-labels/badges/table-heads only."*
      value: 9,
      // The micro end — a clock, an axis, a queued change.
      meta: 8,
      // ⛔ The bottom of the scale, and the ONE role allowed here: *tiny uppercase field labels*
      // is what `--text-6xs`'s own line says it is for. One step below is `--text-7xs`.
      field: 7.5,
    }

    for (const role of ROLE_ORDER) {
      expect(
        tokenPx(ROLE_SIZE[role], panel),
        `${role} is on ${ROLE_SIZE[role]}, below the floor these tabs were repaired to`,
      ).toBeGreaterThanOrEqual(FLOOR[role])
    }

    // ⚑ The control: the floors are not satisfied by everything. ⚑ Since the app-wide look no token
    // is under 12 px (`--text-7xs` is the caption too), so the control plants a size that is.
    panel.style.setProperty('--probe-under', '7px')
    const under = tokenPx('--probe-under', panel.firstElementChild!)
    panel.style.removeProperty('--probe-under')
    for (const role of ROLE_ORDER) expect(under).toBeLessThan(FLOOR[role])
  })

  /**
   * 🔴 **…and the stylesheets actually GO THROUGH the bridge, which nothing else asks.**
   *
   * ⛔ **Hard-code every size back to a `--text-*` and §2 still passes**, because it compares the
   * element against `ROLE_SIZE` and both would agree. ⚠️ Worse for `prose`: `base.css` puts
   * `--text-base` on `body`, so deleting `font-size` from a prose rule changes nothing a size
   * assertion can see. ⚑ Driving the custom property and watching the elements MOVE is the only
   * reading that can tell.
   */
  it.each([
    {
      hook: 'session-context',
      roster: DROPPED_TEXT,
      // ⚑ **718** — with `R60`'s question open, so the confirm's texts are wired-through too.
      open: async () => withTheQuestionOpen(await contextAt(withHistory())),
    },
  ])(
    '🔴 $hook · every role is wired THROUGH --role-*, or the module decides nothing',
    async ({ hook, roster, open }) => {
      const m = await open()
      const panel = m.q(hook)

      // ⛔ **Every element carrying the bridge, not only the panel's root.** A child component that
      // names a role declares `ROLE_PROPERTIES` on its OWN root, so a child's inline property beats
      // the parent's and driving only the outer one would move nothing inside it.
      const carriers = [panel, ...panel.querySelectorAll<HTMLElement>('[style*="--role-"]')]
      expect(carriers.length, 'nothing on this tab carries the bridge').toBeGreaterThan(0)

      for (const role of ROLE_ORDER) {
        const wearers = roster
          .filter((entry) => entry.role === role)
          .flatMap((entry) =>
            [...panel.querySelectorAll<HTMLElement>(entry.selector)].filter(visible),
          )
        if (wearers.length === 0) continue

        // ⚠️ **Put back, never removed.** The property is an INLINE style Vue wrote from
        // `ROLE_PROPERTIES`, and Vue does not re-apply it until the component re-renders —
        // `removeProperty` would strip the bridge for the rest of the mount and the elements would
        // fall back to `body`'s `--text-base`. Which is itself the finding: 11.5 px looks exactly
        // like a working `prose`.
        const authored = carriers.map((el) => el.style.getPropertyValue(`--role-${role}`))
        expect(authored[0], `--role-${role} is not an inline property of ${hook}`).not.toBe('')
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
    },
  )

  it('⚑ …and the sweep is proven by VIOLATING it', async () => {
    const m = await contextAt(withHistory())
    const panel = m.q('session-context')
    const floor = tokenPx('--text-3xs', panel)

    // ⛔ A sweep nobody has made fail is a sweep nobody has measured. `--text-6xs` is where `525`
    // found this tab's smallest prose, planted on the path the walk takes.
    const planted = document.createElement('p')
    planted.textContent = 'the tab as 525 measured it'
    // ⚑ A literal: since the app-wide look `--text-6xs` is the 12 px caption, not 525's 7.5 px.
    planted.style.fontSize = '7.5px'
    panel.append(planted)
    try {
      const caught = textBearing(panel).filter(
        (el) => px(el) < floor && rolesOf(DROPPED_TEXT, el).length === 0 && !offScale(el),
      )
      expect(caught).toHaveLength(1)
      expect(caught[0]).toBe(planted)
    } finally {
      planted.remove()
    }
  })
})

/* ------------------------------------------------------------------ §3 the scale */

/**
 * ⚑ **The app-wide look set a 12 px floor**, so the three quietest roles — value, meta and field —
 * now share the caption size, and tell themselves apart by weight and colour. ⛔ What still holds:
 * the roles run loudest first, the two reading roles stay distinct above the caption, and nothing
 * drops below the floor.
 */
describe('529 §3 · five roles, loudest first, none under the floor', () => {
  it('⛔ the vocabulary is a scale and not one value repeated', async () => {
    const m = await contextAt(withHistory())
    const panel = m.q('session-context')

    // 389's distinctness control: a vocabulary whose roles all name one token passes every
    // per-element equality for the wrong reason.
    const sizes = ROLE_ORDER.map((role) => tokenPx(ROLE_SIZE[role], panel))
    expect(new Set(sizes).size, `the roles collapsed onto one size: ${sizes.join(', ')}`).toBe(3)
    for (let i = 1; i < sizes.length; i += 1) {
      expect(sizes[i]!, `${ROLE_ORDER[i]} is louder than ${ROLE_ORDER[i - 1]}`).toBeLessThanOrEqual(
        sizes[i - 1]!,
      )
    }
    expect(sizes[1]!, 'label is not quieter than prose').toBeLessThan(sizes[0]!)
    expect(sizes[2]!, 'value is not quieter than label').toBeLessThan(sizes[1]!)
    expect(Math.min(...sizes), 'a role is under the 12 px floor').toBeGreaterThanOrEqual(12)
    // ⛔ …and WHICH five, typed rather than derived from the thing it checks.
    expect([...ROLE_ORDER]).toEqual(['prose', 'label', 'value', 'meta', 'field'])
  })

  it('⛔ and the page default is not what makes prose look right', async () => {
    const m = await contextAt(withHistory())
    const panel = m.q('session-context')
    // `base.css` puts `--text-base` on `body`. An element that INHERITS is indistinguishable from
    // one that declares `prose` — so the control is an element on the page that declares nothing,
    // and it must read the body size while a prose element reads its role.
    const bare = document.createElement('span')
    bare.textContent = 'x'
    document.body.append(bare)
    try {
      expect(px(bare)).toBe(tokenPx('--text-base', panel))
      const lede = panel.querySelector<HTMLElement>('.ctx-note')
      expect(lede, 'the meter drew no note').not.toBeNull()
      // ⚑ They agree today — which is exactly why the bridge test above exists and this one
      // cannot be the whole claim. What this pins is that `prose` IS the reading size.
      expect(px(lede!)).toBe(px(bare))
    } finally {
      bare.remove()
    }
  })
})

/* ------------------------------------------------------------------ §4 the split */

describe('529 §4 · things you press stayed within reach of the conversation', () => {
  /**
   * ⛔ **§1.2's own words: *live adjustments to a running conversation, and they belong within
   * reach of it*.** So the claim is not that the four controls exist somewhere — it is that they
   * are on screen WITH the transcript, in one pane, at the width the app actually opens at.
   */
  it('🔴 model, effort, plan and approval mode are reachable without leaving the transcript', async () => {
    await page.viewport(1440, 1100)
    await document.fonts.ready
    const conversation = record([])
    conversation.meta = {
      ...META,
      settings: { ...META.settings, model: 'claude-opus-5', reasoningEffort: 'high' },
    }
    const m = mount(
      ConversationPane,
      paneProps({
        record: conversation,
        drawerOpen: true,
        drawerTab: 'open',
        pickModel: () => Promise.resolve(),
        capabilities: CAPABILITY_FIXTURE,
      }),
      { width: 1200 },
    )
    await nextTick()

    // ⚑ The transcript is still there and still has width — a drawer that took the column would
    // satisfy every assertion below and would have left the conversation.
    const surface = m.q('reading-surface')
    expect(visible(surface)).toBe(true)
    expect(surface.getBoundingClientRect().width).toBeGreaterThan(560)

    // ⚑ On the agent card: the model and its effort open the one model picker, and plan first and
    // the approval mode sit beside them.
    for (const hook of ['card-run-model', 'card-run-effort', 'card-run-plan', 'card-approval']) {
      const el = m.q(hook)
      expect(visible(el), `${hook} is not on screen beside the transcript`).toBe(true)
      expect((el as HTMLButtonElement).disabled ?? false, `${hook} is disabled`).toBe(false)
      // ⛔ …and inside the pane, not floating somewhere else in the document.
      expect(m.q('conversation-pane').contains(el)).toBe(true)
    }
  })

  /**
   * 🔴 **The ruling's exception, as a measurement rather than a comment** (`HO-050` §1.2,
   * `514` F1).
   */
  it('the approved mode switch replaces the old confirmation popup', async () => {
    const m = await drawerAt('open')
    const toggle = m.q('card-approval')
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.parentElement?.title).toContain('next message')
    expect(m.all('card-approval-panel')).toHaveLength(0)
  })

  /** ⚑ The label the Info grants row really wears — read off the row the drawer drew. */
  const grantsLabelOf = (info: Mounted): string =>
    info.q('info-grants').closest('dd')?.previousElementSibling?.textContent?.trim() ?? ''

  it('⛔ the two read-only facts are on Info, and are not on the card that holds the controls', async () => {
    const controls = await drawerAt('open')
    const panel = controls.q('session-panel')
    // ⚠️ **739 · re-aimed, not stripped** (rule 26): this asked for *always allowed*, `main`'s label
    // for the grants row; `739` relabels it *not asked again* (`730` F-1), so a fixed word would go
    // vacuous on one tree or the other. ⚑ It asks for the label the row REALLY wears — read off
    // Info below, whichever tree — so the negative is about the row on both (`739` review #16).
    const controlsSay = panel.textContent ?? ''
    expect(controlsSay).not.toContain('another caller')
    expect(controls.all('info-grants')).toHaveLength(0)
    expect(controls.all('info-has-a-commander')).toHaveLength(0)
    // …and the tab really rendered, so the four negatives are about the blocks.
    expect(visible(controls.q('card-approval'))).toBe(true)
    controls.unmount()

    // ⛔ **On `527`'s index, in its own register** (relay 1). The rows wear
    // `what-survives-the-conversation.ts`'s roles, not this dispatch's — one surface, one
    // vocabulary — so what 529 asserts here is that they are PRESENT, that the sentence is behind
    // the fold, and that the `ended` gate came across. The sizes and the subject are `527`'s
    // roster's, in `the-thread-a-person-does-not-leave.dom.test.ts`.
    const info = await drawerAt('info')
    expect(visible(info.q('info-grants'))).toBe(true)
    // ⚑ The positive for the negative: the label is drawn HERE, over the row — and not on the card.
    const label = grantsLabelOf(info)
    expect(label.length, 'the grants row wears no label').toBeGreaterThan(3)
    expect(controlsSay, `the card still says "${label}"`).not.toContain(label)
    expect(visible(info.q('info-has-a-commander'))).toBe(true)
    // ⚑ The index stays an index: the 484-character sentence is behind a fold, not on the line.
    expect(info.all('info-note-commander')).toHaveLength(0)
    info.q('info-why-commander').click()
    await nextTick()
    expect(info.q('info-note-commander').textContent ?? '').toContain('cannot answer')
    info.unmount()

    // ⚑ **D-017b · …and the commander row is NOT gated on whether anything runs it** — it was
    // gated on `ended`, and nothing is ended now: a message from that caller starts the
    // conversation, so the capability it names is there either way. Measured on a view drawn from
    // its ledger (`recorded`), beside the grants row that was always drawn there.
    const over = await drawerAt('info', { recorded: true, fixed: true })
    expect(visible(over.q('info-has-a-commander'))).toBe(true)
    expect(visible(over.q('info-grants')), 'a grant that happened stays true after a stop').toBe(
      true,
    )
  })

  it('🔴 739 · the grants row on Info wears *not asked again* — never *always allowed* (`730` F-1)', async () => {
    const info = await drawerAt('info')
    expect(visible(info.q('info-grants'))).toBe(true)
    // ⛔ `main` 5f406f2f: *"always allowed"* — false of every conversation grant on the list.
    expect(grantsLabelOf(info)).toBe(NOT_ASKED_AGAIN_WORDS)
    // ⚑ rule 5 — the row draws the export, read only here (see the corpus note).
    const load = Object.values(GRANT_WORDS)[0]
    if (load === undefined) throw new Error('`lib/standing-grants.ts` is not on this tree')
    expect((await load()).NOT_ASKED_AGAIN).toBe(NOT_ASKED_AGAIN_WORDS)
  })
})

/* ------------------------------------------------------------------ §5 the word */

describe('529 §5 · the strip still fits', () => {
  it('🔴 the strip still fits at its floor with every tab active, and Changes is still the widest', async (ctx) => {
    // ⚠️ **darwin only** (T-001): it measures where the Mac's fonts break a line; Linux draws other fonts.
    // CI runs on Linux and skips it; the Mac's own gate runs it. (A browser has no `process`.)
    ctx.skip(!/mac/i.test(navigator.platform))
    await page.viewport(1440, 1100)
    await document.fonts.ready
    const widths: Record<string, number> = {}
    for (const tab of DRAWER_TABS) {
      const m = mount(SessionDrawer, drawerProps({ tab: tab.id, fit: 'docked', session: LOUD }), {
        width: DRAWER_W_MIN,
        height: 1000,
      })
      await nextTick()
      const strip = m.q('drawer-tabs')
      expect(
        strip.scrollWidth,
        `the strip overflows at ${DRAWER_W_MIN} with ${tab.label} active`,
      ).toBeLessThanOrEqual(strip.clientWidth)
      widths[tab.id] = m.q(`drawer-tab-${tab.id}`).getBoundingClientRect().width
      m.unmount()
    }

    // 🔴 **The control 508's headroom test needs and cannot state for itself.** It pins
    // `start: 'changes'` as the worst case; a label wider than `Changes` would leave that
    // assertion measuring the SECOND widest layout and passing for the wrong reason —
    // `a-comparison-tested-where-both-sides-agree-measures-nothing`.
    const widest = Object.entries(widths).sort((a, b) => b[1] - a[1])[0]!
    expect(widest[0], `${widest[0]} is now the widest active tab, not changes`).toBe('changes')
  })

  it('⛔ no component spells the label; the strip reads it off the table', async () => {
    const m = await drawerAt('info')
    const label = m.q('drawer-tab-info').querySelector('.tab-label')
    expect(label?.textContent?.trim()).toBe(DRAWER_TABS.find((t) => t.id === 'info')!.label)
    // ⚑ Exactly one tab wears a label at a time (088), so this really is the active one.
    expect(m.q('drawer-tabs').querySelectorAll('.tab-label')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ §6 the scroll cost */

/**
 * ⛔ **`525`'s method, as a standing ceiling rather than a one-off reading.** It measured both
 * tabs at exactly **1.00 screens** — `921 / 921` at 368×1000 — which means the content FITTED and
 * says nothing about how much room was left. ⚑ So the numbers pinned here are the CONTENT
 * heights, which is the reading a ratio of 1.00 hides, alongside the ratio `525` published.
 */
describe('529 §6 · legible did not cost a screen', () => {
  // ⚑ **W4.208 · the meter is a popup now**, as wide whatever the drawer's width.
  it('⛔ the Context popup still fits one screen', async () => {
    const m = await contextAt(withHistory())
    const body = m.q('context-dialog').querySelector<HTMLElement>('.list-body')!
    expect(body.scrollHeight / body.clientHeight).toBe(1)
    expect(m.q('session-context').getBoundingClientRect().height).toBeGreaterThan(400)
  })

  /**
   * ⚑ **`526`'s lever, measured rather than described.** A compaction row's line box is a fixed
   * LENGTH, so the row costs the same whatever size the text on it is — which is what let the
   * jump affordance go up to `label` without the history getting taller.
   */
  it('🔴 a compaction row costs the same whatever size its text is', async () => {
    const m = await contextAt(withHistory())
    const panel = m.q('session-context')
    const rows = [...panel.querySelectorAll<HTMLElement>('.hist-row')]
    expect(rows.length, 'no history drew').toBe(3)
    const before = rows.map((r) => r.getBoundingClientRect().height)
    expect(new Set(before.map((h) => h.toFixed(3))).size, 'the rows are not one height').toBe(1)

    /**
     * ⛔ **Driven to the sizes this row HAD, and to a step above the ones it has** — not to an
     * absurd one. ⚠️ At 23 px the clock wraps to a second line and the row really does grow, and
     * that is a fact about `white-space` rather than about the line box: a first version of this
     * test drove both roles to 23 px, watched the row go 27 → 38 and would have reported `526`'s
     * lever as broken. ⚑ What the lever claims is that the row costs the same ACROSS THE SIZES
     * THE ROLES TAKE, and these are the four it has ever taken — 8/8.5 before 529, 8/9/10.5
     * after, and one step above.
     */
    const drive = (label: string, value: string, meta: string): number[] => {
      panel.style.setProperty('--role-label', label)
      panel.style.setProperty('--role-value', value)
      panel.style.setProperty('--role-meta', meta)
      return rows.map((r) => r.getBoundingClientRect().height)
    }
    try {
      // The sizes `525` measured on this row: the clock 8.5, everything else 8.
      expect(drive('8px', '8px', '8.5px'), 'the row shrank back to its pre-529 height').toEqual(
        before,
      )
      // …and a step above the ones it has now.
      expect(drive('11.5px', '11px', '9px'), 'a bigger role made the history taller').toEqual(
        before,
      )
      // ⛔ The control: the text really is following the properties, so the two equalities above
      // are about the row and not about a drive that moved nothing.
      expect(px(panel.querySelector('.hist-row .jump')!)).toBe(11.5)
      expect(px(panel.querySelector('.hist-row .amt')!)).toBe(11)
    } finally {
      drive(`var(${ROLE_SIZE.label})`, `var(${ROLE_SIZE.value})`, `var(${ROLE_SIZE.meta})`)
    }
  })
})
