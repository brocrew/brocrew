import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadChecked } from '../src/main/guided-update'

const IMAGE = Buffer.alloc(32 * 1024, 17)
const SHA = createHash('sha512').update(IMAGE).digest('base64')
const NOTE = 'Brook’s fictional draft, kept by its owner.\n'
const sha512Of = (file: string): string =>
  createHash('sha512').update(readFileSync(file)).digest('base64')
let staging: string
let folder: string
let destination: string

beforeEach(() => {
  staging = mkdtempSync(join(tmpdir(), 'brocrew-private-stage-'))
  folder = mkdtempSync(join(tmpdir(), 'brocrew-download-'))
  destination = join(folder, 'Fern-1.0.0.dmg')
})

afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
  rmSync(staging, { recursive: true, force: true })
})

function response(bytes = IMAGE): Response {
  return new Response(new Uint8Array(bytes), {
    headers: { 'content-length': String(bytes.length) },
  })
}

const download = (options: Partial<Parameters<typeof downloadChecked>[0]> = {}) =>
  downloadChecked({
    url: 'https://fictional.invalid/Fern-1.0.0.dmg',
    sha512: SHA,
    to: destination,
    stagingFolder: staging,
    onPercent: () => {},
    fetch: async () => response(),
    ...options,
  })

describe('an update download keeps the person’s files', () => {
  it('lands a matching download, reports 100 and leaves staging empty', async () => {
    const progress: number[] = []
    expect(await download({ onPercent: (percent) => progress.push(percent) })).toBe(destination)
    expect(sha512Of(destination)).toBe(SHA)
    expect(progress.at(-1)).toBe(100)
    expect(readdirSync(folder)).toEqual(['Fern-1.0.0.dmg'])
    expect(readdirSync(staging)).toEqual([])
  })

  it('asks without cookies and with its own user agent', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => response())
    await download({ fetch })
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      credentials: 'omit',
      headers: { 'user-agent': 'BroCrew' },
    })
  })

  it('keeps a different existing file and lands the download beside it', async () => {
    writeFileSync(destination, NOTE)
    const path = await download()
    expect(readFileSync(destination, 'utf8')).toBe(NOTE)
    expect(path).toBe(join(folder, 'Fern-1.0.0 (1).dmg'))
    expect(sha512Of(path)).toBe(SHA)
  })

  it('keeps both names when the final name appears during the download', async () => {
    const path = await download({
      fetch: async () => {
        writeFileSync(destination, NOTE)
        return response()
      },
    })
    expect(readFileSync(destination, 'utf8')).toBe(NOTE)
    expect(path).toBe(join(folder, 'Fern-1.0.0 (1).dmg'))
    expect(sha512Of(path)).toBe(SHA)
  })

  it('deletes a download whose sha512 is wrong and touches nothing in the folder', async () => {
    writeFileSync(destination, NOTE)
    await expect(
      download({ fetch: async () => response(Buffer.from('not the image')) }),
    ).rejects.toThrow(
      'the download did not match the sha512 its release published, so it was deleted',
    )
    expect(readdirSync(folder)).toEqual(['Fern-1.0.0.dmg'])
    expect(readFileSync(destination, 'utf8')).toBe(NOTE)
    expect(readdirSync(staging)).toEqual([])
  })

  it('a failed copy removes its own name and says where it could not be saved', async () => {
    const missing = join(folder, 'moved-away')
    await expect(download({ to: join(missing, 'Fern-1.0.0.dmg') })).rejects.toThrow(
      `the download could not be saved to ${missing}`,
    )
    expect(readdirSync(folder)).toEqual([])
    expect(readdirSync(staging)).toEqual([])
  })

  it('a cancel mid-download ends the request, removes the partial and leaves the folder alone', async () => {
    writeFileSync(destination, NOTE)
    const cancel = new AbortController()
    let requestSignal: AbortSignal | undefined
    const pending = download({
      signal: cancel.signal,
      fetch: async (_url, init) => {
        requestSignal = init.signal ?? undefined
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(IMAGE.subarray(0, 1024)))
            },
          }),
        )
      },
    })
    await vi.waitFor(() => {
      const partial = readdirSync(staging).find((name) => name.endsWith('.partial'))
      expect(partial !== undefined && statSync(join(staging, partial)).size).toBe(1024)
    })
    cancel.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(requestSignal?.aborted).toBe(true)
    expect(readdirSync(staging)).toEqual([])
    expect(readdirSync(folder)).toEqual(['Fern-1.0.0.dmg'])
    expect(readFileSync(destination, 'utf8')).toBe(NOTE)
  })
})
