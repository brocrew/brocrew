import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import {
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
  SPAWN_RAIL_MEANS,
} from '../../src/shared/capabilities'
import type { AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **368 · the sentence is on the screen where the decision is made, above the control.**
 *
 * ⛔ **In the DOM project, because none of this can be asked of a string.** `consent-never-
 * containment.test.ts` asks what the constant SAYS; only a real engine can answer where it sits
 * relative to the first grant checkbox, whether it is one paragraph or two columns, and whether it
 * survives the narrow end of `335`'s range.
 *
 * ⚠️ **`page.viewport()`, and this file puts it back** (`dom-project-viewport-is-shared`). The sheet
 * is `92vw`/`88vh`/`position: fixed`, so a component mounted into a sized `<div>` would answer about
 * the div. The harness box stays tiny for the same reason.
 *
 * ⚑ **The clip walk is NOT repeated here.** `capabilities-sheet-fits.dom.test.ts` already runs
 * `escapes()` over the whole sheet at five geometries including the `460px` floor, and this
 * paragraph is inside it — so that guard covers the new element the moment it exists. What that file
 * cannot see is the paragraph being ABSENT, which is what §1 below is for.
 */
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const IDENTITIES: AgentIdentity[] = [
  {
    id: 'agp:default:pm',
    slug: 'pm',
    displayName: 'A project manager',
    createdAt: 1_700_000_000_000,
    // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
    createdBy: null,
    provider: null,
    // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
    externalMcpServerIds: [],
    // ⚑ **D-016** — `none`, the one reach word left that is not the default (`same-project` went).
    capabilities: { ...DEFAULT_CAPABILITIES, canMessage: 'none' },
    chosen: {
      maxDepth: 'default',
      canMessage: 'chosen',
      canAssignWork: 'default',
      canCreateAgents: 'default',
      canWriteRules: 'default',
    },
  },
  {
    id: 'agp:default:worker',
    slug: 'worker',
    displayName: null,
    createdAt: 1_700_000_000_000,
    // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
    createdBy: null,
    provider: null,
    // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
    externalMcpServerIds: [],
    capabilities: DEFAULT_CAPABILITIES,
    chosen: {
      maxDepth: 'default',
      canMessage: 'default',
      canAssignWork: 'default',
      canCreateAgents: 'default',
      canWriteRules: 'default',
    },
  },
]

function storeWith(identities: AgentIdentity[]): AgentStore {
  return createAgentStore({
    agentIdentities: async () => ({
      identities,
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
    }),
  } as unknown as RuntimeBridge)
}

const Sheet = defineComponent({
  name: 'SheetUnderTest',
  props: {
    store: { type: Object as PropType<AgentStore>, required: true },
    profileSlug: { type: String, required: false, default: 'pm' },
  },
  setup(props) {
    return () =>
      h('div', { style: 'position:relative;min-width:1180px', 'data-cy': 'app-frame' }, [
        h(
          OverlayHost,
          { label: 'A sheet' },
          {
            default: () =>
              h(CapabilitiesSheet, {
                profileSlug: props.profileSlug,
                runsOn: 'codex',
                store: props.store,
              }),
          },
        ),
      ])
  },
})

async function open(
  profileSlug = 'pm',
  identities = IDENTITIES,
): Promise<ReturnType<typeof mount>> {
  const store = storeWith(identities)
  await store.load()
  const m = mount(Sheet, { store, profileSlug }, { width: 10, height: 10 })
  await nextTick()
  return m
}

/** The first grant control the sheet draws, read off the table it draws from. */
const FIRST_GRANT = `capability-${CAPABILITY_FIELDS[0].key}`

describe('§1 · it is on the sheet, and a person reads it BEFORE the first control', () => {
  it('⛔ the whole sentence renders, and it is the constant rather than a paraphrase', async () => {
    await page.viewport(1440, 1000)
    const m = await open()
    const said = m.q('spawn-rail-means')
    expect((said.textContent ?? '').trim()).toBe(SPAWN_RAIL_MEANS)
    // ⚑ **One text node, which is what "one breath" is in the DOM.** `367` M18: a second child
    // beside a text node inside a flex parent is blockified into a column, and every containment,
    // height and fold assertion stayed green while the launcher rendered one sentence twice over.
    expect(said.childNodes).toHaveLength(1)
    expect(said.childNodes[0]?.nodeType, 'the sentence is split across elements').toBe(
      said.TEXT_NODE,
    )
    expect(said.getBoundingClientRect().height, 'a hidden disclosure is not one').toBeGreaterThan(0)
  })

  it('🔴 it sits ABOVE the first grant control — geometrically, not by DOM order', async () => {
    // ⛔ **`367` §2.1's rule, applied one surface along**: a person is told what a thing does before
    // they choose it. Asserted on boxes rather than on `compareDocumentPosition`, because
    // `.sheet-body` is a flex COLUMN and `order` would reverse the paint without moving the markup.
    await page.viewport(1440, 1000)
    const m = await open()
    const said = m.q('spawn-rail-means').getBoundingClientRect()
    const grant = m.q(FIRST_GRANT).getBoundingClientRect()
    expect(said.bottom, 'the sentence is drawn below the grant it is about').toBeLessThanOrEqual(
      grant.top + 1,
    )
    // ⚑ The paired positive: both boxes are real, so the comparison is not two zeroes.
    expect(said.height).toBeGreaterThan(0)
    expect(grant.height).toBeGreaterThan(0)
    // ⚠️ …and it is not tucked inside the field it precedes.
    expect(m.q(FIRST_GRANT).contains(m.q('spawn-rail-means'))).toBe(false)
  })

  it('⚠️ it is not in a fold, a details, or anything a person can shut', async () => {
    await page.viewport(1440, 1000)
    const m = await open()
    let at: HTMLElement | null = m.q('spawn-rail-means')
    const shut: string[] = []
    while (at !== null && at !== document.body) {
      if (at.tagName === 'DETAILS' || at.hasAttribute('hidden')) shut.push(at.tagName)
      at = at.parentElement
    }
    expect(shut).toEqual([])
  })

  it('⛔ …and it is absent on the state that has no grant to make, which is the paired negative', async () => {
    // A profile with no row: `setCapabilities` refuses to create one, so there is nothing to grant
    // and nothing this sentence would be about. ⚑ The positive beside it is what makes the absence
    // a measurement — the sheet DID render, on a state that draws its own explanation.
    await page.viewport(1440, 1000)
    const m = await open('nobody')
    expect(m.all('capabilities-no-row')).toHaveLength(1)
    expect(m.all('spawn-rail-means')).toHaveLength(0)
  })
})

describe('§2 · it stays one readable paragraph across `335`’s range', () => {
  it.each([
    ['1440×1000 — the geometry the reference clips in', 1440, 1000],
    ['1200×808 — the shell below the app’s own title bar (385)', 1200, 808],
    ['460×800 — the narrow end `335` guards', 460, 800],
  ] as const)('%s', async (_what, width, height) => {
    await page.viewport(width, height)
    const m = await open()
    const said = m.q('spawn-rail-means')

    // ⛔ It WRAPS rather than running off — the failure a `nowrap` or a stray `white-space` makes,
    // and the one `escapes()` in the fits file cannot see because an overflowing inline box does not
    // move its parent's border box.
    expect(
      said.scrollWidth - said.clientWidth,
      `it overflows sideways at ${width}px`,
    ).toBeLessThanOrEqual(1)
    const box = said.getBoundingClientRect()
    expect(box.left, `it starts off the left edge at ${width}px`).toBeGreaterThanOrEqual(0)
    expect(box.right, `it reaches past the right edge at ${width}px`).toBeLessThanOrEqual(
      document.documentElement.clientWidth + 1,
    )
    // ⚑ **A block, not a flex item.** `.identity-note` was chosen over this sheet's `.note` — which
    // is `display: flex` with an icon as its first item — precisely so this cannot become two
    // columns. `block` is the value a blockified flex item would also report, so the guard that
    // separates them is the parent's own axis, asserted next.
    expect(getComputedStyle(said).display).toBe('block')
    const body = said.parentElement as HTMLElement
    expect(getComputedStyle(body).flexDirection, 'the sheet body stopped being a column').toBe(
      'column',
    )
    // …and it really did wrap at the narrow end, so this row is not measuring the wide one twice.
    if (width === 460) {
      expect(
        box.height,
        'one line at 460px means the sentence is not being wrapped',
      ).toBeGreaterThan(24)
    }
  })
})
