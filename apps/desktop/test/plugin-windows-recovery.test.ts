import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { previousRunsProvenStopped } from '../src/main/plugins/supervisor/recovery-proof'

const native = vi.hoisted(() => ({
  recover: vi.fn<(name: string, cache: string) => Promise<boolean>>(async () => true),
}))
vi.mock('../resources/plugin-host/windows-job.mjs', async (original) => ({
  ...(await original<typeof import('../resources/plugin-host/windows-job.mjs')>()),
  recoverWindowsJob: native.recover,
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
let root: string,
  run: string,
  processRecord: Record<string, unknown>,
  job: Record<string, unknown>
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fictional-windows-recovery-'))
  const runId = randomUUID(),
    nonce = randomUUID()
  run = join(root, 'host/runs', runId)
  await mkdir(run, { recursive: true })
  processRecord = {
    format: 1,
    runId,
    pluginId: 'fictional',
    releaseDigest: 'f'.repeat(64),
    guardianPid: 40000,
    groups: [[40001, '123456789']],
  }
  job = {
    ...processRecord,
    nonce,
    state: 'assigned-ready',
    server: { pid: 40001, birth: '123456789' },
    job: {
      format: 1,
      name: `Local\\BroCrew.Plugin.${nonce}`,
      guardian: { pid: 40000, birth: '123456780' },
      keeper: { pid: 40002, birth: '123456781' },
      boot: { kind: 'windows-tick64-v1', value: '1000' },
    },
  }
  await writeFile(join(run, 'process.json'), JSON.stringify(processRecord))
  await writeFile(join(run, 'job-ready.json'), JSON.stringify(job))
  native.recover.mockReset().mockResolvedValue(true)
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
})
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  await rm(root, { recursive: true, force: true })
})

it.each(['missing', 'failed'])(
  'recovers a recorded Windows job after a %s exit receipt without asking for a boot observation',
  async (exit) => {
    if (exit === 'failed')
      await writeFile(join(run, 'exit.json'), JSON.stringify({ ...processRecord, exited: false }))
    const reboot = vi.fn()
    expect(
      await previousRunsProvenStopped(root, {
        previous: null,
        readBootWitness: reboot,
        onRebootRequired: reboot,
      }),
    ).toBe(true)
    expect(native.recover).toHaveBeenCalledOnce()
    expect(native.recover.mock.calls[0]?.[0]).toBe((job.job as { name: string }).name)
    expect(reboot).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(join(run, 'exit.json'), 'utf8'))).toMatchObject({
      ...processRecord,
      exited: true,
    })
  },
)

it('keeps a Windows run unresolved when the native job cannot be stopped and observed empty', async () => {
  native.recover.mockResolvedValue(false)
  expect(await previousRunsProvenStopped(root)).toBe(false)
  expect(native.recover).toHaveBeenCalledOnce()
  await expect(readFile(join(run, 'exit.json'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('accepts a positive exit receipt without reopening its old job', async () => {
  await writeFile(join(run, 'exit.json'), JSON.stringify({ ...processRecord, exited: true }))
  expect(await previousRunsProvenStopped(root)).toBe(true)
  expect(native.recover).not.toHaveBeenCalled()
})

it('keeps a legacy run without recorded job assignment unresolved', async () => {
  await rm(join(run, 'job-ready.json'))
  expect(await previousRunsProvenStopped(root)).toBe(false)
  expect(native.recover).not.toHaveBeenCalled()
})
