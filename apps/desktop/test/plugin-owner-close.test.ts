import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'

const owners: PluginSupervisor[] = []
const leases: PluginWorkspaceLease[] = []
const roots: string[] = []
afterEach(async () => {
  for (const lease of leases.splice(0)) await lease.close().catch(() => undefined)
  for (const owner of owners.splice(0)) await owner.shutdown()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function owner() {
  const root = realpathSync(
    mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-owner-close-')),
  )
  roots.push(root)
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const result = await PluginSupervisor.start({
    root: join(root, 'plugins'),
    workspaceRoots: [workspace],
    drainWithin: 1000,
  })
  owners.push(result)
  leases.push(
    await PluginWorkspaceLease.attach({
      root: join(root, 'plugins'),
      workspaceRoot: workspace,
      generation: randomUUID(),
      build: 'fictional-build',
    }),
  )
  return result
}

it.each(['pending', 'rejected', 'throws'] as const)(
  'notifies lifecycle cleanup once without holding zero-child shutdown when it %s',
  async (outcome) => {
    const current = await owner()
    const close = vi.fn((): Promise<void> => {
      if (outcome === 'throws') throw new Error('Fictional lifecycle cleanup error')
      if (outcome === 'rejected') return Promise.reject(new Error('Fictional cleanup rejection'))
      return new Promise(() => {})
    })
    const bridge = { routes: async () => [], revoke() {}, close }
    current.bindAgentBridge(bridge)
    expect(await Promise.all([current.shutdown(), current.shutdown()])).toEqual([true, true])
    expect(close).toHaveBeenCalledOnce()
  },
)

it('notifies lifecycle cleanup before stopping captured children and still waits for their exit', async () => {
  const current = await owner()
  const events: string[] = []
  let exit!: () => void
  const exited = new Promise<void>((resolve) => {
    exit = resolve
  })
  current.adopt({
    stop() {
      events.push('stop')
    },
    exited,
    descendantsGone: async () => true,
  })
  const bridge = {
    routes: async () => [],
    revoke() {},
    async close() {
      events.push('close')
    },
  }
  current.bindAgentBridge(bridge)
  const closing = current.shutdown()
  await vi.waitFor(() => expect(events).toContain('stop'))
  let settled = false
  void closing.then(() => {
    settled = true
  })
  await new Promise<void>((resolve) => setImmediate(resolve))
  try {
    expect(settled).toBe(false)
    expect(events).toEqual(['close', 'stop'])
  } finally {
    exit()
  }
  expect(await closing).toBe(true)
})
