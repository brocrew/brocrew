import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  OWNER_LIMITS,
  OWNER_WIRE,
  OwnerRecord,
  pack,
  unpack,
} from '../src/main/plugins/supervisor/protocol'
import { localEndpoint } from '../src/main/plugins/local-endpoint'

describe('supervisor JSON lines', () => {
  const value = { epoch: randomUUID(), nonce: 'a'.repeat(64), command: { kind: 'probe' } }

  it('writes one plain JSON line and reads it back', () => {
    expect(pack(value)).toBe(JSON.stringify(value) + '\n')
    expect(unpack(pack(value))).toEqual(value)
  })

  it('reads an older envelope without checking its retired signature', () => {
    expect(unpack(JSON.stringify({ data: JSON.stringify(value), mac: 'retired' }))).toEqual(value)
  })

  it('keeps malformed JSON and oversized output errors', () => {
    expect(() => unpack('{')).toThrow()
    expect(() => unpack(JSON.stringify({ data: '{', mac: 'retired' }))).toThrow()
    expect(() => pack('é'.repeat(OWNER_LIMITS.packet))).toThrow()
  })

  it('reads older owner records and drops the retired key when writing', () => {
    const record = { version: 1, epoch: randomUUID(), phase: 'stopped', wire: OWNER_WIRE }
    const read = OwnerRecord.parse({ ...record, key: 'a'.repeat(64) })
    expect(read).toEqual(record)
    expect(read).not.toHaveProperty('key')
    expect(OwnerRecord.safeParse({ ...record, epoch: 'broken' }).success).toBe(false)
  })

  it('names each Windows owner endpoint from its epoch', () => {
    const epoch = randomUUID()
    const endpoint = localEndpoint('/fictional/owner.sock', 'owner', epoch, 'win32')
    expect(endpoint).toBe(localEndpoint('/fictional/owner.sock', 'owner', epoch, 'win32'))
    expect(endpoint).not.toBe(
      localEndpoint('/fictional/owner.sock', 'owner', randomUUID(), 'win32'),
    )
    expect(localEndpoint('/fictional/owner.sock', 'owner', epoch, 'darwin')).toBe(
      '/fictional/owner.sock',
    )
  })
})
