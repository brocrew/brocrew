import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚑ **The Codex transport spawns through `node:child_process` directly and has no seam** — the same
 * armed swap as `the-errno-a-resume-carries.test.ts`: one spawn per test, every other the real one.
 */
const armed = vi.hoisted(() => ({ next: null as null | (() => unknown) }))
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>()
  return {
    ...real,
    spawn: (...args: unknown[]): unknown => {
      const next = armed.next
      armed.next = null
      return next === null ? (real.spawn as (...given: unknown[]) => unknown)(...args) : next()
    },
  }
})

import { ClaudeRuntime } from '../src/claude/claude-runtime'
import { CodexRuntime, createSpawnTransportFactory } from '../src/codex/codex-runtime'
import { transientSetupFailureOf } from '../src/runtime'
import {
  aSpawnRefusedAfterItsPipes,
  aSpawnThatRanOutOf,
  type FailedSpawn,
} from './fixtures/a-spawn-that-failed'

/**
 * # 🔴 707 · R39, extended — a START that ran short says so too
 *
 * ⚑ **PM ruling R39, extended** (`705` F-2): *"`spawn_agent` meets a transient shortage (`EMFILE`)
 * too — it gets the retryable word, never a broken tool."* ⛔ **This file is the adapters' half**: a
 * word can only be chosen by the errno's code if the errno is on the error `start()` rejects with.
 * `705` taught both adapters' RESUME that; measured on `main` (`224e1f45`), their START:
 *
 * | provider · the spawn | `main`: what `start()` did | `707` |
 * |---|---|---|
 * | Claude · `EMFILE` | rejected with the SDK's `TypeError` (*reading 'on'* of the `stdin` Node never assigned) — no errno anywhere | rejects with the spawn's own `EMFILE` |
 * | Claude · `EAGAIN` / `ENOENT` after the pipes | ⛔ **RESOLVED a handle** — `spawn_agent` said `ok` about a conversation whose CLI never ran | rejects with that errno |
 * | Codex · `EMFILE` / `ENFILE` / `EAGAIN` | rejected with the transport's refusal, the errno as its cause (`705`'s transport) | unchanged — pinned here |
 *
 * ⚑ The desktop half — the word `spawn_agent` answers — is
 * `apps/desktop/test/a-spawn-that-ran-short.test.ts`.
 */

/** ⚑ Every `code` from the error itself down its cause chain — the test's own walk. */
function codesIn(error: unknown): string[] {
  const codes: string[] = []
  let at: unknown = error
  for (let depth = 0; depth < 10 && at !== undefined && at !== null; depth++) {
    const code = (at as { code?: unknown }).code
    if (typeof code === 'string') codes.push(code)
    at = (at as { cause?: unknown }).cause
  }
  return codes
}

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'brobot2-707-home-'))
  armed.next = null
})
afterEach(() => {
  armed.next = null
  rmSync(home, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · Claude — the SDK's real `query()`, on the adapter's own spawn seam
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · Claude', () => {
  const startOver = (spawned: () => FailedSpawn['child']): Promise<unknown> =>
    new ClaudeRuntime(undefined, async () => true, undefined, undefined, spawned)
      .start({ cwd: home, providerHome: home, approvalMode: 'auto' })
      .then(
        () => 'resolved a handle',
        (thrown: unknown) => thrown,
      )

  it('🔴 a spawn EMFILE: the start rejects with the errno, not the TypeError it caused', async () => {
    const made = aSpawnThatRanOutOf('EMFILE', '/x/claude')
    const error = await startOver(() => made.child)
    expect(error).toBeInstanceOf(Error)
    expect(codesIn(error)).toEqual(['EMFILE'])
    expect((error as Error).message).toContain('spawn /x/claude EMFILE')
    expect(transientSetupFailureOf(error)).toBe('EMFILE')
    // ⚑ the witness was listening — the errno reached it and went no further
    expect((await made.failed).listening).toBe(true)
  })

  it('🔴 a spawn EAGAIN after its pipes: the start REJECTS — it does not hand back a handle', async () => {
    const made = aSpawnRefusedAfterItsPipes('EAGAIN', '/x/claude')
    const error = await startOver(() => made.child)
    expect(error).toBeInstanceOf(Error)
    expect(codesIn(error)).toEqual(['EAGAIN'])
    expect(transientSetupFailureOf(error)).toBe('EAGAIN')
  })

  it('🔴 …and a binary that is not there is refused the same way, with ITS errno (a person’s to fix)', async () => {
    const made = aSpawnRefusedAfterItsPipes('ENOENT', '/x/claude')
    const error = await startOver(() => made.child)
    expect(error).toBeInstanceOf(Error)
    expect(codesIn(error)).toEqual(['ENOENT'])
    expect(transientSetupFailureOf(error)).toBeNull()
  })

  /**
   * 🔴 **The errno IS the error here, not its cause** — a spawn that throws synchronously (`ENOMEM`
   * and every errno but five, measured in `705`) leaves `query()` as itself. ⛔ On `main` the walk
   * began at a `ResumeError`'s cause and never read the error it was handed.
   */
  it('🔴 a spawn that throws synchronously carries its errno as ITSELF — and the walk reads it there', async () => {
    const error = await startOver(() => {
      throw Object.assign(new Error('spawn /x/claude ENOMEM'), {
        code: 'ENOMEM',
        syscall: 'spawn /x/claude',
      })
    })
    expect(codesIn(error)).toEqual(['ENOMEM'])
    expect(transientSetupFailureOf(error)).toBe('ENOMEM')
  })

  it('⚑ control: a person’s synchronous errno is its own, and never a shortage', async () => {
    const error = await startOver(() => {
      throw Object.assign(new Error('spawn /x/claude ENOTDIR'), {
        code: 'ENOTDIR',
        syscall: 'spawn /x/claude',
      })
    })
    expect(codesIn(error)).toEqual(['ENOTDIR'])
    expect(transientSetupFailureOf(error)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · Codex — the real transport and the real start, on the armed spawn
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · Codex — already carried by `705`’s transport, pinned', () => {
  /** ⚠️ A command that does not exist, so an UNARMED spawn could only ever fail `ENOENT`. */
  const startOver = (made: () => unknown): Promise<unknown> => {
    armed.next = made
    return new CodexRuntime(createSpawnTransportFactory('/nonexistent/brobot2-707/codex'))
      .start({ cwd: home, providerHome: home, approvalMode: 'auto' })
      .then(
        () => 'resolved a handle',
        (thrown: unknown) => thrown,
      )
  }

  for (const [name, code, made] of [
    ['EMFILE', 'EMFILE', () => aSpawnThatRanOutOf('EMFILE', '/x/codex')],
    ['ENFILE', 'ENFILE', () => aSpawnThatRanOutOf('ENFILE', '/x/codex')],
    ['EAGAIN after its pipes', 'EAGAIN', () => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/codex')],
  ] as const) {
    it(`⚑ a spawn ${name}: the start rejects with the errno as its cause`, async () => {
      const spawned = made()
      const error = await startOver(() => spawned.child)
      expect(error).toBeInstanceOf(Error)
      expect((await spawned.failed).listening).toBe(true)
      expect(codesIn(error)).toEqual([code])
      expect(transientSetupFailureOf(error)).toBe(code)
    })
  }
})
