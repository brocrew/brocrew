import { afterEach, expect, it, vi } from 'vitest'
import { downloadPluginBytes } from '../src/main/plugins/catalogue/download'

const url = 'https://github.com/brocrew/brocrew/releases/download/fictional/archive.tar'
afterEach(() => vi.useRealTimers())

function stream(parts: Array<[number, string]>) {
  return vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const [at, text] of parts)
              setTimeout(() => controller.enqueue(new TextEncoder().encode(text)), at)
            setTimeout(() => controller.close(), parts.at(-1)![0] + 1)
          },
          cancel() {},
        }),
      ),
  )
}

it('accepts an exact archive progressing for longer than thirty seconds', async () => {
  vi.useFakeTimers()
  const result = downloadPluginBytes({
    url,
    maximum: 3,
    size: 3,
    fetch: stream([
      [20_000, 'a'],
      [40_000, 'b'],
      [60_000, 'c'],
    ]),
  })
  const checked = expect(result).resolves.toEqual(Buffer.from('abc'))
  void checked.catch(() => {})
  await vi.advanceTimersByTimeAsync(60_001)
  await checked
})

it('reports a body that stops producing bytes as a stalled download', async () => {
  vi.useFakeTimers()
  const fetch = vi.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1]))
          },
          cancel() {},
        }),
      ),
  )
  const checked = expect(downloadPluginBytes({ url, maximum: 3, fetch })).rejects.toMatchObject({
    kind: 'transport',
    message: 'The plugin download stalled. Try again.',
  })
  void checked.catch(() => {})
  await vi.advanceTimersByTimeAsync(30_001)
  await checked
})

it('empty chunks cannot keep a stalled download alive', async () => {
  vi.useFakeTimers()
  const checked = expect(
    downloadPluginBytes({
      url,
      maximum: 3,
      fetch: stream([
        [10_000, ''],
        [20_000, ''],
        [40_000, 'a'],
      ]),
    }),
  ).rejects.toMatchObject({
    message: 'The plugin download stalled. Try again.',
  })
  void checked.catch(() => {})
  await vi.advanceTimersByTimeAsync(30_001)
  await checked
})

it('retains an explicit catalogue total deadline even when bytes arrive', async () => {
  vi.useFakeTimers()
  const checked = expect(
    downloadPluginBytes({
      url,
      maximum: 3,
      milliseconds: 10_000,
      fetch: stream([
        [5_000, 'a'],
        [9_000, 'b'],
        [15_000, 'c'],
      ]),
    }),
  ).rejects.toMatchObject({ kind: 'transport' })
  void checked.catch(() => {})
  await vi.advanceTimersByTimeAsync(10_001)
  await checked
})

it('still rejects a wrong digest after a slow progressing transfer', async () => {
  vi.useFakeTimers()
  const checked = expect(
    downloadPluginBytes({
      url,
      maximum: 2,
      sha256: '0'.repeat(64),
      fetch: stream([
        [20_000, 'a'],
        [40_000, 'b'],
      ]),
    }),
  ).rejects.toMatchObject({ kind: 'integrity' })
  void checked.catch(() => {})
  await vi.advanceTimersByTimeAsync(40_001)
  await checked
})
