import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { openUpdates, saveRehearsalCodexKey } from '../lib/update-rehearsal-app.mjs'
import { credentialPreserved } from '../mac-signed-upgrade-contract.mjs'
import {
  databaseSnapshot,
  downloadedImagePath,
  mountedImageOf,
  requireEvidence,
  nativeFiles,
  checkNativePrefixes,
  checkpointIds,
  observeMacWindow,
  quitMacChild,
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

async function keepsFailureEvidence(harness) {
  const source = ts.createSourceFile(
    harness,
    readFileSync(new URL(`../${harness}`, import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const failure = source.statements.find((node) => ts.isTryStatement(node)).catchClause
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  for (const unavailable of [null, 'history', 'model']) {
    const summary = { fixture: { sessionId: 'fictional-session' } }
    const original = new Error('fictional seed timed out')
    const turn = {
      phase: 'turn-sent',
      steps: [{ phase: 'conversation-created', sessionId: 'fictional-session' }],
    }
    const history = {
      entries: [
        { event: { type: 'error', message: 'fixture endpoint refused the request' } },
        { event: { type: 'assistant_message', text: 'fictional provider diagnostic' } },
      ],
      hasOlder: false,
    }
    const model = {
      log: ['POST /v1/responses'],
      requests: [{ responseId: 'fictional-response', completed: false }],
    }
    const files = new Map()
    const cdp = {
      evaluate: vi.fn(async (body) => {
        if (!body.includes('latestHistory')) return { set: true, inUse: true }
        if (unavailable === 'history') throw new Error('history unavailable')
        return new AsyncFunction('window', body)({
          api: {
            runtime: {
              latestHistory: async (input) => {
                expect(input).toEqual({ sessionId: 'fictional-session' })
                return history
              },
            },
          },
        })
      }),
    }
    const run = new AsyncFunction(
      'error',
      'summary',
      'console',
      'process',
      'model',
      'writeFile',
      'join',
      'evidenceRoot',
      'evidence',
      'active',
      'currentWorkspace',
      'run',
      'screenshot',
      'assertOwnedProcess',
      'processInfo',
      'app',
      failure.block.getText(source),
    )
    const exit = {}
    const capture = vi.fn()
    const evidence = harness === 'mac-signed-upgrade.mjs' ? '/evidence/Default' : '/evidence'
    await run(
      original,
      summary,
      { error: vi.fn() },
      exit,
      model,
      async (path, text) => {
        if (unavailable === 'model' && path.endsWith('model-failure.json'))
          throw new Error('model evidence unavailable')
        files.set(path, JSON.parse(text))
      },
      join,
      '/evidence',
      evidence,
      { pid: 42, stage: 'a', cdp },
      { fixture: { turns: [turn] } },
      vi.fn(),
      capture,
      vi.fn(),
      vi.fn(async () => ({ pid: 42 })),
      '/Applications/BroCrew.app',
    )
    expect(summary.success).toBe(false)
    expect(summary.failure).toBe(original.stack)
    expect(exit.exitCode).toBe(1)
    expect(capture).toHaveBeenCalledOnce()
    if (unavailable === 'model')
      expect(summary.modelDiagnosticFailure).toContain('model evidence unavailable')
    else expect(files.get(join('/evidence', 'model-failure.json'))).toEqual(model)
    if (unavailable === 'history')
      expect(summary.historyDiagnosticFailure).toContain('history unavailable')
    else
      expect(files.get(join(evidence, 'a-history-failure.json'))).toEqual({
        stage: 'a',
        sessionId: 'fictional-session',
        ...(harness === 'mac-signed-upgrade.mjs' ? { turn } : {}),
        history,
      })
  }
}

it.each(['mac-signed-upgrade.mjs', 'mac-update-test.mjs'])(
  'keeps error bodies and model receipts for %s when either diagnostic is unavailable',
  keepsFailureEvidence,
)

it('uses Updates and its ordinary Download/mount/Finder path from offered or checking state', async () => {
  const source = ts.createSourceFile(
    'mac-signed-upgrade.mjs',
    readFileSync(new URL('../mac-signed-upgrade.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const guided = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'guidedDownload',
  )
  expect(guided).toBeDefined()
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  const downloads = join(folder(), 'Downloads')
  const image = join(downloads, 'BroCrew-0.2.16-arm64.dmg')
  const mount = '/Volumes/BroCrew 0.2.16-arm64'
  const message =
    'BroCrew 0.2.16 is downloaded and opened. Quit every open copy of BroCrew, then drag the new one into Applications.'
  for (const initiallyOpen of [false, true])
    for (const kind of ['available', 'checking']) {
      let opened = initiallyOpen
      let downloaded = false
      let state = { kind, version: '0.2.16' }
      const updates = {
        checkNow: vi.fn(async () => ({ state })),
        read: vi.fn(async () => {
          if (downloaded)
            return { state: { kind: 'ready', how: 'opened', version: '0.2.16', path: image } }
          const current = state
          state = { kind: 'available', version: '0.2.16' }
          return { state: current }
        }),
      }
      const document = {
        querySelector(selector) {
          if (selector === '[data-cy=updates-said]') return { textContent: message }
          if (selector === '[data-cy=updates-restart]') return null
          expect(['[data-cy=rail-version]', '[data-cy=updates-menu]']).toContain(selector)
          return {
            disabled: false,
            scrollIntoView() {},
            getAttribute: () => String(opened),
            getBoundingClientRect: () => ({
              x: 10,
              y: 20,
              width: selector === '[data-cy=updates-menu]' && !opened ? 0 : 100,
              height: 40,
            }),
          }
        },
      }
      const cdp = {
        evaluate: (body) =>
          new AsyncFunction('document', 'window', body)(document, { api: { updates } }),
        send: vi.fn(async (_method, event) => {
          if (event.type === 'mouseReleased') opened = !opened
        }),
      }
      const click = vi.fn(async (_cdp, selector) => {
        expect(selector).toBe('[data-cy=updates-download]')
        downloaded = true
      })
      const commands = vi.fn(async (program, args) => {
        if (program === '/usr/bin/osascript') return mount + '/'
        expect(['/usr/sbin/screencapture', '/usr/bin/xcrun', '/usr/sbin/spctl']).toContain(program)
        if (program === '/usr/bin/xcrun') expect(args).toEqual(['stapler', 'validate', image])
        return ''
      })
      const plist = vi.fn(async () => ({
        images: [{ 'image-path': image, 'system-entities': [{ 'mount-point': mount }] }],
      }))
      const quarantine = vi.fn()
      const fixture = {
        workspace: { cdp },
        selectWorkspace: vi.fn(),
        openUpdates,
        click,
        waitFor: async (check) => {
          const result = (await check()) || (await check())
          expect(result).toBeTruthy()
          return result
        },
        screenshot: vi.fn(),
        VERSION_B: '0.2.16',
        downloadedImagePath,
        downloads,
        realpath: async (path) => path,
        requireEvidence,
        mountedImageOf,
        plist,
        quarantine,
        run: commands,
        join,
        evidence: folder(),
        summary: {},
        bundleChecked: async () => ({ version: '0.2.16' }),
        transport: { requireHealthy: vi.fn() },
        passed: vi.fn(),
      }
      const run = new AsyncFunction(
        'fixture',
        `const { ${Object.keys(fixture).join(', ')} } = fixture
        let mountedCandidate
        ${guided.getText(source)}
        return await guidedDownload(workspace, {})`,
      )
      expect(await run(fixture)).toBe(join(mount, 'BroCrew.app'))
      expect(click).toHaveBeenCalledOnce()
      expect(plist).toHaveBeenCalledExactlyOnceWith('/usr/bin/hdiutil', ['info', '-plist'])
      expect(quarantine).toHaveBeenCalledExactlyOnceWith(image, 'downloaded-image')
      expect(fixture.summary.download.guided).toBe(message)
      expect(updates.checkNow).toHaveBeenCalledOnce()
      expect(updates.read).toHaveBeenCalledTimes(kind === 'checking' ? 4 : 3)
      expect(cdp.send).toHaveBeenCalledTimes(initiallyOpen ? 0 : 3)
      await openUpdates(cdp)
      expect(cdp.send).toHaveBeenCalledTimes(initiallyOpen ? 0 : 3)
    }
})

it('requires the sealed-key refusal and no model request before saving again and resuming the same conversation', async () => {
  const source = ts.createSourceFile(
    'mac-signed-upgrade.mjs',
    readFileSync(new URL('../mac-signed-upgrade.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const reopen = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'reopenSecond',
  )
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  for (const mode of ['expected', 'usable-key', 'wrong-refusal', 'model-request']) {
    let saved = false
    const reason = 'Saved key can’t be read, save it again in Settings.'
    const rows = [{ provider: 'codex', sealed: 'original-ciphertext' }]
    const model = { requests: [] }
    const runtime = {
      apiKeyStatus: async () => ({
        provider: 'codex',
        set: true,
        inUse: mode === 'usable-key',
        readState: mode === 'usable-key' ? undefined : 'unreadable',
        unreadableReason: reason,
      }),
      resume: vi.fn(async ({ sessionId }) => {
        expect(sessionId).toBe('original-conversation')
        if (mode === 'model-request') model.requests.push({ post: true })
        throw new Error(
          mode === 'wrong-refusal'
            ? 'another refusal'
            : `Error invoking remote method 'runtime:command': Error: ${reason}`,
        )
      }),
      setApiKey: vi.fn(async ({ provider, key }) => {
        expect(provider).toBe('codex')
        expect(key).toBe('sk-update-rehearsal-not-a-real-key')
        saved = true
        return { provider, set: true, inUse: true }
      }),
    }
    const cdp = {
      evaluate: (body) =>
        new AsyncFunction('window', body)({
          api: {
            runtime,
            updates: {
              read: async () => ({
                version: '0.2.17',
                channel: 'stable',
                checkAutomatically: true,
                state: { kind: 'idle', upToDate: true },
              }),
            },
          },
        }),
    }
    const continued = new Error('the original conversation continues after the explicit resave')
    const fixture = {
      workspace: {
        name: 'Default',
        baseline: { before: { provider_api_key: rows } },
        copiesAfterFirst: ['copy'],
        conversations: ['original-conversation', 'second-conversation'],
        result: {},
      },
      selectWorkspace: vi.fn(),
      launch: async () => cdp,
      VERSION_B: '0.2.17',
      recoveryOrder: vi.fn(),
      readFile: vi.fn(),
      join,
      evidence: folder(),
      checkpointIds: async () => ['copy'],
      data: folder(),
      isDeepStrictEqual,
      requireEvidence,
      checkRetention: vi.fn(),
      openUpdates: vi.fn(),
      click: vi.fn(),
      waitFor: async (check) => expect(await check()).toBe(true),
      model,
      credentialPreserved,
      databaseSnapshot: () => ({ provider_api_key: rows }),
      saveRehearsalCodexKey,
      startLocalModelTurn: vi.fn(async (_cdp, _text, options) => {
        expect(saved).toBe(true)
        expect(options.sessionId).toBe('original-conversation')
        throw continued
      }),
    }
    const run = new AsyncFunction(
      'fixture',
      `const { ${Object.keys(fixture).join(', ')} } = fixture
      ${reopen.getText(source)}
      return await reopenSecond(workspace)`,
    )
    if (mode === 'expected') {
      await expect(run(fixture)).rejects.toBe(continued)
      expect(runtime.setApiKey).toHaveBeenCalledOnce()
      expect(fixture.workspace.result.unreadableCredential).toEqual({
        reason,
        refusal: `Error invoking remote method 'runtime:command': Error: ${reason}`,
        modelRequests: 0,
      })
    } else {
      await expect(run(fixture)).rejects.toThrow(
        mode === 'usable-key'
          ? 'plain unreadable state'
          : mode === 'wrong-refusal'
            ? 'exact refusal'
            : 'reached the scripted model',
      )
      expect(runtime.setApiKey).not.toHaveBeenCalled()
      expect(fixture.startLocalModelTurn).not.toHaveBeenCalled()
    }
  }
})
