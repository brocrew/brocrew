import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type {
  LifecycleOptions,
  WorkspaceProjection,
  ProjectionReceipt,
} from '../src/main/plugins/lifecycle/types'
import { packageFixture, manifestFor, fictionalPublicKey } from './plugin-package-fixtures'
const homes: string[] = [],
  stores: GlobalPluginState[] = []

export function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
export function projection(events: string[] = []) {
  const rows = new Map<string, ProjectionReceipt>()
  let writeFails = false,
    revokeFails = false
  const sink: WorkspaceProjection = {
    workspaceId: randomUUID(),
    async applied(id, receipt) {
      events.push('receipt')
      if (writeFails) {
        writeFails = false
        throw new Error('fictional write')
      }
      if (receipt) rows.set(id, receipt)
      else rows.delete(id)
    },
    async revoke() {
      events.push('revoke')
      return !revokeFails
    },
    async reconcile(change) {
      events.push(change.receipt ? 'bind' : 'clear')
    },
  }
  return {
    sink,
    rows,
    failWrite: () => {
      writeFails = true
    },
    failRevoke: () => {
      revokeFails = true
    },
  }
}
export async function fixture(
  change: Partial<LifecycleOptions> = {},
  includeSkills = false,
  id = 'chrome',
) {
  // POSIX needs short Unix socket paths; Windows uses named pipes and its own temp directory.
  const temp = process.platform === 'win32' ? tmpdir() : '/tmp'
  const parent = await realpath(await mkdtemp(join(temp, 'fictional-lifecycle-')))
  homes.push(parent)
  const root = join(parent, 'global'),
    workspace = join(parent, 'workspace')
  await mkdir(root, { mode: 0o700 })
  await mkdir(workspace, { mode: 0o700 })
  const state = GlobalPluginState.create({ root: join(root, 'state'), workspaceRoots: [workspace] })
  stores.push(state)
  const manifest = manifestFor()
  manifest.id = id
  if (!includeSkills) manifest.skills = []
  manifest.platforms = [
    { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
  ]
  const pkg = packageFixture({ manifest })
  const events: string[] = []
  let starts = 0,
    stopFails = false,
    readyFails = false,
    downloads = 0
  const opts: LifecycleOptions = {
    root,
    state,
    pinnedPublicKey: fictionalPublicKey,
    target: manifest.platforms[0]!,
    catalogue: { bytes: pkg.bytes, signature: pkg.signature },
    names: { chrome: 'Chrome', whatsapp: 'WhatsApp' },
    deny() {
      events.push('deny')
    },
    download: async () => {
      events.push('download')
      downloads++
      return pkg.archive
    },
    runtime: {
      previousOwnerClean: async () => true,
      removeCode: async () => {
        events.push('remove-code')
      },
      removeData: async (plugin) => {
        events.push(`remove-data ${plugin}`)
      },
      async start() {
        starts++
        events.push('start')
        return {
          runId: randomUUID(),
          exited: new Promise<void>(() => {}),
          async ready() {
            events.push('ready')
            if (readyFails) throw new Error('fictional readiness')
            return {
              serverPid: 404941,
              origin: 'http://127.0.0.1:1',
              mcp: () => ({ url: '', headers: { Authorization: '' } }),
              admin: () => ({ url: '', headers: { Authorization: '' } }),
            }
          },
          async stop() {
            events.push('stop')
            if (stopFails) throw new Error('fictional unproved exit')
          },
        }
      },
    },
    ...change,
  }
  const controller = await PluginLifecycleController.open(opts),
    local = projection(events),
    handle = await controller.attach(local.sink)
  return {
    parent,
    root,
    workspace,
    state,
    pkg,
    opts,
    controller,
    local,
    handle,
    events,
    starts: () => starts,
    downloads: () => downloads,
    failStop: (v = true) => {
      stopFails = v
    },
    failReady: () => {
      readyFails = true
    },
  }
}

export async function cleanupLifecycleFixtures() {
  for (const store of stores.splice(0)) store.close()
  for (const root of homes.splice(0)) await rm(root, { recursive: true, force: true })
}
export function reopenLifecycleFixture(f: Awaited<ReturnType<typeof fixture>>) {
  f.state.close()
  stores.splice(stores.indexOf(f.state), 1)
  const reopened = GlobalPluginState.open({
    root: join(f.root, 'state'),
    workspaceRoots: [f.workspace],
  })
  stores.push(reopened)
  return reopened
}
