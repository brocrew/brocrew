import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { afterEach, expect, it, vi } from 'vitest'
import { PersonChannel } from '../src/main/plugins/lifecycle/transport'

class Wire extends EventEmitter {
  writableLength = 0
  destroyed = false
  peer!: Wire
  setEncoding() {}
  write(data: string) {
    queueMicrotask(() => {
      if (!this.peer.destroyed) this.peer.emit('data', data)
    })
    return true
  }
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('close')
    this.peer.destroy()
  }
}
const channels: PersonChannel[] = []
afterEach(() => {
  for (const c of channels.splice(0)) c.close()
  vi.useRealTimers()
})
function pair(handle: (input: unknown, progress?: (value: unknown) => void) => Promise<unknown>) {
  const a = new Wire(),
    b = new Wire()
  a.peer = b
  b.peer = a
  const client = new PersonChannel(
    a as unknown as Socket,
    '1'.repeat(64),
    '2'.repeat(64),
    'client',
    async () => null,
  )
  const server = new PersonChannel(
    b as unknown as Socket,
    '1'.repeat(64),
    '2'.repeat(64),
    'server',
    handle,
  )
  channels.push(client, server)
  return client
}

it('a progressing authenticated call can outlive its original answer interval', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let emit!: (value: unknown) => void, finish!: (value: unknown) => void
  const client = pair(async (_input, progress) => {
    emit = progress!
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  let received = 0
  const pending = client.call('prepare', 30_000, (value) => {
    const next = value as number
    if (next <= received) return false
    received = next
    return true
  })
  await Promise.resolve()
  await Promise.resolve()
  for (const bytes of [1, 2, 3]) {
    await vi.advanceTimersByTimeAsync(20_000)
    emit(bytes)
    await Promise.resolve()
  }
  finish('review-ready')
  expect(await pending).toBe('review-ready')
  expect(client.open).toBe(true)
})

it('phase-only progress cannot keep a silent preparation call alive', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let emit!: (value: unknown) => void
  const client = pair(async (_input, progress) => {
    emit = progress!
    return new Promise(() => {})
  })
  const checked = expect(client.call('prepare', 30_000, () => false)).rejects.toMatchObject({
    code: 'unavailable',
  })
  void checked.catch(() => {})
  await Promise.resolve()
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(20_000)
  emit({ phase: 'checking' })
  await vi.advanceTimersByTimeAsync(10_001)
  await checked
  expect(client.open).toBe(false)
})

it('ordinary calls retain their answer bound', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const client = pair(async () => new Promise(() => {}))
  const checked = expect(client.call('ordinary', 30_000)).rejects.toMatchObject({
    code: 'unavailable',
  })
  void checked.catch(() => {})
  await vi.advanceTimersByTimeAsync(30_001)
  await checked
})

it('queued progress cannot write after its terminal reply', async () => {
  let late!: (value: unknown) => void
  const client = pair(async (_input, progress) => {
    late = progress!
    return true
  })
  expect(await client.call('prepare', 30_000, () => true)).toBe(true)
  late(1)
  await Promise.resolve()
  expect(client.open).toBe(true)
  expect(await client.call('ordinary')).toBe(true)
})
