import { expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { finished } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { readPluginArchive } from '../src/main/plugins/package-archive'
import { PLUGIN_LIMITS } from '../src/main/plugins/package-digests'

const audit = vi.hoisted(() => ({ maximum: 0, nativeCapRefused: false }))
vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:zlib')>()
  return {
    ...actual,
    gunzipSync(
      input: Parameters<typeof actual.gunzipSync>[0],
      options: Parameters<typeof actual.gunzipSync>[1],
    ) {
      audit.maximum = options?.maxOutputLength ?? 0
      try {
        return actual.gunzipSync(input, options)
      } catch (error) {
        audit.nativeCapRefused =
          error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE'
        throw error
      }
    },
  }
})

it('the native gzip decoder itself stops at 256 MiB even when the ratio allows more', async () => {
  // Stream a fixed 512 KiB block, with 16 KiB of deterministic noise per block.
  // The gzip stays below 64 MiB but above 2.56 MiB, so the global decoder cap wins.
  // Never construct the 256.5 MiB uncompressed fixture as a single input allocation.
  const block = Buffer.alloc(512 * 1024)
  let state = 0x12345678
  for (let index = 0; index < 16 * 1024; index++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    block[index] = state & 255
  }
  const gzip = createGzip({ level: 1 })
  const chunks: Buffer[] = []
  gzip.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = finished(gzip)
  for (let index = 0; index < 513; index++) {
    if (!gzip.write(block)) await once(gzip, 'drain')
  }
  gzip.end()
  await done
  const compressed = Buffer.concat(chunks)
  expect(compressed.length).toBeLessThan(PLUGIN_LIMITS.archiveBytes)
  expect(compressed.length * PLUGIN_LIMITS.compressionRatio).toBeGreaterThan(
    PLUGIN_LIMITS.expandedBytes,
  )
  expect(() => readPluginArchive(compressed, 'tar.gz')).toThrow(
    expect.objectContaining({ code: 'limit' }),
  )
  expect(audit.maximum).toBe(256 * 1024 * 1024)
  expect(audit.nativeCapRefused).toBe(true)
}, 10_000)
