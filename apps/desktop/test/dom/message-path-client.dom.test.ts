import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, provide, ref } from 'vue'
import type { ClientSessionApi } from '../../src/shared/client-session-api'
import type { MessagePathAsk, MessagePathTarget } from '../../src/shared/runtime-ipc'
import { CLIENT_PROVIDERS, useClientApi } from '../../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../../src/renderer/src/client-provider/desktop'
import { createMessageLinkResolver } from '../../src/renderer/src/lib/runtime-message-links'
import MarkdownWords from '../../src/renderer/src/components/MarkdownWords.vue'
import AttachmentChips from '../../src/renderer/src/components/AttachmentChips.vue'
import MessageLinks from '../../src/renderer/src/components/MessageLinks.vue'
import { mount, unmountAll } from './harness'

afterEach(() => {
  unmountAll()
  Reflect.deleteProperty(window, 'api')
})

it('keeps actual path, attachment and link gestures on the setup-injected client after redraws', async () => {
  Object.defineProperty(window, 'api', {
    configurable: true,
    get() {
      throw new Error('Desktop global must not be read')
    },
  })
  const session = ref('first')
  const text = ref('Read src/file.md and W6.1')
  const asks: MessagePathAsk[] = []
  const opens: MessagePathTarget[] = []
  const links: string[] = []
  const openedLinks: string[] = []
  const operations = {
    label: 'injected',
    async resolveMessagePaths(ask: MessagePathAsk) {
      expect(this.label).toBe('injected')
      asks.push(ask)
      return ask.texts.map((path) => ({
        found: true,
        text: path,
        absolute: `/fictional/${path}`,
        name: 'file.md',
        kind: 'file',
        opens: true,
      }))
    },
    async openMessagePath(target: MessagePathTarget) {
      expect(this.label).toBe('injected')
      opens.push(target)
      return { ok: true, did: 'opened' }
    },
    async revealMessagePath() {
      expect(this.label).toBe('injected')
      return { ok: true, path: '/fictional' }
    },
    async resolveLink(target: string) {
      expect(this.label).toBe('injected')
      links.push(target)
      return {
        state: 'available',
        kind: 'piece',
        title: 'Injected work',
        status: 'Working',
        opens: { sessionId: 'linked' },
      }
    },
  }
  const api = {
    ...createDesktopProviderApi(
      (): never => {
        throw new Error('No provider read expected')
      },
      () => undefined,
    ),
    sessions: operations as unknown as ClientSessionApi,
  }
  const View = defineComponent({
    setup() {
      const resolve = createMessageLinkResolver(useClientApi().sessions)
      return () =>
        h(
          MessageLinks,
          {
            resolve,
            open: async () => {
              openedLinks.push('linked')
              return true
            },
          },
          {
            default: () =>
              h('div', [
                h(MarkdownWords, { text: text.value, sessionId: session.value }),
                h(AttachmentChips, {
                  attachments: [{ path: '/fictional/a.pdf', kind: 'file', outsideCwd: false }],
                }),
              ]),
          },
        )
    },
  })
  const Parent = defineComponent({
    setup() {
      provide(CLIENT_PROVIDERS, api)
      return () => h(View)
    },
  })
  const view = mount(Parent, {})
  await expect.poll(() => view.all('message-path').length).toBe(1)
  await expect.poll(() => view.q('message-link').dataset.linkState).toBe('available')
  expect(asks).toEqual([{ sessionId: 'first', texts: ['src/file.md'] }])
  view.q('message-path').click()
  await expect.poll(() => opens.length).toBe(1)
  view.q('attachment-open').click()
  await expect.poll(() => opens.length).toBe(2)
  expect(opens).toEqual([
    { sessionId: 'first', text: 'src/file.md' },
    { sessionId: null, text: '/fictional/a.pdf' },
  ])
  view.q('message-link').click()
  await expect.poll(() => openedLinks.length).toBe(1)
  expect(links.every((target) => target === 'W6.1')).toBe(true)
  text.value = 'Again src/file.md and W6.1'
  await nextTick()
  expect(asks).toHaveLength(1)
  session.value = 'second'
  await expect.poll(() => asks.length).toBe(2)
  expect(asks[1]).toEqual({ sessionId: 'second', texts: ['src/file.md'] })
  view.q('message-path').click()
  await expect.poll(() => opens.length).toBe(3)
  expect(opens[2]).toEqual({ sessionId: 'second', text: 'src/file.md' })
})
