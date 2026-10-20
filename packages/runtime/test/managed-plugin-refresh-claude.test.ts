import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'
import type { SessionHandle } from '../src/runtime'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close()
})
it('Claude uses its supported refresh and preserves the person server while replacing only the managed route', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-claude-refresh-'))),
    providerHome = join(root, 'home')
  mkdirSync(providerHome)
  const frames = new AsyncQueue<SDKMessage>()
  const setMcpServers = vi.fn(async () => ({ added: [], removed: [], errors: {} }))
  const query: ClaudeQuery = {
    interrupt: async () => {},
    close: () => frames.close(),
    return: async () => frames.close(),
    setMcpServers,
    [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
  }
  const runtime = new ClaudeRuntime(
    () => query,
    async () => true,
  )
  const route = {
    name: 'plugin-fern',
    url: 'http://127.0.0.1:8123/mcp',
    capability: 'a'.repeat(64),
  }
  const owned: { handle?: SessionHandle } = {}
  cleanup.push(async () => {
    await owned.handle?.close()
    rmSync(root, { recursive: true, force: true })
  })
  const handle = await runtime.start({
    cwd: root,
    providerHome,
    managedPluginMcp: [route],
    externalMcp: {
      servers: [{ name: 'person-server', url: 'http://127.0.0.1:9234/mcp' }],
      reservedToolNames: [],
    },
  })
  owned.handle = handle
  await handle.refreshManagedPlugins!([{ ...route, name: 'plugin-willow' }])
  expect(setMcpServers).toHaveBeenCalledWith({
    'person-server': { type: 'http', url: 'http://127.0.0.1:9234/mcp' },
    'plugin-willow': {
      type: 'http',
      url: route.url,
      headers: { Authorization: `Bearer ${route.capability}` },
    },
  })
  await handle.refreshManagedPlugins!([])
  expect(setMcpServers).toHaveBeenLastCalledWith({
    'person-server': { type: 'http', url: 'http://127.0.0.1:9234/mcp' },
  })
})
