import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bundleAWorker } from './helpers/bundle-a-worker'
import { connectPersonPluginControl } from '../src/main/plugins/lifecycle/person-control'

const children: ChildProcess[] = [],
  roots: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exit = once(child, 'exit')
    child.kill('SIGKILL')
    await exit
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
async function launch(bundle: string, root: string) {
  const child = spawn(process.execPath, [bundle, root], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    windowsHide: true,
  })
  children.push(child)
  child.stderr?.resume()
  const ready = await new Promise<{ ready: boolean; path: string; epoch: string }>(
    (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fictional service did not start')), 10000)
      child.once('message', (message) => {
        clearTimeout(timer)
        resolve(message as { ready: boolean; path: string; epoch: string })
      })
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('fictional service exited before readiness'))
      })
    },
  )
  expect(ready.ready).toBe(true)
  return { child, ...ready }
}
describe('settings service recovery at the selected root', () => {
  it('reconnects settings after the real service is killed, including its stale local endpoint', async () => {
    const parent = mkdtempSync(
      join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-service-'),
    )
    roots.push(parent)
    const root = join(parent, 'plugins'),
      bundle = await bundleAWorker(
        'test/fixtures/plugin-settings-service.ts',
        parent,
        'settings.cjs',
      )
    const first = await launch(bundle, root)
    const before = await connectPersonPluginControl({
      path: first.path,
      key: 'fictional-settings-instance',
      handle: async () => true,
    })
    await before.call({ kind: 'attach', workspaceId: randomUUID() })
    expect(await before.call({ kind: 'list-v2' })).toMatchObject([
      { id: 'fictional-kite', state: 'Running' },
    ])
    const exited = once(first.child, 'exit')
    expect(first.child.kill('SIGKILL')).toBe(true)
    await exited
    before.close()
    const next = await launch(bundle, root)
    expect(next.epoch).not.toBe(first.epoch)
    const after = await connectPersonPluginControl({
      path: next.path,
      key: 'fictional-settings-instance',
      handle: async () => true,
    })
    try {
      await after.call({ kind: 'attach', workspaceId: randomUUID() })
      expect(await after.call({ kind: 'list-v2' })).toMatchObject([
        { id: 'fictional-kite', state: 'Running' },
      ])
    } finally {
      after.close()
    }
    const stopped = once(next.child, 'exit')
    next.child.kill('SIGTERM')
    await stopped
  })
})
