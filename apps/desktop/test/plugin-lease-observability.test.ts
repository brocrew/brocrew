import { afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { keepPluginRootPrivate } from '../src/main/plugins/private-files'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
})
async function fixture(now?: () => number) {
  // Unix socket paths have a native 100-byte bound; use a short, still fictional root.
  const temp = realpathSync(
    mkdtempSync(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-lt-')),
  )
  const root = join(temp, 'plugins'),
    workspace = join(temp, 'workspace')
  mkdirSync(root, { mode: 0o700 })
  mkdirSync(workspace, { mode: 0o700 })
  await keepPluginRootPrivate(root)
  const owner = await PluginSupervisor.start({
    root,
    workspaceRoots: [workspace],
    tickEvery: 60_000,
    ...(now ? { now } : {}),
  })
  const generation = randomUUID()
  const client = await PluginWorkspaceLease.attach({
    root,
    workspaceRoot: workspace,
    generation,
    build: 'fictional-build',
  })
  cleanups.push(async () => {
    await client.close().catch(() => false)
    await owner.shutdown()
    rmSync(temp, { recursive: true, force: true })
  })
  return { root, owner, client, generation, log: join(root, 'plugin-lease.log') }
}

it('correlates an app renewal and owner receipt without recording the lease secret', async () => {
  const f = await fixture()
  await f.client.renew()
  expect(existsSync(f.log)).toBe(true)
  const log = readFileSync(f.log, 'utf8')
  for (const stage of [
    'request-dispatch',
    'request-received',
    'renewal-accepted',
    'request-complete',
  ])
    expect(log).toContain(`stage=${stage}`)
  expect(log).toContain('role=app')
  expect(log).toContain('role=owner')
  expect(log).toContain(`generation=${f.generation}`)
  expect(log).toContain('counter=1')
  expect(log).toMatch(/elapsedMs=\d+/)
  expect(log).not.toContain(f.client.lease)
  expect(log).not.toMatch(/[a-f0-9]{64}|fictional-lease-trace|Authorization|Bearer/)
})

it('records expiry as an observed decision without claiming a renewal cause', async () => {
  let now = 0
  const f = await fixture(() => now)
  now = 60_001
  expect(f.owner.valid(f.client.lease, f.client.epoch)).toBe(false)
  const log = readFileSync(f.log, 'utf8')
  expect(log).toContain('stage=lease-expired')
  expect(log).toContain('leaseAgeMs=60001')
  expect(log).not.toMatch(/starvation|admission-read|journal/)
})

it('an unwritable diagnostic destination does not change renewal authority', async () => {
  const f = await fixture()
  mkdirSync(f.log)
  await expect(f.client.renew()).resolves.toBeUndefined()
  expect(f.owner.valid(f.client.lease, f.client.epoch)).toBe(true)
})
