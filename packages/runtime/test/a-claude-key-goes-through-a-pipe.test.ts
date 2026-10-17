import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { API_KEY_DESCRIPTOR } from '../src/claude/api-key-handover'
import { spawnClaudeChild, watchClaudeChild, type SpawnChild } from '../src/claude/claude-child'

/**
 * # 🔒 A Claude agent's API key goes through a pipe, and through nothing else
 *
 * Landing coverage for `spawnClaudeChild(options, apiKey)`. The CLI is told, by an environment
 * variable, which descriptor to read the key from; this spawn opens a FOURTH pipe, writes the key and
 * a newline, and ends it. ⛔ The key is in no argument and no environment of the child, a spawn with no
 * key opens no fourth descriptor, and a child that dies before it reads makes the write's `EPIPE`
 * its exit's to report, not an uncaught error.
 *
 * Each test runs a real `/bin/sh` as the "CLI", with a made-up key; nothing here holds a credential.
 */

const KEY = 'sk-ant-made-up-for-this-test-0123456789'

describe('the key pipe', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-keypipe-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const out = (name: string): string => join(dir, name)
  const read = (name: string): string => readFileSync(out(name), 'utf8')

  /** A shell that reads descriptor 3 the way the CLI does, and reports what it can see of itself. */
  const aCli = (script: string, extraEnv: Record<string, string> = {}) => ({
    command: '/bin/sh',
    args: ['-c', script],
    cwd: dir,
    env: { PATH: '/usr/bin:/bin', OUT: dir, ...extraEnv },
    signal: new AbortController().signal,
  })

  const exited = async (child: ReturnType<typeof spawnClaudeChild>): Promise<number | null> => {
    const [code] = (await once(child, 'exit')) as [number | null]
    // Let the pipe's own close land before a file is read.
    await new Promise((resolve) => setTimeout(resolve, 20))
    return code
  }

  it('🔴 the CLI reads the key, with its newline, from descriptor three — and the pipe is ended after it', async () => {
    expect(API_KEY_DESCRIPTOR).toBe(3)
    const child = spawnClaudeChild(
      aCli(
        // The first line is the key; whatever follows would be more of it, so the read must END.
        'IFS= read -r key <&3; printf %s "$key" > "$OUT/key"; cat <&3 > "$OUT/rest"',
      ),
      KEY,
    )
    expect(await exited(child)).toBe(0)
    expect(read('key')).toBe(KEY)
    // Nothing else was ever written to it: the pipe ended at the newline.
    expect(read('rest')).toBe('')
    // Four pipes, the standard three and the key's.
    expect(child.stdio).toHaveLength(4)
  })

  it('⛔ the key is in no argument and no environment of the child, nor in anything it can read from them', async () => {
    const child = spawnClaudeChild(
      aCli(
        'IFS= read -r key <&3; env > "$OUT/env"; echo "$0 $*" > "$OUT/args"; ps -o args= -p $$ > "$OUT/ps"',
        { CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: String(API_KEY_DESCRIPTOR) },
      ),
      KEY,
    )
    await exited(child)
    expect(read('env')).toContain('CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR=3')
    expect(read('env')).not.toContain(KEY)
    expect(read('args')).not.toContain(KEY)
    expect(read('ps')).not.toContain(KEY)
  })

  it('⚑ …and with no key there is no fourth descriptor to read: the control', async () => {
    const child = spawnClaudeChild(
      aCli(
        'if [ -e /dev/fd/3 ] && { true <&3; } 2>/dev/null; then echo open; else echo closed; fi > "$OUT/fd3"',
      ),
    )
    await exited(child)
    expect(read('fd3').trim()).toBe('closed')
    expect(child.stdio).toHaveLength(3)
    // The paired positive: with a key, the same probe finds it open.
    const keyed = spawnClaudeChild(
      aCli('if { true <&3; } 2>/dev/null; then echo open; else echo closed; fi > "$OUT/fd3k"'),
      KEY,
    )
    await exited(keyed)
    expect(read('fd3k').trim()).toBe('open')
  })

  it('⛔ a child that dies before it reads is its exit’s to report: the write fails quietly', async () => {
    const uncaught = vi.fn()
    process.on('uncaughtException', uncaught)
    try {
      const child = spawnClaudeChild(aCli('exit 7'), KEY)
      expect(await exited(child)).toBe(7)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(uncaught).not.toHaveBeenCalled()
    } finally {
      process.off('uncaughtException', uncaught)
    }
  })

  it('🔴 the witness hands the key to the spawn it asks for — and hands nothing when it was given none', async () => {
    const asked: unknown[][] = []
    const spy: SpawnChild = (options, apiKey) => {
      asked.push(apiKey === undefined ? [options] : [options, apiKey])
      return spawnClaudeChild(options, apiKey)
    }
    const keyed = watchClaudeChild(spy, KEY)
    const child = keyed.spawn(aCli('IFS= read -r key <&3; printf %s "$key" > "$OUT/seen"'))
    await exited(child as unknown as ReturnType<typeof spawnClaudeChild>)
    expect(asked[0]?.[1]).toBe(KEY)
    expect(read('seen')).toBe(KEY)

    const plain = watchClaudeChild(spy)
    const other = plain.spawn(aCli('true'))
    await exited(other as unknown as ReturnType<typeof spawnClaudeChild>)
    // One argument: not even an `undefined` second one.
    expect(asked[1]).toHaveLength(1)
  })
})
