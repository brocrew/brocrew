import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { providersBridge } from '../../look/fixtures/providers'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import { PARTIAL_WAITING_COUNT, providerStopNotice } from '../../src/renderer/src/lib/live-signal'
import {
  providerLimitsView,
  type ProviderLimitsView,
} from '../../src/renderer/src/lib/persons-queue'
import {
  foldProviderLimits,
  readProviderLimit,
  type ProviderLimitSeen,
} from '../../src/shared/provider-limit'
import { mount, parseColor, unmountAll, visible, type Mounted } from './harness'
import { assertClipped, assertDrawn, drawnReady } from './drawn'

const WIDTHS = [251.68, 266.2]
const AT = Date.now()

const CLAUDE_STOPPED = 'claude is rate-limited (seven_day); resets 2126-09-23T11:00:00.000Z'
const CODEX_STOPPED =
  'codex is rate-limited (weekly) on the GPT-5.3-Codex-Spark limit; resets 2126-09-20T21:10:56.000Z'

/** ⛔ The ordinary day: the look ANSWERED and no provider has walled. */
const NOTHING_WALLED: ProviderLimitsView = { walls: [], unread: false }

function band(said: readonly string[], answered = true): ProviderLimitsView {
  const rows = said.map((one) => {
    const wall = readProviderLimit(one, AT - 60_000)
    expect(wall, `not recognised as a wall: ${one}`).not.toBeNull()
    return wall as ProviderLimitSeen
  })
  const view = providerLimitsView(
    {
      rows: foldProviderLimits(rows, [], AT),
      walk: 'every-provider-wall-recently-recorded' as const,
      ledgers: 1,
      rowsUnread: 0,
    },
    answered,
    AT,
  )
  expect(view, 'the band answered nothing to fold').not.toBeNull()
  return view as ProviderLimitsView
}

async function rail(
  needsYou: number,
  width = WIDTHS[0] as number,
  limits: ProviderLimitsView | null = NOTHING_WALLED,
  needsYouPartial = false,
  queueLooked = true,
): Promise<Mounted> {
  const stub = window as unknown as { api?: unknown }
  stub.api = {
    runtime: {
      providerCatalogue: async () => PROVIDER_DESCRIPTORS,
      listResumable: () => Promise.resolve([]),
      listUnresumable: () => Promise.resolve([]),
    },
  }
  const m = mount(
    SideRail,
    { open: [], activeId: null, place: null, needsYou, needsYouPartial, queueLooked, limits },
    { width, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  await drawnReady()
  return m
}

function plantedBeside(line: HTMLElement, text: string): HTMLElement {
  const box = document.createElement('p')
  box.className = line.className
  // ⛔ **617 · the WIDTH is pinned to the subject's own box, and it was not.** ⚠️ Measured here:
  // `.rail-primary-action` is a flex COLUMN, so a `nowrap` child's `min-width: auto` lets it grow
  // past the rail — the 85-character control below reached **466.8px** in a 187px line's place and
  // was reported cut by the BROWSER VIEWPORT rather than by this rail. 🔴 A 59-character one
  // reached 341.3px and was not cut at all, which is a control that says *drawn in full* for a
  // string two and a half times too wide. ⚑ Pinning the width is what makes
  // `a-control-must-be-trapped-the-way-the-subject-is` true of this planter.
  box.setAttribute(
    'style',
    `width: ${String(line.getBoundingClientRect().width)}px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis`,
  )
  box.textContent = text
  line.parentElement!.append(box)
  return box
}

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  delete (window as unknown as { api?: unknown }).api
})

describe('the queue badge', () => {
  for (const width of WIDTHS) {
    it(`draws the full and partial badge at ${String(width)}px`, async () => {
      const full = await rail(1234, width)
      const badge = full.q('waiting-badge')
      expect(badge.textContent?.trim()).toBe('1234')
      expect(badge.title).toBe('')
      assertDrawn(badge, 'four-digit badge')
      unmountAll()

      const partial = await rail(12, width, band([CLAUDE_STOPPED], false), true)
      expect(partial.q('waiting-badge').textContent?.trim()).toBe('12*')
      expect(partial.q('waiting-badge').title).toBe(PARTIAL_WAITING_COUNT)
      assertDrawn(partial.q('waiting-badge'), 'partial badge')
      expect(partial.q('rail-live-signal').title).toContain(
        'the read that finds a walled provider did not answer',
      )
      expect(partial.q('rail-live-signal').title).not.toContain(PARTIAL_WAITING_COUNT)
    })
  }

  it('omits a complete zero and shows an asterisk for an incomplete zero', async () => {
    const initial = await rail(0, WIDTHS[0], null, false, false)
    expect(initial.all('waiting-badge')).toHaveLength(0)
    expect(initial.all('rail-live-signal')).toHaveLength(0)
    expect(visible(initial.q('new-conversation'))).toBe(true)

    const empty = await rail(0)
    expect(empty.all('waiting-badge')).toHaveLength(0)
    const partial = await rail(0, WIDTHS[0], NOTHING_WALLED, true)
    expect(partial.q('waiting-badge').textContent?.trim()).toBe('*')
    expect(partial.q('waiting-badge').title).toBe(PARTIAL_WAITING_COUNT)
    expect(partial.host.textContent).not.toContain('Nothing needs you')
  })
})

describe('provider stop on the rail', () => {
  for (const width of WIDTHS) {
    it(`draws one and two stopped providers at ${String(width)}px`, async () => {
      const one = await rail(1, width, band([CLAUDE_STOPPED]))
      const notice = one.q('rail-live-stopped')
      expect(notice.textContent).toBe('Claude stopped')
      expect(parseColor(getComputedStyle(notice).color)).not.toEqual(
        parseColor(getComputedStyle(one.q('rail-live-signal')).color),
      )
      assertDrawn(notice, 'one stopped provider')
      unmountAll()

      const two = await rail(0, width, band([CLAUDE_STOPPED, CODEX_STOPPED]))
      expect(two.q('rail-live-stopped').textContent).toBe('Codex and Claude stopped')
      assertDrawn(two.q('rail-live-stopped'), 'two stopped providers')
      expect(two.all('waiting-badge')).toHaveLength(0)

      const planted = plantedBeside(
        two.q('rail-live-signal'),
        'Codex and Claude stopped · a clause far wider than the rail can draw',
      )
      assertClipped(planted, 'deliberately clipped control')
    })
  }

  it('draws the provider notice and hover from the same view', async () => {
    const limits = band([CLAUDE_STOPPED])
    const shown = await rail(1, WIDTHS[0], limits)
    const model = providerStopNotice(limits)
    expect(model).not.toBeNull()
    expect(shown.q('rail-live-signal').textContent).toBe(model?.text)
    expect(shown.q('rail-live-signal').title).toBe(model?.title)

    const ordinary = await rail(1)
    expect(ordinary.all('rail-live-signal')).toHaveLength(0)
    expect(ordinary.q('waiting-badge').textContent?.trim()).toBe('1')

    const unread = await rail(1, WIDTHS[0], null)
    expect(unread.q('rail-live-stopped').textContent).toBe('nothing stopped*')
    expect(unread.q('rail-live-signal').title).toContain(
      'the read that finds a walled provider did not answer',
    )
  })
})

async function namedRail(name: string, late = false) {
  providersBridge()
  const raw = vi.spyOn(window.api.runtime, 'providerCatalogue')
  const providers = PROVIDER_DESCRIPTORS.map((row) => ({
    ...row,
    displayName: row.id === 'claude' ? name : 'Birch',
  }))
  let answer!: (rows: typeof providers) => void
  const held = new Promise<typeof providers>((resolve) => {
    answer = resolve
  })
  const runtime = {
    ...window.api.runtime,
    listResumable: async () => [],
    listUnresumable: async () => [],
    providerCatalogue: vi.fn(async function (this: object) {
      expect(this).toBe(runtime)
      return late ? held : providers
    }),
  }
  const client = createDesktopProviderApi(
    () => runtime,
    () => undefined,
    () => undefined,
    () => runtime,
  )
  const limits = band([CLAUDE_STOPPED])
  const m = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, client)
        return () =>
          h(SideRail, {
            open: [],
            activeId: null,
            place: null,
            needsYou: 1,
            limits,
          })
      },
    }),
    {},
    { width: WIDTHS[0]!, height: 900 },
  )
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  return { m, raw, runtime, limits, answer: () => answer(providers) }
}

it('uses each selected catalogue on the actual rail without changing its counted facts', async () => {
  const one = await namedRail('Fern')
  expect(one.m.q('rail-live-signal').textContent).toBe('Fern stopped')
  const two = await namedRail('Willow')
  expect(two.m.q('rail-live-signal').textContent).toBe('Willow stopped')
  expect(one.m.q('rail-live-signal').textContent).toBe('Fern stopped')
  expect(one.limits.walls.map((wall) => wall.provider)).toEqual(['claude'])
  expect(one.runtime.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(two.runtime.providerCatalogue).toHaveBeenCalledTimes(1)
  expect(one.raw).not.toHaveBeenCalled()
  expect(two.raw).not.toHaveBeenCalled()
  expect(one.m.q('waiting-badge').textContent?.trim()).toBe('1')
  expect(two.m.q('waiting-badge').textContent?.trim()).toBe('1')
})

it('keeps the rail count and generic stop visible until its selected names answer', async () => {
  const out = await namedRail('Fern', true)
  const line = out.m.q('rail-live-signal')
  expect(out.m.q('waiting-badge').textContent?.trim()).toBe('1')
  expect(line.textContent).toMatch(/provider.*stopped/i)
  expect(line.textContent).not.toContain('Claude')
  out.answer()
  await vi.waitFor(() => expect(line.textContent).toBe('Fern stopped'))
  expect(out.raw).not.toHaveBeenCalled()
})
