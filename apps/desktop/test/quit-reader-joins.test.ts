import { expect, it } from 'vitest'
import { RuntimeHost } from '../src/main/runtime/runtime-host'

it.each(['success', 'sign-in failure', 'session failure'])(
  'joins every admitted reader on %s and repeats the same shutdown',
  async (mode) => {
    const finished: string[] = []
    const release: Array<() => void> = []
    let finishSession!: () => void
    let sessionStarted!: () => void
    const sessionActive = new Promise<void>((resolve) => {
      sessionStarted = resolve
    })
    const finalWrite = new Promise<void>((resolve) => {
      finishSession = resolve
    })
    let finalWriteFinished = false
    const names = [
      'memoryKnowledge',
      'limitsReader',
      'workSearchReader',
      'pastWorkSearchReader',
      'windowReader',
      'filesLibraries',
      'teamProfileGraphs',
    ]
    const deps = Object.fromEntries(
      names.map((name) => [
        name,
        {
          close: () =>
            new Promise<void>((resolve) =>
              release.push(() => {
                finished.push(name)
                resolve()
              }),
            ),
        },
      ]),
    )
    // Only the surrounding host effects are fictional; closeAll and its join are the product methods.
    const host = Object.assign(Object.create(RuntimeHost.prototype), {
      deps: { ...deps, store: {} },
      recordOpenForQuit() {},
      stopHearingCommits() {},
      windowIncidentReads: { invalidate() {} },
      launches: { closeAdmission() {}, pending: () => Promise.resolve(), size: 0 },
      providerLimitExpiry: null,
      providerLimitFacts: { invalidate() {} },
      signInReopens: { close() {} },
      signIns: new Map([['fictional-sign-in', { signIn: {} }]]),
      boundedCancel: async () => {
        if (mode === 'sign-in failure') throw new Error('fictional sign-in failed')
      },
      wakeUps: new Map(),
      theResets: new Map(),
      slots: new Map([
        ['fictional-failure', {}],
        ['fictional-final-write', {}],
      ]),
      close: async (id: string) => {
        if (id === 'fictional-failure') {
          if (mode === 'session failure') throw new Error('fictional session failed')
          return
        }
        sessionStarted()
        await finalWrite
        finalWriteFinished = true
      },
      closeDrainTimeoutMs: 100,
    }) as RuntimeHost
    let settled = false
    const closing = host.closeAll()
    const outcome = closing
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
      .finally(() => {
        settled = true
      })
    expect(host.closeAll()).toBe(closing)
    // All readers are admitted in the next microtask, without a scheduling sleep.
    await Promise.resolve()
    await Promise.resolve()
    expect(release).toHaveLength(names.length)
    expect(settled).toBe(false)
    for (const finish of release.slice(0, -1)) finish()
    await Promise.resolve()
    expect(settled).toBe(false)
    release.at(-1)!()
    await sessionActive
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(finalWriteFinished).toBe(false)
    finishSession()
    const result = await outcome
    expect(finalWriteFinished).toBe(true)
    expect(finished).toEqual(names)
    if (mode === 'success') expect(result.ok).toBe(true)
    else {
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(AggregateError)
        expect((result.error as AggregateError).errors[0].message).toContain(
          mode === 'sign-in failure' ? 'sign-in failed' : 'session failed',
        )
      }
    }
  },
)
