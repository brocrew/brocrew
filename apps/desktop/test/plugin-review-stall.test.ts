import { afterEach, expect, it, vi } from 'vitest'
import { disclosureFixture, review, settingsPeer } from './plugin-disclosure-fixtures'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { downloadPluginBytes, PluginDownloadError } from '../src/main/plugins/catalogue/download'
import { randomUUID } from 'node:crypto'
import { pluginMutationFailureNotice } from '../src/shared/plugin-settings'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function setup() {
  const f = await disclosureFixture({ installed: true })
  closers.push(f.close)
  const client = await f.connect()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    const abort = new AbortController()
    setTimeout(() => abort.abort(), ms)
    return abort.signal
  })
  return { f, client }
}
function holdPreviewDownload(f: Awaited<ReturnType<typeof disclosureFixture>>) {
  let started!: () => void, fail!: (error: Error) => void
  const begun = new Promise<void>((resolve) => {
    started = resolve
  })
  f.download.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
        started()
      }),
  )
  return { begun, fail: (error: Error) => fail(error) }
}
function progressing(
  archive: Uint8Array,
  signal: AbortSignal,
  onProgress?: (received: number) => void,
  count = 3,
) {
  const width = Math.ceil(archive.length / count)
  return downloadPluginBytes({
    url: 'https://github.com/brocrew/brocrew/releases/download/fictional/archive.tar',
    maximum: archive.length,
    size: archive.length,
    signal,
    onProgress,
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (let i = 0; i < count; i++)
              setTimeout(
                () => {
                  controller.enqueue(archive.slice(i * width, (i + 1) * width))
                  if (i === count - 1) controller.close()
                },
                (i + 1) * 20_000,
              )
          },
          cancel() {},
        }),
      ),
  })
}

it.each(['preview', 'owner'] as const)(
  'reviews an update with a progressing sixty-second %s download',
  async (where) => {
    const { f, client } = await setup()
    const download = where === 'preview' ? f.download : f.ownerDownload
    download.mockClear()
    let started!: () => void
    const begun = new Promise<void>((resolve) => {
      started = resolve
    })
    download.mockImplementationOnce((_release, signal) => {
      started()
      return progressing(f.next.archive, signal)
    })
    const pending = review(client, 'update')
    await begun
    await vi.advanceTimersByTimeAsync(60_001)
    const shown = await pending
    expect(shown.details?.digest).toBe(f.next.release.archive.sha256)
    expect(f.f.state.inspect().guards[0]?.release.version).toBe('1.0.1')
    expect(f.f.state.inspect().pending).toBeNull()
    expect(f.reviewFailures).not.toHaveBeenCalled()
  },
)

it.each(['preview', 'owner'] as const)(
  'delivers real byte progress from a slow %s transfer to only its Settings window',
  async (where) => {
    const { f, client } = await setup()
    const peer = settingsPeer(client),
      other = settingsPeer(client)
    const requestId = randomUUID()
    let started!: () => void
    const begun = new Promise<void>((resolve) => {
      started = resolve
    })
    const download = where === 'preview' ? f.download : f.ownerDownload
    download.mockImplementationOnce((_release, signal, onProgress) => {
      started()
      return progressing(f.next.archive, signal, onProgress)
    })
    const pending = peer.call({ kind: 'prepare', action: 'update', id: 'chrome', requestId })
    await begun
    await vi.advanceTimersByTimeAsync(60_001)
    expect(await pending).toMatchObject({ ok: true })
    const delivered = peer.owner.webContents.send.mock.calls
      .filter(([channel]) => channel === 'plugins:review-progress')
      .map(([, value]) => value)
    const width = Math.ceil(f.next.archive.length / 3)
    for (const receivedBytes of [width, width * 2, f.next.archive.length])
      expect(delivered).toContainEqual({
        requestId,
        id: 'chrome',
        phase: 'downloading',
        receivedBytes,
        totalBytes: f.next.archive.length,
      })
    expect(delivered).toContainEqual({
      requestId,
      id: 'chrome',
      phase: 'checking',
      receivedBytes: f.next.archive.length,
      totalBytes: f.next.archive.length,
    })
    expect(other.owner.webContents.send).not.toHaveBeenCalledWith(
      'plugins:review-progress',
      expect.anything(),
    )
    expect(f.f.state.inspect().guards[0]?.release.version).toBe('1.0.1')
  },
)

it.each(['preview', 'owner'] as const)(
  'returns the real %s stall notice before any update is offered',
  async (where) => {
    const { f, client } = await setup()
    const download = where === 'preview' ? f.download : f.ownerDownload
    let started!: () => void
    const begun = new Promise<void>((resolve) => {
      started = resolve
    })
    download.mockImplementationOnce((_release, signal) => {
      started()
      return downloadPluginBytes({
        url: 'https://github.com/brocrew/brocrew/releases/download/fictional/archive.tar',
        maximum: f.next.archive.length,
        signal,
        fetch: async () => new Response(new ReadableStream({ start() {}, cancel() {} })),
      })
    })
    const peer = settingsPeer(client)
    const pending = peer.call({ kind: 'prepare', action: 'update', id: 'chrome' })
    await begun
    await vi.advanceTimersByTimeAsync(30_001)
    expect(await pending).toMatchObject({ ok: false, mutationFailure: 'download-stalled' })
    expect(pluginMutationFailureNotice('download-stalled')).toBe(
      'The plugin download stalled. Try again.',
    )
    expect(f.reviewFailures).toHaveBeenCalledWith(
      'update',
      where === 'preview' ? 'download' : 'owner-prepare',
      'download-stalled',
      'download-stalled',
    )
    expect(f.f.state.inspect().pending).toBeNull()
    expect(f.f.state.inspect().guards[0]?.release.version).toBe('1.0.1')
  },
)

it('cancelling a pending review aborts its real owner-side download without publishing a change', async () => {
  const { f, client } = await setup()
  let started!: () => void, cancelled!: () => void
  const begun = new Promise<void>((resolve) => {
    started = resolve
  })
  const stopped = new Promise<void>((resolve) => {
    cancelled = resolve
  })
  f.ownerDownload.mockImplementationOnce(
    (_release, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            cancelled()
            reject(new PluginDownloadError('transport'))
          },
          { once: true },
        )
        started()
      }),
  )
  const peer = settingsPeer(client),
    requestId = randomUUID()
  const pending = peer.call({ kind: 'prepare', action: 'update', id: 'chrome', requestId })
  await begun
  await peer.call({ kind: 'cancel-prepare', id: 'chrome', requestId })
  await stopped
  expect(await pending).toMatchObject({ ok: false, mutationFailure: 'policy-refused' })
  expect(f.f.state.inspect().pending).toBeNull()
  expect(f.f.state.inspect().guards[0]?.release.version).toBe('1.0.1')
})

it('invalidation still wins over a concurrent download stall and retains the original cause', async () => {
  const { f, client } = await setup()
  const held = holdPreviewDownload(f)
  const checked = expect(review(client, 'update')).rejects.toMatchObject({ code: 'policy-refused' })
  void checked.catch(() => {})
  await held.begun
  client.cancelPreparations!()
  held.fail(new PluginDownloadError('transport', undefined, true))
  await checked
  expect(f.reviewFailures).toHaveBeenCalledWith(
    'update',
    'download',
    'policy-refused',
    'download-stalled',
  )
  expect(f.f.state.inspect().pending).toBeNull()
})

it('real owner progress keeps preparation alive past the person-channel total interval', async () => {
  const { f, client } = await setup()
  let started!: () => void, heard!: () => void
  const begun = new Promise<void>((resolve) => {
    started = resolve
  })
  f.ownerDownload.mockImplementationOnce((_release, signal, onProgress) => {
    started()
    return progressing(f.next.archive, signal, onProgress, 10)
  })
  const pending = client.reviewMutation!('update', 'chrome', {
    requestId: randomUUID(),
    signal: new AbortController().signal,
    onProgress(value) {
      if (value.phase === 'downloading' && value.receivedBytes > 0) heard?.()
    },
  })
  await begun
  for (let i = 0; i < 10; i++) {
    const advanced = new Promise<void>((resolve) => {
      heard = resolve
    })
    await vi.advanceTimersByTimeAsync(20_000)
    await advanced
  }
  expect((await pending).details?.digest).toBe(f.next.release.archive.sha256)
  expect(f.f.state.inspect().guards[0]?.release.version).toBe('1.0.1')
})

it('the confirmed update can fetch slowly without bypassing its consumed consent', async () => {
  const { f, client } = await setup()
  const shown = await review(client, 'update')
  let started!: () => void
  const begun = new Promise<void>((resolve) => {
    started = resolve
  })
  f.ownerDownload.mockImplementationOnce((_release, signal, onProgress) => {
    started()
    return progressing(f.next.archive, signal, onProgress)
  })
  const pending = client.update!('chrome', shown.consent)
  await begun
  await vi.advanceTimersByTimeAsync(60_001)
  await pending
  expect(f.f.state.inspect().guards[0]?.release.version).toBe('1.0.2')
  await expect(client.update!('chrome', shown.consent)).rejects.toMatchObject({
    code: 'policy-refused',
  })
})

it('a late cancelled download failure cannot erase a replacement review consent', async () => {
  const { f, client } = await setup()
  const held = holdPreviewDownload(f)
  const old = expect(review(client, 'update')).rejects.toMatchObject({ code: 'policy-refused' })
  void old.catch(() => {})
  await held.begun
  const shown = await review(client, 'update')
  held.fail(new PluginDownloadError('transport'))
  await old
  await client.update!('chrome', shown.consent)
  expect(f.f.state.inspect().guards[0]?.release.version).toBe('1.0.2')
})
