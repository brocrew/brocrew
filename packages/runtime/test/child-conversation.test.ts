import { describe, expect, it } from 'vitest'
import {
  CHILD_STATE_UNKNOWN,
  capabilitiesFor,
  childInputRefusal,
  childStatusOf,
  CodexRuntime,
  type ChildThreadState,
  type CodexLaunchContext,
  type CodexIncoming,
  type CodexTransport,
} from '../src/index'
import { AsyncQueue } from '../src/internal/async-queue'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import { threadStartResponse } from './fixtures/codex-protocol'

/**
 * # A child you can talk to (296) — the rule, and the refusal that is the dispatch
 *
 * ⛔ **Every wire shape in this file is copied from `295`'s capture**, not invented. That capture is
 * 167 ordered frames against the bundled app-server 0.146.0, hash
 * `8079b5dd…03ed024`, and the fields below — `status.type`, `canAcceptDirectInput`,
 * `agentNickname`, the `parentThreadId` lineage — are the ones it actually returned for a live
 * child, a finished child, and a cold one.
 *
 * ⚠️ **The test §4 asked for is the ACTIVE-child case, and it is the pair `refuses to write` /
 * `writes exactly once`.** A refusal test alone would pass over an adapter that never sends
 * anything; the paired positive is what makes it mean *"this one and not that one"*.
 */

/** The child id `295` was given, kept verbatim so a reader can find it in that capture. */
const CHILD = '01a05f65-acd4-7973-a576-10bf559433b9'
const PARENT = '01a05f65-76f6-7db3-944a-a853fe6272ae'

/**
 * A `thread/read` response in the exact shape the provider returned (295 §3.1).
 *
 * ⚠️ **`canAcceptDirectInput` defaults to `true` here because that is what was MEASURED** on a live
 * child — including one that was mid-turn, which is the whole reason this app cannot use that field
 * on its own to decide whether to write.
 */
function threadRead(
  status: 'active' | 'idle' | 'notLoaded' | 'systemError',
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    thread: {
      id: CHILD,
      sessionId: PARENT,
      parentThreadId: PARENT,
      status: status === 'active' ? { type: 'active', activeFlags: [] } : { type: status },
      canAcceptDirectInput: true,
      threadSource: 'subagent',
      agentNickname: 'Plato',
      turns: [],
      ...overrides,
    },
  }
}

/** A transport that answers the handshake and lets a test dictate `thread/read`. */
class ChildTransport implements CodexTransport {
  private readonly queue = new AsyncQueue<CodexIncoming>()
  readonly sent: { method: string; params: unknown }[] = []
  /** What the next `thread/read` answers with. A function so a test can change it mid-flight. */
  read: () => unknown = () => threadRead('idle')
  codexHome: string | undefined
  /** Set to reject `thread/read`, which is how "the provider did not answer" is reached. */
  failRead = false

  request(method: string, params: unknown): Promise<unknown> {
    this.sent.push({ method, params })
    if (method === 'initialize') {
      return Promise.resolve({
        userAgent: `brobot2/${CODEX_PROTOCOL_VERSION} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: this.codexHome,
      })
    }
    if (method === 'thread/start') return Promise.resolve(threadStartResponse('th_1'))
    if (method === 'thread/read') {
      return this.failRead
        ? Promise.reject(new Error('transport: thread/read failed'))
        : Promise.resolve(this.read())
    }
    if (method === 'turn/start') return Promise.resolve({ turn: { id: 'tn_child_1' } })
    return Promise.resolve({})
  }
  notify(): void {}
  respond(): void {}
  respondError(): void {}
  incoming(): AsyncIterable<CodexIncoming> {
    return this.queue
  }
  close(): void {
    this.queue.close()
  }
  /** Every `turn/start` this transport was asked to write, in order. */
  get turnStarts(): unknown[] {
    return this.sent.filter((one) => one.method === 'turn/start').map((one) => one.params)
  }
}

async function started(): Promise<{
  transport: ChildTransport
  handle: Awaited<ReturnType<CodexRuntime['start']>>
}> {
  const transport = new ChildTransport()
  const runtime = new CodexRuntime((ctx: CodexLaunchContext) => {
    transport.codexHome ??= ctx.providerHome
    return transport
  })
  const handle = await runtime.start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
  return { transport, handle }
}

describe('296 · the rule, on its own', () => {
  it('⛔ refuses a WORKING child, and that is the whole ruling', () => {
    const working: ChildThreadState = {
      status: 'working',
      acceptsInput: true,
      nickname: 'Plato',
      turns: 1,
    }
    // ⚠️ **The provider said `canAcceptDirectInput: true` and we refuse anyway**, which is the
    // uncomfortable half. 295 measured that field reading `true` for a child mid-turn whose
    // `turn/start` then merged into the running turn. Trusting it is exactly the defect.
    expect(childInputRefusal(working)).toBe('working')
  })

  it('⚑ …and permits an IDLE one — the paired positive', () => {
    expect(
      childInputRefusal({ status: 'idle', acceptsInput: true, nickname: null, turns: 2 }),
    ).toBeNull()
  })

  it('⛔ `null` is not `false`: "the capability is unavailable" is not "this child refuses"', () => {
    // The vendored type's own words for the null. An idle child the provider said nothing about is
    // addressable; one it said `false` about is not.
    expect(
      childInputRefusal({ status: 'idle', acceptsInput: null, nickname: null, turns: 0 }),
    ).toBeNull()
    expect(
      childInputRefusal({ status: 'idle', acceptsInput: false, nickname: null, turns: 0 }),
    ).toBe('not-accepting')
  })

  it('each remaining status has its own word — none of them collapses into another', () => {
    const of = (status: ChildThreadState['status']): string | null =>
      childInputRefusal({ status, acceptsInput: true, nickname: null, turns: null })
    expect([of('working'), of('unloaded'), of('error'), of('idle')]).toEqual([
      'working',
      'unloaded',
      'error',
      null,
    ])
  })

  it('⛔ an unrecognised provider status is `error`, never `idle`', () => {
    // A status this app has never seen is a thread it cannot promise anything about, and the safe
    // reading of "I do not know" is the one that keeps the composer shut.
    expect(childStatusOf('idle')).toBe('idle')
    expect(childStatusOf('active')).toBe('working')
    expect(childStatusOf('notLoaded')).toBe('unloaded')
    expect(childStatusOf('systemError')).toBe('error')
    expect(childStatusOf('somethingNewInTheNextRelease')).toBe('error')
    expect(childStatusOf(undefined)).toBe('error')
  })

  it('the unknown state keeps the composer shut rather than inventing an idle child', () => {
    expect(childInputRefusal(CHILD_STATE_UNKNOWN)).toBe('unloaded')
  })
})

describe('296 · the Codex adapter', () => {
  it('reads the provider’s own fields — status, direct input, the name IT chose', async () => {
    const { transport, handle } = await started()
    transport.read = () => threadRead('active')
    const state = await handle.childState!(CHILD)
    expect(state).toEqual({
      status: 'working',
      acceptsInput: true,
      // ⚠️ 295 asked for a child called `probechild` and the provider named it `Plato`. Nothing in
      // this app keys on a name it asked for.
      nickname: 'Plato',
      turns: 0,
    })
    // `includeTurns` is deliberately absent: the turns are read off disk by the viewer, and this
    // asks for status.
    expect(transport.sent.filter((one) => one.method === 'thread/read')).toEqual([
      { method: 'thread/read', params: { threadId: CHILD } },
    ])
    await handle.close()
  })

  it('🔴 REFUSES a working child and writes NOTHING to the wire', async () => {
    const { transport, handle } = await started()
    transport.read = () => threadRead('active')
    const outcome = await handle.childInput!(CHILD, 'are you nearly done?')
    expect(outcome).toMatchObject({ ok: false, reason: 'working' })
    // ⛔ **The assertion the dispatch is about.** 295 measured what happens when this IS written:
    // the message joins the running turn, ends it early, and the command that turn started keeps
    // going for another 7.667 s past its own reported completion.
    expect(transport.turnStarts, 'a message to a busy child must not reach the app-server').toEqual(
      [],
    )
    await handle.close()
  })

  it('⚑ …and WRITES for an idle one — the paired positive, with nothing extra on it', async () => {
    const { transport, handle } = await started()
    transport.read = () => threadRead('idle')
    const outcome = await handle.childInput!(CHILD, 'how did it go?')
    expect(outcome).toEqual({ ok: true, turnId: 'tn_child_1' })
    // ⛔ **Exactly two fields.** `turnStartParams` re-pins model, effort, approval policy and sandbox
    // on every turn of OUR thread; sending any of them here would silently reconfigure somebody
    // else's agent from this session's settings.
    expect(transport.turnStarts).toEqual([
      { threadId: CHILD, input: [{ type: 'text', text: 'how did it go?', text_elements: [] }] },
    ])
    await handle.close()
  })

  it('⛔ speaking to a child does NOT make the parent busy', async () => {
    const { transport, handle } = await started()
    transport.read = () => threadRead('idle')
    expect(handle.status()).toBe('idle')
    await handle.childInput!(CHILD, 'a word')
    // The child's turn is not this session's turn. Going through `beginTurn()` would emit `working`
    // for a conversation nobody sent anything to, and would then wait for a `turn/completed` this
    // session's own foreign-thread gate refuses to read.
    expect(handle.status(), 'the parent is exactly as busy as it was').toBe('idle')
    // …and the paired positive, so this is not a test that would pass over a handle that can never
    // report `working` at all.
    await handle.send('now do something')
    expect(handle.status()).toBe('working')
    await handle.close()
  })

  it('an idle child the provider will not take input for is `not-accepting`, and unwritten', async () => {
    const { transport, handle } = await started()
    transport.read = () => threadRead('idle', { canAcceptDirectInput: false })
    expect(await handle.childInput!(CHILD, 'hello?')).toMatchObject({
      ok: false,
      reason: 'not-accepting',
    })
    expect(transport.turnStarts).toEqual([])
    await handle.close()
  })

  it('an unloaded child is `unloaded` — the provider is holding nothing to speak to', async () => {
    const { transport, handle } = await started()
    // 295 §4: the cold read answers `notLoaded` and reports `canAcceptDirectInput: null`.
    transport.read = () => threadRead('notLoaded', { canAcceptDirectInput: null })
    const state = await handle.childState!(CHILD)
    expect(state.status).toBe('unloaded')
    expect(state.acceptsInput, 'null is carried, never coerced to false').toBeNull()
    expect(await handle.childInput!(CHILD, 'hello?')).toMatchObject({ reason: 'unloaded' })
    expect(transport.turnStarts).toEqual([])
    await handle.close()
  })

  it('⛔ a malformed answer is the UNKNOWN state, not an idle child', async () => {
    const { transport, handle } = await started()
    transport.read = () => ({ notAThread: true })
    expect(await handle.childState!(CHILD)).toEqual(CHILD_STATE_UNKNOWN)
    expect(transport.turnStarts).toEqual([])
    // Paired: the same handle DOES read a well-formed one, so this is not passing over an adapter
    // that returns the unknown state for everything.
    transport.read = () => threadRead('idle')
    expect((await handle.childState!(CHILD)).status).toBe('idle')
    await handle.close()
  })

  it('a transport that rejects still rejects — a wire failure is not a fact about the child', async () => {
    const { transport, handle } = await started()
    transport.failRead = true
    // ⚠️ The four `ok: false` arms are things the provider TOLD us. This is not one of them, so it
    // travels as a rejection and the host turns it into `unreachable` — a different word, because
    // it is a different fact.
    await expect(handle.childState!(CHILD)).rejects.toThrow(/thread\/read/)
    await handle.close()
  })

  it('a closed session answers the unknown state rather than reaching a dead transport', async () => {
    const { transport, handle } = await started()
    await handle.close()
    const before = transport.sent.length
    expect(await handle.childState!(CHILD)).toEqual(CHILD_STATE_UNKNOWN)
    expect(transport.sent.length, 'nothing was written after close').toBe(before)
  })
})

describe('296 · the capability and the adapter say the same thing', () => {
  it('⛔ `childInput: available` iff the handle really has the members', () => {
    // ⚠️ **The pin `runtime-host.ts` leans on.** `childChannel` asks the capability table for the
    // provider-level answer — a fact it can give without a live session — and then checks the
    // handle's optional members as a backstop. Those two must agree or the backstop is the only
    // thing standing between a person and a `TypeError`. The gap ledger in `conformance.test.ts` is
    // the other half of this pin: it lists `childState`/`childInput` as Claude's gaps by name.
    expect(capabilitiesFor('codex').childInput.state).toBe('available')
    expect(capabilitiesFor('claude').childInput.state).toBe('absent')
  })

  it('the absent arm names where somebody looked, and it is specific enough to re-check', () => {
    const claude = capabilitiesFor('claude').childInput
    if (claude.state !== 'absent') throw new Error('claude.childInput is no longer absent')
    // `absent` REQUIRES `checkedAgainst` — this asserts it is an artefact and a version rather than
    // a shrug. 029/030 shipped a fabricated `absent`; this is the shape that stops the next one.
    expect(claude.checkedAgainst).toContain('0.3.281')
    expect(claude.checkedAgainst).toContain('getSubagentMessages')
    expect(claude.reason.length).toBeGreaterThan(60)
  })

  it('⚑ the available arm says which of the two states a person is looking at', () => {
    const codex = capabilitiesFor('codex').childInput
    if (codex.state !== 'available') throw new Error('codex.childInput is no longer available')
    // The note has to carry the asymmetry, because `state` alone would say "you can talk to a child"
    // and leave out the half that is a refusal.
    expect(codex.note).toMatch(/IDLE/)
    expect(codex.note).toMatch(/working/)
  })
})
