import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type AgentRuntime, type SessionHandle } from '@brobot2/runtime'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { classifyHandedPath } from '../src/main/runtime/handed-path'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import { MAX_HANDED_PATHS, type HandedPath, type TranscriptEvent } from '../src/shared/runtime-ipc'
import { createAttachmentBook, createDraftBook, draftKey } from '../src/renderer/src/lib/drafts'
import { overTheWire } from '../src/renderer/src/lib/session-store'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * # ⛔ What actually leaves the host, on every send path (216 §1/§2/§3)
 *
 * ⚠️ **These exist because thirteen mutations survived the first run of `216`'s table.** The pure
 * classifier was asserted and the composer was asserted, and the middle of the stack — the host, the
 * fold, the books, the replay bound — was not. `coverage-that-jumps-over-the-middle`, exactly.
 *
 * ⛔ **The claim under test is a SPLIT.** The provider receives one string, because at the pin that
 * is the only form a path reaches a model in (§1, measured: a Codex `mention` contributes zero
 * content items and Claude's SDK has no local-path block). The LEDGER receives the person's words
 * alone, with the paths beside them — because storing the composed string as their turn is `214`'s
 * defect arriving from the other end.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrations = join(here, '../src/main/db/migrations')

/**
 * ⚑ **607 · what a PERSON's turn now arrives with** — `HO-088` §4, composed from the product's own
 * export so a literal here cannot pass while the app says something else.
 *
 * ⛔ **Every `NullSink` below is a WINDOW** (see its own comment), so every send in this file grew
 * this line. ⚠️ The assertions were re-aimed rather than relaxed: each still pins the WHOLE string
 * the provider received, which is what makes them able to see an attachment block that went
 * missing.
 */
const fromThePerson = (words: string): string =>
  messageNamingItsSender(words, THE_PERSON_AT_A_WINDOW)

class NullSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly ownerId = sinkOwnerId({ id: 1 })
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

/**
 * ⛔ **A sink that remembers, because the LEDGER is not the whole story** (232, review).
 *
 * ⚠️ **`publishOurs` appends and then sends, and only the append is guarded**: after
 * `store.terminate` the append fails and `record` swallows it, so an event published during
 * teardown is invisible to `store.events` and perfectly visible to the renderer — which is the
 * surface that would render the one never-sent message twice. A test reading only the store cannot
 * see the defect it is about.
 */
class Recorder implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly ownerId = sinkOwnerId({ id: 1 })
  readonly alive = true
  readonly seen: TranscriptEvent[] = []
  send(event: { event: TranscriptEvent }): void {
    this.seen.push(event.event)
  }
  sendLiveness(): void {}
  of<T extends TranscriptEvent['type']>(type: T): Extract<TranscriptEvent, { type: T }>[] {
    return this.seen.filter(
      (event): event is Extract<TranscriptEvent, { type: T }> => event.type === type,
    )
  }
}

/** A runtime that records the exact string handed to the provider, and never finishes a turn. */
class RecordingRuntime implements AgentRuntime {
  readonly sent: string[] = []
  /** How many times a running turn was killed — see the pre-interrupt ordering test. */
  readonly calls = { interrupts: 0 }
  private inner = new FakeRuntime('claude')

  get provider(): AgentRuntime['provider'] {
    return this.inner.provider
  }

  async listModels(
    ...args: Parameters<AgentRuntime['listModels']>
  ): ReturnType<AgentRuntime['listModels']> {
    return await this.inner.listModels(...args)
  }

  async start(options: Parameters<AgentRuntime['start']>[0]): Promise<SessionHandle> {
    const handle = await this.inner.start(options)
    const sent = this.sent
    const calls = this.calls
    // ⚑ Wraps rather than reimplements, so everything else about the double stays the real one.
    return new Proxy(handle, {
      get(target, key, receiver) {
        if (key === 'interrupt') {
          return async () => {
            calls.interrupts += 1
            return await (target as SessionHandle).interrupt()
          }
        }
        if (key !== 'send') return Reflect.get(target, key, receiver)
        return async (text: string) => {
          // The message, without the block this app adds at its end.
          sent.push(withoutWhatThisAppAdds(text))
          return await (target as SessionHandle).send(text)
        }
      },
    })
  }

  async resume(...args: Parameters<AgentRuntime['resume']>): Promise<SessionHandle> {
    return await this.inner.resume(...args)
  }
}

describe('handing the agent a path, through the host (216)', () => {
  let dir: string
  let cwd: string
  let db: AppDatabase
  let store: SessionStore
  let runtime: RecordingRuntime
  let host: RuntimeHost
  let file: HandedPath

  beforeEach(async () => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-handed-send-')))
    cwd = join(dir, 'work')
    mkdirSync(cwd, { recursive: true })
    writeFileSync(join(cwd, 'notes.md'), '# notes\n')
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    runtime = new RecordingRuntime()
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: () => cwd,
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_p, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    const chosen = await classifyHandedPath(join(cwd, 'notes.md'), cwd)
    if (!('handed' in chosen)) throw new Error('fixture path did not classify')
    file = chosen.handed
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const open = async (sink: RuntimeEventSink = new NullSink()): Promise<string> => {
    const created = await host.createSession({ provider: 'claude', cwd }, sink)
    return created.sessionId
  }

  const eventsOfType = <T extends TranscriptEvent['type']>(
    sessionId: string,
    type: T,
  ): Extract<TranscriptEvent, { type: T }>[] =>
    store
      .events(sessionId)
      .map((entry) => entry.event)
      .filter((event): event is Extract<TranscriptEvent, { type: T }> => event.type === type)

  const turns = (sessionId: string): Extract<TranscriptEvent, { type: 'user_turn' }>[] =>
    store
      .events(sessionId)
      .map((entry) => entry.event)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'user_turn' }> =>
          event.type === 'user_turn',
      )

  it('🔴 the PROVIDER gets the path as words, and the LEDGER gets the person’s words alone', async () => {
    const sessionId = await open()

    await host.send(sessionId, 'read this for me', new NullSink(), [file])

    // ⛔ To the provider: composed, labelled, with the path in it — §1's measured "text or nothing".
    expect(runtime.sent).toHaveLength(1)
    expect(runtime.sent[0]).toContain('read this for me')
    expect(runtime.sent[0]).toContain(file.path)
    expect(runtime.sent[0]).toContain('Attached by the user')

    // ⛔ To the ledger: the split. `214` from the other end — a transcript that stored the composed
    // string would render BroBot's sentence as something the person typed, permanently.
    const [turn] = turns(sessionId)
    expect(turn?.text).toBe('read this for me')
    expect(turn?.text).not.toContain(file.path)
    expect(turn?.attachments).toEqual([file])
  })

  it('⚑ …and a turn with NOTHING attached carries no such key at all', async () => {
    // The ordinary case: every existing turn goes through this code, and its shape must not change.
    const sessionId = await open()

    await host.send(sessionId, 'just a message', new NullSink())

    expect(runtime.sent[0]).toBe(fromThePerson('just a message'))
    const [turn] = turns(sessionId)
    expect(turn?.text).toBe('just a message')
    expect(turn && 'attachments' in turn).toBe(false)
  })

  it('🔴 a path that VANISHED between choosing and sending refuses the send, and sends nothing', async () => {
    const sessionId = await open()
    rmSync(join(cwd, 'notes.md'))

    await expect(host.send(sessionId, 'read this', new NullSink(), [file])).rejects.toThrow(
      /moved or deleted since/,
    )
    // ⛔ Nothing reached the provider, and no turn was recorded — the message is still the
    // composer's, which is what makes refusing better than sending a path the agent cannot read.
    expect(runtime.sent).toEqual([])
    expect(turns(sessionId)).toEqual([])
  })

  it('⛔ the INTERRUPTING send carries them too — redirecting must not lose what you redirect to', async () => {
    const sessionId = await open()
    await host.send(sessionId, 'first', new NullSink())

    await host.sendInterrupting(sessionId, 'actually, this', new NullSink(), [file])

    expect(runtime.sent.at(-1)).toContain(file.path)
    expect(turns(sessionId).at(-1)?.attachments).toEqual([file])
    expect(turns(sessionId).at(-1)?.text).toBe('actually, this')
  })

  it('🔴 a QUEUED message keeps its attachments, and they go when it goes', async () => {
    // ⛔ The dispatch does not mention the queue, and attaching while the agent is busy is reachable
    // — so a message that sent its words while dropping its paths would be the half-formed
    // attachment §2 forbids, with the chip vanishing as if it had gone.
    const sessionId = await open()
    await host.send(sessionId, 'keep busy', new NullSink())

    const outcome = await host.queueMessage(sessionId, 'and then this', new NullSink(), [file])
    expect(outcome.outcome).toBe('queued')

    // ⚠️ The double parks its turn on a permission card; answering it is what lets the turn reach a
    // terminal, which is the boundary the flush hangs off (`queued-message.test.ts`'s own shape).
    await host.respondPermission(sessionId, 'turn_1_perm', { outcome: 'allow' }, new NullSink())
    for (let i = 0; i < 100; i++) {
      if (turns(sessionId).some((turn) => turn.text === 'and then this')) break
      await new Promise((done) => setTimeout(done, 20))
    }

    const last = turns(sessionId).at(-1)
    expect(last?.text).toBe('and then this')
    expect(last?.attachments).toEqual([file])
    expect(runtime.sent.at(-1)).toContain(file.path)
  })

  it('🔴 a path that vanishes while the message WAITS ends it — it does not sit there forever', async () => {
    // ⛔ Found in review: the flush's re-check threw into a `catch` that deliberately leaves the
    // message queued for another attempt at the next turn boundary. That is right for "not signed
    // in yet" and wrong for "the file is gone" — there is no next attempt that can succeed, so the
    // message sat in the composer's queue with no event, no error and nobody told.
    const sessionId = await open()
    await host.send(sessionId, 'keep busy', new NullSink())
    expect(
      (await host.queueMessage(sessionId, 'and then this', new NullSink(), [file])).outcome,
    ).toBe('queued')

    // Keep attachment paths on the queued event so the person can see what will be sent while
    // the message is still editable.
    expect(eventsOfType(sessionId, 'message_queued').at(-1)?.attachments).toEqual([file])

    rmSync(join(cwd, 'notes.md'))
    await host.respondPermission(sessionId, 'turn_1_perm', { outcome: 'allow' }, new NullSink())
    const ended = await (async () => {
      for (let i = 0; i < 100; i++) {
        const seen = eventsOfType(sessionId, 'message_unqueued').at(-1)
        if (seen) return seen
        await new Promise((done) => setTimeout(done, 20))
      }
      return null
    })()

    expect(ended?.reason).toBe('abandoned')
    // ⚠️ **With a reason that is TRUE.** `abandoned` alone renders as "the conversation ended
    // first", and this conversation is still open — the transcript would state something that did
    // not happen.
    expect(ended?.detail).toMatch(/moved or deleted since/)
    // …and the words and the paths both come back, so a restore is whole rather than half.
    expect(ended?.text).toBe('and then this')
    expect(ended?.attachments).toEqual([file])
    // Nothing was sent and no turn was opened for it.
    expect(turns(sessionId).map((turn) => turn.text)).toEqual(['keep busy'])
    expect(runtime.sent.at(-1)).toBe(fromThePerson('keep busy'))
  })

  it('🔴 a queued path REPLACED while it waits is abandoned, not sent as the replacement', async () => {
    /**
     * # ⛔ What this test used to be, and why it had to be re-argued (232 §1)
     *
     * ⚠️ **It was *"the flush records what it SENT, not the copy it was queued with"***, and it
     * proved that by replacing the queued file with a FOLDER of the same name and asserting that the
     * folder went out — to the provider and into the ledger. `227` read it and said so plainly:
     * *"the committed queue test expressly treats file→directory replacement as acceptable and
     * asserts the refreshed value was sent, so existing coverage pins the adjacent address-semantics
     * behaviour instead of detecting the consent change."*
     *
     * ⛔ **A test that agrees with the bug is the bug** — this project's own rule. The queued wait is
     * the WIDEST version of the window `227` HIGH 1 is about: minutes, unattended, with the composer
     * showing a chip that stopped being true.
     *
     * ⚑ **The property the old test was reaching for survives, and is asserted below**: the ledger
     * and the wire never disagree. What changed is that they now agree on a REFUSAL. And the sentence
     * it agrees on is the honest one — `abandoned` with a `detail` that says the path is not what was
     * attached, rather than the moved-or-deleted sentence, which would be false here.
     */
    const sessionId = await open()
    await host.send(sessionId, 'keep busy', new NullSink())
    const held = await host.queueMessage(sessionId, 'and then this', new NullSink(), [file])

    // It was a file when it was queued; by the time it flushes it is a folder.
    rmSync(join(cwd, 'notes.md'))
    mkdirSync(join(cwd, 'notes.md'))

    await host.respondPermission(sessionId, 'turn_1_perm', { outcome: 'allow' }, new NullSink())
    const ended = await (async () => {
      for (let i = 0; i < 100; i++) {
        const seen = eventsOfType(sessionId, 'message_unqueued').at(-1)
        if (seen) return seen
        await new Promise((done) => setTimeout(done, 20))
      }
      return null
    })()

    expect(ended?.reason).toBe('abandoned')
    // ⚑ **This ending names the message it ends** (354). Four writers can end a queued message and
    // this is the fourth; one of them not carrying the name would leave a reader rebuilding from
    // the ledger with a beginning it could not join to its own ending.
    expect(ended?.messageId).toBe(held.outcome === 'queued' ? held.messageId : null)
    expect(ended?.detail).toContain('attached as a file is a folder now')
    // …and the words and the paths come back whole, so the person can decide again.
    expect(ended?.text).toBe('and then this')
    expect(ended?.attachments).toEqual([file])
    // 🔴 **Nothing went out and no turn was opened for it** — the ledger and the wire agreeing, which
    // is what the old test was really about.
    expect(turns(sessionId).map((turn) => turn.text)).toEqual(['keep busy'])
    expect(runtime.sent.at(-1)).toBe(fromThePerson('keep busy'))
  })

  it('⚑ …and the paired positive: a queued path left ALONE still flushes and is recorded', async () => {
    // ⛔ Without this, a `runFlush` that abandoned every queued attachment would satisfy the test
    // above — the feature deleted rather than made safe. This is also what still pins that the
    // `user_turn` carries what went on the wire.
    const sessionId = await open()
    await host.send(sessionId, 'keep busy', new NullSink())
    await host.queueMessage(sessionId, 'and then this', new NullSink(), [file])

    await host.respondPermission(sessionId, 'turn_1_perm', { outcome: 'allow' }, new NullSink())
    for (let i = 0; i < 100; i++) {
      if (turns(sessionId).some((turn) => turn.text === 'and then this')) break
      await new Promise((done) => setTimeout(done, 20))
    }

    expect(turns(sessionId).at(-1)?.attachments).toEqual([file])
    expect(runtime.sent.at(-1)).toContain('file:')
    expect(eventsOfType(sessionId, 'message_unqueued').at(-1)?.reason).toBe('sent')
  })

  it('⛔ the interrupting send REFUSES before it kills the running turn', async () => {
    // ⚠️ Ordering, found in review: the re-check used to run after `interrupt()`, so a vanished
    // path destroyed whatever thinking was in flight and THEN refused to send anything — the worst
    // of both. Everything that can refuse must refuse before the destructive act.
    const sessionId = await open()
    await host.send(sessionId, 'first', new NullSink())
    const before = runtime.calls.interrupts
    rmSync(join(cwd, 'notes.md'))

    await expect(
      host.sendInterrupting(sessionId, 'actually, this', new NullSink(), [file]),
    ).rejects.toThrow(/moved or deleted since/)

    expect(runtime.calls.interrupts).toBe(before)
    // 🔴 The paired positive: with the file there, this path DOES interrupt — or the assertion
    // above would hold for a method that had simply stopped interrupting.
    writeFileSync(join(cwd, 'notes.md'), '# notes\n')
    await host.sendInterrupting(sessionId, 'actually, this', new NullSink(), [file])
    expect(runtime.calls.interrupts).toBe(before + 1)
  })

  it('⛔ …and a path that vanishes before it is QUEUED is refused there too', async () => {
    const sessionId = await open()
    await host.send(sessionId, 'keep busy', new NullSink())
    rmSync(join(cwd, 'notes.md'))

    await expect(
      host.queueMessage(sessionId, 'and then this', new NullSink(), [file]),
    ).rejects.toThrow(/moved or deleted since/)
  })

  it('⛔ what the renderer CLAIMS about a path is re-decided, never taken on trust', async () => {
    // The wire carries `outsideCwd` because the composer drew it; main asks the filesystem again.
    // This lies about it and reads back what the ledger actually recorded.
    //
    // ⛔ **The `kind` half of this test MOVED rather than vanished** (232 §1, re-argued). A
    // lied-about `kind` used to be corrected in silence and is now a refusal, because it is one of
    // the two fields consent is over — asserted in the test below and in `no-byte-authority`'s
    // identity block. `outsideCwd` is deliberately not, so it is still corrected here.
    const sessionId = await open()

    await host.send(sessionId, 'look', new NullSink(), [
      { path: join(cwd, 'notes.md'), kind: 'file', outsideCwd: true },
    ])

    expect(turns(sessionId)[0]?.attachments).toEqual([
      { path: join(cwd, 'notes.md'), kind: 'file', outsideCwd: false },
    ])
    expect(runtime.sent[0]).toContain('file:')
    expect(runtime.sent[0]).not.toContain('outside')
  })

  /**
   * ⛔ **Nine real files, so the re-check takes MANY event-loop turns.**
   *
   * ⚠️ **232 §3 turned `recheckHandedPaths` into a filesystem round trip per path**, and the three
   * tests below are about what can land in the window that opened. One attachment is two `await`s
   * and a race nobody can schedule; nine is eighteen, which is wide enough for a gesture issued on
   * the next line to land inside it reliably.
   */
  const many = (count = 9): HandedPath[] =>
    Array.from({ length: count }, (_, at) => {
      const path = join(cwd, `filler-${at}.md`)
      writeFileSync(path, 'x')
      return { path, kind: 'file' as const, outsideCwd: false }
    })

  it('🔴 TWO queue commands in flight are BOTH held, and neither overwrites the other (232, D-010)', async () => {
    // ⛔ **Found reviewing `232`'s own diff.** Making the re-check `await` put a filesystem round
    // trip between the *"is one already waiting?"* refusal and the assignment it guarded, so the
    // second overwrote the first — destroyed with two `message_queued` events and no ending. ⚑
    // **D-010 retired the refusal**: the mailbox holds both, so the property left is the one that
    // mattered — two messages in, two held, each under its own name.
    const sessionId = await open()
    await host.send(sessionId, 'keep busy', new NullSink())

    const outcomes = await Promise.all([
      host.queueMessage(sessionId, 'FIRST', new NullSink(), many()),
      host.queueMessage(sessionId, 'SECOND', new NullSink(), many()),
    ])

    expect(outcomes.map((each) => each.outcome)).toEqual(['queued', 'queued'])
    // 🔴 …and the ledger says the same thing, which is where the damage actually was.
    const queued = eventsOfType(sessionId, 'message_queued')
    // ⚠️ Sorted: two commands in flight at once have no order between them — the mailbox's order is
    // the order they were HELD, and the ledger records that.
    expect(queued.map((event) => event.text).sort()).toEqual(['FIRST', 'SECOND'])
    expect(new Set(queued.map((event) => event.messageId)).size).toBe(2)
  })

  it('🔴 a queued message cannot JUMP an interrupt while its paths are re-checked (232)', async () => {
    // ⛔ **Found reviewing this diff.** `sendInterrupting` holds the queue back for the whole of its
    // work — `077`'s rule that *"instead of"* means what it says — and the latch used to be raised
    // AFTER the path re-check. ⚠️ **232 §3 turned that re-check into a filesystem round trip**, so a
    // turn that terminalized inside the window let the queued message start its own turn, and the
    // latch arrived to hold a queue that had already gone: the interrupt then killed the message it
    // was supposed to come after.
    const sessionId = await open()
    await host.send(sessionId, 'the first thing', new NullSink())
    expect(
      (await host.queueMessage(sessionId, 'the one that was waiting', new NullSink())).outcome,
    ).toBe('queued')

    // ⚑ Not awaited: the running turn is terminalized on the next line, WHILE the re-check is out
    // at the filesystem — which is the window, and 300 paths is what makes it reliably wide.
    const interrupting = host.sendInterrupting(sessionId, 'no, do THIS', new NullSink(), many(300))
    await host.respondPermission(sessionId, 'turn_1_perm', { outcome: 'allow' }, new NullSink())
    await interrupting
    // ⚠️ Given time to go wrong rather than assumed not to: a queued message that jumps takes a few
    // turns of the loop to do it, and asserting at 0 ms would pass on the defect.
    await new Promise((done) => setTimeout(done, 100))
    // ⚑ **D-027 · the second send is the flush the press lets go of**, which re-checks all 300
    // paths once more before it hands over — so it is waited for as well, bounded.
    for (let at = 0; at < 200 && runtime.sent.length < 2; at += 1) {
      await new Promise((done) => setTimeout(done, 10))
    }

    // 🔴 **The order the person asked for.** Two sends: the one that was running, and the one that
    // replaced it. ⚑ **D-027 · R2 moved where the waiting message goes**: the replacement JOINS it,
    // held last, so the second send carries both — the waiting one first, the order they were held
    // in. Under the defect there are THREE, with the waiting one alone in the middle and its answer
    // destroyed by an interrupt aimed at a different turn.
    expect(runtime.sent).toHaveLength(2)
    expect(runtime.sent[0]).toBe(fromThePerson('the first thing'))
    expect(runtime.sent[1]).toContain('the one that was waiting')
    expect(runtime.sent[1]).toContain('no, do THIS')
    expect(runtime.sent[1]!.indexOf('the one that was waiting')).toBeLessThan(
      runtime.sent[1]!.indexOf('no, do THIS'),
    )
    // ⚑ …and each ends as SENT, the waiting one first, just before the one turn that took them.
    expect(
      eventsOfType(sessionId, 'message_unqueued').map((event) => [event.text, event.reason]),
    ).toEqual([
      ['the one that was waiting', 'sent'],
      ['no, do THIS', 'sent'],
    ])
    expect(turns(sessionId).map((turn) => turn.parts?.map((part) => part.text))).toEqual([
      undefined,
      ['the one that was waiting', 'no, do THIS'],
    ])
  })

  it('⛔ a Close landing on a running flush still ends the queued message exactly once (232)', async () => {
    /**
     * ⛔ **Also found reviewing this diff, and this test is weaker than the finding.**
     * `runFlush`'s refusal branch used to run synchronously inside `flushQueued`; behind an `await`
     * it can be overtaken by `abandonQueued` and publish a SECOND `abandoned` for one message — which
     * the transcript's fold renders as the never-sent message twice, once with the wrong cause.
     * `runFlush` now returns if the queue moved while it was asking the filesystem.
     *
     * ⚠️ **What this test can and cannot reach, said plainly.** The ORDINARY Close route cannot lose
     * that race: `tearDown` awaits `stopProvider` and then the pump drain before it finalizes, and
     * the re-check finishes inside either. The route that can is the pump's own `finally` — a
     * provider stream that ENDS or FAILS mid-flush — and no instrument in this repository can
     * schedule that against `FakeRuntime`. ⛔ **So the guard's removal SURVIVES the table**, it is
     * named there as surviving, and what is pinned here is the property itself: whatever lands, one
     * queued message leaves exactly one ending.
     */
    const watching = new Recorder()
    const sessionId = await open(watching)
    await host.send(sessionId, 'keep busy', new NullSink())
    const gone = join(cwd, 'vanishes.md')
    writeFileSync(gone, 'x')
    // ⚠️ The vanished one goes LAST, so the eight before it are really stat'd and the refusal lands
    // as late in the re-check as it can — which is the window this test is about.
    await host.queueMessage(sessionId, 'and then this', new NullSink(), [
      ...many(300),
      { path: gone, kind: 'file', outsideCwd: false },
    ])
    rmSync(gone)

    // ⚑ **Waited for the IDLE, not for the permission call.** `runFlush` starts synchronously
    // inside `deliver` on the `status: idle` event, and that event lands well after
    // `respondPermission` resolves — so closing straight after the call would land BEFORE the flush
    // had even begun, and the test would be about nothing at all.
    await host.respondPermission(sessionId, 'turn_1_perm', { outcome: 'allow' }, new NullSink())
    for (let i = 0; i < 200; i++) {
      if (watching.seen.some((each) => each.type === 'status' && each.state === 'idle')) break
      await new Promise((done) => setTimeout(done, 5))
    }
    await host.close(sessionId, new NullSink())

    // ⚑ **D-017 · R3 — the Close is a STOP, and a stop ends nothing it held.** The message is handed
    // on, the conversation is started again for it, and that start's flush re-checks the paths —
    // where the vanished one ends it, in its own words. ⚠️ So the one ending arrives after the
    // restart, not at the Close: waited for, then given time for a second to go wrong.
    for (let i = 0; i < 400; i++) {
      if (watching.of('message_unqueued').length > 0) break
      await new Promise((done) => setTimeout(done, 10))
    }
    await new Promise((done) => setTimeout(done, 100))

    expect(watching.of('message_unqueued').map((each) => each.text)).toEqual(['and then this'])
    // ⚑ …and the one it gets is the TRUE one: the file went, not the conversation.
    expect(watching.of('message_unqueued')[0]).toMatchObject({
      reason: 'abandoned',
      detail: expect.stringContaining('there is nothing at'),
    })
    expect(eventsOfType(sessionId, 'message_unqueued')).toHaveLength(1)
  })

  it('🔴 a path REPLACED before the press refuses the send, and nothing goes out (232 §1)', async () => {
    // ⛔ **`227` HIGH 1 at the seam, which is what a unit test on `recheckHandedPaths` cannot
    // reach**: the host is what four send paths go through, and the person's message has to still be
    // theirs afterwards.
    const sessionId = await open()
    const away = join(dir, 'away')
    mkdirSync(away, { recursive: true })
    writeFileSync(join(away, 'id_rsa'), 'PRIVATE KEY\n')
    rmSync(join(cwd, 'notes.md'))
    symlinkSync(join(away, 'id_rsa'), join(cwd, 'notes.md'))

    await expect(host.send(sessionId, 'read this', new NullSink(), [file])).rejects.toThrow(
      /not what you attached any more/,
    )

    expect(runtime.sent).toEqual([])
    expect(turns(sessionId)).toEqual([])
  })

  it('⛔ …and the INTERRUPTING send refuses it before it kills the running turn', async () => {
    // ⚠️ Same ordering rule as the vanished-path case above it: everything that can refuse must
    // refuse before the destructive act. A replacement is a refusal now, so it has to obey it too.
    const sessionId = await open()
    await host.send(sessionId, 'first', new NullSink())
    const before = runtime.calls.interrupts
    const away = join(dir, 'away')
    mkdirSync(away, { recursive: true })
    writeFileSync(join(away, 'id_rsa'), 'PRIVATE KEY\n')
    rmSync(join(cwd, 'notes.md'))
    symlinkSync(join(away, 'id_rsa'), join(cwd, 'notes.md'))

    await expect(
      host.sendInterrupting(sessionId, 'actually, this', new NullSink(), [file]),
    ).rejects.toThrow(/not what you attached any more/)

    expect(runtime.calls.interrupts).toBe(before)
  })

  it('⚠️ a socket is refused rather than handed over as a file', async () => {
    // ⛔ `183`/`190` refuse the same shapes: an agent's `Read` cannot make sense of one, and handing
    // it over would spend a turn to learn that.
    const fifo = join(cwd, 'a-pipe')
    execFileSync('mkfifo', [fifo])

    const verdict = await classifyHandedPath(fifo, cwd)
    expect('refusal' in verdict).toBe(true)
    if ('refusal' in verdict) expect(verdict.refusal).toContain('not a file or a folder')
  })

  // ⚑ `726` · R92 — *"the exact attachments this session was handed (262 §2)"* was here: five tests
  // on the per-session grant set that carved a pasted image back out of `protectedRoots`. R92
  // removed the protected roots, so there is nothing to carve a path out of and no grant to hand.
})

/**
 * # ⛔ The rest of the middle — the fold, the books, and the replay bound (216)
 *
 * ⚠️ **Also from the thirteen survivors.** Everything between "the host recorded it" and "a person
 * sees it" was uncovered: the transcript fold that carries it to the bubble, the two books that keep
 * it per conversation, and the bound that stops a stored row handing the renderer anything it likes.
 */
describe('carrying a handed path the rest of the way (216)', () => {
  const FILE: HandedPath = { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }

  it('⚠️ the FOLD carries the attachment onto the item the bubble renders', () => {
    // Without this a replayed conversation shows the words and not what went with them.
    const state = createTranscript()
    applyEvent(state, { type: 'user_turn', text: 'look', attachments: [FILE] }, 0)

    const item = state.items.at(-1)
    expect(item?.kind).toBe('user')
    expect(item?.kind === 'user' && item.attachments).toEqual([FILE])
  })

  it('⚑ …and a turn with none carries no such key, so the ordinary item is unchanged', () => {
    const state = createTranscript()
    applyEvent(state, { type: 'user_turn', text: 'look' }, 0)

    const item = state.items.at(-1)
    expect(item?.kind === 'user' && 'attachments' in item).toBe(false)
  })

  it('🔴 ONE keepOnly prunes the paths too — pruning half is unrepresentable now', () => {
    // ⛔ A mutation survived `216`'s table on the two-call version, because its only caller is
    // `RuntimeScreen` and nothing here mounts it (`211`/`212`/`214` have all named that gap). The
    // books became one, so the defect cannot be written rather than merely being untested.
    const drafts = createDraftBook()
    drafts.write(draftKey('gone'), 'words')
    drafts.paths.write(draftKey('gone'), [FILE])
    drafts.write(draftKey('here'), 'kept')
    drafts.paths.write(draftKey('here'), [FILE])

    drafts.keepOnly([draftKey('here')])

    expect(drafts.read(draftKey('gone'))).toBe('')
    expect(drafts.paths.read(draftKey('gone'))).toEqual([])
    // ⚑ The paired positive: a live conversation keeps BOTH halves.
    expect(drafts.read(draftKey('here'))).toBe('kept')
    expect(drafts.paths.read(draftKey('here'))).toEqual([FILE])
  })

  it('🔴 the two BOOKS are keyed and pruned together — 019\u2019s bug with a filename on it', () => {
    // ⛔ Attach in thread A, switch to B, send, and B's agent is handed A's file. That is exactly
    // what `019` fixed for text, and the reason the attachments are not owned by the composer.
    const drafts = createDraftBook()
    const attached = createAttachmentBook()
    drafts.write(draftKey('a'), 'typed in A')
    attached.write(draftKey('a'), [FILE])
    drafts.write(draftKey('b'), 'typed in B')

    expect(attached.read(draftKey('b'))).toEqual([])

    // The conversation closes: both books forget it, in one call with one list.
    drafts.keepOnly([draftKey('b')])
    attached.keepOnly([draftKey('b')])

    expect(attached.read(draftKey('a'))).toEqual([])
    expect(attached.keys()).toEqual([])
  })

  it('⛔ the book hands out a COPY — a caller that pushes cannot mutate it behind its back', () => {
    const attached = createAttachmentBook()
    attached.write(draftKey('a'), [FILE])

    const first = attached.read(draftKey('a'))
    first.push({ path: '/sneaked/in', kind: 'file', outsideCwd: false })

    expect(attached.read(draftKey('a'))).toEqual([FILE])
    // …and an empty read is fresh too, or every quiet conversation would share one array.
    expect(attached.read(draftKey('never'))).not.toBe(attached.read(draftKey('never')))
  })

  it('🔴 WHAT REACHES THE BRIDGE SURVIVES A STRUCTURED CLONE — the defect 216 shipped (218)', () => {
    // ⛔ **This is the one that was actually broken, in the running app, on both surfaces, from
    // `3151a36` until `218` measured it.** Pressing Send with anything attached put
    // `An object could not be cloned.` on the screen and ended the session with no turn at all.
    //
    // ⚠️ **`createAttachmentBook` stores the paths in a `reactive(new Map())`**, so what comes back
    // out is a Vue Proxy. `[...attachments]` copied the ARRAY and left every element a proxy, and
    // `ipcRenderer.invoke` structured-clones its payload — an algorithm that refuses a Proxy by
    // name. ⚑ Nothing noticed because nothing had ever pressed the button: the native picker is
    // modal, so `216`'s and `217`'s live steps both call `runtime.send` directly with object
    // literals, which clone perfectly.
    //
    // ⚑ **`structuredClone` is the SAME algorithm the bridge uses**, which is what makes this a
    // reproduction rather than a shape check. A test that only compared fields would pass on the
    // broken version — the proxy has all three.
    const book = createAttachmentBook()
    book.write(draftKey('a'), [FILE])
    const staged = book.read(draftKey('a'))

    // ⚠️ **The defect first, so the fix below is not passing over nothing.** If Vue ever stops
    // handing out a proxy here, this line fails and the guard can be retired deliberately rather
    // than sitting green over a problem that moved.
    expect(() => structuredClone(staged), 'a reactive read is no longer a Proxy').toThrow()

    // 🔴 …and what the store puts on the wire clones, which is the fix.
    const sent = overTheWire(staged)
    expect(() => structuredClone(sent)).not.toThrow()
    expect(structuredClone(sent)).toEqual([FILE])
  })

  it('⛔ …and it puts exactly the three fields the wire takes, never a fourth', () => {
    // ⚑ Written out field by field rather than spread, so a renderer cannot smuggle anything the
    // schema would then have to refuse — and so the shape is pinned as well as the cloneability.
    const smuggled = [
      { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false, secret: 'nope' },
    ] as unknown as HandedPath[]

    expect(overTheWire(smuggled)).toEqual([FILE])
    expect(Object.keys(overTheWire(smuggled)[0]!).sort()).toEqual(['kind', 'outsideCwd', 'path'])
  })

  const FOLDED: HandedPath = { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }

  it('🔴 THE WIRE DOOR bounds what a renderer may post — the first of the three bounds', () => {
    // ⛔ Found in review: the schema was asserted by nothing and had no mutation row, while being
    // the first bound at the trust boundary. ⚠️ Every one of these is main doing work on the
    // renderer's say-so: without `.max` a compromised renderer posts 100,000 paths and main
    // `realpathSync`es every one of them, synchronously, before the turn goes out.
    const ok = (attachments: unknown): boolean =>
      runtimeCommandSchema.safeParse({ kind: 'send', sessionId: 's', text: 'hi', attachments })
        .success

    // ⚑ The paired positive FIRST, so the refusals below mean something.
    expect(ok([{ path: '/work/notes.md', kind: 'file', outsideCwd: false }])).toBe(true)
    expect(ok(undefined)).toBe(true)
    expect(ok([])).toBe(true)

    // The array is bounded.
    expect(
      ok(
        Array.from({ length: MAX_HANDED_PATHS + 1 }, (_, i) => ({
          path: `/p/${i}`,
          kind: 'file',
          outsideCwd: false,
        })),
      ),
    ).toBe(false)
    // The path is bounded, and non-empty.
    expect(ok([{ path: `/${'x'.repeat(4096)}`, kind: 'file', outsideCwd: false }])).toBe(false)
    expect(ok([{ path: '', kind: 'file', outsideCwd: false }])).toBe(false)
    // 🔒 …and ABSOLUTE, which the comment claimed and the schema did not hold.
    expect(ok([{ path: 'notes.md', kind: 'file', outsideCwd: false }])).toBe(false)
    // The kind is one of ours, and the flag is a boolean.
    expect(ok([{ path: '/p/x', kind: 'socket', outsideCwd: false }])).toBe(false)
    expect(ok([{ path: '/p/x', kind: 'file', outsideCwd: 'yes' }])).toBe(false)
  })

  it('🔴 the FOLD carries a queued message\u2019s paths and its reason to the bubble', () => {
    // ⛔ Found in review: the host was asserted to publish `attachments`/`detail`, and the
    // component was asserted to render them when handed them directly, and NOTHING folded an event
    // through `applyEvent` in between. Deleting either line in the fold left all 41 mutation rows
    // green and the whole suite green, while a message abandoned because its file was deleted
    // rendered "the conversation ended first" — the untrue sentence two other rows each spend
    // themselves preventing.
    const state = createTranscript()
    applyEvent(state, {
      type: 'message_queued',
      text: 'when you get a moment',
      attachments: [FOLDED],
    })

    const queued = state.items.at(-1) as { kind: string; attachments?: HandedPath[] }
    expect(queued.kind).toBe('queued')
    expect(queued.attachments).toEqual([FOLDED])

    applyEvent(state, {
      type: 'message_unqueued',
      reason: 'abandoned',
      text: 'when you get a moment',
      detail: 'there is nothing at /gone.md',
      attachments: [FOLDED],
    })

    const ended = state.items.at(-1) as {
      outcome: string
      detail?: string
      attachments?: HandedPath[]
    }
    // One item, not two — the ending marks the waiting one rather than pushing another.
    expect(state.items).toHaveLength(1)
    expect(ended.outcome).toBe('abandoned')
    expect(ended.detail).toBe('there is nothing at /gone.md')
    expect(ended.attachments).toEqual([FOLDED])
  })

  it('⚑ …and an ending with no matching item still carries them — 054 pages the transcript', () => {
    // The paired case: a window can hold the ending without the beginning, which is exactly why the
    // event carries the text at all. It has to carry the rest for the same reason.
    const state = createTranscript()
    applyEvent(state, {
      type: 'message_unqueued',
      reason: 'cancelled',
      text: 'never mind',
      attachments: [FOLDED],
    })

    const only = state.items.at(-1) as { kind: string; attachments?: HandedPath[] }
    expect(only.kind).toBe('queued')
    expect(only.attachments).toEqual([FOLDED])
  })

  it('🔴 215 §3.5\u2019s BOUND — a replayed turn\u2019s attachments cannot be whatever the row holds', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-handed-replay-')))
    const db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    const store = createSessionStore(db)
    store.create({
      id: 'sess_r',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'd',
    })

    // A row a later build — or an edit — could leave behind: a path that is not a string, a kind
    // that is not one of ours, a path far past `PATH_MAX`, and more entries than the bound allows.
    //
    // ⛔ **The malformed three come FIRST, and that is the whole point of the fixture** (fixed in
    // review). They used to sit AFTER forty valid entries, where `.slice(0, 10)` on its own — with
    // the filter deleted entirely — still produced ten clean paths and satisfied every assertion
    // below. The test could not tell the rule from its absence. ⚑ Leading the payload with them
    // means a `slice`-only bound returns them, and also pins the ORDER the two operations run in:
    // filter first, so junk at the front cannot evict every valid path from the window.
    const malformed = [
      { path: 'x'.repeat(9000), kind: 'file', outsideCwd: false },
      { path: '/ok', kind: 'nonsense', outsideCwd: false },
      { path: 42, kind: 'file', outsideCwd: false },
    ]
    const valid = Array.from({ length: 40 }, (_, i) => ({
      path: `/p/${i}`,
      kind: 'file',
      outsideCwd: false,
    }))
    store.append(
      'sess_r',
      0,
      { type: 'user_turn', text: 'look', attachments: [...malformed, ...valid] as never } as never,
      1,
    )
    // ⛔ **And the queue events too** (216, review): all three types carry attachments now, so all
    // three go through the bound. A rule that held for one of them is the gap the next one falls in.
    store.append(
      'sess_r',
      1,
      { type: 'message_queued', text: 'later', attachments: [...malformed, ...valid] as never },
      2,
    )
    // ⛔ **And the ENDING, which the fixture used to skip** (review). Covering two of the three
    // meant deleting the third clause from the bound's condition left everything green, while an
    // edited row handed `QueuedMessage.vue`'s `v-for` an unbounded list.
    store.append(
      'sess_r',
      2,
      {
        type: 'message_unqueued',
        reason: 'cancelled',
        text: 'later',
        attachments: [...malformed, ...valid],
      } as never,
      3,
    )

    const replayed = store.events('sess_r').map(({ event }) => event)
    for (const event of replayed) {
      const kept = (event as { attachments?: { path: string; kind: string }[] }).attachments
      // ⚑ EXACTLY the bound, not merely under it — 43 entries in, 10 out.
      expect(kept?.length).toBe(MAX_HANDED_PATHS)
      expect(kept?.every((each) => each.path.length <= 4096)).toBe(true)
      expect(kept?.every((each) => each.kind === 'file' || each.kind === 'directory')).toBe(true)
      // 🔴 The assertion the old fixture could not make: the survivors are the VALID ones, in
      // order, which is false for every bound that slices before it filters.
      expect(kept?.map((each) => each.path)).toEqual(valid.slice(0, 10).map((each) => each.path))
    }

    // ⛔ **An unknown key cannot ride along** (review). The bound used to `{ ...each }`, which
    // copied every own key off the stored payload — so it held the array length and the path
    // length and nothing else, and a bundle could carry a megabyte in a field nobody declared.
    store.append(
      'sess_r',
      3,
      {
        type: 'user_turn',
        text: 'sneaky',
        attachments: [
          { path: '/p/ok.md', kind: 'file', outsideCwd: false, blob: 'x'.repeat(5000) },
        ],
      } as never,
      4,
    )
    const sneaky = store.events('sess_r')[3]?.event as Extract<
      TranscriptEvent,
      { type: 'user_turn' }
    >
    expect(sneaky.attachments).toEqual([{ path: '/p/ok.md', kind: 'file', outsideCwd: false }])

    // ⚑ The paired positive: a well-formed row is replayed untouched, or "bounded" would be
    // indistinguishable from "always discards".
    store.append(
      'sess_r',
      4,
      {
        type: 'user_turn',
        text: 'fine',
        attachments: [{ path: '/p/keep.md', kind: 'file', outsideCwd: true }],
      } as never,
      5,
    )
    const fine = store.events('sess_r')[4]?.event as Extract<TranscriptEvent, { type: 'user_turn' }>
    expect(fine.attachments).toEqual([{ path: '/p/keep.md', kind: 'file', outsideCwd: true }])

    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
