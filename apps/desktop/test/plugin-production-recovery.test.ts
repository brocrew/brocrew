import { afterEach, describe, expect, it, vi } from 'vitest'
import { setup, seams } from './plugin-production-fixtures'
import { PluginSupervisorLaunchFailure } from '../src/main/plugins/startup-failure'
import {
  PluginSupervisorAttachment,
  PluginWorkspaceLease,
} from '../src/main/plugins/supervisor/client'
import { readPluginInstructions } from '../src/main/plugins/instructions'

describe('automatic initial service recovery', () => {
  afterEach(() => vi.useRealTimers())
  async function failingStart() {
    const f = await setup()
    const lease = {
      close: vi.fn(async () => true),
      standing: () => false,
      features: [],
      agentRoutes: vi.fn(async () => ({ format: 1, value: [] })),
    }
    let failures = 0
    const attach = vi.spyOn(PluginWorkspaceLease, 'attach').mockImplementation(async () => {
      failures++
      throw new PluginSupervisorLaunchFailure({
        exitCode: failures,
        signal: null,
        stderr: `Error: startup attempt ${failures}`,
      })
    })
    const supervisor = new PluginSupervisorAttachment()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    f.controller.start({ ...f.options, supervisor })
    await f.controller.ready!()
    const advance = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms)
      await f.controller.ready!()
    }
    return { ...f, attach, lease, supervisor, advance }
  }
  it('recovers from one failed start without a page and admits usable routes once', async () => {
    const f = await failingStart()
    try {
      f.attach.mockResolvedValue(f.lease as never)
      await f.advance(999)
      expect(f.attach).toHaveBeenCalledOnce()
      await f.advance(1)
      expect(f.attach).toHaveBeenCalledTimes(2)
      expect(seams.connect).toHaveBeenCalledOnce()
      expect(readPluginInstructions(f.controller)?.[0]?.state).toBe('Available')
      await expect(
        f.supervisor.agentRoutes({ workspaceId: 'workspace', incarnation: 'turn', occupied: [] }),
      ).resolves.toEqual({ format: 1, value: [] })
      await f.advance(30_000)
      expect(f.attach).toHaveBeenCalledTimes(2)
    } finally {
      await f.controller.close()
      await f.supervisor.quit()
    }
  })
  it('retries at 1/2/4 seconds, retains each stderr, and polling cannot spend or reset the budget', async () => {
    const f = await failingStart()
    try {
      for (const [index, delay] of [1000, 2000, 4000].entries()) {
        for (let poll = 0; poll < 3; poll++) {
          expect(await f.controller.catalogue(poll === 0)).toMatchObject([
            {
              state: 'Unavailable',
              startupDiagnostic: {
                exitCode: index + 1,
                stderr: `Error: startup attempt ${index + 1}`,
              },
            },
          ])
        }
        expect(f.attach).toHaveBeenCalledTimes(index + 1)
        await f.advance(delay - 1)
        expect(f.attach).toHaveBeenCalledTimes(index + 1)
        await f.advance(1)
        expect(f.attach).toHaveBeenCalledTimes(index + 2)
      }
      await f.advance(60_000)
      expect(await f.controller.catalogue()).toMatchObject([
        { startupDiagnostic: { exitCode: 4, stderr: 'Error: startup attempt 4' } },
      ])
      expect(f.attach).toHaveBeenCalledTimes(4)
      f.attach.mockResolvedValue(f.lease as never)
      expect(await f.controller.retry!(f.pkg.release.id)).toMatchObject([{ state: 'Available' }])
      expect(f.attach).toHaveBeenCalledTimes(5)
      expect(seams.connect).toHaveBeenCalledOnce()
    } finally {
      await f.controller.close()
      await f.supervisor.quit()
    }
  })
  it('manual retry and status join an automatic admission already in flight', async () => {
    const f = await failingStart()
    let admit!: (lease: never) => void
    f.attach.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          admit = resolve
        }),
    )
    try {
      await vi.advanceTimersByTimeAsync(1000)
      await vi.waitFor(() => expect(f.attach).toHaveBeenCalledTimes(2))
      const retry = f.controller.retry!(f.pkg.release.id)
      const status = f.controller.catalogue()
      expect(f.attach).toHaveBeenCalledTimes(2)
      admit(f.lease as never)
      await Promise.all([retry, status])
      await f.advance(30_000)
      expect(f.attach).toHaveBeenCalledTimes(2)
      expect(seams.connect).toHaveBeenCalledOnce()
    } finally {
      admit?.(f.lease as never)
      await f.controller.close()
      await f.supervisor.quit()
    }
  })
  it('counts backoff from a failed attempt completing, and close waits for an active attempt', async () => {
    const f = await failingStart()
    let fail!: (error: Error) => void
    let admit: ((lease: never) => void) | undefined
    f.attach.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    try {
      await vi.advanceTimersByTimeAsync(1000)
      await vi.waitFor(() => expect(f.attach).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(f.attach).toHaveBeenCalledTimes(2)
      fail(new Error('held startup failed'))
      await f.controller.ready!()
      await f.advance(1999)
      expect(f.attach).toHaveBeenCalledTimes(2)
      await f.advance(1)
      expect(f.attach).toHaveBeenCalledTimes(3)
      f.attach.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            admit = resolve
          }),
      )
      await vi.advanceTimersByTimeAsync(4000)
      await vi.waitFor(() => expect(f.attach).toHaveBeenCalledTimes(4))
      const closing = f.controller.close()
      admit!(f.lease as never)
      await closing
      await f.advance(60_000)
      expect(f.attach).toHaveBeenCalledTimes(4)
      expect(seams.connect).not.toHaveBeenCalled()
    } finally {
      fail?.(new Error('release held failure'))
      admit?.(f.lease as never)
      await f.controller.close()
      await f.supervisor.quit()
    }
  })
  it('Try again during blocked cleanup preserves autonomous recovery', async () => {
    const f = await setup()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    f.controller.start(f.options)
    await f.controller.ready!()
    ;(seams.connect.mock.calls[0]![0] as { lost(): void }).lost()
    await f.controller.retry!(f.pkg.release.id)
    expect(seams.connect).toHaveBeenCalledOnce()
    f.supervisor.stoppedCleanly.mockReturnValue(true)
    await vi.advanceTimersByTimeAsync(1000)
    await f.controller.ready!()
    expect(seams.connect).toHaveBeenCalledTimes(2)
  })
  it.each(['close', 'manual'] as const)('%s cancels the pending backoff', async (action) => {
    const f = await failingStart()
    try {
      f.attach.mockResolvedValue(f.lease as never)
      if (action === 'close') await f.controller.close()
      else
        await Promise.all([
          f.controller.retry!(f.pkg.release.id),
          f.controller.retry!(f.pkg.release.id),
        ])
      await f.advance(30_000)
      expect(f.attach).toHaveBeenCalledTimes(action === 'close' ? 1 : 2)
      expect(seams.connect).toHaveBeenCalledTimes(action === 'close' ? 0 : 1)
    } finally {
      await f.controller.close()
      await f.supervisor.quit()
    }
  })
})
