import { expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { sessionClientView } from './lib/session-client-view'
import KeptRules from '../src/renderer/src/components/KeptRules.vue'

it('captures the injected client without reading its session getter or any rules during window-free setup', async () => {
  expect(typeof window).toBe('undefined')
  const sessions = vi.fn((): never => {
    throw new Error('Session resolution belongs inside the mounted read')
  })
  const app = createSSRApp(
    sessionClientView(sessions, () => () => h(KeptRules, { providers: ['claude', 'codex'] })),
  )
  expect(await renderToString(app)).toContain('Kept rules')
  expect(sessions).not.toHaveBeenCalled()
})
