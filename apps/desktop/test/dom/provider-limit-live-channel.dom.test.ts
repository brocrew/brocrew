import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createSessionStore, type SessionStore } from '../../src/renderer/src/lib/session-store'
import type {
  ResumedSession,
  RuntimeBridge,
  SessionLivenessMessage,
} from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, unmountAll } from './harness'

const stores: SessionStore[] = []
const NOW = Date.now()
const current = {
  providerBlockStatus: 'current',
  providerBlock: { provider: 'claude', resetsAt: NOW + 3600000 },
} as const
afterEach(() => {
  unmountAll()
  for (const store of stores.splice(0)) store.dispose()
})

describe('The real store receives current provider facts on its liveness channel', () => {
  it('changes reasons with unchanged queue IDs, invalidates failed reads and clears both surfaces without a start or history read', async () => {
    const wire: { receive?: (message: SessionLivenessMessage) => void } = {}
    const handed: ResumedSession = {
      ...META,
      ...current,
      handover: 'attached',
      history: {
        from: 0,
        hasOlder: false,
        turnAligned: true,
        entries: [
          {
            ordinal: 0,
            at: NOW,
            event: { type: 'status', state: 'idle' },
          },
          {
            ordinal: 1,
            at: NOW,
            event: {
              type: 'message_queued',
              messageId: 'recipe-word',
              kind: 'notice',
              text: 'The recipe is ready.',
              attribution: 'app_authored',
            },
          },
        ],
      },
    }
    const forbidden = async () => {
      throw new Error('A limit display must not start, send, or read history')
    }
    const store = createSessionStore({
      onEvent: () => () => {},
      onLiveness: (receive: (message: SessionLivenessMessage) => void) => {
        wire.receive = receive
        return () => {
          delete wire.receive
        }
      },
      attachOpen: async () => [handed],
      createSession: forbidden,
      resume: forbidden,
      send: forbidden,
      look: forbidden,
    } as unknown as RuntimeBridge)
    stores.push(store)
    expect(await store.attachOpen()).toEqual([META.sessionId])
    const record = store.get(META.sessionId)!
    expect(record).not.toBeNull()
    expect(wire.receive).toBeTypeOf('function')
    const m = mount(ConversationPane, paneProps({ record, cwd: META.cwd, drawerOpen: true }), {
      width: 1200,
      height: 1000,
    })
    const header = () => m.q('session-status').textContent?.trim()
    const queue = {
      id: 'recipe-word',
      kind: 'notice' as const,
      text: 'The recipe is ready.',
      since: NOW,
      attribution: 'app_authored' as const,
    }
    async function publish(over: Partial<SessionLivenessMessage['liveness']>) {
      wire.receive!({ sessionId: META.sessionId, liveness: { state: 'live', since: NOW, ...over } })
      await nextTick()
    }
    expect(header()).toContain('Stopped: Claude')
    await publish({
      queued: [
        {
          ...queue,
          holdReasonStatus: 'current',
          holdReason: { is: 'provider-limit', provider: 'claude', resetsAt: NOW + 3600000 },
        },
      ],
    })
    expect(m.q('queued-state').textContent).toContain('waiting for Claude’s limit to reset')
    expect(record.meta?.queued?.map((one) => one.id)).toEqual(['recipe-word'])
    await publish({ queued: [{ ...queue, text: 'Updated recipe' }] })
    expect(m.q('queued-state').textContent).toContain('waiting for Claude’s limit to reset')
    expect(record.meta!.queued[0]!.text).toBe('Updated recipe')
    await publish({
      providerBlockStatus: 'unavailable',
      queued: [{ ...queue, holdReasonStatus: 'unavailable' }],
    })
    expect(header()).toBe('Current limit status unavailable')
    expect(m.q('queued-state').textContent).toContain('limit status unavailable')
    await publish({ queued: [{ ...queue }] })
    expect(m.q('queued-state').textContent).toContain('limit status unavailable')
    await publish({ queued: [{ ...queue, holdReasonStatus: 'current' }] })
    expect(m.q('queued-state').textContent).toContain('limit status unavailable')
    await publish({
      providerBlockStatus: 'current',
      providerBlock: null,
      queued: [{ ...queue, holdReasonStatus: 'current', holdReason: null }],
    })
    expect(header()).toBe('Idle')
    expect(m.q('session-bot-word').textContent).toBe('idle')
    expect(m.q('queued-state').textContent?.trim()).toBe('not sent · waiting for the turn to end')
    expect(record.meta?.queued?.map((one) => one.id)).toEqual(['recipe-word'])
    await publish({ queued: [] })
    expect(record.meta!.queued).toEqual([])
    await publish({ queued: [queue] })
    expect(m.q('queued-state').textContent?.trim()).toBe('not sent · waiting for the turn to end')
    expect(record.meta!.queued[0]!.holdReason).toBeUndefined()
  })
})

describe('Liveness facts arriving before adoption', () => {
  it('folds omitted fields by retained ID before the descriptor, then drains the same facts into the pane', async () => {
    let receive!: (message: SessionLivenessMessage) => void
    const queue = {
      id: 'early-recipe',
      kind: 'notice' as const,
      text: 'The early recipe',
      since: NOW,
      attribution: 'app_authored' as const,
    }
    const handed: ResumedSession = {
      ...META,
      handover: 'attached',
      queued: [queue],
      history: {
        from: 0,
        hasOlder: false,
        turnAligned: true,
        entries: [
          { ordinal: 0, at: NOW, event: { type: 'status', state: 'idle' } },
          {
            ordinal: 1,
            at: NOW,
            event: {
              type: 'message_queued',
              messageId: queue.id,
              kind: 'notice',
              text: queue.text,
              attribution: 'app_authored',
            },
          },
        ],
      },
    }
    const forbidden = async () => {
      throw new Error('A limit display must not start, send, or read history')
    }
    const store = createSessionStore({
      onEvent: () => () => {},
      onLiveness: (one: typeof receive) => {
        receive = one
        return () => {}
      },
      attachOpen: async () => [handed],
      createSession: forbidden,
      resume: forbidden,
      send: forbidden,
      look: forbidden,
    } as unknown as RuntimeBridge)
    stores.push(store)
    const publish = (queued: SessionLivenessMessage['liveness']['queued']) =>
      receive({ sessionId: META.sessionId, liveness: { state: 'live', since: NOW, queued } })
    publish([
      {
        ...queue,
        holdReasonStatus: 'current',
        holdReason: { is: 'provider-limit', provider: 'claude', resetsAt: NOW + 3600000 },
      },
    ])
    publish([{ ...queue, text: 'Updated early recipe' }])
    expect(store.get(META.sessionId)!.meta).toBeNull()
    expect(store.get(META.sessionId)!.earlyLiveness!.queued![0]!.text).toBe('Updated early recipe')
    await store.attachOpen()
    const record = store.get(META.sessionId)!
    const m = mount(ConversationPane, paneProps({ record, cwd: META.cwd, drawerOpen: true }), {
      width: 1200,
      height: 1000,
    })
    await nextTick()
    expect(record.earlyLiveness).toBeNull()
    expect(m.q('queued-state').textContent).toContain('waiting for Claude’s limit to reset')
    publish([{ ...queue, holdReasonStatus: 'unavailable' }])
    publish([queue])
    await nextTick()
    expect(m.q('queued-state').textContent).toContain('limit status unavailable')
    publish([])
    publish([queue])
    await nextTick()
    expect(m.q('queued-state').textContent).not.toContain('limit')
  })
})
