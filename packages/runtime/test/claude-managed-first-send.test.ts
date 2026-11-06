import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime, type ClaudeQuery, type QueryFactory } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
  vi.useRealTimers()
})

async function fixture(status: NonNullable<ClaudeQuery['mcpServerStatus']>, retained = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-claude-ready-')))
  const frames = new AsyncQueue<SDKMessage>()
  let input!: AsyncIterator<unknown>
  const query: ClaudeQuery = {
    mcpServerStatus: status,
    setMcpServers: async () => ({ added: [], removed: [], errors: {} }),
    interrupt: async () => {},
    close: () => frames.close(),
    return: async () => frames.close(),
    [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
  }
  const factory: QueryFactory = ({ prompt }) => {
    if (typeof prompt === 'string') throw new Error('expected streaming input')
    input = prompt[Symbol.asyncIterator]()
    return query
  }
  const handle = await new ClaudeRuntime(factory, async () => true).start({
    cwd: root,
    providerHome: root,
    managedPluginMcp: [
      {
        name: 'plugin-fern',
        url: 'http://127.0.0.1:8123/mcp',
        capability: 'a'.repeat(64),
        ...(retained ? { retained: true } : {}),
      },
    ],
  })
  cleanups.push(async () => {
    await handle.close()
    rmSync(root, { recursive: true, force: true })
  })
  const pushed: unknown[] = []
  void input.next().then((value) => {
    if (!value.done) pushed.push(value.value)
  })
  return { handle, pushed, query }
}

it('holds the actual first SDK input until the current managed inventory is connected', async () => {
  vi.useFakeTimers()
  let ready = false
  const status = vi.fn(async () => [
    {
      name: 'plugin-fern',
      status: ready ? ('connected' as const) : ('pending' as const),
      ...(ready ? { tools: [{ name: 'fictional_profiles', description: 'fictional' }] } : {}),
    },
  ])
  const { handle, pushed } = await fixture(status)
  expect(handle.ref).toBeNull() // A new query has no init yet; waiting must not require one.
  const sending = handle.send('the unchanged original input')
  await vi.advanceTimersByTimeAsync(100)
  expect(status).toHaveBeenCalled()
  expect(pushed).toEqual([])
  ready = true
  await vi.advanceTimersByTimeAsync(50)
  await sending
  expect(pushed).toHaveLength(1)
  expect(pushed[0]).toMatchObject({ message: { content: 'the unchanged original input' } })
})

it('cancels a pending first-input observation before a late status reply', async () => {
  vi.useFakeTimers()
  let resolve!: (value: Awaited<ReturnType<NonNullable<ClaudeQuery['mcpServerStatus']>>>) => void
  const status = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<NonNullable<ClaudeQuery['mcpServerStatus']>>>>((done) => {
        resolve = done
      }),
  )
  const { handle, pushed } = await fixture(status)
  const sending = handle.send('stopped input')
  void sending.catch(() => {})
  await vi.advanceTimersByTimeAsync(1)
  expect(status).toHaveBeenCalledOnce()
  await handle.interrupt()
  resolve([{ name: 'plugin-fern', status: 'connected', tools: [] }])
  await vi.advanceTimersByTimeAsync(100)
  await expect(sending).rejects.toThrow()
  expect(pushed).toEqual([])
})

it('does not wait for a retained route that was not served', async () => {
  const status = vi.fn(async () => [])
  const { handle, pushed } = await fixture(status, true)
  await handle.send('ordinary input')
  await Promise.resolve()
  expect(status).not.toHaveBeenCalled()
  expect(pushed).toHaveLength(1)
})

it('bounds a hung status call without issuing overlapping requests', async () => {
  vi.useFakeTimers()
  const status = vi.fn(
    () => new Promise<Awaited<ReturnType<NonNullable<ClaudeQuery['mcpServerStatus']>>>>(() => {}),
  )
  const { handle, pushed } = await fixture(status)
  const sending = handle.send('ordinary fallback after timeout')
  await vi.advanceTimersByTimeAsync(9_999)
  expect(pushed).toEqual([])
  expect(status).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(2)
  await sending
  expect(pushed).toHaveLength(1)
  expect(status).toHaveBeenCalledOnce()
})

it('a successful configuration ACK still waits for its inventory before input', async () => {
  vi.useFakeTimers()
  let ready = false
  const status = vi.fn(async () => [
    {
      name: 'plugin-willow',
      status: ready ? ('connected' as const) : ('pending' as const),
      ...(ready ? { tools: [] } : {}),
    },
  ])
  const { handle, pushed, query } = await fixture(status)
  const ack = vi.spyOn(query, 'setMcpServers')
  await handle.refreshManagedPlugins!([
    { name: 'plugin-willow', url: 'http://127.0.0.1:8124/mcp', capability: 'b'.repeat(64) },
  ])
  handle.awaitManagedPlugins!(['plugin-willow', 'plugin-not-configured'])
  const sending = handle.send('after configuration')
  await vi.advanceTimersByTimeAsync(100)
  expect(ack).toHaveBeenCalledOnce()
  expect(pushed).toEqual([])
  ready = true
  await vi.advanceTimersByTimeAsync(50)
  await sending
  expect(pushed).toHaveLength(1)
})

it('a configuration change cancels the old wait without stranding the local turn', async () => {
  vi.useFakeTimers()
  let resolve!: (value: Awaited<ReturnType<NonNullable<ClaudeQuery['mcpServerStatus']>>>) => void
  const status = vi.fn(
    () =>
      new Promise<Awaited<ReturnType<NonNullable<ClaudeQuery['mcpServerStatus']>>>>((done) => {
        resolve = done
      }),
  )
  const { handle, pushed } = await fixture(status)
  const sending = handle.send('old configuration')
  void sending.catch(() => {})
  await vi.advanceTimersByTimeAsync(1)
  await handle.refreshManagedPlugins!([])
  await expect(sending).rejects.toThrow()
  expect(handle.status()).toBe('idle')
  resolve([{ name: 'plugin-fern', status: 'connected', tools: [] }])
  await vi.advanceTimersByTimeAsync(100)
  expect(pushed).toEqual([])
  await handle.send('new configuration')
  await Promise.resolve()
  expect(pushed).toHaveLength(1)
  expect(pushed[0]).toMatchObject({ message: { content: 'new configuration' } })
})

it('close cancels a hung readiness request synchronously and no late input is queued', async () => {
  vi.useFakeTimers()
  const status = vi.fn(
    () => new Promise<Awaited<ReturnType<NonNullable<ClaudeQuery['mcpServerStatus']>>>>(() => {}),
  )
  const { handle, pushed } = await fixture(status)
  const sending = handle.send('closed input')
  void sending.catch(() => {})
  await vi.advanceTimersByTimeAsync(1)
  await handle.close()
  await expect(sending).rejects.toThrow()
  await vi.advanceTimersByTimeAsync(11_000)
  expect(pushed).toEqual([])
  expect(status).toHaveBeenCalledOnce()
})

it('a concurrent send cannot share or replace the active readiness observation', async () => {
  vi.useFakeTimers()
  let ready = false
  const status = vi.fn(async () => [
    {
      name: 'plugin-fern',
      status: ready ? ('connected' as const) : ('pending' as const),
      ...(ready ? { tools: [] } : {}),
    },
  ])
  const { handle, pushed } = await fixture(status)
  const first = handle.send('first input')
  await vi.advanceTimersByTimeAsync(1)
  await expect(handle.send('concurrent input')).rejects.toThrow()
  expect(pushed).toEqual([])
  ready = true
  await vi.advanceTimersByTimeAsync(50)
  await first
  expect(pushed).toHaveLength(1)
  expect(pushed[0]).toMatchObject({ message: { content: 'first input' } })
})
