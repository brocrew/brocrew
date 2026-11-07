import { expect, it } from 'vitest'
import type { AppLifetime, AppLifetimeDeps } from '../../src/main/app-lifetime'

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

export function registerQuitOpenListCases(
  harness: (overrides?: Partial<AppLifetimeDeps>) => { lifetime: AppLifetime; log: string[] },
  quitEvent: () => { event: { preventDefault(): void }; readonly prevented: number },
): void {
    it('keeps the open list before stop callbacks and a slow drain', async () => {
      const held = deferred()
      const order: string[] = []
      const { lifetime } = harness({
        recordOpenSessions: () => {
          order.push('record')
        },
        stopArchiveWork: () => {
          order.push('stop')
        },
        closeAllSessions: () => held.promise,
      })
      lifetime.beforeQuit(quitEvent().event)
      try {
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(order).toEqual(['record', 'stop'])
      } finally {
        held.resolve()
        await lifetime.shuttingDown
      }
    })

    it('still quits when keeping the open list fails', async () => {
      const { lifetime, log } = harness({
        recordOpenSessions: () => {
          throw new Error('fictional open-list write failure')
        },
      })
      lifetime.beforeQuit(quitEvent().event)
      await lifetime.shuttingDown
      expect(log).toContain('closeAllSessions')
      expect(log).toContain('closeDatabase')
      expect(log.at(-1)).toBe('quit')
    })

}
