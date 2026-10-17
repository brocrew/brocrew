import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * **355 · the capabilities sheet is complete at the geometry the reference clips in.**
 *
 * ⛔ **A new sheet is NOT covered by `dispatch-sheet-fits.dom.test.ts`**, which is hardcoded to
 * `DispatchModal` from its import to its `data-cy`. §4 of the dispatch says *"a sheet must not clip
 * … prove yours did not move it"* — so this is the sibling that asks the same four questions of the
 * sheet 355 adds, and the last test is the half that proves the guard it did not move is still the
 * one doing the work.
 *
 * ⚠️ **`page.viewport()` is the point.** `92vw`, `88vh` and `position: fixed` all resolve against
 * the VIEWPORT, so a component mounted into a sized `<div>` — which is what every other test in this
 * directory does — would answer about the div. The harness box below is deliberately tiny for the
 * same reason: the sheet never touches it.
 *
 * ⛔ **The viewport is shared, so this file puts it back** (`dom-project-viewport-is-shared`).
 */
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

/** A row with every capability set, so the sheet is drawn at its TALLEST and widest. */
const CROWDED: AgentIdentity[] = [
  {
    id: 'agp:default:pm',
    slug: 'pm',
    displayName: 'A project manager with a long enough name to push the header',
    createdAt: 1_700_000_000_000,
    // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
    createdBy: null,
    provider: null,
    // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
    externalMcpServerIds: [],
    // ⚑ **D-016** — `same-project` and `takesWorkFrom` went with projects; `none` is each reach's
    // word that is not its default, and the one whose sentence is longest.
    capabilities: {
      maxDepth: 3,
      canMessage: 'none',
      canAssignWork: 'none',
      canCreateAgents: 'none',
      canWriteRules: 'propose',
    },
    chosen: {
      maxDepth: 'chosen',
      canMessage: 'chosen',
      canAssignWork: 'chosen',
      canCreateAgents: 'chosen',
      canWriteRules: 'chosen',
    },
  },
  ...['worker', 'reviewer', 'planner', 'archivist', 'scribe'].map((slug) => ({
    id: `agp:default:${slug}`,
    slug,
    displayName: null,
    createdAt: 1_700_000_000_000,
    // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
    createdBy: null,
    provider: null,
    // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
    externalMcpServerIds: [],
    capabilities: DEFAULT_CAPABILITIES,
    chosen: {
      maxDepth: 'default' as const,
      canMessage: 'default' as const,
      canAssignWork: 'default' as const,
      canCreateAgents: 'default' as const,
      canWriteRules: 'default' as const,
    },
  })),
]

function loadedStore(): AgentStore {
  const store = createAgentStore({
    agentIdentities: async () => ({
      identities: CROWDED,
      foldersWithoutARow: ['an-orphan-folder-with-a-long-name'],
      use: [],
      spawningEnabled: false,
    }),
  } as unknown as RuntimeBridge)
  return store
}

/**
 * ⚠️ **The app frame's own `min-width`, as a wrapper, and `position: relative` on it is the hazard**
 * — `dispatch-sheet-fits.dom.test.ts`'s finding, verbatim. An oversized frame that is NOT a
 * containing block cannot push an `absolute` child anywhere, so a static wrapper would leave every
 * assertion here green while proving nothing about anchoring.
 */
const Sheet = defineComponent({
  name: 'SheetUnderTest',
  props: {
    store: { type: Object as PropType<AgentStore>, required: true },
    frameMinWidth: { type: Number, required: false, default: 0 },
  },
  setup(props) {
    return () =>
      h(
        'div',
        {
          style: props.frameMinWidth
            ? `position:relative;min-width:${props.frameMinWidth}px`
            : undefined,
          'data-cy': 'app-frame',
        },
        [
          h(
            OverlayHost,
            { label: 'A sheet' },
            {
              default: () =>
                h(CapabilitiesSheet, {
                  profileSlug: 'pm',
                  runsOn: 'codex',
                  store: props.store,
                }),
            },
          ),
        ],
      )
  },
})

/** The box that CLIPS an element: the nearest ancestor whose overflow actually cuts. */
function clipper(el: Element): Element | null {
  let at = el.parentElement
  while (at !== null) {
    const style = getComputedStyle(at)
    for (const value of [style.overflowX, style.overflowY]) {
      if (value === 'hidden' || value === 'clip') return at
    }
    at = at.parentElement
  }
  return null
}

/** Everything inside `root` that reaches past the box that clips it. */
function escapes(root: HTMLElement): string[] {
  const out: string[] = []
  for (const el of root.querySelectorAll('*')) {
    const box = clipper(el)
    if (box === null) continue
    const mine = el.getBoundingClientRect()
    const theirs = box.getBoundingClientRect()
    if (mine.width === 0 && mine.height === 0) continue
    if (mine.right > theirs.right + 1 || mine.left < theirs.left - 1) {
      out.push(el.getAttribute('data-cy') ?? el.tagName.toLowerCase())
    }
  }
  return out
}

/**
 * ⛔ **The narrow end is not decoration, and this file did not have it until a mutation said so.**
 *
 * §4 of the dispatch names *"from `1440×1000` to a `460px` viewport"*. The first version of this
 * file stopped at 900, and at every width it tested `92vw` is wider than the sheet's `660px` cap —
 * so `min(660px, 92vw)` and a flat `660px` give the SAME width, and the row that removed the `min`
 * survived (`a-rule-measured-only-where-both-readings-agree`). ⚑ **460 is where they diverge**:
 * `92vw` is 423px there, and a flat 660 hangs 200px off the right edge of a page that cannot scroll
 * to it — which is the reference prototype's defect exactly.
 */
const GEOMETRIES = [
  ['1440×1000 — the geometry the reference clips in', 1440, 1000],
  ['1200×808 — the shell below the app’s own title bar (385)', 1200, 808],
  ['900×800 — inside an 1180px app frame', 900, 800],
  ['1200×450 — short enough that the sheet must scroll rather than clip', 1200, 450],
  ['460×800 — the narrow end §4 names, where 92vw is what decides the width', 460, 800],
] as const

describe('355 · the capabilities sheet does not clip', () => {
  it.each(GEOMETRIES)('%s', async (_what, width, height) => {
    await page.viewport(width, height)
    const store = loadedStore()
    await store.load()
    const m = mount(Sheet, { store, frameMinWidth: 1180 }, { width: 10, height: 10 })
    await nextTick()

    const sheet = m.q('capabilities-sheet')
    const box = sheet.getBoundingClientRect()
    // 1 · the sheet itself is on screen, both edges.
    expect(box.left, 'the sheet starts off the left edge').toBeGreaterThanOrEqual(0)
    expect(box.right, 'the sheet reaches past the right edge').toBeLessThanOrEqual(
      document.documentElement.clientWidth + 1,
    )
    // ⛔ Non-vacuity: a sheet that rendered nothing would satisfy every bound above.
    expect(box.width).toBeGreaterThan(200)
    // ⛔ **Below ~717px it is `92vw` that decides, and this says so** — the half a flat `660px`
    // breaks, and the reason the narrow geometry is in the table at all.
    if (width < 717) {
      expect(Math.round(box.width), 'the sheet is not sized against the viewport').toBe(
        Math.round(width * 0.92),
      )
    }
    expect(sheet.querySelectorAll('[data-cy^="capability-"]').length).toBeGreaterThanOrEqual(4)

    // 2 · nothing inside it reaches past the box that cuts it.
    expect(escapes(sheet)).toEqual([])

    // 3 · Save is whole, and still on screen — the control a short window most easily loses.
    const save = m.q('capabilities-save')
    expect(save.scrollWidth - save.clientWidth).toBeLessThanOrEqual(1)
    expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      document.documentElement.clientHeight + 1,
    )

    // 4 · the page does not scroll sideways to make any of that true.
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    )

    // 5 · ⛔ **In the SHORT window, the body really did have to scroll** (review). Without this the
    //     row named *"short enough that the sheet must scroll rather than clip"* proved only that
    //     nothing clipped — which is also true of a window tall enough to need no scrolling at all,
    //     so the geometry was testing the same thing as its neighbours.
    const body = sheet.querySelector('.sheet-body') as HTMLElement
    if (height <= 500) {
      expect(
        body.scrollHeight,
        'the short geometry did not make the body overflow',
      ).toBeGreaterThan(body.clientHeight)
    }
  })

  /**
   * ⛔ **The probe self-test** — `dispatch-sheet-fits`'s last test, and its reason: every *"nothing
   * escaped"* above is worth exactly what {@link escapes} is worth. A planted node that MUST be
   * reported, and a failure if it is not.
   *
   * ⚠️ **Planted inside the sheet's own clipped body**, because a control that escapes the box it is
   * testing proves nothing (`a-control-must-be-trapped-the-way-the-subject-is`).
   */
  it('🔴 the escape probe really reports an element that reaches past its box', async () => {
    await page.viewport(1200, 808)
    const store = loadedStore()
    await store.load()
    const m = mount(Sheet, { store, frameMinWidth: 1180 }, { width: 10, height: 10 })
    await nextTick()
    const sheet = m.q('capabilities-sheet')
    expect(escapes(sheet)).toEqual([])

    const planted = document.createElement('div')
    planted.setAttribute('data-cy', 'planted')
    planted.style.cssText = 'position:absolute;left:0;width:4000px;height:4px'
    m.q('capabilities-identity').append(planted)
    await nextTick()
    expect(escapes(sheet)).toContain('planted')
  })

  /**
   * ⚑ **The two facts the sheet survives ON, asserted rather than assumed** (335). Either of them
   * changing reintroduces the reference's defect, and neither is visible in a screenshot.
   */
  it('⛔ the host is anchored to the window and the sheet is sized against it', async () => {
    await page.viewport(900, 800)
    const store = loadedStore()
    await store.load()
    const m = mount(Sheet, { store, frameMinWidth: 1180 }, { width: 10, height: 10 })
    await nextTick()
    const sheet = m.q('capabilities-sheet')
    const host = sheet.parentElement as HTMLElement
    expect(getComputedStyle(host).position).toBe('fixed')
    // 92vw of 900 is 828, which is under the 660px cap — so at this width the sheet is the
    // VIEWPORT's, which is the half a flat `width: 660px` would break at a narrower one.
    expect(sheet.getBoundingClientRect().width).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    )
    expect(getComputedStyle(sheet).overflow).toBe('hidden')
    // ⚠️ …and the BODY is what scrolls, so a short window degrades to a scrollbar rather than to a
    // clipped footer. This is the property test 4 above depends on.
    const body = sheet.querySelector('.sheet-body') as HTMLElement
    expect(getComputedStyle(body).overflowY).toBe('auto')
  })
})
