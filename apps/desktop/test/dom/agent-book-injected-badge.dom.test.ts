import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, onErrorCaptured, provide, reactive } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { InstructionUnread } from '../../src/shared/own-instructions'
import type { RuntimeBridge, RuntimeChangeMessage } from '../../src/shared/runtime-ipc'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { CLIENT_PROVIDERS } from '../../src/renderer/src/client-provider/injection'
import AgentBookButton from '../../src/renderer/src/components/AgentBookButton.vue'
import { mount, unmountAll } from './harness'

type BookBridge = Pick<RuntimeBridge, 'agentRulesUnread'> &
  Partial<Pick<RuntimeBridge, 'agentOwnNotesUnread' | 'onChanged'>>
const rules = (unread: boolean): InstructionUnread => ({
  unread,
  seenThrough: 0,
  newestDirectVersion: 1,
})
const settle = async () => {
  for (let i = 0; i < 8; i++) await nextTick()
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function badge(over: { bridge?: BookBridge; absent?: boolean; noNotes?: boolean } = {}) {
  let listener: Parameters<ClientSessionApi['onChanged']>[0] | undefined
  const stop = vi.fn(() => {
    listener = undefined
  })
  const transport = {
    agentRulesUnread: vi.fn<ClientSessionApi['agentRulesUnread']>(async () => rules(false)),
    agentOwnNotesUnread: vi.fn<ClientSessionApi['agentOwnNotesUnread']>(async () => ({
      unread: false,
      seenThrough: 0,
      newestAgentVersion: 1,
    })),
    onChanged: vi.fn<ClientSessionApi['onChanged']>((next) => {
      listener = next
      return stop
    }),
  }
  const wrong = vi.fn(async () => rules(true))
  Reflect.set(window, 'api', {
    runtime: {
      agentRulesUnread: wrong,
      agentOwnNotesUnread: wrong,
      onChanged: vi.fn(() => vi.fn()),
    },
  })
  const capability = over.absent
    ? undefined
    : over.noNotes
      ? { agentRulesUnread: transport.agentRulesUnread }
      : transport
  const supplier = vi.fn(() => capability as unknown as ClientSessionApi | undefined)
  const api = createDesktopProviderApi(
    (): never => {
      throw new Error('No provider reads expected')
    },
    () => undefined,
    () => undefined,
    supplier,
  )
  const props = reactive({ profileSlug: 'fern', bridge: over.bridge, compact: false })
  const opened = vi.fn()
  const errors: unknown[] = []
  const view = mount(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        onErrorCaptured((error) => {
          errors.push(error)
          return false
        })
        return () => h(AgentBookButton, { ...props, onOpen: opened })
      },
    }),
    {},
  )
  return {
    view,
    props,
    transport,
    supplier,
    stop,
    wrong,
    opened,
    errors,
    publish: (message: RuntimeChangeMessage) => listener?.(message),
  }
}
afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})
it('uses injected unread facts, retains known true across failure, and unsubscribes once', async () => {
  const out = badge()
  await settle()
  expect(out.view.all('agent-book-unread')).toHaveLength(0)
  expect(out.view.q('agent-book-button').getAttribute('aria-label')).toBe('Open agent knowledge')
  out.transport.agentOwnNotesUnread.mockResolvedValueOnce({
    unread: true,
    seenThrough: 0,
    newestAgentVersion: 2,
  })
  out.publish({ what: 'conversations' })
  expect(out.transport.agentOwnNotesUnread).toHaveBeenCalledTimes(1)
  out.publish({ what: 'agents' })
  await settle()
  expect(out.view.all('agent-book-unread')).toHaveLength(1)
  out.transport.agentRulesUnread.mockRejectedValueOnce(new Error('Supplied rules read failed'))
  out.publish({ what: 'agents' })
  await settle()
  expect(out.view.all('agent-book-unread')).toHaveLength(1)
  out.publish({ what: 'agents' })
  await settle()
  expect(out.view.all('agent-book-unread')).toHaveLength(0)
  out.view.q('agent-book-button').click()
  expect(out.opened).toHaveBeenCalledExactlyOnceWith('fern')
  expect(out.transport.onChanged).toHaveBeenCalledTimes(1)
  const count = out.transport.agentRulesUnread.mock.calls.length
  out.view.unmount()
  out.publish({ what: 'agents' })
  expect(out.stop).toHaveBeenCalledTimes(1)
  expect(out.transport.agentRulesUnread).toHaveBeenCalledTimes(count)
  expect(out.wrong).not.toHaveBeenCalled()
})
it('reads the current live override on the original subscription without resubscribing', async () => {
  const out = badge()
  await settle()
  const override = {
    agentRulesUnread: vi.fn(async () => rules(true)),
    onChanged: vi.fn(() => vi.fn()),
  }
  out.props.bridge = override
  await settle()
  expect(override.agentRulesUnread).not.toHaveBeenCalled()
  out.publish({ what: 'agents' })
  await settle()
  expect(out.view.all('agent-book-unread')).toHaveLength(1)
  expect(override.agentRulesUnread).toHaveBeenCalledExactlyOnceWith({ profileId: 'fern' })
  expect(override.onChanged).not.toHaveBeenCalled()
  out.props.bridge = undefined
  await settle()
  out.publish({ what: 'agents' })
  await settle()
  expect(out.view.all('agent-book-unread')).toHaveLength(0)
  expect(out.transport.onChanged).toHaveBeenCalledTimes(1)
  expect(out.wrong).not.toHaveBeenCalled()
})
it('ignores late reads for an older profile and after unmount', async () => {
  const pending = deferred<InstructionUnread>()
  const override = {
    agentRulesUnread: vi
      .fn<ClientSessionApi['agentRulesUnread']>()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(rules(false)),
  }
  const out = badge({ bridge: override })
  out.props.profileSlug = 'cedar'
  await settle()
  expect(out.view.q('agent-book-button').getAttribute('aria-label')).toBe('Open agent knowledge')
  pending.resolve(rules(true))
  await settle()
  expect(out.view.all('agent-book-unread')).toHaveLength(0)
  const late = deferred<InstructionUnread>()
  override.agentRulesUnread.mockReturnValueOnce(late.promise)
  out.props.profileSlug = 'birch'
  await settle()
  out.view.unmount()
  late.resolve(rules(true))
  await settle()
  expect(out.view.host.isConnected).toBe(false)
  expect(out.wrong).not.toHaveBeenCalled()
})
it.each([true, false])(
  'distinguishes absent capability from optional notes absence (absent: %s)',
  async (absent) => {
    const out = badge({ absent, noNotes: true })
    await settle()
    expect(out.view.all('agent-book-unread')).toHaveLength(0)
    expect(out.view.q('agent-book-button').getAttribute('aria-label')).toBe(
      absent ? "Open agent knowledge · couldn't check for changes" : 'Open agent knowledge',
    )
    expect(out.transport.agentOwnNotesUnread).not.toHaveBeenCalled()
    expect(out.transport.onChanged).not.toHaveBeenCalled()
    expect(out.wrong).not.toHaveBeenCalled()
  },
)
it('keeps synchronous read errors on the existing unknown-state path', async () => {
  const override = {
    agentRulesUnread: vi.fn<ClientSessionApi['agentRulesUnread']>(() => {
      throw new Error('Supplied synchronous read failure')
    }),
  }
  const out = badge({ bridge: override })
  await settle()
  expect(out.view.q('agent-book-button').getAttribute('aria-label')).toContain(
    "couldn't check for changes",
  )
  expect(out.errors).toEqual([])
  expect(out.wrong).not.toHaveBeenCalled()
})
it('preserves the mounted-hook escape path for a present subscription getter error', async () => {
  const failure = new Error('Supplied subscription getter failed')
  const override: BookBridge = {
    agentRulesUnread: async () => rules(false),
    get onChanged(): ClientSessionApi['onChanged'] {
      throw failure
    },
  }
  const out = badge({ bridge: override })
  await settle()
  expect(out.errors).toEqual([failure])
  expect(out.supplier).not.toHaveBeenCalled()
  expect(out.view.q('agent-book-button').getAttribute('aria-label')).toBe('Open agent knowledge')
})
