import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  UpdatesSnapshot,
  WhatARestartWouldStop,
  WhatARestartWouldStopIn,
} from '../src/shared/updates'
import { downloadUrlOf, readFeed } from '../src/main/release-feed'
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

const roots: string[] = []
afterEach(async () => {
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
    processLists: 0,
    written: [] as UpdateSettings[],
    published: [] as UpdatesSnapshot[],
  }
  let timers: { run: () => void; ms: number; cancelled: boolean }[] = []
  let stops: WhatARestartWouldStop = QUIET
  // The settings file, as one per computer: what was written is what is read next.
  let file: UpdateSettings = overrides.start ?? UPDATE_DEFAULTS
  const deps: UpdatesDeps = {
    version: '0.1.0',
    notHere: null,
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
  it(`Download refreshes an old offer and fetches the newest release`, async () => {
    const old = { ...NEWER, version: '0.1.22' }
    const newest = {
      version: '0.1.25',
      files: [{ url: 'BroCrew-0.1.25-arm64.dmg', sha512: 'new-digest' }],
    }
    let offered = old
    const fetched: FoundUpdate[] = []
    const channels: string[] = []
    const take = async (release: FoundUpdate) => {
      fetched.push(release)
    }
    const app = anUpdater({
      start: { checkAutomatically: false, channel: 'beta' },
      check: async (channel) => {
        channels.push(channel)
        return offered
      },
      download: take,
    })
    await app.updates.checkNow()
    expect(app.updates.snapshot().state).toEqual({ kind: 'available', version: '0.1.22' })
    expect(fetched).toEqual([])
    offered = newest
    await app.updates.download()
    expect(fetched).toEqual([newest])
    expect(channels).toEqual(['beta', 'beta'])
    expect(
      app.asked.published.some(
        ({ state }) => state.kind === 'downloading' && state.version === '0.1.25',
      ),
    ).toBe(true)
    expect(app.updates.snapshot().state).toMatchObject({
      kind: 'ready',
      version: '0.1.25',
      how: 'restart',
    })
    expect(app.asked.installs).toBe(0)
  })

  it(`a refresh with no update downloads nothing`, async () => {
    let offered: FoundUpdate | null = NEWER
    const app = anUpdater({ check: async () => offered })
    await app.updates.checkNow()
    offered = null
    await app.updates.download()
    expect(app.asked.downloads).toBe(0)
    expect(app.updates.snapshot().state).toEqual({
      kind: 'idle',
      checkedAt: 1_000,
      upToDate: true,
    })
  })

  for (const outcome of ['resolve', 'reject'] as const) {
    for (const change of ['channel', 'stop'] as const) {
      it(`${change} during refresh prevents download when it ${outcome}s`, async () => {
        let finish!: () => void
        let checks = 0
        const app = anUpdater({
          start: { checkAutomatically: false, channel: 'beta' },
          check: async () => {
            if (++checks === 1) return NEWER
            return new Promise<FoundUpdate>((resolve, reject) => {
              finish = () =>
                outcome === 'resolve'
                  ? resolve({ ...NEWER, version: '0.3.0-beta.1' })
                  : reject(new Error('feed unavailable'))
            })
          },
        })
        await app.updates.checkNow()
        const pending = app.updates.download()
        expect(checks).toBe(2)
        if (change === 'channel') app.updates.set({ channel: 'stable' })
        else app.updates.stop()
        const published = app.asked.published.length
        finish()
        await pending
        expect(app.asked.downloads).toBe(0)
        expect(app.asked.installs).toBe(0)
        if (change === 'channel') {
          expect(app.updates.snapshot()).toMatchObject({
            channel: 'stable',
            state: { kind: 'idle', checkedAt: null, upToDate: false },
          })
          await app.updates.download()
          expect(app.asked.downloads).toBe(0)
        } else {
          expect(app.asked.published).toHaveLength(published)
        }
      })
    }
  }

  it('keeps another click or check from racing a download refresh', async () => {
    let releaseCheck!: (release: FoundUpdate) => void
    let checks = 0
    const app = anUpdater({
      check: async () =>
        ++checks === 1
          ? NEWER
          : new Promise((resolve) => {
              releaseCheck = resolve
            }),
    })
    await app.updates.checkNow()
    const pending = app.updates.download()
    await app.updates.download()
    await app.updates.checkNow()
    expect(checks).toBe(2)
    expect(app.asked.downloads).toBe(0)
    releaseCheck(NEWER)
    await pending
    expect(app.asked.downloads).toBe(1)
  })

  it('one switch per computer: turned off in another workspace, this one stops checking too', async () => {
    const on = anUpdater({ offered: null })
    on.updates.start()
    await on.pass()
    expect(on.asked.checks).toBe(1)
    on.elsewhere({ checkAutomatically: false, channel: 'stable' })
    for (let day = 0; day < 3; day += 1) await on.pass()
    expect(on.asked.checks).toBe(1)
    expect(on.updates.snapshot().checkAutomatically).toBe(false)
    // …and a change here keeps what the other workspace chose.
    on.updates.set({ channel: 'beta' })
    expect(on.asked.written.at(-1)).toEqual({ checkAutomatically: false, channel: 'beta' })
  })

  it('on: once soon after launch, then once a day — and never a download it was not asked for', async () => {
    const on = anUpdater()
    on.updates.start()
    expect(on.armed().map((timer) => timer.ms)).toEqual([FIRST_CHECK_AFTER_MS])
    await on.pass()
    expect(on.asked.checks).toBe(1)
    expect(on.updates.snapshot().state).toEqual({ kind: 'available', version: '0.2.0' })
    expect(on.armed().map((timer) => timer.ms)).toEqual([CHECK_EVERY_MS])
    await on.pass()
    // An offer already standing is not asked again by itself, and nothing was downloaded.
    expect(on.asked.checks).toBe(1)
    expect(on.asked.downloads).toBe(0)
  })

  it('a person who asks is answered, the switch off or not — and one check at a time', async () => {
    const off = anUpdater({ start: { checkAutomatically: false, channel: 'beta' }, offered: null })
    const [first, second] = await Promise.all([off.updates.checkNow(), off.updates.checkNow()])
    expect(off.asked.checks).toBe(1)
    expect(second?.state).toEqual({ kind: 'checking' })
    expect(first?.state).toEqual({ kind: 'idle', checkedAt: 1_000, upToDate: true })
  })

  it('the mid-turn refusal: a restart waits while a turn runs, and installs once nothing would stop', async () => {
    const win = anUpdater()
    await win.updates.checkNow()
    await win.updates.download()
    expect(win.updates.snapshot().state).toMatchObject({ kind: 'ready', how: 'restart' })
    win.setStops({ conversations: [ADA_WORKING], otherWorkspaces: 0 })
    win.updates.restartWhenQuiet()
    await settle()
    expect(win.asked.installs).toBe(0)
    // Other workspaces are not looked for while a conversation here is busy: not known yet.
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
    // Once: nothing looks again after it.
    expect(win.armed()).toEqual([])
  })

  it('a turn that starts while the process list is read is seen, and nothing installs', async () => {
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

  it('another workspace running keeps it waiting — it never stops one', async () => {
    const win = anUpdater()
    await win.updates.checkNow()
    await win.updates.download()
    win.setStops({ conversations: [], otherWorkspaces: 1 })
    win.updates.restartWhenQuiet()
    await settle()
    await win.pass()
    expect(win.asked.installs).toBe(0)
    expect(win.updates.snapshot().state.kind).toBe('waiting-to-restart')
  })

  it('a process list it cannot read never holds the update: it installs, saying so', async () => {
    const said: string[] = []
    const win = anUpdater({ log: (line) => said.push(line) })
    await win.updates.checkNow()
    await win.updates.download()
    win.setStops({ conversations: [], otherWorkspaces: null })
    win.updates.restartWhenQuiet()
    await settle()
    expect(win.asked.installs).toBe(1)
    expect(said).toContain('updates: other BroCrew windows could not be counted; restarting anyway')
  })

  it('a restart cancelled while it waits does not install, even from a look already under way', async () => {
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

  it('quitting while a restart waits never installs, even from a look already under way', async () => {
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
    // …and none is chosen again on the way out.
    win.updates.restartWhenQuiet()
    await settle()
    expect(win.asked.installs).toBe(0)
    expect(win.armed()).toEqual([])
  })

  it('a look that throws says so, and stops waiting', async () => {
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

  it('a failure is said in plain words, its first line only — and a channel with no release yet is up to date', async () => {
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

  it('what a failed check says', () => {
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

  it('a download is told once per whole percent, not once per chunk', async () => {
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

  it('an offer from the other channel is dropped when the channel changes', async () => {
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

  it('the switches are kept, and with checks turned off nothing is asked', async () => {
    const on = anUpdater()
    on.updates.start()
    const after = on.updates.set({ checkAutomatically: false, channel: 'beta' })
    expect(after).toMatchObject({ checkAutomatically: false, channel: 'beta' })
    expect(on.asked.written).toEqual([{ checkAutomatically: false, channel: 'beta' }])
    for (let day = 0; day < 3; day += 1) await on.pass()
    expect(on.asked.checks).toBe(0)
  })

  it('electron-updater’s autoUpdater is found where import() puts it: on `default`', () => {
    const updater = { autoDownload: true }
    const asImportGivesIt = {
      autoUpdater: undefined,
      default: Object.defineProperty({}, 'autoUpdater', { get: () => updater }),
    }
    expect(theAutoUpdaterOf(asImportGivesIt)).toBe(updater)
    expect(theAutoUpdaterOf({ autoUpdater: updater })).toBe(updater)
    expect(() => theAutoUpdaterOf({ default: {} })).toThrow('electron-updater has no autoUpdater')
  })

  it('the wire takes the two switches and nothing else', () => {
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
  it('one per computer beside the default folder, checks on; a hidden launch keeps its own, checks off', () => {
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

  it('no file, a broken one, or values it cannot read: the defaults', () => {
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

  it('written whole, keeping anything else the file holds', () => {
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
    // Renamed over the file: nothing is left beside it.
    expect(readdirSync(dirname(file))).toEqual(['settings.json'])
  })

  it('a write that fails says so and takes its temporary file with it', () => {
    const folder = aFolder()
    // A folder where the file should be: the rename over it fails.
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
  it('every main process of BroBot.exe but this app’s own; its helpers carry --type=', () => {
    const exe = 'C:\\Users\\x\\AppData\\Local\\Programs\\BroBot\\BroBot.exe'
    const listing = [
      `100 "${exe}"`,
      `101 "${exe}" --type=renderer --user-data-dir=C:\\x`,
      // A path PowerShell wrote in another code page is still a workspace…
      `200 "C:\\Users\\S?ren\\AppData\\Local\\Programs\\BroBot\\BroBot.exe" --user-data-dir=C:\\y`,
      // …and so is one whose command line it may not read.
      '300 ',
      `301 "${exe}" --type=gpu-process`,
      '',
    ].join('\r\n')
    expect(otherBroBotsIn(listing, new Set([100, 101]))).toBe(2)
  })

  it('how Windows is asked: the processes of this executable’s name', () => {
    const win = listingCommand('C:\\P\\BroBot.exe')
    expect(win.file).toBe('powershell.exe')
    expect(win.args.at(-1)).toContain(`Win32_Process -Filter "Name='BroBot.exe'"`)
  })
})

describe('the release feed', () => {
  it('reads GitHub and generic feeds and keeps release URLs unchanged', () => {
    expect(readFeed('provider: github\nowner: brocrew\nrepo: brocrew\n')).toEqual({
      provider: 'github',
      owner: 'brocrew',
      repo: 'brocrew',
    })
    expect(readFeed('provider: generic\nurl: https://fictional.invalid/releases\n')).toEqual({
      provider: 'generic',
      url: 'https://fictional.invalid/releases',
    })
    expect(readFeed('provider: github\nowner: brocrew\nrepo: feed\nprivate: true\n')).toEqual({
      provider: 'github',
      owner: 'brocrew',
      repo: 'feed',
      private: true,
    })
    expect(readFeed('provider: s3\n')).toBeNull()
    expect(
      downloadUrlOf(
        { provider: 'github', owner: 'brocrew', repo: 'brocrew' },
        '0.2.0-beta.1',
        'BroCrew.zip',
      ),
    ).toBe('https://github.com/brocrew/brocrew/releases/download/v0.2.0-beta.1/BroCrew.zip')
    expect(
      downloadUrlOf(
        { provider: 'generic', url: 'https://fictional.invalid/releases' },
        '0.2.0',
        'BroCrew.zip',
      ),
    ).toBe('https://fictional.invalid/releases/BroCrew.zip')
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
})
