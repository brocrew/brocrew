import { afterEach, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { PluginStateDisk } from '../src/main/plugins/state/disk'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import { disclosureFixture } from './plugin-disclosure-fixtures'
import { bundleAWorker } from './helpers/bundle-a-worker'

const closers: Array<() => Promise<void>> = [],
  children: ChildProcess[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill()
    await exited
  }
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
const program = `
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const { displayRead, keepPluginRootPrivate } = require(process.argv[1]);
(async () => {
  await keepPluginRootPrivate(require('node:path').dirname(process.argv[2]));
  const opened = new Map(), open = fs.openSync;
  fs.openSync = (path, ...args) => {
    const fd = open(path, ...args);
    opened.set(fd, { path: String(path), flags: args[0] });
    return fd;
  };
  const read = fs.readSync;
  let paused = false;
  fs.readSync = (fd, ...args) => {
    if (!paused && fs.fstatSync(fd).nlink === 1) {
      paused = true;
      process.send({ kind: 'paused', opened: opened.get(fd) });
      const gate = new Int32Array(new SharedArrayBuffer(4)), until = Date.now() + 15000;
      while (!fs.existsSync(process.argv[3])) {
        if (Date.now() > until) throw Error('fictional reader was not released');
        Atomics.wait(gate, 0, 0, 10);
      }
    }
    return read(fd, ...args);
  };
  syncBuiltinESMExports();
  const descriptor = displayRead({ root: process.argv[2], workspaceRoots: [] }, 'chrome');
  process.send({ kind: 'done', descriptor });
})().catch(error => { process.send({ kind: 'failed', code: error.code, message: error.message }); process.exitCode = 1; });
`
function message(child: ChildProcess): Promise<{ kind: string; descriptor?: unknown }> {
  return new Promise((resolve, reject) => {
    const done = (value: { kind: string; descriptor?: unknown }) => {
      clearTimeout(timer)
      child.off('error', failed)
      resolve(value)
    }
    const failed = (error: Error) => {
      clearTimeout(timer)
      child.off('message', done)
      reject(error)
    }
    const timer = setTimeout(() => failed(new Error('fictional reader did not answer')), 20000)
    child.once('message', done)
    child.once('error', failed)
  })
}
it('an atomic snapshot reader cannot block owner writes and reclaim', async () => {
  const f = await disclosureFixture({ installed: true })
  closers.push(f.close)
  const folder = join(f.f.parent, 'display-reader-worker')
  await mkdir(folder, { mode: 0o700 })
  const bundle = await bundleAWorker(
    'test/helpers/plugin-disclosure-reader-worker.ts',
    folder,
    'reader.cjs',
  )
  const root = join(f.f.root, 'state'),
    release = join(folder, 'release')
  const child = spawn(process.execPath, ['-e', program, bundle, root, release], {
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  children.push(child)
  let stderr = ''
  child.stderr!.on('data', (bytes) => {
    stderr += String(bytes)
  })
  const first = await message(child)
  expect(first, stderr).toEqual({
    kind: 'paused',
    opened: { path: join(root, 'installed-state.json'), flags: 'r' },
  })
  const result = message(child)
  const owner = new PluginStateDisk({ root, workspaceRoots: [f.f.workspace] })
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      const state = f.f.state.inspect(),
        operationId = randomUUID(),
        pluginId = `other-plugin-${cycle}`
      console.info('snapshot-owner-cycle', JSON.stringify({ cycle, phase: 'prepare' }))
      f.f.state.prepare({
        operationId,
        consent: {
          action: 'install',
          pluginId,
          at: 1000,
          expectedSequence: state.sequence,
          expectedInstallId: null,
          release: {
            version: f.first.release.version,
            archiveSha256: f.first.release.archive.sha256,
            manifestSha256: f.first.release.manifestSha256,
            dataSchema: f.first.manifest.dataSchema,
          },
        },
        snapshot: null,
      })
      console.info('snapshot-owner-cycle', JSON.stringify({ cycle, phase: 'complete' }))
      f.f.state.complete(operationId)
      console.info('snapshot-owner-cycle', JSON.stringify({ cycle, phase: 'reclaim' }))
      owner.reclaim()
      expect(owner.load().pending).toBeNull()
      expect(f.f.state.inspect().guards.find((one) => one.pluginId === pluginId)?.phase).toBe(
        'active',
      )
      const selected = JSON.parse(await readFile(join(root, 'installed-state.json'), 'utf8'))
      expect(selected.pending).toBeNull()
      expect(selected.active.some((one: { pluginId: string }) => one.pluginId === pluginId)).toBe(
        true,
      )
    }
  } finally {
    owner.close()
    await writeFile(release, '')
  }
  const observed = await result
  expect(observed.kind, stderr).toBe('done')
  expect(observed.descriptor).toEqual({
    version: '1.0.1',
    archiveSha256: f.first.release.archive.sha256,
    manifestSha256: f.first.release.manifestSha256,
  })
  expect(
    f.f.state.inspect().guards.find((one) => one.pluginId === 'chrome')?.release.archiveSha256,
  ).toBe(f.first.release.archive.sha256)
}, 30000)

it('discriminates held snapshot readers from staged writer handles with native file operations', () => {
  const root = mkdtempSync(join(tmpdir(), 'fictional-snapshot-handles-'))
  const observations: Array<{
    readerMode: 'r' | 'r+'
    readerHeld: boolean
    writerHeld: boolean
    error: string | null
  }> = []
  try {
    for (const readerMode of ['r', 'r+'] as const) {
      for (const readerHeld of [false, true]) {
        for (const writerHeld of [false, true]) {
          const name = `${readerMode === 'r' ? 'read' : 'read-write'}-${readerHeld}-${writerHeld}`
          const selected = join(root, name + '.json')
          const staged = join(root, name + '.staged')
          const before = Buffer.from('{"fictional":"old"}')
          const after = Buffer.from('{"fictional":"new"}')
          writeFileSync(selected, before, { flag: 'wx', mode: 0o600 })
          let reader: number | undefined = openSync(selected, readerMode)
          let writer: number | undefined = openSync(staged, 'wx', 0o600)
          try {
            writeFileSync(writer, after)
            fsyncSync(writer)
            if (!readerHeld) {
              closeSync(reader)
              reader = undefined
            }
            if (!writerHeld) {
              closeSync(writer)
              writer = undefined
            }
            let error: string | null = null
            try {
              renameSync(staged, selected)
            } catch (failure) {
              error = (failure as NodeJS.ErrnoException).code ?? String(failure)
            }
            observations.push({ readerMode, readerHeld, writerHeld, error })
            expect(readFileSync(selected)).toEqual(error === null ? after : before)
            if (reader !== undefined) expect(readFileSync(reader)).toEqual(before)
            if (error !== null) {
              expect(readFileSync(staged)).toEqual(after)
              if (reader !== undefined) {
                closeSync(reader)
                reader = undefined
              }
              if (writer !== undefined) {
                closeSync(writer)
                writer = undefined
              }
              // One released-handle control identifies the failed attempt; no writer retry policy.
              renameSync(staged, selected)
              expect(readFileSync(selected)).toEqual(after)
            }
          } finally {
            if (reader !== undefined) closeSync(reader)
            if (writer !== undefined) closeSync(writer)
          }
        }
      }
    }
    expect(observations).toHaveLength(8)
    expect(observations.filter((one) => !one.readerHeld && !one.writerHeld)).toEqual([
      { readerMode: 'r', readerHeld: false, writerHeld: false, error: null },
      { readerMode: 'r+', readerHeld: false, writerHeld: false, error: null },
    ])
  } finally {
    console.info(
      'native-snapshot-handles',
      JSON.stringify({ node: process.version, platform: process.platform, observations }),
    )
    rmSync(root, { recursive: true, force: true })
  }
})
