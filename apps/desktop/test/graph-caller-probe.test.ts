import { afterEach, expect, it, vi } from 'vitest'
import { GraphCallerProbe } from './helpers/graph-caller-probe'

afterEach(() => vi.restoreAllMocks())

it('separates cold startup from warm caller timing without hiding a slow warm turn', () => {
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const caller = new GraphCallerProbe()
  caller.call('snapshot-call', () => (clock += 137))
  expect(caller.maxMs).toBe(137)
  caller.reset()
  expect(caller.spans).toEqual([])
  expect(caller.phases).toEqual({})
  expect(caller.takeWindow().wallMs).toBe(0)

  caller.call('snapshot-call', () => (clock += 3))
  expect(caller.maxMs).toBeLessThan(100)
  caller.call('message', () => (clock += 101))
  expect(() => expect(caller.maxMs).toBeLessThan(100)).toThrow()
  expect(caller.spans.map((span) => span.phase)).toEqual(['snapshot-call', 'message'])
})

it('still counts several short warm turns together in one heartbeat window', () => {
  let clock = 0
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  const caller = new GraphCallerProbe()
  caller.call('snapshot-call', () => (clock += 137))
  caller.reset()
  caller.call('nodes-call', () => (clock += 55))
  caller.call('message', () => (clock += 55))
  expect(caller.maxMs).toBeLessThan(100)
  expect(() => expect(caller.takeWindow().wallMs).toBeLessThan(100)).toThrow()
})
