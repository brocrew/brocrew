import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResumeError, type RuntimeEvent } from '../src/index'
import { ClaudeRuntime, claudeProjectDirName } from '../src/claude'
import { FakeQuery, init, collect, firstOfType, has, startFake } from './fake-claude-query'

describe('ClaudeRuntime — honest resume', () => {
  it('a RESUMED session runs with the effort it was created with (024)', async () => {
    // The resume path builds its own SDK options, so effort set on start but forgotten here would
    // silently downgrade a conversation the moment it was reopened — and nothing on screen would
    // change, because Claude never reports the value back to contradict us.
    const fq = new FakeQuery()
    let options: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        options = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 2 },
      { providerHome: '/tmp/x/home', reasoningEffort: 'high' },
    )
    expect(options?.effort, 'the resume options carry the recorded effort').toBe('high')
    // …and the resume must still be a resume: the effort rides alongside, it does not replace it.
    expect(options?.resume).toBe('sess_x')
    await handle.close()
    fq.end()
  })

  it('resuming with no recorded effort asks for none — not a default (024)', async () => {
    const fq = new FakeQuery()
    let options: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        options = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 2 },
      { providerHome: '/tmp/x/home' },
    )
    expect(options?.effort).toBeUndefined()
    await handle.close()
    fq.end()
  })

  it('resume: ref stays null until a MATCHING first-turn init validates it, then session resumed', async () => {
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      () => fq,
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 2 },
      { providerHome: '/tmp/x/home' },
    )
    expect(handle.ref).toBeNull() // provisional: not proven until the first-turn init (011)
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    fq.emit(init('sess_x', '/tmp/x')) // matches the requested ref
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(firstOfType(events, 'session').state).toBe('resumed')
    expect(handle.ref).toMatchObject({ sessionId: 'sess_x', cwd: '/tmp/x', rotation: 2 })
    await handle.close()
    fq.end()
    await consumer
  })

  it('resume: first-turn init with a DIFFERENT session_id → fatal errored, no resumed, ref stays null', async () => {
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      () => fq,
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    fq.emit(init('sess_DIFFERENT', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'session' && e.state === 'resumed')).toBe(false)
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    expect(handle.ref).toBeNull()
    await consumer // failResume closed the stream
  })

  it('resume: first-turn init with a DIFFERENT cwd → fatal errored (identity barrier)', async () => {
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      () => fq,
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    fq.emit(init('sess_x', '/tmp/OTHER'))
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'session' && e.state === 'resumed')).toBe(false)
    expect(handle.ref).toBeNull()
    await consumer
  })

  it('resume: first-turn init with an EMPTY cwd → fatal errored (cwd must be proven, not echoed)', async () => {
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      () => fq,
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    fq.emit(init('sess_x', '')) // matching id, but the provider did not prove the cwd
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'session' && e.state === 'resumed')).toBe(false)
    expect(handle.ref).toBeNull()
    await consumer
  })

  it('resume of a missing session → ResumeError (no silent fresh session)', async () => {
    const runtime = new ClaudeRuntime(
      () => new FakeQuery(),
      async () => false,
    )
    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 'sess_gone', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('resume with a wrong-provider ref → ResumeError', async () => {
    const runtime = new ClaudeRuntime(
      () => new FakeQuery(),
      async () => true,
    )
    await expect(
      runtime.resume(
        { provider: 'codex', sessionId: 'x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('threads the provider home into the existence-check seam (021)', async () => {
    let seenHome: string | undefined
    const runtime = new ClaudeRuntime(
      () => new FakeQuery(),
      async (_sessionId, _cwd, providerHome) => {
        seenHome = providerHome
        return false // reject so we don't need to drive a turn
      },
    )
    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/managed/profile' },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
    expect(seenHome).toBe('/managed/profile')
  })
})

/**
 * 🔴 **715 · R64 — a `cd` is not a different conversation.**
 *
 * `probe:claude-resume-after-cd` measured bundled CLI 2.1.281 sending `system/init` at every
 * turn and naming `<launch>/sub` after `cd sub && pwd`. Version 2.1.218 kept `<launch>` for
 * the same move. A later init in a resumed session must not trigger a fatal initial-resume
 * mismatch merely because Bash changed cwd.
 *
 * ⛔ **The ruling:** the barrier proves identity ONCE, on the first init after a resume; a later
 * init in the same live session is not a resume and its cwd is not an identity claim; the ref keeps
 * its LAUNCH cwd. ⚑ **The barrier's purpose stands** — the controls below are the first init.
 */
describe('715 · R64 — the resume barrier proves identity once, on the first init', () => {
  const ref = { provider: 'claude' as const, sessionId: 'sess_x', cwd: '/tmp/x', rotation: 2 }

  async function resumed(): Promise<{
    fq: FakeQuery
    handle: Awaited<ReturnType<ClaudeRuntime['resume']>>
    events: RuntimeEvent[]
    consumer: Promise<void>
  }> {
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      (params) => {
        fq.cli.listen(params.prompt)
        return fq
      },
      async () => true,
    )
    const handle = await runtime.resume(ref, { providerHome: '/tmp/x/home' })
    const events: RuntimeEvent[] = []
    return { fq, handle, events, consumer: collect(handle, events) }
  }

  /**
   * ⚑ A fence after the frame under test, so a negative cannot pass before the frame is read — or
   * the fatal error that frame caused, so a session the barrier killed fails on its own sentence.
   */
  async function fenced(fq: FakeQuery, events: RuntimeEvent[], payload: number): Promise<void> {
    fq.emit({ type: 'weird_internal', payload })
    await vi.waitFor(
      has(
        events,
        (e) =>
          (e.type === 'unknown' && JSON.stringify(e.raw).includes(`${payload}`)) ||
          (e.type === 'error' && e.fatal),
      ),
    )
  }

  it('🔴 a LATER init naming the folder the model cd’d into is not a mismatch — and the next turn runs', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('sess_x', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    expect(firstOfType(events, 'session').state).toBe('resumed')

    // The next turn opens with an init that names where the Bash tool's `cd` left the CLI.
    await handle.send('what did you find?')
    fq.emit(init('sess_x', '/tmp/x/findings'))
    await fenced(fq, events, 715_1)

    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(false)
    // …and the turn it opened ends like any other.
    fq.emit({ type: 'result', subtype: 'success', is_error: false })
    await vi.waitFor(has(events, (e) => e.type === 'turn'))
    expect(firstOfType(events, 'turn').state).toBe('completed')

    await handle.close()
    fq.end()
    await consumer
  })

  it('⚑ the ref keeps its LAUNCH cwd — the moved one is never written into it', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('sess_x', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    fq.emit(init('sess_x', '/tmp/x/findings'))
    await fenced(fq, events, 715_2)

    expect(handle.ref).toEqual(ref)
    expect(events.filter((e) => e.type === 'session')).toEqual([
      { type: 'session', state: 'resumed', ref },
    ])

    await handle.close()
    fq.end()
    await consumer
    // ⚑ …and the ending names the launch cwd too — it is what the host archives from.
    expect(events.filter((e) => e.type === 'session' && e.state === 'ended')).toEqual([
      { type: 'session', state: 'ended', ref },
    ])
  })

  it('a later init naming ANOTHER session, with no reset before it, is not a resume either', async () => {
    // ⚑ `probe:claude-resume-after-cd`'s `fresh-clear` arm: after `/clear`, the next init carries an
    // id that is neither the old one nor the one `conversation_reset` named. ⚑ `721` · R75: THAT init
    // moves the ref, because a reset came first (the `199` block above). With no reset, R64 stands.
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('sess_x', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    fq.emit(init('sess_after_clear', '/tmp/x'))
    await fenced(fq, events, 715_3)

    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(false)
    expect(handle.ref).toEqual(ref)

    await handle.close()
    fq.end()
    await consumer
  })

  it('a later init naming a folder OUTSIDE the launch cwd is not a mismatch either — `cd ..` is a `cd`', async () => {
    // ⚑ Where "a later cwd is no claim" and "a later cwd UNDER the launch folder is fine" diverge.
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('sess_x', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    fq.emit(init('sess_x', '/elsewhere'))
    await fenced(fq, events, 715_5)

    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(handle.ref).toEqual(ref)

    await handle.close()
    fq.end()
    await consumer
  })

  it('a later init with no session id at all is read for nothing — it ends nothing', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('sess_x', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    fq.emit(init('', '/tmp/x/findings'))
    await fenced(fq, events, 715_6)

    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(handle.ref).toEqual(ref)

    await handle.close()
    fq.end()
    await consumer
  })

  it('🔴 a later init while the session is CLOSING does not reopen it, or move the ref it ends on', async () => {
    // ⛔ 715's review, F1: `closing` is not `active`, so a later init handed to `sessionStarted`
    // flipped a closing session back to `active` and announced the MOVED ref — which the host
    // archives, and reopens from. The window is the close's interrupt, held open here.
    const { fq, handle, events, consumer } = await resumed()
    let release: (() => void) | undefined
    fq.interrupt = () =>
      new Promise<undefined>((resolve) => {
        release = () => resolve(undefined)
      })
    fq.emit(init('sess_x', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    await handle.send('go')

    const closing = handle.close()
    await vi.waitFor(() => expect(release).toBeDefined())
    fq.emit(init('sess_x', '/tmp/x/findings'))
    await fenced(fq, events, 715_7)

    expect(events.filter((e) => e.type === 'session')).toEqual([
      { type: 'session', state: 'resumed', ref },
    ])
    expect(handle.ref).toEqual(ref)

    release?.()
    fq.end()
    await closing
    await consumer
    expect(events.filter((e) => e.type === 'session' && e.state === 'ended')).toEqual([
      { type: 'session', state: 'ended', ref },
    ])
  })

  it('⛔ control · a FIRST init with no session id still fails — `011`’s malformed check stands', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))

    expect(firstOfType(events, 'error').message).toBe(
      'malformed session init: empty or invalid session id',
    )
    expect(handle.ref).toBeNull()
    await consumer
  })

  it('⛔ control · the FIRST init naming that same moved folder still fails the resume', async () => {
    // ⚑ Where the two readings diverge: a rule that accepted any folder under the launch cwd would
    // pass the first test above and fail this one.
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('sess_x', '/tmp/x/findings'))
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))

    expect(firstOfType(events, 'error').message).toBe(
      'resume mismatch: expected sess_x@/tmp/x, got sess_x@/tmp/x/findings',
    )
    expect(events.some((e) => e.type === 'session' && e.state === 'resumed')).toBe(false)
    expect(handle.ref).toBeNull()
    await consumer
  })

  /**
   * 🔴 **721 · R76 — a reset before the first init is the person's own command.** ⚑ The ruling
   * (`715` F-2): *"On a resume, a first init that follows a `conversation_reset` in the same launch
   * is accepted, and the ref moves as R75 says. A first init with no reset before it is held to R64's
   * exact match, as now."* ⚑ Measured (`probe:claude-resume-after-cd` arm `resumed-clear`): a
   * reopened conversation whose first message is `/clear` sends ONLY
   * `conversation_reset{session_id: <the resumed id>, new_conversation_id: R}` then `system/init`
   * naming a new id B — and died here: *"resume mismatch: expected T@…, got B@…"*.
   *
   * ⚑ **Accepted only on the CLI's own proof it resumed THIS conversation**: the reset's
   * `session_id` is the target (it held in both runs) — and the launch cwd still matches exactly.
   * The session opens as the conversation it resumed, then moves, with a seam, to B.
   */
  it('🔴 721 · R76 — a reopen whose first message is `/clear` runs, and moves the ref to the new conversation', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit({
      type: 'conversation_reset',
      session_id: 'sess_x',
      new_conversation_id: 'sess_R',
      uuid: 'u',
    })
    fq.emit(init('sess_B', '/tmp/x'))
    fq.emit({ type: 'result', subtype: 'success', is_error: false })
    await fenced(fq, events, 7601)
    // ⛔ **On `main`: the fatal *"resume mismatch: expected sess_x@/tmp/x, got sess_B@/tmp/x"*.**
    expect(events.some((e) => e.type === 'error' && e.fatal)).toBe(false)
    expect(events.filter((e) => e.type === 'session')).toEqual([
      { type: 'session', state: 'resumed', ref },
    ])
    expect(events.filter((e) => e.type === 'conversation_reset')).toEqual([
      {
        type: 'conversation_reset',
        ref: { ...ref, sessionId: 'sess_B' },
        source: 'conversation_reset + system/init',
      },
    ])
    expect(handle.ref).toEqual({ ...ref, sessionId: 'sess_B' })
    await handle.close()
    fq.end()
    await consumer
  })

  it('🔴 721 · R75 — a `/clear` later in a REOPENED conversation moves the ref, keeping the rotation it was reopened on', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('sess_x', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))
    fq.emit({
      type: 'conversation_reset',
      session_id: 'sess_x',
      new_conversation_id: 'sess_R',
      uuid: 'u',
    })
    fq.emit(init('sess_B', '/tmp/x'))
    await fenced(fq, events, 7501)
    // ⛔ **On `main` the ref named `sess_R`**, which has no transcript; a ref rebuilt at rotation 0
    // (`199 M5`) would name a conversation no resume of this one can match.
    expect(events.some((e) => e.type === 'error' && e.fatal)).toBe(false)
    expect(handle.ref).toEqual({ ...ref, sessionId: 'sess_B' })
    await handle.close()
    fq.end()
    await consumer
  })

  it('⛔ 721 · R76 CONTROL — a reset from ANOTHER conversation proves nothing: the first init still fails', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit({
      type: 'conversation_reset',
      session_id: 'sess_other',
      new_conversation_id: 'sess_R',
      uuid: 'u',
    })
    fq.emit(init('sess_B', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(firstOfType(events, 'error').message).toBe(
      'resume mismatch: expected sess_x@/tmp/x, got sess_B@/tmp/x',
    )
    expect(handle.ref).toBeNull()
    await consumer
  })

  it('⛔ 721 · R76 CONTROL — after the reset, the first init must still name the LAUNCH folder', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit({
      type: 'conversation_reset',
      session_id: 'sess_x',
      new_conversation_id: 'sess_R',
      uuid: 'u',
    })
    fq.emit(init('sess_B', '/tmp/x/elsewhere'))
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(firstOfType(events, 'error').message).toBe(
      'resume mismatch: expected sess_x@/tmp/x, got sess_B@/tmp/x/elsewhere',
    )
    expect(handle.ref).toBeNull()
    await consumer
  })

  it('⛔ control · the FIRST init naming another session still fails the resume', async () => {
    const { fq, handle, events, consumer } = await resumed()
    fq.emit(init('sess_after_clear', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))

    expect(firstOfType(events, 'error').message).toBe(
      'resume mismatch: expected sess_x@/tmp/x, got sess_after_clear@/tmp/x',
    )
    expect(handle.ref).toBeNull()
    await consumer
  })

  it('⚑ control · a FRESH session is unchanged — a moved later init was never a check there', async () => {
    const { fq, handle, events, consumer } = await startFake()
    fq.emit(init('sess_1', '/tmp/x'))
    await vi.waitFor(has(events, (e) => e.type === 'session'))

    fq.emit(init('sess_1', '/tmp/x/findings'))
    await fenced(fq, events, 715_4)

    expect(firstOfType(events, 'session').state).toBe('started')
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    expect(handle.ref).toEqual({
      provider: 'claude',
      sessionId: 'sess_1',
      cwd: '/tmp/x',
      rotation: 0,
    })

    await handle.close()
    fq.end()
    await consumer
  })
})

describe('ClaudeRuntime — resume error boundary (030 P1-D)', () => {
  const ref = { provider: 'claude' as const, sessionId: 'sess_x', cwd: '/tmp/x', rotation: 0 }
  const opts = { providerHome: '/tmp/x/home' }

  it('a sessionExists preflight that THROWS → ResumeError (not a generic Error), cause preserved', async () => {
    const boom = new Error('fs probe blew up')
    const runtime = new ClaudeRuntime(
      () => new FakeQuery(),
      async () => {
        throw boom
      },
    )
    const err = await runtime.resume(ref, opts).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ResumeError)
    expect((err as ResumeError).cause).toBe(boom)
  })

  it('an eager query-factory failure → ResumeError (cause preserved) and the partial input queue is closed', async () => {
    const boom = new Error('query construction failed')
    let capturedInput: AsyncIterable<unknown> | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        capturedInput = params.prompt
        throw boom
      },
      async () => true,
    )
    const err = await runtime.resume(ref, opts).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ResumeError)
    expect((err as ResumeError).cause).toBe(boom)
    // The partially-created input queue was closed on failure (no leak): its iterator completes.
    expect(capturedInput).toBeDefined()
    const iter = capturedInput![Symbol.asyncIterator]()
    await expect(iter.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('the deliberate two-stage post-handle first-turn mismatch stays FATAL, not a ResumeError (011 preserved)', async () => {
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      () => fq,
      async () => true,
    )
    // Setup succeeded → resume RESOLVES a handle; the identity mismatch is a LATER stream error.
    const handle = await runtime.resume(ref, opts)
    expect(handle.ref).toBeNull() // provisional until the first-turn init validates (011)
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    fq.emit(init('sess_DIFFERENT', '/tmp/x')) // post-handle identity barrier
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'session' && e.state === 'resumed')).toBe(false)
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    await consumer
  })
})

describe('ClaudeRuntime — home-scoped resume precheck (021, default fs-probe seam)', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'brobot-claude-home-'))
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  /** Plant a Claude transcript at `<home>/projects/<encoded-cwd>/<sessionId>.jsonl`. */
  function plantTranscript(providerHome: string, sessionId: string, cwd: string): void {
    const dir = join(providerHome, 'projects', cwd.replace(/\//g, '-'))
    mkdirSync(dir, { recursive: true })
    // ⚑ **D-017 · R9** — a transcript that holds a conversation: a user record.
    writeFileSync(join(dir, `${sessionId}.jsonl`), '{"type":"user"}\n')
  }

  it('resumes when the transcript exists under the profile home', async () => {
    plantTranscript(home, 'sess_live', '/tmp/x')
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(() => fq) // DEFAULT seam → home-scoped fs probe
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_live', cwd: '/tmp/x', rotation: 0 },
      { providerHome: home },
    )
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    expect(handle.ref).toBeNull() // provisional until the first-turn init (011)
    await handle.close()
    fq.end()
    await consumer
  })

  it('rejects with ResumeError when the transcript is absent from the profile home', async () => {
    const runtime = new ClaudeRuntime(() => new FakeQuery())
    await expect(
      runtime.resume(
        { provider: 'claude', sessionId: 'sess_missing', cwd: '/tmp/x', rotation: 0 },
        { providerHome: home },
      ),
    ).rejects.toBeInstanceOf(ResumeError)
  })

  it('rejects when the transcript exists only under a DIFFERENT home (no cross-home leak)', async () => {
    plantTranscript(home, 'sess_live', '/tmp/x')
    const otherHome = mkdtempSync(join(tmpdir(), 'brobot-other-home-'))
    try {
      const runtime = new ClaudeRuntime(() => new FakeQuery())
      await expect(
        runtime.resume(
          { provider: 'claude', sessionId: 'sess_live', cwd: '/tmp/x', rotation: 0 },
          { providerHome: otherHome },
        ),
      ).rejects.toBeInstanceOf(ResumeError)
    } finally {
      rmSync(otherHome, { recursive: true, force: true })
    }
  })
})

describe('ClaudeRuntime — ref is never synthesized', () => {
  it('close before the first-turn init emits no session event and no "unstarted" placeholder', async () => {
    // ⚑ **722 · R79 narrowed this to the case it is still true of**: the CLI recorded NO transcript
    // under the id this launch asked for — this home holds none — so there is nothing honest to
    // announce.
    const fq = new FakeQuery()
    const runtime = new ClaudeRuntime(
      () => fq,
      async () => false,
    )
    const home = mkdtempSync(join(tmpdir(), 'brobot-011-'))
    const handle = await runtime.start({ cwd: '/tmp/x', providerHome: home })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    expect(handle.ref).toBeNull()
    await handle.close()
    fq.end()
    await consumer
    // A never-started session has no honest ref to announce as ended (011).
    expect(events.some((e) => e.type === 'session')).toBe(false)
    expect(handle.ref).toBeNull()
    expect(handle.status()).toBe('ended')
    rmSync(home, { recursive: true, force: true })
  })

  /**
   * 722 · the CLI's transcript for `sessionId`, filed under the folder it RECORDED. ⚑ Its first
   * records name no cwd — measured (`adopt-sessions.test.ts`).
   */
  function recordTranscript(
    home: string,
    sessionId: string,
    recorded: string,
    records: unknown[] = [
      { type: 'queue-operation', operation: 'enqueue', sessionId },
      { type: 'user', sessionId, cwd: recorded, message: { role: 'user', content: 'hello' } },
    ],
  ): void {
    const folder = join(home, 'projects', claudeProjectDirName(recorded))
    mkdirSync(folder, { recursive: true })
    writeFileSync(
      join(folder, `${sessionId}.jsonl`),
      records.map((one) => JSON.stringify(one)).join('\n') + '\n',
    )
  }

  /** 722 · a launch whose factory hands out `fakes` in order and keeps each launch's options. */
  function launching(...fakes: FakeQuery[]): { runtime: ClaudeRuntime; asked: Options[] } {
    const asked: Options[] = []
    const runtime = new ClaudeRuntime((params) => {
      asked.push(params.options)
      return fakes[asked.length - 1]!
    })
    return { runtime, asked }
  }

  // ⚑ The launch's folder as typed, and as the CLI resolved it — `/tmp` is `/private/tmp` on macOS,
  // and the CLI records the real path (the `722` review). Different project folders, too.
  const TYPED = '/tmp/x'
  const RECORDED = '/private/tmp/x'

  it('🔴 722 · R79 — a launch closed before init names the conversation it LAUNCHED, in the folder the CLI RECORDED', async () => {
    // ⚑ `717` F-1, step 10: closed 29 ms after its send, before `system/init`, while the CLI still
    // wrote a transcript — which the next scan adopted as a second conversation.
    const fq = new FakeQuery()
    const { runtime, asked } = launching(fq)
    const home = mkdtempSync(join(tmpdir(), 'brobot-722-'))
    const handle = await runtime.start({ cwd: TYPED, providerHome: home })
    const launchedAs = asked[0]?.sessionId
    // ⛔ A UUID, because the CLI refuses anything else: *"Invalid session ID. Must be a valid UUID."*
    expect(launchedAs).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(handle.launchedAs, 'the host’s scan reads it before any init').toBe(launchedAs)
    recordTranscript(home, launchedAs!, RECORDED)
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    expect(handle.ref, '011 stands while the session runs').toBeNull()
    await handle.close()
    fq.end()
    await consumer
    const launched = { provider: 'claude', sessionId: launchedAs, cwd: RECORDED, rotation: 0 }
    const sessions = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'session' }> => e.type === 'session',
    )
    expect(sessions.map((e) => [e.state, e.ref])).toEqual([['ended', launched]])
    expect(handle.ref).toEqual(launched)
    rmSync(home, { recursive: true, force: true })
  })

  it('⛔ 722 · control — a transcript that names no folder, or another session, announces nothing', async () => {
    // ⚑ What the adoption scan would not list either (`discover-sessions.ts`): no record naming a
    // cwd, or a record naming another session. A ref announced on either offers a reopen of nothing.
    for (const records of [
      (id: string) => [{ type: 'queue-operation', operation: 'enqueue', sessionId: id }],
      (id: string) => [
        { type: 'queue-operation', operation: 'enqueue', sessionId: 'not-' + id },
        { type: 'user', sessionId: id, cwd: RECORDED },
      ],
    ]) {
      const fq = new FakeQuery()
      const { runtime, asked } = launching(fq)
      const home = mkdtempSync(join(tmpdir(), 'brobot-722-'))
      const handle = await runtime.start({ cwd: TYPED, providerHome: home })
      const launchedAs = asked[0]!.sessionId!
      recordTranscript(home, launchedAs, RECORDED, records(launchedAs))
      const events: RuntimeEvent[] = []
      const consumer = collect(handle, events)
      await handle.close()
      fq.end()
      await consumer
      expect(events.some((e) => e.type === 'session')).toBe(false)
      expect(handle.ref).toBeNull()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('⚑ 722 · …and a reopen by that ref passes the resume barrier on the init the CLI then sends', async () => {
    // ⚑ The CLI's first init after `--resume` reports the folder it recorded; `validateInitRef`
    // compares it with the ref EXACTLY, so a ref carrying the typed folder would end the reopen with
    // *"resume mismatch"* (the `722` review).
    const first = new FakeQuery()
    const again = new FakeQuery()
    const { runtime, asked } = launching(first, again)
    const home = mkdtempSync(join(tmpdir(), 'brobot-722-'))
    const handle = await runtime.start({ cwd: TYPED, providerHome: home })
    const launchedAs = asked[0]!.sessionId!
    recordTranscript(home, launchedAs, RECORDED)
    const closing = collect(handle, [])
    await handle.close()
    first.end()
    await closing
    const reopened = await runtime.resume(handle.ref!, { providerHome: home })
    const events: RuntimeEvent[] = []
    const consumer = collect(reopened, events)
    again.emit(init(launchedAs, RECORDED))
    await vi.waitFor(has(events, (e) => e.type === 'session' && e.state === 'resumed'))
    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(reopened.ref).toEqual({
      provider: 'claude',
      sessionId: launchedAs,
      cwd: RECORDED,
      rotation: 0,
    })
    await reopened.close()
    again.end()
    await consumer
    rmSync(home, { recursive: true, force: true })
  })

  it('⛔ 722 · a RESUME names no session id — the CLI refuses one beside `--resume`', async () => {
    const fq = new FakeQuery()
    let options: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        options = params.options
        return fq
      },
      async () => true,
    )
    const handle = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_x', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home' },
    )
    expect(options?.resume).toBe('sess_x')
    // *"--session-id can only be used with --continue or --resume if --fork-session is also specified."*
    expect(options?.sessionId).toBeUndefined()
    await handle.close()
    fq.end()
  })
})

describe('the Claude project-dir encoding (086 — a live P1)', () => {
  /**
   * The bug survived because every test cwd was special-character-free, so the old `/`-only rule
   * matched by luck. These use a REALISTIC cwd: the app's default userData path contains a space
   * ("Application Support"), an `@` ("@brobot2") and an `_` ("sess_…") — the three characters the
   * old rule left intact.
   */
  const REAL_CWD = '/Users/x/Library/Application Support/@brobot2/desktop/scratch/sess_ab_cd'
  const REAL_DIR = '-Users-x-Library-Application-Support--brobot2-desktop-scratch-sess-ab-cd'

  it('replaces EVERY non-alphanumeric character, without collapsing runs', () => {
    // `/@` becomes `--`, not `-`. Verified against the real directories on disk.
    expect(claudeProjectDirName(REAL_CWD)).toBe(REAL_DIR)
    // The old rule left the space, the @ and the _ intact — that is what made the preflight look
    // in a directory that does not exist.
    expect(REAL_CWD.replace(/\//g, '-')).not.toBe(REAL_DIR)
  })

  it('matches the shapes seen on disk, including a plain path', () => {
    expect(claudeProjectDirName('/Users/alex/brobot2-scratch/ui-smoke')).toBe(
      '-Users-alex-brobot2-scratch-ui-smoke',
    )
    expect(claudeProjectDirName('/private/tmp/claude-1')).toBe('-private-tmp-claude-1')
  })

  it('the resume preflight FINDS a transcript under a realistic cwd', async () => {
    // The end-to-end shape of the bug: a transcript laid down where Claude really puts it, and a
    // resume that must locate it. With the `/`-only rule this resolves to a nonexistent directory
    // and resume fails with "session not found" while the file sits right there.
    const home = mkdtempSync(join(tmpdir(), 'brobot2-claude-projects-'))
    const sessionId = '295e814c-0000-4000-8000-000000000000'
    const dir = join(home, 'projects', REAL_DIR)
    mkdirSync(dir, { recursive: true })
    // ⚑ **D-017 · R9** — a transcript that holds a conversation: a user record.
    writeFileSync(join(dir, `${sessionId}.jsonl`), '{"type":"user"}\n')

    const fq = new FakeQuery()
    // The REAL preflight (no injected `sessionExists`) — that is the code under test.
    const runtime = new ClaudeRuntime(() => fq)
    const handle = await runtime.resume(
      { provider: 'claude', sessionId, cwd: REAL_CWD, rotation: 0 },
      { providerHome: home },
    )
    expect(handle.ref).toBeNull() // Claude latches its ref at the first turn's init (011)
    await handle.close()
    rmSync(home, { recursive: true, force: true })
  })

  it('a genuinely missing transcript still fails honestly', async () => {
    // The fix must not turn the preflight into a rubber stamp.
    const home = mkdtempSync(join(tmpdir(), 'brobot2-claude-projects-'))
    await expect(
      new ClaudeRuntime(() => new FakeQuery()).resume(
        { provider: 'claude', sessionId: 'nope', cwd: REAL_CWD, rotation: 0 },
        { providerHome: home },
      ),
    ).rejects.toThrow(/session not found/)
    rmSync(home, { recursive: true, force: true })
  })
})
