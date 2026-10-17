import { describe, expect, it } from 'vitest'
import { FakeRuntime, type ChildInputOutcome, type ChildThreadState } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { NULL_SESSION_STORE, type ResumableSession } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { SessionStore } from '../src/main/db/session-store'

/**
 * # A child you can talk to (296) — the main process's half
 *
 * ⛔ **This file is about ORDER as much as about answers.** `childChannel` asks four questions and
 * every one of them can be the true refusal; asking them in the wrong sequence produces answers that
 * are individually well-formed and collectively wrong. Two of the four orderings below were wrong in
 * the first draft of this dispatch and `window-authority.test.ts` is what found them.
 *
 * ⚠️ **SSR/node project, so nothing here renders.** The viewer's half is
 * `child-talk.render.test.ts`, and the gestures are `test/dom/child-talk.dom.test.ts` — the split
 * this repo uses everywhere, because a `renderToString` cannot press a button and a browser test
 * cannot see the host at all.
 */

const SESSION = 'sess_296'
const CHILD = '01a05f65-acd4-7973-a576-10bf559433b9'

/** The window that owns the conversation, and one that does not (203/062). */
class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly alive = true
  constructor(readonly ownerId: string) {}
  send(): void {}
  sendLiveness(): void {}
}

const rowFor = (provider: Provider): ResumableSession =>
  ({
    sessionId: SESSION,
    provider,
    ref: { provider, sessionId: 'parent-thread', cwd: '/tmp/w', rotation: 0 },
    cwd: '/tmp/w',
    profileId: 'default',
    updatedAt: 1_700_000_000_000,
  }) as unknown as ResumableSession

/** What the handle under test will say about the child, and what it recorded being told. */
interface Spy {
  state: ChildThreadState
  /** Every message that actually reached a handle. Empty is the assertion, over and over. */
  said: string[]
  /** When set, the handle's own re-read refuses — the race the host cannot close. */
  onInput?: () => ChildInputOutcome
}

function hostFor(
  provider: Provider,
  store: Partial<SessionStore>,
  spy: Spy | null,
): { host: RuntimeHost; owner: Sink; stranger: Sink; open: () => Promise<void> } {
  const owner = new Sink('webContents:1')
  const stranger = new Sink('webContents:2')
  const host = new RuntimeHost({
    store: { ...NULL_SESSION_STORE, ...store },
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => '/tmp/brobot2-296-exports',
    createRuntime: (which: Provider) => {
      const runtime = new FakeRuntime(which)
      if (spy === null) return runtime
      // ⚠️ **The Fake has neither member** — `conformance.test.ts` lists both as its declared gaps,
      // because the Fake spawns no children. So the two are bolted on here for the one test that
      // needs them, exactly as `agent-rows.test.ts` bolts on `agentInfo` and
      // `sign-in-supersede.test.ts` bolts on `checkSignIn`.
      const start = runtime.start.bind(runtime)
      runtime.start = async (opts) => {
        const handle = await start(opts)
        return Object.assign(handle, {
          childState: () => Promise.resolve(spy.state),
          childInput: (_id: string, text: string): Promise<ChildInputOutcome> => {
            const refusal = spy.onInput?.()
            if (refusal !== undefined) return Promise.resolve(refusal)
            spy.said.push(text)
            return Promise.resolve({ ok: true, turnId: 'tn_child_1' })
          },
        })
      }
      return runtime
    },
    prepareProviderHome: (which) => `/tmp/brobot2-296-home/${which}`,
    providerHomePath: (which) => `/tmp/brobot2-296-home/${which}`,
    resolveCwd: (sessionId) => `/tmp/brobot2-296-cwd/${sessionId}`,
    newSessionId: () => SESSION,
    readProviderConfig: (_which, home) => ({
      home,
      homeEnv: 'CODEX_HOME',
      model: 'x',
      authNote: null,
      files: [],
    }),
  })
  const open = async (): Promise<void> => {
    await host.createSession({ provider, cwd: '/tmp/w' }, owner)
  }
  return { host, owner, stranger, open }
}

const idle: ChildThreadState = {
  status: 'idle',
  acceptsInput: true,
  nickname: 'Plato',
  turns: 2,
}
const working: ChildThreadState = { ...idle, status: 'working' }

describe('296 · what the host refuses, and in which order', () => {
  it('🔴 OWNERSHIP is decided before the ledger — a stranger is refused, not answered', async () => {
    // ⛔ **The defect this assertion was written from.** The first draft asked the ledger first, so a
    // window that did not own the conversation got `{ok:false, reason:'unknown-agent'}` — which
    // meant the 203 refusal never fired AND the answer itself disclosed whether that agent belongs
    // to this conversation. Two rules broken by one line of ordering.
    const spy: Spy = { state: idle, said: [] }
    const { host, stranger, open } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => false },
      spy,
    )
    await open()
    // `reportedSubAgent` is FALSE here on purpose: if the ledger were asked first this would answer
    // `unknown-agent` instead of throwing, which is exactly the bug.
    await expect(host.readChildState(SESSION, CHILD, stranger)).rejects.toThrow()
    await expect(host.sendToChild(SESSION, CHILD, 'hello', stranger)).rejects.toThrow()
    expect(spy.said, 'a stranger reached the provider').toEqual([])
    await host.closeAll()
  })

  it('⚑ …and the OWNER is not refused by that check — the paired positive', async () => {
    const spy: Spy = { state: idle, said: [] }
    const { host, owner, open } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => true },
      spy,
    )
    await open()
    expect(await host.readChildState(SESSION, CHILD, owner)).toEqual({ ok: true, state: idle })
    await host.closeAll()
  })

  it('⛔ an agent this session never reported is `unknown-agent`, and nothing is asked of the provider', async () => {
    const spy: Spy = { state: idle, said: [] }
    const { host, owner, open } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => false },
      spy,
    )
    await open()
    expect(await host.readChildState(SESSION, CHILD, owner)).toEqual({
      ok: false,
      reason: 'unknown-agent',
    })
    expect(await host.sendToChild(SESSION, CHILD, 'hello', owner)).toEqual({
      ok: false,
      reason: 'unknown-agent',
    })
    expect(spy.said).toEqual([])
    await host.closeAll()
  })

  it('⚠️ a provider with no channel to a child is `unsupported` even when nothing is running', async () => {
    // ⛔ **The ordering that surprises, and the reason it is this way round.** A Claude child in a
    // closed session could honestly be told `not-live` or `unsupported`; only the second is still
    // true tomorrow when the session is running. The stable answer wins.
    const { host, owner } = hostFor(
      'claude',
      { find: () => rowFor('claude'), reportedSubAgent: () => true },
      null,
    )
    expect(await host.readChildState(SESSION, CHILD, owner)).toEqual({
      ok: false,
      reason: 'unsupported',
    })
    await host.closeAll()
  })

  it('a session that is not running is `not-live` — a different word, and a different next step', async () => {
    // Nothing is opened, so there is no slot: this is the recording case, and `not-live` is what
    // sends a person to reopen the conversation rather than to give up on the feature.
    const { host, owner } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => true },
      null,
    )
    expect(await host.readChildState(SESSION, CHILD, owner)).toEqual({
      ok: false,
      reason: 'not-live',
    })
    await host.closeAll()
  })

  it('⛔ a live session whose handle lacks the members is `unsupported`, not a crash', async () => {
    // The backstop behind the capability table. `conformance.test.ts` pins the two together; this is
    // what happens if that pin is ever wrong — a refusal rather than a `TypeError` on a person's
    // screen. `spy: null` gives a plain FakeRuntime, whose handle really has neither member.
    const { host, owner, open } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => true },
      null,
    )
    await open()
    expect(await host.readChildState(SESSION, CHILD, owner)).toEqual({
      ok: false,
      reason: 'unsupported',
    })
    await host.closeAll()
  })
})

describe('296 · the working-child ruling, at the host', () => {
  it('🔴 refuses a working child, says WHICH fact refused it, and writes nothing', async () => {
    const spy: Spy = { state: working, said: [] }
    const { host, owner, open } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => true },
      spy,
    )
    await open()
    const answer = await host.sendToChild(SESSION, CHILD, 'are you nearly done?', owner)
    expect(answer).toEqual({ ok: false, reason: 'working', state: working })
    // ⚑ **The state rides on the refusal** so the viewer can say *"it is still working"* rather than
    // *"no"* — and so a reader of the wire can tell a refusal about the child from one about us.
    expect(spy.said, 'a message reached a busy child').toEqual([])
    await host.closeAll()
  })

  it('⚑ …and sends to an idle one — the paired positive', async () => {
    const spy: Spy = { state: idle, said: [] }
    const { host, owner, open } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => true },
      spy,
    )
    await open()
    expect(await host.sendToChild(SESSION, CHILD, 'how did it go?', owner)).toEqual({
      ok: true,
      turnId: 'tn_child_1',
    })
    expect(spy.said).toEqual(['how did it go?'])
    await host.closeAll()
  })

  it('⚠️ a child that goes busy in the gap is refused by the ADAPTER, and that answer is passed through', async () => {
    // ⛔ **The race is real and is stated rather than papered over.** The host reads the state, then
    // the adapter reads it AGAIN immediately before writing. A child that starts working in between
    // is refused by the second read — and this asserts the host does not retry, does not translate,
    // and does not report the send as having happened.
    const spy: Spy = {
      state: idle,
      said: [],
      onInput: () => ({ ok: false, reason: 'working', state: working }),
    }
    const { host, owner, open } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => true },
      spy,
    )
    await open()
    expect(await host.sendToChild(SESSION, CHILD, 'still there?', owner)).toEqual({
      ok: false,
      reason: 'working',
      state: working,
    })
    expect(spy.said).toEqual([])
    await host.closeAll()
  })

  it('a provider that throws is `unreachable` — a wire failure is not a fact about the child', async () => {
    const spy: Spy = {
      state: idle,
      said: [],
      onInput: () => {
        throw new Error('the app-server went away')
      },
    }
    const { host, owner, open } = hostFor(
      'codex',
      { find: () => rowFor('codex'), reportedSubAgent: () => true },
      spy,
    )
    await open()
    expect(await host.sendToChild(SESSION, CHILD, 'hello?', owner)).toEqual({
      ok: false,
      reason: 'unreachable',
    })
    // ⚠️ **No `state` on this arm**, and that is the type doing its job: there is no state to report
    // when the thing that was supposed to report it is what failed.
    await host.closeAll()
  })
})
