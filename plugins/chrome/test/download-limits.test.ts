import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  DownloadRouter,
  MAX_UNCLAIMED_PER_HOUR,
  UnclaimedDownloadQuota,
} from '../src/browser/downloadRouter.js'
import { MAX_DOWNLOAD_BYTES } from '../src/files.js'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
function fixture(allowUnclaimed = true, quota = new UnclaimedDownloadQuota()) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-download-policy-'))
  roots.push(dir)
  const session = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> }
  session.send = vi.fn(async () => undefined)
  const failed = vi.fn(async () => undefined)
  const router = new DownloadRouter({
    dir,
    session,
    allowUnclaimed,
    quota,
    nativeDir: () => path.join(dir, 'kept'),
    onPolicyFailure: failed,
  })
  const begin = (guid: string, frameId = 'fern-frame') =>
    session.emit('Browser.downloadWillBegin', { guid, frameId, suggestedFilename: 'paper.txt' })
  const progress = (guid: string, receivedBytes: number, state = 'inProgress', totalBytes = 0) =>
    session.emit('Browser.downloadProgress', { guid, receivedBytes, totalBytes, state })
  return { dir, session, router, failed, begin, progress }
}
it.each(['received', 'declared'] as const)(
  'cancels a page download beyond 200 MB (%s), including a claimed download',
  async (kind) => {
    const h = fixture(false)
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
it('caps unclaimed downloads per profile per rolling hour, across browser generations', async () => {
  let now = 0
  const quota = new UnclaimedDownloadQuota(() => now)
  const first = fixture(true, quota)
  for (let i = 0; i < MAX_UNCLAIMED_PER_HOUR; i++) first.begin(`fern-${i}`)
  await flush()
  expect(first.session.send).not.toHaveBeenCalled()
  const nextGeneration = fixture(true, quota)
  nextGeneration.begin('fern-extra')
  await flush()
  expect(nextGeneration.session.send).toHaveBeenCalledWith('Browser.cancelDownload', {
    guid: 'fern-extra',
  })
  const otherProfile = fixture(true)
  otherProfile.begin('willow-first')
  await flush()
  expect(otherProfile.session.send).not.toHaveBeenCalled()
  now = 60 * 60 * 1000
  nextGeneration.session.send.mockClear()
  nextGeneration.begin('fern-new-hour')
  await flush()
  expect(nextGeneration.session.send).not.toHaveBeenCalled()
})
it('refuses unclaimed headless downloads, including other frames and extra downloads during a call', async () => {
  const h = fixture(false)
  h.begin('before')
  await flush()
  const capture = h.router.capture(async () => new Set(['fern-frame']))
  h.begin('other-frame', 'willow-frame')
  h.begin('claimed')
  h.begin('extra')
  await flush()
  expect(h.session.send.mock.calls.map((c) => c[1].guid)).toEqual([
    'before',
    'other-frame',
    'extra',
  ])
  capture.end()
  expect(h.session.send).toHaveBeenCalledWith('Browser.cancelDownload', { guid: 'claimed' })
})
it('ends its owned browser if Chrome cannot cancel an oversized page download', async () => {
  const h = fixture()
  h.session.send.mockRejectedValue(new Error('fictional protocol failure'))
  h.begin('fern')
  h.progress('fern', MAX_DOWNLOAD_BYTES + 1)
  await flush()
  expect(h.failed).toHaveBeenCalledOnce()
})

it.each([true, false])(
  'successful tool captures do not consume unattended quota or fill the record cap (visible=%s)',
  async (visible) => {
    const h = fixture(visible)
    for (let i = 0; i < 501; i++) {
      const capture = h.router.capture(async () => new Set(['fern-frame']))
      h.begin(`fern-tool-${i}`)
      await flush()
      // The tool saved and removed its artifact; its CDP completion can arrive late.
      capture.end(true)
      h.progress(`fern-tool-${i}`, 1, 'completed')
    }
    expect(h.session.send).not.toHaveBeenCalled()
    h.begin('fern-unclaimed')
    await flush()
    if (visible) expect(h.session.send).not.toHaveBeenCalled()
    else
      expect(h.session.send).toHaveBeenCalledWith('Browser.cancelDownload', {
        guid: 'fern-unclaimed',
      })
  },
)

it.each([true, false])(
  'keeps a still-running claim capped when success saved an older download (visible=%s)',
  async (visible) => {
    const h = fixture(visible)
    // D1 was already queued for the tool. During its call, the router claims D2.
    const capture = h.router.capture(async () => new Set(['fern-frame']))
    h.begin('fern-second')
    await flush()
    capture.end(true) // The tool saved D1; this does not prove D2 has finished.
    h.progress('fern-second', MAX_DOWNLOAD_BYTES + 1)
    expect(h.session.send).toHaveBeenCalledWith('Browser.cancelDownload', { guid: 'fern-second' })
  },
)
it('discards the released extra file only after its own completed event', async () => {
  const h = fixture(true)
  const capture = h.router.capture(async () => new Set(['fern-frame']))
  h.begin('fern-extra')
  await flush()
  const staged = path.join(h.dir, 'fern-extra')
  fs.writeFileSync(staged, 'fictional bytes')
  capture.end(true)
  expect(fs.existsSync(staged)).toBe(true)
  h.progress('fern-extra', 15, 'completed')
  await vi.waitFor(() => expect(fs.existsSync(staged)).toBe(false))
  expect(h.session.send).not.toHaveBeenCalled()
  expect(fs.existsSync(path.join(h.dir, 'kept'))).toBe(false)
})
