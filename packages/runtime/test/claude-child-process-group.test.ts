import { alive } from './helpers/process-alive'
import { expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { watchClaudeChild } from '../src/claude/claude-child'
import { ClaudeSessionHandle } from '../src/claude'
import { AsyncQueue } from '../src/internal/async-queue'

it.skipIf(process.platform === 'win32').each(['session close', 'CLI exit', 'ignored SIGTERM'])(
  'ends a Claude command child after %s',
  async (ending) => {
    const witness = watchClaudeChild()
    const child = witness.spawn({
      command: process.execPath,
      args: [
        '-e',
        `
        const { spawn } = require('node:child_process')
        const tail = ${JSON.stringify(ending)} === 'ignored SIGTERM'
          ? spawn('sh', ['-c', 'trap "" TERM; exec tail -f /dev/null'], { stdio: 'ignore' })
          : spawn('/usr/bin/tail', ['-f', '/dev/null'], { stdio: 'ignore' })
        console.log(tail.pid)
        process.stdin.resume()
        process.stdin.on('end', () => process.exit(0))
      `,
      ],
      cwd: process.cwd(),
      env: { ...process.env },
      signal: new AbortController().signal,
    }) as unknown as ChildProcess
    let tail: number | undefined
    const unrelated = spawn('/usr/bin/tail', ['-f', '/dev/null'], { stdio: 'ignore' })
    const unrelatedExit = once(unrelated, 'exit')
    try {
      const [chunk] = await once(child.stdout!, 'data')
      tail = Number(String(chunk).trim())
      expect(tail).toBeGreaterThan(0)
      expect(alive(tail)).toBe(true)
      if (ending === 'CLI exit') {
        const exited = once(child, 'exit')
        child.stdin!.end()
        await exited
      }
      const handle = new ClaudeSessionHandle(new AsyncQueue(), process.cwd(), 0)
      handle.attachQuery(
        {
          interrupt: async () => undefined,
          close: () => child.stdin!.end(),
          [Symbol.asyncIterator]: async function* () {},
        },
        witness,
      )
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
