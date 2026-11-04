import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GlobalPluginState } from '../src/main/plugins/state/store'
import { PluginStateDisk } from '../src/main/plugins/state/disk'
import { bundleAWorker } from './helpers/bundle-a-worker'

const roots: string[] = [],
  stores: GlobalPluginState[] = [],
  disks: PluginStateDisk[] = [],
  children: ChildProcess[] = []
let bundle = '',
  storeBundle = '',
  output = ''
beforeAll(async () => {
  output = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-plugin-lock-bundle-'),
  )
  bundle = await bundleAWorker('src/main/plugins/state/disk.ts', output, 'lock.cjs')
  storeBundle = await bundleAWorker('src/main/plugins/state/store.ts', output, 'store.cjs')
})

describe('read-only selected installation observation', () => {
  it('reads complete selections while another real process publishes replacements', async () => {
    const { options, store } = fixture()
    const input = {
      operationId: 'a1111111-1111-4111-8111-111111111111',
      consent: {
        action: 'install',
        pluginId: 'fictional-kite',
        at: 0,
        expectedSequence: store.inspect().sequence,
        expectedInstallId: null,
        release: {
          version: '1.0.0',
          archiveSha256: 'a'.repeat(64),
          manifestSha256: 'b'.repeat(64),
          dataSchema: 1,
        },
      },
      snapshot: null,
    }
    store.prepare(input)
    store.complete(input.operationId)
    const child = spawn(
      process.execPath,
      [
        '-e',
        `
      const { GlobalPluginState } = require(process.argv[1]);
      const { randomUUID } = require('node:crypto');
      const state = GlobalPluginState.open({ root: process.argv[2], workspaceRoots: [] });
      process.once('message', async () => {
        try {
          for (let index = 2; index <= 30; index++) {
            const view = state.inspect(), before = view.guards[0], id = randomUUID();
            state.prepare({ operationId: id, snapshot: null, consent: { action: 'update', pluginId: 'fictional-kite', at: index, expectedSequence: view.sequence, expectedInstallId: before.installId, release: { ...before.release, version: index + '.0.0' } } });
            state.complete(id);
            await new Promise(resolve => setTimeout(resolve, 2));
          }
          state.close(); process.exit(0);
        } catch { state.close(); process.exit(1); }
      });
      process.send('ready');
    `,
        storeBundle,
        options.root,
      ],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true },
    )
    children.push(child)
    const [ready] = await once(child, 'message')
    expect(ready).toBe('ready')
    let done = false,
      reads = 0
    const exited = once(child, 'exit').then(() => {
      done = true
    })
    child.send('go')
    while (!done) {
      const selected = GlobalPluginState.readInstalledPackage(options, 'fictional-kite')
      expect(selected).toMatchObject({
        archiveSha256: 'a'.repeat(64),
        manifestSha256: 'b'.repeat(64),
      })
      expect(selected?.version).toMatch(/^\d+\.0\.0$/)
      reads++
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    await exited
    expect(child.exitCode).toBe(0)
    expect(reads).toBeGreaterThan(1)
    expect(GlobalPluginState.readInstalledPackage(options, 'fictional-kite')?.version).toBe(
      '30.0.0',
    )
  })
})
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }
  for (const disk of disks.splice(0)) disk.close()
  for (const store of stores.splice(0)) store.close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
afterAll(() => {
  if (output) rmSync(output, { recursive: true, force: true })
})
function fixture() {
  const parent = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-plugin-lock-'),
  )
  roots.push(parent)
  const options = { root: join(parent, 'plugins'), workspaceRoots: [] }
  const store = GlobalPluginState.create(options)
  stores.push(store)
  const disk = new PluginStateDisk(options)
  disks.push(disk)
  return { options, store, disk }
}
const program = `
const { PluginStateDisk } = require(process.argv[1]);
let disk;
try {
  disk = new PluginStateDisk({ root: process.argv[2], workspaceRoots: [] });
  if (process.argv[3] === 'hold') {
    disk.withExclusive(async () => {
      process.send('held');
      await new Promise(() => { setInterval(() => {}, 1000); });
    }).catch(() => { process.send('failed'); process.exit(1); });
  } else {
    disk.reclaim(); disk.close(); process.send('acquired'); process.exit(0);
  }
} catch (error) {
  disk?.close(); process.send(error.code === 'busy' ? 'busy' : 'failed'); process.exit(0);
}
`
async function launch(root: string, mode: 'probe' | 'hold') {
  const child = spawn(process.execPath, ['-e', program, bundle, root, mode], {
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  children.push(child)
  const message = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fictional lock child did not answer')), 10_000)
    child.once('message', (value) => {
      clearTimeout(timer)
      resolve(value)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', () => {
      clearTimeout(timer)
      reject(new Error('fictional lock child exited before answering'))
    })
  })
  return { child, message }
}

describe.skipIf(process.platform === 'win32')(
  'plugin writer fence with real Node processes',
  () => {
    it('third process stays excluded after a refused opener and another instance close in the holder process', async () => {
      const { options, disk } = fixture()
      const second = GlobalPluginState.open(options)
      stores.push(second)
      await disk.withExclusive(async () => {
        expect(() => GlobalPluginState.open(options)).toThrow(
          expect.objectContaining({ code: 'busy' }),
        )
        second.close()
        expect((await launch(options.root, 'probe')).message).toBe('busy')
        expect(disk.load().pending).toBeNull()
      })
      expect((await launch(options.root, 'probe')).message).toBe('acquired')
    })
    it('a real holder killed with SIGKILL releases exclusion for another process and the parent', async () => {
      const { options, store } = fixture()
      const { child, message } = await launch(options.root, 'hold')
      expect(message).toBe('held')
      expect((await launch(options.root, 'probe')).message).toBe('busy')
      expect(() => GlobalPluginState.open(options)).toThrow(
        expect.objectContaining({ code: 'busy' }),
      )
      const exited = once(child, 'exit')
      expect(child.kill('SIGKILL')).toBe(true)
      const [code, signal] = await exited
      expect(code).toBeNull()
      expect(signal).toBe('SIGKILL')
      expect((await launch(options.root, 'probe')).message).toBe('acquired')
      const reopened = GlobalPluginState.open(options)
      stores.push(reopened)
      expect(reopened.inspect()).toEqual(store.inspect())
    })
    it('worker-thread storage uses ordinary filesystem access', async () => {
      const { options } = fixture()
      const worker = new Worker(
        `
        const { parentPort, workerData } = require('node:worker_threads');
        const { PluginStateDisk } = require(workerData.bundle);
        const fs = require('node:fs');
        let opens = 0; const original = fs.openSync;
        fs.openSync = (...args) => { opens++; return original(...args); };
        require('node:module').syncBuiltinESMExports();
        try { const disk = new PluginStateDisk({ root: workerData.root, workspaceRoots: [] }); disk.load(); disk.close(); parentPort.postMessage({ code: 'allowed' }); }
        catch (error) { parentPort.postMessage({ code: error.code, opens }); }
      `,
        { eval: true, workerData: { root: options.root, bundle } },
      )
      try {
        const [message] = await once(worker, 'message')
        expect(message).toEqual({ code: 'allowed' })
      } finally {
        await worker.terminate()
      }
    })
    it('last-reference close waits for its active async lease before closing the shared descriptors', async () => {
      const { options, store, disk } = fixture()
      store.close()
      await disk.withExclusive(async () => {
        disk.close()
        expect((await launch(options.root, 'probe')).message).toBe('busy')
      })
      expect((await launch(options.root, 'probe')).message).toBe('acquired')
    })
    it('store async ownership is reentrant only in its owning context', async () => {
      const { options, store } = fixture(),
        other = GlobalPluginState.open(options)
      stores.push(other)
      await store.withExclusive(async () => {
        const before = store.inspect()
        await Promise.resolve()
        expect(store.inspect()).toEqual(before)
        await store.withExclusive(async () => {
          expect(store.inspect()).toEqual(before)
        })
        expect(() => other.inspect()).toThrow(expect.objectContaining({ code: 'busy' }))
        await expect(other.withExclusive(async () => other.inspect())).rejects.toMatchObject({
          code: 'busy',
        })
      })
    })
    it('queues async callers FIFO while synchronous unrelated callers refuse busy', async () => {
      const { options, disk } = fixture(),
        second = new PluginStateDisk(options)
      disks.push(second)
      let release: () => void = () => {
        throw new Error('fictional barrier not ready')
      }
      const barrier = new Promise<void>((resolve) => {
          release = resolve
        }),
        order: number[] = []
      const a = disk.withExclusive(async () => {
        order.push(1)
        await barrier
        expect(disk.load().pending).toBeNull()
      })
      const b = second.withExclusive(async () => {
        order.push(2)
        expect(second.load().pending).toBeNull()
      })
      const c = disk.withExclusive(async () => {
        order.push(3)
      })
      expect(order).toEqual([1])
      expect(() => second.load()).toThrow(expect.objectContaining({ code: 'busy' }))
      release()
      await Promise.all([a, b, c])
      expect(order).toEqual([1, 2, 3])
    })
  },
)
