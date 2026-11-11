import { afterEach, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h, provide } from 'vue'
import { renderToString } from 'vue/server-renderer'
import OwnNotes from '../src/renderer/src/components/OwnNotes.vue'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

afterEach(() => vi.unstubAllGlobals())

it('constructs inactive OwnNotes without a window or resolving its session capability', async () => {
  vi.stubGlobal('window', undefined)
  const sessions = vi.fn((): never => {
    throw new Error('Inactive notes must not resolve a session capability')
  })
  const client = createDesktopProviderApi(
    (): never => {
      throw new Error('Unexpected provider operation')
    },
    () => undefined,
    () => undefined,
    sessions,
  )
  const html = await renderToString(
    createSSRApp(
      defineComponent({
        setup() {
          provide(CLIENT_PROVIDERS, client)
          return () => h(OwnNotes, { profileSlug: 'quill', active: false })
        },
      }),
    ),
  )
  expect(html).toContain('Own notes')
  expect(html).not.toContain('This app could not read these notes.')
  expect(sessions).not.toHaveBeenCalled()
})
