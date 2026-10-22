import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'
import type { SessionHandle } from '../src/runtime'
import {
  PLUGIN_ATTACHMENT_WAIT_MS,
  withManagedPluginAttachments,
} from '../src/managed-plugin-session'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.splice(0)) await close()
})
it('a timed-out Claude setMcpServers never overlaps a sent turn even if it settles later', async () => {
  vi.useFakeTimers()
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-slow-refresh-')))
  const frames = new AsyncQueue<SDKMessage>()
  let finish!: () => void
  const setMcpServers = vi.fn(
    () =>
      new Promise<{ added: string[]; removed: string[]; errors: Record<string, string> }>(
        (resolve) => {
          finish = () => resolve({ added: [], removed: [], errors: {} })
        },
      ),
  )
  const query: ClaudeQuery = {
    interrupt: async () => {},
    close: () => frames.close(),
    return: async () => frames.close(),
    setMcpServers,
    [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
  }
  const raw = new ClaudeRuntime(
    () => query,
    async () => true,
  )
  const open = raw.start.bind(raw)
  const sent = vi.fn(async () => {})
  raw.start = async (options) => {
    const handle = await open(options)
    vi.spyOn(handle, 'send').mockImplementation(sent)
    return handle
  }
  let servers = [] as { name: string; url: string; capability: string }[]
  const wrapped = withManagedPluginAttachments(raw, {
    read: async () => ({ revision: String(servers.length), servers }),
    close: async () => {},
  })
  const handle = await wrapped.start({ cwd: root, providerHome: root })
  cleanup.push(async () => {
    await handle.close()
    rmSync(root, { recursive: true, force: true })
  })
  servers = [{ name: 'plugin-fern', url: 'http://127.0.0.1:8123/mcp', capability: 'a'.repeat(64) }]
  const sending = handle.send('fictional turn')
  let refused: unknown
  void sending.catch((error) => {
    refused = error
  })
  await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS + 1)
  try {
    expect(setMcpServers).toHaveBeenCalledOnce()
    expect(sent).not.toHaveBeenCalled()
    expect(refused).toBeInstanceOf(Error)
  } finally {
    finish()
    await sending.catch(() => {})
  }
  expect(sent).not.toHaveBeenCalled()
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
