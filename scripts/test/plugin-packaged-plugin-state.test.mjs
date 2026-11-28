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
  const global = path.join(root, 'g')
  for (const dir of [global, path.join(global, 'state')]) fs.mkdirSync(dir, { mode: 0o700 })
  const file = path.join(global, 'state', 'plugin-state.000000000002.json')
  const write = (value) => fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
  const install = { pluginId: 'chrome', installId: 'fictional-install', phase: 'active' }
  write({ format: 2, plugins: [install], active: [install], pending: null, operations: [] })
  return { root, global, file, install, write, read: () => chromeDiskState(root, global) }
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
    const disk = { diskObserved: true, installedRecordExists: true }
    let closed = 0
    const connect = async () => ({
      evaluate: async (expression) =>
        Function(
          'document',
          'return ' + expression,
        )(documentFor('Installed', ['plugin-configure'])),
      close: () => closed++,
    })
    const state = await pluginStateSnapshot('/fictional', '/fictional/g', 12345, {
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
    const invalid = await pluginStateSnapshot('', '', 12345, {
      disk: () => disk,
      connect: async () => ({
        evaluate: async () => ({ ...state, path: '/fictional' }),
        close() {},
      }),
    })
    expect(invalid.stateCategory).toBe('other')
    vi.stubEnv('RUNNER_ENVIRONMENT', 'self-hosted')
    await expect(pluginStateSnapshot('/fictional', '', 12345)).rejects.toThrow()
    vi.useFakeTimers()
    let aborted = false
    const pending = pluginStateSnapshot('', '', 12345, {
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
      { ...good, installedRecordExists: 'TOKEN=madeup' },
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
describe.skipIf(process.platform === 'win32')('scratch-only installed presence', () => {
  it('observes Chrome among the active plugins, and not once it is removed', () => {
    const f = fixture()
    expect(f.read()).toEqual({ diskObserved: true, installedRecordExists: true })
    f.write({
      format: 2,
      plugins: [{ ...f.install, phase: 'removed' }],
      active: [],
      pending: null,
      operations: [],
    })
    expect(f.read()).toEqual({ diskObserved: true, installedRecordExists: false })
    // An older file left beside a newer one is not read: the highest sequence is current.
    fs.writeFileSync(
      path.join(f.global, 'state', 'plugin-state.000000000001.json'),
      JSON.stringify({ format: 2, plugins: [f.install], active: [f.install] }),
      { mode: 0o600 },
    )
    expect(f.read()).toEqual({ diskObserved: true, installedRecordExists: false })
  })
  it('separates an absent state from unreadable or linked diagnostic input', () => {
    const f = fixture()
    fs.rmSync(f.file)
    expect(f.read()).toEqual({ diskObserved: true, installedRecordExists: false })
    fs.rmSync(path.join(f.global, 'state'), { recursive: true })
    expect(f.read()).toEqual({ diskObserved: true, installedRecordExists: false })
    fs.symlinkSync(f.root, path.join(f.global, 'state'))
    expect(f.read().diskObserved).toBe(false)
    fs.unlinkSync(path.join(f.global, 'state'))
    fs.symlinkSync(path.join(f.root, 'fictional-absent'), path.join(f.global, 'state'))
    expect(f.read().diskObserved).toBe(false)
  })
  it('refuses a linked, shared or malformed state file without reading outside the fixture', () => {
    const f = fixture()
    const outside = path.join(f.root, 'outside.json')
    fs.renameSync(f.file, outside)
    fs.symlinkSync(outside, f.file)
    expect(f.read().diskObserved).toBe(false)
    fs.unlinkSync(f.file)
    fs.renameSync(outside, f.file)
    fs.chmodSync(f.file, 0o644)
    expect(f.read().diskObserved).toBe(false)
    fs.chmodSync(f.file, 0o600)
    fs.writeFileSync(f.file, '{"format":2}')
    expect(f.read().diskObserved).toBe(false)
    expect(chromeDiskState(f.root, path.dirname(f.root)).diskObserved).toBe(false)
  })
})
