import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { ResumableSessionInfo, RuntimeStatesMessage } from '../../src/shared/runtime-ipc'
import { providersBridge } from '../../look/fixtures/providers'
import { workerRows } from './parallel-workers-fixture'
import { mount, unmountAll } from './harness'

const unavailable = new Error('The window’s record could not be read. Please try again.')
const rows = workerRows(1)
async function flush() {
  for (let hop = 0; hop < 12; hop++) await Promise.resolve()
  await nextTick()
}
afterEach(() => {
  unmountAll()
  vi.useRealTimers()
  delete (window as { api?: unknown }).api
})
function open(read = vi.fn(async () => rows)) {
  providersBridge()
  window.api.runtime.listResumable = read
  window.api.runtime.listUnresumable = vi.fn(async () => [])
  vi.useFakeTimers()
  const workspace = reactive({ path: '/fictional/first', name: 'First' })
  const rail = ref<{
    refreshResumable(): Promise<void>
    hearStates(message: RuntimeStatesMessage): void
    theOneList: readonly ListedConversation[] | null
  } | null>(null)
  const m = mount(
    defineComponent(
      () => () =>
        h(SideRail, {
          ref: rail,
          open: [],
          activeId: null,
          place: null,
          workspaceFolder: workspace,
        }),
    ),
  )
  return { m, rail, read, workspace, refresh: () => rail.value!.refreshResumable() }
}
const count = (out: ReturnType<typeof open>) =>
  out.m.host.querySelectorAll('[data-cy^="open-session-"]').length
const errors = (out: ReturnType<typeof open>) => out.m.all('conversations-error')

it('keeps the list with no error flash while one background read fails then recovers', async () => {
  const out = open()
  await flush()
  expect(count(out)).toBe(1)
  const flashes: Node[] = []
  const observer = new MutationObserver((changes) => {
    for (const change of changes)
      for (const node of change.addedNodes)
        if (
          node instanceof Element &&
          (node.matches('[data-cy="conversations-error"]') ||
            node.querySelector('[data-cy="conversations-error"]'))
        )
          flashes.push(node)
  })
  observer.observe(out.m.host, { subtree: true, childList: true })
  try {
    out.read.mockRejectedValueOnce(unavailable)
    const refreshed = out.refresh()
    await flush()
    expect(count(out)).toBe(1)
    expect(errors(out)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(999)
    expect(out.read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    await refreshed
    expect(out.read).toHaveBeenCalledTimes(3)
    expect(count(out)).toBe(1)
    expect(errors(out)).toHaveLength(0)
    expect(flashes).toEqual([])
  } finally {
    observer.disconnect()
  }
})

it('reports sustained failure with the old list and keeps the notice until a successful answer', async () => {
  const out = open()
  await flush()
  out.read.mockRejectedValue(unavailable)
  const refreshed = out.refresh()
  await flush()
  await vi.advanceTimersByTimeAsync(1_000)
  expect(errors(out)).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1_000)
  await refreshed
  expect(out.read).toHaveBeenCalledTimes(4)
  expect(count(out)).toBe(1)
  expect(out.m.q('conversations-error').textContent).toContain(unavailable.message)
  let answer!: (value: ResumableSessionInfo[]) => void
  out.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  const recovery = out.refresh()
  await flush()
  expect(errors(out)).toHaveLength(1)
  answer([])
  await recovery
  expect(count(out)).toBe(0)
  expect(errors(out)).toHaveLength(0)
})

it('initial transient reads stay unknown and recover quietly; no empty list is invented', async () => {
  const read = vi
    .fn(async () => rows)
    .mockRejectedValueOnce(unavailable)
    .mockRejectedValueOnce(unavailable)
  const out = open(read)
  await flush()
  expect(out.rail.value!.theOneList).toBeNull()
  expect(errors(out)).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(out.rail.value!.theOneList).toBeNull()
  await vi.advanceTimersByTimeAsync(1_000)
  expect(count(out)).toBe(1)
  expect(errors(out)).toHaveLength(0)
})

it('initial persistent failure reports the cause after three reads without claiming a known empty list', async () => {
  const out = open(vi.fn(async () => rows).mockRejectedValue(unavailable))
  await flush()
  await vi.advanceTimersByTimeAsync(2_000)
  expect(out.read).toHaveBeenCalledTimes(3)
  expect(out.rail.value!.theOneList).toBeNull()
  expect(out.m.q('conversations-error').textContent).toContain(unavailable.message)
})

it('a newer successful read and pushed state defeat an older response', async () => {
  const out = open()
  await flush()
  let oldAnswer!: (value: ResumableSessionInfo[]) => void
  out.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        oldAnswer = resolve
      }),
  )
  const older = out.refresh()
  const newer = out.refresh()
  out.rail.value!.hearStates({
    moved: [{ conversation: rows[0]!.sessionId, state: { is: 'needs-you' } }],
    kept: [],
  })
  await newer
  oldAnswer([])
  await older
  expect(count(out)).toBe(1)
  expect(out.rail.value!.theOneList![0]!.state).toEqual({ is: 'needs-you' })
})

it('workspace replacement cancels a retry and rejects a late answer from the old workspace', async () => {
  const out = open()
  await flush()
  out.read.mockRejectedValueOnce(unavailable)
  const retry = out.refresh()
  await flush()
  let oldAnswer!: (value: ResumableSessionInfo[]) => void
  out.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        oldAnswer = resolve
      }),
  )
  const older = out.refresh()
  out.read.mockResolvedValue([])
  out.workspace.path = '/fictional/second'
  await flush()
  expect(count(out)).toBe(0)
  oldAnswer(rows)
  await older
  await retry
  await vi.advanceTimersByTimeAsync(3_000)
  expect(count(out)).toBe(0)
  expect(out.read).toHaveBeenCalledTimes(4)
  expect(errors(out)).toHaveLength(0)
})

it('unmount cancels a scheduled retry without another host call', async () => {
  const out = open(vi.fn(async () => rows).mockRejectedValue(unavailable))
  await flush()
  out.m.unmount()
  await vi.advanceTimersByTimeAsync(3_000)
  expect(out.read).toHaveBeenCalledTimes(1)
})

it('frequent failed refresh notices cannot bypass or restart the two-second quiet window', async () => {
  const out = open()
  await flush()
  out.read.mockRejectedValue(unavailable)
  const first = out.refresh()
  await flush()
  const second = out.refresh()
  await flush()
  const third = out.refresh()
  await flush()
  expect(errors(out)).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1_999)
  expect(errors(out)).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1)
  await Promise.all([first, second, third])
  expect(out.m.q('conversations-error').textContent).toContain(unavailable.message)
  expect(count(out)).toBe(1)
})
