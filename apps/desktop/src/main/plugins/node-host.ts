import { z } from 'zod'
import Database from 'better-sqlite3'
import { pluginNodePolicy } from './node-policy'
export { pluginNodePolicy } from './node-policy'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { join, dirname, isAbsolute, normalize } from 'node:path'
import { chmod, rm } from 'node:fs/promises'
import { verifiedPluginDigest, type VerifiedPluginPackage } from './package-verifier'
import {
  immutableFile,
  verifyImmutableFile,
  publishPrivateDirectory,
  privateChild,
  privateRoot,
  PluginHostError,
  removePrivateCode,
} from './node-host-files'
import { runtimeFiles, type PluginNodeRuntime } from './node-runtime'
import { launchPluginProcess, type PluginHostRequestHandler } from './process-runner'
import { sharedDataEnvironment, type SharedDataOwner } from './shared-data'
import {
  endWindowsTree,
  stopGroups,
  readPriorityClamped,
} from '../../../resources/plugin-host/process-groups.mjs'
import { writeReceipt } from '../../../resources/plugin-host/receipts.mjs'

export interface PluginNodeStart {
  package: VerifiedPluginPackage
  releaseDigest: string
  previousVersion?: string
  previousDataSchema?: number
  legacyConfiguration?: { directory: string; floor: string }
}
export interface PluginNodeExit {
  exited: boolean
}
export interface PluginNodeReady {
  readonly serverPid: number
  readonly origin: string
  /** Retained duplex MCP connection for a generic package; stays in the owner process. */
  readonly client?: Client
  /** Diagnostic snapshot of this authenticated owned server; never admission evidence. */
  readonly priorityClamped?: boolean | null
  /** These capabilities stay with the supervisor/broker; JSON contains no credential. */
  hooks?(): { url: string; headers: { Authorization: string } }
  mcp(): { url: string; headers: { Authorization: string } }
  admin(): { url: string; headers: { Authorization: string } }
}
export interface PluginNodeProcess {
  readonly runId: string
  readonly receiptPath: string
  ready(): Promise<PluginNodeReady>
  stop(): Promise<PluginNodeExit>
  readonly exited: Promise<PluginNodeExit>
}
interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: Error) => void
}
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'], reject!: Deferred<T>['reject']
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  void promise.catch(() => {})
  return { promise, resolve, reject }
}
function withMcpClient<T extends object>(
  connection: T,
  client?: Client,
): Readonly<T & { client?: Client }> {
  return Object.freeze(Object.defineProperty(connection, 'client', { value: client }))
}
async function authenticatedHealth(origin: string, mcp: string, mcpPath: string): Promise<Client> {
  const client = new Client({ name: 'brocrew-plugin-host', version: '1' }, { capabilities: {} })
  client.onerror = () => {}
  const transport = new StreamableHTTPClientTransport(new URL(origin + mcpPath), {
    requestInit: { headers: { Authorization: `Bearer ${mcp}` } },
  })
  try {
    await client.connect(transport)
    return client
  } catch (error) {
    await client.close().catch(() => {})
    throw error
  }
}

/** Dedicated hook credential and fixed route; no MCP or person-admin surface is fabricated. */
export async function authenticatedHookHealth(options: {
  origin: string
  hookToken: string
  otherTokens: readonly string[]
  version: string
  fetch?: typeof fetch
}): Promise<void> {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(options.origin))
    throw new PluginHostError('ready')
  const signal = AbortSignal.timeout(1500)
  for (const token of ['', 'invalid', ...options.otherTokens, options.hookToken]) {
    const response = await (options.fetch ?? fetch)(options.origin + '/v1/hooks/healthz', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal,
      redirect: 'manual',
    })
    const success = token === options.hookToken
    if (response.status !== (success ? 200 : 401)) {
      await response.body?.cancel()
      throw new PluginHostError('ready')
    }
    if (!success) {
      await response.body?.cancel()
      continue
    }
    const reader = response.body?.getReader()
    if (!reader) throw new PluginHostError('ready')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        length += part.value.byteLength
        if (length > 4096) throw new PluginHostError('ready')
        chunks.push(part.value)
      }
      z.strictObject({
        ok: z.literal(true),
        version: z.literal(options.version),
        hookProtocol: z.literal(1),
      }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    } finally {
      await reader.cancel()
    }
  }
}

/** The longest a Windows job keeper may take to open: its first start compiles the job code. */
const KEEPER_OPEN_MS = 130_000

/** One explicitly rooted host, called by the supervisor; it never discovers live app data. */
export function createPluginNodeHost(options: {
  root: string
  runtime: PluginNodeRuntime
  browserExecutable?: string
  readyMs?: number
  sharedDataOwner?: SharedDataOwner
  hostRequest?: PluginHostRequestHandler
}) {
  options = Object.freeze({
    ...options,
    sharedDataOwner: options.sharedDataOwner ? structuredClone(options.sharedDataOwner) : undefined,
  })
  let closing = false
  const starts = new Map<string, Promise<PluginNodeProcess>>()
  const definitions = new Map<string, PluginNodeStart>()
  const retiring = new Set<string>()
  const readyMs = options.readyMs ?? 15000
  if (
    !Number.isFinite(readyMs) ||
    readyMs < 0 ||
    (options.browserExecutable && !isAbsolute(options.browserExecutable))
  )
    throw new PluginHostError('start')

  async function launch(spec: PluginNodeStart): Promise<PluginNodeProcess> {
    const manifest = spec.package.manifest
    const hosted = pluginNodePolicy(spec.package)
    if (
      !spec.package.compatibility.host ||
      verifiedPluginDigest(spec.package) !== spec.releaseDigest ||
      !/^[a-f0-9]{64}$/.test(spec.releaseDigest) ||
      !manifest.platforms.some(
        (target) => target.os === process.platform && target.cpu === process.arch,
      )
    )
      throw new PluginHostError('package')
    const runtime = await runtimeFiles(options.runtime)
    const root = await privateRoot(options.root)
    const sharedEnvironment = await sharedDataEnvironment(
      spec.package,
      root,
      options.sharedDataOwner,
    )
    const home = await privateChild(root, `data/${manifest.id}`)
    for (const dir of ['downloads', 'files', 'tmp']) await privateChild(home, dir)
    const windows = process.platform === 'win32'
    if (windows)
      for (const dir of ['AppData/Roaming', 'AppData/Local']) await privateChild(home, dir)
    const packages = await privateChild(root, 'packages')
    const executable = (path: string) =>
      spec.package.isExecutable?.(path) === true ||
      (manifest.format === 3 &&
        manifest.runtime.kind === 'process' &&
        normalize(manifest.runtime.command) === normalize(path))
    const release = await publishPrivateDirectory(
      packages,
      spec.releaseDigest,
      async (stage) => {
        for (const file of manifest.files) {
          const bytes = spec.package.readFile(file.path)
          if (!bytes) throw new PluginHostError('package')
          const parent = dirname(file.path)
          if (parent !== '.') await privateChild(stage, parent)
          await immutableFile(join(stage, file.path), bytes, executable(file.path))
        }
      },
      async (directory) => {
        for (const file of manifest.files) {
          const bytes = spec.package.readFile(file.path)
          if (!bytes) throw new PluginHostError('package')
          const parent = dirname(file.path)
          if (parent !== '.') await privateChild(directory, parent, false)
          const path = join(directory, file.path)
          await verifyImmutableFile(path, bytes)
          // Repair older cached modes only after the selected file bytes still match.
          if (!windows && executable(file.path)) await chmod(path, 0o500)
        }
      },
    )
    const runId = randomUUID()
    const slot = join(await privateChild(root, 'process-slots'), `${manifest.id}.sqlite`)
    const run = await privateChild(root, `runs/${runId}`)
    if (manifest.format === 3) {
      if (closing) throw new PluginHostError('start')
      const declaration = manifest.runtime
      const declared = declaration.kind === 'node' ? declaration.entry : declaration.command
      const entry = isAbsolute(declared)
        ? declared
        : manifest.files.some((file) => normalize(file.path) === normalize(declared))
          ? join(release, declared)
          : declared
      const command = declaration.kind === 'node' ? runtime.node : entry
      const args =
        declaration.kind === 'node'
          ? [entry, ...(declaration.args ?? [])]
          : (declaration.args ?? [])
      const bootstrap = {
        api: 1,
        pluginId: manifest.id,
        instanceId: runId,
        dataDirectory: home,
        sharedDataDirectory: sharedEnvironment.BROCREW_PLUGIN_SHARED,
        previousVersion: spec.previousVersion,
        previousDataSchema: spec.previousDataSchema,
        legacyConfiguration: spec.legacyConfiguration,
        priorOwner: options.sharedDataOwner
          ? {
              ownerId: options.sharedDataOwner.ownerId,
              ownerLabel: options.sharedDataOwner.ownerLabel,
            }
          : undefined,
        dataSchema: manifest.data.schema,
        host: { api: 1, method: 'brocrew/host' },
      }
      const processRun = launchPluginProcess({
        pluginId: manifest.id,
        runId,
        node: runtime.node,
        guardian: join(dirname(runtime.guardian), 'process-guardian.mjs'),
        slot,
        keeperCache: windows ? await privateChild(root, 'keeper') : undefined,
        command,
        args,
        cwd: home,
        env: {
          ...process.env,
          ...sharedEnvironment,
          BROCREW_PLUGIN_DATA: home,
          BROCREW_PLUGIN_RUN_ID: runId,
          BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify(bootstrap),
        },
        mcp: manifest.mcp,
        stop: manifest.lifecycle.stop,
        readyMs,
        hostRequest: options.hostRequest,
      })
      const generation = starts.get(manifest.id)
      void processRun.exited
        .then((result) => {
          if (result.exited && starts.get(manifest.id) === generation) starts.delete(manifest.id)
          writeReceipt(run, 'exit.json', {
            format: 1,
            runId,
            pluginId: manifest.id,
            releaseDigest: spec.releaseDigest,
            ...result,
          })
        })
        .catch(() => {})
      return Object.freeze({
        runId,
        receiptPath: join(run, 'exit.json'),
        ready: async () => {
          const ready = await processRun.ready()
          return withMcpClient(
            {
              serverPid: ready.serverPid,
              origin: ready.origin,
              mcp(): never {
                throw new PluginHostError('ready')
              },
              admin(): never {
                throw new PluginHostError('ready')
              },
            },
            ready.client,
          )
        },
        stop: processRun.stop,
        exited: processRun.exited,
      })
    }
    if (!('entry' in hosted) || !runtime) throw new PluginHostError('package')
    let windowsJob
    if (windows) {
      const nonce = randomUUID()
      windowsJob = {
        format: 1,
        runId,
        pluginId: manifest.id,
        releaseDigest: spec.releaseDigest,
        nonce,
        name: `Local\\BroCrew.Plugin.${nonce}`,
      }
      await immutableFile(
        join(run, 'job-reservation.json'),
        Buffer.from(JSON.stringify(windowsJob)),
      )
    }
    const mcpToken = randomBytes(32).toString('hex'),
      adminToken = randomBytes(32).toString('hex'),
      hookToken = randomBytes(32).toString('hex')
    await immutableFile(
      join(run, 'auth.json'),
      Buffer.from(
        JSON.stringify(hosted.transport === 'hooks' ? { hookToken } : { mcpToken, adminToken }),
      ),
    )
    await immutableFile(
      join(run, 'launch.json'),
      Buffer.from(
        JSON.stringify({
          entry: join(release, hosted.entry),
          home,
          runId,
          pluginId: manifest.id,
          releaseDigest: spec.releaseDigest,
          ...(windowsJob ? { windowsJob } : {}),
          ...(windows ? { keeperCache: await privateChild(root, 'keeper') } : {}),
          runtimeSlot: slot,
        }),
      ),
    )
    if (closing) {
      await rm(run, { recursive: true })
      throw new PluginHostError('start')
    }
    const forkedAt = Date.now()
    let guardianEndedAt = 0
    const child: ChildProcess = fork(runtime.guardian, [join(run, 'launch.json')], {
      execPath: runtime.node,
      execArgv: [],
      cwd: home,
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: {
        ...process.env,
        BROCREW_PLUGIN_DATA: home,
        BROCREW_PLUGIN_RUN_ID: runId,
        ...sharedEnvironment,
        [`BROCREW_${hosted.env}_DATA`]: home,
        [`BROCREW_${hosted.env}_AUTH`]: join(run, 'auth.json'),
        [`BROCREW_${hosted.env}_PORT`]: '0',
        ...(options.browserExecutable
          ? { [`BROCREW_${hosted.env}_EXECUTABLE`]: options.browserExecutable }
          : {}),
      },
    })
    const ready = deferred<PluginNodeReady>(),
      exited = deferred<PluginNodeExit>()
    const groups = new Map<number, string>()
    let mcpClient: Client | undefined
    let stopped = false,
      unsupported = false,
      proof = false,
      checking = false,
      stopPromise: Promise<PluginNodeExit> | undefined
    const stop = (): Promise<PluginNodeExit> => {
      if (stopPromise) return stopPromise
      stopped = true
      ready.reject(new PluginHostError('ready'))
      void mcpClient?.close().catch(() => {})
      if (child.connected)
        child.send({ channel: 'brocrew-plugin-node:v1', runId, type: 'stop' }, () => {})
      const cap = setTimeout(() => {
        child.kill('SIGTERM')
      }, 10000)
      cap.unref()
      stopPromise = Promise.race([
        exited.promise,
        new Promise<PluginNodeExit>((resolve) => {
          const timeout = setTimeout(() => resolve({ exited: false }), 15000)
          timeout.unref()
          void exited.promise.then(() => clearTimeout(timeout))
        }),
      ]).finally(() => clearTimeout(cap))
      return stopPromise
    }
    // On Windows readiness is timed from the job keeper's open, whose first start compiles code.
    const readyTimer = (ms: number) => {
      const one = setTimeout(() => {
        void stop()
      }, ms)
      one.unref()
      return one
    }
    let timer = readyTimer(windows ? KEEPER_OPEN_MS : readyMs)
    child.on('message', (input: unknown) => {
      const value = input as {
        channel?: unknown
        runId?: unknown
        type?: unknown
        pid?: unknown
        birth?: unknown
        port?: unknown
        serverPid?: unknown
        exited?: unknown
        priorityClamped?: unknown
      }
      if (
        !value ||
        typeof value !== 'object' ||
        value.channel !== 'brocrew-plugin-node:v1' ||
        value.runId !== runId
      )
        return
      if (
        value.type === 'group' &&
        Number.isSafeInteger(value.pid) &&
        Number(value.pid) > 1 &&
        typeof value.birth === 'string' &&
        value.birth.length < 128
      ) {
        groups.set(Number(value.pid), value.birth as string)
        if (!stopped && child.connected)
          child.send(
            {
              channel: 'brocrew-plugin-node:v1',
              runId,
              type: 'admit',
              pid: value.pid,
              birth: value.birth,
            },
            () => {},
          )
      } else if (value.type === 'group-gone' && groups.get(Number(value.pid)) === value.birth)
        groups.delete(Number(value.pid))
      else if (value.type === 'stopped') proof = value.exited === true
      else if (value.type === 'unsupported') unsupported = true
      else if (windows && value.type === 'job' && !stopped) {
        clearTimeout(timer)
        timer = readyTimer(readyMs)
      } else if (
        !stopped &&
        !checking &&
        value.type === 'listening' &&
        Number.isInteger(value.port) &&
        Number(value.port) > 0 &&
        Number(value.port) <= 65535 &&
        Number.isSafeInteger(value.serverPid) &&
        groups.has(Number(value.serverPid))
      ) {
        checking = true
        const origin = `http://127.0.0.1:${value.port}`
        // The server has loaded both capabilities before announcing its listener.
        // Retain them only in this host's closures, never on disk for its lifetime.
        void rm(join(run, 'auth.json'), { force: true })
          .then(async (): Promise<Client | undefined> => {
            if (stopped) throw new PluginHostError('ready')
            if (hosted.transport === 'hooks') {
              await authenticatedHookHealth({
                origin,
                hookToken,
                otherTokens: [mcpToken, adminToken],
                version: manifest.version,
              })
              return undefined
            }
            return authenticatedHealth(origin, mcpToken, manifest.server!.mcpPath)
          })
          .then((client) => {
            mcpClient = client || undefined
            if (stopped) {
              void mcpClient?.close().catch(() => {})
              return
            }
            clearTimeout(timer)
            const current = () => {
              if (stopped) throw new PluginHostError('ready')
            }
            ready.resolve(
              withMcpClient(
                {
                  serverPid: Number(value.serverPid),
                  origin,
                  // On Windows the guardian reads it from the job, which also holds the browser.
                  priorityClamped: windows
                    ? typeof value.priorityClamped === 'boolean'
                      ? value.priorityClamped
                      : null
                    : readPriorityClamped(Number(value.serverPid)),
                  ...(hosted.transport === 'hooks'
                    ? {
                        hooks() {
                          current()
                          return {
                            url: origin + '/v1/hooks',
                            headers: { Authorization: `Bearer ${hookToken}` },
                          }
                        },
                      }
                    : {}),
                  mcp() {
                    current()
                    if (!manifest.server) throw new PluginHostError('ready')
                    return {
                      url: origin + manifest.server!.mcpPath,
                      headers: { Authorization: `Bearer ${mcpToken}` },
                    }
                  },
                  admin() {
                    current()
                    if (!manifest.server) throw new PluginHostError('ready')
                    return {
                      url: origin + manifest.server!.adminPath,
                      headers: { Authorization: `Bearer ${adminToken}` },
                    }
                  },
                },
                mcpClient,
              ),
            )
          })
          .catch(() => {
            void stop()
          })
      }
    })
    let finished = false
    const finish = async () => {
      if (finished) return
      finished = true
      stopped = true
      void mcpClient?.close().catch(() => {})
      clearTimeout(timer)
      ready.reject(new PluginHostError(unsupported ? 'unsupported' : 'ready'))
      // A guardian crash is not an exit receipt; independently clean the groups already admitted.
      // On Windows that is the guardian's whole tree, its job keeper and the server's children
      // included: only a reading that finds none of it running is proof.
      const clean =
        proof ||
        (windows
          ? typeof child.pid === 'number' &&
            (await endWindowsTree(child.pid, forkedAt, guardianEndedAt || Date.now()))
          : groups.size > 0 && (await stopGroups(groups)))
      await Promise.all(
        ['auth.json', 'launch.json'].map((name) =>
          rm(join(run, name), { force: true }).catch(() => {}),
        ),
      )
      if (!proof) {
        try {
          writeReceipt(run, 'exit.json', {
            format: 1,
            runId,
            pluginId: manifest.id,
            releaseDigest: spec.releaseDigest,
            guardianPid: child.pid,
            writerPid: process.pid,
            groups: [...groups],
            exited: clean,
          })
        } catch {
          /* Missing durable evidence fences later takeover. */
        }
      }
      if (clean) starts.delete(manifest.id)
      exited.resolve({ exited: clean })
    }
    child.once('error', () => {
      void finish()
    })
    child.once('close', () => {
      guardianEndedAt = Date.now()
      void finish()
    })
    return Object.freeze({
      runId,
      receiptPath: join(run, 'exit.json'),
      ready: () => ready.promise,
      stop,
      exited: exited.promise,
    })
  }
  function start(spec: PluginNodeStart): Promise<PluginNodeProcess> {
    const id = spec.package.manifest.id
    if (closing || starts.has(id) || retiring.has(id))
      return Promise.reject(new PluginHostError('start'))
    const captured = { ...spec }
    const promise = launch(captured)
      .then((run) => {
        definitions.set(id, captured)
        return run
      })
      .catch((error: unknown) => {
        throw error instanceof PluginHostError ? error : new PluginHostError('start')
      })
    starts.set(id, promise)
    void promise.catch(() => {
      if (starts.get(id) === promise) starts.delete(id)
    })
    return promise
  }
  async function stopPlugin(id: string): Promise<PluginNodeExit> {
    const pending = starts.get(id)
    return pending ? (await pending).stop() : { exited: true }
  }
  async function retire(id: string, remove: (root: string) => Promise<void>): Promise<void> {
    if (starts.has(id) || retiring.has(id)) throw new PluginHostError('cleanup')
    retiring.add(id)
    let database: Database.Database | undefined
    try {
      const root = await privateRoot(options.root)
      const slots = await privateChild(root, 'process-slots')
      database = new Database(join(slots, `${id}.sqlite`), { timeout: 0 })
      for (;;) {
        try {
          database.exec('BEGIN EXCLUSIVE')
          break
        } catch (error) {
          if ((error as { code?: string }).code !== 'SQLITE_BUSY') throw error
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
      }
      // The same mutex stays held by an older guardian until its managed process stops.
      await remove(root)
    } finally {
      database?.close()
      retiring.delete(id)
    }
  }
  return {
    stopPlugin,
    async restart(input: string | PluginNodeStart): Promise<PluginNodeProcess> {
      const spec = typeof input === 'string' ? definitions.get(input) : input
      if (!spec) throw new PluginHostError('start')
      if (!(await stopPlugin(spec.package.manifest.id)).exited) throw new PluginHostError('cleanup')
      return start(spec)
    },
    async removePackage(id: string, releaseDigest: string): Promise<void> {
      await retire(id, async (root) => {
        const packages = await privateChild(root, 'packages')
        await removePrivateCode(packages, releaseDigest)
        if (definitions.get(id)?.releaseDigest === releaseDigest) definitions.delete(id)
      })
    },
    /** Deletes only private data after the managed runtime releases its lifetime mutex. */
    async removeData(id: string): Promise<void> {
      await retire(id, (root) => rm(join(root, 'data', id), { recursive: true, force: true }))
    },
    start,
    async stop(): Promise<PluginNodeExit> {
      closing = true
      const results = await Promise.allSettled(
        [...starts.values()].map(async (value) => (await value).stop()),
      )
      return {
        exited: results.every((result) => result.status === 'fulfilled' && result.value.exited),
      }
    },
  }
}
