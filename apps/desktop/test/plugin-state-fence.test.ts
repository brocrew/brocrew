import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
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
  output = ''
beforeAll(async () => {
  if (process.platform === 'win32') return
  output = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-plugin-lock-bundle-'))
  bundle = await bundleAWorker('src/main/plugins/state/disk.ts', output, 'lock.cjs')
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
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-plugin-lock-'))
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
        const fence = fs.lstatSync(join(options.root, 'writer-lock.sqlite'), { bigint: true })
        const originalClose = fs.closeSync,
          fenceCloses: number[] = []
        const opened = vi.spyOn(fs, 'openSync'),
          closed = vi.spyOn(fs, 'closeSync').mockImplementation((fd) => {
            const stat = fs.fstatSync(fd, { bigint: true })
            if (stat.dev === fence.dev && stat.ino === fence.ino) fenceCloses.push(fd)
            originalClose(fd)
          })
        try {
          expect(() => GlobalPluginState.open(options)).toThrow(
            expect.objectContaining({ code: 'busy' }),
          )
          expect(
            opened.mock.calls.filter(([path]) => String(path).endsWith('writer-lock.sqlite')),
          ).toEqual([])
          expect(fenceCloses).toEqual([])
        } finally {
          opened.mockRestore()
          closed.mockRestore()
        }
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
    it('worker-thread disk refusal opens no descriptor', async () => {
      const { options } = fixture()
      const worker = new Worker(
        `
        const { parentPort, workerData } = require('node:worker_threads');
        const { PluginStateDisk } = require(workerData.bundle);
        const fs = require('node:fs');
        let opens = 0; const original = fs.openSync;
        fs.openSync = (...args) => { opens++; return original(...args); };
        require('node:module').syncBuiltinESMExports();
        try { new PluginStateDisk({ root: workerData.root, workspaceRoots: [] }); parentPort.postMessage({ code: 'allowed', opens }); }
        catch (error) { parentPort.postMessage({ code: error.code, opens }); }
      `,
        { eval: true, workerData: { root: options.root, bundle } },
      )
      try {
        const [message] = await once(worker, 'message')
        expect(message).toEqual({ code: 'unsupported', opens: 0 })
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
