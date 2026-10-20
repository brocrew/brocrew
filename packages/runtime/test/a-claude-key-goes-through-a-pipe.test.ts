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
 * Each test runs a Node child as the "CLI", with a made-up key; nothing here holds a credential.
 * Node can read descriptor three on Windows as well as on POSIX.
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

  /** A child that reads descriptor 3 the way the CLI does, and reports what it can see. */
  const aCli = (script: string, extraEnv: Record<string, string> = {}) => ({
    command: process.execPath,
    args: ['-e', script],
    cwd: dir,
    env: { PATH: process.env.PATH ?? '', OUT: dir, ...extraEnv },
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
        "const fs = require('node:fs'); const [key, ...rest] = fs.readFileSync(3, 'utf8').split('\\n'); fs.writeFileSync(process.env.OUT + '/key', key); fs.writeFileSync(process.env.OUT + '/rest', rest.join('\\n'))",
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
        "const fs = require('node:fs'); fs.readFileSync(3, 'utf8'); fs.writeFileSync(process.env.OUT + '/env', JSON.stringify(process.env)); fs.writeFileSync(process.env.OUT + '/args', JSON.stringify([process.execPath, ...process.argv]))",
        { CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: String(API_KEY_DESCRIPTOR) },
      ),
      KEY,
    )
    await exited(child)
    expect(JSON.parse(read('env'))).toMatchObject({ CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR: '3' })
    expect(read('env')).not.toContain(KEY)
    expect(read('args')).not.toContain(KEY)
    expect(child.spawnargs.join(' ')).not.toContain(KEY)
  })

  it('⚑ …and with no key there is no fourth pipe or key marker: the control', async () => {
    const child = spawnClaudeChild(
      aCli(
        "require('node:fs').writeFileSync(process.env.OUT + '/marker', process.env.CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR ?? 'none')",
      ),
    )
    await exited(child)
    expect(read('marker')).toBe('none')
    expect(child.stdio).toHaveLength(3)
    // The paired positive: with a key, the fourth pipe supplies the made-up key.
    const keyed = spawnClaudeChild(
      aCli(
        "const fs = require('node:fs'); fs.writeFileSync(process.env.OUT + '/keyed', fs.readFileSync(3, 'utf8'))",
      ),
      KEY,
    )
    await exited(keyed)
    expect(read('keyed')).toBe(`${KEY}\n`)
    expect(keyed.stdio).toHaveLength(4)
  })

  it('⛔ a child that dies before it reads is its exit’s to report: the write fails quietly', async () => {
    const uncaught = vi.fn()
    process.on('uncaughtException', uncaught)
    try {
      const child = spawnClaudeChild(aCli('process.exit(7)'), KEY)
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
    const child = keyed.spawn(
      aCli(
        "const fs = require('node:fs'); const key = fs.readFileSync(3, 'utf8').trimEnd(); fs.writeFileSync(process.env.OUT + '/seen', key)",
      ),
    )
    await exited(child as unknown as ReturnType<typeof spawnClaudeChild>)
    expect(asked[0]?.[1]).toBe(KEY)
    expect(read('seen')).toBe(KEY)

    const plain = watchClaudeChild(spy)
    const other = plain.spawn(aCli('process.exit(0)'))
    await exited(other as unknown as ReturnType<typeof spawnClaudeChild>)
    // One argument: not even an `undefined` second one.
    expect(asked[1]).toHaveLength(1)
  })
})
