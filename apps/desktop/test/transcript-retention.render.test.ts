import { afterEach, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useTranscriptRetention } from '../src/renderer/src/composables/useTranscriptRetention'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'
import type { TranscriptRetentionClient } from '../src/shared/transcript-retention'

afterEach(() => vi.unstubAllGlobals())

it('renders with no window and no transcript-retention capability', async () => {
  expect(typeof window).toBe('undefined')
  const app = createSSRApp({
    setup() {
      const state = useTranscriptRetention()
      expect(state.period.value).toBeNull()
      expect(state.saving.value).toBe(false)
      return () => null
    },
  })
  await expect(renderToString(app)).resolves.toBe('<!---->')
})

it('preserves an explicit bridge and receiver without reading on server render', async () => {
  const read = vi.fn()
  const set = vi.fn()
  const bridge: TranscriptRetentionClient = {
    read,
    async set(period) {
      expect(this).toBe(bridge)
      set(period)
      return period
    },
  }
  let saved!: Promise<void>
  const unused = (): never => {
    throw new Error('No provider reads during retention render')
  }
  const app = createSSRApp({
    setup() {
      const state = useTranscriptRetention(bridge)
      saved = state.save(30)
      return () => null
    },
  }).provide(CLIENT_PROVIDERS, createDesktopProviderApi(unused, unused))
  await renderToString(app)
  await saved
  expect(set).toHaveBeenCalledExactlyOnceWith(30)
  expect(read).not.toHaveBeenCalled()
})
