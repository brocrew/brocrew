import { snapshotPath } from './helpers/plugin-state-snapshot'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { encodeState } from './fixtures/plugin-encoder-820/state-format'
import { workspacePluginRoot } from '../src/main/plugins/root-selection'
import { LifecycleEffects } from '../src/main/plugins/lifecycle/files'

const folders: string[] = []
const stores: GlobalPluginState[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const parent = realpathSync.native(
    mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-migration-')),
  )
  folders.push(parent)
  const root = join(parent, 'state')
  return { parent, root, workspaceRoots: [] }
}
function open(options: ReturnType<typeof fixture>, create = false) {
  const state = create ? GlobalPluginState.create(options) : GlobalPluginState.open(options)
  stores.push(state)
  return state
}
function request(state: GlobalPluginState, action: 'install' | 'update' | 'uninstall' = 'install') {
  const current = state.inspect().guards.find((entry) => entry.pluginId === 'fictional-kite')
  return {
    operationId: randomUUID(),
    consent: {
      action,
      pluginId: 'fictional-kite',
      at: 1,
      expectedSequence: state.inspect().sequence,
      expectedInstallId: current?.installId ?? null,
      release:
        action === 'uninstall'
          ? null
          : {
              version: action === 'update' ? '2.0.0' : '1.0.0',
              archiveSha256: 'a'.repeat(64),
              manifestSha256: 'b'.repeat(64),
              dataSchema: 1,
            },
    },
    snapshot: null,
  }
}
function legacy(options: ReturnType<typeof fixture>) {
  mkdirSync(join(options.root, 'lifecycle-guard'), { recursive: true })
  const rootId = randomUUID(),
    epoch = randomUUID(),
    operationId = randomUUID()
  const install = {
    pluginId: 'fictional-kite',
    installId: randomUUID(),
    incarnation: randomUUID(),
    lifecycleSequence: 1,
    releaseRevision: 1,
    configRevision: 0,
    release: {
      version: '1.0.0',
      archiveSha256: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
      dataSchema: 1,
    },
    phase: 'active',
  }
  const operation = {
    request: {
      operationId,
      consent: {
        action: 'install',
        pluginId: install.pluginId,
        at: 1,
        expectedSequence: 0,
        expectedInstallId: null,
        release: install.release,
      },
      snapshot: null,
    },
    allocated: {
      installId: install.installId,
      incarnation: install.incarnation,
      epoch: randomUUID(),
    },
    next: { ...install, phase: 'prepared' },
  }
  const events = [
    { kind: 'created', rootId, epoch },
    { kind: 'prepared', operation },
    {
      kind: 'completed',
      operationId,
      activation: { name: '00000002-' + 'c'.repeat(64) + '.json', sha256: 'c'.repeat(64) },
    },
    { kind: 'reader-floor', version: 2 },
  ]
  events.forEach((event, sequence) =>
    writeFileSync(
      join(options.root, 'lifecycle-guard', String(sequence).padStart(8, '0') + '.json'),
      encodeState({ sequence, previous: null, publicationId: randomUUID(), event }),
    ),
  )
  writeFileSync(join(options.root, 'lifecycle-guard', '.stage-fictional'), 'interrupted bytes')
  return { install, operationId, rootId, epoch }
}

describe('ordinary plugin state and old location migration', () => {
  it('migrates completed records without seals, floors or enrollment and leaves old bytes alone', () => {
    const options = fixture(),
      before = legacy(options)
    const paths = readdirSync(join(options.root, 'lifecycle-guard'))
    const bytes = paths.map((name) => readFileSync(join(options.root, 'lifecycle-guard', name)))
    const state = open(options)
    expect(state.exportActivation().entries).toEqual([before.install])
    expect(
      state
        .inspect()
        .operations.find((one) => one.operation.request.operationId === before.operationId)?.status,
    ).toBe('completed')
    expect(existsSync(snapshotPath(options.root))).toBe(true)
    paths.forEach((name, index) =>
      expect(readFileSync(join(options.root, 'lifecycle-guard', name))).toEqual(bytes[index]),
    )
    expect(open(options).exportActivation()).toEqual(state.exportActivation())
  })
  it('preserves an old pending operation and its workspace selection without allocating or replaying it', () => {
    const options = fixture(),
      previous = legacy(options),
      workspaceId = randomUUID()
    const reader = open(options)
    const input = { ...request(reader, 'update'), workspaces: [workspaceId] }
    reader.close()
    rmSync(join(options.root, 'snapshots'), { recursive: true, force: true })
    const allocated = { installId: randomUUID(), incarnation: randomUUID(), epoch: randomUUID() }
    const operation = {
      request: input,
      allocated,
      next: {
        ...previous.install,
        release: input.consent.release,
        phase: 'prepared',
        incarnation: allocated.incarnation,
        lifecycleSequence: 2,
        releaseRevision: 2,
      },
    }
    writeFileSync(
      join(options.root, 'lifecycle-guard', '00000004.json'),
      encodeState({
        sequence: 4,
        previous: null,
        publicationId: randomUUID(),
        event: { kind: 'prepared', operation },
      }),
    )
    const next = open(options)
    expect(next.inspect().pending).toEqual(operation)
    expect(next.prepare(input)).toEqual(operation)
    next.abort(input.operationId)
    expect(next.exportActivation().entries).toEqual([previous.install])
    expect(next.emptyProjection(workspaceId, 'fictional-kite')?.installId).toBe(
      previous.install.installId,
    )
  })
  it.each(['staged', 'published', 'durable'] as const)(
    'recovers legacy migration interrupted at %s without changing old bytes',
    (point) => {
      const options = fixture(),
        previous = legacy(options)
      const file = join(options.root, 'lifecycle-guard', '00000002.json'),
        before = readFileSync(file)
      expect(() =>
        GlobalPluginState.open({
          ...options,
          fault: (at) => {
            if (at === point) throw new Error('fictional migration interruption')
          },
        }),
      ).toThrow()
      expect(open(options).exportActivation().entries).toEqual([previous.install])
      expect(readFileSync(file)).toEqual(before)
    },
  )
  it('retains opaque pairing, profiles and consumed-command bytes across update, interruption and reopen', () => {
    const options = fixture()
    mkdirSync(join(options.parent, 'data'), { recursive: true })
    const files = ['pairing.bin', 'profiles.json', 'consumed-commands.json']
    const payloads = [
      Buffer.from([0, 255, 17, 10]),
      Buffer.from('{"fern":"profile"}'),
      Buffer.from('{"open-once":"consumed"}'),
    ]
    files.forEach((name, index) =>
      writeFileSync(join(options.parent, 'data', name), payloads[index]!),
    )
    const state = open(options, true),
      install = request(state)
    state.prepare(install)
    state.complete(install.operationId)
    const prior = state.exportActivation()
    const update = request(state, 'update')
    state.prepare(update)
    expect(open(options).inspect().pending?.request.operationId).toBe(update.operationId)
    state.abort(update.operationId)
    expect(open(options).exportActivation()).toEqual(prior)
    files.forEach((name, index) =>
      expect(readFileSync(join(options.parent, 'data', name))).toEqual(payloads[index]),
    )
  })
  it.each(['staged', 'published', 'durable'] as const)(
    'recovers a complete old or new snapshot after a %s interruption',
    (point) => {
      const options = fixture(),
        initial = open(options, true),
        input = request(initial)
      let fail = true
      const faulted = GlobalPluginState.open({
        ...options,
        fault: (at) => {
          if (fail && at === point) {
            fail = false
            throw new Error('fictional interruption')
          }
        },
      })
      stores.push(faulted)
      expect(() => faulted.prepare(input)).toThrow()
      const recovered = open(options)
      expect([null, input.operationId]).toContain(
        recovered.inspect().pending?.request.operationId ?? null,
      )
      const allocated = recovered.prepare(input)
      recovered.complete(input.operationId)
      expect(open(options).exportActivation().entries[0]?.installId).toBe(allocated.next?.installId)
    },
  )
  it('accepts selected shared directories without changing permissions or requiring workspace existence', () => {
    const options = fixture()
    chmodSync(options.parent, 0o755)
    const state = GlobalPluginState.create({
      ...options,
      workspaceRoots: [join(options.parent, 'unmounted-workspace')],
    })
    stores.push(state)
    expect(state.inspect().pending).toBeNull()
  })
  it('keeps a custom location when only the old pin or only the old marker survives', () => {
    const options = fixture(),
      appData = join(options.parent, 'app'),
      workspace = join(options.parent, 'fern')
    mkdirSync(join(appData, '@brobot2'), { recursive: true })
    mkdirSync(workspace)
    const choose = () =>
      workspacePluginRoot({
        appData,
        workspaceRoot: workspace,
        defaultRoot: join(appData, '@brobot2', 'plugins'),
      })
    writeFileSync(join(workspace, 'plugin-root.json'), JSON.stringify({ format: 1, slot: 'fern' }))
    expect(choose()).toBe(join(appData, '@brobot2', 'plugins-fern'))
    rmSync(join(workspace, 'plugin-root.json'))
    writeFileSync(
      join(appData, '@brobot2', 'plugin-root-pins.json'),
      JSON.stringify({ format: 1, selections: [{ workspace, slot: 'fern' }] }),
    )
    expect(choose()).toBe(join(appData, '@brobot2', 'plugins-fern'))
  })
  it.skipIf(process.platform === 'win32')(
    'uses a selected directory alias without enrollment',
    () => {
      const options = fixture(),
        target = join(options.parent, 'target'),
        alias = join(options.parent, 'alias')
      mkdirSync(target)
      symlinkSync(target, alias, 'dir')
      const state = GlobalPluginState.create({ root: join(alias, 'state'), workspaceRoots: [] })
      stores.push(state)
      expect(state.inspect().sequence).toBe(0)
    },
  )
  it('writes completion markers beyond the old effect-file ceiling', async () => {
    const options = fixture(),
      effects = await LifecycleEffects.open(options.parent, true)
    for (let i = 0; i < 4096; i++) writeFileSync(join(effects.folder, 'unrelated-' + i), '')
    const effect = {
      format: 1 as const,
      operationId: randomUUID(),
      pluginId: 'fictional-kite',
      installId: randomUUID(),
      action: 'install' as const,
      phase: 'committed' as const,
      offlineCleanup: false,
      compensates: null,
    }
    await effects.write(effect)
    expect(await effects.read(effect.operationId)).toEqual(effect)
  })
  it('retains the previous version and schema in interrupted update effects', async () => {
    const options = fixture(),
      effects = await LifecycleEffects.open(options.parent, true)
    const effect = {
      format: 1 as const,
      operationId: randomUUID(),
      pluginId: '.fictional café package',
      installId: randomUUID(),
      action: 'update' as const,
      phase: 'prepared' as const,
      offlineCleanup: false,
      compensates: null,
      previousVersion: '1.0.0',
      previousDataSchema: 2,
    }
    await effects.write(effect)
    const reopened = await LifecycleEffects.open(options.parent, false)
    expect(await reopened.read(effect.operationId)).toEqual(effect)
    await reopened.write({ ...effect, phase: 'committed' })
    expect(await effects.read(effect.operationId)).toEqual({ ...effect, phase: 'committed' })
  })
})
