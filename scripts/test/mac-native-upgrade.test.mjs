import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import ts from 'typescript'
import {
  unpackDownloadedMacZip,
  quitRestartedMacApp,
  waitForNativeMacDownload,
} from '../lib/mac-native-upgrade.mjs'
import { requireEvidence } from '../lib/mac-update-test.mjs'
import { nativeRestartRecorded } from '../mac-signed-upgrade-contract.mjs'
import { nativeWorkspaceFromRegistry, nativeWorkspaceStartup } from '../mac-native-workspace.mjs'

const folders = []
const folder = () => {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'mac-native-upgrade-')))
  folders.push(path)
  return path
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const path of folders.splice(0)) rmSync(path, { recursive: true, force: true })
})

it.each(['valid', 'size', 'sha512'])('checks the native ZIP before unpacking: %s', async (kind) => {
  const home = folder(),
    app = join(home, 'BroCrew.app')
  const resources = join(app, 'Contents', 'Resources')
  const pending = join(home, 'Library', 'Caches', 'fictional-updater', 'pending')
  mkdirSync(resources, { recursive: true })
  mkdirSync(pending, { recursive: true })
  writeFileSync(join(resources, 'app-update.yml'), 'updaterCacheDirName: fictional-updater\n')
  writeFileSync(join(pending, 'update-info.json'), JSON.stringify({ fileName: 'candidate.zip' }))
  const zip = join(pending, 'candidate.zip'),
    bytes = Buffer.from('fictional signed ZIP bytes')
  writeFileSync(zip, bytes)
  const published = {
    size: bytes.length + (kind === 'size' ? 1 : 0),
    sha512: kind === 'sha512' ? 'wrong' : createHash('sha512').update(bytes).digest('base64'),
  }
  const run = vi.fn(),
    unpacked = join(home, 'unpacked')
  const result = unpackDownloadedMacZip({ app, home, published, unpacked, run })
  if (kind === 'valid') {
    await expect(result).resolves.toEqual({ zip, bundle: join(unpacked, 'BroCrew.app') })
    expect(run).toHaveBeenCalledExactlyOnceWith('/usr/bin/ditto', ['-x', '-k', zip, unpacked])
  } else {
    await expect(result).rejects.toThrow('Downloaded ZIP bytes or feed SHA-512 differ.')
    expect(run).not.toHaveBeenCalled()
  }
})

it('retains a native download error instead of treating it as restart-ready', async () => {
  const cdp = {
    evaluate: vi.fn(async () => ({ state: { kind: 'error', message: 'ZIP staging failed' } })),
  }
  await expect(waitForNativeMacDownload(cdp, '0.2.23', 'ready')).rejects.toThrow(
    'ZIP staging failed',
  )
})

it('does not signal a restarted process whose identity changed', async () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
  const child = {
    pid: 123,
    started: 'original',
    command: '/Applications/BroCrew.app/Contents/MacOS/BroCrew',
  }
  await expect(
    quitRestartedMacApp(child, async () => ({ ...child, started: 'reused' })),
  ).rejects.toThrow('Restarted test process identity changed before quit.')
  expect(kill).not.toHaveBeenCalled()
})

it('presses native restart and keeps B alive until its candidate checkpoint completes', async () => {
  const source = ts.createSourceFile(
    'mac-signed-upgrade.mjs',
    readFileSync(new URL('../mac-signed-upgrade.mjs', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const restart = source.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'nativeRestart',
  )
  expect(restart).toBeDefined()
  const order = [],
    previous = { pid: 123, stage: 'a', log: '/evidence/a.log', browser: { close: vi.fn() } }
  const workspace = {
    name: 'Default',
    data: '/fictional/default',
    cdp: { close: vi.fn() },
    result: {},
    baseline: {
      copiesBefore: ['default-A-copy'],
      registryBefore: {
        workspaces: [
          { path: '/fictional/default', lastOpenedAt: 1 },
          { path: '/fictional/WorkspaceB', lastOpenedAt: 2 },
        ],
      },
    },
  }
  const nativeWorkspace = {
    name: 'WorkspaceB',
    data: '/fictional/WorkspaceB',
    result: {},
    baseline: { workspaceId: 'workspace-B', copiesBefore: ['A-copy'] },
  }
  const startup = {
    appVersion: '0.2.23',
    successfulStarts: 1,
    checkpointId: 'A-copy',
    workspaceId: 'workspace-B',
  }
  const summary = { replacementCount: 0 }
  const fixture = {
    active: previous,
    squirrelApp: null,
    workspace,
    summary,
    app: '/Applications/BroCrew.app',
    data: '/fictional/default',
    evidence: '/evidence',
    join,
    nativeRestartRecorded,
    nativeWorkspaceFromRegistry,
    nativeWorkspaceStartup,
    workspaces: [workspace, nativeWorkspace],
    VERSION_B: '0.2.23',
    candidate: { source: 'original-signed-source' },
    selectWorkspace: vi.fn(),
    requireEvidence,
    click: vi.fn(async () => order.push('restart-choice')),
    run: vi.fn(),
    processInfo: vi.fn(async () => null),
    waitFor: async (check) => {
      expect(await check()).toBe(true)
    },
    readFile: vi.fn(async (path) =>
      path === join(fixture.evidence, 'a.stdout.log')
        ? 'updates: restarting to install 0.2.23'
        : 'BroCrew shut down in 10ms\nclose its sessions\nkeep its unsent drafts\ndrain its archive work\nclose its database',
    ),
    observeMacReplacement: vi.fn(async () => {
      order.push('native-B')
      return { pid: 456 }
    }),
    macFirstStartReceipt: vi.fn(async () => {
      expect(summary.restart.restarted).toEqual({ pid: 456 })
      expect(summary.restart.workspace).toEqual({ name: 'WorkspaceB', path: nativeWorkspace.data })
      expect(summary.restart.origin).toEqual({ name: 'Default', path: workspace.data })
      return startup
    }),
    completedProofCopy: vi.fn(async () => {
      order.push('completed-B-copy')
      return {
        manifest: {
          id: 'B-copy',
          workspaceId: 'workspace-B',
          madeBy: { appVersion: '0.2.23', build: 'original-signed-source' },
        },
      }
    }),
    bundleChecked: vi.fn(async () => ({ version: '0.2.23' })),
    passed: vi.fn(),
    quitSquirrelApp: vi.fn(async () => order.push('quit-native-B')),
    requireNoInstalledProcesses: vi.fn(async () => order.push('no-app-or-ShipIt')),
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
  await new AsyncFunction(
    'fixture',
    `let { ${Object.keys(fixture).join(', ')} } = fixture\n${restart.getText(source)}\nawait nativeRestart(workspace)`,
  )(fixture)
  expect(order).toEqual([
    'restart-choice',
    'native-B',
    'completed-B-copy',
    'quit-native-B',
    'no-app-or-ShipIt',
  ])
  expect(fixture.readFile).toHaveBeenCalledWith(join(fixture.evidence, 'a.stdout.log'), 'utf8')
  expect(fixture.readFile).toHaveBeenCalledWith('/evidence/a.log', 'utf8')
  expect(fixture.click).toHaveBeenCalledExactlyOnceWith(workspace.cdp, '[data-cy=updates-restart]')
  expect(fixture.observeMacReplacement).toHaveBeenCalledExactlyOnceWith({
    app: fixture.app,
    version: '0.2.23',
    previous,
    run: fixture.run,
    processInfo: fixture.processInfo,
  })
  expect(fixture.run).not.toHaveBeenCalled()
  expect(fixture.completedProofCopy).toHaveBeenCalledExactlyOnceWith(
    '/fictional/WorkspaceB',
    new Set(['A-copy']),
  )
  expect(fixture.macFirstStartReceipt).toHaveBeenCalledExactlyOnceWith(
    nativeWorkspace.data,
    '0.2.23',
  )
  expect(summary.replacementCount).toBe(1)
  expect(workspace.result.nativeStartup).toBeUndefined()
  expect(nativeWorkspace.result.nativeStartup.completedCheckpointId).toBe('B-copy')
  expect(nativeWorkspace.result.nativeStartup.checkpointId).toBe('A-copy')
})
