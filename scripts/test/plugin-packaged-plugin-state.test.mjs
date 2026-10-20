import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  chromeRowInPage,
  chromeDiskState,
  pluginStateSnapshot,
  safePluginState,
  unknownPluginState,
  printPluginState,
  pluginStateFrames,
} from '../gates/plugin-packaged/plugin-state.mjs'
import { safeReport } from '../gates/plugin-packaged/contract.mjs'
import { pluginWorkspaceIdentity } from '../../apps/desktop/src/main/plugins/supervisor/client'

const roots = []
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function documentFor(label, buttons = [], error) {
  const row =
    label === null
      ? null
      : {
          querySelector: (selector) =>
            selector === '[data-cy="plugin-state"]'
              ? { textContent: label }
              : selector === 'button'
                ? buttons.length
                  ? {}
                  : null
                : buttons.some((button) => selector === `[data-cy="${button}"]`)
                  ? {}
                  : null,
        }
  return {
    querySelector: (selector) =>
      selector === '[data-plugin="chrome"][data-cy="plugin-card"]'
        ? row
        : selector === '[data-cy="plugins-error"]' && error
          ? { textContent: error }
          : null,
  }
}
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-plugin-state-')))
  roots.push(root)
  fs.chmodSync(root, 0o700)
  fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n', { mode: 0o600 })
  const global = path.join(root, 'g'),
    workspace = path.join(root, 'wa')
  for (const dir of [
    global,
    workspace,
    path.join(global, 'state'),
    path.join(global, 'state/lifecycle-guard'),
    path.join(global, 'state/activations'),
  ])
    fs.mkdirSync(dir, { mode: 0o700 })
  const workspaceId = pluginWorkspaceIdentity(workspace)
  const write = (file, value) =>
    fs.writeFileSync(path.join(global, 'state', file), JSON.stringify(value), { mode: 0o600 })
  const activation = '00000002-' + 'a'.repeat(64) + '.json'
  const install = { pluginId: 'chrome', installId: 'fictional-install', phase: 'active' }
  write('lifecycle-guard/00000000.json', { event: { kind: 'created' } })
  write('lifecycle-guard/00000001.json', {
    event: {
      kind: 'prepared',
      operation: {
        request: {
          operationId: 'fictional-operation',
          consent: { action: 'install', pluginId: 'chrome' },
          workspaces: [workspaceId],
        },
        next: install,
      },
    },
  })
  write('lifecycle-guard/00000002.json', {
    event: {
      kind: 'completed',
      operationId: 'fictional-operation',
      activation: { name: activation },
    },
  })
  write('activations/' + activation, { entries: [install] })
  return {
    root,
    global,
    workspace,
    workspaceId,
    activation,
    install,
    write,
    read: () => chromeDiskState(root, global, workspace),
  }
}
describe('closed Chrome row observation', () => {
  it.each([
    ['Available', 'available'],
    ['Installing', 'installing'],
    ['Installed', 'installed-stopped'],
    ['Starting', 'starting'],
    ['Running', 'running'],
    ['Needs setup', 'unhealthy'],
    ['Unavailable', 'unhealthy'],
    ['Update available', 'update-available'],
    ['HOME=/fictional TOKEN=madeup', 'other'],
    ['constructor', 'other'],
    [null, 'absent'],
  ])('reduces %s inside the renderer to %s', (label, stateCategory) => {
    const state = chromeRowInPage(documentFor(label, ['plugin-configure']))
    expect(state.stateCategory).toBe(stateCategory)
    expect(state.rowPresent).toBe(label !== null)
    expect(safePluginState({ ...unknownPluginState(), ...state })).toBe(true)
    expect(JSON.stringify(state)).not.toMatch(/HOME|fictional|TOKEN|madeup|constructor/)
  })
  it.each([
    ['plugin-install', 'install'],
    ['plugin-configure', 'open'],
    ['plugin-retry', 'retry'],
    ['unexpected', 'other'],
    [null, 'none'],
  ])('reports only a button category for %s', (button, expected) => {
    expect(chromeRowInPage(documentFor('Installed', button ? [button] : [])).buttonCategory).toBe(
      expected,
    )
  })
  it.each([
    ['supervisor', 'supervisor'],
    ['host', 'host'],
    ['verification', 'verify'],
    ['receipt', 'receipt'],
    ['Plugin unavailable. Try again.', 'other'],
    ['', 'none'],
  ])('keeps the error category %s closed', (token, expected) => {
    const state = chromeRowInPage(
      documentFor('Unavailable', [], token && token + ' HOME=/fictional TOKEN=madeup argv=private'),
    )
    expect(state.errorCategory).toBe(expected)
    expect(JSON.stringify(state)).not.toMatch(/HOME|fictional|TOKEN|madeup|argv|private/)
  })
  it('bounds and closes independent observation, rejects unexpected page fields, and refuses native observation locally', async () => {
    const disk = { diskObserved: true, installedRecordExists: true, receiptExists: false }
    let closed = 0
    const connect = async () => ({
      evaluate: async (expression) =>
        Function(
          'document',
          'return ' + expression,
        )(documentFor('Installed', ['plugin-configure'])),
      close: () => closed++,
    })
    const state = await pluginStateSnapshot('/fictional', '/fictional/g', '/fictional/wa', 12345, {
      connect,
      disk: () => disk,
    })
    expect(state).toEqual({
      rowPresent: true,
      stateCategory: 'installed-stopped',
      buttonCategory: 'open',
      errorCategory: 'none',
      ...disk,
    })
    expect(closed).toBe(1)
    const invalid = await pluginStateSnapshot('', '', '', 12345, {
      disk: () => disk,
      connect: async () => ({
        evaluate: async () => ({ ...state, path: '/fictional' }),
        close() {},
      }),
    })
    expect(invalid.stateCategory).toBe('other')
    vi.stubEnv('RUNNER_ENVIRONMENT', 'self-hosted')
    await expect(pluginStateSnapshot('/fictional', '', '', 12345)).rejects.toThrow()
    vi.useFakeTimers()
    let aborted = false
    const pending = pluginStateSnapshot('', '', '', 12345, {
      disk: () => disk,
      connect: async (_port, signal) => {
        signal.addEventListener('abort', () => {
          aborted = true
        })
        return { evaluate: () => new Promise(() => {}), close: () => closed++ }
      },
    })
    await vi.advanceTimersByTimeAsync(5001)
    expect((await pending).stateCategory).toBe('other')
    expect(aborted).toBe(true)
    expect(closed).toBe(2)
  })
  it('rejects extra fields, paths, env and arbitrary labels before summary or stdout admission', () => {
    const good = unknownPluginState(),
      lines = [],
      frames = []
    const receive = pluginStateFrames((value) => frames.push(value))
    for (const bad of [
      { ...good, path: '/fictional' },
      { ...good, stateCategory: 'HOME=madeup' },
      { ...good, receiptExists: 'TOKEN=madeup' },
      { ...good, diskObserved: undefined },
    ]) {
      expect(safeReport({ pluginState: bad })).toBe(false)
      printPluginState(bad, (line) => lines.push(line))
      receive(Buffer.from('gate-plugin-state ' + JSON.stringify(bad) + '\n'))
    }
    expect(lines).toEqual([])
    expect(frames).toEqual([])
    printPluginState(good, (line) => lines.push(line))
    receive(Buffer.from(lines[0] + '\n'))
    expect(frames).toEqual([good])
    expect(safeReport({ pluginState: good })).toBe(true)
    expect(lines.join('')).not.toMatch(/fictional|HOME|TOKEN|madeup|path/)
  })
})
describe.skipIf(process.platform === 'win32')(
  'scratch-only activation and projection presence',
  () => {
    it('observes the resolved install cohort, then a revoked and restored canonical workspace receipt', () => {
      const f = fixture()
      expect(f.read()).toEqual({
        diskObserved: true,
        installedRecordExists: true,
        receiptExists: true,
      })
      f.write('lifecycle-guard/00000003.json', {
        event: { kind: 'projected', pluginId: 'chrome', workspaceId: f.workspaceId, receipt: null },
      })
      expect(f.read()).toEqual({
        diskObserved: true,
        installedRecordExists: true,
        receiptExists: false,
      })
      f.write('lifecycle-guard/00000004.json', {
        event: {
          kind: 'projected',
          pluginId: 'chrome',
          workspaceId: f.workspaceId,
          receipt: f.install,
        },
      })
      expect(f.read().receiptExists).toBe(true)
      f.write('activations/' + f.activation, { entries: [] })
      expect(f.read()).toEqual({
        diskObserved: true,
        installedRecordExists: false,
        receiptExists: false,
      })
    })
    it('does not count another workspace or stale installation receipt as this workspace being projected', () => {
      const f = fixture()
      f.write('lifecycle-guard/00000003.json', {
        event: {
          kind: 'projected',
          pluginId: 'chrome',
          workspaceId: f.workspaceId,
          receipt: { ...f.install, installId: 'old-install' },
        },
      })
      f.write('lifecycle-guard/00000004.json', {
        event: {
          kind: 'projected',
          pluginId: 'chrome',
          workspaceId: 'another-workspace',
          receipt: f.install,
        },
      })
      expect(f.read().receiptExists).toBe(false)
    })
    it('separates an absent state directory from unreadable or linked diagnostic input', () => {
      const f = fixture()
      fs.rmSync(path.join(f.global, 'state'), { recursive: true })
      expect(f.read()).toEqual({
        diskObserved: true,
        installedRecordExists: false,
        receiptExists: false,
      })
      fs.symlinkSync(f.workspace, path.join(f.global, 'state'))
      expect(f.read().diskObserved).toBe(false)
      fs.unlinkSync(path.join(f.global, 'state'))
      fs.symlinkSync(path.join(f.root, 'fictional-absent'), path.join(f.global, 'state'))
      expect(f.read().diskObserved).toBe(false)
      fs.unlinkSync(path.join(f.global, 'state'))
    })
    it('refuses traversal names and linked records without reading outside the fixture', () => {
      const f = fixture()
      f.write('lifecycle-guard/00000002.json', {
        event: { kind: 'completed', activation: { name: '../../fictional' } },
      })
      expect(f.read().diskObserved).toBe(false)
      const file = path.join(f.global, 'state/lifecycle-guard/00000002.json')
      fs.unlinkSync(file)
      fs.symlinkSync(path.join(f.global, 'state/lifecycle-guard/00000000.json'), file)
      expect(f.read().diskObserved).toBe(false)
      fs.unlinkSync(file)
      const first = path.join(f.global, 'state/lifecycle-guard/00000000.json')
      fs.chmodSync(first, 0o644)
      expect(f.read().diskObserved).toBe(false)
      expect(chromeDiskState(f.root, path.dirname(f.root), f.workspace).diskObserved).toBe(false)
    })
  },
)
