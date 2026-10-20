import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ⚑ **The Codex transport spawns through `node:child_process` directly and has no seam**, so the
 * one spawn this file wants to fail is swapped here — ARMED per test, and every other spawn in the
 * module graph (the §0 measurement's own `execFileSync` among them) reaches the real function.
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
import { ResumeError } from '../src/runtime'
import {
  aSpawnRefusedAfterItsPipes,
  aSpawnThatRanOutOf,
  measureARealSpawnFailure,
  shapeOf,
  type FailedSpawn,
} from './fixtures/a-spawn-that-failed'

/**
 * # 🔴 705 · R39 — a shortage that clears by itself is not *until a person changes it*
 *
 * ⚑ **PM ruling R39** (`697` H-c): *"a transient setup failure (`spawn EMFILE`) is never until a
 * person changes it — a retryable word that says so."* ⛔ **This file is the adapters' half: a word
 * can only be chosen by TYPE if the errno is still in the `ResumeError`'s cause chain**, and on
 * `main` it was in NEITHER adapter's chain for the shortage the ruling names:
 *
 * | provider | `main`: the chain of a spawn `EMFILE` | `705` |
 * |---|---|---|
 * | Claude | `ResumeError` → the SDK's `TypeError` (*reading 'on'* of the `stdin` Node never assigned) | `ResumeError` → the spawn's own `EMFILE` |
 * | Codex | `ResumeError` → the transport's `TypeError` (*reading 'setEncoding'*) — ⛔ **and the `EMFILE` itself thrown uncaught a tick later**, because the transport touched `stdout` before it listened | `ResumeError` → the transport's refusal → `EMFILE`, heard |
 * | Codex, `EAGAIN` | the errno in the MESSAGE only (`new Error(text)`) | carried as `cause` |
 *
 * ⚑ The desktop half — the word a wake answers — is
 * `apps/desktop/test/a-shortage-that-clears-by-itself.test.ts`.
 */

/** ⚑ Every `code` down the cause chain, in order — the test's own walk, not the one under test. */
function codesIn(error: unknown): string[] {
  const codes: string[] = []
  let at: unknown = error instanceof Error ? error.cause : undefined
  for (let depth = 0; depth < 10 && at !== undefined && at !== null; depth++) {
    const code = (at as { code?: unknown }).code
    if (typeof code === 'string') codes.push(code)
    at = (at as { cause?: unknown }).cause
  }
  return codes
}

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'brobot2-705-home-'))
  armed.next = null
})
afterEach(() => {
  armed.next = null
  rmSync(home, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · the premise — the doubles are the shapes Node produces
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§0 · a spawn that failed, measured', () => {
  // This measurement lowers a POSIX descriptor limit through /bin/sh; the adapter controls below
  // still run on Windows with the measured failure shapes.
  it.skipIf(process.platform === 'win32')(
    '⚑ the machine’s own EMFILE: no process, NO streams, and the errno one tick later',
    async () => {
      const real = measureARealSpawnFailure('EMFILE')
      expect(real.stdio).toBe('undefined')
      expect(real.error.code).toBe('EMFILE')
      // ⚑ the bound the witness waits: heard before a macrotask queued the moment `spawn` returned
      expect(real.heard).toBe('before a macrotask')
      expect(await shapeOf(aSpawnThatRanOutOf('EMFILE', real.error.path))).toEqual(real)
    },
  )

  it.skipIf(process.platform === 'win32')(
    '⚑ …and a refusal after the pipes were made: no process, three streams (EACCES, measured)',
    async () => {
      const real = measureARealSpawnFailure('EACCES')
      expect(real.stdio).toBe('three streams')
      expect(real.error.code).toBe('EACCES')
      expect(real.heard).toBe('before a macrotask')
      expect(await shapeOf(aSpawnRefusedAfterItsPipes('EACCES', real.error.path))).toEqual(real)
    },
  )
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · Claude — through the SDK's real `query()`, on the adapter's own spawn seam
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · Claude', () => {
  const ref = { provider: 'claude' as const, sessionId: 'sess_705', cwd: '/tmp/x', rotation: 0 }

  /** ⚑ The SDK's own `query`, the default — the `TypeError` on `main` is the SDK's, not a double's. */
  const resumeOver = (spawned: () => FailedSpawn['child']): Promise<unknown> =>
    new ClaudeRuntime(undefined, async () => true, undefined, undefined, spawned)
      .resume(ref, { providerHome: home })
      .catch((thrown: unknown) => thrown)

  it('🔴 a spawn EMFILE: the ResumeError carries the errno, not the TypeError it caused', async () => {
    const made = aSpawnThatRanOutOf('EMFILE', '/x/claude')
    const error = await resumeOver(() => made.child)
    expect(error).toBeInstanceOf(ResumeError)
    expect(codesIn(error)).toEqual(['EMFILE'])
    expect((error as ResumeError).message).toContain('EMFILE')
    // ⚑ the witness was listening (it always was) — the errno reached it and went no further
    expect((await made.failed).listening).toBe(true)
  })

  /**
   * 🔴 **705 review · the pipes-made arm** — `EAGAIN`, `EACCES`, `ENOENT` arrive a tick after `spawn`
   * WITH three streams, so the SDK's `query()` does not throw, and on `main` `resume()` returned a
   * handle: a wake said it woke the conversation, and the conversation failed on its first read.
   */
  it('🔴 a spawn EAGAIN after its pipes: resume refuses with the errno — it does not hand back a handle', async () => {
    const made = aSpawnRefusedAfterItsPipes('EAGAIN', '/x/claude')
    const error = await resumeOver(() => made.child)
    expect(error).toBeInstanceOf(ResumeError)
    expect(codesIn(error)).toEqual(['EAGAIN'])
  })

  it('⚑ …and a binary that is not there is refused the same way, with ITS errno (a person’s to fix)', async () => {
    const made = aSpawnRefusedAfterItsPipes('ENOENT', '/x/claude')
    const error = await resumeOver(() => made.child)
    expect(error).toBeInstanceOf(ResumeError)
    expect(codesIn(error)).toEqual(['ENOENT'])
  })

  it('⚑ control: a spawn that throws synchronously already carried its errno, and still does', async () => {
    const error = await resumeOver(() => {
      throw Object.assign(new Error('spawn /x/claude ENOTDIR'), {
        code: 'ENOTDIR',
        syscall: 'spawn /x/claude',
      })
    })
    expect(error).toBeInstanceOf(ResumeError)
    expect(codesIn(error)).toEqual(['ENOTDIR'])
  })

  it('⚑ control: a session the CLI no longer has is causeless — nothing to classify', async () => {
    const error = await new ClaudeRuntime(undefined, async () => false)
      .resume(ref, { providerHome: home })
      .catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(ResumeError)
    expect((error as ResumeError).cause).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · Codex — the real transport and the real resume, on the armed spawn
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · Codex', () => {
  const ref = { provider: 'codex' as const, sessionId: 'thr_705', cwd: '/tmp/x', rotation: 0 }

  /** ⚠️ A command that does not exist, so an UNARMED spawn could only ever fail `ENOENT`. */
  const resumeOver = (made: () => unknown): Promise<unknown> => {
    armed.next = made
    return new CodexRuntime(createSpawnTransportFactory('/nonexistent/brobot2-705/codex'))
      .resume(ref, { providerHome: home })
      .catch((thrown: unknown) => thrown)
  }

  it('🔴 a spawn EMFILE: the transport LISTENS before it touches a stream, and the chain carries the errno', async () => {
    const made = aSpawnThatRanOutOf('EMFILE', '/x/codex')
    const error = await resumeOver(() => made.child)
    expect(error).toBeInstanceOf(ResumeError)
    // ⛔ on `main` nobody was: the errno was an uncaught exception in the process that spawned it
    expect((await made.failed).listening).toBe(true)
    expect(codesIn(error)).toEqual(['EMFILE'])
    expect((error as ResumeError).message).toContain('spawn /x/codex EMFILE')
  })

  it('🔴 a spawn EAGAIN after its pipes: the errno is the cause, not a word in a message', async () => {
    const made = aSpawnRefusedAfterItsPipes('EAGAIN', '/x/codex')
    const error = await resumeOver(() => made.child)
    expect(error).toBeInstanceOf(ResumeError)
    expect((await made.failed).listening).toBe(true)
    expect(codesIn(error)).toEqual(['EAGAIN'])
  })

  it('⚑ control: a spawn that throws synchronously already carried its errno, and still does', async () => {
    const error = await resumeOver(() => {
      throw Object.assign(new Error('spawn /x/codex ENOTDIR'), {
        code: 'ENOTDIR',
        syscall: 'spawn /x/codex',
      })
    })
    expect(error).toBeInstanceOf(ResumeError)
    expect(codesIn(error)).toEqual(['ENOTDIR'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the one reading of a chain — `transientSetupFailureOf`
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · transientSetupFailureOf — the codes a machine gets back by itself', () => {
  const ref = { provider: 'codex' as const, sessionId: 'thr_705', cwd: '/tmp/x', rotation: 0 }
  const errno = (code: unknown, cause?: unknown): Error =>
    Object.assign(new Error(`spawn /x ${String(code)}`, { cause }), { code })
  const over = (cause?: unknown): ResumeError =>
    new ResumeError(ref, 'resume failed', cause === undefined ? undefined : { cause })
  const reading = async (): Promise<(error: ResumeError) => string | null> =>
    (await import('../src/runtime')).transientSetupFailureOf

  it('🔴 each code a shortage raises is itself — one level down, and three', async () => {
    const read = await reading()
    for (const code of ['EMFILE', 'ENFILE', 'EAGAIN', 'ENOMEM']) {
      expect(read(over(errno(code))), code).toBe(code)
      expect(
        read(over(new Error('wrapped', { cause: new Error('again', { cause: errno(code) }) }))),
        code,
      ).toBe(code)
    }
  })

  it('⚑ control: every code a PERSON has to fix, an unknown code, and no code at all are null', async () => {
    const read = await reading()
    const persons = [
      'ENOENT',
      'EACCES',
      'EPERM',
      'ENOTDIR',
      'ELOOP',
      'ENAMETOOLONG',
      'EROFS',
      'ENOEXEC',
      'E2BIG',
    ]
    for (const code of [...persons, 'EWHATEVER']) expect(read(over(errno(code))), code).toBeNull()
    expect(read(over())).toBeNull()
    // ⚑ a lost Codex thread: a JSON-RPC refusal, which carries a cause and no code
    expect(
      read(over(new Error('{"code":-32600,"message":"no rollout found for thread"}'))),
    ).toBeNull()
    // ⚠️ a number is not a code
    expect(read(over(errno(-24)))).toBeNull()
  })

  it('⛔ the NEAREST code decides — a person’s error wrapping a shortage is still a person’s', async () => {
    const read = await reading()
    expect(read(over(errno('ENOENT', errno('EMFILE'))))).toBeNull()
    // ⚑ the paired positive, one fact over
    expect(read(over(new Error('no code here', { cause: errno('EMFILE') })))).toBe('EMFILE')
  })

  it('⚑ bounded: a chain deeper than the walk is not read to its end, and says nothing', async () => {
    const read = await reading()
    const wrapped = (depth: number): Error => {
      let link: Error = errno('EMFILE')
      for (let at = 0; at < depth; at++) link = new Error(`wrapped ${String(at)}`, { cause: link })
      return link
    }
    // ⚑ inside the bound the shortage is found; past it the walk stops — the permanent word, fail closed
    expect(read(over(wrapped(10)))).toBe('EMFILE')
    expect(read(over(wrapped(20)))).toBeNull()
  })

  it('⚑ a chain that loops ends, and says nothing', async () => {
    const read = await reading()
    const a = new Error('a') as Error & { cause?: unknown }
    const b = new Error('b', { cause: a })
    a.cause = b
    expect(read(over(a))).toBeNull()
  })

  it('⚑ …and the adapters’ own errors read as the shortage they were', async () => {
    const read = await reading()
    const claude = await new ClaudeRuntime(
      undefined,
      async () => true,
      undefined,
      undefined,
      () => aSpawnThatRanOutOf('EMFILE', '/x/claude').child,
    )
      .resume({ ...ref, provider: 'claude' }, { providerHome: home })
      .catch((thrown: unknown) => thrown)
    expect(read(claude as ResumeError)).toBe('EMFILE')
    armed.next = () => aSpawnRefusedAfterItsPipes('EAGAIN', '/x/codex').child
    const codex = await new CodexRuntime(
      createSpawnTransportFactory('/nonexistent/brobot2-705/codex'),
    )
      .resume(ref, { providerHome: home })
      .catch((thrown: unknown) => thrown)
    expect(read(codex as ResumeError)).toBe('EAGAIN')
  })
})
