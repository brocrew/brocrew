import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadChecked, sha512Of } from '../src/main/guided-update'

const IMAGE = Buffer.alloc(32 * 1024, 17)
const SHA = createHash('sha512').update(IMAGE).digest('base64')
const NOTE = 'Brook’s fictional draft, kept by its owner.\n'
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
  it('leaves a link at the old predictable partial name and its target untouched', async () => {
    const target = join(folder, 'draft.md')
    const oldPartial = `${destination}.${process.pid}.partial`
    writeFileSync(target, NOTE)
    symlinkSync(target, oldPartial)

    expect(await download()).toBe(destination)
    expect(readFileSync(target, 'utf8') === NOTE).toBe(true)
    expect(lstatSync(oldPartial).isSymbolicLink()).toBe(true)
    expect(await sha512Of(destination)).toBe(SHA)
    expect(readdirSync(folder).sort()).toEqual([
      'Fern-1.0.0.dmg',
      `Fern-1.0.0.dmg.${process.pid}.partial`,
      'draft.md',
    ])
  })

  it('keeps a different existing final file and lands the checked download beside it', async () => {
    writeFileSync(destination, NOTE)
    const path = await download()
    expect(readFileSync(destination, 'utf8') === NOTE).toBe(true)
    expect(path).not.toBe(destination)
    expect(await sha512Of(path)).toBe(SHA)
    expect(readdirSync(folder)).toHaveLength(2)
  })

  it('keeps a link at the final name even when its target happens to match the checksum', async () => {
    const target = join(folder, 'other-image.dmg')
    writeFileSync(target, IMAGE)
    symlinkSync(target, destination)
    const fetch = vi.fn(async () => response())
    const path = await download({ fetch })
    expect(path).not.toBe(destination)
    expect(fetch).toHaveBeenCalledOnce()
    expect(lstatSync(destination).isSymbolicLink()).toBe(true)
    expect(readFileSync(target)).toEqual(IMAGE)
    expect(await sha512Of(path)).toBe(SHA)
  })

  it('keeps both names when a final-name collision appears during the download', async () => {
    const path = await download({
      fetch: async () => {
        writeFileSync(destination, NOTE)
        return response()
      },
    })
    expect(readFileSync(destination, 'utf8') === NOTE).toBe(true)
    expect(path).not.toBe(destination)
    expect(await sha512Of(path)).toBe(SHA)
  })

  it('lands an ordinary download with its checksum and no partial file', async () => {
    const progress: number[] = []
    expect(await download({ onPercent: (percent) => progress.push(percent) })).toBe(destination)
    expect(await sha512Of(destination)).toBe(SHA)
    expect(progress.at(-1)).toBe(100)
    expect(readdirSync(folder)).toEqual(['Fern-1.0.0.dmg'])
  })

  it('reuses a regular checked download without another fetch', async () => {
    writeFileSync(destination, IMAGE)
    const fetch = vi.fn(async () => response())
    expect(await download({ fetch })).toBe(destination)
    expect(fetch).not.toHaveBeenCalled()
    expect(readFileSync(destination)).toEqual(IMAGE)
  })

  it('removes only its own partial file on a checksum failure', async () => {
    writeFileSync(destination, NOTE)
    await expect(
      download({ fetch: async () => response(Buffer.from('not the image')) }),
    ).rejects.toThrow(
      'the download did not match the sha512 its release published, so it was deleted',
    )
    expect(readdirSync(folder)).toEqual(['Fern-1.0.0.dmg'])
    expect(readFileSync(destination, 'utf8') === NOTE).toBe(true)
  })

  it('cancels a partly written download, aborts the fetch and leaves no partial file', async () => {
    const cancel = new AbortController()
    let body: ReadableStreamDefaultController<Uint8Array> | undefined
    let requestSignal: AbortSignal | undefined
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending'
    let refusal: unknown
    const pending = download({
      ...{ signal: cancel.signal },
      fetch: async (_url, options) => {
        requestSignal = options?.signal as AbortSignal
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              body = controller
              controller.enqueue(new Uint8Array(IMAGE.subarray(0, 1024)))
            },
          }),
        )
      },
    }).then(
      () => {
        outcome = 'resolved'
      },
      (error: unknown) => {
        outcome = 'rejected'
        refusal = error
      },
    )
    try {
      await vi.waitFor(() => {
        const partial = readdirSync(staging).find((name) => name.includes('.partial'))
        expect(partial).toBeDefined()
        expect(partial !== undefined && statSync(join(staging, partial)).size).toBe(1024)
      })
      cancel.abort()
      await vi.waitFor(() => expect(outcome).toBe('rejected'))
      expect(refusal).toMatchObject({ name: 'AbortError' })
      expect(requestSignal?.aborted).toBe(true)
      expect(readdirSync(folder)).toEqual([])
      expect(existsSync(destination)).toBe(false)
    } finally {
      // The unfixed implementation ignores the signal; release its fake reader after the assertion.
      body?.error(new DOMException('Fictional transport cancelled', 'AbortError'))
      await pending
    }
  })
})
