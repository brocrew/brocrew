import { describe, expect, it } from 'vitest'
import { isLeftOutside } from './helpers/bundle-a-worker'

/**
 * The tests that run a main-process worker bundle it first, with this repository's own code inside
 * and every installed package required from where it is. Which is which is read from the import as
 * the bundler hands it over, and on Windows a file it has resolved is `D:\…` or `D:/…`.
 */
describe('what a worker bundle leaves outside', () => {
  it('🔴 a file named by its Windows path is this repository’s own, as the entry module is', () => {
    expect(isLeftOutside('D:\\a\\brobot2\\apps\\desktop\\src\\main\\window-reader.worker.ts')).toBe(
      false,
    )
    expect(isLeftOutside('D:/a/brobot2/apps/desktop/src/main/window-reader.worker.ts')).toBe(false)
    expect(isLeftOutside('\\\\server\\share\\brobot2\\worker.ts')).toBe(false)
  })

  it('this repository’s own code by every other spelling goes inside', () => {
    expect(
      isLeftOutside('/home/runner/brobot2/apps/desktop/src/main/window-reader.worker.ts'),
    ).toBe(false)
    expect(isLeftOutside('./window-reader')).toBe(false)
    expect(isLeftOutside('../db/connection')).toBe(false)
    expect(isLeftOutside('@brobot2/runtime')).toBe(false)
  })

  it('an installed package, or Node’s own, is left outside', () => {
    expect(isLeftOutside('better-sqlite3')).toBe(true)
    expect(isLeftOutside('node:worker_threads')).toBe(true)
    expect(isLeftOutside('@electron/asar')).toBe(true)
  })
})
