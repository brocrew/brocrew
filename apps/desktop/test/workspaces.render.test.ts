import { expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import WorkspacesSection from '../src/renderer/src/components/WorkspacesSection.vue'
import { CLIENT_PROVIDERS } from '../src/renderer/src/client-provider/injection'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

it('hides workspaces without a browser window or native reads', async () => {
  expect(typeof window).toBe('undefined')
  const html = await renderToString(createSSRApp(WorkspacesSection))
  expect(html).not.toContain('data-cy="workspaces"')
})

it('constructs lazily and resolves only the workspace capability during setup', async () => {
  const unused = (): never => {
    throw new Error('No native calls during rendering')
  }
  const workspaces = vi.fn(() => undefined)
  const client = createDesktopProviderApi(
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    workspaces,
  )
  expect(workspaces).not.toHaveBeenCalled()
  const html = await renderToString(
    createSSRApp(WorkspacesSection).provide(CLIENT_PROVIDERS, client),
  )
  expect(html).not.toContain('data-cy="workspaces"')
  expect(workspaces).toHaveBeenCalledTimes(1)
})
