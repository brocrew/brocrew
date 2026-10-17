import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime, claudeProjectDirName, ResumeError, type ClaudeQuery } from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'

/**
 * 🔴 **D-017 · R9 — a transcript that is THERE is not always a conversation Claude can resume.**
 *
 * ⚑ **`holdsAConversation`** reads a found `.jsonl` a chunk at a time and asks whether any line is a
 * record whose `type` is `user` or `assistant` — the CLI's own test. A file with nothing but queue
 * lines, an empty file, a file of pure noise, or one whose only line is the bare JSON value `null`
 * never has such a line, so `defaultSessionExists` answers `false` for it exactly as it would for a
 * missing file, and `resume()` throws `ResumeError('session not found: <id>', {noSuchSession:true})`
 * — the host is right to let go of a conversation that was never held.
 *
 * ⛔ **Every doubt still keeps it.** A file `holdsAConversation` cannot open, and a file so long its
 * 1 MiB read budget runs out before a real record turns up (or before real EOF), both count as
 * *present*, not gone — only a read that reaches the file's actual end within budget may answer "no
 * conversation here".
 */

const roots: string[] = []
/** Files or directories a test made unreadable — made readable again before anything is removed. */
const locked: string[] = []
afterEach(() => {
  for (const path of locked.splice(0)) chmodSync(path, 0o755)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-no-conversation-'))
  roots.push(root)
  return root
}

/**
 * ⚑ **The real adapter, stopped right after its probe** (`a-session-the-provider-no-longer-has.test.ts`):
 * a query factory that refuses, and a `spawnChild` that refuses too, so nothing is ever launched.
 * Its message then says the probe answered YES (a transcript worth trying) — *"session not found"* is
 * the probe's own no.
 */
const stoppedAfterTheProbe = (): ClaudeRuntime =>
  new ClaudeRuntime(
    () => {
      throw new Error('stopped after the probe')
    },
    undefined,
    undefined,
    undefined,
    () => {
      throw new Error('no child may start in this test')
    },
  )

/** A minimal `ClaudeQuery` — nothing this file needs beyond the shape `resume()` requires. */
class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {}
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

/** `<home>/projects/<claudeProjectDirName(cwd)>/<sessionId>.jsonl`, holding exactly `content`. */
function plantTranscript(home: string, cwd: string, sessionId: string, content: string): void {
  const dir = join(home, 'projects', claudeProjectDirName(cwd))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.jsonl`), content)
}

const SESSION_ID = 'sess_no_conversation'

async function resumeAgainstTheThrowingRig(cwd: string, home: string): Promise<unknown> {
  return stoppedAfterTheProbe()
    .resume({ provider: 'claude', sessionId: SESSION_ID, cwd, rotation: 0 }, { providerHome: home })
    .catch((error: unknown) => error)
}

async function resumeAgainstAFakeQuery(cwd: string, home: string): Promise<unknown> {
  const handle = await new ClaudeRuntime(() => new FakeQuery()).resume(
    { provider: 'claude', sessionId: SESSION_ID, cwd, rotation: 0 },
    { providerHome: home },
  )
  await handle.close()
  return handle
}

describe('a transcript with no user or assistant record is gone for good', () => {
  it('an empty transcript (0 bytes) is gone for good, not resumed', async () => {
    const root = scratch()
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    plantTranscript(home, cwd, SESSION_ID, '')
    const outcome = await resumeAgainstTheThrowingRig(cwd, home)
    expect(outcome).toBeInstanceOf(ResumeError)
    expect((outcome as Error).message).toBe(`session not found: ${SESSION_ID}`)
    expect((outcome as ResumeError).noSuchSession).toBe(true)
  })

  it('a transcript holding only queue lines (no user or assistant record) is gone for good', async () => {
    const root = scratch()
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    plantTranscript(
      home,
      cwd,
      SESSION_ID,
      '{"type":"queue-operation","operation":"enqueue"}\n{"type":"queue-operation","operation":"dequeue"}\n',
    )
    const outcome = await resumeAgainstTheThrowingRig(cwd, home)
    expect(outcome).toBeInstanceOf(ResumeError)
    expect((outcome as Error).message).toBe(`session not found: ${SESSION_ID}`)
    expect((outcome as ResumeError).noSuchSession).toBe(true)
  })

  it('the same queue lines, followed by a real user record, do resume', async () => {
    const root = scratch()
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    plantTranscript(
      home,
      cwd,
      SESSION_ID,
      '{"type":"queue-operation","operation":"enqueue"}\n{"type":"queue-operation","operation":"dequeue"}\n{"type":"user"}\n',
    )
    const handle = await resumeAgainstAFakeQuery(cwd, home)
    expect(handle).toBeDefined()
  })

  it('a transcript holding only an unparseable line is gone for good, and the parse failure does not crash the probe', async () => {
    const root = scratch()
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    plantTranscript(home, cwd, SESSION_ID, 'not json at all')
    const outcome = await resumeAgainstTheThrowingRig(cwd, home)
    expect(outcome).toBeInstanceOf(ResumeError)
    expect((outcome as Error).message).toBe(`session not found: ${SESSION_ID}`)
    expect((outcome as ResumeError).noSuchSession).toBe(true)
  })

  it('an unparseable line ahead of a real user record still resumes — bad lines are skipped, not fatal', async () => {
    const root = scratch()
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    plantTranscript(home, cwd, SESSION_ID, 'not json at all\n{"type":"user"}\n')
    const handle = await resumeAgainstAFakeQuery(cwd, home)
    expect(handle).toBeDefined()
  })

  it('a transcript that cannot be opened for reading counts as present, not gone', async () => {
    const root = scratch()
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    plantTranscript(home, cwd, SESSION_ID, '{"type":"user"}\n')
    const file = join(home, 'projects', claudeProjectDirName(cwd), `${SESSION_ID}.jsonl`)
    chmodSync(file, 0o000)
    locked.push(file)
    const handle = await resumeAgainstAFakeQuery(cwd, home)
    expect(handle).toBeDefined()
  })

  it('the 1 MB read budget being spent without a match still counts as present, not gone', async () => {
    const root = scratch()
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    // ⚑ Varying line length (the digit count of `i` grows) keeps line boundaries misaligned with any
    // fixed chunk size, and the total comfortably clears the 1 MiB budget with no `user`/`assistant`
    // line anywhere.
    let content = ''
    let i = 0
    while (content.length < 1024 * 1024 + 65_536) {
      content += `{"type":"queue-operation","i":${String(i)}}\n`
      i += 1
    }
    plantTranscript(home, cwd, SESSION_ID, content)
    const handle = await resumeAgainstAFakeQuery(cwd, home)
    expect(handle).toBeDefined()
  })

  it('a transcript whose only record is the JSON value null is still gone, not a crash', async () => {
    const root = scratch()
    const home = join(root, 'home')
    const cwd = join(root, 'cwd')
    plantTranscript(home, cwd, SESSION_ID, 'null\n')
    const outcome = await resumeAgainstTheThrowingRig(cwd, home)
    expect(outcome).toBeInstanceOf(ResumeError)
    expect((outcome as Error).message).toBe(`session not found: ${SESSION_ID}`)
    expect((outcome as ResumeError).noSuchSession).toBe(true)
  })
})
