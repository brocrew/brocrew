import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimSoleHost, hostGatePath, whoIsOn } from '../src/main/one-host-gate'

describe.skipIf(process.platform === 'win32')('a gate whose answer is slow', () => {
  let dir = ''
  let server: Server
  const sockets = new Set<Socket>()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gate-slow-'))
    server = createServer((socket) => {
      sockets.add(socket)
      socket.on('error', () => {})
      socket.on('close', () => sockets.delete(socket))
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  async function listening(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(hostGatePath(dir, 'darwin'), resolve)
    })
  }

  it.each(['claim', 'chooser'] as const)(
    'accepts an answer after the old deadline for the %s',
    async (caller) => {
      server.on('connection', (socket) => {
        const timer = setTimeout(() => socket.end('running-host'), 2_000)
        socket.once('close', () => clearTimeout(timer))
      })
      await listening()

      expect(
        await (caller === 'claim' ? claimSoleHost(dir, 'darwin') : whoIsOn(dir, 'darwin')),
      ).toBe(caller === 'claim' ? 'taken' : 'open')
      expect(existsSync(hostGatePath(dir, 'darwin'))).toBe(true)
    },
  )

  it('gives up within six seconds when a listener never answers, leaving its socket alone', async () => {
    await listening()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const connected = new Promise<void>((resolve) => server.once('connection', () => resolve()))
    let verdict: string | undefined
    const answer = claimSoleHost(dir, 'darwin').then((heard) => {
      verdict = heard
    })
    await connected

    await vi.advanceTimersByTimeAsync(1_000)
    expect(verdict).toBeUndefined()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(verdict).toBe('unknown')
    await answer
    expect(existsSync(hostGatePath(dir, 'darwin'))).toBe(true)
  })
})
