import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fork, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { join, dirname, isAbsolute } from 'node:path'
import { rm } from 'node:fs/promises'
import type { VerifiedPluginPackage } from './package-verifier'
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
import { windowsSystemEnvironment } from './system-environment'
import {
  endWindowsTree,
  stopGroups,
  readPriorityClamped,
} from '../../../resources/plugin-host/process-groups.mjs'
import { writeReceipt } from '../../../resources/plugin-host/receipts.mjs'

export interface PluginNodeStart {
  package: VerifiedPluginPackage
  releaseDigest: string
}
export interface PluginNodeExit {
  exited: boolean
}
export interface PluginNodeReady {
  readonly serverPid: number
  readonly origin: string
  /** Diagnostic snapshot of this authenticated owned server; never admission evidence. */
  readonly priorityClamped?: boolean | null
  /** These capabilities stay with the supervisor/broker; JSON contains no credential. */
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
async function authenticatedHealth(
  origin: string,
  mcp: string,
  admin: string,
  version: string,
  mcpPath: string,
  adminPath: string,
  probe: string,
): Promise<void> {
  for (const [path, token, expected, method] of [
    ['/healthz', '', 401, 'GET'],
    ['/healthz', 'invalid', 401, 'GET'],
    ['/healthz', mcp, 401, 'GET'],
    [adminPath + probe, mcp, 401, 'GET'],
    [mcpPath, '', 401, 'POST'],
    [mcpPath, admin, 401, 'POST'],
    ['/healthz', admin, 200, 'GET'],
  ] as const) {
    const response = await fetch(origin + path, {
      method,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      redirect: 'manual',
      signal: AbortSignal.timeout(1500),
    })
    if (response.status !== expected) {
      await response.body?.cancel()
      throw new PluginHostError('ready')
    }
    if (expected === 200) {
      const reader = response.body?.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      if (!reader) throw new PluginHostError('ready')
      try {
        for (;;) {
          const part = await reader.read()
          if (part.done) break
          length += part.value.length
          if (length > 4096) throw new PluginHostError('ready')
          chunks.push(part.value)
        }
      } finally {
        await reader.cancel()
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (body?.ok !== true || body.version !== version) throw new PluginHostError('ready')
    } else await response.body?.cancel()
  }
  const adminResponse = await fetch(origin + adminPath + probe, {
    headers: { Authorization: `Bearer ${admin}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(1500),
  })
  await adminResponse.body?.cancel()
  if (adminResponse.status !== 200) throw new PluginHostError('ready')
  const client = new Client({ name: 'brocrew-plugin-host', version: '1' }, { capabilities: {} })
  client.onerror = () => {}
  const transport = new StreamableHTTPClientTransport(new URL(origin + mcpPath), {
    requestInit: { headers: { Authorization: `Bearer ${mcp}` } },
    fetch: (url, init) => {
      const target = typeof url === 'object' && 'url' in url ? String(url.url) : String(url)
      if (new URL(target).origin !== origin) return Promise.reject(new PluginHostError('ready'))
      return fetch(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.any([
          AbortSignal.timeout(2000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      })
    },
  })
  try {
    await client.connect(transport)
    if (client.getServerVersion()?.version !== version) throw new PluginHostError('ready')
  } finally {
    await transport.terminateSession().catch(() => {})
    await client.close().catch(() => {})
  }
}

/** The longest a Windows job keeper may take to open: its first start compiles the job code. */
const KEEPER_OPEN_MS = 130_000

/**
 * The plugins this host runs: the prefix of the variables each one reads its private root and
 * credentials from, and the admin route its readiness check reads.
 */
const HOSTED: Readonly<Record<string, { env: string; probe: string }>> = Object.freeze({
  chrome: { env: 'CHROME', probe: '/profiles' },
  whatsapp: { env: 'WHATSAPP', probe: '/status' },
})

/** One explicitly rooted host, called by the supervisor; it never discovers live app data. */
export function createPluginNodeHost(options: {
  root: string
  runtime: PluginNodeRuntime
  browserExecutable?: string
  readyMs?: number
}) {
  options = Object.freeze({ ...options })
  let closing = false
  const starts = new Map<string, Promise<PluginNodeProcess>>()
  const readyMs = options.readyMs ?? 15000
  if (
    !Number.isFinite(readyMs) ||
    readyMs < 10 ||
    readyMs > 30000 ||
    (options.browserExecutable && !isAbsolute(options.browserExecutable))
  )
    throw new PluginHostError('start')

  async function launch(spec: PluginNodeStart): Promise<PluginNodeProcess> {
    const manifest = spec.package.manifest
    const hosted = Object.hasOwn(HOSTED, manifest.id) ? HOSTED[manifest.id] : undefined
    if (
      !hosted ||
      !spec.package.compatibility.host ||
      !/^[a-f0-9]{64}$/.test(spec.releaseDigest) ||
      !manifest.platforms.some(
        (target) => target.os === process.platform && target.cpu === process.arch,
      ) ||
      !manifest.server
    )
      throw new PluginHostError('package')
    const runtime = await runtimeFiles(options.runtime)
    const root = await privateRoot(options.root)
    const home = await privateChild(root, `data/${manifest.id}`)
    for (const dir of ['downloads', 'files', 'tmp']) await privateChild(home, dir)
    const windows = process.platform === 'win32'
    if (windows)
      for (const dir of ['AppData/Roaming', 'AppData/Local']) await privateChild(home, dir)
    const packages = await privateChild(root, 'packages')
    const release = await publishPrivateDirectory(
      packages,
      spec.releaseDigest,
      async (stage) => {
        for (const file of manifest.files) {
          const bytes = spec.package.readFile(file.path)
          if (!bytes) throw new PluginHostError('package')
          const parent = dirname(file.path)
          if (parent !== '.') await privateChild(stage, parent)
          await immutableFile(join(stage, file.path), bytes)
        }
      },
      async (directory) => {
        for (const file of manifest.files) {
          const bytes = spec.package.readFile(file.path)
          if (!bytes) throw new PluginHostError('package')
          const parent = dirname(file.path)
          if (parent !== '.') await privateChild(directory, parent, false)
          await verifyImmutableFile(join(directory, file.path), bytes)
        }
      },
    )
    const runId = randomUUID()
    const run = await privateChild(root, `runs/${runId}`)
    const mcpToken = randomBytes(32).toString('hex'),
      adminToken = randomBytes(32).toString('hex')
    await immutableFile(
      join(run, 'auth.json'),
      Buffer.from(JSON.stringify({ mcpToken, adminToken })),
    )
    await immutableFile(
      join(run, 'launch.json'),
      Buffer.from(
        JSON.stringify({
          entry: join(release, manifest.server.entry),
          home,
          runId,
          pluginId: manifest.id,
          releaseDigest: spec.releaseDigest,
          ...(windows ? { keeperCache: await privateChild(root, 'keeper') } : {}),
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
        ...(windows
          ? {
              ...windowsSystemEnvironment(),
              USERPROFILE: home,
              APPDATA: join(home, 'AppData', 'Roaming'),
              LOCALAPPDATA: join(home, 'AppData', 'Local'),
            }
          : { PATH: '/usr/bin:/bin', XDG_CONFIG_HOME: home, LC_ALL: 'C' }),
        HOME: home,
        TMPDIR: join(home, 'tmp'),
        TMP: join(home, 'tmp'),
        TEMP: join(home, 'tmp'),
        BROCREW_PLUGIN_RUN_ID: runId,
        [`BROCREW_${hosted.env}_DATA`]: home,
        [`BROCREW_${hosted.env}_AUTH`]: join(run, 'auth.json'),
        [`BROCREW_${hosted.env}_PORT`]: '0',
        ...(options.browserExecutable && manifest.id === 'chrome'
          ? { BROCREW_CHROME_EXECUTABLE: options.browserExecutable }
          : {}),
      },
    })
    const ready = deferred<PluginNodeReady>(),
      exited = deferred<PluginNodeExit>()
    const groups = new Map<number, string>()
    let stopped = false,
      unsupported = false,
      proof = false,
      checking = false,
      stopPromise: Promise<PluginNodeExit> | undefined
    const stop = (): Promise<PluginNodeExit> => {
      if (stopPromise) return stopPromise
      stopped = true
      ready.reject(new PluginHostError('ready'))
      if (child.connected)
        child.send({ channel: 'brocrew-plugin-node:v1', runId, type: 'stop' }, () => {})
      const cap = setTimeout(() => {
        child.kill('SIGKILL')
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
          .then(() => {
            if (stopped) throw new PluginHostError('ready')
            return authenticatedHealth(
              origin,
              mcpToken,
              adminToken,
              manifest.version,
              manifest.server!.mcpPath,
              manifest.server!.adminPath,
              hosted.probe,
            )
          })
          .then(() => {
            if (stopped) return
            clearTimeout(timer)
            const current = () => {
              if (stopped) throw new PluginHostError('ready')
            }
            ready.resolve(
              Object.freeze({
                serverPid: Number(value.serverPid),
                origin,
                // On Windows the guardian reads it from the job, which also holds the browser.
                priorityClamped: windows
                  ? typeof value.priorityClamped === 'boolean'
                    ? value.priorityClamped
                    : null
                  : readPriorityClamped(Number(value.serverPid)),
                mcp() {
                  current()
                  return {
                    url: origin + manifest.server!.mcpPath,
                    headers: { Authorization: `Bearer ${mcpToken}` },
                  }
                },
                admin() {
                  current()
                  return {
                    url: origin + manifest.server!.adminPath,
                    headers: { Authorization: `Bearer ${adminToken}` },
                  }
                },
              }),
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
  return {
    async removePackage(id: string, releaseDigest: string): Promise<void> {
      if (starts.has(id)) throw new PluginHostError('cleanup')
      const root = await privateRoot(options.root)
      const packages = await privateChild(root, 'packages')
      await removePrivateCode(packages, releaseDigest)
    },
    /** Deletes one stopped plugin's private data folder. */
    async removeData(id: string): Promise<void> {
      if (starts.has(id) || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) throw new PluginHostError('cleanup')
      const root = await privateRoot(options.root)
      await rm(join(root, 'data', id), { recursive: true, force: true })
    },
    start(spec: PluginNodeStart): Promise<PluginNodeProcess> {
      const id = spec.package.manifest.id
      if (closing || starts.has(id)) return Promise.reject(new PluginHostError('start'))
      const promise = launch({ ...spec }).catch((error: unknown) => {
        throw error instanceof PluginHostError ? error : new PluginHostError('start')
      })
      starts.set(id, promise)
      void promise.catch(() => {
        if (starts.get(id) === promise) starts.delete(id)
      })
      return promise
    },
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
