import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  parentCardOf,
  workingTogetherView,
  type CastCard,
} from '../src/renderer/src/lib/working-together'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import type { WhatIsBeingDone } from '../src/shared/what-is-being-done'

/**
 * # 🔴 632 · a child's state — the fact `547` F1 refused to guess
 *
 * ## ⛔ What `547` F1 said, and why it was right when it said it
 *
 * > ⚠️ *"`status` is not one of them, and that is the finding rather than a shortcut (547 F1).
 * > {@link SpawnEdge} carries `running` and not `status`, and those answer different questions."*
 *
 * `running` says whether this app runs a child; its status says what the child is doing. The
 * band must expose that state rather than show only an undifferentiated plate.
 *
 * ## ⚑ What changed, and it is the READ rather than the rule
 *
 * 🔴 **`575` and `593` built the missing fact three weeks after `547` F1 was written.**
 * `ConversationAtWork` carries the status, the activity and the streaming flag off the live event
 * stream; `whatAPlateCanDraw` is the one door out of it; `team-roster.ts` has drawn plates from it
 * since `593`. ⛔ **This band is another caller.**
 *
 * ## ⛔ What this file measures, and the shape of every case
 *
 * ⚑ **Nothing is constructed.** A real `RuntimeHost` over a real SQLite ledger starts a real child
 * through `give_work` (D-016), a real turn is driven in it, and the SAME two reads the window makes —
 * `whoCalledWhom` and `whatIsBeingDone` — are handed to the product's own fold. ⚠️ **The plate a
 * person sees is whatever that produces.**
 *
 * 🔴 **And every positive is paired with the absence beside it** (§4.3 of this dispatch's brief,
 * `a-closed-vocabulary-guards-what-a-member-says`): a member nothing produces passes every
 * exhaustive check while measuring nothing, so each state below is reached from a recorded fact and
 * each `unknown` is reached from a real absence.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('632 · a child avatar shows what the child is doing', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let window: Window
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-632-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-632-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_800_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new FakeRuntime('claude', { sessions }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new Window('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId = 'default'): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'auto' },
      window,
    )
    return sessionId
  }

  const toolCall = async (
    sessionId: string,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const set = agentToolsFor(host, sessionId)
    const tool = set.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /** ⚑ What the host's own read says one conversation is doing, right now. */
  const rowOf = (conversation: string) =>
    host.whatIsBeingDone().conversations.find((one) => one.conversation === conversation)

  /**
   * ⛔ **A REAL give that starts the child** (D-016: `give_work` took `spawn_agent`'s place) — the
   * child's identity is brought into being first, exactly as the app requires, and the parent needs
   * no grant to start it (D-014: any agent may start any agent).
   *
   * ⚠️ **The brief is the child's FIRST TURN**, and in `auto` the fake provider drives it to its end
   * on its own. ⚑ So the helper waits until the child and its parent have both gone quiet — the
   * brief's turn over in one, and whatever it told the other over too — and every case below starts
   * from a child this app is running and driving no turn in, which is what a spawned child was.
   */
  const aParentStartsAChild = async (): Promise<{
    parent: string
    child: string
    label: string
  }> => {
    const worker = await personOpens('worker')
    await host.close(worker, window)
    const parent = await personOpens()
    const given = await toolCall(parent, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the world clock page',
      brief: 'build the world clock page',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const child = given.agent as string
    await vi.waitFor(() => {
      for (const conversation of [child, parent]) {
        expect(rowOf(conversation)?.told).toEqual({
          said: 'nothing',
          because: 'no-activity-right-now',
        })
        expect(rowOf(conversation)?.status).toBe('idle')
      }
    })
    return { parent, child, label: given.label as string }
  }

  /**
   * 🔴 **A real turn in the CHILD, through the door a child really gets work by.**
   *
   * ⛔ **`host.send` is refused here and that refusal is correct**: a started conversation is owned
   * by nobody, so a window may not drive it without claiming it first. ⚑ A message from the PARENT
   * is how work actually reaches a child — D-016: a follow-up on the piece it gave — and it opens
   * a turn the fake provider drives, so every event `BeingDoneTracker` folds below is one this app
   * really published.
   */
  const theParentGivesItWork = async (
    parent: string,
    child: string,
    label: string,
  ): Promise<WhatIsBeingDone> => {
    const sent = await toolCall(parent, 'message_agent', {
      kind: 'follow-up',
      agent: child,
      piece: label,
      text: 'start on the page',
    })
    expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    // ⚠️ **Waited on the FACT and never on a sleep** — the tracker has folded something real.
    //
    // ⛔ **And the reading is CAPTURED at the moment the wait succeeds, then handed back.** A
    // second `whatIsBeingDone()` a few lines later is a second instant: the turn the fake drives
    // ends on its own, and a test that read twice measured a conversation that had already gone
    // quiet — `an-equality-against-a-re-read-of-a-moving-field`, found here rather than reasoned
    // about.
    let caught: WhatIsBeingDone | null = null
    await vi.waitFor(() => {
      const reading = host.whatIsBeingDone()
      expect(reading.conversations.find((one) => one.conversation === child)?.told.said).not.toBe(
        'nothing',
      )
      caught = reading
    })
    if (caught === null) throw new Error('the wait succeeded and captured nothing')
    return caught
  }

  /**
   * ⚑ **The two reads a window makes, and the fold they feed** — the product's own, in the order
   * `RuntimeScreen.readTheCast` makes them.
   */
  const theBand = (parent: string, atWork: WhatIsBeingDone | null): readonly CastCard[] => {
    const view = workingTogetherView({
      reading: { conversation: parent, read: host.whoCalledWhom(parent), answered: true, atWork },
      forConversation: parent,
      identities: null,
      now: clock,
    })
    expect(view, 'the band drew nothing at all').not.toBeNull()
    return view!.children
  }

  const theChild = (parent: string, atWork: WhatIsBeingDone | null): CastCard => {
    const [card] = theBand(parent, atWork)
    if (card === undefined) throw new Error('the band drew no child card')
    return card
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the state ARRIVES, from a fact this app really recorded
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the fact arriving', () => {
    it('🔴 a child in the middle of a turn wears what it is DOING, not a faceless ring', async () => {
      const { parent, child, label } = await aParentStartsAChild()
      const reading = await theParentGivesItWork(parent, child, label)

      const card = theChild(parent, reading)
      // 🔴 **The whole dispatch in one assertion.** `547` F1 left this `unknown` for every child.
      expect(card.facets.doing, JSON.stringify(card.facets)).not.toBe('unknown')
      expect(card.facets.doing).not.toBe('idle')
    })

    it('⚑ …and the PARENT wears one too, which is the other half of his sentence', async () => {
      const { parent, child, label } = await aParentStartsAChild()
      const reading = await theParentGivesItWork(parent, child, label)
      // ⛔ The card folded FROM THE CHILD names the parent — the way up the panel draws.
      const up = parentCardOf({
        reading: {
          conversation: child,
          read: host.whoCalledWhom(child),
          answered: true,
          atWork: reading,
        },
        forConversation: child,
        identities: null,
        now: clock,
      })
      expect(up, 'the child names no parent').not.toBeNull()
      expect(up?.conversation).toBe(parent)
      // ⚑ The parent is idle here — it is driving no turn — and `idle` is a state it really is in.
      expect(up?.facets.doing).toBe('idle')
    })

    it('⛔ the child row names it — no `sess_` reaches a person', async () => {
      // 🔴 **`HO-092` §2 and `HO-095` §5.3 are both *names, not ids*.** ⚠️ Asserted here because a
      // child row showing `sess_…` would be that finding a third time, and this dispatch's §4.4
      // asked whether the row can reach a name at all before adding a field for one.
      const { parent, child } = await aParentStartsAChild()
      const card = theChild(parent, host.whatIsBeingDone())
      expect(card.conversation).toBe(child)
      expect(card.name).not.toContain('sess_')
      expect(card.name).toBe('worker')
      // ⚑ **The profile slug is on the row already** — no field was added.
      expect(card.identity).toBe('worker')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the three absences, and not one of them may read as `idle`
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · unknown is unknown', () => {
    it('⚑ a child that has STOPPED reads `idle`', async () => {
      // 🔴 **A second correction to this file's own first draft, and it is the more interesting
      // one.** ⚠️ It asserted `unknown` here. ⛔ **A conversation this app is not running is doing
      // nothing here** — the HOST's answer, `running === 'not-running'` — so its plate is `idle`.
      //
      // ⚑ **D-017b · and the row no longer tells a stop from an idle turn**: whether a process runs
      // is not a person's to know (`05` rule 5): the card says what it is doing, and nothing about
      // a process.
      const { parent, child, label } = await aParentStartsAChild()
      const reading = await theParentGivesItWork(parent, child, label)
      // ⚑ **The positive control, taken first on the same fixture**: with the child running, the
      // plate really does carry a face — so the change below is the ending doing it.
      expect(theChild(parent, reading).facets.doing).not.toBe('unknown')
      expect(theChild(parent, reading).facets.doing).not.toBe('idle')

      // ⚑ **D-017 — nothing ends a conversation** (`end_agent` is gone): the app's own stop, which
      // is what its parent's `end_agent` was — this app no longer runs it.
      await host.close(child, THE_APP_ITSELF)
      const after = host.whatIsBeingDone()
      // ⛔ **The premise, asserted**: the read's population really has dropped it.
      expect(after.conversations.map((one) => one.conversation)).not.toContain(child)

      const card = theChild(parent, after)
      expect(card.facets.doing).toBe('idle')
    })

    it('⛔ a child with nothing to do reads `idle`, and that is a claim this app CAN make', async () => {
      // 🔴 **A correction to this test's own first draft, and it is worth writing down.** ⚠️ It
      // asserted `unknown`, on the theory that a freshly spawned child has been told nothing. ⛔
      // **Measured, it has**: a launch publishes real events, so `told.because` is
      // `no-activity-right-now` and the recorded status is `idle` — *this app is not driving a turn*
      // (`042`), about a conversation it IS running. ⚑ D-016: the child ran its brief as its first
      // turn, and that turn is over, so it has nothing to do NOW.
      //
      // ⚑ **So `idle` here is honest and is strictly more than the band said before `632`**, which
      // was `unknown` for this row and for every other. 🔴 The state that may never be drawn as
      // `idle` is the one where this app knows nothing — and the two tests either side of this one
      // are those.
      const { parent, child } = await aParentStartsAChild()
      const reading = host.whatIsBeingDone()
      const row = reading.conversations.find((one) => one.conversation === child)
      expect(row, 'the child is not in the reading at all').toBeDefined()
      expect(row?.told).toEqual({ said: 'nothing', because: 'no-activity-right-now' })
      expect(row?.status).toBe('idle')

      expect(theChild(parent, reading).facets.doing).toBe('idle')
    })

    it('🔴 …and a child NOTHING has arrived from has its status WITHHELD, not replaced', async () => {
      // ⛔ **The one member that changes what a surface may draw from the other fields** —
      // `nothing-has-arrived`, `a-door-that-answers-before-it-can-know`. ⚠️ It is the interval
      // between a launch registering and its first event, which no real fixture can be held inside
      // deterministically — so the ROW is replaced and the rest of the read is the host's own.
      //
      // ⚑ **Replacing an input to a pure fold is not constructing an answer**: `whatAPlateCanDraw`
      // makes the decision, this band never sees it, and the assertion is that the band inherits it.
      const { parent, child } = await aParentStartsAChild()
      const real = host.whatIsBeingDone()
      const row = real.conversations.find((one) => one.conversation === child)
      if (row === undefined) throw new Error('the child is not in the reading')
      // ⛔ **The control FIRST, on the untouched reading**: this row really does draw `idle`, so the
      // change below is the withholding and not the fixture.
      expect(theChild(parent, real).facets.doing).toBe('idle')

      const asItRegisters: WhatIsBeingDone = {
        ...real,
        conversations: real.conversations.map((one) =>
          one.conversation === child
            ? { ...one, told: { said: 'nothing', because: 'nothing-has-arrived' } as const }
            : one,
        ),
      }
      // ⚑ **The recorded status is still `idle` on that row** — it is WITHHELD rather than changed,
      // which is the distinction the member exists for.
      expect(asItRegisters.conversations.find((one) => one.conversation === child)?.status).toBe(
        'idle',
      )
      expect(theChild(parent, asItRegisters).facets.doing).toBe('unknown')
    })

    it('⚠️ a band with NO reading at all draws it — a cold window, and a refusal', async () => {
      const { parent } = await aParentStartsAChild()
      // ⛔ **`null` is two states and they draw the same thing**: nothing has been read yet, and a
      // read that refused had its refinement dropped — `RuntimeScreen`'s own rule for that ref.
      expect(theChild(parent, null).facets.doing).toBe('unknown')
    })

    it('⚑ a recipient card — a conversation the spawn walk never read — has no state either', async () => {
      // ⛔ **A `WorkEdge` names a conversation with no session row**, so asking `whatIsBeingDone`
      // about it would be this band answering a question the read did not ask.
      //
      // 🔴 **The first draft of this test looped over `view.others` and that list was EMPTY** — a
      // loop over nothing passes over nothing (`an-unenumerated-state-counts-as-success`, one shape
      // over). ⚑ So the work edge is PLANTED onto the host's own read: the rows either side of it
      // are real, and the recipient is the one thing this fixture cannot produce.
      const { parent, child, label } = await aParentStartsAChild()
      const real = host.whoCalledWhom(parent)
      const reading = await theParentGivesItWork(parent, child, label)
      const view = workingTogetherView({
        reading: {
          conversation: parent,
          read: {
            ...real,
            workGivenOut: {
              ...real.workGivenOut,
              rows: [
                {
                  piece: 'work_planted',
                  label: 'W1.9',
                  title: 'take the notes',
                  from: parent,
                  fromIdentity: 'default',
                  to: 'sess_never_spawned',
                  toIdentity: 'scribe',
                  state: 'working',
                  givenAt: clock - 30_000,
                  endedAt: null,
                },
              ],
            },
          },
          answered: true,
          atWork: reading,
        },
        forConversation: parent,
        identities: null,
        now: clock,
      })
      // ⛔ **Non-vacuity, asserted before anything else is.**
      expect(view?.others.map((one) => one.conversation)).toEqual(['sess_never_spawned'])
      const [outsider] = view!.others
      expect(outsider?.facets.doing).toBe('unknown')
      // ⚑ **The control on the same band**: the spawned child IS wearing a state, so the absence
      // above belongs to this card rather than to a fold that gives nobody one.
      expect(view?.children.map((one) => one.conversation)).toEqual([child])
      expect(view?.children[0]?.facets.doing).not.toBe('unknown')
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────────
// §3 · the READ — one round trip, and a refusal that drops the refinement
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · what RuntimeScreen asks, and what it keeps', () => {
  /** ⚠️ Prose is stripped first — this file quotes the lines it counts (rule 26). */
  const codeOf = (body: string): string =>
    body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  const screen = codeOf(
    readFileSync(join(here, '../src/renderer/src/components/RuntimeScreen.vue'), 'utf8'),
  )
  /** ⛔ `readTheCast`'s body alone, ending at the next declaration whatever keyword opens it. */
  const readTheCast = ((): string => {
    const opens = screen.indexOf('async function readTheCast(')
    expect(opens, 'readTheCast was renamed or removed').toBeGreaterThan(0)
    const rest = screen.slice(opens + 1)
    const next = rest.search(/\n(?:async )?function |\nwatch\(/)
    return rest.slice(0, next < 0 ? undefined : next)
  })()

  it('requests relationships, activity and graph together without delaying the first answer', () => {
    const firstAwait = readTheCast.indexOf('const answer = await answerPending')
    expect(firstAwait).toBeGreaterThan(0)
    const requested = readTheCast.slice(0, firstAwait)
    expect(requested).toContain('const answerPending = store.whoCalledWhom(asked)')
    expect(requested).toContain('const doingPending = store.whatIsBeingDone()')
    expect(requested).toContain('const forestPending = store.theWholeForest()')
    expect(requested).not.toContain('await ')
    const publication = readTheCast.indexOf('answered: true, atWork: null')
    expect(publication).toBeGreaterThan(firstAwait)
    expect(publication).toBeLessThan(readTheCast.indexOf('const doing = await doingPending'))
    expect(publication).toBeLessThan(readTheCast.indexOf('await forestPending'))
  })

  it('⛔ a refusal keeps the cards and DROPS the doing words', () => {
    // 🔴 **`beingDone`'s own rule, inherited.** Every other kept read is a LIST whose absence would
    // read as *nothing is here*; this one is a REFINEMENT, so a kept card returns to the faceless
    // plate rather than wearing a tool name from a minute ago.
    const kept = readTheCast.slice(
      readTheCast.indexOf('cast.reading.value =', readTheCast.indexOf('answered: true')),
    )
    expect(kept).toContain('answered: false')
    expect(kept).toContain('atWork: null')
    // A successful relationship read still accepts fresh activity when its refinement arrives.
    expect(readTheCast).toContain('cast.reading.value = { ...reading, atWork: doing }')
    expect(readTheCast).toContain('reading?.conversation === asked && reading.answered')
  })

  it('⛔ a failed forest read keeps the last good one', () => {
    // A failed graph refinement keeps the last good tree.
    const written = readTheCast.split('\n').filter((line) => line.includes('cast.forest.value ='))
    expect(written).toHaveLength(1)
    expect(readTheCast).toContain(
      'if (mine === castRead && asked === activeId.value && grown !== null) {\n      cast.forest.value = grown',
    )
    expect(written[0]).toContain('cast.forest.value = grown')
  })
})

// ───────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the plate, and the ordering it inherits
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the plate over a finished tool', () => {
  /**
   * 🔴 **`089`'s defect, at a band that never had it.** ⛔ After a tool returns the last activity
   * still says `tool` while the model is already streaming, and the pill read *"running Bash"* into
   * the middle of the reply. ⚑ `sessionDoing` puts streaming above activity.
   *
   * ⚠️ **The reading is PLANTED for this one**, because the moment a real provider is both
   * streaming and holding a finished tool activity is an instant no fixture can be held inside.
   * ⛔ The fold is pure and the planted shape is the wire's, so what is measured is the ordering.
   */
  it('🔴 the plate says REPLYING over a finished tool', () => {
    const child = 'sess_child'
    const view = workingTogetherView({
      reading: {
        conversation: 'sess_parent',
        read: {
          conversation: 'sess_parent',
          readAt: 1_800_000_000_000,
          parent: null,
          children: {
            rows: [
              {
                conversation: child,
                identity: 'worker',
                provider: 'claude',
                running: 'unwatched',
              },
            ],
            walk: 'every-conversation-this-one-spawned',
            ledgers: 1,
            rowsUnread: 0,
          },
          workGivenOut: {
            rows: [],
            walk: 'every-conversation-this-one-gave-work-to',
            ledgers: 1,
            rowsUnread: 0,
          },
          workTakenIn: {
            rows: [],
            walk: 'every-piece-of-work-this-one-was-given',
            ledgers: 1,
            rowsUnread: 0,
          },
        },
        answered: true,
        atWork: {
          readAt: 1_800_000_000_000,
          conversations: [
            {
              conversation: child,
              identity: 'worker',
              told: { said: 'an-activity', phase: 'tool', detail: 'Bash' },
              status: 'working',
              streaming: true,
              since: 1_799_999_995_000,
              context: null,
            },
          ],
        },
      },
      forConversation: 'sess_parent',
      identities: null,
      now: 1_800_000_000_000,
    })
    const card = view?.children[0]
    expect(card?.facets.doing).toBe('replying')
  })
})
