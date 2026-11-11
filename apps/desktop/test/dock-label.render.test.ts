import { expect, it } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useDockLabel } from '../src/renderer/src/composables/useDockLabel'

it('renders without a window when the Dock label capability is absent', async () => {
  const app = createSSRApp({
    setup() {
      useDockLabel()
      return () => null
    },
  })
  await expect(renderToString(app)).resolves.toBe('<!---->')
})
