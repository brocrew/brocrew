import { expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { watchClaudeChild } from '../src/claude/claude-child'
import { ClaudeSessionHandle } from '../src/claude'
import { AsyncQueue } from '../src/internal/async-queue'

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

it.skipIf(process.platform === 'win32')(
  'ends a Claude command child when its session closes, even after the CLI exits',
  async () => {
    const witness = watchClaudeChild()
    const child = witness.spawn({
      command: process.execPath,
      args: ['-e', `
        const { spawn } = require('node:child_process')
        const tail = spawn('tail', ['-f', '/dev/null'], { stdio: 'ignore' })
        console.log(tail.pid)
        process.stdin.resume()
        process.stdin.on('end', () => process.exit(0))
      `],
      cwd: process.cwd(),
      env: { ...process.env },
    }) as unknown as ChildProcess
    let tail: number | undefined
    const unrelated = spawn('tail', ['-f', '/dev/null'], { stdio: 'ignore' })
    const unrelatedExit = once(unrelated, 'exit')
    try {
      const [chunk] = await once(child.stdout!, 'data')
      tail = Number(String(chunk).trim())
      expect(tail).toBeGreaterThan(0)
      expect(alive(tail)).toBe(true)
      const handle = new ClaudeSessionHandle(new AsyncQueue(), process.cwd(), 0)
      handle.attachQuery({
        interrupt: async () => undefined,
        close: () => child.stdin!.end(),
        [Symbol.asyncIterator]: async function* () {},
      }, witness)
      await handle.close()
      await handle.awaitProcessExit()
      await vi.waitFor(() => expect(alive(tail!)).toBe(false), { timeout: 3000 })
      expect(alive(unrelated.pid!)).toBe(true)
    } finally {
      if (tail !== undefined && alive(tail)) process.kill(tail, 'SIGKILL')
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      unrelated.kill('SIGTERM')
      await unrelatedExit
    }
  },
)
