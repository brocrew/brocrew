import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { gunzipCheckpoint, gzipCheckpoint } from '../../src/main/recovery/checkpoint-compression'
import { nodeFs, type RecoveryFs } from '../../src/main/recovery/files'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

/** A file several compression pieces long, with a short tail. */
function largeSource(): { folder: string; source: string; bytes: Buffer } {
  const folder = mkdtempSync(join(tmpdir(), 'checkpoint-compression-'))
  folders.push(folder)
  const bytes = randomBytes(40 * 1024 * 1024 + 4321)
  const source = join(folder, 'source.sqlite')
  writeFileSync(source, bytes)
  return { folder, source, bytes }
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

describe('the compressed recovery copy', () => {
  it('reads back, through restore and plain gunzip, as the file it was made from', async () => {
    const { folder, source, bytes } = largeSource()
    const copy = join(folder, 'copy.gz')
    const made = await gzipCheckpoint(source, copy, nodeFs)
    expect(made).toEqual({ bytes: bytes.length, sha256: sha256(bytes) })

    const restored = join(folder, 'restored.sqlite')
    expect(await gunzipCheckpoint(copy, restored, bytes.length, nodeFs)).toEqual(made)
    expect(sha256(readFileSync(restored))).toBe(made.sha256)
    expect(sha256(gunzipSync(readFileSync(copy)))).toBe(made.sha256)
  })

  it('stops when asked mid-copy, with both files closed', async () => {
    const { folder, source } = largeSource()
    const stop = new AbortController()
    const closed: string[] = []
    const fs: RecoveryFs = {
      ...nodeFs,
      open: async (path, flags, mode) => {
        const handle = await nodeFs.open(path, flags, mode)
        return {
          ...handle,
          read: async (...args) => {
            const read = await handle.read(...args)
            stop.abort()
            return read
          },
          close: async () => {
            closed.push(path)
            await handle.close()
          },
        }
      },
    }
    const copy = join(folder, 'copy.gz')
    await expect(gzipCheckpoint(source, copy, fs, stop.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(closed.sort()).toEqual([copy, source].sort())
  })
})
