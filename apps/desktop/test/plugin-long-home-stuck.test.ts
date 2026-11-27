import { expect, it, vi } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { captureLog } from './lib/log-file'
import { setup, settingsCall } from './plugin-production-fixtures'

const asked = vi.hoisted(() => ({ count: 0 }))
// The lookup that never answers: a child that does not exit, started in place of getconf.
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return {
    ...real,
    execFileSync: (file: string, args: string[], options: object) => {
      if (file !== '/usr/bin/getconf') return real.execFileSync(file, args, options)
      asked.count++
      return real.execFileSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options)
    },
  }
})

it.runIf(process.platform === 'darwin')(
  'a lookup that never exits costs one bounded wait; plugins then show the true reason',
  async () => {
    const temp = await mkdtemp('/tmp/fictional-custom-temp-')
    vi.stubEnv('TMPDIR', temp)
    const f = await setup()
    const home = join(dirname(f.options.root), `fictional-deep-home-${'d'.repeat(120)}`)
    await mkdir(home, { mode: 0o700 })
    const root = join(home, 'plugins')
    const captured = await captureLog()
    let last = performance.now()
    let longest = 0
    const watch = setInterval(() => {
      const now = performance.now()
      longest = Math.max(longest, now - last)
      last = now
    }, 10)
    const began = performance.now()
    f.controller.start({ ...f.options, root })
    await f.controller.ready!()
    const startup = performance.now() - began
    // Asking for the other socket, and starting again, must not wait a second time.
    await settingsCall(f.controller)({ kind: 'list' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    clearInterval(watch)
    console.info(
      `stuck lookup: longest main-thread pause ${Math.round(longest)} ms, startup ${Math.round(startup)} ms, asked ${asked.count} time(s)`,
    )
    const text = await captured.text()
    await captured.close()
    expect(asked.count).toBe(1)
    expect(longest).toBeGreaterThanOrEqual(900)
    expect(longest).toBeLessThan(1500)
    expect(await settingsCall(f.controller)({ kind: 'list' })).toEqual({
      ok: false,
      listState: 'fetch-error',
      reason: 'path-too-long',
    })
    expect(text).toContain(
      "[plugins] path-too-long: The plugin folder's path is too long on this computer.",
    )
    expect(existsSync(root)).toBe(false)
    expect(f.supervisor.start).not.toHaveBeenCalled()
    await f.controller.close()
    await rm(temp, { recursive: true, force: true })
  },
)
