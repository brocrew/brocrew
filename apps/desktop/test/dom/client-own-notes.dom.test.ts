import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, provide, ref, shallowRef } from 'vue'
import OwnNotes from '../../src/renderer/src/components/OwnNotes.vue'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { OwnNotesReading, OwnNotesVersion } from '../../src/shared/own-notes'
import type { RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  vi.unstubAllGlobals()
})

function version(n: number, text: string): OwnNotesVersion {
  return {
    version: n,
    text,
    by: { who: 'a-person' },
    author: null,
    reason: 'Keep the agreed wording.',
    restoredFromVersion: null,
    writtenAt: 1700000000000 + n,
  }
}

function notes(text = 'Injected notes.', initialVersion = 2) {
  let current = version(initialVersion, text)
  let changed: Parameters<RuntimeBridge['onChanged']>[0] | undefined
  const stop = vi.fn()
  const transport = {
    agentOwnNotes: vi.fn(async function (
      this: unknown,
      { profileId }: { profileId: string },
    ): Promise<OwnNotesReading> {
      expect(this).toBe(transport)
      return { profile: profileId, versions: [current] }
    }),
    saveOwnNotes: vi.fn(async function (
      this: unknown,
      input: Parameters<RuntimeBridge['saveOwnNotes']>[0],
    ) {
      expect(this).toBe(transport)
      current = version(3, input.text)
      return { profile: input.profileId, versions: [current] }
    }),
    undoOwnNotes: vi.fn(async function (
      this: unknown,
      { profileId }: Parameters<RuntimeBridge['undoOwnNotes']>[0],
    ) {
      expect(this).toBe(transport)
      current = version(4, text)
      return { profile: profileId, versions: [current] }
    }),
    markOwnNotesSeen: vi.fn(async function (this: unknown) {
      expect(this).toBe(transport)
      return true
    }),
    onChanged: vi.fn(function (this: unknown, listener: Parameters<RuntimeBridge['onChanged']>[0]) {
      expect(this).toBe(transport)
      changed = listener
      return stop
    }),
  }
  return {
    transport,
    stop,
    publish() {
      changed?.({ what: 'agents' })
    },
  }
}

function screen(
  sessions: () => ClientSessionApi | undefined,
  props: () => { profileSlug: string; active: boolean; bridge?: RuntimeBridge },
) {
  const client = createDesktopProviderApi(
    (): never => {
      throw new Error('Unexpected provider operation')
    },
    () => undefined,
    () => undefined,
    sessions,
  )
  const raw = vi.fn(() => {
    throw new Error('Unexpected raw window operation')
  })
  vi.stubGlobal('api', { runtime: new Proxy({}, { get: raw }) })
  const view = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, client)
        return () => h(OwnNotes, props())
      },
    }),
    {},
  )
  return { view, raw }
}

async function edit(element: HTMLElement, value: string) {
  ;(element as HTMLTextAreaElement).value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}

describe('OwnNotes selected client', () => {
  it('uses the ancestor receiver for reads, saves, undo and visible acknowledgements', async () => {
    const f = notes()
    const { view, raw } = screen(
      () => f.transport as unknown as ClientSessionApi,
      () => ({
        profileSlug: 'quill',
        active: true,
      }),
    )
    await vi.waitFor(() =>
      expect(f.transport.markOwnNotesSeen).toHaveBeenCalledWith({
        profileId: 'quill',
        throughVersion: 2,
      }),
    )
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Injected notes.')
    await edit(view.q('own-notes-text'), '  Exact replacement.\n')
    await edit(view.q('own-notes-why'), 'Keep this correction.')
    view.q('own-notes-save').click()
    await vi.waitFor(() =>
      expect(f.transport.saveOwnNotes).toHaveBeenCalledExactlyOnceWith({
        profileId: 'quill',
        text: '  Exact replacement.\n',
        why: 'Keep this correction.',
        expectedVersion: 2,
      }),
    )
    await vi.waitFor(() =>
      expect(f.transport.markOwnNotesSeen).toHaveBeenCalledWith({
        profileId: 'quill',
        throughVersion: 3,
      }),
    )
    view.q('own-notes-undo').click()
    await vi.waitFor(() =>
      expect(f.transport.undoOwnNotes).toHaveBeenCalledExactlyOnceWith({
        profileId: 'quill',
        expectedVersion: 3,
      }),
    )
    await vi.waitFor(() =>
      expect(f.transport.markOwnNotesSeen).toHaveBeenCalledWith({
        profileId: 'quill',
        throughVersion: 4,
      }),
    )
    expect(raw).not.toHaveBeenCalled()
    unmountAll()
    expect(f.stop).toHaveBeenCalledTimes(1)
  })

  it('keeps overrides live and subscribes only to the bridge selected at mount', async () => {
    const injected = notes('Selected session.')
    const first = notes('First override.')
    const second = notes('Second override.')
    const override = shallowRef<RuntimeBridge | undefined>(
      first.transport as unknown as RuntimeBridge,
    )
    const active = ref(true)
    const selected = vi.fn(() => injected.transport as unknown as ClientSessionApi)
    const { view, raw } = screen(selected, () => ({
      profileSlug: 'quill',
      active: active.value,
      bridge: override.value,
    }))
    await vi.waitFor(() => expect(first.transport.agentOwnNotes).toHaveBeenCalledTimes(1))
    expect(selected).not.toHaveBeenCalled()
    override.value = second.transport as unknown as RuntimeBridge
    active.value = false
    await nextTick()
    active.value = true
    await vi.waitFor(() =>
      expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Second override.'),
    )
    expect(second.transport.onChanged).not.toHaveBeenCalled()
    override.value = undefined
    active.value = false
    await nextTick()
    active.value = true
    await vi.waitFor(() =>
      expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Selected session.'),
    )
    expect(injected.transport.onChanged).not.toHaveBeenCalled()
    expect(first.transport.onChanged).toHaveBeenCalledTimes(1)
    expect(raw).not.toHaveBeenCalled()
    unmountAll()
    expect(first.stop).toHaveBeenCalledTimes(1)
    expect(second.stop).not.toHaveBeenCalled()
    expect(injected.stop).not.toHaveBeenCalled()
  })

  it('retains a draft and refreshes through the injected receiver after a rejected save', async () => {
    const f = notes()
    f.transport.saveOwnNotes.mockRejectedValue(new Error('Fictional interrupted write'))
    const { view, raw } = screen(
      () => f.transport as unknown as ClientSessionApi,
      () => ({ profileSlug: 'quill', active: true }),
    )
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-text"]')).not.toBeNull(),
    )
    await edit(view.q('own-notes-text'), 'Keep my unfinished draft.')
    await edit(view.q('own-notes-why'), 'Still editing.')
    view.q('own-notes-save').click()
    await vi.waitFor(() =>
      expect(view.q('own-notes').textContent).toContain(
        'This app could not save these notes. Your draft is still here.',
      ),
    )
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe(
      'Keep my unfinished draft.',
    )
    expect(f.transport.agentOwnNotes).toHaveBeenCalledTimes(2)
    expect(raw).not.toHaveBeenCalled()
  })

  it('ignores a late injected read after the profile changes', async () => {
    const f = notes()
    let finish!: (reading: OwnNotesReading) => void
    f.transport.agentOwnNotes.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const profile = ref('quill')
    const { view } = screen(
      () => f.transport as unknown as ClientSessionApi,
      () => ({ profileSlug: profile.value, active: true }),
    )
    profile.value = 'wren'
    await vi.waitFor(() =>
      expect(f.transport.agentOwnNotes).toHaveBeenCalledWith({ profileId: 'wren' }),
    )
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-text"]')).not.toBeNull(),
    )
    finish({ profile: 'quill', versions: [version(9, 'Stale old profile.')] })
    await nextTick()
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Injected notes.')
    expect(f.transport.markOwnNotesSeen.mock.calls).not.toContainEqual([
      { profileId: 'quill', throughVersion: 9 },
    ])
  })

  it('uses the current selected sessions on refresh while keeping a dirty draft unread', async () => {
    const first = notes('Original notes.')
    const second = notes('A later capability reading.', 3)
    const selected = shallowRef(first.transport)
    const { view, raw } = screen(
      () => selected.value as unknown as ClientSessionApi,
      () => ({ profileSlug: 'quill', active: true }),
    )
    await vi.waitFor(() => expect(first.transport.markOwnNotesSeen).toHaveBeenCalled())
    await edit(view.q('own-notes-text'), 'Unfinished local draft.')
    selected.value = second.transport
    first.publish()
    await vi.waitFor(() => expect(second.transport.agentOwnNotes).toHaveBeenCalledTimes(1))
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Unfinished local draft.')
    expect(second.transport.onChanged).not.toHaveBeenCalled()
    expect(second.transport.markOwnNotesSeen).not.toHaveBeenCalled()
    expect(raw).not.toHaveBeenCalled()
  })

  it('retains the undo failure words and refreshes after a rejected injected undo', async () => {
    const f = notes()
    f.transport.undoOwnNotes.mockRejectedValue(new Error('Fictional undo failure'))
    const { view } = screen(
      () => f.transport as unknown as ClientSessionApi,
      () => ({ profileSlug: 'quill', active: true }),
    )
    await vi.waitFor(() =>
      expect(view.host.querySelector('[data-cy="own-notes-undo"]')).not.toBeNull(),
    )
    view.q('own-notes-undo').click()
    await vi.waitFor(() =>
      expect(view.q('own-notes').textContent).toContain(
        'This app could not undo this change. Read the latest version, then try again.',
      ),
    )
    expect(f.transport.agentOwnNotes).toHaveBeenCalledTimes(2)
    expect((view.q('own-notes-text') as HTMLTextAreaElement).value).toBe('Injected notes.')
  })

  it('keeps an absent capability unreadable without using the raw bridge', async () => {
    const { view, raw } = screen(
      () => undefined,
      () => ({ profileSlug: 'quill', active: true }),
    )
    await vi.waitFor(() =>
      expect(view.q('own-notes-unreadable').textContent).toContain(
        'This app could not read these notes. Close and open this again.',
      ),
    )
    expect(view.host.querySelector('[data-cy="own-notes-empty"]')).toBeNull()
    expect(raw).not.toHaveBeenCalled()
  })
})
