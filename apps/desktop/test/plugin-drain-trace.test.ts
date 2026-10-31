import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { recordDrainTrace, type DrainTrace } from '../src/main/plugins/supervisor/drain-trace'
import { ownerDiagnosticLine } from '../src/main/plugins/supervisor/protocol'
import { keepPluginRootPrivate } from '../src/main/plugins/private-files'

let parent = ''
let owner: PluginSupervisor | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  if (owner) {
    await owner.shutdown()
    await owner.closed
    owner = undefined
  }
  if (parent) await rm(parent, { recursive: true, force: true })
}, 30_000)
it('logs actual drain stages and a sanitized failed-write errno while retaining the fence', async () => {
  parent = await realpath(
    await mkdtemp(join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-drain-trace-')),
  )
  const root = join(parent, 'plugins')
  await keepPluginRootPrivate(root)
  await mkdir(join(parent, 'workspace'))
  const events: DrainTrace[] = []
  owner = await PluginSupervisor.start({
    root,
    workspaceRoots: [],
    drainWithin: 30,
    traceDrain: (event) => {
      events.push(event)
      recordDrainTrace(root, event)
    },
  })
  const write = SupervisorStorage.prototype.write
  let denied = false
  vi.spyOn(SupervisorStorage.prototype, 'write').mockImplementation(function (
    this: SupervisorStorage,
    value,
  ) {
    if (value.phase === 'stopped' && !denied) {
      denied = true
      throw Object.assign(new Error('Bearer fictional-secret /fictional/private-path'), {
        code: 'EBUSY',
      })
    }
    return write.call(this, value)
  })
  expect(await owner.shutdown()).toBe(false)
  await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
    code: 'busy',
  })
  await owner.closed
  expect(events).toEqual([
    { stage: 'child-proofs', state: 'waiting' },
    { stage: 'child-proofs', state: 'complete' },
    { stage: 'server.close', state: 'waiting' },
    { stage: 'server.close', state: 'complete' },
    { stage: 'stopped-write', state: 'waiting', attempt: 1 },
    { stage: 'stopped-write', state: 'failed', attempt: 1, errno: 'EBUSY' },
    { stage: 'stopped-write', state: 'waiting', attempt: 2 },
    { stage: 'stopped-write', state: 'complete', attempt: 2 },
    { stage: 'closed', state: 'complete' },
  ])
  const log = await readFile(join(root, 'plugin-drain.log'), 'utf8')
  expect(log).toContain('stage=stopped-write state=failed attempt=1 errno=EBUSY')
  expect(log).not.toMatch(/fictional-secret|private-path|Bearer/)
})
it('gives a plain Restart remedy in a restart-required phase diagnostic', () => {
  const text = ownerDiagnosticLine({
    phase: 'blocked',
    stage: 'recovery',
    probe: 'no-answer',
    reason: 'restart-required',
  })
  expect(text).toContain('Restart your computer')
  if (process.platform === 'win32') expect(text).toContain('Start > Power > Restart')
  expect(text).not.toContain('Shut down')
})
