import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readdirSync, writeFileSync } from 'node:fs'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { stateFilesIn } from '../src/main/plugins/state/format'
import { PluginLifecycleController } from '../src/main/plugins/lifecycle/controller'
import type { LifecycleOptions, PersonProjection } from '../src/main/plugins/lifecycle/types'
import { packageFixture, manifestFor } from './plugin-package-fixtures'
import { realPath } from '../src/main/plugins/private-files'
import {
  encodeState,
  installationProjection,
  type JournalRecord,
  type ProjectionReceipt,
} from './fixtures/plugin-journal-parent/format'
import {
  foldRecord,
  type LifecycleState as JournalState,
} from './fixtures/plugin-journal-parent/machine'
import { GlobalPluginState as JournalStore } from './fixtures/plugin-journal-parent/store'
import { pluginSha256 } from '../src/main/plugins/package-digests'
const homes: string[] = [],
  stores: GlobalPluginState[] = []

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export function projection(events: string[] = []) {
  // The app's side of a workspace; a current owner sends it only revoke.
  const sink: PersonProjection = {
    workspaceId: randomUUID(),
    async applied() {},
    async revoke() {
      events.push('revoke')
      return true
    },
    async reconcile() {},
  }
  return { sink }
}
export async function fixture(
  change: Partial<LifecycleOptions> = {},
  id = 'chrome',
  declaration: Partial<ReturnType<typeof manifestFor>> = {},
  /** Starts the root as the journal that earlier builds kept, before its migration. */
  { journal = false } = {},
) {
  // POSIX needs short Unix socket paths; Windows uses named pipes and its own temp directory.
  const temp = process.platform === 'win32' ? tmpdir() : '/tmp'
  const parent = realPath(await mkdtemp(join(temp, 'fictional-lifecycle-')))
  homes.push(parent)

  const root = join(parent, 'global'),
    workspace = join(parent, 'workspace')
  await mkdir(root, { mode: 0o700 })
  await mkdir(workspace, { mode: 0o700 })

  const options = { root: join(root, 'state'), workspaceRoots: [workspace] }
  const state = journal
    ? (JournalStore.create(options) as unknown as GlobalPluginState)
    : GlobalPluginState.create(options)
  stores.push(state)
  const manifest = manifestFor()
  manifest.id = id
  manifest.action = {
    id: 'fixture-restart',
    kind: 'restart',
    label: 'Restart fictional plugin',
    note: 'Restarts the fictional host.',
    failureAction: 'restart fictional plugin',
  }
  manifest.platforms = [
    { os: process.platform as 'darwin' | 'linux', cpu: process.arch as 'arm64' | 'x64' },
  ]
  Object.assign(manifest, declaration)
  const pkg = packageFixture({ manifest })
  const events: string[] = []
  let starts = 0,
    stopFails = false,
    readyFails = false,
    downloads = 0
  const opts: LifecycleOptions = {
    root,
    state,
    target: manifest.platforms[0]!,
    catalogue: { bytes: pkg.bytes },
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
/** The state calls both the current and the journal-era stores share. */
interface StateCalls {
  inspect(): {
    sequence: number
    guards: readonly { pluginId: string; installId: string; phase: string }[]
  }
  prepare(input: unknown): unknown
  complete(operationId: string): void
  abort(operationId: string): void
}
/** A store-level operation request: the plugin's current install, at the current sequence. */
export function stateRequest(
  state: StateCalls,
  action: 'install' | 'update' | 'uninstall',
  pluginId: string,
  version = '1.0.0',
  digit = 'a',
) {
  const view = state.inspect()
  return {
    operationId: randomUUID(),
    snapshot: null,
    consent: {
      action,
      pluginId,
      at: 1000,
      expectedSequence: view.sequence,
      expectedInstallId: view.guards.find((one) => one.pluginId === pluginId)?.installId ?? null,
      release:
        action === 'uninstall'
          ? null
          : {
              version,
              archiveSha256: digit.repeat(64),
              manifestSha256: 'b'.repeat(64),
              dataSchema: 1,
            },
    },
  }
}
/** Prepares and resolves one store-level operation; returns its operation id. */
export function runOperation(
  state: StateCalls,
  ...args: Parameters<typeof stateRequest> extends [unknown, ...infer Rest] ? Rest : never
) {
  const request = stateRequest(state, ...args)
  state.prepare(request)
  state.complete(request.operationId)
  return request.operationId
}
/** An unrelated state change: another plugin's install is prepared and aborted. */
export function moveTheSequence(state: GlobalPluginState) {
  const request = stateRequest(state, 'install', 'fictional-other')
  state.prepare(request)
  state.abort(request.operationId)
}
/** The current plugin state file in a state folder (the highest sequence), if there is one. */
export function stateFile(stateRoot: string): string | undefined {
  const current = stateFilesIn(readdirSync(stateRoot))[0]
  return current && join(stateRoot, current.name)
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

/** The journal's state as its earlier builds held it; the root must start as a journal. */
export function journalHead(f: Awaited<ReturnType<typeof fixture>>): JournalState {
  return (f.state as unknown as { disk: { load(): JournalState } }).disk.load()
}
/** Workspace receipts as an earlier reconnect path wrote them, one record each, into the journal. */
export function appendProjectionHistory(
  root: string,
  head: JournalState,
  workspaceId: string,
  history: number,
  receipt: ProjectionReceipt | null = installationProjection(
    head.rootId,
    head.epoch,
    workspaceId,
    head.admitted.get('chrome')!,
  ),
) {
  for (let i = 0; i < history; i++) {
    const record: JournalRecord = {
      sequence: head.sequence + 1,
      previous: head.head,
      publicationId: randomUUID(),
      event: {
        kind: 'projected',
        workspaceId,
        pluginId: 'chrome',
        receipt: i % 2 ? null : receipt,
      },
    }
    const bytes = encodeState(record),
      checksum = pluginSha256(bytes)
    foldRecord(head, record, checksum)
    const name = String(record.sequence).padStart(8, '0')
    writeFileSync(join(root, 'state/lifecycle-guard', name + '.json'), bytes, {
      mode: 0o600,
      flag: 'wx',
    })
    writeFileSync(join(root, 'state/lifecycle-guard', `${name}-${checksum}.seal`), '', {
      mode: 0o600,
      flag: 'wx',
    })
  }
}

export async function fixtureSettingsClient(
  f: Awaited<ReturnType<typeof fixture>>,
  closers: Array<() => unknown | Promise<unknown>>,
  read: () => Promise<unknown>,
) {
  const bridge = await servePersonPluginControl({
    root: f.root,
    key: 'e'.repeat(64),
    controller: f.controller,
    read,
  })
  closers.push(() => bridge.close())
  const client = await connectPluginSettings({
    path: bridge.path,
    personKey: 'e'.repeat(64),
    root: f.root,
    target: f.opts.target,
    catalogue: f.opts.catalogue,
    projection: projection().sink,
    propose: () => {},
  })
  closers.push(() => client.close())
  return client
}
