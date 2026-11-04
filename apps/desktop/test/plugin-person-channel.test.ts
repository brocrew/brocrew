import { createConnection, createServer, type Socket } from 'node:net'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import {
  connectPersonPluginControl,
  servePersonPluginControl,
} from '../src/main/plugins/lifecycle/person-control'
import type { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'

const cleanup: Array<() => Promise<unknown>> = []
const folders: string[] = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
async function pair(handle: (input: unknown) => Promise<unknown>) {
  let accepted!: (socket: Socket) => void
  const serverSocket = new Promise<Socket>((resolve) => {
    accepted = resolve
  })
  const server = createServer(accepted)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fictional endpoint missing')
  const socket = createConnection(address.port, '127.0.0.1')
  await once(socket, 'connect')
  const incoming = await serverSocket
  const left = new PersonChannel(
    socket,
    'left-instance',
    'old-left-challenge',
    'client',
    async (value) => value,
  )
  const right = new PersonChannel(
    incoming,
    'right-instance',
    'old-right-challenge',
    'server',
    handle,
  )
  cleanup.push(async () => {
    left.close()
    right.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })
  return { left, right, socket, incoming }
}
describe('ordinary local settings channel', () => {
  it('correlates plain JSON requests without a key-possession handshake', async () => {
    const peers = await pair(async (value) => value)
    const wire = once(peers.incoming, 'data')
    const answer = peers.left.call({ fictional: 'fern' })
    void answer.catch(() => undefined)
    const [bytes] = await wire
    const frame = JSON.parse(String(bytes))
    expect(frame).toMatchObject({ kind: 'call', value: { fictional: 'fern' } })
    expect(Object.keys(frame).sort()).toEqual(['id', 'kind', 'value'])
    expect(await answer).toEqual({ fictional: 'fern' })
  })
  it('handles more than eight concurrent requests and messages above the old packet limit', async () => {
    const peers = await pair(async (value) => value)
    const values = Array.from({ length: 20 }, (_, index) => ({
      index,
      fictional: 'x'.repeat(20000),
    }))
    expect(await Promise.all(values.map((value) => peers.left.call(value)))).toEqual(values)
  })
  it('keeps request correlation when replies finish out of order', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const peers = await pair(async (value) => {
      if (value === 'first') await gate
      return value
    })
    const first = peers.left.call('first')
    void first.catch(() => undefined)
    expect(await peers.left.call('second')).toBe('second')
    release()
    expect(await first).toBe('first')
  })
  it('closes pending calls without waiting for a nonphysical handler to settle', async () => {
    const started = vi.fn()
    const peers = await pair(async () => {
      started()
      return new Promise(() => {})
    })
    const call = peers.left.call('fictional pending work')
    const rejected = expect(call).rejects.toMatchObject({ code: 'unavailable' })
    await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
    peers.right.close()
    await rejected
    expect(peers.left.open).toBe(false)
  })
  it('rejects malformed frames as ordinary protocol errors', async () => {
    const peers = await pair(async (value) => value)
    peers.socket.write('{broken\n')
    await vi.waitFor(() => expect(peers.right.open).toBe(false))
  })
  it('service close finishes when workspace detach never acknowledges', async () => {
    const root = mkdtempSync(
      join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-channel-'),
    )
    folders.push(root)
    const detach = vi.fn(async () => new Promise<void>(() => {}))
    const controller = {
      attach: vi.fn(async () => ({ workspaceId: randomUUID() })),
      detach,
    } as unknown as PluginLifecycleController
    const service = await servePersonPluginControl({
      root,
      key: 'fictional-instance',
      controller,
      read: async () => null,
    })
    const channel = await connectPersonPluginControl({
      path: service.path,
      key: 'fictional-instance',
      handle: async () => true,
    })
    cleanup.push(async () => {
      channel.close()
    })
    await channel.call({ kind: 'attach', workspaceId: randomUUID() })
    let closed = false
    void service.close().then(() => {
      closed = true
    })
    await vi.waitFor(() => expect(closed).toBe(true))
    expect(detach).toHaveBeenCalled()
  })
})
