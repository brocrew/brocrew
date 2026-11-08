import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import {
  databaseSnapshot,
  nativeFiles,
  checkNativePrefixes,
  checkpointIds,
  observeMacWindow,
  quitMacChild,
  waitFor,
  READY_LINE,
  FAIL_LINE,
} from '../lib/mac-update-test.mjs'

const folders = []
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'mac-rehearsal-shared-'))
  folders.push(path)
  return path
}
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('shared Mac rehearsal preservation', () => {
  it('reads settled rows in one transaction and retains credential ciphertext only when requested', () => {
    const path = join(folder(), 'fixture.sqlite'),
      db = new DatabaseSync(path)
    for (const table of ['provider_session', 'events', '__drizzle_migrations']) {
      db.exec(`CREATE TABLE ${table}(id TEXT PRIMARY KEY)`)
      db.prepare(`INSERT INTO ${table} VALUES (?)`).run('kept')
    }
    db.exec('CREATE TABLE provider_api_key(provider TEXT PRIMARY KEY, sealed TEXT)')
    db.prepare('INSERT INTO provider_api_key VALUES (?,?)').run('codex', 'fictional ciphertext')
    db.close()
    expect(databaseSnapshot(path).provider_api_key).toBeUndefined()
    expect(databaseSnapshot(path, { credentials: true }).provider_api_key).toEqual([
      { provider: 'codex', sealed: 'fictional ciphertext' },
    ])
    expect(databaseSnapshot(path).provider_session).toEqual([{ id: 'kept' }])
  })
  it('requires every recovery directory to be complete and preserves native byte prefixes after resume', async () => {
    const path = folder(),
      sessions = join(path, 'sessions')
    mkdirSync(sessions)
    const native = join(sessions, 'turn.jsonl')
    writeFileSync(native, 'original\n')
    const before = await nativeFiles(sessions, path)
    writeFileSync(native, 'original\nresumed\n')
    await expect(checkNativePrefixes(before, path)).resolves.toBeUndefined()
    writeFileSync(native, 'changed\nresumed\n')
    await expect(checkNativePrefixes(before, path)).rejects.toThrow('lost original bytes')
    mkdirSync(join(path, 'backups', 'copy'), { recursive: true })
    await expect(checkpointIds(path)).rejects.toThrow('Unfinished')
    writeFileSync(join(path, 'backups/copy/manifest.json'), '{}')
    expect(await checkpointIds(path)).toEqual(['copy'])
  })
})

function observedLaunch() {
  const path = folder(),
    log = join(path, 'app.log')
  writeFileSync(log, READY_LINE)
  const expected = {
    version: '0.2.12',
    source: 'a'.repeat(40),
    clean: true,
    data: path,
    isDefault: false,
    conversations: 2,
  }
  const info = {
    version: expected.version,
    build: { commit: expected.source, dirty: false },
    workspace: { path, isDefault: false },
    db: { providerSessionCount: 2 },
  }
  const identity = {
    pid: 42,
    command:
      '/Applications/BroCrew.app/Contents/MacOS/BroCrew --remote-debugging-port=9339 --remote-debugging-address=127.0.0.1',
    started: 'fixture birth',
  }
  const page = {
    type: 'page',
    id: 'fixture-page',
    url: 'file:///app/index.html',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9339/page',
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => ({
      ok: true,
      json: async () =>
        url.endsWith('/json/version')
          ? { webSocketDebuggerUrl: 'ws://127.0.0.1:9339/browser' }
          : [page],
    })),
  )
  const cdp = {
    send: vi.fn(async (method) =>
      method === 'SystemInfo.getProcessInfo' ? { processInfo: [{ type: 'browser', id: 42 }] } : {},
    ),
    evaluate: vi.fn(async (body) => (body.includes('getAppInfo') ? info : true)),
    close: vi.fn(),
  }
  const run = vi.fn(async () => 'BroCrew 42 127.0.0.1:9339 (LISTEN)')
  const options = {
    app: '/Applications/BroCrew.app',
    port: 9339,
    stage: 'signed-first',
    log,
    expected,
    run,
    processInfo: vi.fn(async () => identity),
    connect: vi.fn(async () => cdp),
    attempts: [],
    onChild: vi.fn(),
    verifyBundle: vi.fn(async () => ({ verified: true })),
  }
  return { options, info, log, cdp }
}

describe('shared observed Mac launch', () => {
  it('binds a visible ordinary window and READY log to the actual process and expected workspace', async () => {
    const f = observedLaunch()
    const observed = await observeMacWindow(f.options)
    expect(observed.child.pid).toBe(42)
    expect(observed.record.appInfo).toBe(f.info)
    expect(observed.record.package).toEqual({ verified: true })
    expect(f.options.onChild.mock.invocationCallOrder[0]).toBeLessThan(
      f.cdp.evaluate.mock.invocationCallOrder[0],
    )
    expect(f.options.attempts[0].page.id).toBe('fixture-page')
  })
  for (const wrong of [
    'dirty',
    'path',
    'source',
    'conversation-count',
    'port-binding',
    'failed-start',
    'bundle',
  ])
    it(`refuses ${wrong} and retains the owned child for cleanup`, async () => {
      const f = observedLaunch()
      if (wrong === 'bundle') f.options.verifyBundle.mockRejectedValue(new Error('bundle differs'))
      if (wrong === 'dirty') f.info.build.dirty = true
      if (wrong === 'path') f.info.workspace.path = '/other/workspace'
      if (wrong === 'source') f.info.build.commit = 'b'.repeat(40)
      if (wrong === 'conversation-count') f.info.db.providerSessionCount = 0
      if (wrong === 'port-binding') f.options.run.mockResolvedValue('*:9339')
      if (wrong === 'failed-start') writeFileSync(f.log, `${FAIL_LINE}\n${READY_LINE}`)
      await expect(observeMacWindow(f.options)).rejects.toThrow()
      expect(f.options.onChild).toHaveBeenCalledOnce()
    })
})

describe('shared owned Mac shutdown', () => {
  for (const reused of [false, true])
    it(`records normal shutdown only after the same owned child exits (reused=${reused})`, async () => {
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
      const child = {
        pid: 42,
        port: 9339,
        started: 'owned birth',
        command:
          '/Applications/BroCrew.app/Contents/MacOS/BroCrew --remote-debugging-port=9339 --remote-debugging-address=127.0.0.1',
        browser: { close: vi.fn() },
      }
      const current = { ...child, started: reused ? 'other birth' : child.started }
      const info = vi.fn().mockResolvedValueOnce(current).mockResolvedValue(null)
      const report = vi.fn()
      if (reused) {
        await expect(
          quitMacChild(child, '/Applications/BroCrew.app', info, report),
        ).rejects.toThrow()
        expect(kill).not.toHaveBeenCalled()
        expect(report).not.toHaveBeenCalled()
        expect(child.browser.close).not.toHaveBeenCalled()
      } else {
        expect(await quitMacChild(child, '/Applications/BroCrew.app', info, report)).toBeNull()
        expect(kill).toHaveBeenCalledExactlyOnceWith(42, 'SIGTERM')
        expect(info).toHaveBeenCalledTimes(2)
        expect(child.browser.close).toHaveBeenCalledOnce()
        expect(report).toHaveBeenCalledExactlyOnceWith('verified-child-quit', {
          pid: 42,
          signal: 'SIGTERM',
        })
        expect(report.mock.invocationCallOrder[0]).toBeGreaterThan(info.mock.invocationCallOrder[1])
      }
    })
})

function deadlineChild(pid, { ownershipDelay = 0, exitAt = Infinity } = {}) {
  const child = {
    pid,
    port: 9339,
    started: `owned birth ${pid}`,
    command:
      '/Applications/BroCrew.app/Contents/MacOS/BroCrew --remote-debugging-port=9339 --remote-debugging-address=127.0.0.1',
    browser: { close: vi.fn() },
  }
  let first = true
  const info = vi.fn(async () => {
    if (first) {
      first = false
      if (ownershipDelay) await new Promise((resolve) => setTimeout(resolve, ownershipDelay))
      return child
    }
    return Date.now() < exitAt ? child : null
  })
  return { child, info, report: vi.fn() }
}

describe('shared owned Mac shutdown deadline', () => {
  it('preserves the legacy sixty-second wait after ownership verification when no deadline is supplied', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const signalTimes = []
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      signalTimes.push(Date.now())
      return true
    })
    const f = deadlineChild(42, { ownershipDelay: 20_000, exitAt: 79_750 })
    const closed = quitMacChild(f.child, '/Applications/BroCrew.app', f.info, f.report)
    await vi.advanceTimersByTimeAsync(79_750)
    expect(await closed).toBeNull()
    expect(signalTimes).toEqual([20_000])
    expect(kill).toHaveBeenCalledExactlyOnceWith(42, 'SIGTERM')
    expect(f.child.browser.close).toHaveBeenCalledOnce()
    expect(f.report).toHaveBeenCalledExactlyOnceWith('verified-child-quit', {
      pid: 42,
      signal: 'SIGTERM',
    })
  })

  it('shares one absolute deadline across successive quits and delayed natural all-app absence', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const first = deadlineChild(42, { ownershipDelay: 20_000, exitAt: 25_000 })
    const second = deadlineChild(43, { exitAt: 40_000 })
    const deadline = Date.now() + 60_000
    const observations = []
    const closed = (async () => {
      await quitMacChild(first.child, '/Applications/BroCrew.app', first.info, first.report, {
        deadline,
      })
      observations.push(Date.now())
      await quitMacChild(second.child, '/Applications/BroCrew.app', second.info, second.report, {
        deadline,
      })
      observations.push(Date.now())
      await waitFor(
        () => Date.now() >= 55_000,
        'all matching app processes absent naturally',
        Math.max(0, deadline - Date.now()),
      )
      observations.push(Date.now())
    })()
    await vi.advanceTimersByTimeAsync(60_000)
    await closed
    expect(observations).toEqual([25_000, 40_000, 55_000])
    expect(kill.mock.calls).toEqual([
      [42, 'SIGTERM'],
      [43, 'SIGTERM'],
    ])
    expect(first.report).toHaveBeenCalledOnce()
    expect(second.report).toHaveBeenCalledOnce()
  })

  it('does not renew the deadline for a surviving second child', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const first = deadlineChild(42, { exitAt: 25_000 })
    const second = deadlineChild(43)
    const deadline = Date.now() + 60_000
    const outcome = (async () => {
      await quitMacChild(first.child, '/Applications/BroCrew.app', first.info, first.report, {
        deadline,
      })
      await quitMacChild(second.child, '/Applications/BroCrew.app', second.info, second.report, {
        deadline,
      })
    })().then(
      () => ({ success: true }),
      (error) => ({ error, at: Date.now() }),
    )
    await vi.advanceTimersByTimeAsync(90_000)
    const failed = await outcome
    expect(failed.at).toBe(60_000)
    expect(failed.error.message).toBe('Timed out: verified test child graceful quit')
    expect(second.child.browser.close).not.toHaveBeenCalled()
    expect(second.report).not.toHaveBeenCalled()
    expect(kill.mock.calls).toEqual([
      [42, 'SIGTERM'],
      [43, 'SIGTERM'],
    ])
  })

  it('does not renew an exhausted deadline or report a surviving child as quit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const f = deadlineChild(42)
    const outcome = quitMacChild(f.child, '/Applications/BroCrew.app', f.info, f.report, {
      deadline: 1_000,
    }).then(
      () => ({ success: true }),
      (error) => ({ error, at: Date.now() }),
    )
    await vi.advanceTimersByTimeAsync(60_000)
    const failed = await outcome
    expect(failed.at).toBe(1_000)
    expect(failed.error.message).toBe('Timed out: verified test child graceful quit')
    expect(kill).toHaveBeenCalledExactlyOnceWith(42, 'SIGTERM')
    expect(f.child.browser.close).not.toHaveBeenCalled()
    expect(f.report).not.toHaveBeenCalled()
  })

  it('never enlarges the existing graceful wait for a distant explicit deadline', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const f = deadlineChild(42)
    const outcome = quitMacChild(f.child, '/Applications/BroCrew.app', f.info, f.report, {
      deadline: 600_000,
    }).then(
      () => ({ success: true }),
      (error) => ({ error, at: Date.now() }),
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await outcome).at).toBe(60_000)
    expect(kill).toHaveBeenCalledExactlyOnceWith(42, 'SIGTERM')
    expect(f.report).not.toHaveBeenCalled()
  })

  it('refuses a nonfinite deadline before signalling the owned child', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const f = deadlineChild(42)
    const outcome = quitMacChild(f.child, '/Applications/BroCrew.app', f.info, f.report, {
      deadline: NaN,
    }).then(
      () => ({ success: true }),
      (error) => ({ error, at: Date.now() }),
    )
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await outcome).error.message).toBe('Graceful quit deadline must be finite.')
    expect(kill).not.toHaveBeenCalled()
    expect(f.child.browser.close).not.toHaveBeenCalled()
    expect(f.report).not.toHaveBeenCalled()
  })

  it('retains owned-process identity refusal with an explicit deadline', async () => {
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const f = deadlineChild(42)
    f.info.mockResolvedValue({ ...f.child, started: 'reused birth' })
    await expect(
      quitMacChild(f.child, '/Applications/BroCrew.app', f.info, f.report, {
        deadline: Date.now() + 60_000,
      }),
    ).rejects.toThrow('Refusing to signal')
    expect(kill).not.toHaveBeenCalled()
    expect(f.child.browser.close).not.toHaveBeenCalled()
    expect(f.report).not.toHaveBeenCalled()
  })
})

describe('entrypoint native-prefix bindings', () => {
  for (const entrypoint of ['mac-update-test.mjs', 'mac-signed-upgrade.mjs'])
    it(`${entrypoint} passes its actual workspace to every native-byte check`, async () => {
      const source = ts.createSourceFile(
        entrypoint,
        readFileSync(new URL(`../${entrypoint}`, import.meta.url), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.JS,
      )
      const calls = []
      const visit = (node) => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'checkNativePrefixes'
        )
          calls.push(node.getText(source))
        ts.forEachChild(node, visit)
      }
      visit(source)
      expect(calls).toHaveLength(2)
      const data = folder(),
        sessions = join(data, 'sessions')
      mkdirSync(sessions)
      const file = join(sessions, 'actual-prefix.jsonl')
      writeFileSync(file, 'original native bytes\n')
      const before = await nativeFiles(sessions, data)
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
      const execute = (call) =>
        new AsyncFunction(
          'checkNativePrefixes',
          'data',
          'nativeBeforeButtons',
          'natives',
          'workspace',
          'baseline',
          `await ${call}`,
        )(
          checkNativePrefixes,
          data,
          before,
          before,
          { nativeBeforeButtons: before },
          { natives: before },
        )
      writeFileSync(file, 'original native bytes\ncontinued\n')
      for (const call of calls) await expect(execute(call)).resolves.toBeUndefined()
      writeFileSync(file, 'changed native bytes\n')
      for (const call of calls) await expect(execute(call)).rejects.toThrow('lost original bytes')
    })
})
