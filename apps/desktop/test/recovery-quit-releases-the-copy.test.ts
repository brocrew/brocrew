import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import ts from 'typescript'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createAppLifetime } from '../src/main/app-lifetime'
import { CheckpointFailed, makeCheckpoint } from '../src/main/recovery/checkpoint'
import {
  verifyInAWorker,
  type CopyVerifier,
  type VerifyCopy,
} from '../src/main/recovery/copy-check'
import { nodeFs } from '../src/main/recovery/files'
import { bundleAWorker } from './helpers/bundle-a-worker'

const index = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('index.ts', index, ts.ScriptTarget.ESNext, true)
const migrations = fileURLToPath(new URL('../src/main/db/migrations', import.meta.url))
const gate = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
let root: string, bundle: string
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'fictional-recovery-quit-'))
  bundle = await bundleAWorker('src/main/recovery-verify.worker.ts', root, 'check.cjs')
}, 120_000)
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** Run the actual root's quit functions, lifetime wiring and registered before-quit listeners. */
function wire(context: Record<string, unknown>) {
  const wanted = new Set([
    'theVerdictBeforeTheData',
    'quitFromRecovery',
    'endTheProcess',
    'openTheRecoveryWindow',
    'withRecoveryWork',
    'stopRecoveryWork',
  ])
  const functions = parsed.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && wanted.has(node.name?.text ?? ''),
  )
  const lifetime = parsed.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((decl) => decl.name.getText(parsed) === 'lifetime'),
  )!
  const start = parsed.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'start',
  ) as ts.FunctionDeclaration
  const listeners = start.body!.statements.filter(
    (node) =>
      ts.isExpressionStatement(node) &&
      ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(parsed) === 'app.on' &&
      ["'before-quit'", "'window-all-closed'"].includes(
        node.expression.arguments[0]?.getText(parsed) ?? '',
      ),
  )
  const code =
    [...functions, lifetime, ...listeners].map((node) => node.getText(parsed)).join('\n') +
    '\nglobalThis.quitWindow = openTheRecoveryWindow; globalThis.beginInspection = theVerdictBeforeTheData; globalThis.shutdown = () => lifetime.shuttingDown'
  runInNewContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    context,
  )
}

for (const route of [
  'before-quit',
  'recovery window close',
  'last recovery window on Linux',
  'last recovery window on Windows',
] as const) {
  it(`${route} terminates the held verifier and waits for unfinished cleanup before exit`, async () => {
    const folder = mkdtempSync(join(root, 'workspace-'))
    const userData = join(folder, 'data')
    mkdirSync(userData)
    const db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    db.close()
    const order: string[] = [],
      workers: Worker[] = []
    const started = gate(),
      exited = gate(),
      cleaning = gate(),
      clean = gate(),
      shutdown = gate()
    let births = 0
    const verifier = verifyInAWorker((request) => {
      births++
      const worker = new Worker(bundle, { workerData: request })
      workers.push(worker)
      worker.once('online', started.resolve)
      worker.once('exit', () => {
        order.push('worker exit')
        exited.resolve()
      })
      return worker
    }, 10_000)
    const verify: VerifyCopy = typeof verifier === 'function' ? verifier : verifier.verify
    let checking: Promise<unknown> | undefined
    const listeners = new Map<string, ((event: { preventDefault(): void }) => void)[]>()
    let closeWindow!: () => void
    const context: Record<string, unknown> = {
      recoveryCopyVerifier: verifier,
      recoveryCopyHasher: { stop: async () => undefined },
      recoveryCaptureAbort: new AbortController(),
      recoveryWork: new Set(),
      stoppingRecoveryWork: null,
      createAppLifetime,
      recoveryService: null,
      recoveryCalls: null,
      recoveryWindow: null,
      checkingTheData: false,
      closedWhileCheckingSaid: false,
      workingTimer: null,
      workingOnNow: null,
      thisBuildsMigrations: null,
      resolveMigrationsFolder: () => migrations,
      buildLineage: async () => [],
      workspaceStartup: () => null,
      clearTimeout,
      presentation: { hidden: true },
      openRecoveryWindow: (options: { onClosed(): void }) => {
        closeWindow = options.onClosed
        return {}
      },
      shell: {},
      sayClosedWhileChecking: () => {
        context.closedWhileCheckingSaid = true
      },
      theRecoveryService: () => ({
        inspect: () => {
          checking = makeCheckpoint({
            userData,
            ownership: 'sole',
            appVersion: '1.0.0',
            build: null,
            reason: 'first-start-of-release',
            verifyCopy: verify,
            log: () => {},
            fs: {
              ...nodeFs,
              unlink: async (file) => {
                if (file.endsWith('database.sqlite')) {
                  order.push('cleanup entered')
                  cleaning.resolve()
                  await clean.promise
                }
                await nodeFs.unlink(file)
              },
            },
          }).then(
            () => ({ kind: 'open' }),
            (error: unknown) => {
              expect(error).toBeInstanceOf(CheckpointFailed)
              order.push('cleanup done')
              return { kind: 'failed' }
            },
          )
          return checking
        },
      }),
      host: null,
      db: null,
      stoppingTheStart: null,
      themes: null,
      updates: null,
      transcriptRetention: undefined,
      stopProviderSetup: undefined,
      stopThemeIpc: undefined,
      stopStorageIpc: undefined,
      stopVoiceIpc: undefined,
      dockLabel: undefined,
      theStallSink: undefined,
      pluginController: { close: async () => {} },
      pluginSupervisor: { quit: async () => {} },
      BrowserWindow: { getAllWindows: () => [] },
      theLastDraftSaves: async () => {},
      armLastResortExit: () => {},
      spawn: () => {},
      process: {
        pid: 0,
        execPath: '',
        env: {},
        platform: route.endsWith('Windows') ? 'win32' : 'linux',
      },
      theDataOpened: false,
      startFailed: false,
      sayAtOnce: () => {},
      inspect: () => '',
      Buffer,
      writeSync: () => {},
      STDERR_FD: 2,
      console: { error: () => {} },
      app: {
        on: (event: string, listener: (event: { preventDefault(): void }) => void) => {
          const list = listeners.get(event) ?? []
          list.push(listener)
          listeners.set(event, list)
        },
        exit: () => {
          order.push('process exit')
          shutdown.resolve()
        },
        quit: () => {
          for (const listener of listeners.get('before-quit') ?? [])
            listener({ preventDefault() {} })
        },
      },
    }
    wire(context)
    const inspecting = (context.beginInspection as () => Promise<unknown>)()
    try {
      await started.promise
      if (route === 'before-quit') {
        for (const listener of listeners.get('before-quit') ?? []) listener({ preventDefault() {} })
      } else {
        ;(context.quitWindow as () => void)()
        closeWindow()
        if (route.startsWith('last recovery window')) {
          for (const listener of listeners.get('window-all-closed') ?? [])
            listener({ preventDefault() {} })
        }
      }
      // An ordinary completion is ten seconds away. This observes a real termination, then holds
      // the actual filesystem cleanup so worker exit alone cannot satisfy either quit route.
      await Promise.race([
        exited.promise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('quit did not terminate its verifier')), 2_000),
        ),
      ])
      await cleaning.promise
      expect(order).not.toContain('process exit')
      expect((await verify(join(userData, 'brobot2.sqlite'))).kind).toBe('failed')
      expect(births).toBe(1)
      clean.resolve()
      await shutdown.promise
      await inspecting
      expect(order).toEqual(['worker exit', 'cleanup entered', 'cleanup done', 'process exit'])
      expect(readdirSync(join(userData, 'backups'))).toEqual(['workspace-id'])
    } finally {
      clean.resolve()
      await Promise.all(workers.map((worker) => worker.terminate()))
      await checking
      await inspecting
      await (context.shutdown as () => Promise<void> | null)()
      await (verifier as CopyVerifier).stop?.()
    }
  })
}
