import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import type { BrowserContext } from 'playwright-core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BrocrewHelper,
  HELPER_FILES,
  HELPER_VERSION,
  HELPER_PROTOCOL,
  copyHelper,
  offInLastSession,
} from '../src/browser/brocrewHelper.js'
import { HELPER_ID, listExtensions } from '../src/extensions.js'
import { silentLogger } from '../src/logger.js'

const shipped = fileURLToPath(new URL('../helper/', import.meta.url))
const workerSource = fs.readFileSync(path.join(shipped, 'worker.js'), 'utf8')
const MARKER = 'about:blank#new-tab-0f8fad5b-d9cb-469f-a165-70867728950e'

/** A worker that runs the shipped worker.js, with Chrome's tabs API faked. */
class FakeWorker extends EventEmitter {
  created: Array<Record<string, unknown>> = []
  sandbox: vm.Context
  evaluate: (fn: unknown, arg?: unknown) => Promise<unknown>
  constructor(
    readonly fixture: Fixture,
    readonly address = `chrome-extension://${HELPER_ID}/worker.js`,
  ) {
    super()
    this.sandbox = vm.createContext({
      chrome: {
        tabs: {
          create: async (options: Record<string, unknown>) => {
            if (fixture.refuse) throw new Error('No window with id: 7.')
            this.created.push(options)
            return { id: 40 + this.created.length, windowId: fixture.landIn ?? options.windowId }
          },
        },
      },
    })
    vm.runInContext(workerSource, this.sandbox)
    this.evaluate = async (fn, arg) => {
      this.fixture.evaluated.push(arg)
      if (this.fixture.evaluateFails) throw new Error('Execution context was destroyed')
      if (this.fixture.evaluateHangs) return new Promise(() => undefined)
      return vm.runInContext(`(${String(fn)})(${JSON.stringify(arg)})`, this.sandbox)
    }
  }
  url() {
    return this.address
  }
}
class Fixture extends EventEmitter {
  workers: FakeWorker[] = []
  sent: Array<{ method: string; params?: Record<string, unknown> }> = []
  evaluated: unknown[] = []
  sessions = 0
  detached = 0
  installed: boolean | undefined = undefined
  getExtensionsMissing = false
  loadFails = false
  loadId = HELPER_ID
  startsWorker = true
  protocol: unknown = undefined
  refuse = false
  landIn: number | undefined
  evaluateFails = false
  evaluateHangs = false
  detachHangs = false
  serviceWorkers() {
    return this.workers as unknown as ReturnType<BrowserContext['serviceWorkers']>
  }
  browser() {
    return {
      newBrowserCDPSession: async () => {
        this.sessions++
        return {
          detach: async () => {
            this.detached++
            if (this.detachHangs) await new Promise(() => undefined)
          },
          send: async (method: string, params?: Record<string, unknown>) => {
            this.sent.push({ method, params })
            if (method === 'Extensions.getExtensions') {
              if (this.getExtensionsMissing)
                throw new Error("'Extensions.getExtensions' wasn't found")
              return {
                extensions:
                  this.installed === undefined
                    ? []
                    : [
                        {
                          id: HELPER_ID,
                          name: 'BroCrew helper',
                          version: '1',
                          path: '',
                          enabled: this.installed,
                        },
                      ],
              }
            }
            if (method === 'Extensions.uninstall') {
              this.installed = undefined
              for (const worker of this.workers.splice(0)) worker.emit('close')
              return {}
            }
            if (method === 'Extensions.loadUnpacked') {
              if (this.loadFails) throw new Error('Method not available.')
              this.installed = true
              for (const worker of this.workers.splice(0)) worker.emit('close')
              if (this.startsWorker)
                setTimeout(() => {
                  const worker = new FakeWorker(this)
                  if (this.protocol !== undefined)
                    vm.runInContext(
                      `globalThis.brocrewHelper = { protocol: ${JSON.stringify(this.protocol)} }`,
                      worker.sandbox,
                    )
                  this.workers.push(worker)
                  this.emit('serviceworker', worker)
                }, 1)
              return { id: this.loadId }
            }
            throw new Error(method)
          },
        }
      },
    }
  }
  /** The worker stops, as an idle MV3 worker does. */
  sleep() {
    for (const worker of this.workers.splice(0)) worker.emit('close')
  }
}
const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})
function setup(opts: { profileName?: string; allowed?: () => boolean; off?: boolean } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional helper '))
  homes.push(home)
  const profileDir = path.join(home, opts.profileName ?? 'Fern’s profile ünïcode')
  fs.mkdirSync(profileDir)
  const fixture = new Fixture()
  const remembered = { off: opts.off === true, calls: [] as boolean[] }
  const helper = new BrocrewHelper({
    context: fixture as unknown as BrowserContext,
    profileDir,
    source: shipped,
    allowed: opts.allowed ?? (() => true),
    rememberedOff: () => remembered.off,
    remember: (off) => {
      remembered.off = off
      remembered.calls.push(off)
    },
    logger: silentLogger,
  })
  return { fixture, helper, profileDir, home, remembered }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const methods = (fixture: Fixture) => fixture.sent.map((s) => s.method)

describe('the shipped helper extension', () => {
  it('has the fixed id, no permissions, one worker, and the hashes the plugin checks', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(shipped, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({
      manifest_version: 3,
      name: 'BroCrew helper',
      background: { service_worker: 'worker.js' },
    })
    expect(manifest.permissions).toBeUndefined()
    expect(manifest.host_permissions).toBeUndefined()
    expect(manifest.externally_connectable).toBeUndefined()
    const key = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex')
    const id = [...key.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')
    expect(id).toBe(HELPER_ID)
    expect(fs.readdirSync(shipped).sort()).toEqual(HELPER_FILES.map((f) => f.name).sort())
    for (const file of HELPER_FILES)
      expect(
        createHash('sha256')
          .update(fs.readFileSync(path.join(shipped, file.name)))
          .digest('hex'),
      ).toBe(file.sha256)
  })
  it('place-tab opens an inactive tab in the given window and refuses anything else', async () => {
    const fixture = new Fixture()
    const worker = new FakeWorker(fixture)
    const run = (job: string, input: unknown) =>
      vm.runInContext(
        `globalThis.brocrewHelper.run(${JSON.stringify(job)}, ${JSON.stringify(input)})`,
        worker.sandbox,
      )
    expect(await run('place-tab', { windowId: 7, url: MARKER })).toEqual({ ok: true, windowId: 7 })
    expect(worker.created).toEqual([{ windowId: 7, url: MARKER, active: false }])
    for (const input of [
      { windowId: 7, url: 'https://fictional.invalid/' },
      { windowId: '7', url: MARKER },
      null,
    ])
      expect(await run('place-tab', input)).toMatchObject({ ok: false, created: false })
    expect(await run('open-anything', {})).toMatchObject({ ok: false, created: false })
    fixture.refuse = true
    expect(await run('place-tab', { windowId: 7, url: MARKER })).toMatchObject({
      ok: false,
      created: false,
    })
    expect(worker.created).toHaveLength(1)
    expect(vm.runInContext('globalThis.brocrewHelper.jobs', worker.sandbox)).toEqual(['place-tab'])
  })
})

describe('installing the helper', () => {
  it('copies verified files into the profile, loads them over the pipe and checks the worker', async () => {
    const { fixture, helper, profileDir } = setup()
    expect(await helper.install(1000)).toBe('ready')
    const folder = path.join(profileDir, 'brocrew-helper', HELPER_VERSION)
    expect(fixture.sent.find((s) => s.method === 'Extensions.loadUnpacked')!.params).toEqual({
      path: folder,
    })
    for (const file of HELPER_FILES) {
      expect(fs.lstatSync(path.join(folder, file.name)).isFile()).toBe(true)
      expect(fs.readFileSync(path.join(folder, file.name))).toEqual(
        fs.readFileSync(path.join(shipped, file.name)),
      )
    }
    expect(fixture.detached).toBe(fixture.sessions)
  })
  it('refuses planted files and links without changing immutable version files', async () => {
    const { helper, profileDir, home } = setup()
    const folder = path.join(profileDir, 'brocrew-helper', HELPER_VERSION)
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, 'extra.js'), 'planted')
    fs.writeFileSync(path.join(home, 'elsewhere.js'), 'outside')
    fs.symlinkSync(path.join(home, 'elsewhere.js'), path.join(folder, 'worker.js'))
    expect(await helper.install(1000)).toBe('unavailable')
    expect(fs.readdirSync(folder).sort()).toEqual(['extra.js', 'worker.js'])
    expect(fs.lstatSync(path.join(folder, 'worker.js')).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(path.join(home, 'elsewhere.js'), 'utf8')).toBe('outside')
  })
  it('refuses changed shipped bytes, a linked shipped file and a linked folder, loading nothing', () => {
    const { profileDir, home } = setup()
    const copy = path.join(home, 'shipped')
    fs.mkdirSync(copy)
    for (const file of HELPER_FILES)
      fs.copyFileSync(path.join(shipped, file.name), path.join(copy, file.name))
    fs.appendFileSync(path.join(copy, 'worker.js'), '\n// changed')
    expect(() => copyHelper(copy, profileDir)).toThrow()
    fs.rmSync(path.join(copy, 'worker.js'))
    fs.symlinkSync(path.join(shipped, 'worker.js'), path.join(copy, 'worker.js'))
    expect(() => copyHelper(copy, profileDir)).toThrow()
    fs.rmSync(path.join(profileDir, 'brocrew-helper'), { recursive: true, force: true })
    fs.symlinkSync(home, path.join(profileDir, 'brocrew-helper'))
    expect(() => copyHelper(shipped, profileDir)).toThrow()
  })
  it('coexists with other immutable helper versions in an explicit shared root', () => {
    const { profileDir, home } = setup()
    const root = path.join(home, 'shared-helper')
    fs.mkdirSync(root)
    const old = path.join(root, 'p1-old-version')
    fs.mkdirSync(old)
    fs.writeFileSync(path.join(old, 'worker.js'), 'fictional old holder')
    const folder = copyHelper(shipped, profileDir, root)
    expect(HELPER_PROTOCOL).toBe(1)
    expect(folder).toBe(path.join(root, HELPER_VERSION))
    const inode = fs.statSync(path.join(folder, 'worker.js')).ino
    expect(copyHelper(shipped, profileDir, root)).toBe(folder)
    expect(fs.statSync(path.join(folder, 'worker.js')).ino).toBe(inode)
    expect(fs.readFileSync(path.join(old, 'worker.js'), 'utf8')).toBe('fictional old holder')
    fs.appendFileSync(path.join(folder, 'worker.js'), 'tampered')
    expect(() => copyHelper(shipped, profileDir, root)).toThrow()
    expect(fs.readFileSync(path.join(folder, 'worker.js'), 'utf8')).toContain('tampered')
  })
  it('does not load after extensions are revoked during helper inspection', async () => {
    let allowed = true
    const { helper, fixture } = setup({ allowed: () => allowed })
    const original = fixture.browser.bind(fixture)
    fixture.browser = () => {
      const driver = original()
      const opening = driver.newBrowserCDPSession
      driver.newBrowserCDPSession = async () => {
        const session = await opening()
        const send = session.send
        session.send = async (method, params) => {
          const result = await send(method, params)
          if (method === 'Extensions.getExtensions') allowed = false
          return result
        }
        return session
      }
      return driver
    }
    expect(await helper.install(1000)).toBe('unavailable')
    expect(methods(fixture)).not.toContain('Extensions.loadUnpacked')
    expect(methods(fixture)).not.toContain('Extensions.uninstall')
  })
  it('loads nothing in a profile where BroCrew remembers the person turned it off', async () => {
    const { fixture, helper } = setup({ off: true })
    expect(await helper.install(1000)).toBe('off')
    expect(fixture.sessions).toBe(0)
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: false, helper: 'off' })
    expect(methods(fixture)).not.toContain('Extensions.loadUnpacked')
  })
  it('reads the switch Chrome recorded in the last session, list or bit-mask form', () => {
    for (const [reasons, off] of [
      [[1], true],
      [1, true],
      [[], false],
      [0, false],
    ] as const) {
      const { profileDir } = setup()
      const folder = copyHelper(shipped, profileDir)
      fs.mkdirSync(path.join(profileDir, 'Default'))
      fs.writeFileSync(
        path.join(profileDir, 'Default', 'Preferences'),
        JSON.stringify({
          extensions: {
            settings: { [HELPER_ID]: { path: folder, location: 4, disable_reasons: reasons } },
          },
        }),
      )
      expect(offInLastSession(profileDir)).toBe(off)
      expect(listExtensions(profileDir)).toEqual([
        expect.objectContaining({ id: HELPER_ID, enabled: !off, builtIn: true, unpacked: true }),
      ])
    }
    expect(offInLastSession(setup().profileDir)).toBe(false)
  })
  it.each([
    ['Chrome refuses the load', (f: Fixture) => (f.loadFails = true)],
    ['another id comes back', (f: Fixture) => (f.loadId = 'a'.repeat(32))],
    ['no worker starts', (f: Fixture) => (f.startsWorker = false)],
    ['the worker speaks another protocol', (f: Fixture) => (f.protocol = 2)],
  ])('is unavailable, never throwing, when %s', async (_, fault) => {
    const { fixture, helper } = setup()
    fault(fixture)
    expect(await helper.install(1000)).toBe('unavailable')
    expect(await helper.place(1, MARKER, 1000)).toEqual({
      created: false,
      helper: 'unavailable',
    })
    expect(fixture.detached).toBe(fixture.sessions)
  })
  it.each([
    ['after a successful install', (f: Fixture) => f],
    ['after the person turned it off', (f: Fixture) => (f.installed = false)],
    ['after Chrome refused the load', (f: Fixture) => (f.loadFails = true)],
  ])(
    'a detach Chrome never answers cannot hold the install past its deadline, %s',
    async (_, set) => {
      const { fixture, helper } = setup()
      set(fixture)
      fixture.detachHangs = true
      const began = Date.now()
      await helper.install(300)
      expect(Date.now() - began).toBeLessThan(600)
      await helper.turnOn(300)
      expect(Date.now() - began).toBeLessThan(1200)
    },
  )
  it('stops when the profile changes mid-install', async () => {
    let allowed = true
    const { fixture, helper } = setup({ allowed: () => allowed })
    fixture.on('serviceworker', () => (allowed = false))
    expect(await helper.install(1000)).toBe('unavailable')
  })
})

describe('placing a tab with the helper', () => {
  it('asks the live worker for an inactive tab in the requested window', async () => {
    const { fixture, helper } = setup()
    await helper.install(1000)
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: true, windowId: 7 })
    expect(fixture.workers[0].created).toEqual([{ windowId: 7, url: MARKER, active: false }])
  })
  it('wakes a worker that slept for five minutes, while Chrome says the helper is on', async () => {
    const { fixture, helper } = setup()
    await helper.install(1000)
    fixture.sleep()
    const loads = () => methods(fixture).filter((m) => m === 'Extensions.loadUnpacked').length
    expect(loads()).toBe(1)
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: true, windowId: 7 })
    expect(loads()).toBe(2)
    expect(fixture.detached).toBe(fixture.sessions)
  })
  it('notices an off switch made in chrome://extensions when the worker stops, and remembers it', async () => {
    const { fixture, helper, remembered } = setup()
    await helper.install(1000)
    fixture.installed = false
    fixture.sleep()
    await settle()
    expect(helper.state).toBe('off')
    expect(remembered.off).toBe(true)
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: false, helper: 'off' })
    expect(methods(fixture).filter((m) => m === 'Extensions.loadUnpacked')).toHaveLength(1)
  })
  it('never reloads a helper the person turned off while it slept, and remembers off', async () => {
    const { fixture, helper, remembered } = setup()
    await helper.install(1000)
    // It slept while still on; the person switches it off later, so only the next tab finds out.
    fixture.sleep()
    await settle()
    expect(remembered.off).toBe(false)
    fixture.installed = false
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: false, helper: 'off' })
    expect(methods(fixture).filter((m) => m === 'Extensions.loadUnpacked')).toHaveLength(1)
    expect(helper.state).toBe('off')
    expect(remembered.off).toBe(true)
  })
  it('never reloads when Chrome cannot say whether the helper is on', async () => {
    const { fixture, helper } = setup()
    await helper.install(1000)
    fixture.sleep()
    fixture.getExtensionsMissing = true
    expect(await helper.place(7, MARKER, 1000)).toEqual({
      created: false,
      helper: 'unavailable',
    })
    expect(methods(fixture).filter((m) => m === 'Extensions.loadUnpacked')).toHaveLength(1)
  })
  it('works again when the person switches it back on in chrome://extensions in the same session', async () => {
    const { fixture, helper, remembered } = setup()
    await helper.install(1000)
    fixture.sleep()
    fixture.installed = false
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: false, helper: 'off' })
    fixture.installed = true
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: true, windowId: 7 })
    expect(helper.state).toBe('ready')
    expect(remembered.off).toBe(false)
  })
  it('a Turn on that Chrome refuses leaves the request for the next launch', async () => {
    const { fixture, helper, remembered } = setup({ off: true })
    fixture.loadFails = true
    expect(await helper.turnOn(1000)).toBe('unavailable')
    // Nothing recorded: the caller's "turning on" stays until a helper answers.
    expect(remembered.calls).toEqual([])
  })
  it('a Turn on installs fresh over a disabled copy Chrome still lists', async () => {
    const { fixture, helper } = setup()
    await helper.install(1000)
    fixture.installed = false
    fixture.sleep()
    // Uninstall clears it; the fixture's next load enables it again.
    expect(await helper.turnOn(1000)).toBe('ready')
  })
  it('after a restart it stays off until the person presses Turn on, which installs it fresh', async () => {
    const { fixture, helper, remembered } = setup({ off: true })
    expect(await helper.install(1000)).toBe('off')
    // Chrome dropped it at start, so chrome://extensions has nothing to switch on.
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: false, helper: 'off' })
    expect(methods(fixture)).not.toContain('Extensions.loadUnpacked')
    expect(await helper.turnOn(1000)).toBe('ready')
    expect(remembered.off).toBe(false)
    expect(methods(fixture).indexOf('Extensions.uninstall')).toBeLessThan(
      methods(fixture).indexOf('Extensions.loadUnpacked'),
    )
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: true, windowId: 7 })
  })
  it('a refusal from Chrome means nothing was created', async () => {
    const { fixture, helper } = setup()
    await helper.install(1000)
    fixture.refuse = true
    expect(await helper.place(7, MARKER, 1000)).toEqual({ created: false, helper: 'refused' })
  })
  it('an evaluation that fails or never answers after dispatch is uncertain and throws', async () => {
    const { fixture, helper } = setup()
    await helper.install(1000)
    fixture.evaluateFails = true
    await expect(helper.place(7, MARKER, 1000)).rejects.toThrow()
    fixture.evaluateFails = false
    fixture.evaluateHangs = true
    await expect(helper.place(7, MARKER, 30)).rejects.toThrow('timeout')
  })
  it('dispatches nothing once the profile changes or extensions are turned off', async () => {
    let allowed = true
    const { fixture, helper } = setup({ allowed: () => allowed })
    await helper.install(1000)
    allowed = false
    const before = fixture.evaluated.length
    expect(await helper.place(7, MARKER, 1000)).toEqual({
      created: false,
      helper: 'unavailable',
    })
    expect(fixture.evaluated).toHaveLength(before)
  })
})
