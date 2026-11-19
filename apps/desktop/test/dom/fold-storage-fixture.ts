import { afterEach, beforeEach, vi } from 'vitest'
import { screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { unmountAll } from './harness'
import { memoryStorage } from './memory-storage'

/** Each file keeps a fresh book per test, read after its setup hook runs. */
export function foldStorage(): () => Storage {
  let storage: Storage
  beforeEach(() => {
    storage = memoryStorage()
    vi.stubGlobal('localStorage', storage)
  })
  afterEach(() => {
    unmountAll()
    vi.unstubAllGlobals()
    screenFacts().update({ cardFiles: null })
  })
  return () => storage
}
