import { fixtureProviderConfig, neutralHostDeps, RecordingSink } from './lib/host-fixture'
import { waitFor } from './lib/f093-host'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { AgentToolset, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { Caller } from './helpers/giver-notice-host'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { sinkOwnerId } from '../src/main/runtime/window-caller'
import {
  A_PERSON_SENT_IT,
  aTurnThatHasSaidNothing,
  messageNamingItsSender,
  theDirectionLine,
  THE_PERSON_AT_A_WINDOW,
} from '../src/main/runtime/turn-origin'
import { messageNamingThePiece } from '../src/main/runtime/reply-rails'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentName } from '../src/shared/runtime-ipc'
import type { WhereTheSenderStands } from '../src/main/runtime/turn-origin'
import { theOwnerOf } from '../src/shared/piece-called'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * ⚑ D-011 · a PM called Pam that gave the receiver W1.3 — for the pure composer's tests. ⚑ D-016:
 * a piece reads by its label, where it was *Task #3 in default*. ⚑ D-016 · commit 7 · R3: Pam owns
 * W1, the piece W1.3 was given under, and that piece is the address the direction line names her by.
 */
const PAM_GAVE_W1_3 = (): WhereTheSenderStands => ({
  name: 'Pam',
  handsYou: null,
  openWorkItGaveYou: ['W1.3'],
  gaveYouWorkThatIsClosed: false,
  named: { label: 'W1', title: 'The site' },
  about: null,
})

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

/** ⛔ **Comment-stripped**, so a census reads what the code does and not what a docblock says. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The host's source, comments stripped — the subject of every census in this file. */
const hostSource = (): string =>
  codeOnly(readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8'))

class ProviderDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handles: FakeSessionHandle[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.handles.push(handle)
    return handle
  }
}

describe('414 · the origin a model is told', () => {
  let handles: FakeSessionHandle[]
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-origin-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-origin-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handles = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink(sinkOwnerId({ id: 1 }))
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const entries = (sessionId: string): readonly PersistedEventInfo[] => store.events(sessionId)
  const ledger = (sessionId: string): TranscriptEvent[] =>
    entries(sessionId).map((entry) => entry.event)
  const turnsIn = (sessionId: string): Extract<TranscriptEvent, { type: 'user_turn' }>[] =>
    ledger(sessionId).filter(
      (event): event is Extract<TranscriptEvent, { type: 'user_turn' }> =>
        event.type === 'user_turn',
    )

  /**
   * ⚑ **What the PROVIDER received**, off the double's echo — the exact string that crossed
   * `SessionHandle.send`, which is the only thing this dispatch is about.
   */
  const providerHeard = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'assistant_message' }> =>
          event.type === 'assistant_message',
      )
      // The message, without the block this app adds at its end: these cases are about its frame.
      .map((event) => withoutWhatThisAppAdds(event.text.replace(/^echo: /, '')))

  const pendingCardOn = (sessionId: string): string | null => {
    const answered = new Set(
      ledger(sessionId)
        .filter((event) => event.type === 'user_decision')
        .map((event) => (event.type === 'user_decision' ? event.requestId : '')),
    )
    const open = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .map((event) => (event.type === 'permission_request' ? event.id : ''))
      .filter((id) => !answered.has(id))
    return open.at(-1) ?? null
  }

  /** ⛔ Answer whatever this conversation is parked on until `until` holds — `413`'s helper. */
  const unblockUntil = async (
    sessionId: string,
    until: () => boolean,
    what: string,
  ): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (until()) return
      const card = pendingCardOn(sessionId)
      if (card !== null) {
        try {
          await host.respondPermission(sessionId, card, { outcome: 'allow' }, window)
        } catch {
          host.claimSession(sessionId, window)
          await host.respondPermission(sessionId, card, { outcome: 'allow' }, window)
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const latestHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('no provider handle has been issued')
    return handle
  }

  interface APair {
    readonly pm: string
    readonly pmProfile: string
    readonly worker: string
    readonly pmTools: AgentToolset
    /** ⚑ **D-016** · the piece the give handed the worker — its id, label and title. */
    readonly piece: string
    readonly label: string
    readonly title: string
  }

  /** ⚑ A PM a person opened, before it gives anything — and the agent it will give to. */
  const aPm = async (
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<Omit<APair, 'worker' | 'piece' | 'label' | 'title'> & { workerProfile: string }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const siblings = [`worker-${String(nth)}-a`, `worker-${String(nth)}-b`]
    for (const one of siblings) await bringIdentityIntoBeing(one)
    const { sessionId: pm } = await host.createSession(
      { provider: 'claude', profileId: pmProfile, approvalMode, cwd: root },
      window,
    )
    return { pm, pmProfile, pmTools: agentToolsFor(host, pm), workerProfile: siblings[0] as string }
  }

  /**
   * ⚑ **D-016 · the PM gives its worker a piece**, which is what starts the worker: the brief is the
   * worker's FIRST turn — where a spawn started it with nothing sent and a `work` message handed the
   * work over. ⚠️ It runs in the PM's mode: in `ask` it parks on the Fake's card, in `auto` it ends
   * at once, and that is waited for so the worker is idle when this returns.
   */
  const theGive = async (
    made: Awaited<ReturnType<typeof aPm>>,
    brief: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<APair> => {
    const title = 'The work'
    const given = await callOn(made.pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: made.workerProfile,
      title,
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    if (approvalMode === 'auto') {
      await waitFor(
        () => ledger(worker).some((event) => event.type === 'turn'),
        'the brief’s turn to end',
      )
    }
    return {
      pm: made.pm,
      pmProfile: made.pmProfile,
      pmTools: made.pmTools,
      worker,
      piece: given.piece as string,
      label: given.label as string,
      title,
    }
  }

  const aPmAndItsWorker = async (
    brief = 'the work this dispatch is about',
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<APair> => theGive(await aPm(approvalMode), brief, approvalMode)

  /** ⚑ **D-016 · the work is the give's brief**, where it was a `work` message after a spawn. */
  const workWasGiven = (text = 'the work'): Promise<APair> => aPmAndItsWorker(text)

  /**
   * ⚑ The line this dispatch adds, built from the two facts the LEDGER holds — never typed out.
   *
   * 🔴 **439 added a THIRD fact and a second sentence**, and it is a fact about the SLOT rather than
   * the ledger: whether a person is at the sending conversation. ⛔ **Every pair in this file is
   * made by `aPmAndItsWorker`, whose PM is claimed by `window`** — a sink that declares
   * `aPersonIsBehindIt` — so the clause is TRUE here, and `§4`'s negative is where the other reading
   * is measured. ⚠️ Composed rather than typed for `414`'s reason exactly: a literal here would pass
   * while the product said something else.
   */
  const theFrameFor = (
    pair: APair,
    aPersonIsBehindIt = true,
    stands: 'giving-it' | 'gave-it' | 'follows-it-up' = 'giving-it',
  ): string =>
    messageNamingItsSender(
      '',
      { who: 'a-caller-with-an-id', caller: pair.pm, profile: pair.pmProfile, aPersonIsBehindIt },
      // ⚑ **D-011 · where the PM stands** — its name over the roster, and whether the framed words
      // hand over the pair's one piece of work (`giving-it`, the give's brief) or follow a piece it
      // already gave (`gave-it`). ⚠️ The words for each case are pinned by
      // `the-sender-says-where-it-stands.test.ts`. ⚑ **D-016 · commit 7 · R3 — and the work that
      // names the PM**, the store's own read, which is what the host hands the composer.
      // 🔴 **F088 · `follows-it-up`** — words that name the piece it gave, which the line says
      // they are about.
      () => ({
        name: agentName(pair.pmProfile, store.agentIdentities()),
        handsYou:
          stands === 'giving-it' ? { label: pair.label, title: pair.title, as: 'given' } : null,
        openWorkItGaveYou: stands === 'giving-it' ? [] : [pair.label],
        gaveYouWorkThatIsClosed: false,
        named: store.workThatNames(pair.pm),
        about: stands === 'follows-it-up' ? { label: pair.label, title: pair.title } : null,
      }),
    )

  /**
   * ⚑ **D-016 · commit 7 · R3 — the direction line that answers a PM**, which addresses it by the
   * piece it owns where it spelled its full `sess_<uuid>` — composed from the product's own parts
   * (the store's read, `theOwnerOf`, `theDirectionLine`), never typed.
   */
  const answering = (pm: string, pmProfile: string): string => {
    const named = store.workThatNames(pm)
    if (named === null) throw new Error(`${pm} holds no piece, so no piece addresses it`)
    // ⚑ W4.178 · every turn this answers hands over a piece: a brief says nothing of a note.
    return theDirectionLine(
      `${agentName(pmProfile, store.agentIdentities())}, ${theOwnerOf(named)}`,
      'caller',
      true,
    )
  }

  /**
   * ⚑ **611 · the SENDER line on its own** (HO-088 §4.1) — the first paragraph of the frame.
   *
   * ⛔ **Sliced off the PRODUCT's frame and never typed**, for {@link theFrameFor}'s reason: a
   * literal would pass while the product said something else. ⚠️ It exists because the frame is
   * two paragraphs since `611` — who sent it, and what to do — and several assertions here are
   * about the first alone.
   */
  const theSenderLineFor = (
    pair: APair,
    aPersonIsBehindIt = true,
    stands: 'giving-it' | 'gave-it' | 'follows-it-up' = 'giving-it',
  ): string => theFrameFor(pair, aPersonIsBehindIt, stands).split('\n')[0] ?? ''

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the turn a worker's provider receives
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · what the model is handed', () => {
    it('🔴 names WHO sent it and the TASK it hands over, and the ledger keeps the bare words', async () => {
      const made = await workWasGiven('deploy the branch')
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const handed = providerHeard(made.worker)[0] ?? ''

      // ⛔ **414 · the origin**, built from `identityOf` and not from a string in this test.
      expect(handed).toContain(theFrameFor(made))
      // ⚑ **412 · the id**, unchanged by the frame in front of it — ⚑ D-016: the piece's label, in
      // the product's own sentence (composed by `messageNamingThePiece`, never retyped here) …
      const theLineNamingThePiece = messageNamingThePiece('', { label: made.label, inputs: [] })
      expect(handed).toContain(theLineNamingThePiece)
      // … and that sentence is the one that tells the model how to hand the piece back.
      expect(theLineNamingThePiece).toContain(`reply_to_parent with piece ${made.label}`)
      // ⚠️ And the words the PM actually wrote, intact between the two.
      expect(handed).toContain('deploy the branch')

      // 🔴 **216's rule, which is what makes both compositions legal**: the LEDGER holds the
      // sender's words alone. ⛔ Storing the composed string would be `214`'s defect arriving from
      // the other end — BroBot's sentence rendered as something somebody typed, permanently.
      expect(turnsIn(made.worker).map((turn) => turn.text)).toEqual(['deploy the branch'])
    })

    it('⛔ the frame is FIRST and the instruction is LAST — and that is what keeps 412 measurable', async () => {
      const made = await workWasGiven('deploy the branch')
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const lines = (providerHeard(made.worker)[0] ?? '').split('\n').filter((one) => one !== '')

      // ⚠️ **An attribution that follows the words it attributes is a footnote.** The surface
      // settled this in `413` — the sender goes ABOVE the bubble — and a model reads the same
      // string in the same direction.
      // ⚑ **611 · the frame is TWO paragraphs** — the sender line and the direction line — so the
      // words it precedes are the third non-empty line rather than the second.
      expect(lines.slice(0, 2).join('\n\n')).toBe(theFrameFor(made))
      expect(lines[2]).toBe('deploy the branch')
      // ⛔ **`412`'s guard slices `.at(-1)` and refuses an address on it.** The finishing line is
      // still the last one, so that assertion still measures the line it was written about —
      // rather than being stepped around by a second sentence landing after it.
      expect(lines.at(-1) ?? '').toContain('reply_to_parent')
      expect(lines.at(-1) ?? '').not.toContain('Sent by `')
    })

    it('⚑ the address in the frame is the piece the LAUNCH layer already named the parent by', async () => {
      // ⛔ **The two sentences are about different questions.** The dynamic layer says *"This
      // conversation was started by <its name> (the owner of W<n>). That conversation can send you
      // messages"* — who CAN. This says who DID. ⚑ **D-016 · commit 7 · R3 — both name the parent
      // by the piece it owns**, where both spelled its full `sess_<uuid>` (HO-015 §3). ⚠️ They agree
      // on one label here because this parent owns a ROOT, which names it however much work it
      // gives later; one that owns none can be named by a newer piece by the time it writes, which
      // is why `turn-origin.ts` never asks a model to compare the two.
      const made = await workWasGiven('deploy the branch')
      const status = await callOn(agentToolsFor(host, made.pm), 'get_agent_status', {
        agent: made.worker,
      })
      expect((status.agent as { parent: string }).parent).toBe(made.pm)

      const factory = codeOnly(readFileSync(join(mainRoot, 'runtime/factory-text.ts'), 'utf8'))
      expect(factory).toContain('This conversation was started by ')
      expect(factory).toContain('context.startedBy')

      // ⚑ The piece that names the parent is the root it owns …
      const named = store.workThatNames(made.pm)
      if (named === null) throw new Error('the parent holds no piece — nothing below is measured')
      expect(named.label).toBe(store.rootOf(made.pm)?.label)
      // … the launch line names the parent the way every sentence names another conversation — its
      // name and a piece: ⚑ W4.175, the piece it started this one from, which for a root owner
      // giving from its root is that root (⚠️ the launch's own call, asked of the host: this host
      // is handed no instruction reader, so no launch text reaches the double) …
      expect(hostSource()).toContain(
        'this.theStarterCalled(parentSessionId, conversation, startedFrom)',
      )
      const launchSays = (
        host as unknown as {
          theStarterCalled(starter: string, conversation: string | null, from: null): string
        }
      ).theStarterCalled(made.pm, made.worker, null)
      expect(launchSays).toBe(
        `${agentName(made.pmProfile, store.agentIdentities())} (${theOwnerOf(named)})`,
      )
      expect(host.nameByItsWork(made.pm)).toBe(launchSays)
      // … and the frame addresses the sender by the same piece, and no longer by its id.
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const framed = providerHeard(made.worker)[0] ?? ''
      expect(framed).toContain(answering(made.pm, made.pmProfile))
      expect(framed).not.toContain(`\`${made.pm}\``)
    })

    /**
     * 🔴 **607 · CORRECTED, and this is what it used to assert:**
     *
     * > `expect(providerHeard(made.worker)).toEqual(['what are you doing?'])`
     * > — *"one fact over: a person's typed turn reaches the provider exactly as typed"*
     *
     * ⛔ **It was true and it is not a rule any more** (`HO-088` §4). ⚑ The shape is unchanged and
     * so is the point of it: whole-string equality, one fact over from the agent turn above, and
     * the ledger's half asserted in the same breath.
     */
    it('⛔ one fact over: a person’s typed turn says a person sent it, and the ledger keeps the bare words', async () => {
      // ⚑ **D-016 · the worker's first turn is the give's brief**, so it is let end first (`auto`)
      // and the person's turn is the SECOND the provider hears — every assertion below is about it.
      const made = await aPmAndItsWorker('the work this dispatch is about', 'auto')
      host.claimSession(made.worker, window)
      await host.send(made.worker, 'what are you doing?', window)
      await waitFor(() => providerHeard(made.worker).length > 1, 'the provider to answer')
      // ⚑ **Whole-string equality, deliberately.** *"Contains the line"* would pass with a second
      // sentence beside it, and half of what 607 owes is that there is exactly one.
      expect(providerHeard(made.worker).slice(1)).toEqual([
        messageNamingItsSender('what are you doing?', THE_PERSON_AT_A_WINDOW),
      ])
      // ⛔ **And the sentence is the PRODUCT's, never this file's** — composed from the export, so
      // a literal here could not pass while the app said something else (`414`'s own rule for
      // `theFrameFor`, which is the agent half of this same line).
      expect(providerHeard(made.worker)[1]?.startsWith(A_PERSON_SENT_IT)).toBe(true)
      // 🔴 **216's two strings, and 607 widened the gap rather than crossing it.** The LEDGER
      // still holds what they typed and nothing else — `214`'s defect stays closed.
      expect(
        turnsIn(made.worker)
          .slice(1)
          .map((turn) => turn.text),
      ).toEqual(['what are you doing?'])
      expect(
        turnsIn(made.worker)
          .slice(1)
          .map((turn) => turn.attribution),
      ).toEqual([undefined])
    })

    it('⚠️ and the same into the PM — the conversation `410` counted the defect on', async () => {
      const made = await aPmAndItsWorker()
      await host.send(made.pm, 'look at the deploy', window)
      await waitFor(
        () => providerHeard(made.pm).some((said) => said.includes('look at the deploy')),
        'the PM’s provider to answer',
      )
      expect(
        providerHeard(made.pm).some(
          (said) => said === messageNamingItsSender('look at the deploy', THE_PERSON_AT_A_WINDOW),
        ),
      ).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the busy child — the branch that costs a fix its honesty
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the child that was busy', () => {
    it('🔴 is framed at the FLUSH, from the mailbox entry, exactly as the idle one was', async () => {
      // ⛔ **This is the branch that makes a half-done fix look like model flakiness** — `406`'s
      // report and `412`'s task id were each dropped by it once. The flush has no caller, so an
      // origin it had to re-derive would be re-derived from a proxy.
      // ⚑ **D-016 · the first turn is the give's brief, and it went straight out** — the give says
      // so. ⚑ The frame is not a fact about what a message IS — {@link RuntimeHost.originOf} is asked
      // about the CALLER — so both branches carry it whichever act opened the turn, and that
      // independence is now covered by this test rather than assumed by it.
      const made = await aPm()
      const given = await callOn(made.pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: made.workerProfile,
        title: 'The work',
        brief: 'first, which goes straight out',
      })
      expect(given.delivery, JSON.stringify(given)).toBe('sent')
      const pair: APair = {
        ...made,
        worker: given.agent as string,
        piece: given.piece as string,
        label: given.label as string,
        title: 'The work',
      }

      // ⚑ **The second one finds the child mid-turn and is HELD** — the double raises a card per
      // turn and waits, which is what makes the ordinary case the busy one. ⚑ D-016: a follow-up on
      // the piece, where it was a second piece of work.
      const held = await callOn(made.pmTools, 'message_agent', {
        kind: 'follow-up',
        agent: pair.worker,
        piece: pair.label,
        text: 'second, which has to wait',
      })
      expect(held.delivery, JSON.stringify(held)).toBe('queued')

      await unblockUntil(
        pair.worker,
        () => providerHeard(pair.worker).some((said) => said.includes('second, which has to wait')),
        'the held message to reach the provider',
      )
      const heard =
        providerHeard(pair.worker).find((said) => said.includes('second, which has to wait')) ?? ''
      // ⛔ **Identical framing to the idle branch**, which is the whole assertion: a fix that
      // reached only the idle child would look like the model being unreliable. ⚑ D-016: the PM
      // stands as the giver of the open piece this follows up — 🔴 F088 · and the line says the
      // words are about it, from the held entry.
      expect(heard.split('\n')[0]).toBe(theSenderLineFor(pair, true, 'follows-it-up'))
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the composer, in isolation
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · messageNamingItsSender', () => {
    /** ⚑ Pam, an agent with a profile, as a sender line names her. */
    const PAM = {
      who: 'a-caller-with-an-id',
      caller: 'sess_9',
      profile: 'pm',
      aPersonIsBehindIt: false,
    } as const

    it('🔴 W4.187 · a sender is named in full once: the direction line says her name alone, and her piece’s title only when nothing above has said it', () => {
      const line = messageNamingItsSender('hello', PAM, PAM_GAVE_W1_3)
      expect(line).toContain('Sent by Pam (pm), who gave you W1.3.')
      expect(line).toContain(
        'The words you write in this turn do not reach Pam, the owner of W1 · The site.',
      )
      expect(line.split('(pm)')).toHaveLength(2)
      // ⚑ Words about the piece she owns: its title once, where the words name it.
      const aboutHerOwn = messageNamingItsSender('hello', PAM, () => ({
        ...PAM_GAVE_W1_3(),
        about: { label: 'W1', title: 'The site' },
      }))
      expect(aboutHerOwn).toContain('This message is about W1 · The site.')
      expect(aboutHerOwn).toContain('do not reach Pam, the owner of W1.')
      expect(aboutHerOwn.split('The site')).toHaveLength(2)
    })

    it('🔴 W4.187 · a turn of several names each sender in full once, and gives each piece’s title once — every fact still there', () => {
      const soFar = aTurnThatHasSaidNothing()
      const aboutTheClock = (): WhereTheSenderStands => ({
        ...PAM_GAVE_W1_3(),
        about: { label: 'W1.3', title: 'The clock page' },
      })
      const ola = { ...PAM, caller: 'sess_7', profile: 'qa' } as const
      const olaStands = (): WhereTheSenderStands => ({
        name: 'Ola',
        handsYou: null,
        openWorkItGaveYou: [],
        gaveYouWorkThatIsClosed: false,
        named: { label: 'W2', title: 'The tests' },
        about: { label: 'W1.3', title: 'The clock page' },
      })
      const first = messageNamingItsSender('one', PAM, aboutTheClock, undefined, soFar)
      const second = messageNamingItsSender('two', PAM, aboutTheClock, undefined, soFar)
      const third = messageNamingItsSender('three', ola, olaStands, undefined, soFar)
      // ⚑ The first time: her profile, and each piece's title.
      expect(first).toContain(
        'Sent by Pam (pm), who gave you W1.3. This message is about W1.3 · The clock page.',
      )
      expect(first).toContain('do not reach Pam, the owner of W1 · The site.')
      // ⚑ After that: her name, and the labels — who, which piece and the address all still there.
      expect(second).toContain('Sent by Pam, who gave you W1.3. This message is about W1.3.')
      expect(second).toContain('do not reach Pam, the owner of W1.')
      expect(second).not.toContain('(pm)')
      // ⚑ Another sender in the same turn is named in full, the first time; a piece already titled
      // in this turn goes by its label.
      expect(third).toContain(
        'Sent by Ola (qa), another agent; it gave you no work. This message is about W1.3.',
      )
      expect(third).toContain('do not reach Ola, the owner of W2 · The tests.')
      // ⚑ The control: the same words handed over alone say everything in full again.
      expect(messageNamingItsSender('two', PAM, aboutTheClock)).toContain(
        'This message is about W1.3 · The clock page.',
      )
    })

    it('⚑ W4.187 · in a turn of several: two new briefs of one piece give its title once; a sender with no piece keeps its conversation as the address', () => {
      const soFar = aTurnThatHasSaidNothing()
      const rebriefs = (): WhereTheSenderStands => ({
        ...PAM_GAVE_W1_3(),
        openWorkItGaveYou: [],
        handsYou: { label: 'W1.3', title: 'The clock page', as: 'rebriefed' },
      })
      const first = messageNamingItsSender('v1', PAM, rebriefs, undefined, soFar)
      const second = messageNamingItsSender('v2', PAM, rebriefs, undefined, soFar)
      expect(first).toContain(
        'Sent by Pam (pm), who sends you the new brief of W1.3 · The clock page.',
      )
      expect(second).toContain('Sent by Pam, who sends you the new brief of W1.3.')
      // ⚑ A sender who holds no piece: named alone the second time, its conversation still the address.
      const noPiece = (): WhereTheSenderStands => ({
        name: 'Sam',
        handsYou: null,
        openWorkItGaveYou: [],
        gaveYouWorkThatIsClosed: false,
        named: null,
        about: null,
      })
      const sam = { ...PAM, caller: 'sess_5', profile: 'helper' } as const
      messageNamingItsSender('one', sam, noPiece, undefined, soFar)
      const again = messageNamingItsSender('two', sam, noPiece, undefined, soFar)
      expect(again).toContain('Sent by Sam, another agent; it gave you no work.')
      expect(again).toContain('conversation `sess_5`')
    })

    it('⛔ W4.187 · the name alone only where it names one sender: never a name another sender of the turn goes by, nor a profile’s own word', () => {
      // ⚑ Two senders both called Ada, in one turn: each stays named with its profile.
      const soFar = aTurnThatHasSaidNothing()
      const ada = (caller: string, profile: string) => ({ ...PAM, caller, profile }) as const
      const adaStands = (): WhereTheSenderStands => ({ ...PAM_GAVE_W1_3(), name: 'Ada' })
      messageNamingItsSender('one', ada('sess_1', 'lead'), adaStands, undefined, soFar)
      const other = messageNamingItsSender('two', ada('sess_2', 'qa'), adaStands, undefined, soFar)
      const back = messageNamingItsSender(
        'three',
        ada('sess_1', 'lead'),
        adaStands,
        undefined,
        soFar,
      )
      expect(other).toContain('Sent by Ada (qa), who gave you W1.3.')
      expect(other).toContain('do not reach Ada (qa), the owner of W1.')
      expect(back).toContain('Sent by Ada (lead), who gave you W1.3.')
      expect(back).toContain('do not reach Ada (lead), the owner of W1.')
      // ⚑ An agent nobody has named goes by its profile's own word: that alone is no name.
      const unnamed = messageNamingItsSender('hello', { ...PAM, profile: 'reviewer' }, () => ({
        ...PAM_GAVE_W1_3(),
        name: 'reviewer',
      }))
      expect(unnamed).toContain('Sent by reviewer (reviewer), who gave you W1.3.')
      expect(unnamed).toContain('do not reach reviewer (reviewer), the owner of W1 · The site.')
    })

    it('⚑ W4.187 · a piece renamed between two mentions of one turn is said again under its new title', () => {
      const soFar = aTurnThatHasSaidNothing()
      const titledAs = (title: string) => (): WhereTheSenderStands => ({
        ...PAM_GAVE_W1_3(),
        about: { label: 'W1.3', title },
      })
      messageNamingItsSender('one', PAM, titledAs('The clock page'), undefined, soFar)
      expect(
        messageNamingItsSender('two', PAM, titledAs('The world clock page'), undefined, soFar),
      ).toContain('This message is about W1.3 · The world clock page.')
      expect(
        messageNamingItsSender('three', PAM, titledAs('The world clock page'), undefined, soFar),
      ).toContain('This message is about W1.3.')
    })

    it('⚑ W4.187 · a piece named by its label alone earlier in the turn still gets its title when it first has one', () => {
      const soFar = aTurnThatHasSaidNothing()
      const untitled = (): WhereTheSenderStands => ({
        ...PAM_GAVE_W1_3(),
        about: { label: 'W1.3', title: null },
      })
      const titledNow = (): WhereTheSenderStands => ({
        ...PAM_GAVE_W1_3(),
        about: { label: 'W1.3', title: 'The clock page' },
      })
      messageNamingItsSender('one', PAM, untitled, undefined, soFar)
      expect(messageNamingItsSender('two', PAM, titledNow, undefined, soFar)).toContain(
        'This message is about W1.3 · The clock page.',
      )
    })

    it('⛔ `null` is THE APP — 607 — and the words come back the same object’s worth of text', () => {
      // ⚠️ **The title said *`null` is a person* until 607**, and the value did not move: what
      // moved is which caller reaches it. ⛔ `originOf` answers this only for `THE_APP_ITSELF`
      // now, whose own sentences already name the conversation they are about; the person has
      // `THE_PERSON_AT_A_WINDOW` and the test one block down.
      expect(messageNamingItsSender('just my words', null)).toBe('just my words')
      expect(messageNamingItsSender('', null)).toBe('')
    })

    it('⚑ 607 · and the person’s arm is the line alone in front of their own words', () => {
      // ⚑ **611 · the direction line is the second paragraph** (HO-088 §4.1) — see
      // `theDirectionLine`. ⛔ The sender line is still FIRST and still alone on its line.
      expect(messageNamingItsSender('just my words', THE_PERSON_AT_A_WINDOW)).toBe(
        `${A_PERSON_SENT_IT}\n\n${theDirectionLine('a person')}\n\njust my words`,
      )
      // ⛔ **§4.3's shape, matched rather than reinvented** — a blank message is the line alone,
      // with no empty first line, exactly as the agent arm has done since `414`.
      expect(messageNamingItsSender('', THE_PERSON_AT_A_WINDOW)).toBe(
        `${A_PERSON_SENT_IT}\n\n${theDirectionLine('a person')}`,
      )
      expect(messageNamingItsSender('   ', THE_PERSON_AT_A_WINDOW)).toBe(
        `${A_PERSON_SENT_IT}\n\n${theDirectionLine('a person')}`,
      )
      expect(messageNamingItsSender('', THE_PERSON_AT_A_WINDOW).startsWith('\n')).toBe(false)
    })

    it('⚑ no binding: no name and no relationship claim, the session in its place — never the word null', () => {
      const line = messageNamingItsSender(
        'hello',
        { who: 'a-caller-with-an-id', caller: 'sess_9', profile: null, aPersonIsBehindIt: false },
        // ⚑ D-016 · commit 7 · R3 — and no piece names it, so its id is its address.
        () => ({
          name: null,
          handsYou: null,
          openWorkItGaveYou: [],
          gaveYouWorkThatIsClosed: false,
          named: null,
          about: null,
        }),
      )
      // ⛔ **Not *"another agent"***: with no profile this app cannot say the caller IS one.
      expect(line).toBe(`Sent by \`sess_9\`.\n\n${theDirectionLine('`sess_9`', 'caller')}\n\nhello`)
      expect(line).not.toContain('null')
    })

    it('⛔ a blank message is the line alone, with no empty first line', () => {
      const line = messageNamingItsSender(
        '',
        { who: 'a-caller-with-an-id', caller: 'sess_9', profile: 'pm', aPersonIsBehindIt: false },
        PAM_GAVE_W1_3,
      )
      // ⚑ D-016 · commit 7 · R3 — the direction line addresses Pam by the piece she owns.
      expect(line).toBe(
        // ⚑ W4.187 · the direction line names Pam alone: the sender line named her in full.
        `Sent by Pam (pm), who gave you W1.3.\n\n${theDirectionLine('Pam, the owner of W1 · The site', 'caller')}`,
      )
      expect(line.startsWith('\n')).toBe(false)
      expect(
        messageNamingItsSender(
          '   ',
          { who: 'a-caller-with-an-id', caller: 'sess_9', profile: 'pm', aPersonIsBehindIt: false },
          PAM_GAVE_W1_3,
        ),
      ).toBe(line)
    })

    it('⚠️ composed with 412’s line, the frame is first and the instruction is last', () => {
      // ⚑ D-016 · the instruction names the piece by its label.
      const composed = messageNamingThePiece(
        messageNamingItsSender(
          'do it',
          { who: 'a-caller-with-an-id', caller: 'sess_9', profile: 'pm', aPersonIsBehindIt: false },
          PAM_GAVE_W1_3,
        ),
        { label: 'W1.3', inputs: [] },
      )
      const lines = composed.split('\n').filter((one) => one !== '')
      expect(lines[0]?.startsWith('Sent by Pam (pm)')).toBe(true)
      // ⚑ The last line is the piece's line whole, as `messageNamingThePiece` composes it alone.
      expect(lines.at(-1)).toBe(messageNamingThePiece('', { label: 'W1.3', inputs: [] }))
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · what it deliberately does not say
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · no invented actor', () => {
    it('⚑ D-011 · the AGENT is named by the name a person gave it — and never by its role', async () => {
      // 🔴 **Two halves, because the plant alone would be a control off the path.** ⛔
      // `identityOf` SELECTs one column (three until D-016 took the project, then the rotation) and
      // `display_name` is not it, so no edit to
      // the composer could leak the planted name today — `put-the-hazard-on-the-path-the-code-
      // walks`, failed honestly. ⚑ **So the first half pins the READER**: the day somebody widens
      // that SELECT is the day the plant below becomes reachable, and this is the assertion that
      // fires on the same commit.
      const reader = codeOnly(readFileSync(join(mainRoot, '../main/db/session-store.ts'), 'utf8'))
      // ⚑ **D-016 · the reader is the identity's own row** — `agent_profile` is no longer joined, so
      // the one column is pinned whole, up to the `FROM`: a second column breaks the match.
      expect(reader).toMatch(
        /SELECT identity\.slug AS profile_slug\s+FROM provider_session s\s+JOIN agent_identity identity ON identity\.id = s\.agent_identity_id\s+WHERE s\.id = \?/,
      )
      expect(reader).not.toContain('identity.display_name AS profile_display_name')
      // ⚠️ **And the plant is still worth making**, as the belt: without it, a test that only drove
      // the product would pass whatever the line did with a name.
      // ⚑ **D-016 · the plant goes in BEFORE the give**, because the give's brief is the words the
      // frame is in front of — and the name is planted alone: `role` went with D-016's one
      // migration, so the word somebody would reach for to say what kind of thing sent it has no
      // column left to be read from.
      const pmOnly = await aPm()
      db.prepare('UPDATE agent_identity SET display_name = ?').run('Alex Morgan')
      const made = await theGive(pmOnly, 'after the planting')
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const handed = providerHeard(made.worker)[0] ?? ''
      expect(handed).toContain(theFrameFor(made))
      // 🔴 **D-011 reversed this half** (proposal §8): the sender is named — *"Sent by Sam
      // (web-pm)"* — and an agent's name is the one a person gave its identity. ⛔ It is still no
      // invented actor: the name is the AGENT's, next to its profile, never a claim a person wrote.
      expect(handed).toContain(`Sent by Alex Morgan (${made.pmProfile}), `)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · one derivation, two destinations
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the row and the turn cannot disagree', () => {
    it('🔴 the piece row’s `giver` is the conversation in the frame, and its identity the profile', async () => {
      // ⛔ **`379` computed this pair inline for the ledger; `414` needs it for the provider.**
      // Two spellings of *who is asking* are free to disagree the day either changes — 149's
      // shape — and the disagreement would put one conversation on a board row and a different
      // one in the words a model reads. ⚑ **D-016 · the row keeps the conversation only** (`giver`,
      // from `work_given.givenBy`); the profile in the frame is that conversation's identity.
      const made = await workWasGiven('one derivation')
      const row = store.piecesOwnedBy(made.worker).at(-1)
      expect(row?.giver).toBe(made.pm)
      expect(store.identityOf(String(row?.giver))?.profileSlug).toBe(made.pmProfile)
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      // ⚑ **D-011** — the profile in brackets, and the address in the direction line: ⚑ D-016 ·
      // commit 7 · R3 — the piece the row's giver owns, where it was the giver's id.
      const heard = providerHeard(made.worker)[0] ?? ''
      expect(heard).toContain(`(${made.pmProfile}), who is giving you ${String(row?.label)}`)
      expect(heard).toContain(answering(String(row?.giver), made.pmProfile))
    })

    // ⛔ **D-016 · *the row is built from `originOf`* went with the row's profile.** It pinned
    // `workBeingAssigned` writing `assignedByProfile` from the one `originOf(by)` the frame reads;
    // a piece's row carries the giver's conversation and no profile, so there is no second reading
    // of the identity left to share, and the method it read is gone with the task it assigned.

    it('⛔ and the frame does NOT depend on a task existing — 412 F1 is with the PO', () => {
      // ⚠️ **Every agent-to-agent message becomes a task today**, and `412` F1 proposes that some
      // of them stop. ⛔ An origin derived from *"is this work"* would go dark for every message
      // the day that lands. ⚑ Asserted where the two readings DIVERGE, which is the only place a
      // coupling shows: the composer is handed an origin with no task at all.
      const composed = messageNamingThePiece(
        messageNamingItsSender(
          'a question, not work',
          { who: 'a-caller-with-an-id', caller: 'sess_9', profile: 'pm', aPersonIsBehindIt: false },
          // ⚑ D-016 · commit 7 · R3 — a sender holding no piece either, so its id is its address.
          () => ({
            name: 'Pam',
            handsYou: null,
            openWorkItGaveYou: [],
            gaveYouWorkThatIsClosed: false,
            named: null,
            about: null,
          }),
        ),
        null,
      )
      expect(composed).toBe(
        `Sent by Pam (pm), another agent; it gave you no work.\n\n${theDirectionLine('Pam (pm), conversation `sess_9`', 'caller')}\n\na question, not work`,
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the doors — derived from the call sites, with a control that plants TWO
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · every door asks who is asking', () => {
    it('⛔ the go-ahead reaches the provider as the app’s own sentence, with nothing in front', async () => {
      const planning = await host.createSession(
        {
          provider: 'claude',
          profileId: 'planner',
          approvalMode: 'ask',
          cwd: root,
          planMode: true,
        },
        window,
      )
      await host.endPlanMode(planning.sessionId, window, 'Go ahead with this plan.')
      await waitFor(
        () => providerHeard(planning.sessionId).some((said) => said.includes('Go ahead')),
        'the go-ahead to reach the provider',
      )
      expect(
        providerHeard(planning.sessionId).some((said) => said === 'Go ahead with this plan.'),
      ).toBe(true)
      // ⚠️ **A window alone could not tell a frame from no frame here** (standing rule 3), and
      // there is no product path that drives this door as an agent — `ipc.ts` is its only caller
      // and a spawned conversation is never in plan mode. ⛔ So the rule is carried by the
      // source: this door composes nothing, deliberately.
      expect(hostSource()).not.toContain('messageNamingItsSender(text,')
    })

    it('⚑ the interrupting door asks too — measured where the two readings DIVERGE', async () => {
      const made = await aPmAndItsWorker('the work this dispatch is about', 'auto')
      const asThePm: Caller = { ownerId: agentCallerId(made.pm) }
      await host.sendInterrupting(made.worker, 'stop and do this instead', asThePm)
      await waitFor(
        () => providerHeard(made.worker).some((said) => said.includes('stop and do this')),
        'the interrupting turn to reach the provider',
      )
      const cut = providerHeard(made.worker).find((said) => said.includes('stop and do this')) ?? ''
      // ⚑ D-011 · an interrupt hands over no work — ⚑ D-016: and this PM gave the piece it follows.
      expect(cut.split('\n')[0]).toBe(theSenderLineFor(made, true, 'gave-it'))

      // ⚑ And the same door, one fact over: a WINDOW's interrupt carries the PERSON's line and
      // never the agent frame. ⛔ **607 corrected this half** — it asserted whole-string equality
      // with the bare words until `HO-088` §4 — and the assertion is still whole-string, still one
      // fact over, and now names which of the two sentences this door composed.
      host.claimSession(made.worker, window)
      await host.sendInterrupting(made.worker, 'and now from a person', window)
      await waitFor(
        () => providerHeard(made.worker).some((said) => said.includes('from a person')),
        'the person’s interrupt to reach the provider',
      )
      const theirs =
        providerHeard(made.worker).find((said) => said.includes('and now from a person')) ?? ''
      expect(theirs).toBe(messageNamingItsSender('and now from a person', THE_PERSON_AT_A_WINDOW))
      expect(theirs).not.toContain(theFrameFor(made))
    })

    it('🔴 a caller that is NEITHER a window nor an agent is framed, not credited to a person', async () => {
      // ⛔ **The whole reason `originOf` asks two POSITIVE questions.** `THE_APP_ITSELF`'s own
      // docblock names the caller this app does not have yet — *"tomorrow the MCP tool a PM would
      // spawn agents through … gets its own prefix from whatever registers it"* — and a
      // derivation shaped *"an agent, otherwise nobody"* would hand that caller's words to a
      // model with no frame at all. ⚑ Planted as the id such a transport would mint.
      // ⚑ D-016 · the brief's turn is let end (`auto`), so `ship it` is the SECOND turn heard.
      const made = await aPmAndItsWorker('the work this dispatch is about', 'auto')
      const tomorrow = new RecordingSink('mcp:tool-7')
      host.claimSession(made.worker, tomorrow)
      await host.send(made.worker, 'ship it', tomorrow)
      await waitFor(() => providerHeard(made.worker).length > 1, 'the provider to answer')
      const handed = providerHeard(made.worker)[1] ?? ''
      expect(handed.split('\n')[0]).toBe('Sent by `mcp:tool-7`.')
      // ⚠️ **And no invented identity beside it**: the ledger holds no binding for a caller that
      // is not a conversation, so the clause is absent rather than `null`.
      expect(handed).not.toContain('profile')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §8 · the address the frame hands over, and what it is worth
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§8 · the frame names an address, and the address is inert', () => {
    it('⛔ the frame can only ever name a conversation the receiver already had an id for', async () => {
      // 🔴 **Measured rather than assumed, and it refuted the finding I wrote first.**
      // `message_agent`'s own gate admits only what the caller may reach, so the conversation that
      // can put a frame in front of a receiver is one the receiver's own card already names — for a
      // spawned child, its parent: the id `list_agents` returns as `parent`. ⚑ **D-016 · commit 7 ·
      // R3 — the frame and the launch line name it by the piece it owns**, where both spelled that
      // id, and the receiver's own door reads that piece's label as the same id (R1).
      //
      // ⚠️ **`431` moved that gate and this comment named the old one.** It read *"`host.agentCard(
      // agent, by, me) === null` … the only conversation that can put a frame in front of a
      // receiver is one that OWNS or COMMANDS it"*, and the reader is `withinMessagingReach` now:
      // an identity a person granted a global reach can frame a conversation it did not start. ⛔
      // **What this test measures is unchanged** — the caller below holds the ruled default, and
      // the two refusals it compares are still one answer.
      const made = await workWasGiven('work with a frame on it')
      await waitFor(() => providerHeard(made.worker).length > 0, 'the provider to answer')
      const framed = providerHeard(made.worker)[0] ?? ''
      expect(framed).toContain(answering(made.pm, made.pmProfile))

      // ⚑ **The same id, from the reader the child already has — and the address the frame hands
      // over is read by the child's own door as that id.** If these ever differ, the frame is
      // telling a model something the product would not.
      const own = await callOn(agentToolsFor(host, made.worker), 'get_agent_status', {
        agent: made.worker,
      })
      expect((own.agent as { parent: string }).parent).toBe(made.pm)
      const address = store.workThatNames(made.pm)?.label ?? ''
      expect(
        host.theConversationAddressed(
          address,
          { ownerId: agentCallerId(made.worker) },
          made.worker,
          'messaging',
        ),
      ).toBe(made.pm)

      // 🔴 **The refusal, compared on the field that VARIES.** ⛔ `outcome` is the constant
      // `'refused'` on every rail `refuseTool` builds, so comparing it would be satisfied by any
      // two refusals whatever — `a-comparison-tested-where-both-sides-agree`. The field that says
      // which rule stopped the call is `rail`.
      //
      // ⚑ **D-017 · R12 — the property moved, and the id is still inert.** It was that a real id the
      // caller may not command is INDISTINGUISHABLE from one that was never minted; `no-such-agent`
      // is now said only about an id no conversation has (`05` rule 6), and a real one out of reach
      // gets the reach rail `message_agent` meets. ⛔ **What the frame hands over is unchanged**: an
      // id the receiver's own card already named, which it cannot spend on anything its reach does
      // not already admit — and the refusal volunteers nothing about that conversation.
      const workerTools = agentToolsFor(host, made.worker)
      // 🔴 **549 · the ruled default is `any` now** (HO-058 §1). ⛔ This section is about whether an
      // ID can be SPELLED into something its holder may not do, and the ruled default admits every
      // conversation in the app to a MESSAGE — a worker reaching UP is a real change `549` made,
      // measured where it belongs: `two-withdrawals-open-what-was-scoped.test.ts` §4. ⚑ **D-016 ·
      // so it is asked as WORK**, and work names no conversation at all: `give_work` takes a
      // PROFILE and reaches the giver's OWN conversation with it — so the worker giving work as its
      // parent's profile starts one below itself, and never reaches the parent whatever id the frame
      // handed over.
      const upward = await callOn(workerTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: made.pmProfile,
        title: 'Up the tree',
        brief: 'up the tree',
      })
      expect(upward.outcome, JSON.stringify(upward)).toBe('ok')
      expect(upward.agent).not.toBe(made.pm)
      expect(store.parentOf(upward.agent as string)).toBe(made.worker)
      // ⚑ **And an id that names nothing is still said to name nothing.**
      const invented = await callOn(workerTools, 'message_agent', {
        kind: 'note',
        agent: 'sess_never-minted',
        text: 'nowhere',
      })
      expect(invented.rail, JSON.stringify(invented)).toBe('no-such-agent')

      // ⚑ **The same call one fact over** (standing rule 3) — the PARENT giving as its child's
      // profile reaches that very child, which is the conversation it started. ⚑ D-016: no reply
      // first — the one-open-task rail it was answered around is gone, and the busy child takes it.
      const downward = await callOn(made.pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: store.identityOf(made.worker)?.profileSlug,
        title: 'Down the tree',
        brief: 'down the tree',
      })
      expect(downward.outcome, JSON.stringify(downward)).toBe('ok')
      expect(downward.agent).toBe(made.worker)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the turns BroBot composed, which name their own origin already
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · no second naming where the words are BroBot’s', () => {
    it('⚠️ a routed question is BroBot’s sentence ABOUT a child, so it gets no frame', async () => {
      // ⛔ **This is the difference `carriedFor` marks**, and it is why the provider-side fact is
      // its own field rather than a reading of `relayedFrom`. Framing this as *sent by the child*
      // would be false: the child did not write these words, BroBot did.
      const made = await workWasGiven('work with a question in it')
      const raised = latestHandle().simulateUserInput('which branch?', ['main'], false)
      await unblockUntil(
        made.pm,
        () => providerHeard(made.pm).some((said) => said.includes(raised.id)),
        'the question to reach the parent’s provider',
      )
      const question = providerHeard(made.pm).find((said) => said.includes(raised.id)) ?? ''
      // ⚑ `questionText` leads with the asking conversation — ⚑ D-016 · commit 7 · R3: by its name
      // and the piece it owns, and that piece's label is the address it quotes, where it was the id
      // twice — so the origin is IN the words.
      expect(question).toContain(`${host.nameByItsWork(made.worker)} is waiting on an answer`)
      expect(question).toContain(`with asked_by ${host.addressOf(made.worker)}.`)
      expect(question).not.toContain('Sent by `')
    })
  })
})
