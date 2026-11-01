import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { startJobKeeper } from '../resources/plugin-host/windows-job.mjs'

describe.runIf(process.platform === 'win32')('future Windows job identity', () => {
  it('keeps one named job and refuses a second keeper with that name before assignment', async () => {
    const name = `Local\\BroCrew.Plugin.${randomUUID()}`
    const first = startJobKeeper({ name, openMs: 120_000 })
    let second: ReturnType<typeof startJobKeeper> | undefined
    try {
      expect(await first.opened).not.toBeNull()
      const identity = await first.identity()
      expect(identity).toMatchObject({
        format: 1,
        name,
        guardian: { pid: process.pid },
        keeper: { pid: first.pid },
        boot: { kind: 'windows-tick64-v1' },
      })
      expect(identity!.guardian.birth).toMatch(/^[1-9][0-9]{1,19}$/)
      expect(identity!.keeper.birth).toMatch(/^[1-9][0-9]{1,19}$/)
      second = startJobKeeper({ name, openMs: 120_000 })
      expect(await second.opened).toBeNull()
      expect(await first.count()).toBe(0)
    } finally {
      await second?.end()
      await first.end()
    }
  }, 240_000)
})
