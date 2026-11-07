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
it('delivers a send during a slow Claude refresh without waiting for its late tools', async () => {
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
  const result = sending.then(
    () => 'sent',
    (error: Error) => error.message,
  )
  await vi.advanceTimersByTimeAsync(PLUGIN_ATTACHMENT_WAIT_MS + 1)
  try {
    expect(setMcpServers).toHaveBeenCalledOnce()
    expect(await result).toBe('sent')
    expect(sent).toHaveBeenCalledExactlyOnceWith('fictional turn')
  } finally {
    finish()
    await sending.catch(() => {})
  }
  expect(sent).toHaveBeenCalledOnce()
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

it.each([false, true])(
  'refreshes Claude before a recovered tool call with the same conversation (route changed %s)',
  async (changed) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-claude-health-')))
    const frames = new AsyncQueue<SDKMessage>()
    let connected = true
    let currentRoute = {
      name: 'plugin-fern',
      url: 'http://127.0.0.1:8123/mcp',
      capability: 'a'.repeat(64),
    }
    let installedUrl = currentRoute.url
    const mcpServerStatus = vi.fn(async () => [
      { name: currentRoute.name, status: connected ? ('connected' as const) : ('failed' as const) },
      { name: 'person-server', status: 'failed' as const },
    ])
    const reconnectMcpServer = vi.fn(async () => {
      connected = true
    })
    const setMcpServers = vi.fn(
      async (servers: Parameters<NonNullable<ClaudeQuery['setMcpServers']>>[0]) => {
        const server = servers[currentRoute.name]!
        if (!('url' in server)) throw new Error('fictional managed server must use HTTP')
        // A replacement creates its own connection; the failed old endpoint cannot
        // authorize a reconnect of the new one. An unchanged endpoint still needs recovery.
        if (server.url !== installedUrl) connected = true
        installedUrl = server.url
        return { added: [], removed: [], errors: {} }
      },
    )
    const query: ClaudeQuery = Object.assign(
      {
        interrupt: async () => {},
        close: () => frames.close(),
        return: async () => frames.close(),
        setMcpServers,
        [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
      },
      { mcpServerStatus, reconnectMcpServer },
    )
    const raw = new ClaudeRuntime(
      () => query,
      async () => true,
    )
    const open = raw.start.bind(raw)
    const successfulCalls: string[] = []
    raw.start = async (options) => {
      const handle = await open(options)
      vi.spyOn(handle, 'send').mockImplementation(async () => {
        expect(connected).toBe(true)
        successfulCalls.push(installedUrl)
      })
      return handle
    }
    const resume = vi.spyOn(raw, 'resume')
    const runtime = withManagedPluginAttachments(raw, {
      read: async () => ({ revision: 'same', servers: [currentRoute] }),
      close: async () => {},
    })
    const handle = await runtime.start({ cwd: root, providerHome: root })
    cleanup.push(async () => {
      await handle.close()
      rmSync(root, { recursive: true, force: true })
    })
    frames.push({
      type: 'system',
      subtype: 'init',
      session_id: 'fictional-claude',
      cwd: root,
    } as unknown as SDKMessage)
    await new Promise((resolve) => setTimeout(resolve, 0))
    const saved = handle.ref
    expect(saved?.sessionId).toBe('fictional-claude')
    await handle.send('fictional first tool call')
    expect(setMcpServers).not.toHaveBeenCalled()
    mcpServerStatus.mockClear()
    connected = false
    if (changed)
      currentRoute = {
        ...currentRoute,
        url: 'http://127.0.0.1:8124/mcp',
        capability: 'b'.repeat(64),
      }
    await handle.send('fictional recovered tool call')
    if (changed) {
      expect(mcpServerStatus).not.toHaveBeenCalled()
      expect(reconnectMcpServer).not.toHaveBeenCalled()
    } else {
      expect(mcpServerStatus).toHaveBeenCalled()
      expect(reconnectMcpServer).toHaveBeenCalledWith('plugin-fern')
    }
    expect(handle.ref).toEqual(saved)
    expect(resume).not.toHaveBeenCalled()
    expect(successfulCalls).toEqual(['http://127.0.0.1:8123/mcp', currentRoute.url])
    const refreshes = setMcpServers.mock.calls.length
    await handle.send('fictional healthy following call')
    expect(setMcpServers).toHaveBeenCalledTimes(refreshes)
    expect(reconnectMcpServer).toHaveBeenCalledTimes(changed ? 0 : 1)
  },
)

it.each(['pending', 'needs-auth', 'disabled', 'missing'] as const)(
  'unknown Claude status %s cannot authorize a reconnect',
  async (status) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-claude-unknown-')))
    const frames = new AsyncQueue<SDKMessage>()
    const reconnectMcpServer = vi.fn(async () => {})
    const setMcpServers = vi.fn(async () => ({ added: [], removed: [], errors: {} }))
    const query: ClaudeQuery = Object.assign(
      {
        interrupt: async () => {},
        close: () => frames.close(),
        return: async () => frames.close(),
        setMcpServers,
        [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
      },
      {
        mcpServerStatus: async () =>
          status === 'missing' ? [] : [{ name: 'plugin-fern', status }],
        reconnectMcpServer,
      },
    )
    const raw = new ClaudeRuntime(
      () => query,
      async () => true,
    )
    const open = raw.start.bind(raw),
      sent = vi.fn(async () => {})
    raw.start = async (options) => {
      const handle = await open(options)
      vi.spyOn(handle, 'send').mockImplementation(sent)
      return handle
    }
    const route = {
      name: 'plugin-fern',
      url: 'http://127.0.0.1:8123/mcp',
      capability: 'a'.repeat(64),
    }
    const runtime = withManagedPluginAttachments(raw, {
      read: async () => ({ revision: 'same', servers: [route] }),
      close: async () => {},
    })
    const handle = await runtime.start({ cwd: root, providerHome: root })
    cleanup.push(async () => {
      await handle.close()
      rmSync(root, { recursive: true, force: true })
    })
    await handle.send('fictional ordinary turn')
    expect(reconnectMcpServer).not.toHaveBeenCalled()
    expect(setMcpServers).not.toHaveBeenCalled()
    expect(sent).toHaveBeenCalledOnce()
  },
)
