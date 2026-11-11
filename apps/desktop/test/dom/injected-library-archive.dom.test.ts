import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { ArchiveOutcome } from '../../src/shared/conversation-archive'
import type { LibraryPage } from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import SessionLibrary from '../../src/renderer/src/components/SessionLibrary.vue'
import { mount, unmountAll } from './harness'
import { entry, page, stub, stubbed } from './library-filter-fixture'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: Error) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const conversations = ['fictional-record', 'fictional-helper']
const success: ArchiveOutcome = { done: true, conversations }
const refusal: ArchiveOutcome = { done: false, refusal: 'Fictional host is still archiving.' }
const gestures = [
  { action: 'archive', operation: 'archiveConversation' },
  { action: 'restore', operation: 'restoreConversation' },
] as const

type Gesture = (typeof gestures)[number]

function open(gesture: Gesture, rawAnswer: ArchiveOutcome) {
  const row = entry({
    id: 'fictional-row',
    recordId: 'fictional-record',
    archivedAt: gesture.action === 'restore' ? Date.now() : undefined,
  })
  const initial = page({ entries: [row], matched: 1 })
  stub(() => initial)
  const raw = {
    listLibrary: vi.fn(async () => initial),
    archiveConversation: vi.fn(async () => rawAnswer),
    restoreConversation: vi.fn(async () => rawAnswer),
  }
  Object.assign(stubbed().api!.runtime, raw)
  const operation = vi.fn<(input: { sessionId: string }) => Promise<ArchiveOutcome>>(function (
    this: unknown,
  ) {
    expect(this).toBe(sessions)
    return Promise.resolve(success)
  })
  const sessions = { listLibrary: raw.listLibrary, [gesture.operation]: operation }
  let available = true
  let lookupFailure: Error | undefined
  const lookup = vi.fn(() => {
    if (lookupFailure) throw lookupFailure
    return available ? (sessions as unknown as ClientSessionApi) : undefined
  })
  const client = createDesktopProviderApi(
    () => {
      throw new Error('Unexpected provider call')
    },
    () => undefined,
    () => undefined,
    lookup,
  )
  const archived = vi.fn()
  const read = vi.fn()
  const root = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, client)
      return () => h(SessionLibrary, { onArchived: archived, onRead: read })
    },
  })
  const view = mount(root, {})
  const button = () => view.q(`library-${gesture.action}-fictional-row`) as HTMLButtonElement
  const refused = () => view.all(`library-${gesture.action}-refused-fictional-row`)
  return {
    initial,
    view,
    button,
    refused,
    operation,
    sessions,
    lookup,
    raw,
    archived,
    read,
    setAvailable(value: boolean) {
      available = value
    },
    failLookup(cause?: Error) {
      lookupFailure = cause
    },
  }
}

async function ready() {
  await nextTick()
  await nextTick()
  await nextTick()
}

afterEach(() => {
  unmountAll()
  delete stubbed().api
})

for (const gesture of gestures) {
  describe(`injected library ${gesture.action}`, () => {
    it('keeps the row busy through the actual operation and awaited refresh', async () => {
      const state = open(gesture, refusal)
      await ready()
      const lookupsBefore = state.lookup.mock.calls.length
      const pending = deferred<ArchiveOutcome>()
      const refreshing = deferred<LibraryPage>()
      state.operation.mockReturnValueOnce(pending.promise)
      state.raw.listLibrary.mockReturnValueOnce(refreshing.promise)
      state.button().click()
      await nextTick()
      expect(state.lookup).toHaveBeenCalledTimes(lookupsBefore + 1)
      expect(state.operation.mock.calls).toEqual([[{ sessionId: 'fictional-record' }]])
      expect(state.operation.mock.contexts).toEqual([state.sessions])
      expect(state.button().disabled).toBe(true)
      state.button().click()
      expect(state.operation).toHaveBeenCalledTimes(1)
      expect(state.raw.listLibrary).toHaveBeenCalledTimes(1)
      expect(state.archived).not.toHaveBeenCalled()
      expect(state.read).not.toHaveBeenCalled()
      pending.resolve(success)
      await expect.poll(() => state.raw.listLibrary.mock.calls.length).toBe(2)
      expect(state.archived.mock.calls).toEqual(
        gesture.action === 'archive' ? [[conversations]] : [],
      )
      expect(state.button().disabled).toBe(true)
      state.button().click()
      expect(state.operation).toHaveBeenCalledTimes(1)
      refreshing.resolve(state.initial)
      await expect.poll(() => state.button().disabled).toBe(false)
      expect(state.refused()).toHaveLength(0)
      expect(state.raw.archiveConversation).not.toHaveBeenCalled()
      expect(state.raw.restoreConversation).not.toHaveBeenCalled()
    })

    it('releases the row after a failed refresh while retaining the successful action outcome', async () => {
      const state = open(gesture, refusal)
      await ready()
      const refreshing = deferred<LibraryPage>()
      state.raw.listLibrary.mockReturnValueOnce(refreshing.promise)
      state.button().click()
      await expect.poll(() => state.raw.listLibrary.mock.calls.length).toBe(2)
      expect(state.button().disabled).toBe(true)
      refreshing.reject(new Error('Fictional library refresh failed.'))
      await expect.poll(() => state.button().disabled).toBe(false)
      expect(state.view.host.textContent).toContain('Fictional library refresh failed.')
      expect(state.refused()).toHaveLength(0)
      expect(state.archived.mock.calls).toEqual(
        gesture.action === 'archive' ? [[conversations]] : [],
      )
      expect(state.raw.archiveConversation).not.toHaveBeenCalled()
      expect(state.raw.restoreConversation).not.toHaveBeenCalled()
    })

    for (const failure of ['host refusal', 'throw', 'rejection', 'absent', 'getter'] as const) {
      it(`shows ${failure} on its row without refresh, then allows a retry`, async () => {
        const state = open(gesture, success)
        await ready()
        const lookupsBefore = state.lookup.mock.calls.length
        const message =
          failure === 'absent' ? 'Session library is unavailable' : 'Fictional failure.'
        if (failure === 'host refusal') {
          state.operation.mockResolvedValueOnce({ done: false, refusal: message })
        } else if (failure === 'throw') {
          state.operation.mockImplementationOnce(() => {
            throw new Error(message)
          })
        } else if (failure === 'rejection') {
          state.operation.mockRejectedValueOnce(new Error(message))
        } else if (failure === 'absent') {
          state.setAvailable(false)
        } else {
          state.failLookup(new Error(message))
        }
        state.button().click()
        await expect.poll(() => state.refused()[0]?.textContent?.trim()).toBe(message)
        expect(state.lookup).toHaveBeenCalledTimes(lookupsBefore + 1)
        expect(state.refused()[0]!.getAttribute('role')).toBe('alert')
        expect(state.button().disabled).toBe(false)
        expect(state.raw.listLibrary).toHaveBeenCalledTimes(1)
        expect(state.archived).not.toHaveBeenCalled()
        expect(state.read).not.toHaveBeenCalled()
        expect(state.raw.archiveConversation).not.toHaveBeenCalled()
        expect(state.raw.restoreConversation).not.toHaveBeenCalled()
        if (failure === 'absent' || failure === 'getter') {
          expect(state.operation).not.toHaveBeenCalled()
        } else {
          expect(state.operation.mock.calls).toEqual([[{ sessionId: 'fictional-record' }]])
        }
        state.setAvailable(true)
        state.failLookup()
        const pending = deferred<ArchiveOutcome>()
        state.operation.mockReturnValueOnce(pending.promise)
        state.button().click()
        await nextTick()
        expect(state.refused()).toHaveLength(0)
        expect(state.button().disabled).toBe(true)
        pending.resolve(success)
        await expect.poll(() => state.raw.listLibrary.mock.calls.length).toBe(2)
        await expect.poll(() => state.button().disabled).toBe(false)
        expect(state.archived.mock.calls).toEqual(
          gesture.action === 'archive' ? [[conversations]] : [],
        )
      })
    }
  })
}
