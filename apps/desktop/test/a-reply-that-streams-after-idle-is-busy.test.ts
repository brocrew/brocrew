import {
  closeHostFixture,
  fixtureDatabase,
  fixtureFolder,
  numberedFixtureHostPaths,
  ObservedProviderLaunches,
  RecordingSink,
  waitFor,
} from './lib/host-fixture'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, type FakeSessionHandle } from '@brobot2/runtime'
import type { RuntimeEvent } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase } from '../src/main/db/connection'
import { createSessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from '../src/main/runtime/runtime-host'
import type { AgentState } from '../src/shared/agent-state-contracts'

/**
 * 🔴 **541 · the host names a busy state while a reply streams after its turn closed.**
 *
 * A model can stream a whole message after the provider has said `idle` (the 042 sighting), and the
 * host used to name `active` only while the provider said `working`. So the plate, the header and the
 * rail said Idle while the pill above the composer said "replying". The host's one state is the one
 * place to fix it: it already holds what the reply is doing ({@link BeingDoneTracker}), so the
 * state reads that rather than a second source, and nothing in the window changes.
 *
 * ⚑ **Each reading is paired with its control one fact over**: an idle conversation with nothing
 * arriving still reads `idle`, and a reply that has ended reads `idle` again.
 */

type Pushable = Pick<FakeSessionHandle, 'holdNextTurn' | 'interrupt' | 'status'> & {
  push(event: RuntimeEvent): void
}

describe('541 · a reply that streams after idle is busy', () => {
  let db: AppDatabase
  let host: RuntimeHost
  let userData: string
  let root: string
  let clock: number
  let window: RecordingSink
  let issued: Pushable[]
  let told: { conversation: string; state: AgentState }[]

  beforeEach(() => {
    userData = fixtureFolder('brobot2-541-')
    root = fixtureFolder('brobot2-541-root-')
    db = fixtureDatabase(userData)
    clock = 5_000_000
    issued = []
    told = []
    const sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store: createSessionStore(db, () => clock++),
      ...numberedFixtureHostPaths(
        () => userData,
        () => clock++,
      ),
      createRuntime: (provider: Provider) =>
        new ObservedProviderLaunches(provider, sessions, (_kind, _options, handle) =>
          issued.push(handle as unknown as Pushable),
        ),
      statesMoved: ({ moved }) => told.push(...moved),
    })
    window = new RecordingSink('webContents:1')
  })

  afterEach(() => closeHostFixture(host, db, userData, root))

  const personOpens = async (): Promise<{ id: string; handle: Pushable }> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', approvalMode: 'auto', cwd: root },
      window,
    )
    const handle = issued.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    return { id: sessionId, handle }
  }

  /** ⚑ Asked through the clause no grant narrows — a conversation is told about itself. */
  const stateOf = (id: string) => host.agentCard(id, THE_APP_ITSELF, id)?.state

  /** The events reach the host through its own pump, one turn of the loop later. */
  const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))

  it('⚑ pinned: an idle conversation with nothing arriving reads idle', async () => {
    const { id } = await personOpens()
    expect(stateOf(id)).toEqual({ is: 'idle' })
  })

  it('⚑ pinned: a turn the provider calls working reads active, and idle again when it ends', async () => {
    const { id, handle } = await personOpens()
    handle.holdNextTurn()
    await host.queueMessage(id, 'go', window)
    expect(stateOf(id)).toEqual({ is: 'active' })
    await handle.interrupt()
    await settled()
    expect(stateOf(id)).toEqual({ is: 'idle' })
  })

  /** ⚑ A reply the provider's own status has already closed: text arrives, then `idle` is stated. */
  const aReplyAfterIdle = async (handle: Pushable): Promise<void> => {
    handle.push({ type: 'assistant_delta', text: 'still ' })
    handle.push({ type: 'status', state: 'idle' })
    await settled()
  }

  it('⚑ pinned: a reply streaming while the provider says working reads active', async () => {
    const { id, handle } = await personOpens()
    handle.push({ type: 'assistant_delta', text: 'still ' })
    await settled()
    expect(handle.status()).toBe('working')
    expect(stateOf(id)).toEqual({ is: 'active' })
  })

  it('🔴 a reply still streaming after the provider said idle reads active', async () => {
    const { id, handle } = await personOpens()
    await aReplyAfterIdle(handle)
    // ⚑ The premise, planted beside the claim: the provider really does say idle at this moment.
    expect(handle.status()).toBe('idle')
    expect(stateOf(id)).toEqual({ is: 'active' })
  })

  it('⚑ the control one fact over: once that reply ends, it reads idle again', async () => {
    const { id, handle } = await personOpens()
    await aReplyAfterIdle(handle)
    expect(stateOf(id)).toEqual({ is: 'active' })
    handle.push({ type: 'assistant_message', text: 'still here' })
    await settled()
    expect(handle.status()).toBe('idle')
    expect(stateOf(id)).toEqual({ is: 'idle' })
  })

  it('🔴 and the windows are TOLD when that reply starts and when it ends, not only asked', async () => {
    const { id, handle } = await personOpens()
    const toldOf = () => told.filter((one) => one.conversation === id).at(-1)?.state
    handle.push({ type: 'assistant_delta', text: 'still ' })
    handle.push({ type: 'status', state: 'idle' })
    await settled()
    expect(toldOf()).toEqual({ is: 'active' })
    // ⚑ Text is a row that marks nothing, so the end of the reply has to publish the state itself.
    handle.push({ type: 'assistant_message', text: 'still here' })
    await settled()
    expect(toldOf()).toEqual({ is: 'idle' })
    // ⚑ **The rising edge, alone**: the provider already said `idle` and the double is still inside
    // its burst, so this delta carries no status event of its own — the only thing that can tell the
    // windows is the edge itself.
    handle.push({ type: 'assistant_delta', text: 'and more ' })
    await settled()
    expect(handle.status()).toBe('idle')
    expect(toldOf()).toEqual({ is: 'active' })
  })

  it('⚑ pinned: a provider waiting on a permission already reads needs-you, and idle once its turn ends', async () => {
    // 🔴 **The host's builder already says it** (`whoOwesIt`: a provider that waits on a permission with
    // nothing routed to another conversation is a person's to answer), so the "permission waits
    // elsewhere" cells are not an idle the host names: a card that went to a NAMED conversation
    // reads *waiting on an answer from <name>* (pinned in `a-question-a-worker-can-ask`), and every
    // other wait reads this.
    const { sessionId: id } = await host.createSession(
      { provider: 'claude', approvalMode: 'ask', cwd: root },
      window,
    )
    const handle = issued.at(-1)
    if (handle === undefined) throw new Error('no handle was issued')
    await host.queueMessage(id, 'run it', window)
    await waitFor(() => handle.status() === 'waiting_permission', 'the provider to ask')
    expect(stateOf(id)).toEqual({ is: 'needs-you' })
    // ⚑ The wait ends with the turn it belonged to, and the state follows it.
    await handle.interrupt()
    await waitFor(() => handle.status() === 'idle', 'the turn to finish')
    expect(stateOf(id)).toEqual({ is: 'idle' })
  })
})
