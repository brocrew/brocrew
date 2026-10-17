import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, onTestFinished } from 'vitest'
import { SpawnCodexTransport, gracefulStopMs } from '../src/codex/codex-transport'

/**
 * Codex's app-server stops on its own when its stdin ends. On POSIX it is then also sent SIGTERM
 * before SIGKILL; Windows has no signal a console program can be asked to stop with, so there the
 * end of stdin is the whole graceful stop, and it is given both graces before the tree is ended.
 */

const SLOW = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'codex-slow-to-stop.mjs')
const graces = { exitGraceMs: 300, killGraceMs: 2000 }

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function until(condition: () => boolean, what: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('how long the app-server is given to stop on its own', () => {
  it('🔴 on Windows, both graces, since no signal follows the end of stdin there', () => {
    expect(gracefulStopMs('win32', graces)).toBe(2300)
  })

  it('elsewhere, the first grace, and then SIGTERM', () => {
    expect(gracefulStopMs('darwin', graces)).toBe(300)
    expect(gracefulStopMs('linux', graces)).toBe(300)
  })
})

describe('an app-server that takes a second to stop, on this computer', () => {
  it('🔴 finishes its own stop before close() resolves, and is gone when it has', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brobot-slow-stop-'))
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }))
    const log = join(dir, 'leader')
    const t = new SpawnCodexTransport(process.execPath, [SLOW, log, '1000'], {
      env: process.env,
      ...graces,
    })
    onTestFinished(() => t.close())
    void (async () => {
      for await (const _ of t.incoming()) void _
    })()
    await until(() => existsSync(`${log}.leader`), 'the app-server to start', 10_000)
    const pid = t.pid
    expect(pid).toBeGreaterThan(0)

    const started = Date.now()
    await t.close()

    expect(existsSync(`${log}.stopped`), 'the app-server was ended before its own stop').toBe(true)
    expect(isAlive(pid!), 'the app-server was still running when close() resolved').toBe(false)
    expect(Date.now() - started).toBeLessThan(
      graces.exitGraceMs + graces.killGraceMs + graces.killGraceMs,
    )
  }, 20_000)
})
