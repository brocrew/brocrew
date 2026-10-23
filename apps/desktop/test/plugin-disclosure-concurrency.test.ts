import { afterEach, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
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
  const read = fs.readSync;
  let paused = false;
  fs.readSync = (fd, ...args) => {
    if (!paused && fs.fstatSync(fd).nlink === 1) {
      paused = true;
      process.send({ kind: 'paused' });
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
})().catch(() => { process.send({ kind: 'failed' }); process.exitCode = 1; });
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
it('another process holding display reader pins cannot block real owner reclaim', async () => {
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
  expect(first, stderr).toEqual({ kind: 'paused' })
  const result = message(child)
  const owner = new PluginStateDisk({ root, workspaceRoots: [f.f.workspace] })
  try {
    for (let cycle = 0; cycle < 2; cycle++) {
      const state = f.f.state.inspect(),
        operationId = randomUUID(),
        pluginId = `other-plugin-${cycle}`
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
      f.f.state.complete(operationId)
      owner.reclaim()
      expect(owner.load().pending).toBeNull()
      expect(f.f.state.inspect().guards.find((one) => one.pluginId === pluginId)?.phase).toBe(
        'active',
      )
      expect(await readdir(join(root, 'resolution-reservations'))).toEqual([])
    }
  } finally {
    owner.close()
    await writeFile(release, '')
  }
  const observed = await result
  expect(observed.kind, stderr).toBe('done')
  if (observed.descriptor !== null)
    expect(observed.descriptor).toEqual({
      version: '1.0.1',
      archiveSha256: f.first.release.archive.sha256,
      manifestSha256: f.first.release.manifestSha256,
    })
  expect(
    f.f.state.inspect().guards.find((one) => one.pluginId === 'chrome')?.release.archiveSha256,
  ).toBe(f.first.release.archive.sha256)
}, 30000)
