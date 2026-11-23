import { afterEach, expect, it, vi } from 'vitest'

/**
 * # The orphan sweep waits for `lsof` and `ps` to exit (card 197)
 *
 * `lsof` was measured at 21 s on a loaded Mac. A limit on the listing made the sweep give up with
 * "could not inspect", and the orphans stayed.
 */

const run = vi.hoisted(() => ({
  options: [] as unknown[],
  delayMs: 0,
}))

vi.mock('node:child_process', () => ({
  execFile: (
    command: string,
    _args: string[],
    options: unknown,
    done: (...r: unknown[]) => void,
  ) => {
    run.options.push(options)
    setTimeout(() => done(null, command === 'lsof' ? '' : ''), run.delayMs)
    return {}
  },
}))

afterEach(() => {
  vi.useRealTimers()
  run.options.length = 0
})

it.skipIf(process.platform === 'win32')(
  '🔴 a listing that takes 25 s is waited for, not given up on',
  async () => {
    vi.useFakeTimers()
    run.delayMs = 25_000
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { stopCommandsInFolders } = await import('../src/main/command-cleanup')
    let done = false
    void stopCommandsInFolders([process.cwd()]).then(() => (done = true))
    await vi.advanceTimersByTimeAsync(24_000)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(done).toBe(true)
    expect(warn).not.toHaveBeenCalled()
    expect(run.options).toHaveLength(2)
    for (const options of run.options) expect(options).not.toHaveProperty('timeout')
    warn.mockRestore()
  },
)
