import { snapshotPath, snapshotFiles } from './helpers/plugin-state-snapshot'
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
import { randomUUID, createHash } from 'node:crypto'
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
  let paused = false, selectedFd;
  const selectedBytes = [];
  fs.readSync = (fd, ...args) => {
    if (!paused && fs.fstatSync(fd).nlink === 1) {
      paused = true; selectedFd = fd;
      process.send({ kind: 'paused', opened: opened.get(fd) });
      const gate = new Int32Array(new SharedArrayBuffer(4)), until = Date.now() + 15000;
      while (!fs.existsSync(process.argv[3])) {
        if (Date.now() > until) throw Error('fictional reader was not released');
        Atomics.wait(gate, 0, 0, 10);
      }
    }
    const count = read(fd, ...args);
    if (fd === selectedFd && count) selectedBytes.push(Buffer.from(args[0].subarray(args[1], args[1] + count)));
    return count;
  };
  syncBuiltinESMExports();
  const descriptor = displayRead({ root: process.argv[2], workspaceRoots: [] }, 'chrome');
  process.send({ kind: 'done', descriptor, snapshotSha256: require('node:crypto').createHash('sha256').update(Buffer.concat(selectedBytes)).digest('hex') });
})().catch(error => { process.send({ kind: 'failed', code: error.code, message: error.message }); process.exitCode = 1; });
`
function message(child: ChildProcess): Promise<{
  kind: string
  descriptor?: unknown
  snapshotSha256?: string
  reads?: number
  malformed?: number
  errors?: Record<string, number>
}> {
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
    heldPath = snapshotPath(root),
    heldBytes = readFileSync(heldPath),
    release = join(folder, 'release')
  const child = spawn(process.execPath, ['-e', program, bundle, root, release], {
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  })
  children.push(child)
  const exited = once(child, 'exit')
  let stderr = ''
  child.stderr!.on('data', (bytes) => {
    stderr += String(bytes)
  })
  const first = await message(child)
  expect(first, stderr).toEqual({
    kind: 'paused',
    opened: { path: heldPath, flags: 'r' },
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
      const selected = JSON.parse(await readFile(snapshotPath(root), 'utf8'))
      expect(selected.pending).toBeNull()
      expect(selected.active.some((one: { pluginId: string }) => one.pluginId === pluginId)).toBe(
        true,
      )
    }
    const retained = snapshotFiles(root)
    console.info(
      'native-disclosure-retention',
      JSON.stringify({
        node: process.version,
        platform: process.platform,
        files: retained.length,
        bytes: retained.reduce((total, file) => total + readFileSync(file.path).length, 0),
        directories: 1,
        heldBytes: heldBytes.length,
      }),
    )
  } finally {
    owner.close()
    await writeFile(release, '')
  }
  const observed = await result
  expect(observed.kind, stderr).toBe('done')
  expect(observed.snapshotSha256).toBe(createHash('sha256').update(heldBytes).digest('hex'))
  expect(await exited).toEqual([0, null])
  expect(observed.descriptor).toEqual({
    version: '1.0.1',
    archiveSha256: f.first.release.archive.sha256,
    manifestSha256: f.first.release.manifestSha256,
  })
  expect(
    f.f.state.inspect().guards.find((one) => one.pluginId === 'chrome')?.release.archiveSha256,
  ).toBe(f.first.release.archive.sha256)
  for (let pass = 0; pass < 8; pass++)
    f.f.state.setEnabled(f.f.workspace, 'chrome', pass % 2 === 0 ? false : true)
  const afterRelease = snapshotFiles(root)
  expect(afterRelease).toHaveLength(2)
  console.info(
    'native-disclosure-after-release',
    JSON.stringify({
      files: afterRelease.length,
      bytes: afterRelease.reduce((total, file) => total + readFileSync(file.path).length, 0),
      directories: 1,
    }),
  )
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

it.each([4096, 65536])(
  'short asynchronous snapshot reads race replacement without partial bytes (%i payload bytes)',
  async (payloadBytes) => {
    const root = mkdtempSync(join(tmpdir(), 'fictional-snapshot-read-race-'))
    closers.push(async () => rmSync(root, { recursive: true, force: true }))
    const selected = join(root, 'installed-state.json')
    const payload = 'x'.repeat(payloadBytes)
    const snapshot = (generation: number) => Buffer.from(JSON.stringify({ generation, payload }))
    writeFileSync(selected, snapshot(0), { flag: 'wx', mode: 0o600 })
    const reader = `
const fs = require('node:fs/promises');
const selected = process.argv[1], payload = 'x'.repeat(Number(process.argv[2]));
let stopping = false, reading = false, reads = 0, malformed = 0;
const errors = {};
process.on('message', message => { if (message.kind === 'stop') stopping = true; });
async function read() {
  while (!stopping) {
    try {
      const bytes = await fs.readFile(selected);
      const value = JSON.parse(bytes);
      if (!Number.isSafeInteger(value.generation) || value.generation < 0 || value.payload !== payload) malformed++;
      reads++;
      if (!reading) { reading = true; process.send({ kind: 'reading' }); }
    } catch (error) {
      const code = error.code ?? String(error);
      errors[code] = (errors[code] ?? 0) + 1;
    }
  }
}
Promise.all(Array.from({ length: 4 }, read)).then(() => {
  process.send({ kind: 'done', reads, malformed, errors }, () => process.disconnect());
}).catch(error => {
  process.send({ kind: 'failed', message: error.message }, () => process.disconnect());
});
`
    const child = spawn(process.execPath, ['-e', reader, selected, String(payloadBytes)], {
      env: { ...process.env, NODE_OPTIONS: '' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      windowsHide: true,
    })
    children.push(child)
    let stderr = ''
    child.stderr!.on('data', (bytes) => {
      stderr += String(bytes)
    })
    expect(await message(child), stderr).toEqual({ kind: 'reading' })
    const result = message(child)
    const exited = once(child, 'exit')
    const errors: Record<string, number> = {}
    let published = 0
    try {
      for (let generation = 1; generation <= 320; generation++) {
        const staged = join(root, `staged-${generation}.json`)
        const fd = openSync(staged, 'wx', 0o600)
        try {
          writeFileSync(fd, snapshot(generation))
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
        try {
          renameSync(staged, selected)
          published++
        } catch (failure) {
          const code = (failure as NodeJS.ErrnoException).code ?? String(failure)
          errors[code] = (errors[code] ?? 0) + 1
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    } finally {
      if (child.connected) child.send({ kind: 'stop' })
    }
    const observed = await result
    const [code, signal] = await exited
    console.info(
      'native-short-read-race',
      JSON.stringify({
        node: process.version,
        platform: process.platform,
        payloadBytes,
        published,
        errors,
        reader: observed,
        readerExit: { code, signal },
      }),
    )
    expect(code, stderr).toBe(0)
    expect(signal).toBeNull()
    expect(observed.kind, stderr).toBe('done')
    expect(observed.reads).toBeGreaterThan(0)
    expect(observed.malformed).toBe(0)
    expect(observed.errors).toEqual({})
    expect(published + Object.values(errors).reduce((sum, count) => sum + count, 0)).toBe(320)
    expect(Object.keys(errors).filter((code) => code !== 'EPERM')).toEqual([])
    const final = JSON.parse(readFileSync(selected, 'utf8')) as {
      generation: number
      payload: string
    }
    expect(final.payload).toBe(payload)
    expect(final.generation).toBeGreaterThanOrEqual(0)
    expect(final.generation).toBeLessThanOrEqual(320)
  },
)
