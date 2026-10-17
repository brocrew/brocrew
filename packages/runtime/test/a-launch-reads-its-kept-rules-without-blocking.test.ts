import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * A Claude launch in a folder whose local settings carry `allow` rules asks git whether the
 * repository carries that file, and must not hold the thread while git answers: on Electron's main
 * process, many conversations starting at once would each hold it in turn. ⚑ A stand-in
 * `git` on the PATH takes a second to answer `ls-files` and answers `worktree` at once, as no
 * repository; the launch's rules are still read, and the thread ticks throughout.
 */

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {
    this.messages.close()
  }
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

/** Far below the second the stand-in git takes: a launch that waited on it would show here. */
const STALL_FLOOR_MS = 250

let root: string
let path: string | undefined
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-kept-no-block-'))
  path = process.env['PATH']
  const bin = join(root, 'bin')
  mkdirSync(bin)
  const git = join(bin, 'git')
  writeFileSync(
    git,
    [
      '#!/bin/sh',
      'for word in "$@"; do',
      '  if [ "$word" = "ls-files" ]; then sleep 1; exit 1; fi',
      'done',
      'exit 128',
      '',
    ].join('\n'),
  )
  chmodSync(git, 0o755)
  process.env['PATH'] = `${bin}${delimiter}${path ?? ''}`
})
afterEach(() => {
  process.env['PATH'] = path
  rmSync(root, { recursive: true, force: true })
})

async function launchedWhileTicking(
  cwd: string,
): Promise<{ settings: Options['settings']; longestGap: number }> {
  let seen: Options | undefined
  const runtime = new ClaudeRuntime(
    (params) => {
      seen = params.options
      return new FakeQuery()
    },
    async () => true,
  )
  let last = Date.now()
  let longestGap = 0
  const ticks = setInterval(() => {
    const now = Date.now()
    longestGap = Math.max(longestGap, now - last)
    last = now
  }, 10)
  try {
    const handle = await runtime.start({ cwd, providerHome: join(root, 'home') })
    await handle.close()
  } finally {
    clearInterval(ticks)
  }
  return { settings: seen?.settings, longestGap }
}

describe.skipIf(process.platform === 'win32')(
  'a launch reads its kept rules without blocking',
  () => {
    it('🔴 git takes a second to say the repository does not carry the file, and the thread ticks throughout', async () => {
      const project = join(root, 'project')
      mkdirSync(join(project, '.claude'), { recursive: true })
      writeFileSync(
        join(project, '.claude', 'settings.local.json'),
        JSON.stringify({ permissions: { allow: ['Bash(make build *)'] } }),
      )
      mkdirSync(join(root, 'home'))
      const started = Date.now()
      const { settings, longestGap } = await launchedWhileTicking(project)
      // ⚑ The premise: the launch did wait for git's answer…
      expect(Date.now() - started).toBeGreaterThanOrEqual(900)
      // …and read the rules once git said the file is not the repository's.
      expect(settings).toMatchObject({ permissions: { allow: ['Bash(make build *)'] } })
      expect(longestGap).toBeLessThan(STALL_FLOOR_MS)
    })

    it('⚑ THE CONTROL — a folder with no `allow` to gate asks git nothing, and launches at once', async () => {
      const project = join(root, 'project')
      mkdirSync(join(project, '.claude'), { recursive: true })
      writeFileSync(
        join(project, '.claude', 'settings.local.json'),
        JSON.stringify({ permissions: { deny: ['Bash(rm -rf *)'] } }),
      )
      mkdirSync(join(root, 'home'))
      const started = Date.now()
      const { settings } = await launchedWhileTicking(project)
      expect(Date.now() - started).toBeLessThan(900)
      expect(settings).toMatchObject({ permissions: { deny: ['Bash(rm -rf *)'] } })
    })
  },
)
