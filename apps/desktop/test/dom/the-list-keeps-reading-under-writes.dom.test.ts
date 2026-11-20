import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Ref } from 'vue'
import SideRail from '../../src/renderer/src/components/SideRail.vue'
import type { ListingAnswer, PublishedListing } from '../../src/shared/listing-published'
import type { UnresumableSessionInfo, RuntimeStatesMessage } from '../../src/shared/runtime-ipc'
import type { ListedConversation } from '../../src/renderer/src/lib/conversation-list'
import { appClosing } from '../../src/renderer/src/lib/app-closing'
import { useConversationListRecovery } from '../../src/renderer/src/composables/useConversationListRecovery'
import { mount, unmountAll, type Mounted } from './harness'

vi.mock('../../src/renderer/src/lib/app-closing', async () => {
  const { ref } = await import('vue')
  return { appClosing: ref(false) }
})

const epoch = { run: 'fictional-run', n: 0 }
const row = (id: string): UnresumableSessionInfo => ({
  sessionId: id,
  provider: 'codex',
  cwd: '/fictional',
  profileId: 'brobot',
  status: 'idle',
  state: { is: 'idle' },
  named: null,
  running: 'not-running',
  updatedAt: 1,
  reason: 'no-provider-session',
  adoptedAt: null,
  hasTranscript: true,
  foundInUserHome: false,
  restoredFromBundle: false,
  lastEnding: null,
})
const answer = (
  seq: number,
  readAsOf: number,
  ids: string[],
  refresh = false,
): PublishedListing => ({
  resumable: [],
  unresumable: ids.map(row),
  readAsOf,
  refresh,
  published: { epoch, seq, covers: { population: 'listing', complete: true } },
})
const tick = async () => {
  await vi.advanceTimersByTimeAsync(0)
  await nextTick()
}
const refresh = (rail: Mounted) => (rail.vm.refreshResumable as () => Promise<void>)()
const listed = (rail: Mounted, id: string) =>
  (rail.vm.listedOf as (id: string) => ListedConversation | null)(id)
const pending = () => {
  let resolve!: (value: ListingAnswer) => void
  const promise = new Promise<ListingAnswer>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const api = window as unknown as {
  api?: { runtime: { listConversations: () => Promise<ListingAnswer> } }
}
const previous = api.api
function rail(read: () => Promise<ListingAnswer>) {
  api.api = { runtime: { listConversations: read } }
  return mount(SideRail, {
    open: [],
    activeId: null,
    place: null,
    workspaceFolder: { path: '/fictional', name: 'Fictional' },
  })
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  ;(appClosing as Ref<boolean>).value = false
})
afterEach(() => {
  unmountAll()
  api.api = previous
  vi.useRealTimers()
})

it('shows a completed read despite newer asks and coalesces all asks into one refresh', async () => {
  const first = pending()
  const read = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValue(answer(2, 2, ['new']))
  const view = rail(read)
  for (let i = 0; i < 30; i++) await refresh(view)
  expect(read).toHaveBeenCalledOnce()
  first.resolve(answer(1, 1, ['first']))
  await tick()
  expect(listed(view, 'first')).not.toBeNull()
  await vi.advanceTimersByTimeAsync(1_000)
  await tick()
  expect(read).toHaveBeenCalledTimes(2)
  expect(listed(view, 'new')).not.toBeNull()
  expect(listed(view, 'first')).toBeNull()
  await vi.advanceTimersByTimeAsync(5_000)
  expect(read).toHaveBeenCalledTimes(2)
})

it('drops older and equal reads but accepts a newer snapshot at the same publication floor', async () => {
  const read = vi.fn().mockResolvedValue(answer(4, 4, ['new']))
  const view = rail(read)
  await tick()
  read.mockResolvedValue(answer(4, 3, ['old']))
  await refresh(view)
  expect(listed(view, 'old')).toBeNull()
  read.mockResolvedValue(answer(4, 4, ['equal']))
  await refresh(view)
  expect(listed(view, 'equal')).toBeNull()
  read.mockResolvedValue(answer(4, 5, ['later'], true))
  await refresh(view)
  expect(listed(view, 'later')).not.toBeNull()
  read.mockResolvedValue(answer(4, 6, ['quiet']))
  await vi.advanceTimersByTimeAsync(1_000)
  await tick()
  expect(listed(view, 'quiet')).not.toBeNull()
})

it('retains later pushes and incomplete membership while retrying beyond two seconds', async () => {
  const read = vi.fn().mockResolvedValue(answer(1, 1, ['kept', 'active']))
  const view = rail(read)
  await tick()
  ;(view.vm.hearStates as (message: RuntimeStatesMessage) => void)({
    moved: [{ conversation: 'active', state: { is: 'needs-you' } }],
    kept: [],
    published: { epoch, seq: 9 },
  })
  read.mockRejectedValue(new Error('fictional read failure'))
  await refresh(view)
  expect(view.all('conversations-error')).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(2_000)
  expect(view.q('conversations-error').textContent).toContain('fictional read failure')
  await vi.advanceTimersByTimeAsync(2_000)
  expect(read).toHaveBeenCalledTimes(6)
  expect(listed(view, 'kept')).not.toBeNull()
  const partial = answer(3, 3, ['active'])
  read.mockResolvedValue({
    ...partial,
    published: {
      ...partial.published,
      covers: { population: 'listing', complete: false, ids: ['active'] },
    },
  })
  await vi.advanceTimersByTimeAsync(1_000)
  await tick()
  expect(listed(view, 'kept')).not.toBeNull()
  expect(listed(view, 'active')?.state.is).toBe('needs-you')
  expect(view.all('conversations-error')).toHaveLength(0)
})

it('keeps the exact Recent total with the accepted coverage, then recovers it after incomplete reads', async () => {
  const read = vi.fn().mockResolvedValue(answer(4, 4, ['kept', 'older']))
  const view = rail(read)
  await tick()
  const count = () => view.q('rail-count-recent').textContent?.trim()
  expect(count()).toBe('2 of 2')

  read.mockResolvedValue({ refused: 'outdated refusal', published: { epoch, seq: 3 } })
  await refresh(view)
  expect(count()).toBe('2 of 2')

  const partial = answer(5, 5, ['kept'])
  read.mockResolvedValue({
    ...partial,
    published: {
      ...partial.published,
      covers: { population: 'listing', complete: false, ids: ['kept'] },
    },
  })
  await refresh(view)
  expect(count()).toBe('2 shown')
  expect(view.all('open-session-older')).toHaveLength(1)

  read.mockResolvedValue(answer(4, 6, ['outdated']))
  await refresh(view)
  expect(count()).toBe('2 shown')
  expect(view.all('open-session-outdated')).toHaveLength(0)

  read.mockResolvedValue(answer(6, 7, ['kept'], true))
  await refresh(view)
  expect(count()).toBe('1 shown')

  read.mockResolvedValue(answer(6, 8, ['kept']))
  await refresh(view)
  expect(count()).toBe('1 of 1')

  read.mockResolvedValue({ refused: 'current refusal', published: { epoch, seq: 6 } })
  await refresh(view)
  expect(count()).toBe('1 shown')
  expect(view.all('open-session-kept')).toHaveLength(1)
  read.mockResolvedValue(answer(7, 9, ['kept', 'new']))
  await refresh(view)
  expect(count()).toBe('2 of 2')
})

it('cancels a retry when the app closes', async () => {
  const read = vi.fn().mockRejectedValue(new Error('fictional unavailable'))
  rail(read)
  await tick()
  ;(appClosing as Ref<boolean>).value = true
  await vi.advanceTimersByTimeAsync(5_000)
  expect(read).toHaveBeenCalledOnce()
})

it('invalidates only the old workspace and cancels pending timers on unmount', async () => {
  const workspace = ref('/first')
  const reset = vi.fn()
  let recovery!: ReturnType<typeof useConversationListRecovery>
  const view = mount(
    defineComponent({
      setup() {
        recovery = useConversationListRecovery(() => workspace.value, reset)
        return () => h('div')
      },
    }),
    {},
  )
  const old = recovery.begin()!
  workspace.value = '/second'
  expect(reset).toHaveBeenCalledOnce()
  expect(recovery.current(old)).toBe(false)
  const next = recovery.begin()!
  expect(recovery.current(next)).toBe(true)
  const refresh = vi.fn()
  recovery.finish(old, true, refresh)
  await vi.advanceTimersByTimeAsync(1_000)
  expect(refresh).not.toHaveBeenCalled()
  recovery.finish(next, true, refresh)
  view.unmount()
  await vi.advanceTimersByTimeAsync(5_000)
  expect(refresh).not.toHaveBeenCalled()
  expect(recovery.current(next)).toBe(false)
})

it('does not publish an in-flight result after unmount', async () => {
  const first = pending()
  const read = vi.fn(() => first.promise)
  const view = rail(read)
  view.unmount()
  first.resolve(answer(1, 1, ['late']))
  await tick()
  expect(listed(view, 'late')).toBeNull()
  await vi.advanceTimersByTimeAsync(5_000)
  expect(read).toHaveBeenCalledOnce()
})

it('ignores older pushes but retains pushes at or beyond the listing floor', async () => {
  const view = rail(async () => answer(10, 1, ['shown']))
  await tick()
  ;(view.vm.hearStates as (message: RuntimeStatesMessage) => void)({
    moved: [{ conversation: 'shown', state: { is: 'needs-you' } }],
    kept: [],
    published: { epoch, seq: 9 },
  })
  await tick()
  expect(listed(view, 'shown')?.state.is).toBe('idle')
  ;(view.vm.hearStates as (message: RuntimeStatesMessage) => void)({
    moved: [{ conversation: 'shown', state: { is: 'needs-you' } }],
    kept: [],
    published: { epoch, seq: 10 },
  })
  await tick()
  expect(listed(view, 'shown')?.state.is).toBe('needs-you')
  ;(view.vm.hearStates as (message: RuntimeStatesMessage) => void)({
    moved: [{ conversation: 'shown', state: { is: 'idle' } }],
    kept: [],
    published: { epoch, seq: 11 },
  })
  await tick()
  expect(listed(view, 'shown')?.state.is).toBe('idle')
})

it('does not replay omitted provider facts from a partial listing', async () => {
  const initial = answer(1, 1, ['included', 'omitted'])
  const read = vi.fn().mockResolvedValue({
    ...initial,
    unresumable: initial.unresumable.map((row) => ({
      ...row,
      providerBlock: null,
      providerBlockStatus: 'current',
    })),
  })
  const view = rail(read)
  await tick()
  const blocked = { provider: 'codex' as const, resetsAt: null }
  ;(view.vm.hearStates as (message: RuntimeStatesMessage) => void)({
    moved: [
      {
        conversation: 'omitted',
        state: { is: 'idle' },
        providerBlock: blocked,
        providerBlockStatus: 'current',
      },
    ],
    kept: [],
    published: { epoch, seq: 2 },
  })
  await tick()
  expect(listed(view, 'omitted')?.providerBlock).toEqual(blocked)
  const partial = answer(3, 2, ['included'])
  read.mockResolvedValue({
    ...partial,
    published: {
      ...partial.published,
      covers: { population: 'listing', complete: false, ids: ['included'] },
    },
  })
  await refresh(view)
  expect(listed(view, 'omitted')?.providerBlock).toEqual(blocked)
})
