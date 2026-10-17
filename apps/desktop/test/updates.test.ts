import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  UpdatesSnapshot,
  WhatARestartWouldStop,
  WhatARestartWouldStopIn,
} from '../src/shared/updates'
import {
  diskImageOf,
  downloadChecked,
  downloadUrlOf,
  privateDownloadUrlOf,
  privateFeedToken,
  readFeed,
  sha512Of,
} from '../src/main/guided-update'
import { listingCommand, otherBroBotsIn } from '../src/main/other-brobots'
import {
  HIDDEN_UPDATE_DEFAULTS,
  readUpdateSettings,
  UPDATE_DEFAULTS,
  updateSettingsOf,
  writeUpdateSettings,
  type UpdateSettings,
} from '../src/main/update-settings'
import {
  CHECK_EVERY_MS,
  createUpdates,
  FIRST_CHECK_AFTER_MS,
  parseSettingsChange,
  QUIET_LOOK_EVERY_MS,
  theAutoUpdaterOf,
  whyACheckFailed,
  type FoundUpdate,
  type UpdatesDeps,
} from '../src/main/updates'
import { installerArgsFor, REOPEN_SWITCH, theWayBack } from '../src/main/reopen-after-update'
import { builtEnvironment } from '../src/main/built-launch'

/**
 * 🔴 **W4.109 · B1 — when BroBot looks for a newer version, and what it does with one.**
 *
 *  - §1 · the rules (`updates.ts`), with every outside thing faked: the off switch requests nothing,
 *    nothing downloads unasked, a restart waits until it would stop nothing, and the Mac never
 *    installs itself.
 *  - §2 · the settings file: per computer, a hidden launch's its own, and a broken one is the
 *    defaults.
 *  - §3 · other workspaces, from the process table.
 *  - §4 · the Mac's guided download, against a throwaway local server: the sha512 is checked.
 *  - §5 · the wiring.
 */

const here = dirname(fileURLToPath(import.meta.url))
const roots: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const aFolder = (): string => {
  const made = mkdtempSync(join(tmpdir(), 'brobot-updates-'))
  roots.push(made)
  return made
}

const QUIET: WhatARestartWouldStop = { conversations: [], otherWorkspaces: 0 }
const ADA_WORKING: WhatARestartWouldStopIn = {
  conversation: 'sess_1',
  name: 'Ada',
  turnRunning: true,
  waitingOnAPerson: false,
  heldMessages: 0,
  inTheBackground: 0,
}
const NEWER: FoundUpdate = {
  version: '0.2.0',
  files: [{ url: 'BroBot-0.2.0-arm64.dmg', sha512: 'x', size: 1 }],
}

/** The rules, with a fake clock, feed, installer and host — and a record of everything asked. */
function anUpdater(
  overrides: Partial<UpdatesDeps> & {
    readonly start?: UpdateSettings
    readonly offered?: FoundUpdate | null
  } = {},
) {
  const asked = {
    checks: 0,
    downloads: 0,
    installs: 0,
    guides: 0,
    processLists: 0,
    written: [] as UpdateSettings[],
    published: [] as UpdatesSnapshot[],
  }
  let timers: { run: () => void; ms: number; cancelled: boolean }[] = []
  let stops: WhatARestartWouldStop = QUIET
  // ⚑ The settings file, as one per computer: what was written is what is read next.
  let file: UpdateSettings = overrides.start ?? UPDATE_DEFAULTS
  const deps: UpdatesDeps = {
    version: '0.1.0',
    notHere: null,
    installs: 'on-restart',
    settings: {
      read: () => file,
      write: (s) => {
        asked.written.push(s)
        file = s
      },
    },
    check: async () => {
      asked.checks += 1
      return overrides.offered === undefined ? NEWER : overrides.offered
    },
    download: async (_found, onPercent) => {
      asked.downloads += 1
      onPercent(50)
    },
    install: () => {
      asked.installs += 1
    },
    guide: async () => {
      asked.guides += 1
      return '/Users/x/Downloads/BroBot-0.2.0-arm64.dmg'
    },
    conversationsARestartWouldStop: () => stops.conversations,
    otherWorkspacesRunning: async () => {
      asked.processLists += 1
      return stops.otherWorkspaces
    },
    now: () => 1_000,
    later: (run, ms) => {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    publish: (snapshot) => asked.published.push(snapshot),
    log: () => {},
    ...overrides,
  }
  const updates = createUpdates(deps)
  return {
    updates,
    asked,
    /** The timers still armed. */
    armed: () => timers.filter((timer) => !timer.cancelled),
    /** Run every armed timer once, as time passing would. */
    async pass() {
      const due = timers.filter((timer) => !timer.cancelled)
      timers = []
      for (const timer of due) timer.run()
      await new Promise((resolve) => setTimeout(resolve, 0))
    },
    setStops(next: WhatARestartWouldStop) {
      stops = next
    },
    /** Another workspace changes the computer's settings file. */
    elsewhere(next: UpdateSettings) {
      file = next
    },
  }
}
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('§1 · the rules', () => {
  it('🔴 the off switch: nothing is ever requested on its own, however long it runs', async () => {
    const off = anUpdater({ start: { checkAutomatically: false, channel: 'stable' } })
    off.updates.start()
    for (let day = 0; day < 3; day += 1) await off.pass()
    expect(off.asked.checks).toBe(0)
  })

  it('🔴 one switch per computer: turned off in another workspace, this one stops checking too', async () => {
    const on = anUpdater({ offered: null })
    on.updates.start()
    await on.pass()
    expect(on.asked.checks).toBe(1)
    on.elsewhere({ checkAutomatically: false, channel: 'stable' })
    for (let day = 0; day < 3; day += 1) await on.pass()
    expect(on.asked.checks).toBe(1)
    expect(on.updates.snapshot().checkAutomatically).toBe(false)
    // ⚑ …and a change here keeps what the other workspace chose.
    on.updates.set({ channel: 'beta' })
    expect(on.asked.written.at(-1)).toEqual({ checkAutomatically: false, channel: 'beta' })
  })

  it('🔴 on: once soon after launch, then once a day — and never a download it was not asked for', async () => {
    const on = anUpdater()
    on.updates.start()
    expect(on.armed().map((timer) => timer.ms)).toEqual([FIRST_CHECK_AFTER_MS])
    await on.pass()
    expect(on.asked.checks).toBe(1)
    expect(on.updates.snapshot().state).toEqual({ kind: 'available', version: '0.2.0' })
    expect(on.armed().map((timer) => timer.ms)).toEqual([CHECK_EVERY_MS])
    await on.pass()
    // ⚑ An offer already standing is not asked again by itself, and nothing was downloaded.
    expect(on.asked.checks).toBe(1)
    expect(on.asked.downloads + on.asked.guides).toBe(0)
  })

  it('⚑ a person who asks is answered, the switch off or not — and one check at a time', async () => {
    const off = anUpdater({ start: { checkAutomatically: false, channel: 'beta' }, offered: null })
    const [first, second] = await Promise.all([off.updates.checkNow(), off.updates.checkNow()])
    expect(off.asked.checks).toBe(1)
    expect(second?.state).toEqual({ kind: 'checking' })
    expect(first?.state).toEqual({ kind: 'idle', checkedAt: 1_000, upToDate: true })
  })

  it('⛔ a build that never checks: a development build asks nothing, even when a person presses', async () => {
    const dev = anUpdater({ notHere: 'a-development-build' })
    dev.updates.start()
    expect(dev.armed()).toEqual([])
    expect((await dev.updates.checkNow()).state).toEqual({
      kind: 'not-here',
      why: 'a-development-build',
    })
    expect(dev.asked.checks).toBe(0)
  })

  it('🔴 the mid-turn refusal: a restart waits while a turn runs, and installs once nothing would stop', async () => {
    const win = anUpdater()
    await win.updates.checkNow()
    await win.updates.download()
    expect(win.updates.snapshot().state).toMatchObject({ kind: 'ready', how: 'restart' })
    win.setStops({ conversations: [ADA_WORKING], otherWorkspaces: 0 })
    win.updates.restartWhenQuiet()
    await settle()
    expect(win.asked.installs).toBe(0)
    // ⚑ Other workspaces are not looked for while a conversation here is busy: not known yet.
    expect(win.updates.snapshot().state).toEqual({
      kind: 'waiting-to-restart',
      version: '0.2.0',
      stops: { conversations: [ADA_WORKING], otherWorkspaces: null },
    })
    expect(win.asked.processLists).toBe(0)
    expect(win.armed().map((timer) => timer.ms)).toEqual([QUIET_LOOK_EVERY_MS])
    win.setStops(QUIET)
    await win.pass()
    expect(win.asked.processLists).toBe(1)
    expect(win.asked.installs).toBe(1)
    // ⚑ Once: nothing looks again after it.
    expect(win.armed()).toEqual([])
  })

  it('🔴 a turn that starts while the process list is read is seen, and nothing installs', async () => {
    let answer: (count: number | null) => void = () => {}
    let busy: readonly WhatARestartWouldStopIn[] = []
    const win = anUpdater({
      conversationsARestartWouldStop: () => busy,
      otherWorkspacesRunning: () => new Promise((resolve) => (answer = resolve)),
    })
    await win.updates.checkNow()
    await win.updates.download()
    win.updates.restartWhenQuiet()
    busy = [ADA_WORKING]
    answer(0)
    await settle()
    expect(win.asked.installs).toBe(0)
    expect(win.updates.snapshot().state).toEqual({
      kind: 'waiting-to-restart',
      version: '0.2.0',
      stops: { conversations: [ADA_WORKING], otherWorkspaces: 0 },
    })
  })

  it('⛔ another workspace running, or one it cannot tell, keeps it waiting — it never stops one', async () => {
    for (const otherWorkspaces of [1, null]) {
      const win = anUpdater()
      await win.updates.checkNow()
      await win.updates.download()
      win.setStops({ conversations: [], otherWorkspaces })
      win.updates.restartWhenQuiet()
      await settle()
      await win.pass()
      expect(win.asked.installs, String(otherWorkspaces)).toBe(0)
      expect(win.updates.snapshot().state.kind).toBe('waiting-to-restart')
    }
  })

  it('⚑ a restart cancelled while it waits does not install, even from a look already under way', async () => {
    let answer: (count: number | null) => void = () => {}
    const win = anUpdater({
      otherWorkspacesRunning: () => new Promise((resolve) => (answer = resolve)),
    })
    await win.updates.checkNow()
    await win.updates.download()
    win.updates.restartWhenQuiet()
    win.updates.cancelRestart()
    answer(0)
    await settle()
    expect(win.asked.installs).toBe(0)
  })

  it('⛔ quitting while a restart waits never installs, even from a look already under way', async () => {
    let answer: (count: number | null) => void = () => {}
    const win = anUpdater({
      otherWorkspacesRunning: () => new Promise((resolve) => (answer = resolve)),
    })
    await win.updates.checkNow()
    await win.updates.download()
    win.updates.restartWhenQuiet()
    win.updates.stop()
    answer(0)
    await settle()
    expect(win.asked.installs).toBe(0)
    expect(win.armed()).toEqual([])
    // ⚑ …and none is chosen again on the way out.
    win.updates.restartWhenQuiet()
    await settle()
    expect(win.asked.installs).toBe(0)
    expect(win.armed()).toEqual([])
  })

  it('⚑ a look that throws says so, and stops waiting', async () => {
    const win = anUpdater({
      conversationsARestartWouldStop: () => {
        throw new Error('The database connection is not open')
      },
    })
    await win.updates.checkNow()
    await win.updates.download()
    win.updates.restartWhenQuiet()
    await settle()
    expect(win.asked.installs).toBe(0)
    expect(win.armed()).toEqual([])
    expect(win.updates.snapshot().state).toEqual({
      kind: 'error',
      message: 'BroCrew could not restart to update: The database connection is not open',
      at: 1_000,
    })
  })

  it('🔴 the Mac is guided: its download is the checked disk image, opened — and it never installs', async () => {
    const mac = anUpdater({ installs: 'guided' })
    await mac.updates.checkNow()
    await mac.updates.download()
    expect(mac.asked.guides).toBe(1)
    expect(mac.asked.downloads).toBe(0)
    expect(mac.updates.snapshot().state).toEqual({
      kind: 'ready',
      version: '0.2.0',
      how: 'opened',
      path: '/Users/x/Downloads/BroBot-0.2.0-arm64.dmg',
    })
    mac.updates.restartWhenQuiet()
    await settle()
    await mac.pass()
    expect(mac.asked.installs).toBe(0)
    // ⚑ A disk image closed by mistake is opened again when asked.
    await mac.updates.download()
    expect(mac.asked.guides).toBe(2)
    expect(mac.updates.snapshot().state).toMatchObject({ kind: 'ready', how: 'opened' })
  })

  it('⚑ a failure is said in plain words, its first line only — and a channel with no release yet is up to date', async () => {
    const broken = anUpdater({
      check: async () => {
        throw new Error('the feed answered 404\nHeaders: {"server": "x"}')
      },
    })
    expect((await broken.updates.checkNow()).state).toEqual({
      kind: 'error',
      message: 'BroCrew could not check for updates: the feed answered 404',
      at: 1_000,
    })
    const none = anUpdater({
      check: async () => {
        throw Object.assign(
          new Error(
            'Unable to find latest version on GitHub, please ensure a production release exists',
          ),
          { code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND' },
        )
      },
    })
    expect((await none.updates.checkNow()).state).toEqual({
      kind: 'idle',
      checkedAt: 1_000,
      upToDate: true,
    })
  })

  it('⚑ what a failed check says', () => {
    const coded = (message: string, code: string): Error =>
      Object.assign(new Error(message), { code })
    expect(
      whyACheckFailed(
        coded('No published versions on GitHub', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS'),
      ),
    ).toBeNull()
    expect(
      whyACheckFailed(
        coded('HttpError: 404 \n"method: GET url: …/releases.atom"', 'HTTP_ERROR_404'),
      ),
    ).toBe('its releases could not be found (404)')
    expect(
      whyACheckFailed(
        coded(
          'Cannot find latest.yml in the latest release artifacts',
          'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
        ),
      ),
    ).toBe('the newest release has no update file for this computer')
    expect(whyACheckFailed(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(
      'it could not reach its releases (net::ERR_INTERNET_DISCONNECTED)',
    )
    expect(whyACheckFailed(new Error('x'.repeat(500)))).toHaveLength(200)
  })

  it('⚑ a download is told once per whole percent, not once per chunk', async () => {
    const win = anUpdater({
      download: async (_found, onPercent) => {
        for (let chunk = 0; chunk <= 10_000; chunk += 1) onPercent(chunk / 100)
      },
    })
    await win.updates.checkNow()
    const before = win.asked.published.length
    await win.updates.download()
    const told = win.asked.published
      .slice(before)
      .filter((snapshot) => snapshot.state.kind === 'downloading')
    expect(told).toHaveLength(101)
  })

  it('⚑ an offer from the other channel is dropped when the channel changes', async () => {
    const beta = anUpdater({ start: { checkAutomatically: true, channel: 'beta' } })
    await beta.updates.checkNow()
    expect(beta.updates.snapshot().state.kind).toBe('available')
    beta.updates.set({ channel: 'stable' })
    expect(beta.updates.snapshot().state).toEqual({
      kind: 'idle',
      checkedAt: null,
      upToDate: false,
    })
    await beta.updates.download()
    expect(beta.asked.downloads).toBe(0)
  })

  it('⚑ the switches are kept, and with checks turned off nothing is asked', async () => {
    const on = anUpdater()
    on.updates.start()
    const after = on.updates.set({ checkAutomatically: false, channel: 'beta' })
    expect(after).toMatchObject({ checkAutomatically: false, channel: 'beta' })
    expect(on.asked.written).toEqual([{ checkAutomatically: false, channel: 'beta' }])
    for (let day = 0; day < 3; day += 1) await on.pass()
    expect(on.asked.checks).toBe(0)
  })

  it('🔴 electron-updater’s autoUpdater is found where import() puts it: on `default`', () => {
    const updater = { autoDownload: true }
    const asImportGivesIt = {
      autoUpdater: undefined,
      default: Object.defineProperty({}, 'autoUpdater', { get: () => updater }),
    }
    expect(theAutoUpdaterOf(asImportGivesIt)).toBe(updater)
    expect(theAutoUpdaterOf({ autoUpdater: updater })).toBe(updater)
    expect(() => theAutoUpdaterOf({ default: {} })).toThrow('electron-updater has no autoUpdater')
  })

  it('⛔ the wire takes the two switches and nothing else', () => {
    expect(parseSettingsChange({ checkAutomatically: false })).toEqual({
      checkAutomatically: false,
    })
    expect(parseSettingsChange({ channel: 'beta' })).toEqual({ channel: 'beta' })
    for (const bad of [
      null,
      [],
      'x',
      { channel: 'nightly' },
      { checkAutomatically: 'yes' },
      { url: 'x' },
    ]) {
      expect(() => parseSettingsChange(bad), JSON.stringify(bad)).toThrow()
    }
  })
})

describe('§2 · the settings file', () => {
  it('🔴 one per computer beside the default folder, checks on; a hidden launch keeps its own, checks off', () => {
    const where = { appData: '/A', userData: '/A/@brobot2/desktop' }
    expect(updateSettingsOf({ ...where, hidden: false })).toEqual({
      file: join('/A', '@brobot2', 'settings.json'),
      defaults: { checkAutomatically: true, channel: 'stable' },
    })
    expect(updateSettingsOf({ ...where, hidden: true })).toEqual({
      file: join('/A/@brobot2/desktop', 'update-settings.json'),
      defaults: { checkAutomatically: false, channel: 'stable' },
    })
  })

  it('⚑ no file, a broken one, or values it cannot read: the defaults', () => {
    const folder = aFolder()
    const file = join(folder, 'settings.json')
    expect(readUpdateSettings(file, UPDATE_DEFAULTS)).toEqual(UPDATE_DEFAULTS)
    expect(readUpdateSettings(file, HIDDEN_UPDATE_DEFAULTS)).toEqual(HIDDEN_UPDATE_DEFAULTS)
    for (const text of [
      '{',
      '[]',
      '{"updates": {"checkAutomatically": "no", "channel": "nightly"}}',
    ]) {
      writeFileSync(file, text)
      expect(readUpdateSettings(file, UPDATE_DEFAULTS), text).toEqual(UPDATE_DEFAULTS)
    }
  })

  it('⚑ written whole, keeping anything else the file holds', () => {
    const file = join(aFolder(), 'nested', 'settings.json')
    writeUpdateSettings(file, { checkAutomatically: false, channel: 'beta' })
    expect(readUpdateSettings(file, UPDATE_DEFAULTS)).toEqual({
      checkAutomatically: false,
      channel: 'beta',
    })
    writeFileSync(file, JSON.stringify({ somethingElse: 1, updates: {} }))
    writeUpdateSettings(file, { checkAutomatically: true, channel: 'stable' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      somethingElse: 1,
      updates: { checkAutomatically: true, channel: 'stable' },
    })
    // ⚑ Renamed over the file: nothing is left beside it.
    expect(readdirSync(dirname(file))).toEqual(['settings.json'])
  })

  it('⚑ a write that fails says so and takes its temporary file with it', () => {
    const folder = aFolder()
    // ⚑ A folder where the file should be: the rename over it fails.
    const file = join(folder, 'settings.json')
    mkdirSync(join(file, 'in-the-way'), { recursive: true })
    expect(() =>
      writeUpdateSettings(file, { checkAutomatically: false, channel: 'beta' }),
    ).toThrow()
    expect(readdirSync(folder)).toEqual(['settings.json'])
    expect(existsSync(`${file}.${String(process.pid)}.tmp`)).toBe(false)
  })
})

describe('§3 · other workspaces, from the process table', () => {
  it('🔴 every main process of BroBot.exe but this app’s own; its helpers carry --type=', () => {
    const exe = 'C:\\Users\\x\\AppData\\Local\\Programs\\BroBot\\BroBot.exe'
    const listing = [
      `100 "${exe}"`,
      `101 "${exe}" --type=renderer --user-data-dir=C:\\x`,
      // ⚑ A path PowerShell wrote in another code page is still a workspace…
      `200 "C:\\Users\\S?ren\\AppData\\Local\\Programs\\BroBot\\BroBot.exe" --user-data-dir=C:\\y`,
      // ⚑ …and so is one whose command line it may not read.
      '300 ',
      `301 "${exe}" --type=gpu-process`,
      '',
    ].join('\r\n')
    expect(otherBroBotsIn(listing, new Set([100, 101]))).toBe(2)
  })

  it('⚑ how Windows is asked: the processes of this executable’s name', () => {
    const win = listingCommand('C:\\P\\BroBot.exe')
    expect(win.file).toBe('powershell.exe')
    expect(win.args.at(-1)).toContain(`Win32_Process -Filter "Name='BroBot.exe'"`)
  })
})

describe('§4 · the Mac’s guided download, against a local server', () => {
  /** A throwaway server: `/files/<name>` serves what `serve` holds, and counts requests. */
  async function aFeed(serve: Record<string, Buffer>) {
    const requests: string[] = []
    const server = createServer((request, response) => {
      requests.push(request.url ?? '')
      const name = decodeURIComponent((request.url ?? '').replace(/^\/files\//, ''))
      const body = serve[name]
      if (body === undefined) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-length': String(body.length) }).end(body)
    })
    servers.push(server)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    return { url: `http://127.0.0.1:${String(port)}/files/`, requests }
  }
  const image = Buffer.alloc(256 * 1024, 7)
  const sum = createHash('sha512').update(image).digest('base64')

  it('🔴 a disk image whose sha512 is the published one is kept, with its progress', async () => {
    const feed = await aFeed({ 'BroBot-0.2.0-arm64.dmg': image })
    const to = join(aFolder(), 'BroBot-0.2.0-arm64.dmg')
    const percents: number[] = []
    const path = await downloadChecked({
      url: downloadUrlOf({ provider: 'generic', url: feed.url }, '0.2.0', 'BroBot-0.2.0-arm64.dmg'),
      sha512: sum,
      to,
      onPercent: (percent) => percents.push(percent),
    })
    expect(path).toBe(to)
    expect(await sha512Of(to)).toBe(sum)
    expect(percents.at(-1)).toBe(100)
    expect(readdirSync(dirname(to))).toEqual(['BroBot-0.2.0-arm64.dmg'])
  })

  it('⛔ one whose sha512 is not is deleted, and said so', async () => {
    const feed = await aFeed({ 'BroBot-0.2.0-arm64.dmg': Buffer.from('not the release') })
    const to = join(aFolder(), 'BroBot-0.2.0-arm64.dmg')
    await expect(
      downloadChecked({
        url: `${feed.url}BroBot-0.2.0-arm64.dmg`,
        sha512: sum,
        to,
        onPercent: () => {},
      }),
    ).rejects.toThrow(
      'the download did not match the sha512 its release published, so it was deleted',
    )
    expect(readdirSync(dirname(to))).toEqual([])
  })

  it('⛔ one that stops arriving, or never answers, ends and says so — leaving nothing', async () => {
    const server = createServer((request, response) => {
      // ⚑ `/stops`: ten bytes of a thousand, then nothing. Anything else: no answer at all.
      if (request.url === '/stops') {
        response.writeHead(200, { 'content-length': '1000' })
        response.write(Buffer.alloc(10))
      }
    })
    servers.push(server)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    for (const path of ['/stops', '/never']) {
      const to = join(aFolder(), 'BroBot-0.2.0-arm64.dmg')
      await expect(
        downloadChecked({
          url: `http://127.0.0.1:${String(port)}${path}`,
          sha512: sum,
          to,
          onPercent: () => {},
          stallsAfterMs: 1_000,
        }),
        path,
      ).rejects.toThrow('the download stalled: nothing arrived for 1 s')
      expect(readdirSync(dirname(to)), path).toEqual([])
    }
  })

  it('⚑ one already downloaded and checked is not fetched again; a missing one is an error', async () => {
    const feed = await aFeed({})
    const to = join(aFolder(), 'BroBot-0.2.0-arm64.dmg')
    writeFileSync(to, image)
    await downloadChecked({
      url: `${feed.url}BroBot-0.2.0-arm64.dmg`,
      sha512: sum,
      to,
      onPercent: () => {},
    })
    expect(feed.requests).toEqual([])
    await expect(
      downloadChecked({
        url: `${feed.url}gone.dmg`,
        sha512: sum,
        to: `${to}-2`,
        onPercent: () => {},
      }),
    ).rejects.toThrow('the download answered 404')
  })

  it('⚑ the feed an app carries, and where a release’s file is', () => {
    expect(
      readFeed("owner: brocrew\nrepo: brocrew\nprovider: github\nupdaterCacheDirName: 'x'\n"),
    ).toEqual({
      provider: 'github',
      owner: 'brocrew',
      repo: 'brocrew',
    })
    expect(readFeed('provider: generic\nurl: http://127.0.0.1:9/f\n')).toEqual({
      provider: 'generic',
      url: 'http://127.0.0.1:9/f',
    })
    expect(readFeed('provider: s3\n')).toBeNull()
    expect(
      downloadUrlOf(
        { provider: 'github', owner: 'brocrew', repo: 'brocrew' },
        '0.2.0-beta.1',
        'BroBot-0.2.0-beta.1-arm64.dmg',
      ),
    ).toBe(
      'https://github.com/brocrew/brocrew/releases/download/v0.2.0-beta.1/BroBot-0.2.0-beta.1-arm64.dmg',
    )
    expect(
      diskImageOf({
        version: '0.2.0',
        files: [
          { url: 'a.zip', sha512: 'z' },
          { url: 'a.dmg', sha512: 'd' },
        ],
      }),
    ).toEqual({
      url: 'a.dmg',
      sha512: 'd',
    })
  })
})

describe('§4b · a private GitHub feed, read as electron-updater reads one', () => {
  const TOKEN = 'ghs_private-feed-token-for-a-test'
  const feed = { provider: 'github', owner: 'brocrew', repo: 'feed', private: true } as const

  it('⚑ the build says the feed is private; the environment alone never makes it so', () => {
    expect(readFeed('owner: brocrew\nrepo: feed\nprovider: github\nprivate: true\n')).toEqual(feed)
    const env = { GH_TOKEN: TOKEN }
    expect(privateFeedToken(feed, env)).toBe(TOKEN)
    expect(privateFeedToken(feed, { GITHUB_TOKEN: TOKEN })).toBe(TOKEN)
    expect(privateFeedToken({ provider: 'github', owner: 'brocrew', repo: 'feed' }, env)).toBeNull()
    expect(privateFeedToken({ provider: 'generic', url: 'http://127.0.0.1:9/' }, env)).toBeNull()
    expect(privateFeedToken(feed, { GH_TOKEN: '' })).toBeNull()
  })

  /** GitHub's API as a fake `fetch`: one release, one file, handed out at a short-lived address. */
  function anApi(answers: { release?: number; handed?: number } = {}) {
    const asked: { url: string; init: RequestInit | undefined }[] = []
    const fetch = (async (url: string, init?: RequestInit) => {
      asked.push({ url, init })
      if (url.endsWith('/releases/tags/v0.2.0')) {
        return new Response(
          JSON.stringify({
            assets: [{ name: 'BroBot-0.2.0-arm64.dmg', url: 'https://api.github.com/assets/7' }],
          }),
          { status: answers.release ?? 200 },
        )
      }
      if (url === 'https://api.github.com/assets/7') {
        return new Response(null, {
          status: answers.handed ?? 302,
          headers: { location: 'https://objects.example/signed/7' },
        })
      }
      return new Response(null, { status: 404 })
    }) as typeof globalThis.fetch
    return { asked, fetch }
  }

  it('🔴 the API names the file and hands out its address; the token goes to the API only', async () => {
    const api = anApi()
    const url = await privateDownloadUrlOf({
      feed,
      version: '0.2.0',
      file: 'BroBot-0.2.0-arm64.dmg',
      token: TOKEN,
      fetch: api.fetch,
    })
    expect(url).toBe('https://objects.example/signed/7')
    expect(api.asked.map((one) => one.url)).toEqual([
      'https://api.github.com/repos/brocrew/feed/releases/tags/v0.2.0',
      'https://api.github.com/assets/7',
    ])
    for (const one of api.asked) {
      expect(new URL(one.url).host).toBe('api.github.com')
      expect((one.init?.headers as Record<string, string>).authorization).toBe(`token ${TOKEN}`)
    }
    expect(api.asked[1]?.init?.redirect).toBe('manual')
  })

  it('⛔ a release, a file or an address it cannot have is said, and the token is never in the words', async () => {
    for (const [answers, file, said] of [
      [
        { release: 404 },
        'BroBot-0.2.0-arm64.dmg',
        'the private feed answered 404 for release 0.2.0',
      ],
      [{}, 'gone.dmg', 'release 0.2.0 on the private feed has no gone.dmg'],
      [
        { handed: 200 },
        'BroBot-0.2.0-arm64.dmg',
        'the private feed did not hand out BroBot-0.2.0-arm64.dmg: it answered 200',
      ],
    ] as const) {
      const error = await privateDownloadUrlOf({
        feed,
        version: '0.2.0',
        file,
        token: TOKEN,
        fetch: anApi(answers).fetch,
      }).catch((caught: unknown) => caught as Error)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe(said)
      expect((error as Error).message).not.toContain(TOKEN)
    }
  })

  it('⛔ the token goes to GitHub’s API only: a file the API names elsewhere is refused, unasked', async () => {
    const asked: string[] = []
    const fetch = (async (url: string) => {
      asked.push(url)
      return new Response(
        JSON.stringify({
          assets: [{ name: 'BroBot-0.2.0-arm64.dmg', url: 'https://example.org/assets/7' }],
        }),
      )
    }) as typeof globalThis.fetch
    await expect(
      privateDownloadUrlOf({
        feed,
        version: '0.2.0',
        file: 'BroBot-0.2.0-arm64.dmg',
        token: TOKEN,
        fetch,
      }),
    ).rejects.toThrow('the private feed named an address that is not GitHub’s API')
    expect(asked).toEqual(['https://api.github.com/repos/brocrew/feed/releases/tags/v0.2.0'])
  })

  it('⛔ a request that throws is said in fixed words, whatever the thrown words carried', async () => {
    const fetch = (async () => {
      throw new TypeError(`Headers.append: "token ${TOKEN}" is an invalid header value.`)
    }) as typeof globalThis.fetch
    const error = await privateDownloadUrlOf({
      feed,
      version: '0.2.0',
      file: 'BroBot-0.2.0-arm64.dmg',
      token: TOKEN,
      fetch,
    }).catch((caught: unknown) => caught as Error)
    expect((error as Error).message).toBe('the private feed could not be reached')
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN)
  })

  it('⛔ only the guided download reads the token, and only through that rule', () => {
    const main = join(here, '../src/main')
    const readers = readdirSync(main, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /GH_TOKEN|GITHUB_TOKEN/.test(readFileSync(join(main, file), 'utf8')))
    expect(readers).toEqual(['guided-update.ts'])
  })
})

describe('§5 · the wiring', () => {
  const read = (path: string): string => readFileSync(join(here, path), 'utf8')

  it('🔴 electron-updater downloads and installs nothing by itself, and the Mac never installs', () => {
    const app = read('../src/main/updates-in-the-app.ts')
    expect(app).toContain('autoUpdater.autoDownload = false')
    expect(app).toContain('autoUpdater.autoInstallOnAppQuit = false')
    expect(app).toContain("installs: process.platform === 'darwin' ? 'guided' : 'on-restart',")
    // ⛔ Never `quitAndInstall`, which starts the installer before the app has shut down.
    expect(app).not.toContain('quitAndInstall(')
  })

  it('🔴 the installer starts from `quit`, after the teardown, and only for a restart that was chosen', () => {
    const app = read('../src/main/updates-in-the-app.ts')
    expect(app).toContain(
      '    install: () => {\n      installOnTheWayOut = true\n      app.quit()\n    },',
    )
    expect(app).toContain(
      "  app.on('quit', () => {\n    if (!installOnTheWayOut || updater === null) return",
    )
    expect(app.match(/\.install\(true, true\)/g)).toHaveLength(1)
    // ⛔ …and any quit stops a restart that waits.
    expect(app).toContain("  app.on('before-quit', () => updates.stop())")
  })

  it('⚑ a check carries no per-install id', () => {
    const app = read('../src/main/updates-in-the-app.ts')
    expect(app).toContain('autoUpdater.requestHeaders = NOBODY_IN_PARTICULAR')
    expect(app).toContain(
      "const NOBODY_IN_PARTICULAR = { 'x-user-staging-id': '00000000-0000-0000-0000-000000000000' }",
    )
  })

  it('⚑ started once main has its host and its IPC', () => {
    const index = read('../src/main/index.ts')
    const ipc = index.indexOf('      registerIpc(host, localZone)')
    const started = index.indexOf('      startUpdates({ app, host, hidden: presentation.hidden })')
    expect(ipc).toBeGreaterThan(-1)
    expect(started).toBeGreaterThan(ipc)
  })
})

describe('§6 · 🔴 W4.128 — after a Windows update, BroBot reopens the workspace it was running', () => {
  /** A command line read back the way Windows does (`CommandLineToArgvW`), argument by argument. */
  function argvOf(line: string): string[] {
    const args: string[] = []
    let current = ''
    let inQuotes = false
    let any = false
    let at = 0
    while (at < line.length) {
      const char = line[at]!
      if (char === '\\') {
        let backslashes = 0
        while (line[at] === '\\') {
          backslashes += 1
          at += 1
        }
        if (line[at] === '"') {
          current += '\\'.repeat(Math.floor(backslashes / 2))
          if (backslashes % 2 === 1) {
            current += '"'
            at += 1
          }
        } else current += '\\'.repeat(backslashes)
        any = true
        continue
      }
      if (char === '"') {
        inQuotes = !inQuotes
        any = true
      } else if (/\s/.test(char) && !inQuotes) {
        if (any) args.push(current)
        current = ''
        any = false
      } else {
        current += char
        any = true
      }
      at += 1
    }
    if (any) args.push(current)
    return args
  }

  /** A command line as Node builds it on Windows (libuv): quoted when it holds a space or a quote. */
  function nodesCommandLine(args: readonly string[]): string {
    return args
      .map((arg) => {
        if (arg !== '' && !/[\s"]/.test(arg)) return arg
        let quoted = '"'
        let backslashes = 0
        for (const char of arg) {
          if (char === '\\') {
            backslashes += 1
            continue
          }
          quoted +=
            char === '"'
              ? `${'\\'.repeat(backslashes * 2 + 1)}"`
              : `${'\\'.repeat(backslashes)}${char}`
          backslashes = 0
        }
        return `${quoted}${'\\'.repeat(backslashes * 2)}"`
      })
      .join(' ')
  }

  /**
   * What `build/installer.nsh` does with its parameters: the argument after the switch — to its
   * closing quote when it is quoted, else to the next space — quoted again, for BroBot.
   */
  function theInstallersRelaunch(parameters: string): string | null {
    const at = parameters.toLowerCase().indexOf(REOPEN_SWITCH)
    if (at < 0) return null
    const ends = at > 0 && parameters[at - 1] === '"' ? '"' : ' '
    const from = at + REOPEN_SWITCH.length
    const to = parameters.indexOf(ends, from)
    const folder = parameters.slice(from, to < 0 ? undefined : to)
    return folder === '' ? null : `"--user-data-dir=${folder}"`
  }

  it('🔴 the default workspace comes back as the installer starts it; any other folder, on that folder', () => {
    expect(theWayBack('C:\\Users\\x\\AppData\\Roaming\\@brobot2\\desktop', true)).toEqual({
      on: 'the-default-workspace',
    })
    expect(theWayBack('D:\\BroBot workspaces\\Research', false)).toEqual({
      on: 'a-folder',
      folder: 'D:\\BroBot workspaces\\Research',
    })
  })

  it('🔴 the installer is told to update silently and which folder — and never to start BroBot itself', () => {
    expect(installerArgsFor('D:\\BroBot workspaces\\Research')).toEqual([
      '--updated',
      '/S',
      '--brobot-reopen=D:\\BroBot workspaces\\Research',
    ])
    expect(installerArgsFor('D:\\x').join(' ')).not.toMatch(
      /force-run|brobot-hidden|remote-debugging/,
    )
  })

  it('🔴 every folder survives the whole way: Node’s command line → the installer → BroBot’s', () => {
    for (const folder of [
      'C:\\Users\\r\\BroBot workspaces\\Team\u2019s research \u00fc',
      'C:\\plain',
      'D:\\a folder -with a dash\\x',
      "C:\\o'brien's\\notes",
      'C:\\ends in a space\\x ',
    ]) {
      // ⚑ With what an elevating installer may add after them, too.
      const parameters = `${nodesCommandLine(installerArgsFor(folder))} /NCRC`
      const relaunch = theInstallersRelaunch(parameters)
      expect(relaunch, folder).not.toBeNull()
      expect(argvOf(relaunch as string), folder).toEqual([`--user-data-dir=${folder}`])
    }
    // ⚑ A drive's root is named with a `.`: the same folder, with no backslash before the quote.
    const root = theInstallersRelaunch(nodesCommandLine(installerArgsFor('D:\\')))
    expect(argvOf(root as string)).toEqual(['--user-data-dir=D:\\.'])
    // ⚑ And an ordinary install, or the default workspace's update, opens nothing.
    expect(theInstallersRelaunch(nodesCommandLine(['--updated', '/S', '--force-run']))).toBeNull()
  })

  it('🔴 the installer’s half: after the files, BroBot on the folder named last, as the person', () => {
    const nsh = readFileSync(join(here, '../build/installer.nsh'), 'utf8')
    expect(nsh).toContain('!macro customInstall')
    expect(nsh).toContain(`    StrCpy $R2 $R0 ${String(REOPEN_SWITCH.length)} $R1`)
    expect(nsh).toContain(`    \${If} $R2 == "${REOPEN_SWITCH}"`)
    expect(nsh).toContain(`      IntOp $R1 $R1 + ${String(REOPEN_SWITCH.length)}`)
    // ⚑ The argument, to its closing quote or the next space — nothing that follows it.
    expect(nsh).toContain(`        \${If} $R2 == '"'\n          StrCpy $R5 '"'`)
    expect(nsh).toContain(`      StrCpy $R4 $R0 $R6 $R1`)
    // ⛔ Only a folder that is there: a cut or mangled path opens no new, empty workspace.
    expect(nsh).toContain(`  \${AndIf} \${FileExists} "$R4\\*.*"`)
    expect(nsh).toContain(
      `\${StdUtils.ExecShellAsUser} $0 "$INSTDIR\\\${APP_EXECUTABLE_FILENAME}" "open" '"--user-data-dir=$R4"'`,
    )
    // ⚑ Every register it uses is given back.
    for (const register of ['$0', '$R0', '$R1', '$R2', '$R3', '$R4', '$R5', '$R6']) {
      expect(nsh).toContain(`  Push ${register}\n`)
      expect(nsh).toContain(`  Pop ${register}\n`)
    }
  })

  it('⚑ BroBot comes back in an environment built for it: none of this launch’s own switches', () => {
    expect(
      builtEnvironment({
        PATH: 'C:\\Windows',
        SystemRoot: 'C:\\Windows',
        BROBOT_REDERIVE: 'sess_1',
        Brobot_Archive_Sweep: 'x',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_OPTIONS: '--inspect',
        USERPROFILE: 'C:\\Users\\x',
      }),
    ).toEqual({ PATH: 'C:\\Windows', SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\x' })
  })

  it('⚑ wired: from `quit`, the installer told the folder for any other workspace; its own way back for the default — and for an installer that will not start so', () => {
    const wired = readFileSync(join(here, '../src/main/updates-in-the-app.ts'), 'utf8')
    expect(wired).toContain(
      "    if (wayBack.on === 'the-default-workspace' || installer === null) {\n      theInstallersWayBack()\n      return\n    }",
    )
    expect(wired).toContain(
      'const theInstallersWayBack = (): void => void (updater as BaseUpdater).install(true, true)',
    )
    expect(wired).toContain(
      '      const pid = startTheInstaller({ installer, folder: wayBack.folder, env: process.env })',
    )
    expect(wired).toContain(
      "      if (pid === undefined) throw new Error('the installer did not start')",
    )
    expect(wired).toContain('      theInstallersWayBack()\n    }\n  })')
    expect(wired).toContain(
      "otherDataFolder(userData, defaultDataFolder(app.getPath('appData'))) === null",
    )
    const starter = readFileSync(join(here, '../src/main/reopen-after-update.ts'), 'utf8')
    expect(starter).toContain(
      "  const installer = spawn(options.installer, installerArgsFor(options.folder), {\n    detached: true,\n    stdio: 'ignore',\n    env: builtEnvironment(options.env),\n  })",
    )
  })
})
