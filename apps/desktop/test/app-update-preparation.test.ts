import { expect, it } from 'vitest'
import { createAppLifetime, type AppLifetimeDeps } from '../src/main/app-lifetime'
import { workspaceUpdate } from '../src/main/update-workspaces'

function harness(overrides: Partial<AppLifetimeDeps> = {}) {
  const log: string[] = []
  const lifetime = createAppLifetime({
    announceClosing: () => log.push('announceClosing'),
    stopArchiveWork: () => log.push('stopArchiveWork'),
    closeAllSessions: async () => {
      log.push('closeAllSessions')
    },
    drainArchiveWork: async () => {
      log.push('drainArchiveWork')
    },
    closeDatabase: () => log.push('closeDatabase'),
    quit: () => log.push('quit'),
    exit: (code) => log.push(`exit:${code}`),
    armLastResort: (withinMs) => log.push(`armLastResort:${withinMs}`),
    log: (message) => log.push(`log:${message}`),
    now: () => 0,
    ...overrides,
  })
  return { lifetime, log }
}

function quitEvent() {
  let prevented = 0
  return {
    event: {
      preventDefault: () => {
        prevented += 1
      },
    },
    get prevented() {
      return prevented
    },
  }
}

it('prepares normal teardown once without quitting, then uses its post-teardown quit continuation', async () => {
  const { lifetime, log } = harness()
  const preparation = lifetime.prepareForQuit()
  expect(lifetime.prepareForQuit()).toBe(preparation)
  await preparation
  expect(log).toContain('closeDatabase')
  expect(log).not.toContain('quit')
  expect(log.some((step) => step.startsWith('armLastResort'))).toBe(false)
  lifetime.beforeQuit(quitEvent().event)
  await lifetime.shuttingDown
  expect(log.filter((step) => step === 'closeAllSessions')).toHaveLength(1)
  expect(log.at(-1)).toBe('quit')
})

it('holds an ordinary quit while the update owns preparation, without arming repeat-quit force exit', async () => {
  let held = true
  const { lifetime, log } = harness({ holdQuit: () => held })
  const first = quitEvent()
  lifetime.beforeQuit(first.event)
  lifetime.beforeQuit(quitEvent().event)
  expect(first.prevented).toBe(1)
  expect(log).toEqual([])
  await lifetime.prepareForQuit()
  held = false
  lifetime.beforeQuit(quitEvent().event)
  await lifetime.shuttingDown
  expect(log.at(-1)).toBe('quit')
  expect(log.some((line) => line.includes('20s regardless'))).toBe(false)
})

it('does not reuse ordinary best-effort quit as an update preparation acknowledgment', async () => {
  const failure = new Error('session close failed')
  const { lifetime } = harness({
    closeAllSessions: async () => {
      throw failure
    },
  })
  lifetime.beforeQuit(quitEvent().event)
  await expect(lifetime.prepareForQuit()).rejects.toThrow('already started quitting')
  await lifetime.shuttingDown
})

it.each(['stopArchiveWork', 'closeAllSessions', 'drainArchiveWork', 'closeDatabase'] as const)(
  'does not acknowledge update preparation when %s fails',
  async (step) => {
    const failure = new Error(`${step} failed`)
    const { lifetime, log } = harness({
      [step]: () => {
        throw failure
      },
    })
    await expect(lifetime.prepareForQuit()).rejects.toBe(failure)
    expect(log).not.toContain('quit')
    expect(log.some((line) => line.startsWith('armLastResort'))).toBe(false)
    if (step !== 'closeDatabase') expect(log).not.toContain('closeDatabase')
  },
)

it('a held quit whose drafts could not be kept leaves a later update free to quit and install', async () => {
  let draftsKept = false
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const { lifetime, log } = harness({
    holdQuit: () => update.holdQuit(),
    keepUnsentDrafts: async () => {
      await blocked
      if (!draftsKept) throw new Error('drafts not saved')
    },
  })
  const update: ReturnType<typeof workspaceUpdate> = workspaceUpdate({
    self: { folder: '/workspace', pid: 1, startedAt: 0, name: 'Workspace', executable: '/BroCrew' },
    ready: () => true,
    discover: async () => [update.details()],
    request: async () => {
      throw new Error('no other workspace')
    },
    prepare: () => lifetime.prepareForQuit(),
    quitting: () => lifetime.shuttingDown !== null,
    reopen: () => log.push('reopen'),
    stayStopped: () => log.push('stays stopped'),
    remember: () => {},
    report: () => {},
    // Electron's app.quit() raises before-quit at once.
    quit: () => lifetime.beforeQuit(quitEvent().event),
    install: () => log.push('install'),
  })

  const first = update.restart('0.2.24')
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve()
  expect(update.details().owner).not.toBeNull()
  const quit = quitEvent()
  lifetime.beforeQuit(quit.event)
  expect(quit.prevented).toBe(1)
  release()
  await expect(first).rejects.toThrow('drafts not saved')
  await lifetime.shuttingDown
  expect(log).toContain('log:BroCrew is staying open because its unsent drafts were not saved')
  expect(lifetime.shuttingDown).toBeNull()
  expect(log).not.toContain('quit')

  draftsKept = true
  await update.restart('0.2.24')
  await lifetime.shuttingDown
  expect(log.at(-1)).toBe('quit')
  expect(update.finishQuit()).toBe(true)
  expect(log).toContain('install')
})
