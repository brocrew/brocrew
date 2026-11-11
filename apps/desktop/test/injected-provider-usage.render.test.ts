import { expect, it } from 'vitest'
import { createSSRApp, defineComponent, effectScope, h, provide } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { useProviderUsage } from '../src/renderer/src/composables/useProviderUsage'
import { usageClient } from './lib/provider-usage-client'

it('uses the injected usage doors during SSR without a window and disposes its scoped listener', async () => {
  expect(typeof window).toBe('undefined')
  const f = usageClient()
  const scope = effectScope(true)
  const child = defineComponent({
    setup() {
      const usage = scope.run(() => useProviderUsage())!
      return () => h('span', usage.value === null ? 'Reading supplied usage' : 'Usage answered')
    },
  })
  const app = createSSRApp(
    defineComponent({
      setup() {
        provide(CLIENT_PROVIDERS, f.api)
        return () => h(child)
      },
    }),
  )
  try {
    await expect(renderToString(app)).resolves.toContain('Reading supplied usage')
    expect(f.read).toHaveBeenCalledTimes(1)
    expect(f.subscribe).toHaveBeenCalledTimes(1)
    expect(f.listeners.size).toBe(1)
  } finally {
    scope.stop()
  }
  expect(f.off).toHaveBeenCalledTimes(1)
  expect(f.listeners.size).toBe(0)
})
