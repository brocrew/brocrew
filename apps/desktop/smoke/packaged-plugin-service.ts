// Exercise the shipped service through the app's real durable launcher, without plugins or accounts.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { recordPluginStartupFailure } from '../src/main/plugins/startup-failure'

export async function smoke(resources: string, scratch: string) {
  const root = join(scratch, 'p')
  const workspace = join(scratch, 'w')
  await mkdir(workspace, { mode: 0o700 })
  const launch = createPluginSupervisorLauncher({
    root,
    workspaceRoots: [workspace],
    resourcesRoot: resources,
  })
  let lease: PluginWorkspaceLease | undefined
  let pid: number | undefined
  const alive = () => {
    if (!pid) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw error
    }
  }
  try {
    lease = await PluginWorkspaceLease.attach({
      root,
      workspaceRoot: workspace,
      generation: randomUUID(),
      build: 'packaged-service-smoke',
      launch,
    })
    const launches = join(root, 'supervisor-launches')
    const names = await readdir(launches)
    assert.equal(names.length, 1)
    const receipt = JSON.parse(await readFile(join(launches, names[0]!, 'service.json'), 'utf8'))
    assert.equal(receipt.ready, true)
    assert.ok(Number.isSafeInteger(receipt.pid) && receipt.pid > 1 && receipt.pid !== process.pid)
    pid = receipt.pid
    // Observe the live shipped process after startup, then require an authenticated response.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.equal(alive(), true, 'packaged plugin service exited after readiness')
    await lease.renew()
    assert.equal(await lease.close(), true, 'packaged plugin service did not drain')
    lease = undefined
    const until = performance.now() + 5000
    while (alive() && performance.now() < until)
      await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(alive(), false, 'packaged plugin service did not exit after release')
    console.log('[plugin-service-check] ready, alive, authenticated, drained and exited')
  } catch (error) {
    await recordPluginStartupFailure(root, 'service-start', error)
    console.error(await readFile(join(root, 'plugin-startup.log'), 'utf8'))
    throw error
  } finally {
    await lease?.close()
    // This PID came only from this smoke's fresh launch receipt. Never target an incumbent.
    if (alive()) process.kill(pid!, 'SIGTERM')
  }
}
