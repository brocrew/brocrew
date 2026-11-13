import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserContext } from 'playwright-core'
import { ChromeBrowser } from '../src/browser/chromeBrowser.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})
async function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-download-routing-'))
  fs.mkdirSync(path.join(home, 'profiles', 'fern'), { recursive: true })
  const session = Object.assign(new EventEmitter(), {
    send: vi.fn(async (method: string, params: Record<string, unknown>) => {
      void method
      void params
    }),
  })
  let stage = ''
  let closed = false
  const driver = Object.assign(new EventEmitter(), {
    newBrowserCDPSession: async () => session,
    isConnected: () => !closed,
  })
  const context = Object.assign(new EventEmitter(), {
    pages: () => [],
    browser: () => driver,
    close: async () => {
      closed = true
      context.emit('close')
    },
  })
  const browser = new ChromeBrowser({
    dirOf: () => path.join(home, 'profiles', 'fern'),
    downloadsRoot: path.join(home, 'private-downloads'),
    lockHeld: async () => false,
    launchContext: async (opts) => {
      stage = opts.downloadsPath!
      return context as unknown as BrowserContext
    },
  })
  cleanups.push(async () => {
    await browser.closeAll()
    fs.rmSync(home, { recursive: true, force: true })
  })
  await browser.ensure('fern')
  const policy = () =>
    session.send.mock.calls
      .filter((c: unknown[]) => c[0] === 'Browser.setDownloadBehavior')
      .at(-1)?.[1] as unknown as Record<string, unknown>
  return { browser, session, home, stage, policy }
}
it('uses native Chrome routing while idle and after a delayed page download', async () => {
  const f = await fixture()
  expect(f.policy()).toEqual({ behavior: 'default', eventsEnabled: true })
  await f.browser.agentCall(['fern'], async () => expect(f.policy().behavior).toBe('allowAndName'))
  expect(f.policy()).toEqual({ behavior: 'default', eventsEnabled: true })
  const native = path.join(f.home, 'Downloads', 'fictional-paper.pdf')
  fs.mkdirSync(path.dirname(native))
  fs.writeFileSync(native, 'fictional PDF')
  f.session.emit('Browser.downloadWillBegin', {
    guid: 'normal-paper',
    frameId: 'frame',
    suggestedFilename: 'fictional-paper.pdf',
  })
  f.session.emit('Browser.downloadProgress', {
    guid: 'normal-paper',
    state: 'completed',
    filePath: native,
    receivedBytes: 13,
  })
  await new Promise((r) => setImmediate(r))
  await f.browser.closeAll()
  expect(fs.readFileSync(native, 'utf8')).toBe('fictional PDF')
  expect(f.session.send).not.toHaveBeenCalledWith('Browser.cancelDownload', {
    guid: 'normal-paper',
  })
})
it('arms private routing before agent work and preserves it until all overlapping calls finish', async () => {
  const f = await fixture()
  const entered = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>()
  const first = f.browser.agentCall(['fern'], async () => {
    expect(f.policy().behavior).toBe('allowAndName')
    entered.resolve()
    await finish.promise
  })
  await entered.promise
  await f.browser.agentCall(['fern'], async () => expect(f.policy().behavior).toBe('allowAndName'))
  expect(f.policy().behavior).toBe('allowAndName')
  finish.resolve()
  await first
  expect(f.policy().behavior).toBe('default')
})
it('keeps simultaneous manual downloads private and restores native routing after failure', async () => {
  const f = await fixture()
  await expect(
    f.browser.agentCall(['fern'], async () => {
      expect(f.policy().downloadPath).toBe(f.stage)
      fs.writeFileSync(path.join(f.stage, 'ambiguous-guid'), 'fictional private bytes')
      f.session.emit('Browser.downloadWillBegin', {
        guid: 'ambiguous-guid',
        frameId: 'frame',
        suggestedFilename: 'fictional-paper.pdf',
      })
      f.session.emit('Browser.downloadProgress', {
        guid: 'ambiguous-guid',
        state: 'completed',
        receivedBytes: 23,
      })
      throw new Error('fictional canceled action')
    }),
  ).rejects.toThrow('fictional canceled action')
  await vi.waitFor(() =>
    expect(
      fs.readFileSync(path.join(f.home, 'private-downloads', 'fictional-paper.pdf'), 'utf8'),
    ).toBe('fictional private bytes'),
  )
  expect(f.policy().behavior).toBe('default')
})

it('never starts agent work when arming private routing fails', async () => {
  const f = await fixture()
  f.session.send.mockRejectedValue(new Error('fictional protocol failure'))
  const action = vi.fn(async () => undefined)
  await expect(f.browser.agentCall(['fern'], action)).rejects.toThrow('fictional protocol failure')
  expect(action).not.toHaveBeenCalled()
  expect(f.browser.state('fern')).toBeNull()
})

it('retains a private download event delivered while normal routing is being restored', async () => {
  const f = await fixture()
  f.session.send.mockImplementation(async (_method, params) => {
    if (params.behavior !== 'default') return
    fs.writeFileSync(path.join(f.stage, 'late-private-guid'), 'fictional late private bytes')
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'late-private-guid',
      frameId: 'frame',
      suggestedFilename: 'fictional-late.pdf',
    })
    f.session.emit('Browser.downloadProgress', {
      guid: 'late-private-guid',
      state: 'completed',
      receivedBytes: 28,
    })
  })
  await f.browser.agentCall(['fern'], async () => undefined)
  await vi.waitFor(() =>
    expect(
      fs.readFileSync(path.join(f.home, 'private-downloads', 'fictional-late.pdf'), 'utf8'),
    ).toBe('fictional late private bytes'),
  )
})

it('keeps a download private when its bytes finish after the agent call returns', async () => {
  const f = await fixture()
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'slow-private-guid',
      frameId: 'frame',
      suggestedFilename: 'fictional-slow.pdf',
    })
  })
  expect(f.policy().behavior).toBe('default')
  fs.writeFileSync(path.join(f.stage, 'slow-private-guid'), 'fictional slow bytes')
  f.session.emit('Browser.downloadProgress', {
    guid: 'slow-private-guid',
    state: 'completed',
    receivedBytes: 20,
  })
  await vi.waitFor(() =>
    expect(
      fs.readFileSync(path.join(f.home, 'private-downloads', 'fictional-slow.pdf'), 'utf8'),
    ).toBe('fictional slow bytes'),
  )
})

it('never queues or deletes an idle-start download whose page event arrives during a later call', async () => {
  const f = await fixture()
  const { TabRegistry, MAX_PENDING_DOWNLOADS } = await import('../src/tabs.js')
  const { FakePage, FakeDownload } = await import('./fakes.js')
  const page = new FakePage()
  const tabs = new TabRegistry()
  tabs.watch('fern', f.browser)
  const tab = tabs.add('fern', f.browser.state('fern')!.generation, page as never)
  const normal = new FakeDownload(
    'fictional-paper.pdf',
    Buffer.from('fictional bytes'),
    path.join(f.stage, 'public-origin'),
  )
  f.session.emit('Browser.downloadWillBegin', {
    guid: 'public-origin',
    frameId: 'frame',
    suggestedFilename: 'fictional-paper.pdf',
  })
  await f.browser.agentCall(['fern'], async () => {
    page.emit('download', normal)
    for (let i = 0; i < MAX_PENDING_DOWNLOADS + 1; i++) {
      const guid = `private-origin-${i}`
      f.session.emit('Browser.downloadWillBegin', {
        guid,
        frameId: 'frame',
        suggestedFilename: 'fictional-paper.pdf',
      })
      page.emit(
        'download',
        new FakeDownload(
          'fictional-paper.pdf',
          Buffer.from('fictional bytes'),
          path.join(f.stage, guid),
        ),
      )
    }
    await new Promise((r) => setImmediate(r))
    expect(tab.pendingDownloads.some((p) => p.download === (normal as never))).toBe(false)
    expect(normal.deleted).toBe(false)
  })
})
it('recovers a private-start download whose page event arrives after the call returns', async () => {
  const f = await fixture()
  const { TabRegistry } = await import('../src/tabs.js')
  const { FakePage, FakeDownload } = await import('./fakes.js')
  const page = new FakePage()
  const tabs = new TabRegistry()
  tabs.watch('fern', f.browser)
  const tab = tabs.add('fern', f.browser.state('fern')!.generation, page as never)
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'private-before-return',
      frameId: 'frame',
      suggestedFilename: 'fictional-paper.pdf',
    })
  })
  const privateDownload = new FakeDownload(
    'fictional-paper.pdf',
    Buffer.from('fictional bytes'),
    path.join(f.stage, 'private-before-return'),
  )
  page.emit('download', privateDownload)
  await new Promise((r) => setImmediate(r))
  expect(tab.pendingDownloads.map((p) => p.download)).toEqual([privateDownload])
})

it('never authorizes unknown GUIDs, outside paths or failed path inspection for tool cleanup', async () => {
  const f = await fixture()
  const { FakeDownload } = await import('./fakes.js')
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'known-private',
      frameId: 'frame',
      suggestedFilename: 'fictional-paper.pdf',
    })
  })
  for (const file of [
    path.join(f.stage, 'unknown-guid'),
    path.join(f.home, 'Downloads', 'known-private'),
  ]) {
    const download = new FakeDownload('fictional-paper.pdf', Buffer.from('fictional bytes'), file)
    const cancel = vi.spyOn(download, 'cancel')
    expect(await f.browser.downloadIsPrivate('fern', download as never)).toBe(false)
    expect(download.deleted).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  }
  const failed = new FakeDownload('fictional-paper.pdf', Buffer.from('fictional bytes'))
  vi.spyOn(failed, 'path').mockRejectedValue(new Error('fictional unavailable artifact'))
  expect(await f.browser.downloadIsPrivate('fern', failed as never)).toBe(false)
  expect(failed.deleted).toBe(false)
})
it('binds cached private artifact ownership to its browser and generation', async () => {
  const f = await fixture()
  const { FakeDownload } = await import('./fakes.js')
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'known-private',
      frameId: 'frame',
      suggestedFilename: 'fictional-paper.pdf',
    })
  })
  const download = new FakeDownload(
    'fictional-paper.pdf',
    Buffer.from('fictional bytes'),
    path.join(f.stage, 'known-private'),
  )
  expect(await f.browser.downloadIsPrivate('fern', download as never)).toBe(true)
  expect(await f.browser.downloadIsPrivate('willow', download as never)).toBe(false)
  await f.browser.close('fern')
  expect(await f.browser.downloadIsPrivate('fern', download as never)).toBe(false)
})

it('makes a private page-event download recoverable before its body completes', async () => {
  const f = await fixture()
  const { TabRegistry } = await import('../src/tabs.js')
  const { FakePage, FakeDownload } = await import('./fakes.js')
  const page = new FakePage(),
    tabs = new TabRegistry()
  tabs.watch('fern', f.browser)
  const tab = tabs.add('fern', f.browser.state('fern')!.generation, page as never)
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'inflight-private',
      frameId: 'frame',
      suggestedFilename: 'fictional-paper.pdf',
    })
  })
  const body = Promise.withResolvers<string>()
  const download = new FakeDownload(
    'fictional-paper.pdf',
    Buffer.from('fictional bytes'),
    path.join(f.stage, 'inflight-private'),
  )
  vi.spyOn(download, 'path').mockImplementation(() => body.promise)
  try {
    page.emit('download', download)
    await vi.waitFor(
      () => expect(tab.pendingDownloads.map((p) => p.download)).toEqual([download]),
      { timeout: 100 },
    )
  } finally {
    body.resolve(download.file)
  }
})

it('correlates a page event that arrives before the sibling browser begin notice', async () => {
  const f = await fixture()
  const { TabRegistry } = await import('../src/tabs.js')
  const { FakePage, FakeDownload } = await import('./fakes.js')
  const page = new FakePage(),
    tabs = new TabRegistry()
  tabs.watch('fern', f.browser)
  const tab = tabs.add('fern', f.browser.state('fern')!.generation, page as never)
  const download = new FakeDownload(
    'fictional-paper.pdf',
    Buffer.from('fictional bytes'),
    path.join(f.stage, 'notice-after-page'),
  )
  await f.browser.agentCall(['fern'], async () => {
    page.emit('download', download)
    await new Promise((r) => setImmediate(r))
    expect(tab.pendingDownloads).toHaveLength(0)
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'notice-after-page',
      frameId: 'frame',
      suggestedFilename: 'fictional-paper.pdf',
    })
    await vi.waitFor(() => expect(tab.pendingDownloads.map((p) => p.download)).toEqual([download]))
  })
})
it('does not authorize cleanup by executing an artifact getter or waiting for a file body', async () => {
  const f = await fixture()
  const getter = vi.fn(() => {
    throw new Error('fictional unsafe getter')
  })
  const download = Object.defineProperty({}, '_artifact', { get: getter })
  expect(await f.browser.downloadIsPrivate('fern', download as never)).toBe(false)
  expect(getter).not.toHaveBeenCalled()
})
it('keeps the pinned Playwright immediate artifact bridge tied to its serialized GUID layout', () => {
  const metadata = JSON.parse(
    fs.readFileSync(
      new URL('../node_modules/playwright-core/package.json', import.meta.url),
      'utf8',
    ),
  )
  expect(metadata.version).toBe('1.61.0')
  const code = fs.readFileSync(
    new URL('../node_modules/playwright-core/lib/coreBundle.js', import.meta.url),
    'utf8',
  )
  expect(code).toContain('this._artifact = artifact;')
  expect(code).toContain('this._initializer = initializer;')
  expect(code).toContain('absolutePath: artifact.localPath()')
  expect(code).toContain('resolveWithinRoot(downloadsPath, downloadFilename ?? uuid)')
  expect(code).toContain(
    'this.downloadCreated(originPage, payload.guid, payload.url, payload.suggestedFilename)',
  )
})

it('never relocates a private-named source whose real path is a native file outside the private folder', async () => {
  const f = await fixture()
  const normal = path.join(f.home, 'Downloads', 'fictional-normal.txt')
  fs.mkdirSync(path.dirname(normal))
  fs.writeFileSync(normal, 'fictional native bytes')
  const inode = fs.statSync(normal).ino
  const src = path.join(f.stage, 'unsafe-guid')
  fs.symlinkSync(normal, src)
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'unsafe-guid',
      frameId: 'frame',
      suggestedFilename: 'fictional-normal.txt',
    })
    f.session.emit('Browser.downloadProgress', {
      guid: 'unsafe-guid',
      state: 'completed',
      receivedBytes: 22,
    })
  })
  await f.browser.closeAll()
  expect(fs.existsSync(src)).toBe(true)
  expect(fs.lstatSync(src).isSymbolicLink()).toBe(true)
  expect(fs.existsSync(path.join(f.home, 'private-downloads', 'fictional-normal.txt'))).toBe(false)
  expect(fs.readFileSync(normal, 'utf8')).toBe('fictional native bytes')
  expect(fs.statSync(normal).ino).toBe(inode)
})
it('leaves unknown staging files untouched when the browser ends', async () => {
  const f = await fixture()
  const unknown = path.join(f.stage, 'fictional-unattributed.txt')
  fs.writeFileSync(unknown, 'fictional original bytes')
  const inode = fs.statSync(unknown).ino
  await f.browser.closeAll()
  expect(fs.readFileSync(unknown, 'utf8')).toBe('fictional original bytes')
  expect(fs.statSync(unknown).ino).toBe(inode)
})
it('never calls queued artifact cleanup when its real path leaves the private folder', async () => {
  const f = await fixture()
  const { TabRegistry, MAX_PENDING_DOWNLOADS } = await import('../src/tabs.js')
  const { FakePage, FakeDownload } = await import('./fakes.js')
  const normal = path.join(f.home, 'Downloads', 'fictional-native.txt')
  fs.mkdirSync(path.dirname(normal))
  fs.writeFileSync(normal, 'fictional native bytes')
  const linked = path.join(f.stage, 'outside-guid')
  fs.symlinkSync(normal, linked)
  const page = new FakePage(),
    tabs = new TabRegistry()
  tabs.watch('fern', f.browser)
  tabs.add('fern', f.browser.state('fern')!.generation, page as never)
  const protectedDownload = new FakeDownload(
    'fictional-native.txt',
    Buffer.from('fictional native bytes'),
    linked,
  )
  const deletion = vi.spyOn(protectedDownload, 'delete')
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'outside-guid',
      frameId: 'frame',
      suggestedFilename: 'fictional-native.txt',
    })
    await f.browser.deletePrivateDownload('fern', protectedDownload as never)
    const cancellation = vi.spyOn(protectedDownload, 'cancel')
    await f.browser.cancelPrivateDownload('fern', protectedDownload as never)
    expect(cancellation).not.toHaveBeenCalled()
    page.emit('download', protectedDownload)
    for (let i = 0; i < MAX_PENDING_DOWNLOADS + 1; i++) {
      const guid = `safe-overflow-${i}`
      fs.writeFileSync(path.join(f.stage, guid), 'fictional private bytes')
      f.session.emit('Browser.downloadWillBegin', {
        guid,
        frameId: 'frame',
        suggestedFilename: 'fictional-private.txt',
      })
      page.emit(
        'download',
        new FakeDownload(
          'fictional-private.txt',
          Buffer.from('fictional private bytes'),
          path.join(f.stage, guid),
        ),
      )
    }
    await new Promise((r) => setImmediate(r))
    expect(deletion).not.toHaveBeenCalled()
    expect(fs.readFileSync(normal, 'utf8')).toBe('fictional native bytes')
  })
})

it('preserves a known unfinished private file when the browser ends', async () => {
  const f = await fixture()
  const file = path.join(f.stage, 'fictional-unfinished-guid')
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'fictional-unfinished-guid',
      frameId: 'frame',
      suggestedFilename: 'fictional-private.txt',
    })
    fs.writeFileSync(file, 'fictional unfinished bytes')
  })
  const inode = fs.statSync(file).ino
  await f.browser.closeAll()
  expect(fs.readFileSync(file, 'utf8')).toBe('fictional unfinished bytes')
  expect(fs.statSync(file).ino).toBe(inode)
})

it('cleans a proven private artifact synchronously without delegating Playwright deletion', async () => {
  const f = await fixture()
  const { FakeDownload } = await import('./fakes.js')
  const file = path.join(f.stage, 'fictional-sync-guid')
  fs.writeFileSync(file, 'fictional saved private bytes')
  const download = new FakeDownload(
    'fictional-private.txt',
    Buffer.from('fictional saved private bytes'),
    file,
  )
  const deletion = vi.spyOn(download, 'delete')
  await f.browser.agentCall(['fern'], async () => {
    f.session.emit('Browser.downloadWillBegin', {
      guid: 'fictional-sync-guid',
      frameId: 'frame',
      suggestedFilename: 'fictional-private.txt',
    })
    await f.browser.deletePrivateDownload('fern', download as never)
    expect(fs.existsSync(file)).toBe(false)
    expect(deletion).not.toHaveBeenCalled()
  })
})
