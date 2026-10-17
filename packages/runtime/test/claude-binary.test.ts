import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeRuntime } from '../src/claude/claude-runtime'
import * as runtime from '../src/runtime'

/**
 * # 🔴 716 · R66 — Claude's missing program, as a type, measured through the SDK's own resolver
 *
 * ⚑ **PM ruling R66** (`710` F-2): *"… Claude's 'Native CLI binary … not found', thrown before any
 * spawn, get[s] R51's permanent word, not a broken tool. … The Claude adapter throws a typed error for
 * the missing binary, so the word is chosen by type, never by matching message text."*
 *
 * ⚑ **The SDK's throw is MEASURED, never built**: the SDK reads `process.platform` and `process.arch`
 * when `query()` is called, so this file runs the SDK's real `query()` while the process reports an
 * architecture the SDK ships no program for — and the SDK's own resolver misses, as it would on a
 * machine whose optional platform package never installed. ⛔ Nothing here can start a CLI: every
 * adapter below is handed a spawn that throws, and the SDK refuses before it would call it.
 *
 * ⚠️ `claude-binary` is imported DYNAMICALLY and `runtime` as a namespace, so that `main` — which has
 * neither the module nor the folder reader — can run this file: §0's measurement and §1's control pass
 * there, the 🔴 arms fail on their assertions, and the arms bound to the new module are marked ⛔.
 */

type Binary = Partial<typeof import('../src/claude/claude-binary')>
const binary: Binary = await import('../src/claude/claude-binary').catch(() => ({}))

const REAL_ARCH = Object.getOwnPropertyDescriptor(process, 'arch') as PropertyDescriptor

/** Run `body` while this process reports an architecture the SDK has no program for. */
async function asAnArchWithNoProgram<T>(body: () => T | Promise<T>): Promise<T> {
  Object.defineProperty(process, 'arch', { ...REAL_ARCH, value: 'mips' })
  try {
    return await body()
  } finally {
    Object.defineProperty(process, 'arch', REAL_ARCH)
  }
}

/** ⛔ A spawn no test here may reach — the SDK refuses before it would call it. */
const MUST_NOT_SPAWN = (): never => {
  throw new Error('716: a Claude CLI was spawned by a test that must never start one')
}

/** A prompt that never says anything — `query()` is only asked to resolve its program here. */
const neverSends = (): AsyncIterable<never> => ({
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
})

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'brobot2-716-claude-binary-'))
})
afterEach(() => {
  Object.defineProperty(process, 'arch', REAL_ARCH)
  chmodSync(home, 0o700)
  rmSync(home, { recursive: true, force: true })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · what the SDK throws, measured
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§0 · the SDK’s missing program — measured, not assumed', () => {
  it('⚑ `query()` throws it SYNCHRONOUSLY, before any spawn, with no code — so no errno reader sees it', async () => {
    let thrown: unknown = 'query() returned instead of throwing'
    await asAnArchWithNoProgram(() => {
      try {
        query({ prompt: neverSends(), options: { spawnClaudeCodeProcess: MUST_NOT_SPAWN } })
      } catch (error) {
        thrown = error
      }
    })
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain(
      `Native CLI binary for ${process.platform}-mips not found`,
    )
    expect((thrown as { code?: unknown }).code).toBeUndefined()
    // ⚑ `710` F-2's finding, still true of the SDK's own error: R51's reader cannot see it.
    expect(runtime.spawnNoWaitClearsOf(thrown)).toBeNull()
  })

  it('⛔ the program is where the SDK looks when the architecture is this machine’s', () => {
    const found = binary.claudeProgramWhereTheSdkLooks?.()
    expect(found).toMatch(/claude-agent-sdk-[a-z0-9]+-[a-z0-9]+\/claude$/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the adapter's three calls into the SDK
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the adapter says it as a TYPE — at a start, a resume and the model probe', () => {
  const adapter = (): ClaudeRuntime =>
    new ClaudeRuntime(undefined, async () => true, undefined, undefined, MUST_NOT_SPAWN)
  const ref = { provider: 'claude' as const, sessionId: 'sess_716', cwd: '/tmp/x', rotation: 0 }

  const isClaudeUnavailable = (error: unknown): boolean =>
    error instanceof Error && error.name === 'ClaudeUnavailableError'

  it('🔴 a start rejects `ClaudeUnavailableError`, in a person’s words, the SDK’s error as its cause', async () => {
    const error = await asAnArchWithNoProgram(() =>
      adapter()
        .start({ cwd: home, providerHome: home, approvalMode: 'auto' })
        .then(
          () => 'the start RESOLVED',
          (thrown: unknown) => thrown,
        ),
    )
    expect(isClaudeUnavailable(error)).toBe(true)
    // ⚑ The SDK ships no program for a `mips` machine, so the person is not told to reinstall — a
    // reinstall would not bring one (review of `716`).
    expect((error as Error).message).toBe(
      `Claude Code isn't available — the Agent SDK carries no Claude Code for this computer (${process.platform}-mips), so no Claude conversation can start here.`,
    )
    expect(((error as Error).cause as Error).message).toContain('Native CLI binary')
  })

  it('🔴 a resume rejects it too — NOT wrapped in a `ResumeError`, so a wake can name the program', async () => {
    const error = await asAnArchWithNoProgram(() =>
      adapter()
        .resume(ref, { providerHome: home })
        .then(
          () => 'the resume RESOLVED',
          (thrown: unknown) => thrown,
        ),
    )
    expect(isClaudeUnavailable(error)).toBe(true)
    expect(error).not.toBeInstanceOf(runtime.ResumeError)
  })

  it('🔴 the model probe rejects it too', async () => {
    const error = await asAnArchWithNoProgram(() =>
      adapter()
        .listModels({ providerHome: home })
        .then(
          () => 'the probe RESOLVED',
          (thrown: unknown) => thrown,
        ),
    )
    expect(isClaudeUnavailable(error)).toBe(true)
  })

  it('⚑ control — anything else the SDK throws, with the program in place, goes on as it came', async () => {
    const other = new Error('the SDK refused an option')
    const error = await new ClaudeRuntime(
      () => {
        throw other
      },
      async () => true,
      undefined,
      undefined,
      MUST_NOT_SPAWN,
    )
      .start({ cwd: home, providerHome: home, approvalMode: 'auto' })
      .then(
        () => 'the start RESOLVED',
        (thrown: unknown) => thrown,
      )
    expect(error).toBe(other)
  })

  it('⛔ a reinstall is offered only where the SDK ships a program, and only there', () => {
    const shipped = binary.claudeProgramShipsHere?.(
      binary.claudeProgramCandidates?.(process.platform, process.arch, false) ?? [],
    )
    expect(shipped).toBe(true)
    expect(
      binary.claudeProgramShipsHere?.(['@anthropic-ai/claude-agent-sdk-darwin-mips/claude']),
    ).toBe(false)
    const missing = binary.aProgramTheSdkCouldNotFind?.(
      new Error('x'),
      () => null,
      () => true,
    ) as Error
    expect(missing.message).toContain('is missing')
    expect(missing.message).toContain(
      "Reinstall the checkout's dependencies without skipping optional ones.",
    )
  })

  it('⛔ the question is asked of where the SDK looks, never of what it said', () => {
    const said = new Error('Native CLI binary for darwin-arm64 not found')
    expect(binary.aProgramTheSdkCouldNotFind?.(said, () => '/x/claude')).toBe(said)
    expect(
      isClaudeUnavailable(binary.aProgramTheSdkCouldNotFind?.(new Error('x'), () => null)),
    ).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · the candidates, as the SDK spells them
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · the SDK’s candidates, in its order', () => {
  it('⛔ one package per platform and architecture — glibc before musl on Linux, unless there is none', () => {
    const pkg = '@anthropic-ai/claude-agent-sdk-'
    expect(binary.claudeProgramCandidates?.('darwin', 'arm64', false)).toEqual([
      `${pkg}darwin-arm64/claude`,
    ])
    expect(binary.claudeProgramCandidates?.('win32', 'x64', false)).toEqual([
      `${pkg}win32-x64/claude.exe`,
    ])
    expect(binary.claudeProgramCandidates?.('linux', 'x64', false)).toEqual([
      `${pkg}linux-x64/claude`,
      `${pkg}linux-x64-musl/claude`,
    ])
    expect(binary.claudeProgramCandidates?.('linux', 'x64', true)).toEqual([
      `${pkg}linux-x64-musl/claude`,
      `${pkg}linux-x64/claude`,
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the folder reader — R66's other half
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · `folderAPersonMustFixOf` — the nearest code decides, and a spawn’s is the program’s', () => {
  const errno = (code: string, syscall: string, path?: string): Error =>
    Object.assign(new Error(`${code}: ${syscall}`), { code, syscall, ...(path ? { path } : {}) })
  const read = (error: unknown): unknown => runtime.folderAPersonMustFixOf?.(error) ?? null

  it('🔴 a real `mkdir` the disk refused is read as its code, with the path Node named', () => {
    const locked = join(home, 'locked')
    mkdirSync(locked)
    chmodSync(locked, 0o500)
    let thrown: unknown = null
    try {
      mkdirSync(join(locked, 'provider-home'))
    } catch (error) {
      thrown = error
    }
    chmodSync(locked, 0o700)
    expect((thrown as { code?: unknown }).code).toBe('EACCES')
    expect(read(thrown)).toEqual({
      code: 'EACCES',
      path: join(locked, 'provider-home'),
      syscall: 'mkdir',
    })
  })

  it('🔴 every code a person must fix, raw or as a cause', () => {
    for (const code of ['EACCES', 'EPERM', 'EROFS', 'ENOSPC', 'EDQUOT', 'ENOTDIR']) {
      expect(read(errno(code, 'open', '/p')), code).toEqual({ code, path: '/p', syscall: 'open' })
    }
    expect(read(errno('EEXIST', 'mkdir'))).toEqual({ code: 'EEXIST', path: null, syscall: 'mkdir' })
    // ⚑ `publishOwnFile`'s shape: a plain Error carrying the errno as its cause
    expect(read(new Error('could not stage', { cause: errno('ENOSPC', 'write') }))).toEqual({
      code: 'ENOSPC',
      path: null,
      syscall: 'write',
    })
  })

  it('⛔ bounds: a spawn’s code, a shortage, the lock’s `EEXIST`, a database’s code, no code, a nearer code', () => {
    expect(read(errno('EACCES', 'spawn /x/claude'))).toBeNull()
    expect(runtime.spawnNoWaitClearsOf(errno('EACCES', 'spawn /x/claude'))).toBe('EACCES')
    expect(read(errno('EMFILE', 'open'))).toBeNull()
    expect(runtime.transientSetupFailureOf(errno('EMFILE', 'open'))).toBe('EMFILE')
    // ⚠️ the provisioning lock's timeout: its cause is `open`'s EEXIST, which a wait clears
    expect(
      read(new Error('timed out acquiring provisioning lock', { cause: errno('EEXIST', 'open') })),
    ).toBeNull()
    expect(
      read(
        Object.assign(new Error('attempt to write a readonly database'), {
          code: 'SQLITE_READONLY',
        }),
      ),
    ).toBeNull()
    expect(read(new Error('providerHome ancestor passes through a symlink'))).toBeNull()
    // ⚠️ an `open` is a write only where the caller says so (round two of `716`'s review)…
    expect(
      runtime.folderAPersonMustFixOf?.(errno('EACCES', 'open', '/p'), false) ?? null,
    ).toBeNull()
    // ⚠️ a READ refused is not a folder BroBot2 could not make or write (review of `716`)…
    expect(read(errno('EACCES', 'scandir', '/p'))).toBeNull()
    // …and what a provider's resume failed on is the provider's
    const ref = { provider: 'claude' as const, sessionId: 'x', cwd: '/x', rotation: 0 }
    expect(
      read(
        new runtime.ResumeError(ref, 'resume setup failed', {
          cause: errno('EACCES', 'open', '/p'),
        }),
      ),
    ).toBeNull()
    const nearer = Object.assign(new Error('open', { cause: errno('EACCES', 'mkdir') }), {
      code: 'EMFILE',
      syscall: 'open',
    })
    expect(read(nearer)).toBeNull()
  })
})
