import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { ClientApi } from '../../src/shared/client-api'
import type {
  RecoveryRetentionClient,
  RetainedRecoveryCopy,
} from '../../src/shared/recovery-retention'
import RecoveryCopiesSection from '../../src/renderer/src/components/RecoveryCopiesSection.vue'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { mount, unmountAll } from './harness'

const copy: RetainedRecoveryCopy = { id: 'fern-copy', bytes: 2_500_000_000, appVersion: '0.0.7' }
const runtime = (): never => {
  throw new Error('Recovery must not call provider transport')
}
function screen(recovery?: RecoveryRetentionClient) {
  const api: ClientApi = createDesktopProviderApi(
    runtime,
    () => undefined,
    () => recovery,
  )
  return mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(RecoveryCopiesSection)
      },
    }),
    {},
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('An injected recovery view must not reach desktop globals')
    },
  })
})
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

it('reads the injected copy and requires confirmation before deleting and refreshing', async () => {
  let kept: RetainedRecoveryCopy | null = copy
  let release!: () => void
  const read = vi.fn(async () => kept)
  const remove = vi.fn(async () => {
    await new Promise<void>((resolve) => {
      release = resolve
    })
    kept = null
  })
  const view = screen({ read, deleteNow: remove })
  await vi.waitFor(() => expect(view.q('recovery-retention').textContent).toContain('2.5 GB'))
  expect(view.q('recovery-retention').textContent).toContain('0.0.7')
  view.q('recovery-delete').click()
  await nextTick()
  expect(remove).not.toHaveBeenCalled()
  view.q('recovery-delete-cancel').click()
  await nextTick()
  expect(view.all('recovery-delete-confirmation')).toHaveLength(0)
  view.q('recovery-delete').click()
  await nextTick()
  view.q('recovery-delete-confirm').click()
  await nextTick()
  expect(remove).toHaveBeenCalledExactlyOnceWith(copy.id)
  expect((view.q('recovery-delete-confirm') as HTMLButtonElement).disabled).toBe(true)
  view.q('recovery-delete-confirm').dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(remove).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(1)
  release()
  await vi.waitFor(() =>
    expect(view.q('recovery-retention').textContent).toContain('No recovery copy kept.'),
  )
  expect(read).toHaveBeenCalledTimes(2)
})

it('retains the copy and releases confirmation/busy state when deletion rejects', async () => {
  const read = vi.fn(async () => copy)
  const remove = vi.fn(async () => {
    throw new Error('Fictional file is busy')
  })
  const view = screen({ read, deleteNow: remove })
  await vi.waitFor(() => expect(view.all('recovery-delete')).toHaveLength(1))
  view.q('recovery-delete').click()
  await nextTick()
  view.q('recovery-delete-confirm').click()
  await vi.waitFor(() =>
    expect(view.q('recovery-retention').textContent).toContain(
      "Couldn't delete the recovery copy. Try again.",
    ),
  )
  expect(view.q('recovery-retention').textContent).toContain('2.5 GB')
  expect(view.all('recovery-delete-confirmation')).toHaveLength(0)
  expect(view.all('recovery-delete')).toHaveLength(1)
  expect(read).toHaveBeenCalledTimes(1)
})

it('shows a rejected read and does not fall back when the injected capability is absent', async () => {
  const rejected = screen({
    read: async () => {
      throw new Error('Fictional recovery unavailable')
    },
    deleteNow: async () => {},
  })
  await vi.waitFor(() =>
    expect(rejected.q('recovery-retention').textContent).toContain("That didn't work. Try again."),
  )
  const absent = screen()
  await nextTick()
  expect(absent.q('recovery-retention').textContent).toContain('Reading recovery copy')
  expect(absent.all('recovery-delete')).toHaveLength(0)
})

it('keeps a late answer from a disposed view out of a newly mounted view', async () => {
  let finish!: (answer: RetainedRecoveryCopy | null) => void
  const read = vi.fn(
    () =>
      new Promise<RetainedRecoveryCopy | null>((resolve) => {
        finish = resolve
      }),
  )
  const previous = screen({ read, deleteNow: async () => {} })
  expect(read).toHaveBeenCalledTimes(1)
  previous.unmount()
  const current = screen({ read: async () => null, deleteNow: async () => {} })
  await vi.waitFor(() =>
    expect(current.q('recovery-retention').textContent).toContain('No recovery copy kept.'),
  )
  finish(copy)
  await nextTick()
  expect(current.q('recovery-retention').textContent).toContain('No recovery copy kept.')
  expect(current.all('recovery-delete')).toHaveLength(0)
  expect(read).toHaveBeenCalledTimes(1)
})
