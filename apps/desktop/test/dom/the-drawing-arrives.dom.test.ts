import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import SessionTools from '../../src/renderer/src/components/SessionTools.vue'
import { useSpawnSafety } from '../../src/renderer/src/lib/spawn-safety'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentities } from '../../src/shared/runtime-ipc'
import type { ToolRegistry } from '../../src/renderer/src/lib/transcript'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **455 · the v2.7 delivery's geometry, measured in OUR window.**
 *
 * The delivery claims **220px panel clearance and a 210px lane, measured at 1180, 1200 and 1440**,
 * and `455 §2.2` rules those *"ours to verify against our own window"*. ⛔ **Two of the delivery's
 * three numbers were verifiable at one width.**
 *
 * ⚑ **The lane's 210 was already well held** — `persons-queue.dom.test.ts` §1 pins `left 10`,
 * `width 200` and `right 210` by equality at 1440, 1200 AND 1180, with a sheet open. ⚠️ A first
 * draft of this docblock said 1440 was *"asserted by nothing at all"*, which was false of the
 * lane; it is re-measured here only because the join between the two files is where a drift that
 * moved the SHEET alone could hide.
 *
 * ⛔ **What genuinely had no assertion is the PANEL.** `444` pinned `sheet.width === 740` at
 * **1180 only**; `760` appears in no dom test; `sheet.left` is asserted at no width; and `940` —
 * the cap the delivery's third width is entirely about — appears only inside a `Math.min` at 1180,
 * where it does not bind.
 *
 * ## ⚠️ What this file adds that `session-tools.dom.test.ts` deliberately does not
 *
 * That file is about the SAFETY property — *does a sheet cover the stop* — and its `>=`s are the
 * right shape for it. ⛔ This one is about the NUMBERS the delivery names, in ONE mount so a drift
 * that moved only the sheet at 1440 cannot hide in the join between two files.
 *
 * ## 🔒 The scrollbar, which `455 §2.2` names
 *
 * *"The dom runner draws overlay scrollbars where the real window draws 11px, so measure the thing
 * and not the runner."* ⚑ **On the WIDTH axis the shipped window cannot draw one either**, and §2
 * pins the RULE that makes that true rather than its consequence: `base.css` puts
 * `overflow: hidden` on `html, body`, which propagates to the viewport, so the document never
 * scrolls horizontally and `documentElement.clientWidth` is the window. ⚠️ **The 11px is real on
 * the HEIGHT axis** — `#app` is `overflow-x: auto; scrollbar-width: thin`, and
 * `app-frame-reachable.dom.test.ts` stands the bar in there and pins `#app`'s three declarations.
 * ⛔ §3 shows what it would cost if the premise broke: eleven pixels off the window is eleven off
 * the panel, one for one.
 *
 * ⛔ **And the premise is MEASURED elsewhere, because it cannot be measured here.** This runner
 * draws overlay bars, so `clientWidth === innerWidth` holds whatever `base.css` says — the
 * comparison below is a recorded premise, not a detector. `pnpm run probe:lane-geometry` reads
 * both axes in a real Electron window at four widths, and at the one under `--app-min-w` the
 * height axis reads **11** while the width axis reads **0**: the control that makes the zero
 * mean something.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
const safety = useSpawnSafety()

const IDENTITIES: AgentIdentities = {
  identities: [
    {
      id: 'agp:default:pm',
      slug: 'pm',
      displayName: null,
      createdAt: 0,
      // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
      createdBy: null,
      provider: null,
      // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
      externalMcpServerIds: [],
      capabilities: { ...DEFAULT_CAPABILITIES },
      chosen: {
        maxDepth: 'default',
        canMessage: 'default',
        canAssignWork: 'default',
        canCreateAgents: 'default',
        canWriteRules: 'default',
      },
    },
  ],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
}

/** ⚑ Nothing reported. The sheet's WIDTH rule does not depend on what is in it, and this file is
 *  about the width rule; a fixture with rows would add a reason for the number to move. */
const NOTHING: ToolRegistry = { set: null, dropped: 0, at: null }

const Sheet = defineComponent({
  name: 'ToolsSheetUnderMeasurement',
  props: { tools: { type: Object as PropType<ToolRegistry>, required: true } },
  setup: (props) => () =>
    h(
      OverlayHost,
      { label: 'A sheet' },
      { default: () => [h(SessionTools, { tools: props.tools })] },
    ),
})

beforeEach(() => {
  safety.supply(IDENTITIES, () => {})
})

afterEach(async () => {
  unmountAll()
  safety.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

async function at(width: number, height = 808) {
  await page.viewport(width, height)
  // ⚠️ 10px, so the host div cannot be the thing supplying the width — `OverlayHost` is `fixed`.
  const m = mount(Sheet, { tools: NOTHING }, { width: 10, height: 10 })
  await nextTick()
  const panel = m.q('session-tools')
  return {
    lane: m.q('overlay-spawning').getBoundingClientRect(),
    sheet: panel.getBoundingClientRect(),
    /** The element, for the one assertion that reads the RULE rather than the rectangle. */
    panel,
  }
}

const round = (n: number): number => Math.round(n)

/**
 * The three widths the delivery names, and what our own tokens make of each.
 *
 * ⛔ **Typed as literals, not computed from `--lane-clear`.** A row written
 * `width - 2 * clearance` would move with the token it is meant to pin —
 * `a-bound-written-as-the-constant-cannot-pin-it` — and the whole point is that these three numbers
 * are the ones the delivery reported and a person can read off a screen.
 */
const WIDTHS = [
  { window: 1180, left: 220, sheet: 740, capBinds: false },
  { window: 1200, left: 220, sheet: 760, capBinds: false },
  { window: 1440, left: 250, sheet: 940, capBinds: true },
] as const

/* ────────────────────────── §1 · the lane and the sheet, one mount, three widths ── */

describe('§1 · 210 / 220 and the panel widths, by equality, at all three', () => {
  for (const geometry of WIDTHS) {
    it(`🔴 at ${String(geometry.window)}px the lane occupies 210 and the panel is ${String(geometry.sheet)}`, async () => {
      const { lane, sheet, panel } = await at(geometry.window)

      // The lane: `--space-5` of gutter, `--lane-w` of column, and the band they make.
      expect(round(lane.left), 'the lane left its gutter').toBe(10)
      expect(round(lane.width), 'the lane is not --lane-w wide').toBe(200)
      expect(round(lane.right), 'the lane no longer OCCUPIES 210').toBe(210)

      // The panel: the two numbers a person sees.
      // ⚠️ `left` is a CLEARANCE at 1180 and 1200 and centring RESIDUE at 1440, where the cap
      // decides the width — the message says which rather than calling 250 a clearance.
      expect(
        round(sheet.left),
        geometry.capBinds ? 'the panel is off centre' : 'the panel’s clearance moved',
      ).toBe(geometry.left)
      expect(round(sheet.width), 'the panel’s width moved').toBe(geometry.sheet)

      // ⛔ **The RULE, read rather than reproduced.** Every rectangle above survives replacing
      // `var(--lane-clear)` with a literal `220px`; this line does not, and it is the only place
      // in this file where the derivation itself is visible.
      expect(getComputedStyle(panel).width, 'the panel is no longer sized by the rule').toBe(
        `${String(geometry.sheet)}px`,
      )
      // ⚑ **A custom property resolves to its TOKEN TEXT, not to a length** — which is what makes
      // this the derivation assertion: the engine hands back the `calc` with `--space-5` and
      // `--lane-w` already substituted, so a literal `220px` in `tokens.css` reads differently
      // here even though every rectangle above is unchanged.
      expect(
        getComputedStyle(document.documentElement)
          .getPropertyValue('--lane-clear')
          .replace(/\s+/g, ' ')
          .trim(),
        'the clearance stopped being derived from the lane',
      ).toBe('calc(10px + 200px + 10px)')
    })
  }

  /**
   * ⛔ **Which number is deciding, at each width** — the control for §1, and the reason `444`
   * declined to pin the 10px step at 1440.
   *
   * At 1180 and 1200 the GUTTER decides and the gap past the lane is one `--space-5`. At 1440 the
   * CAP decides, the gap is 40, and a test that pinned 10 there would have been pinning the cap
   * while claiming to pin the ladder.
   */
  it('⚠️ the gutter decides at 1180 and 1200; the 940 cap decides at 1440', async () => {
    for (const geometry of WIDTHS) {
      const { lane, sheet } = await at(geometry.window)
      const gap = round(sheet.left) - round(lane.right)
      expect(gap, `at ${String(geometry.window)} the gap past the lane`).toBe(
        geometry.capBinds ? 40 : 10,
      )
      expect(
        round(sheet.width) < geometry.window - 2 * 220,
        `at ${String(geometry.window)} the cap ${geometry.capBinds ? 'should' : 'should not'} bind`,
      ).toBe(geometry.capBinds)
      unmountAll()
    }
  })
})

/* ──────────────────── §2 · the reference the numbers are measured against is the WINDOW ── */

describe('§2 · the viewport is the window, not a scrolled box', () => {
  /**
   * ⚑ **A recorded premise, not a detector — and saying which is the point.** Every other geometry
   * test in this directory reads `document.documentElement.clientWidth` AS the viewport, so a bar
   * eating width would move the reference and the subject together and be invisible. ⛔ **This
   * runner cannot make that happen**: its bars are overlay bars and take nothing out of
   * `clientWidth`, so the comparison below holds whatever `base.css` says. ⚠️ What it records is
   * the state the shipped window must also be in — and `probe:lane-geometry` is where that is
   * actually read, in a real window, against a control that fires.
   */
  it('⚑ clientWidth is innerWidth is the width that was asked for', async () => {
    for (const geometry of WIDTHS) {
      await at(geometry.window)
      expect(window.innerWidth, 'page.viewport did not give the width it was asked for').toBe(
        geometry.window,
      )
      expect(
        document.documentElement.clientWidth,
        'something is taking width out of the document',
      ).toBe(window.innerWidth)
      unmountAll()
    }
  })

  it('⛔ the document cannot scroll sideways, which is the rule that makes the above hold', async () => {
    await at(1180)
    // ⚑ **The RULE, not its consequence.** `base.css` puts this on `html, body`; overflow on the
    // root propagates to the viewport, so no classic vertical bar can exist to take 11px out of a
    // `position: fixed` host's 100%. ⚠️ Deleting that declaration is what this pins, and it is the
    // ONLY line here that does — `scrollWidth === clientWidth` holds in a document whose content
    // is a 10px box whether the declaration is `hidden` or `auto`, so it is not asserted.
    expect(getComputedStyle(document.documentElement).overflow).toBe('hidden')
    // ⛔ **The other half of the premise is `#app`'s, and it is NOT measured here**: this mount
    // appends straight to `document.body`, while in the app `OverlayHost` sits under `#app`.
    // `app-frame-reachable.dom.test.ts` pins `#app`'s `overflow-x: auto`, `overflow-y: hidden`
    // and `scrollbar-width: thin`, and that an ancestor with `overflow` is not a containing block
    // for a fixed descendant. ⚠️ Named rather than duplicated, so the gap is on the record.
  })
})

/* ──────────────────────────────────── §3 · what eleven pixels would cost, if it could happen ── */

describe('§3 · the panel width is a function of the window, one pixel for one', () => {
  /**
   * ⚠️ **The runner draws OVERLAY scrollbars and the shipped window draws an 11px classic one** —
   * measured at `338`, recorded at `app-frame-reachable.dom.test.ts` as `const BAR = 11`. ⛔ So no
   * assertion in this project can make a bar take width. What it CAN do is take the same eleven
   * pixels off the window and show the panel follow, which is what says out loud that §1's 740
   * depends on §2's premise rather than on the number 740.
   */
  it('🔴 eleven fewer pixels of window is eleven fewer of panel', async () => {
    const full = await at(1180)
    unmountAll()
    // ⛔ **The LITERAL, not a constant this test also fed in.** A `BAR` used as both the input and
    // the expected value is an identity that passes for any number
    // (`a-bound-written-as-the-constant-cannot-pin-it`) — `app-frame-reachable.dom.test.ts` makes
    // the same point about the same 11. ⚑ **11 is what the shipped window measures**, at `338` and
    // again in `probe:lane-geometry`'s control row.
    const short = await at(1169)
    expect(round(full.sheet.width) - round(short.sheet.width), 'the panel did not follow').toBe(11)
    // ⚠️ **And a second, different step**, so the section measures a SLOPE rather than one
    // subtraction: 40 fewer pixels of window is 40 fewer of panel, on the same rule.
    unmountAll()
    const forty = await at(1140)
    expect(round(full.sheet.width) - round(forty.sheet.width), 'the slope is not 1').toBe(40)
    // ⛔ And the lane does NOT move: it is anchored left, so a narrower window costs the panel and
    // never the stop. The two behaving differently is the reason to measure them together.
    expect(round(short.lane.right)).toBe(round(full.lane.right))
  })
})
