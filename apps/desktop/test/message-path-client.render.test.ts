import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, provide, ref, type ComputedRef } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ClientSessionApi } from '../src/shared/client-session-api'
import type { ClientApi } from '../src/shared/client-api'
import type { MessagePath, MessagePathAsk, MessagePathTarget } from '../src/shared/runtime-ipc'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'
import { desktopProviderApi } from '../src/renderer/src/client-provider/window'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import {
  runtimePathCalls,
  useMessagePaths,
  useClientMessagePaths,
  type PathsHere,
} from '../src/renderer/src/composables/useMessagePaths'
import { createMessageLinkResolver } from '../src/renderer/src/lib/runtime-message-links'
import MarkdownWords from '../src/renderer/src/components/MarkdownWords.vue'
import AttachmentChips from '../src/renderer/src/components/AttachmentChips.vue'

const found = (text: string): MessagePath => ({
  found: true,
  text,
  absolute: `/fictional/${text}`,
  name: text,
  kind: 'file',
  opens: true,
})
const unavailable = {
  state: 'unavailable',
  kind: 'conversation',
  title: null,
  status: null,
  opens: null,
} as const

type Operations = Pick<
  ClientSessionApi,
  'resolveMessagePaths' | 'revealMessagePath' | 'openMessagePath' | 'resolveLink'
>

function client(operations?: Operations): ClientApi {
  return {
    ...createDesktopProviderApi(
      (): never => {
        throw new Error('Unexpected provider read')
      },
      () => undefined,
    ),
    // This stand-in exercises only message operations; the session-store methods are not called.
    sessions: operations as ClientSessionApi | undefined,
  }
}

async function inSetup(api: ClientApi, body: () => ReturnType<typeof h>) {
  const Child = defineComponent({ setup: () => body })
  const Parent = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, api)
      return () => h(Child)
    },
  })
  return renderToString(createSSRApp(Parent))
}

describe('captured message path and link calls', () => {
  it('binds all four desktop session operations with receiver, original promise and rejection intact', async () => {
    const failure = new Error('Fictional message operation failed')
    const reading = Promise.resolve([found('a.md')])
    const opening = Promise.resolve({ ok: true, did: 'opened' } as const)
    const showing = Promise.resolve({ ok: true, path: '/fictional/a.md' } as const)
    const linking = Promise.resolve(unavailable)
    const native = {
      reading,
      opening,
      showing,
      linking,
      resolveMessagePaths(ask: MessagePathAsk) {
        expect(ask.texts).toEqual(['a.md'])
        return this.reading
      },
      openMessagePath(target: MessagePathTarget) {
        expect(target.text).toBe('a.md')
        return this.opening
      },
      revealMessagePath() {
        return this.showing
      },
      resolveLink(target: string) {
        expect(target).toBe('W2.1')
        return this.linking
      },
    }
    const supplied = vi.fn(() => native as unknown as ClientSessionApi)
    const api = createDesktopProviderApi(
      (): never => {
        throw failure
      },
      () => undefined,
      () => undefined,
      supplied,
    )
    expect(supplied).not.toHaveBeenCalled()
    const sessions = api.sessions
    const paths = runtimePathCalls(sessions)!
    const resolve = createMessageLinkResolver(sessions)
    expect(paths.resolve({ sessionId: 'first', texts: ['a.md'] })).toBe(reading)
    expect(paths.open!({ sessionId: 'first', text: 'a.md' })).toBe(opening)
    expect(paths.reveal({ sessionId: 'first', text: 'a.md' })).toBe(showing)
    expect(await resolve('W2.1')).toBe(unavailable)
    const rejected = Promise.reject<MessagePath[]>(failure)
    native.reading = rejected
    await expect(paths.resolve({ sessionId: 'first', texts: ['a.md'] })).rejects.toBe(failure)
    expect(supplied).toHaveBeenCalledTimes(1)
  })

  it('has explicit missing capability behavior without a window or raw bridge fallback', async () => {
    expect(typeof window).toBe('undefined')
    expect(desktopProviderApi.sessions).toBeUndefined()
    expect(runtimePathCalls(undefined)).toBeNull()
    expect(runtimePathCalls({ resolveMessagePaths: async () => [] })).toBeNull()
    expect(
      runtimePathCalls({ revealMessagePath: async () => ({ ok: true, path: 'x' }) }),
    ).toBeNull()
    await expect(createMessageLinkResolver(undefined)('W1')).rejects.toThrow(
      'Link resolver unavailable',
    )
    await expect(createMessageLinkResolver({})('W1')).rejects.toThrow('Link resolver unavailable')
    const html = await inSetup(client(), () =>
      h(MarkdownWords, { text: 'Read src/file.md', sessionId: 'one' }),
    )
    expect(html).toContain('src/file.md')
    expect(html).not.toContain('data-message-path')
  })

  it('captures injected operations in setup, keeps asks lazy, bounded and keyed across session changes', async () => {
    const session = ref('one')
    let paths!: ComputedRef<PathsHere | null>
    let finish!: (answers: MessagePath[]) => void
    const first = new Promise<MessagePath[]>((done) => {
      finish = done
    })
    const asks: MessagePathAsk[] = []
    const operations: Operations = {
      resolveMessagePaths(ask) {
        asks.push(ask)
        return asks.length === 1 ? first : Promise.resolve(ask.texts.map(found))
      },
      revealMessagePath: async () => ({ ok: true, path: '/fictional' }),
    }
    const api = { ...client(operations) }
    const Child = defineComponent({
      setup() {
        paths = useClientMessagePaths(() => session.value)
        return () => h('div')
      },
    })
    const Parent = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, api)
        return () => h(Child)
      },
    })
    await renderToString(createSSRApp(Parent))
    expect(asks).toEqual([])
    api.sessions = undefined
    const one = paths.value!
    one.ask(['a.md', 'a.md', '', 'x'.repeat(100_000)])
    one.ask(['a.md'])
    expect(asks).toEqual([{ sessionId: 'one', texts: ['a.md'] }])
    session.value = 'two'
    const two = paths.value!
    two.ask(['a.md'])
    await Promise.resolve()
    expect(two.known('a.md')).toEqual(found('a.md'))
    finish([{ text: 'different.md', found: false }])
    await first
    expect(one.known('a.md')).toEqual({ text: 'a.md', found: false })
    expect(two.known('a.md')).toEqual(found('a.md'))
    one.ask(['a.md'])
    expect(asks).toHaveLength(2)
  })

  it('uses reveal-only and open failure outcomes through the captured pane context', async () => {
    let paths!: ComputedRef<PathsHere | null>
    const revealed: MessagePathTarget[] = []
    const operations: Operations = {
      resolveMessagePaths: async () => [],
      revealMessagePath: async (target) => {
        revealed.push(target)
        return { ok: true, path: '/fictional' }
      },
    }
    const Child = defineComponent({
      setup() {
        paths = useClientMessagePaths(() => 'read-only')
        return () => h('div')
      },
    })
    const Parent = defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, client(operations))
        return () => h(Child)
      },
    })
    await renderToString(createSSRApp(Parent))
    expect(paths.value?.words.canOpen).toBe(false)
    expect(await paths.value?.press('relative/file.md')).toBeNull()
    expect(revealed).toEqual([{ sessionId: 'read-only', text: 'relative/file.md' }])
    const error = new Error('Fictional failure')
    operations.revealMessagePath = () => Promise.reject(error)
    // Binding captured the original method, not a later replacement on the supplier.
    expect(await paths.value?.press('relative/file.md')).toBeNull()
    await expect(
      createMessageLinkResolver({ resolveLink: () => Promise.reject(error) })('W2'),
    ).rejects.toBe(error)
  })

  it('keeps open and reveal rejection words at the existing press seam', async () => {
    const failure = new Error('Fictional path failure')
    const revealOnly: Operations = {
      resolveMessagePaths: async () => [],
      revealMessagePath: () => Promise.reject(failure),
    }
    const shown = useMessagePaths(
      () => 'same',
      () => runtimePathCalls(revealOnly),
    ).value!
    expect(await shown.press('a.md')).toBe("Your file manager didn't show that file. Try again.")
    const opening = useMessagePaths(
      () => 'same',
      () =>
        runtimePathCalls({
          ...revealOnly,
          openMessagePath: () => {
            throw failure
          },
        }),
    ).value!
    expect(await opening.press('a.md')).toBe(
      "That file didn't open. Copy its path and open it from your file manager.",
    )
  })

  it('sets up actual message and attachment components with the injected client and no window', async () => {
    const asks: MessagePathAsk[] = []
    const operations: Operations = {
      resolveMessagePaths: async (ask) => {
        asks.push(ask)
        return ask.texts.map(found)
      },
      revealMessagePath: async () => ({ ok: true, path: '/fictional' }),
      openMessagePath: async () => ({ ok: true, did: 'opened' }),
    }
    const html = await inSetup(client(operations), () =>
      h('div', [
        h(MarkdownWords, { text: 'Read src/file.md', sessionId: 'injected' }),
        h(AttachmentChips, {
          attachments: [{ path: '/fictional/a.pdf', kind: 'file', outsideCwd: false }],
        }),
      ]),
    )
    expect(asks).toEqual([{ sessionId: 'injected', texts: ['src/file.md'] }])
    expect(html).toContain('src/file.md')
    expect(html).toContain('attachment-open')
    expect(typeof window).toBe('undefined')
  })
})
