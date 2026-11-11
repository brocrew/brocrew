import { describe, expect, it, vi } from 'vitest'
import type {
  RecoveryRetentionClient,
  RetainedRecoveryCopy,
} from '../src/shared/recovery-retention'
import { createDesktopProviderApi } from '../src/renderer/src/client-provider/desktop'

describe('recovery reads and intents on the existing desktop client adapter', () => {
  it('is lazy and preserves the original recovery receiver, promises and rejection', async () => {
    const failure = new Error('Fictional recovery copy is busy')
    const reading = Promise.resolve<RetainedRecoveryCopy | null>(null)
    const deletion = Promise.reject<void>(failure)
    const deletes: string[] = []
    const recovery: RecoveryRetentionClient & { reading: typeof reading } = {
      reading,
      read() {
        return this.reading
      },
      deleteNow(id) {
        deletes.push(id)
        return deletion
      },
    }
    const native = vi.fn(() => recovery)
    const runtime = vi.fn((): never => {
      throw new Error('Recovery must not read provider transport')
    })
    const api = createDesktopProviderApi(runtime, () => undefined, native)
    expect(native).not.toHaveBeenCalled()
    expect(runtime).not.toHaveBeenCalled()
    expect(api.recoveryCopies).toBe(recovery)
    expect(api.recoveryCopies?.read()).toBe(reading)
    const pending = api.recoveryCopies?.deleteNow('fern-copy')
    expect(pending).toBe(deletion)
    await expect(pending).rejects.toBe(failure)
    expect(deletes).toEqual(['fern-copy'])
    expect(runtime).not.toHaveBeenCalled()
  })

  it('retains an unavailable recovery capability without a desktop fallback', () => {
    const unavailable = vi.fn(() => undefined)
    const api = createDesktopProviderApi(
      (): never => {
        throw new Error('No provider read expected')
      },
      () => undefined,
      unavailable,
    )
    expect(unavailable).not.toHaveBeenCalled()
    expect(api.recoveryCopies).toBeUndefined()
    expect(unavailable).toHaveBeenCalledTimes(1)
  })
})
