import fs from 'node:fs'
import path from 'node:path'
import type { Download } from 'playwright-core'
import { afterEach, expect, it, vi } from 'vitest'
import { allToolDefs } from '../src/tools/index.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { createWindowTasks } from '../src/windows.js'
import { FakeBrowser, FakeDownload, harness } from './fakes.js'

const fixtures: ReturnType<typeof harness>[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const h of fixtures.splice(0)) {
    for (const profile of [...h.browser.states.keys()]) await h.browser.close(profile)
    for (const dir of [h.home, path.dirname(h.downloads), h.uploadRoot])
      fs.rmSync(dir, { recursive: true, force: true })
  }
})
const extension = 'a'.repeat(32)
const samples: Record<string, Record<string, unknown>> = {
  list_browser_profiles: {},
  create_browser_profile: { profile: 'new-fern', temporary: true },
  set_browser_profile_description: { description: 'Fictional profile' },
  delete_browser_profile: { profile: 'temporary-fern' },
  open_tab: { url: 'about:blank' },
  list_tabs: {},
  close_tab: {},
  navigate: { url: 'about:blank' },
  snapshot: {},
  click: { ref: 'e1' },
  fill: { ref: 'e1', text: 'fictional' },
  type: { ref: 'e1', text: 'fictional' },
  press_key: { key: 'Enter' },
  select: { ref: 'e1', values: ['fictional'] },
  hover: { ref: 'e1' },
  scroll: { dy: 1 },
  screenshot: { scope: 'viewport' },
  evaluate: { expression: '1' },
  wait_for: { loadState: 'load' },
  handle_dialog: { accept: false },
  upload_file: { ref: 'e1' },
  download: { url: 'https://fictional.invalid/file' },
  wait_for_download: {},
  download_url: { url: 'https://fictional.invalid/file' },
  mouse: { action: 'click', x: 1, y: 1 },
  console: {},
  network: {},
  install_extension: { source: 'b'.repeat(32) },
  list_extensions: {},
  remove_extension: { id: extension },
  get_settings: {},
  set_setting: { key: 'translate.enabled', value: true },
  show_tab: {},
  hide_tab: {},
}
it('creates explicitly named shared and temporary profiles and closes a shared tab without a post-close veto', async () => {
  const h = harness()
  fixtures.push(h)
  const local = path.join(h.home, 'fictional-workspace')
  const shared = path.join(h.home, 'fictional-shared')
  fs.mkdirSync(local)
  fs.mkdirSync(shared)
  const store = createSharedProfileStore({
    home: local,
    shared,
    workspaceId: 'fictional-owner',
    workspaceLabel: 'Fictional',
    chromeState: () => 'ended',
    readVolumeIdentity: () => 'apfs:11111111-1111-4111-8111-111111111111',
    ownerState: () => 'alive',
    processIdentity: { pid: process.pid, birth: 'fictional' },
  })
  const browser = new FakeBrowser(store.dirOf)
  Object.assign(h.deps, { store, browser, windows: createWindowTasks({ browser }) })
  expect((await h.call('create_browser_profile', { profile: 'shared-fern' })).json).toMatchObject({
    name: 'shared-fern',
    enabled: true,
    temporary: false,
  })
  expect(
    (await h.call('create_browser_profile', { profile: 'named-temp', temporary: true })).json,
  ).toMatchObject({ name: 'named-temp', enabled: true, temporary: true })
  const marker = path.join(store.dirOf('shared-fern'), 'opaque-session')
  fs.writeFileSync(marker, 'fictional shared session')
  const opened = (await h.call('open_tab', { profile: 'shared-fern', url: 'about:blank' }))
    .json as { tabId: string }
  expect((await h.call('close_tab', { profile: 'shared-fern', tabId: opened.tabId })).json).toEqual(
    { ok: true },
  )
  expect(fs.readFileSync(marker, 'utf8')).toBe('fictional shared session')
  expect(
    store
      .list()
      .map((p) => p.name)
      .sort(),
  ).toEqual(['named-temp', 'shared-fern'])
  await browser.close('shared-fern')
})
it('has an explicit positive case for every exposed business tool', () => {
  expect(Object.keys(samples).sort()).toEqual(
    allToolDefs()
      .map((d) => d.spec.name)
      .sort(),
  )
})
for (const def of allToolDefs()) {
  it(`${def.spec.name} succeeds for its explicitly supplied fictional profile`, async () => {
    const h = harness()
    fixtures.push(h)
    h.profile('fern', { enabled: true, allowExtensions: true, allowSettings: true })
    h.profile('birch')
    const untouched = path.join(h.store.dirOf('birch'), 'opaque-session')
    fs.mkdirSync(path.dirname(untouched), { recursive: true })
    fs.writeFileSync(untouched, 'fictional opaque session')
    const before = h.store.get('birch')
    const args = { profile: 'fern', ...samples[def.spec.name] }
    if ('tabId' in def.spec.props) {
      const opened = (await h.call('open_tab', { profile: 'fern', url: 'about:blank' })).json as {
        tabId: string
      }
      Object.assign(args, { tabId: opened.tabId })
      h.tabs.resolve(opened.tabId, (p) => h.browser.state(p)?.generation ?? null).refs = new Set([
        'e1',
      ])
      if (def.spec.name === 'hide_tab') h.browser.states.get('fern')!.mode = 'visible'
      if (def.spec.name === 'download' || def.spec.name === 'wait_for_download') {
        const file = path.join(h.uploadRoot, 'download-stage')
        fs.writeFileSync(file, 'fictional download')
        const download = new FakeDownload('fictional.txt', Buffer.from('fictional download'), file)
        const page = h.browser.pages.get('fern')![0]
        if (def.spec.name === 'download') {
          page.goto = async () => {
            page.emit('download', download)
            return { status: () => 200 }
          }
        } else {
          h.browser.states.get('fern')!.mode = 'visible'
          h.tabs
            .resolve(opened.tabId, (p) => h.browser.state(p)?.generation ?? null)
            .pendingDownloads.push({ download: download as unknown as Download, at: Date.now() })
        }
      }
    }
    if (def.spec.name === 'delete_browser_profile')
      h.store.create('temporary-fern', 'agent', { temporary: true })
    if (def.spec.name === 'upload_file') {
      const file = path.join(h.uploadRoot, 'fictional.txt')
      fs.writeFileSync(file, 'fictional upload')
      Object.assign(args, { paths: [file] })
    }
    if (def.spec.name === 'remove_extension') {
      const folder = path.join(h.store.dirOf('fern'), 'Default', 'Extensions', extension, '1')
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(
        path.join(folder, 'manifest.json'),
        JSON.stringify({ name: 'Fictional', version: '1' }),
      )
    }
    if (def.spec.name === 'download_url')
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('fictional download')),
      )
    await expect(h.call(def.spec.name, args)).resolves.toBeDefined()
    expect(h.browser.touches.every((p) => p === 'fern')).toBe(true)
    expect(h.store.get('birch')).toEqual(before)
    expect(fs.readFileSync(untouched, 'utf8')).toBe('fictional opaque session')
    expect(h.browser.state('birch')).toBeNull()
  })
}
