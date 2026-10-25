import { FakeRuntime } from '@brobot2/runtime'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { joinLiveHosts, providerProcessesAreInFlight } from '../src/main/runtime/live-hosts'
import { createLaunchRegistry } from '../src/main/runtime/launch-registry'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
  existsSync,
  realpathSync,
  renameSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  batchesToClear,
  clearTranscripts,
  whatToClear,
} from '../src/main/transcript-retention-files'
import { TranscriptRetentionHost } from '../src/main/transcript-retention'
import { transcriptsClearedWords } from '../src/shared/transcript-retention'

const filesystemGate = vi.hoisted(() => ({
  beforeMkdir: null as null | ((path: string) => Promise<void>),
  beforeUnlink: null as null | ((path: string) => Promise<void>),
  beforeScan: null as null | ((path: string) => Promise<void>),
  beforeStat: null as null | ((path: string) => Promise<void>),
  beforeRename: null as null | ((from: string, to: string) => Promise<void>),
  afterRename: null as null | ((from: string, to: string) => Promise<void>),
}))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      await filesystemGate.beforeMkdir?.(String(args[0]))
      return actual.mkdir(...args)
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      await filesystemGate.beforeScan?.(String(args[0]))
      return actual.readdir(...args)
    },
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      await filesystemGate.beforeStat?.(String(args[0]))
      return actual.lstat(...args)
    },
    rename: async (
      from: Parameters<typeof actual.rename>[0],
      to: Parameters<typeof actual.rename>[1],
    ) => {
      await filesystemGate.beforeRename?.(String(from), String(to))
      await actual.rename(from, to)
      await filesystemGate.afterRename?.(String(from), String(to))
    },
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      await filesystemGate.beforeUnlink?.(String(path))
      return actual.unlink(path)
    },
  }
})

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const OLD = '11111111-1111-4111-8111-111111111111'
const RECENT = '22222222-2222-4222-8222-222222222222'
let dir: string
let data: string
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'brocrew-retention-')))
  data = join(dir, 'app')
  mkdirSync(data)
})
afterEach(() => {
  filesystemGate.beforeMkdir = null
  filesystemGate.beforeScan = null
  filesystemGate.beforeStat = null
  filesystemGate.beforeUnlink = null
  filesystemGate.beforeRename = null
  filesystemGate.afterRename = null
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})
const home = (provider: string) =>
  join(data, 'provider-homes', 'default', 'fictional-agent', provider)
function file(path: string, days: number): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'fictional transcript\n')
  utimesSync(path, (NOW - days * DAY) / 1000, (NOW - days * DAY) / 1000)
  return path
}
const claude = (id: string, days: number) =>
  file(join(home('claude'), 'projects', '-fictional', `${id}.jsonl`), days)
const codex = (id: string, days: number) =>
  file(
    join(home('codex'), 'sessions', '2026', '01', '01', `rollout-2026-01-01T00-00-00-${id}.jsonl`),
    days,
  )
const unused = () => false
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

it('one rule clears both providers at 91 days, retains 89 days and everything outside their transcripts', async () => {
  const a = claude(OLD, 91),
    b = codex(OLD, 91)
  const c = claude(RECENT, 89),
    d = codex(RECENT, 89)
  const outside = file(join(home('codex'), 'fictional-state.txt'), 365)
  const personal = file(join(dir, 'fictional-personal', 'sessions', `rollout-${OLD}.jsonl`), 365)
  const plan = await whatToClear(data, 90, NOW, unused)
  expect(plan.entries.map((one) => one.file).sort()).toEqual([a, b].sort())
  expect(existsSync(a)).toBe(true)
  const bytes = statSync(a).size + statSync(b).size
  expect(await clearTranscripts(plan, unused)).toEqual({ conversations: 2, bytes })
  for (const path of [c, d, outside, personal]) expect(existsSync(path)).toBe(true)
  expect(await clearTranscripts(plan, unused)).toEqual({ conversations: 0, bytes: 0 })
})
it('live or starting conversations stay, including becoming live after selection', async () => {
  const a = claude(OLD, 365),
    b = codex(OLD, 365)
  expect((await whatToClear(data, 90, NOW, () => true)).entries).toEqual([])
  const plan = await whatToClear(data, 90, NOW, unused)
  expect(await clearTranscripts(plan, () => true)).toEqual({ conversations: 0, bytes: 0 })
  expect(existsSync(a) && existsSync(b)).toBe(true)
})
it('Forever clears nothing; exact-boundary and newly touched files stay', async () => {
  const a = claude(OLD, 90),
    b = codex(OLD, 91)
  expect((await whatToClear(data, 'forever', NOW, unused)).entries).toEqual([])
  const plan = await whatToClear(data, 90, NOW, unused)
  expect(plan.entries.map((one) => one.file)).toEqual([b])
  utimesSync(b, NOW / 1000, NOW / 1000)
  expect(await clearTranscripts(plan, unused)).toEqual({ conversations: 0, bytes: 0 })
  expect(existsSync(a) && existsSync(b)).toBe(true)
})
it('a bounded directory batch visits older eligible transcripts first', async () => {
  const newer = claude('a-newer', 100)
  const older = claude('b-older', 365)
  const plan = await whatToClear(data, 90, NOW, unused)
  expect(plan.entries.map((entry) => entry.file)).toEqual([older, newer])
})
it('linked homes, transcript files and accompanying folders never reach another home', async () => {
  const outside = join(dir, 'fictional-personal')
  const target = file(join(outside, `${OLD}.jsonl`), 365)
  mkdirSync(join(home('claude'), 'projects', '-fictional'), { recursive: true })
  symlinkSync(target, join(home('claude'), 'projects', '-fictional', `${OLD}.jsonl`))
  mkdirSync(dirname(home('codex')), { recursive: true })
  symlinkSync(outside, home('codex'), 'dir')
  expect((await whatToClear(data, 90, NOW, unused)).entries).toEqual([])
  expect(readFileSync(target, 'utf8')).toBe('fictional transcript\n')
  const a = claude(RECENT, 365)
  symlinkSync(outside, a.slice(0, -6), 'dir')
  expect((await whatToClear(data, 90, NOW, unused)).entries).toEqual([])
})
it('Claude accompanying files share the cutoff; new children keep the entire conversation', async () => {
  const a = claude(OLD, 365)
  const folder = a.slice(0, -6)
  const tool = file(join(folder, 'tool-results', 'fictional.txt'), 365)
  for (const path of [dirname(tool), folder])
    utimesSync(path, (NOW - 365 * DAY) / 1000, (NOW - 365 * DAY) / 1000)
  const plan = await whatToClear(data, 90, NOW, unused)
  expect(plan.entries).toHaveLength(1)
  file(join(folder, 'new.txt'), 1)
  expect(await clearTranscripts(plan, unused)).toEqual({ conversations: 0, bytes: 0 })
  expect(existsSync(a)).toBe(true)
  expect((await whatToClear(data, 90, NOW, unused)).entries).toEqual([])
})
it('an ancestor swapped after validation cannot redirect deletion into a personal home', async () => {
  const managed = claude(OLD, 365)
  const project = dirname(managed)
  const parked = `${project}-parked`
  const personal = file(join(dir, 'fictional-personal', `${OLD}.jsonl`), 1)
  writeFileSync(personal, 'personal transcript must survive\n')
  const plan = await whatToClear(data, 90, NOW, unused)
  let swapped = false
  const swap = async (from: string): Promise<void> => {
    if (from !== managed || swapped) return
    swapped = true
    renameSync(project, parked)
    symlinkSync(dirname(personal), project, process.platform === 'win32' ? 'junction' : 'dir')
  }
  filesystemGate.beforeRename = swap
  filesystemGate.beforeUnlink = swap
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const cleared = await clearTranscripts(plan, unused)
  expect(swapped).toBe(true)
  expect(existsSync(personal)).toBe(true)
  expect(readFileSync(personal, 'utf8')).toBe('personal transcript must survive\n')
  expect(existsSync(join(parked, `${OLD}.jsonl`))).toBe(true)
  expect(cleared).toMatchObject({ conversations: 0, bytes: 0, stopped: true })
  expect(warning).toHaveBeenCalled()
})
it('an identity mismatch in staging puts the moved file back and stops the pass', async () => {
  const target = claude(OLD, 365)
  const plan = await whatToClear(data, 90, NOW, unused)
  let kept = ''
  let moved = false
  filesystemGate.afterRename = async (from, to) => {
    if (from !== target) return
    moved = true
    kept = `${to}-selected`
    renameSync(to, kept)
    file(to, 365)
    expect(statSync(to, { bigint: true }).ino).not.toBe(statSync(kept, { bigint: true }).ino)
    expect(statSync(to, { bigint: true }).size).toBe(statSync(kept, { bigint: true }).size)
    expect(statSync(to, { bigint: true }).mtimeNs).toBe(statSync(kept, { bigint: true }).mtimeNs)
  }
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const cleared = await clearTranscripts(plan, unused)
  expect(existsSync(target)).toBe(true)
  expect(moved).toBe(true)
  expect(readFileSync(target, 'utf8')).toBe('fictional transcript\n')
  expect(readFileSync(kept, 'utf8')).toBe('fictional transcript\n')
  expect(cleared).toMatchObject({ conversations: 0, bytes: 0, stopped: true })
  expect(typeof plan.entries[0]!.entries[0]!.stat.ino).toBe('bigint')
  expect(warning).toHaveBeenCalled()
})
it('a home that becomes active after staging gets its transcript back before cleanup stops', async () => {
  const target = claude(OLD, 365)
  const plan = await whatToClear(data, 90, NOW, unused)
  let running = false
  filesystemGate.afterRename = async (from) => {
    if (from === target) running = true
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const cleared = await clearTranscripts(plan, () => running)
  expect(existsSync(target)).toBe(true)
  expect(readFileSync(target, 'utf8')).toBe('fictional transcript\n')
  expect(cleared).toMatchObject({ conversations: 0, bytes: 0, stopped: true })
})

it('a restore never overwrites a source file recreated while the selection was moved', async () => {
  const target = claude(OLD, 365)
  const plan = await whatToClear(data, 90, NOW, unused)
  let kept = ''
  filesystemGate.afterRename = async (from, to) => {
    if (from !== target) return
    kept = to
    writeFileSync(to, 'moved contents changed\n')
    writeFileSync(target, 'new original-path contents\n')
  }
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await clearTranscripts(plan, unused)).toMatchObject({
    conversations: 0,
    bytes: 0,
    stopped: true,
  })
  expect(readFileSync(target, 'utf8')).toBe('new original-path contents\n')
  expect(readFileSync(kept, 'utf8')).toBe('moved contents changed\n')
  expect(warning.mock.calls[0]?.[1]).toBeInstanceOf(Error)
  expect((warning.mock.calls[0]?.[1] as Error).message).toContain(kept)
})
it('a stopped cleanup does not clear the next candidate or record the pass as complete', async () => {
  const first = claude(OLD, 365)
  const second = claude(RECENT, 365)
  let moves = 0
  filesystemGate.afterRename = async (from, to) => {
    if (from !== first && from !== second) return
    moves++
    writeFileSync(to, 'changed candidate\n')
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const h = new TranscriptRetentionHost(data, unused, () => NOW)
  await h.run()
  expect(moves).toBe(1)
  expect(existsSync(first) && existsSync(second)).toBe(true)
  expect(await h.recent(0, NOW)).toEqual([])
  expect(JSON.parse(readFileSync(join(data, 'transcript-retention.json'), 'utf8')).checkedAt).toBe(
    0,
  )
  await h.stop()
})

it('any live process protects every home, including the other provider', async () => {
  const live = Object.create(RuntimeHost.prototype) as RuntimeHost
  const slots = new Map()
  const launches = createLaunchRegistry()
  Object.assign(live, {
    slots,
    startsInFlight: new Map(),
    launches,
    aReopenIsBeingDecidedFor: new Map(),
  })
  const target = claude(OLD, 365)
  slots.set('fictional-worker', {
    session: {
      provider: 'claude',
      providerHome: home('claude'),
      profileId: 'fictional-agent',
      handle: { ref: { sessionId: RECENT } },
    },
  })
  const launch = launches.open('fictional worker', 'fictional-worker')
  const protects = () => live.providerProcessesInFlight()
  expect((await whatToClear(data, 90, NOW, protects)).entries).toEqual([])
  expect(protects()).toBe(true)
  slots.clear()
  expect(protects()).toBe(true)
  launches.finish(launch)
  const probe = launches.open('fictional model probe')
  expect(protects()).toBe(true)
  launches.finish(probe)
  expect((await whatToClear(data, 90, NOW, protects)).entries.map((one) => one.file)).toEqual([
    target,
  ])
})

it('a live agent or unsettled probe anywhere in the app admits no cleanup work', async () => {
  const live = Object.create(RuntimeHost.prototype) as RuntimeHost
  const slots = new Map([['other-agent', { session: { providerHome: join(dir, 'other-home') } }]])
  const launches = createLaunchRegistry()
  Object.assign(live, {
    slots,
    startsInFlight: new Map(),
    launches,
    aReopenIsBeingDecidedFor: new Map(),
  })
  const leave = joinLiveHosts(live)
  const targets = [claude(OLD, 365), codex(OLD, 365)]
  let scans = 0
  filesystemGate.beforeScan = async () => {
    scans++
  }
  const h = new TranscriptRetentionHost(data, providerProcessesAreInFlight, () => NOW)
  try {
    await h.run()
    expect(scans).toBe(0)
    expect(targets.every(existsSync)).toBe(true)
    expect(existsSync(join(data, 'transcript-retention.json'))).toBe(false)
    slots.clear()
    const probe = launches.open('a probe in another home')
    let settle!: () => void
    launches.finish(
      probe,
      new Promise<void>((resolve) => {
        settle = resolve
      }),
    )
    await h.run()
    expect(scans).toBe(0)
    expect(targets.every(existsSync)).toBe(true)
    settle()
    await probe.settled
    await h.run()
    expect(scans).toBe(0)
    expect(targets.every(existsSync)).toBe(true)
    expect(await h.recent(0, NOW)).toEqual([])
  } finally {
    leave()
    await h.stop()
  }
})

it('a launch requested during scanning waits until the whole clearing pass ends', async () => {
  const target = claude(OLD, 365)
  let release!: () => void
  let arrived!: () => void
  const entered = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  filesystemGate.beforeScan = async () => {
    arrived()
    await held
  }
  const h = new TranscriptRetentionHost(data, unused, () => NOW)
  const pass = h.run()
  let started = 0
  try {
    await entered
    const launch = h.beforeLaunch().then(() => {
      started++
    })
    await Promise.resolve()
    expect(started).toBe(0)
    expect(existsSync(target)).toBe(true)
    release()
    await pass
    await launch
    expect(started).toBe(1)
    expect(existsSync(target)).toBe(false)
  } finally {
    release()
    await pass
    await h.stop()
  }
})

function heldOperation() {
  let entered!: () => void
  let release!: () => void
  const arrived = new Promise<void>((resolve) => { entered = resolve })
  const held = new Promise<void>((resolve) => { release = resolve })
  return { arrived, release, hold: async () => { entered(); await held } }
}

type RetentionSave = {
  save: (progress: {
    version: number
    at: number
    days: number
    conversations: number
    bytes: number
    cursor: string
  }, complete: boolean, stoppedEarly: boolean) => Promise<void>
}

function watchRetentionSaves(host: TranscriptRetentionHost) {
  const saving = host as unknown as RetentionSave
  const realSave = saving.save.bind(host)
  const writes: Promise<void>[] = []
  const save = vi.spyOn(saving, 'save').mockImplementation((...args) => {
    const writing = realSave(...args)
    writes.push(writing)
    return writing
  })
  return { writes, save, realSave }
}

async function expectDeadlineReceipt(host: TranscriptRetentionHost) {
  const receipts = await host.recent(0, NOW)
  expect(receipts).toHaveLength(1)
  expect(receipts[0]).toMatchObject({ conversations: 0, bytes: 0, stoppedEarly: true })
  expect(transcriptsClearedWords(receipts[0]!)).toBe(
    'Transcript clearing stopped after 15 seconds so agents could start. No transcripts were cleared. The rest will be checked next time BroCrew starts.',
  )
}

it('a scan that never settles releases the first launch at the deadline and records no deletion', async () => {
  const target = claude(OLD, 365)
  const scan = heldOperation()
  const persistence = heldOperation()
  filesystemGate.beforeScan = scan.hold
  filesystemGate.beforeRename = async (_from, to) => {
    if (to === join(data, 'transcript-retention.json')) await persistence.hold()
  }
  const host = new TranscriptRetentionHost(data, unused, () => NOW, false, 20)
  const { writes } = watchRetentionSaves(host)
  const pass = host.run()
  try {
    await scan.arrived
    let launched = false
    const launch = host.beforeLaunch().then(() => { launched = true })
    await wait(60)
    expect(launched).toBe(true)
    expect(existsSync(target)).toBe(true)
    await expectDeadlineReceipt(host)
    scan.release()
    await Promise.all([pass, launch])
    expect(existsSync(target)).toBe(true)
  } finally {
    persistence.release()
    scan.release()
    await pass
    await Promise.allSettled(writes)
    await host.stop()
  }
})

it('a normal startup pass still deletes and records its completed check', async () => {
  const target = claude(OLD, 365)
  const host = new TranscriptRetentionHost(data, unused, () => NOW, false, 500)
  await host.run()
  await host.beforeLaunch()
  expect(existsSync(target)).toBe(false)
  expect(await host.recent(0, NOW)).toMatchObject([{ conversations: 1 }])
  expect((await host.recent(0, NOW))[0]?.stoppedEarly).toBeUndefined()
  expect(JSON.parse(readFileSync(join(data, 'transcript-retention.json'), 'utf8'))).toMatchObject({
    checkedAt: NOW,
    scanAfter: '',
  })
  await host.stop()
})

it('a deletion already in flight settles, but no later deletion starts after the deadline', async () => {
  const first = claude(OLD, 365)
  const second = claude(RECENT, 365)
  const firstBytes = statSync(first).size
  let release!: () => void
  let entered!: () => void
  const arrived = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let unlinks = 0
  filesystemGate.beforeUnlink = async () => {
    unlinks++
    if (unlinks === 1) {
      entered()
      await held
    }
  }
  const host = new TranscriptRetentionHost(data, unused, () => NOW, false, 20)
  const pass = host.run()
  try {
    await arrived
    const launch = host.beforeLaunch()
    await wait(60)
    await launch
    release()
    await pass
    expect(existsSync(first)).toBe(false)
    expect(existsSync(second)).toBe(true)
    expect(unlinks).toBe(1)
    const line = (await host.recent(0, NOW))[0]!
    expect(line).toMatchObject({ conversations: 1, stoppedEarly: true })
    expect(transcriptsClearedWords(line)).toBe(
      `Transcript clearing stopped after 15 seconds so agents could start. Cleared the transcripts of 1 conversation unused for 90 days, freeing ${firstBytes} B. The rest will be checked next time BroCrew starts.`,
    )
  } finally {
    release()
    await pass
    await host.stop()
  }
})

it('a staged move that settles after the deadline restores its file before the pass ends', async () => {
  const target = claude(OLD, 365)
  let release!: () => void
  let entered!: () => void
  const arrived = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  filesystemGate.beforeRename = async (from) => {
    if (from === target) {
      entered()
      await held
    }
  }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const host = new TranscriptRetentionHost(data, unused, () => NOW, false, 20)
  const pass = host.run()
  try {
    await arrived
    const launch = host.beforeLaunch()
    await wait(60)
    await launch
    release()
    await pass
    expect(readFileSync(target, 'utf8')).toBe('fictional transcript\n')
    expect(
      readdirSync(join(data, 'provider-homes')).some((name) =>
        name.startsWith('.transcript-cleanup-'),
      ),
    ).toBe(false)
    expect((await host.recent(0, NOW))[0]).toMatchObject({ conversations: 0, stoppedEarly: true })
  } finally {
    release()
    await pass
    await host.stop()
  }
})

it('a move held in staging setup cannot start after the deadline releases a real launch', async () => {
  const target = claude(OLD, 365)
  let release!: () => void
  let entered!: () => void
  const arrived = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  filesystemGate.beforeMkdir = async (path) => {
    if (path.includes('.transcript-cleanup-')) {
      entered()
      await held
    }
  }
  let moves = 0
  filesystemGate.beforeRename = async (from) => {
    if (from === target) moves++
  }
  const clearing = new TranscriptRetentionHost(
    data,
    () => live.providerProcessesInFlight(),
    () => NOW,
    false,
    15_000,
  )
  const runtime = new FakeRuntime('codex')
  const live = new RuntimeHost({
    store: NULL_SESSION_STORE,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(data, 'exports'),
    createRuntime: () => runtime,
    prepareProviderHome: (provider) => home(provider),
    providerHomePath: (provider) => home(provider),
    resolveCwd: () => dir,
    newSessionId: () => 'sess_orchard',
    beforeProviderLaunch: (): Promise<void> => clearing.beforeLaunch(),
    readProviderConfig: (_provider, home) => ({
      home,
      homeEnv: 'CODEX_HOME',
      model: 'fictional-model',
      authNote: null,
      files: [],
    }),
  })
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const pass = clearing.run()
  try {
    await arrived
    const opening = live.createSession(
      { provider: 'codex' },
      {
        ownerId: 'fictional-window',
        aPersonIsBehindIt: true,
        alive: true,
        send() {},
        sendLiveness() {},
      },
    )
    void opening.catch(() => undefined)
    await vi.advanceTimersByTimeAsync(15_000)
    const opened = await opening
    expect(opened.provider).toBe('codex')
    expect(live.providerProcessesInFlight()).toBe(true)
    release()
    await pass
    expect(moves).toBe(0)
    expect(readFileSync(target, 'utf8')).toBe('fictional transcript\n')
  } finally {
    vi.useRealTimers()
    release()
    await pass
    await live.closeAll()
    await clearing.stop()
  }
})

it.each([30, 90] as const)(
  'a held old scan cannot undo the cursor reset when the choice is set to %i days',
  async (period) => {
    for (let i = 0; i < 5; i++) claude(`a-${i}`, 1)
    let release!: () => void
    let entered!: () => void
    const arrived = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    filesystemGate.beforeStat = async (path) => {
      if (path.endsWith('a-4.jsonl')) {
        entered()
        await held
      }
    }
    const host = new TranscriptRetentionHost(data, unused, () => NOW, false, 15_000)
    const pass = host.run()
    try {
      await arrived
      await host.set(period)
      release()
      await pass
      expect(
        JSON.parse(readFileSync(join(data, 'transcript-retention.json'), 'utf8')),
      ).toMatchObject({ period, scanAfter: '' })
    } finally {
      release()
      await pass
      await host.stop()
    }
  },
)

it('resume skips completed subtrees before listing or yielding their children', async () => {
  const projects = join(home('claude'), 'projects')
  for (let i = 0; i < 20; i++)
    file(join(projects, `a-${String(i).padStart(2, '0')}`, 'kept.jsonl'), 1)
  const cursor = 'default/fictional-agent/claude/projects/m-cursor/kept.jsonl'
  file(join(projects, 'm-cursor', 'kept.jsonl'), 1)
  const target = file(join(projects, 'z-later', 'eligible.jsonl'), 365)
  const visited: string[] = []
  filesystemGate.beforeScan = async (path) => {
    visited.push(path)
  }
  const selected: string[] = []
  for await (const batch of batchesToClear(data, 90, NOW, unused, cursor))
    selected.push(...batch.entries.map((one) => one.file))
  expect(selected).toEqual([target])
  expect(visited.filter((path) => dirname(path) === projects && path.includes('/a-'))).toEqual([])
})

it('a resumed Codex directory skips its nonmatching pre-cursor files', async () => {
  const kept = codex(OLD, 1)
  const target = codex(RECENT, 365)
  const folder = dirname(kept)
  for (let i = 0; i < 20; i++) file(join(folder, `a-${i}.txt`), 1)
  const read: string[] = []
  filesystemGate.beforeStat = async (path) => {
    if (dirname(path) === folder && basename(path).startsWith('a-')) read.push(path)
  }
  const cursor = `default/fictional-agent/codex/sessions/2026/01/01/${basename(kept)}`
  const selected: string[] = []
  for await (const batch of batchesToClear(data, 90, NOW, unused, cursor))
    selected.push(...batch.entries.map((one) => one.file))
  expect(selected).toEqual([target])
  expect(read).toEqual([])
})

it('a slow finite kept prefix cannot exhaust every resumed start before a later eligible file', async () => {
  const projects = join(home('claude'), 'projects')
  for (let i = 0; i < 20; i++)
    file(join(projects, `a-${String(i).padStart(2, '0')}`, 'kept.jsonl'), 1)
  file(join(projects, 'm-cursor', 'kept.jsonl'), 1)
  const target = file(join(projects, 'z-later', 'eligible.jsonl'), 365)
  writeFileSync(
    join(data, 'transcript-retention.json'),
    JSON.stringify({
      period: 90,
      checkedAt: 0,
      scanAfter: 'default/fictional-agent/claude/projects/m-cursor/kept.jsonl',
      cleared: [],
    }),
  )
  let elapsed = 0
  vi.spyOn(performance, 'now').mockImplementation(() => elapsed)
  filesystemGate.beforeScan = async (path) => {
    if (dirname(path) === projects && path.includes('/a-')) elapsed += 2_000
  }
  const host = new TranscriptRetentionHost(data, unused, () => NOW, false, 10_000)
  try {
    await host.run()
    expect(existsSync(target)).toBe(false)
  } finally {
    await host.stop()
  }
})

it('a cut pass resumes past kept files and clears later eligible files over later starts', async () => {
  const project = join(home('claude'), 'projects', '-fictional')
  for (let index = 0; index < 12; index++)
    file(join(project, `a-${String(index).padStart(2, '0')}.jsonl`), 1)
  const eligible = file(join(project, 'z-eligible.jsonl'), 365)
  for (const [blocked, expectedCursor] of [
    ['a-04', 'a-03'],
    ['a-08', 'a-07'],
  ] as const) {
    let release!: () => void
    let entered!: () => void
    const arrived = new Promise<void>((resolve) => {
      entered = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    filesystemGate.beforeStat = async (path) => {
      if (path.endsWith(`${blocked}.jsonl`)) {
        entered()
        await held
      }
    }
    // Batches are cut by size, never by scan time, and the deadline passes only when the test says.
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const host = new TranscriptRetentionHost(data, unused, () => NOW, false, 20)
    const pass = host.run()
    try {
      await arrived
      const launch = host.beforeLaunch()
      await vi.advanceTimersByTimeAsync(20)
      await launch
      release()
      await pass
      expect(existsSync(eligible)).toBe(true)
      expect(
        JSON.parse(readFileSync(join(data, 'transcript-retention.json'), 'utf8')).scanAfter,
      ).toBe(`default/fictional-agent/claude/projects/-fictional/${expectedCursor}.jsonl`)
    } finally {
      release()
      await pass
      await host.stop()
      vi.useRealTimers()
      clock.mockRestore()
    }
  }
  filesystemGate.beforeStat = null
  const final = new TranscriptRetentionHost(data, unused, () => NOW, false, 500)
  await final.run()
  expect(existsSync(eligible)).toBe(false)
  expect(JSON.parse(readFileSync(join(data, 'transcript-retention.json'), 'utf8')).scanAfter).toBe(
    '',
  )
  await final.stop()
})

it('changing the retention period resets a partial scan to the beginning', async () => {
  writeFileSync(
    join(data, 'transcript-retention.json'),
    JSON.stringify({
      period: 90,
      checkedAt: 0,
      scanAfter: 'default/fictional-agent/claude/projects/-fictional/a-07.jsonl',
      cleared: [],
    }),
  )
  const host = new TranscriptRetentionHost(data, unused, () => NOW)
  await host.set(30)
  expect(JSON.parse(readFileSync(join(data, 'transcript-retention.json'), 'utf8'))).toMatchObject({
    period: 30,
    scanAfter: '',
  })
  await host.stop()
})

it('the saved choice survives restart; only a new app session can clear again', async () => {
  claude(OLD, 91)
  let clock = NOW
  const h = new TranscriptRetentionHost(data, unused, () => clock)
  expect(await h.read()).toBe(90)
  await h.run()
  const lines = await h.recent(NOW - DAY, NOW)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({ days: 90, conversations: 1 })
  expect(transcriptsClearedWords(lines[0]!)).toMatch(
    /^Cleared the transcripts of 1 conversation unused for 90 days, freeing /,
  )
  claude(RECENT, 91)
  await h.run()
  expect(existsSync(join(home('claude'), 'projects', '-fictional', `${RECENT}.jsonl`))).toBe(true)
  clock += DAY
  await h.run()
  h.start()
  expect(existsSync(join(home('claude'), 'projects', '-fictional', `${RECENT}.jsonl`))).toBe(true)
  expect(await h.recent(NOW - DAY, clock)).toHaveLength(1)
  await h.stop()
  const restarted = new TranscriptRetentionHost(data, unused, () => clock)
  await restarted.run()
  expect(existsSync(join(home('claude'), 'projects', '-fictional', `${RECENT}.jsonl`))).toBe(false)
  expect(await restarted.recent(NOW - DAY, clock)).toHaveLength(2)
  for (const choice of [30, 365, 'forever', 90] as const) {
    await restarted.set(choice)
    expect(await new TranscriptRetentionHost(data, unused).read()).toBe(choice)
  }
  await restarted.stop()
})
it('a finished launch permanently closes the clearing opportunity in this app session', async () => {
  const target = claude(OLD, 365)
  const launches = createLaunchRegistry()
  const h = new TranscriptRetentionHost(
    data,
    () => launches.size > 0,
    () => NOW,
  )
  let scans = 0
  filesystemGate.beforeScan = async () => {
    scans++
  }
  const launch = launches.open('fictional first model probe')
  await h.beforeLaunch()
  launches.finish(launch)
  await launch.settled
  expect(launches.size).toBe(0)
  await h.run()
  h.start()
  await h.run()
  expect(scans).toBe(0)
  expect(existsSync(target)).toBe(true)
  expect(await h.recent(0, NOW)).toEqual([])
  await h.stop()
})
it('an interrupted previous run skips startup clearing and is never retried in that session', async () => {
  const target = codex(OLD, 365)
  let scans = 0
  filesystemGate.beforeScan = async () => {
    scans++
  }
  const h = new TranscriptRetentionHost(data, unused, () => NOW, true)
  await h.run()
  await h.beforeLaunch()
  await h.run()
  expect(scans).toBe(0)
  expect(existsSync(target)).toBe(true)
  expect(await h.recent(0, NOW)).toEqual([])
  await h.stop()
})
it('stopping a failed startup cannot rearm clearing when that start is retried', async () => {
  const target = claude(OLD, 365)
  const h = new TranscriptRetentionHost(data, unused, () => NOW)
  await h.beforeLaunch()
  await h.stop()
  h.start()
  await h.run()
  expect(existsSync(target)).toBe(true)
  expect(await h.recent(0, NOW)).toEqual([])
})
it('unreadable settings preserve the transcripts instead of guessing a deletion period', async () => {
  const a = claude(OLD, 365)
  writeFileSync(join(data, 'transcript-retention.json'), '{torn')
  const h = new TranscriptRetentionHost(data, unused, () => NOW)
  const pass = h.run()
  const launch = h.beforeLaunch()
  await expect(pass).rejects.toThrow('Transcript retention could not be read')
  await expect(launch).resolves.toBeUndefined()
  expect(existsSync(a)).toBe(true)
  expect(readdirSync(data)).toContain('provider-homes')
})

it('the real host protection covers live slots, aliases and pending launches', async () => {
  const live = Object.create(RuntimeHost.prototype) as RuntimeHost
  const slots = new Map()
  const starts = new Map()
  const recovering = new Map()
  Object.assign(live, {
    slots,
    startsInFlight: starts,
    launches: createLaunchRegistry(),
    aReopenIsBeingDecidedFor: recovering,
  })
  const a = claude(OLD, 365)
  const protects = () => live.providerProcessesInFlight()
  expect(protects()).toBe(false)
  slots.set('fictional-live', {
    session: {
      provider: 'claude',
      providerHome: home('claude'),
      profileId: 'fictional-agent',
      handle: { ref: { sessionId: OLD } },
    },
  })
  expect((await whatToClear(data, 90, NOW, protects)).entries).toEqual([])
  const alias = join(dir, 'app-alias')
  symlinkSync(data, alias, 'dir')
  slots.get('fictional-live').session.providerHome = join(
    alias,
    'provider-homes',
    'default',
    'fictional-agent',
    'claude',
  )
  expect((await whatToClear(alias, 90, NOW, protects)).entries).toEqual([])
  slots.clear()
  starts.set('fictional-starting', Promise.resolve('fictional-starting'))
  expect((await whatToClear(data, 90, NOW, protects)).entries).toEqual([])
  starts.clear()
  recovering.set('a-stopped-agent-renewing-its-login', 1)
  expect((await whatToClear(data, 90, NOW, protects)).entries).toEqual([])
  recovering.clear()
  slots.set('fictional-reservation', { session: null })
  expect((await whatToClear(data, 90, NOW, protects)).entries).toEqual([])
  expect(existsSync(a)).toBe(true)
})

it.each([30, 90, 365] as const)(
  'uses the selected %s-day cutoff for both providers',
  async (days) => {
    claude(OLD, days + 1)
    codex(OLD, days + 1)
    claude(RECENT, days - 1)
    codex(RECENT, days - 1)
    expect((await whatToClear(data, days, NOW, unused)).entries.map((one) => one.session)).toEqual([
      OLD,
      OLD,
    ])
  },
)
it('a provider launch waits for a removal already in progress', async () => {
  const target = claude(OLD, 365)
  let release!: () => void
  let arrived!: () => void
  const entered = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  filesystemGate.beforeUnlink = async (path) => {
    if (path.includes('.transcript-cleanup-')) {
      arrived()
      await held
    }
  }
  let opening = false
  const h = new TranscriptRetentionHost(
    data,
    () => opening,
    () => NOW,
  )
  const pass = h.run()
  try {
    await entered
    opening = true
    let started = 0
    const provider = h.beforeLaunch().then(() => {
      started++
    })
    await Promise.resolve()
    expect(started).toBe(0)
    release()
    await pass
    await provider
    expect(started).toBe(1)
    expect(existsSync(target)).toBe(false)
    expect(await h.recent(NOW - DAY, NOW)).toHaveLength(1)
  } finally {
    release()
    await pass
    await h.stop()
  }
})
it('a concurrent first read cannot overwrite a newly saved Forever choice', async () => {
  const target = claude(OLD, 365)
  const h = new TranscriptRetentionHost(data, unused, () => NOW)
  await Promise.all([h.read(), h.set('forever'), h.read()])
  expect(await h.read()).toBe('forever')
  await h.run()
  expect(existsSync(target)).toBe(true)
  expect(await h.recent(0, NOW)).toEqual([])
  await h.stop()
})

it('Recent activity carries cleanup metadata and marks an unreadable cleanup history incomplete', async () => {
  const live = Object.create(RuntimeHost.prototype) as RuntimeHost
  const row = { at: NOW, days: 90, conversations: 2, bytes: 1024 }
  const windowAnswer = {
    kind: 'activity',
    window: { from: NOW - DAY, to: NOW },
    read: { walk: 'one-window-over-every-agents-conversation', ledgers: 0, rowsUnread: 0 },
    lines: [],
    capped: false,
  }
  const deps = {
    windowReader: { read: async () => windowAnswer },
    transcriptsCleared: async () => [row],
  }
  Object.assign(live, { deps, launches: { closed: false } })
  expect(await live.recentActivity(windowAnswer.window)).toMatchObject({
    transcriptsCleared: [row],
    read: { rowsUnread: 0 },
  })
  deps.transcriptsCleared = async () => {
    throw new Error('fictional history read refusal')
  }
  expect(await live.recentActivity(windowAnswer.window)).toMatchObject({
    read: { rowsUnread: 1 },
    lines: [],
  })
})
it('a closed host cannot publish a cleanup reading that arrived after it closed', async () => {
  const live = Object.create(RuntimeHost.prototype) as RuntimeHost
  let entered!: () => void
  let finish!: () => void
  const reading = new Promise<void>((resolve) => {
    entered = resolve
  })
  const held = new Promise<void>((resolve) => {
    finish = resolve
  })
  const life = { closed: false }
  const windowAnswer = {
    kind: 'activity',
    window: { from: NOW - DAY, to: NOW },
    read: { walk: 'one-window-over-every-agents-conversation', ledgers: 0, rowsUnread: 0 },
    lines: [],
    capped: false,
  }
  Object.assign(live, {
    launches: life,
    deps: {
      windowReader: { read: async () => windowAnswer },
      transcriptsCleared: async () => {
        entered()
        await held
        return []
      },
    },
  })
  const answer = live.recentActivity(windowAnswer.window)
  await reading
  life.closed = true
  finish()
  await expect(answer).rejects.toThrow()
})
