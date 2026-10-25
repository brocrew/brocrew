import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { page as browserPage } from 'vitest/browser'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import TeamProfileGraph from '../../src/renderer/src/components/TeamProfileGraph.vue'
import {
  createTeamProfileGraph,
  provideTeamProfileGraph,
} from '../../src/renderer/src/composables/useTeamProfileGraph'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { layoutCommand } from '../../src/renderer/src/lib/team-profile-layout'
import { fictionalGraph, fictionalGraphWire } from '../fixtures/team-profile-graph-view'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function setup(count = 151, dense = false, team = false, width = 1180) {
  const reading = fictionalGraph(count, dense),
    read = vi.fn(fictionalGraphWire(reading)),
    active = ref(true)
  let controller!: ReturnType<typeof createTeamProfileGraph>
  const component = defineComponent({
    setup() {
      controller = createTeamProfileGraph({ read, workspace: () => 'fictional-workspace' })
      provideTeamProfileGraph(controller)
      return () =>
        team
          ? h(TeamWorkspace, {
              agents: null,
              focusedIdentity: 'fictional-1',
              store: {} as AgentStore,
            })
          : h(TeamProfileGraph, { active: active.value })
    },
  })
  const mounted = mount(component, {}, { width, height: 880 })
  const buttons = () => Array.from(mounted.host.querySelectorAll<HTMLButtonElement>('button'))
  const button = (text: string) => {
    const found = buttons().find((b) => b.textContent?.trim() === text)
    if (!found) throw new Error('Missing button ' + text)
    return found
  }
  return { mounted, reading, read, active, controller, button }
}
it('keeps Directory first and exposes a third roving tab that reads the whole workspace only on entry', async () => {
  const s = setup(151, false, true)
  const tabs = Array.from(s.mounted.host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
  expect(tabs.map((t) => t.textContent?.trim())).toEqual([
    'Directory',
    'Who called whom',
    'Profile graph',
  ])
  expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
  expect(s.read).not.toHaveBeenCalled()
  tabs[0]!.focus()
  tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }))
  await nextTick()
  expect(document.activeElement).toBe(tabs[2])
  expect(tabs[2]!.getAttribute('aria-selected')).toBe('true')
  await vi.waitFor(() => expect(s.controller.reading.value?.nodes).toHaveLength(151))
  expect(s.mounted.host.textContent).toContain('151 of 151 shown')
  tabs[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
  await nextTick()
  expect(document.activeElement).toBe(tabs[0])
  tabs[2]!.click()
  await nextTick()
  expect(s.read.mock.calls.filter(([r]) => r.operation === 'snapshot')).toHaveLength(1)
})
it('pages every agent, focuses item 51, retains card context during search and restores an opener on close', async () => {
  const s = setup()
  await vi.waitFor(() =>
    expect(s.mounted.host.querySelectorAll('[data-graph-agent]')).toHaveLength(50),
  )
  await s.button('Next').click()
  await nextTick()
  const item = s.mounted.host.querySelector<HTMLButtonElement>('[data-graph-agent]')!
  expect(item.dataset.graphAgent).toBe('fictional-00051')
  expect(document.activeElement).toBe(item)
  item.click()
  await nextTick()
  expect(s.mounted.host.querySelector('aside')?.textContent).toContain('Agent 00051')
  s.button('Close card').click()
  await new Promise(requestAnimationFrame)
  expect(document.activeElement).toBe(item)
  item.click()
  await nextTick()
  item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  await new Promise(requestAnimationFrame)
  expect(document.activeElement).toBe(item)
  item.click()
  const search = s.mounted.host.querySelector<HTMLInputElement>('input[type="search"]')!
  search.value = 'missing entirely'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(s.mounted.host.textContent).toContain('No agents match your search')
  expect(s.mounted.host.querySelector('aside')?.textContent).toContain('Agent 00051')
  s.button('Close card').click()
  await nextTick()
  expect(document.activeElement).toBe(search)
})
it('keeps the entire paged list and cards when message-only proximity exceeds the union pair cap', async () => {
  const messages = vi.spyOn(Worker.prototype, 'postMessage')
  const s = setup(200, true)
  await vi.waitFor(() => expect(s.mounted.host.textContent).toContain('Too many connections'))
  expect(s.mounted.host.textContent).toContain('200 of 200 shown')
  expect(s.mounted.host.querySelectorAll('[data-graph-agent]')).toHaveLength(50)
  expect(
    messages.mock.calls.filter(([c]) => (c as { type?: string }).type === 'init'),
  ).toHaveLength(0)
  await s.button('Next').click()
  await nextTick()
  s.mounted.host.querySelector<HTMLButtonElement>('[data-graph-agent]')!.click()
  await nextTick()
  expect(s.mounted.host.querySelector('aside')?.textContent).toContain('Agent 00051')
})
it('runs the actual same-origin numeric worker, preserves pause through force controls, and resumes only by gesture', async () => {
  const NativeWorker = Worker,
    responses: unknown[] = []
  class ObservedWorker extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options)
      this.addEventListener('message', (event) => responses.push(event.data))
    }
  }
  vi.stubGlobal('Worker', ObservedWorker)
  const messages = vi.spyOn(Worker.prototype, 'postMessage'),
    s = setup(100)
  await vi.waitFor(() =>
    expect(messages.mock.calls.some(([c]) => (c as { type?: string }).type === 'init')).toBe(true),
  )
  await vi.waitFor(() =>
    expect(responses.some((r) => (r as { type?: string }).type === 'positions')).toBe(true),
  )
  for (const [command] of messages.mock.calls)
    expect(layoutCommand.safeParse(command).success).toBe(true)
  s.button('Pause').click()
  await nextTick()
  const range = s.mounted.host.querySelector<HTMLInputElement>('input[type="range"]')!
  range.value = '120'
  range.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  const init = messages.mock.calls
    .map(([c]) => layoutCommand.safeParse(c))
    .filter((p) => p.success && p.data.type === 'init')
    .at(-1)!
  expect(init.success && init.data.type === 'init' && init.data.running).toBe(false)
  expect(s.mounted.host.textContent).toContain('Layout paused')
  s.button('Resume').click()
  await nextTick()
  expect(messages.mock.calls.some(([c]) => (c as { type?: string }).type === 'run')).toBe(true)
  expect(s.mounted.host.textContent).not.toContain('could not start')
  s.active.value = false
  await nextTick()
  expect(messages.mock.calls.slice(-2).map(([c]) => (c as { type: string }).type)).toEqual([
    'pause',
    'ack',
  ])
})
it('keeps refresh focus during staging and shows the earlier reading after an unavailable refresh', async () => {
  const s = setup(100)
  await vi.waitFor(() => expect(s.controller.reading.value?.nodes).toHaveLength(100))
  const refresh = s.button('Refresh')
  refresh.focus()
  s.read.mockImplementation(async () => ({
    type: 'unavailable',
    cause: 'budget',
    complete: false,
    phase: 'messages',
    visited: 250000,
    unread: 1,
    remaining: 'unknown',
  }))
  refresh.click()
  await vi.waitFor(() => expect(s.mounted.host.textContent).toContain('could not finish'))
  expect(document.activeElement).toBe(refresh)
  expect(s.mounted.host.textContent).toContain('earlier reading is still shown')
  expect(s.mounted.host.querySelectorAll('[data-graph-agent]')).toHaveLength(50)
})
it.each(['null', 'discriminator', 'array', 'nan', 'length'] as const)(
  'terminates a %s layout reply and keeps the entire list/card fallback',
  async (fault) => {
    let terminated = 0
    class ControlledWorker {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      postMessage(raw: unknown) {
        const command = layoutCommand.parse(raw)
        if (command.type !== 'init') return
        const generation = command.generation
        const value =
          fault === 'null'
            ? null
            : fault === 'discriminator'
              ? { type: 'wrong', generation }
              : fault === 'array'
                ? { type: 'positions', generation, positions: [1, 2] }
                : {
                    type: 'positions',
                    generation,
                    positions: fault === 'nan' ? new Float64Array([NaN, 0]) : new Float64Array(2),
                  }
        queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: value })))
      }
      terminate() {
        terminated++
      }
    }
    vi.stubGlobal('Worker', ControlledWorker)
    const s = setup(100)
    await vi.waitFor(() => expect(s.mounted.host.textContent).toContain('Graph layout unavailable'))
    expect(terminated).toBe(1)
    expect(s.mounted.host.querySelectorAll('[data-graph-agent]')).toHaveLength(50)
    s.mounted.host.querySelector<HTMLButtonElement>('[data-graph-agent]')!.click()
    await nextTick()
    expect(s.mounted.host.querySelector('aside')?.textContent).toContain('Agent 00001')
  },
)
it('ignores a well-formed stale frame and announces nonzero count changes politely', async () => {
  let terminated = 0
  class ControlledWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    postMessage(raw: unknown) {
      const command = layoutCommand.parse(raw)
      if (command.type === 'init')
        queueMicrotask(() =>
          this.onmessage?.(
            new MessageEvent('message', {
              data: {
                type: 'positions',
                generation: command.generation - 1,
                positions: new Float64Array(6),
              },
            }),
          ),
        )
    }
    terminate() {
      terminated++
    }
  }
  vi.stubGlobal('Worker', ControlledWorker)
  const s = setup(100)
  await vi.waitFor(() => expect(s.controller.reading.value?.nodes).toHaveLength(100))
  expect(terminated).toBe(0)
  expect(s.mounted.host.textContent).not.toContain('Graph layout unavailable')
  const count = s.mounted.host.querySelector<HTMLElement>('h4[aria-live="polite"]')!
  expect(count.getAttribute('aria-atomic')).toBe('true')
  const search = s.mounted.host.querySelector<HTMLInputElement>('input[type="search"]')!
  search.value = 'Agent 00001'
  search.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
  expect(count.textContent).toContain('1 of 100 shown')
})

it('latches reduced motion across all controls and preference changes until explicit Resume', async () => {
  const native = window.matchMedia.bind(window),
    motion = Object.assign(new EventTarget(), {
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener() {},
      removeListener() {},
    })
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    query === motion.media ? (motion as unknown as MediaQueryList) : native(query),
  )
  const messages = vi.spyOn(Worker.prototype, 'postMessage'),
    s = setup(100)
  await vi.waitFor(() => expect(s.controller.reading.value?.nodes).toHaveLength(100))
  await nextTick()
  const selects = s.mounted.host.querySelectorAll<HTMLSelectElement>('select')
  for (const select of selects) {
    select.selectedIndex = select.options.length - 1
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
  }
  for (const range of s.mounted.host.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
    range.value = range.max
    range.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
  }
  s.button('Reset forces').click()
  await nextTick()
  motion.matches = false
  motion.dispatchEvent(new Event('change'))
  await nextTick()
  const inits = messages.mock.calls
    .map(([command]) => layoutCommand.parse(command))
    .filter((c) => c.type === 'init')
  expect(inits.length).toBeGreaterThan(1)
  expect(inits.every((c) => !c.running)).toBe(true)
  expect(messages.mock.calls.some(([c]) => (c as { type?: string }).type === 'run')).toBe(false)
  s.button('Resume').click()
  await nextTick()
  expect(messages.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'run' })
  motion.matches = true
  motion.dispatchEvent(new Event('change'))
  await nextTick()
  expect(messages.mock.calls.slice(-2).map(([c]) => (c as { type: string }).type)).toEqual([
    'pause',
    'ack',
  ])
})

it('moves only the dragged node while paused and preserves the viewport after release, cancellation and trailing click', async () => {
  const circles: { x: number; y: number; r: number }[] = []
  const originalArc = CanvasRenderingContext2D.prototype.arc,
    originalClear = CanvasRenderingContext2D.prototype.clearRect
  vi.spyOn(CanvasRenderingContext2D.prototype, 'clearRect').mockImplementation(function (
    this: CanvasRenderingContext2D,
    ...args
  ) {
    circles.length = 0
    originalClear.apply(this, args)
  })
  vi.spyOn(CanvasRenderingContext2D.prototype, 'arc').mockImplementation(function (
    this: CanvasRenderingContext2D,
    ...args
  ) {
    circles.push({ x: args[0], y: args[1], r: args[2] })
    originalArc.apply(this, args)
  })
  const native = window.matchMedia.bind(window)
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    query.includes('prefers-reduced-motion')
      ? ({
          ...native(query),
          matches: true,
          addEventListener() {},
          removeEventListener() {},
        } as MediaQueryList)
      : native(query),
  )
  const messages = vi.spyOn(Worker.prototype, 'postMessage'),
    s = setup(3)
  await vi.waitFor(() => expect(circles.length).toBeGreaterThanOrEqual(4))
  const canvas = s.mounted.host.querySelector('canvas')!,
    box = canvas.getBoundingClientRect()
  vi.spyOn(canvas, 'setPointerCapture').mockImplementation(() => {})
  vi.spyOn(canvas, 'hasPointerCapture').mockReturnValue(false)
  const at = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerId: 1,
        button: 0,
        clientX: box.left + x,
        clientY: box.top + y,
      }),
    )
  const before = circles.map((c) => ({ ...c })),
    a = before[0]!,
    b = before[2]!
  at('pointerdown', a.x, a.y)
  at('pointerup', a.x, a.y)
  await nextTick()
  expect(s.mounted.host.querySelector('aside')?.textContent).toContain('BroBot')
  at('pointerdown', a.x, a.y)
  at('pointermove', a.x + 40, a.y + 20)
  await new Promise((r) => requestAnimationFrame(r))
  at('pointerup', a.x + 40, a.y + 20)
  canvas.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await new Promise((r) => requestAnimationFrame(r))
  expect(circles[0]!.x).toBeCloseTo(a.x + 40, 3)
  expect(circles[0]!.y).toBeCloseTo(a.y + 20, 3)
  expect(circles[2]!.x).toBeCloseTo(b.x, 3)
  expect(circles[2]!.y).toBeCloseTo(b.y, 3)
  const after = circles.map((c) => ({ ...c }))
  at('pointerdown', after[0]!.x, after[0]!.y)
  at('pointermove', after[0]!.x + 5, after[0]!.y + 5)
  at('pointercancel', after[0]!.x + 5, after[0]!.y + 5)
  await nextTick()
  expect(messages.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'pin', held: false })
  expect(messages.mock.calls.filter(([c]) => (c as { type?: string }).type === 'run')).toHaveLength(
    0,
  )
})

it.each([false, true])(
  'selects the first real list and search click with forced colors %s',
  async (forced) => {
    const native = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query.includes('prefers-reduced-motion')
        ? ({
            matches: true,
            addEventListener() {},
            removeEventListener() {},
          } as unknown as MediaQueryList)
        : query.includes('forced-colors')
          ? ({
              matches: forced,
              addEventListener() {},
              removeEventListener() {},
            } as unknown as MediaQueryList)
          : native(query),
    )
    const s = setup(100, false, true)
    s.button('Profile graph').click()
    await vi.waitFor(() =>
      expect(s.mounted.host.querySelectorAll('[data-graph-agent]')).toHaveLength(50),
    )
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    await browserPage.getByRole('button', { name: /^Agent 00001/ }).click()
    await new Promise(requestAnimationFrame)
    expect(
      s.mounted.host
        .querySelector('[data-graph-agent="fictional-00001"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true')
    const search = s.mounted.host.querySelector<HTMLInputElement>('input[type="search"]')!
    search.focus()
    search.value = 'Agent 00051 fictional-51'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    await browserPage.getByRole('button', { name: /^Agent 00051/ }).click()
    await new Promise(requestAnimationFrame)
    expect(
      s.mounted.host
        .querySelector('[data-graph-agent="fictional-00051"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true')
  },
)
it.each([299, 300])(
  'paints every fitted badge at %s nodes including enlarged text',
  async (count) => {
    const native = window.matchMedia.bind(window)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
      query.includes('prefers-reduced-motion')
        ? ({
            matches: true,
            addEventListener() {},
            removeEventListener() {},
          } as unknown as MediaQueryList)
        : native(query),
    )
    let badges = 0,
      draws = 0,
      zero = false
    const clear = CanvasRenderingContext2D.prototype.clearRect
    const paint = CanvasRenderingContext2D.prototype.fillText
    vi.spyOn(CanvasRenderingContext2D.prototype, 'clearRect').mockImplementation(function (
      ...args
    ) {
      badges = 0
      draws = 0
      zero = false
      clear.apply(this, args)
    })
    vi.spyOn(CanvasRenderingContext2D.prototype, 'fillText').mockImplementation(function (
      this: CanvasRenderingContext2D,
      ...args
    ) {
      draws++
      if (/^\d+$/.test(args[0])) {
        badges++
        if (args[0] === '0') zero = true
      }
      paint.apply(this, args)
    })
    const s = setup(count)
    await vi.waitFor(() => expect(s.controller.reading.value?.nodes).toHaveLength(count))
    const checkbox = [
      ...s.mounted.host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].find((input) => input.parentElement?.textContent?.includes('Descendant badges'))!
    checkbox.click()
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
    expect(badges).toBe(count)
    for (const size of ['13px', '26px']) {
      s.mounted.host.querySelector('canvas')!.style.fontSize = size
      s.button('Fit').click()
      await new Promise(requestAnimationFrame)
      expect(badges).toBe(count)
      expect(zero).toBe(true)
      expect(draws).toBeLessThanOrEqual(300)
    }
  },
)
