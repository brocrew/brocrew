import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DownloadRouter } from '../src/browser/downloadRouter.js'
import { MAX_DOWNLOAD_BYTES } from '../src/files.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-download-policy-'))
  roots.push(dir)
  const session = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> }
  session.send = vi.fn(async () => undefined)
  const failed = vi.fn(async () => undefined)
  const router = new DownloadRouter({
    dir,
    session,
    nativeDir: () => path.join(dir, 'kept'),
    onPolicyFailure: failed,
  })
  const begin = (guid: string, frameId = 'fern-frame') => {
    if (!fs.existsSync(path.join(dir, guid)))
      fs.writeFileSync(path.join(dir, guid), 'fictional staged bytes')
    session.emit('Browser.downloadWillBegin', { guid, frameId, suggestedFilename: 'paper.txt' })
  }
  const progress = (guid: string, receivedBytes: number, state = 'inProgress', totalBytes = 0) =>
    session.emit('Browser.downloadProgress', { guid, receivedBytes, totalBytes, state })
  return { dir, session, router, failed, begin, progress }
}
it('reports only advancing received bytes for the owning active capture', async () => {
  const h = fixture()
  const activity = vi.fn()
  const capture = h.router.capture(async () => new Set(['fern-frame']), activity)
  h.begin('fern')
  await flush()
  h.progress('fern', 10)
  h.progress('fern', 10)
  h.progress('fern', 5)
  h.progress('fern', 20)
  h.begin('other', 'other-frame')
  h.progress('other', 30)
  expect(activity).toHaveBeenCalledTimes(2)
  capture.end()
  h.progress('fern', 40)
  expect(activity).toHaveBeenCalledTimes(2)
})
it.each(['received', 'declared'] as const)(
  'cancels a page download beyond 200 MB (%s), including a claimed download',
  async (kind) => {
    const h = fixture()
    const capture = h.router.capture(async () => new Set(['fern-frame']))
    h.begin('fern')
    await flush()
    h.progress('fern', MAX_DOWNLOAD_BYTES)
    expect(h.session.send).not.toHaveBeenCalled()
    h.progress(
      'fern',
      kind === 'received' ? MAX_DOWNLOAD_BYTES + 1 : 1,
      'inProgress',
      kind === 'declared' ? MAX_DOWNLOAD_BYTES + 1 : 0,
    )
    expect(h.session.send).toHaveBeenCalledWith('Browser.cancelDownload', { guid: 'fern' })
    // A late completion must not revive a refused record or preserve its file.
    h.progress('fern', MAX_DOWNLOAD_BYTES + 1, 'completed')
    capture.end()
    expect(h.router.sweep().size).toBe(0)
    expect(fs.existsSync(path.join(h.dir, 'kept'))).toBe(false)
  },
)
it('keeps unclaimed downloads after the former hourly count, across browser generations', async () => {
  const first = fixture()
  for (let i = 0; i < 25; i++) first.begin(`fern-${i}`)
  await flush()
  expect(first.session.send).not.toHaveBeenCalled()
  const nextGeneration = fixture()
  nextGeneration.begin('fern-extra')
  await flush()
  expect(nextGeneration.session.send).not.toHaveBeenCalled()
  nextGeneration.progress('fern-extra', 22, 'completed')
  await vi.waitFor(() =>
    expect(fs.readFileSync(path.join(nextGeneration.dir, 'kept', 'paper.txt'), 'utf8')).toBe(
      'fictional staged bytes',
    ),
  )
  const otherProfile = fixture()
  otherProfile.begin('willow-first')
  await flush()
  expect(otherProfile.session.send).not.toHaveBeenCalled()
})
it('keeps 500 active records bounded and cancels only the overflow', async () => {
  const h = fixture()
  for (let i = 0; i < 500; i++) h.begin(`fern-${i}`)
  h.begin('fern-overflow')
  await flush()
  expect(h.session.send.mock.calls).toEqual([['Browser.cancelDownload', { guid: 'fern-overflow' }]])
})
it('ends its owned browser if Chrome cannot cancel an oversized page download', async () => {
  const h = fixture()
  h.session.send.mockRejectedValue(new Error('fictional protocol failure'))
  h.begin('fern')
  h.progress('fern', MAX_DOWNLOAD_BYTES + 1)
  await flush()
  expect(h.failed).toHaveBeenCalledOnce()
})

it('successful tool captures do not fill the record cap', async () => {
  const h = fixture()
  for (let i = 0; i < 501; i++) {
    const capture = h.router.capture(async () => new Set(['fern-frame']))
    h.begin(`fern-tool-${i}`)
    await flush()
    // The tool saved and removed its artifact; its CDP completion can arrive late.
    capture.end(true, `fern-tool-${i}`)
    h.progress(`fern-tool-${i}`, 1, 'completed')
  }
  expect(h.session.send).not.toHaveBeenCalled()
  h.begin('fern-unclaimed')
  await flush()
  expect(h.session.send).not.toHaveBeenCalled()
})

it('keeps a still-running claim capped when success saved an older download', async () => {
  const h = fixture()
  // D1 was already queued for the tool. During its call, the router claims D2.
  const capture = h.router.capture(async () => new Set(['fern-frame']))
  h.begin('fern-second')
  await flush()
  capture.end(true, 'fern-older') // Saving the older file does not finish this claim.
  h.progress('fern-second', MAX_DOWNLOAD_BYTES + 1)
  expect(h.session.send).toHaveBeenCalledWith('Browser.cancelDownload', { guid: 'fern-second' })
})
it('discards the saved claim only after its own completed event', async () => {
  const h = fixture()
  const capture = h.router.capture(async () => new Set(['fern-frame']))
  h.begin('fern-extra')
  await flush()
  const staged = path.join(h.dir, 'fern-extra')
  fs.writeFileSync(staged, 'fictional bytes')
  capture.end(true, 'fern-extra')
  expect(fs.existsSync(staged)).toBe(true)
  h.progress('fern-extra', 15, 'completed')
  await vi.waitFor(() => expect(fs.existsSync(staged)).toBe(false))
  expect(h.session.send).not.toHaveBeenCalled()
  expect(fs.existsSync(path.join(h.dir, 'kept'))).toBe(false)
})

it('does not let a later call claim a download whose frame lookup outlived the original call', async () => {
  const h = fixture()
  const frames = Promise.withResolvers<ReadonlySet<string>>()
  const first = h.router.capture(() => frames.promise)
  fs.writeFileSync(path.join(h.dir, 'slow-decision'), 'fictional held bytes')
  h.begin('slow-decision')
  await flush()
  first.end()
  const later = h.router.capture(async () => new Set(['fern-frame']))
  h.progress('slow-decision', 20, 'completed')
  frames.resolve(new Set(['fern-frame']))
  await vi.waitFor(() =>
    expect(fs.readFileSync(path.join(h.dir, 'kept', 'paper.txt'), 'utf8')).toBe(
      'fictional held bytes',
    ),
  )
  later.end()
})

it('does not cancel an unverified file but retries the size guard once a private partial is proven', async () => {
  const h = fixture()
  h.session.emit('Browser.downloadWillBegin', {
    guid: 'not-yet-written',
    frameId: 'fern-frame',
    suggestedFilename: 'fictional-paper.txt',
  })
  await flush()
  h.progress('not-yet-written', MAX_DOWNLOAD_BYTES + 1)
  expect(h.session.send).not.toHaveBeenCalled()
  fs.writeFileSync(path.join(h.dir, 'not-yet-written.crdownload'), 'fictional private partial')
  h.progress('not-yet-written', MAX_DOWNLOAD_BYTES + 2)
  expect(h.session.send).toHaveBeenCalledWith('Browser.cancelDownload', { guid: 'not-yet-written' })
})
