import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * A Claude CLI blocked by a command it cannot end (on Windows, a PowerShell call that never
 * returns) answers neither a Stop nor any later control request. A Stop it does not answer within
 * its bound retires that CLI, so the next message starts a fresh one; a Stop it answers keeps it.
 */

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const close of cleanup.splice(0)) await close()
})

async function aTurnRunning(answersTheStop: boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-unanswered-stop-')))
  const frames = new AsyncQueue<SDKMessage>()
  let closes = 0
  const query: ClaudeQuery = {
    interrupt: () => (answersTheStop ? Promise.resolve(undefined) : new Promise(() => {})),
    close: () => {
      closes += 1
      frames.close()
    },
    return: async () => frames.close(),
    [Symbol.asyncIterator]: () => frames[Symbol.asyncIterator](),
  }
  const runtime = new ClaudeRuntime(
    () => query,
    async () => true,
  )
  const handle = await runtime.start({ cwd: root, providerHome: root })
  cleanup.push(async () => {
    await handle.close()
    rmSync(root, { recursive: true, force: true })
  })
  frames.push({
    type: 'system',
    subtype: 'init',
    session_id: 'fictional-claude',
    cwd: root,
    tools: [],
    mcp_servers: [],
  } as unknown as SDKMessage)
  await vi.waitFor(() => expect(handle.ref).not.toBeNull())
  await handle.send('run the fictional command that never returns')
  expect(handle.status()).toBe('working')
  return { handle, closes: () => closes }
}

it('a Stop the CLI does not answer retires it, and the next message is refused on that CLI', async () => {
  const { handle, closes } = await aTurnRunning(false)

  vi.useFakeTimers()
  const stopping = handle.interrupt()
  await vi.advanceTimersByTimeAsync(2_000)
  await stopping

  expect(closes()).toBe(1)
  await expect(handle.send('the next message')).rejects.toThrow()
})

it('control: a Stop the CLI answers keeps it', async () => {
  const { handle, closes } = await aTurnRunning(true)

  await handle.interrupt()

  expect(closes()).toBe(0)
  expect(handle.status()).toBe('idle')
  expect(handle.isRetiring?.()).toBe(false)
})
