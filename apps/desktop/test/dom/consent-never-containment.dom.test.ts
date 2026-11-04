import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { CAPABILITY_FIELDS, DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * The policy constant is covered by the source test. The terse dialog keeps the schema's
 * grant labels and editors visible in the same geometries, without the removed policy paragraph.
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
    expect(m.all('spawn-rail-means')).toHaveLength(0)
    const label = m.q(FIRST_GRANT).querySelector(':scope > span') as HTMLElement
    expect(label.firstChild?.textContent?.trim()).toBe(CAPABILITY_FIELDS[0].label)
    expect(label.firstChild?.nodeType).toBe(Node.TEXT_NODE)
    expect(label.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(m.q(`${FIRST_GRANT}-input`).getBoundingClientRect().height).toBeGreaterThan(0)
  })

  it('🔴 it sits ABOVE the first grant control — geometrically, not by DOM order', async () => {
    await page.viewport(1440, 1000)
    const m = await open()
    const label = m.q(FIRST_GRANT).querySelector(':scope > span') as HTMLElement
    const control = m.q(`${FIRST_GRANT}-input`)
    const said = label.getBoundingClientRect()
    const grant = control.getBoundingClientRect()
    expect(said.bottom, 'the label is drawn below its editor').toBeLessThanOrEqual(grant.top + 1)
    expect(said.height).toBeGreaterThan(0)
    expect(grant.height).toBeGreaterThan(0)
    expect(control.contains(label)).toBe(false)
    expect(m.all('spawn-rail-means')).toHaveLength(0)
  })

  it('⚠️ it is not in a fold, a details, or anything a person can shut', async () => {
    await page.viewport(1440, 1000)
    const m = await open()
    expect(m.all('spawn-rail-means')).toHaveLength(0)
    let at: HTMLElement | null = m.q(FIRST_GRANT)
    expect(at.getBoundingClientRect().height).toBeGreaterThan(0)
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
    expect(m.all('spawn-rail-means')).toHaveLength(0)
    const said = m.q(FIRST_GRANT)
    expect(said.textContent).toContain(CAPABILITY_FIELDS[0].label)
    expect(
      said.scrollWidth - said.clientWidth,
      `it overflows sideways at ${width}px`,
    ).toBeLessThanOrEqual(1)
    const box = said.getBoundingClientRect()
    expect(box.height).toBeGreaterThan(0)
    if (width === 460) {
      expect(
        box.height,
        'the grant label and editor must both occupy the narrow sheet',
      ).toBeGreaterThan(24)
    }
    expect(box.left, `it starts off the left edge at ${width}px`).toBeGreaterThanOrEqual(0)
    expect(box.right, `it reaches past the right edge at ${width}px`).toBeLessThanOrEqual(
      document.documentElement.clientWidth + 1,
    )
    const control = m.q(`${FIRST_GRANT}-input`)
    expect(control.getBoundingClientRect().height).toBeGreaterThan(0)
    expect(control.scrollWidth - control.clientWidth).toBeLessThanOrEqual(1)
    const body = said.parentElement as HTMLElement
    expect(getComputedStyle(body).flexDirection, 'the sheet body stopped being a column').toBe(
      'column',
    )
  })
})
