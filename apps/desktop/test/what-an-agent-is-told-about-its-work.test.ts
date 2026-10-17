import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  TOOL_NAMES,
  TOOL_REFUSALS,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { composeProfileBundle, thisConversationSpans } from '../src/main/runtime/factory-text'
import { messageNamingThePiece } from '../src/main/runtime/reply-rails'
import { SPAWN_RAILS, refuse } from '../src/main/runtime/spawn-rails'
import { MESSAGE_RAILS, refuseMessage } from '../src/main/runtime/message-rails'
import { REPLY_RAILS, refuseReply } from '../src/main/runtime/reply-rails'
import { QUESTION_RAILS, refuseQuestion } from '../src/main/runtime/question-rails'
import { INTERRUPT_RAILS, refuseInterrupt } from '../src/main/runtime/interrupt-rails'
import { RESOURCE_RAILS, refuseResource } from '../src/main/resources/resources'
import { MODEL_RAILS, refuseModel } from '../src/main/runtime/model-rails'
import { RAIL_PERMANENCES } from '../src/shared/refusals'
import {
  WORK_SEARCH_RAILS,
  WORK_SEARCH_REFUSAL_WORDS,
  workSearchRefusal,
} from '../src/shared/work-search-words'
import { DEFAULT_CAPABILITIES, type ProfileCapabilities } from '../src/shared/capabilities'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'

/**
 * 🔴 **412 · what an agent is told about its work** — HO-020 §5 items 1 and 2, plus `405` F8.
 *
 * ## ⛔ The defect, and why a live run is not the instrument for it
 *
 * `410` F1, measured on both providers: **a worker is never told the task id it must quote to
 * finish.** ⚠️ **It is INTERMITTENT** — *"both second runs replied first time"* — so a passing live
 * run proves almost nothing about it, and a failing one proves only that this model, this once, did
 * not think to call `list_tasks`. ⛔ **The guard therefore has to be static and it has to be on the
 * path the code walks**: the string a provider is actually handed, read off a real host with a real
 * store, for both branches the send takes.
 *
 * ⚑ **The round trip is the assertion that matters.** §1.2 takes the id back OUT of the provider's
 * own text with a regex — the way a model reads it — and hands that string to `reply_to_parent`.
 * A rendering that differs from what the tool validates would pass a `toContain` and fail here,
 * which is the *"second defect waiting"* the brief names.
 *
 * ## ⚠️ §2 is the other half of HO-020, and it is a rule rather than a mechanism
 *
 * > **"One piece of work became five tasks."** ⛔ *"The correct response to a stall is to
 * > investigate or interrupt — never to assign."*
 *
 * ⚑ Rendered from the grant, so the doors it names are the doors this identity actually has.
 *
 * ## ⛔ §3 is `405` F8, and the brief's version of it was stale in both halves
 *
 * F8 reported the collision census covering THREE of seven lists with *"the other four
 * unchecked"*. ⚠️ **There were two censuses, not one** — `the-rails-a-message-passes.test.ts` §6
 * over three and `a-reply-and-its-absence.test.ts` §7 over five — so the real gap was
 * `QUESTION_RAILS` and `INTERRUPT_RAILS`. ⛔ **Neither is derived**, which is the finding worth more
 * than the two: both enumerate by hand, so the eighth vocabulary joins the app unchecked no matter
 * how many lists are written out today. §3 derives the list from the modules.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

/**
 * ⛔ **The line `messageNamingThePiece` composes, quoted once and compared everywhere.** ⚠️ It is the
 * PREFIX and not the whole sentence, because the label is the part that changes — and a test that
 * rebuilt the whole line from the function under test would be asserting that a function equals
 * itself (`a-fixture-built-with-the-helper-under-test-proves-nothing`). ⚑ **D-016** — a piece is
 * named by its label (`W1.2`), which every door that takes a piece takes.
 */
const FINISHING_LINE = 'Finish it by calling reply_to_parent with piece '

/** The shape of a piece's label, as `pieceCalled` writes it — and as a model reading a turn sees it. */
const A_LABEL = /W[1-9][0-9]*(?:\.[1-9][0-9]*)+/

async function waitFor(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** `373`'s double; its registry is shared so every launch's toolset can be reached. */
class ToolWatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('412 · what an agent is told about its work', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let hosts: RuntimeHost[]
  let handed: AgentToolset[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  let claimed: Set<string>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
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
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-412-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-412-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
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
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /**
   * 🔴 **What the PROVIDER was handed** — the composed string, read off the double's own echo.
   *
   * ⚠️ **`FakeSessionHandle.send` republishes its argument as `echo: <text>`**, which is the only
   * place in this app where the string that crossed the adapter boundary is observable from the
   * ledger. ⛔ The alternative — reading `user_turn` — is the string this dispatch must prove is
   * DIFFERENT, so it is the one instrument that cannot be used here.
   */
  const saidToProvider = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      // The message, without the block this app adds at its end.
      .map((text) => withoutWhatThisAppAdds(text.slice('echo: '.length)))

  /** What the LEDGER kept as the turn — deliberately a different string (216, and now 412). */
  const turnsOn = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'user_turn')
      .map((event) => (event as { text: string }).text)

  /**
   * A PM in a window with one child of its own, started through the real door (`379`'s helper).
   *
   * ⚑ **D-016 · the give IS the work** — `give_work` starts the child, and `brief` is the child's
   * first turn: the turn this file reads the provider's string off.
   */
  const aPmAndItsWorker = async (
    brief = 'the work this dispatch is about',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    given: Record<string, unknown>
  }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    // ⚑ **D-014 · no grant to write first**: any agent may give work to any identity that exists,
    // with no fan-out cap.
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      pm,
      worker: given.agent as string,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      given,
    }
  }

  const cardOn = async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'turn'),
      'the turn to reach its own terminal',
    )
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the piece's label reaches the model, in the form the tool takes
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-016 · re-aimed from the task id to the piece's label.** ⛔ A `work` message minted a
   * `task_…` id and its turn named it; the give now opens a piece whose brief IS the turn, and the
   * line names its label, which `reply_to_parent` takes. The subject — the provider is told what to
   * quote, and the ledger keeps the giver's words alone — is unchanged.
   */
  describe('§1 · the turn a worker’s provider receives', () => {
    it('🔴 names the piece, and the LEDGER keeps the giver’s words alone', async () => {
      const { worker, given } = await aPmAndItsWorker('read the brief and report')
      expect(given.delivery, 'the child was new, so this is the straight-out branch').toBe('sent')

      const [piece] = store.piecesOwnedBy(worker)
      expect(piece, 'no piece was recorded for that give').toBeDefined()
      expect(piece?.label).toBe(given.label)

      // ⛔ **The provider's string**, and the label in it is the row's own.
      const [handedOver] = saidToProvider(worker)
      expect(handedOver).toContain('read the brief and report')
      expect(handedOver).toContain(`${FINISHING_LINE}${String(piece?.label)}`)

      // 🔴 **…and the LEDGER kept what the giver actually wrote** (216's rule, one subject over).
      // ⚠️ A fix that composed the line into `text` would pass the assertion above and fail this
      // one — which is the whole reason both are here.
      expect(turnsOn(worker)).toEqual(['read the brief and report'])
      expect(turnsOn(worker)[0]).not.toContain('reply_to_parent')
      // ⚑ **And the row a person reads is the giver's words too**, not the composition.
      expect(piece?.brief).toBe('read the brief and report')
    })

    it('⛔ …and the label a model would COPY out of that turn is the one the tool accepts', async () => {
      const { worker, workerTools } = await aPmAndItsWorker('do the thing')

      // ⚠️ **Read the way a model reads it** — out of the provider's own text, by the shape of the
      // label and nothing else. ⛔ Taking it from `store.piecesOwnedBy` instead would be the fixture
      // and the subject deriving the value the same way, which proves the two agree and nothing else.
      const copied = A_LABEL.exec(saidToProvider(worker)[0] ?? '')?.[0]
      expect(copied, 'no label of the documented shape was in the turn').toBeDefined()

      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece: copied,
        outcome: 'done',
        summary: 'the thing is done',
      })
      // 🔴 **The round trip.** A rendering the tool does not accept fails HERE and nowhere else —
      // a trailing bracket, a `#3` in front, a quote around it, a label spelled from the number.
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      expect(replied.label).toBe(copied)
      expect(store.piecesOwnedBy(worker)[0]?.state).toBe('answered')
    })

    it('⚑ a child that was BUSY is told at the flush, which is where its turn is composed', async () => {
      const { worker, pmTools } = await aPmAndItsWorker('first')

      // The brief starts a turn and the FakeRuntime parks it on a card, so the child is busy for
      // the second. ⚑ **D-016** — a second give from the same giver reaches the SAME conversation,
      // and the one-open-task rail that made `415` finish the first piece here is gone.
      await cardOn(worker)
      const held = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The second',
        brief: 'second',
      })
      expect(held.agent).toBe(worker)
      expect(held.delivery, JSON.stringify(held)).toBe('held')

      // ⛔ **Two pieces, and the held one is the second.** `derivePieces` opens a brief that was
      // held at `waiting`, and the one that went straight out is `working`.
      const pieces = store.piecesOwnedBy(worker)
      expect(pieces.map((one) => one.state)).toEqual(['working', 'waiting'])

      await letTheTurnFinish(worker)
      await waitFor(() => saidToProvider(worker).length === 2, 'the held brief to be flushed')

      const [first, second] = saidToProvider(worker)
      expect(first).toContain(`${FINISHING_LINE}${String(pieces[0]?.label)}`)
      // 🔴 **The half that is invisible in a live run that happens to find its child idle.** A piece
      // known only at queue time would reach every idle child and no busy one — the fix working
      // intermittently, which is exactly what `410` F1 looks like.
      expect(second).toContain(`${FINISHING_LINE}${String(pieces[1]?.label)}`)
      expect(pieces[0]?.label).not.toBe(pieces[1]?.label)
    })

    it('⛔ a turn that is NOT a piece grows no FINISHING line — the app’s own, and a person’s', async () => {
      const { pm, worker, workerTools, given } = await aPmAndItsWorker('go')
      await cardOn(worker)

      // 1 · The APP's own delivery of a reply into the parent. ⚠️ **It NAMES a piece and must not
      // grow the finishing line**: `replyText` renders the label because a parent is reading it, so
      // an assertion on the label alone would pass here for the wrong reason. The assertion is on
      // the LINE. ⚑ Answered from inside the brief's turn, so no stall notice reaches the parent
      // first.
      await callOn(workerTools, 'reply_to_parent', {
        piece: given.piece,
        outcome: 'done',
        summary: 'finished it',
      })
      await waitFor(() => saidToProvider(pm).length > 0, 'the reply to reach the parent')
      const intoTheParent = saidToProvider(pm).at(-1) ?? ''
      expect(intoTheParent).toContain(String(given.label))
      expect(intoTheParent).not.toContain(FINISHING_LINE)
      // ⚑ …and nothing was given to the parent by the app delivering that reply.
      expect(store.piecesOwnedBy(pm)).toEqual([])

      // 2 · A PERSON typing into the child, once the brief's turn is over. A window mints nothing.
      await letTheTurnFinish(worker)
      await host.send(worker, 'what are you doing?', window)
      // ⚠️ **The echo is published from the double's own turn, which `send` does not await** — the
      // adapter boundary is crossed synchronously and the row arrives on the next tick.
      await waitFor(
        () => saidToProvider(worker).length === 2,
        'the person’s message to be handed over',
      )
      // 🔴 **607 · the SENDER's line arrived and the PIECE line still did not**, which is the whole
      // of what this test is about: `412`'s finishing line is composed only for a give's brief, and
      // a window gives nothing. ⛔ The assertion is still whole-string, so a piece line appearing
      // here would still be caught.
      expect(saidToProvider(worker)[1]).toBe(
        messageNamingItsSender('what are you doing?', THE_PERSON_AT_A_WINDOW),
      )
      expect(saidToProvider(worker)[1]).not.toContain(FINISHING_LINE)
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)
    })

    it('⚠️ the composer itself: no piece, no line — and an empty message is still a line', () => {
      // ⛔ **The unit, for the two branches a driven test cannot reach cheaply.** `216`'s own
      // no-words case: a message with nothing in it must not compose a leading blank line.
      expect(messageNamingThePiece('words', null)).toBe('words')
      expect(messageNamingThePiece('', null)).toBe('')
      const composed = messageNamingThePiece('', { label: 'W1.2', inputs: [] })
      expect(composed.startsWith('This is piece W1.2.')).toBe(true)
      expect(composed).toContain(`${FINISHING_LINE}W1.2`)
      expect(composed).not.toContain('\n')
      // ⚑ **The label is not the last token**, because every neighbour of a copied token is a
      // character a model may copy with it.
      expect(composed.trimEnd().endsWith('W1.2')).toBe(false)
    })

    it('⛔ the line carries NO address, in any spelling — HO-015 §1.3, asserted by name', async () => {
      // 🔴 **The rule the tool's own addressing rail enforces, pinned in the PROSE too**: *"the
      // model names which piece it is finishing, never who to send it to."* ⛔ `371` shipped a
      // `parentSessionId` that was silently taken and replaced; a line naming the parent would be
      // that defect arriving as words instead of as an argument, and no rail can refuse a sentence.
      const { pm, worker } = await aPmAndItsWorker('go')
      const line = (saidToProvider(worker)[0] ?? '').split('\n').at(-1) ?? ''

      expect(line).toContain(FINISHING_LINE)
      expect(line).not.toContain(pm)
      expect(line).not.toContain('sess_')
      // ⚑ …and none of the words an address would have to be made of. ⚠️ **The tools' own NAMES are
      // taken out first**, because `reply_to_parent` and `ask_parent` carry the only legitimate
      // `parent`s there are — so what this asserts is the sharper thing: every mention of a parent
      // in this line is the name of a verb, and there is no other one.
      //
      // 🔴 **`437` added the second verb and this strip with it, and the pair below is what stops
      // that being a loosening.** ⛔ A strip with no control is a hole: both names are asserted
      // PRESENT, so the exemption can only ever cover words that are really there.
      const withoutTheVerbs = line
        .replace(/reply_to_parent/g, '<the verb>')
        .replace(/ask_parent/g, '<the other verb>')
        .toLowerCase()
      for (const addressed of ['parent', 'send it to', 'reply to the', 'conversation that']) {
        expect(withoutTheVerbs, addressed).not.toContain(addressed)
      }
      // ⛔ …and the controls that keep THAT from being vacuous: both verbs really were in the line.
      expect(line).toContain('reply_to_parent')
      expect(line).toContain('ask_question')
      // ⚠️ **The control**: the label it DOES carry is there, so the negatives above are not passing
      // because the line is empty.
      expect(A_LABEL.test(line)).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a parent is told to do when work it gave out has stalled
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the tools the text names, all published', () => {
    // The profile's file, which no grant changes; {@link launchedWith} adds this conversation's
    // own text, which the census reads too.
    const context = (): string => composeProfileBundle({ configured: null })

    /**
     * ⚑ **D-024 · R1 — what one launch is told: the profile's file, then this conversation's own
     * text** (`thisConversationSpans`: `## This conversation` and `## What you have been granted`,
     * sent with the launch and written into no file). ⛔ The fields are the ones this describe fixed
     * before the move — a conversation a person opened owns its root, and is told its label (D-016).
     */
    const launchedWith = (capabilities: ProfileCapabilities | null): string =>
      `${context()}${
        thisConversationSpans({
          profileSlug: 'somebody',
          cwd: '/w',
          startedBy: null,
          depth: 0,
          spawningEnabled: true,
          capabilities,
          root: 'W1',
          // ⚑ No other conversation of the profile, which renders no line at all.
          others: { shown: [], more: 0 },
        }).text
      }`

    // The stall rule and its doors are the ask-and-wait skill's now; what stays here is that every
    // tool the core and this conversation's text name is a tool this app publishes.
    it('⛔ every snake_case name in the whole composed bundle is a tool this app publishes', () => {
      // 🔴 **`370`'s eight false sentences, caught by shape rather than by reading.** A rendered
      // instruction that names `list_questions` after a rename is the same defect as one that names
      // a capability after a narrowing.
      const named = (said: string): string[] => [
        ...new Set(Array.from(said.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g), (found) => found[0])),
      ]
      const published: readonly string[] = TOOL_NAMES
      const seen = new Set<string>()
      // ⚑ **D-014 · every agent gets one bundle**, so one composition is every agent's.
      // ⛔ **D-024 · R1 — and the bundle is two compositions now**, so the sweep reads both: the
      // dynamic layer still names a tool (`update_work`, in the root line), and a sweep of the file
      // alone would leave it uncounted.
      for (const name of named(launchedWith(DEFAULT_CAPABILITIES))) {
        expect(published, `the bundle names ${name}, which no tool is called`).toContain(name)
        seen.add(name)
      }
      // ⚑ **Non-vacuity**: the sweep found exactly the tools the core and this text name.
      expect([...seen].sort()).toEqual(['ask_question', 'request_action', 'update_work'])

      // ⚠️ **The control, planting TWO** (standing rule 12) — a sweep that stopped at the first
      // match per text would pass the loop above while seeing half of what is there.
      const planted = named('use fake_tool_one and then fake_tool_two, twice: fake_tool_one.')
      expect(planted).toEqual(['fake_tool_one', 'fake_tool_two'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · every rail vocabulary in the app, derived from the modules
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · one word, one rule — over a list nobody wrote out', () => {
    /**
     * ⛔ **The complete production vocabulary roster, as VALUES** — each list paired with the shipped
     * function that builds its payload, because `describeRail` and `describeMessageRail` return a
     * string while the others return a payload, and `347`'s own version of this census went green
     * comparing `undefined` to itself. ⚑ Asking the `refuse*` builder is asking what a model is
     * actually handed.
     */
    const VOCABULARIES = [
      {
        name: 'WORK_SEARCH_RAILS',
        module: 'shared/work-search-words.ts',
        rails: WORK_SEARCH_RAILS,
        reason: (rail: string) =>
          workSearchRefusal(
            rail.slice('work-search-'.length) as keyof typeof WORK_SEARCH_REFUSAL_WORDS,
          ).reason,
        permanence: (rail: string) =>
          workSearchRefusal(
            rail.slice('work-search-'.length) as keyof typeof WORK_SEARCH_REFUSAL_WORDS,
          ).permanence,
      },
      {
        name: 'SPAWN_RAILS',
        module: 'runtime/spawn-rails.ts',
        rails: SPAWN_RAILS as readonly string[],
        reason: (rail: string) => refuse(rail as never).reason,
        permanence: (rail: string) => refuse(rail as never).permanence,
      },
      {
        name: 'TOOL_REFUSALS',
        module: 'runtime/agent-tools.ts',
        rails: TOOL_REFUSALS as readonly string[],
        reason: (rail: string) => refuseTool(rail as never).reason,
        permanence: (rail: string) => refuseTool(rail as never).permanence,
      },
      {
        name: 'MESSAGE_RAILS',
        module: 'runtime/message-rails.ts',
        rails: MESSAGE_RAILS as readonly string[],
        reason: (rail: string) => refuseMessage(rail as never).reason,
        permanence: (rail: string) => refuseMessage(rail as never).permanence,
      },
      {
        name: 'REPLY_RAILS',
        module: 'runtime/reply-rails.ts',
        rails: REPLY_RAILS as readonly string[],
        reason: (rail: string) => refuseReply(rail as never).reason,
        permanence: (rail: string) => refuseReply(rail as never).permanence,
      },
      {
        name: 'QUESTION_RAILS',
        module: 'runtime/question-rails.ts',
        rails: QUESTION_RAILS as readonly string[],
        reason: (rail: string) => refuseQuestion(rail as never).reason,
        permanence: (rail: string) => refuseQuestion(rail as never).permanence,
      },
      {
        name: 'INTERRUPT_RAILS',
        module: 'runtime/interrupt-rails.ts',
        rails: INTERRUPT_RAILS as readonly string[],
        reason: (rail: string) => refuseInterrupt(rail as never).reason,
        permanence: (rail: string) => refuseInterrupt(rail as never).permanence,
      },
      // ⚑ **D-017** — `END_RAILS` (`runtime/end-rails.ts`) went with `end_agent`.
      // ⚑ **D-016** — `DOCUMENT_RAILS` (`documents/canonical-document.ts`) went with the document
      // registry; what a reply hands in is a RESOURCE, and its rails are `RESOURCE_RAILS`.
      {
        name: 'RESOURCE_RAILS',
        module: 'resources/resources.ts',
        rails: RESOURCE_RAILS as readonly string[],
        reason: (rail: string) => refuseResource(rail as never).reason,
        permanence: (rail: string) => refuseResource(rail as never).permanence,
      },
      // 🔴 **D-042** — the one seam `give_work` and `create_agent` judge an agent's model and effort
      // by (`runtime/model-rails.ts`): a new vocabulary, so it is registered here, and the sweep
      // below is what found it.
      {
        name: 'MODEL_RAILS',
        module: 'runtime/model-rails.ts',
        rails: MODEL_RAILS as readonly string[],
        reason: (rail: string) => refuseModel(rail as never).reason,
        permanence: (rail: string) => refuseModel(rail as never).permanence,
      },
    ] as const

    /**
     * ⛔ **The shared words, as DATA rather than as a comment** (`a-reply-and-its-absence` §7's
     * shape, and the reason it is the better of the two censuses this replaces). ⚠️ Both owners of
     * each are named, so moving a share to a third list is a change to this line rather than a
     * silent pass — and since 419 the MEANING is checked too, not just the ownership.
     */
    const DELIBERATELY_SHARED = [
      {
        rail: 'malformed-request',
        by: ['SPAWN_RAILS', 'TOOL_REFUSALS'],
      },
      /**
       * 🔴 **The SECOND shared word, added at 419, and the loosening is paid for below.**
       *
       * ⛔ **`374`'s rule is *a model must not see one word mean two things*, and sharing this one
       * is how that rule is KEPT rather than broken.** `give_work` (D-016, in `spawn_agent`'s place)
       * and `create_agent` are two doors in front of one switch a person threw; a second spelling would be a second thing to
       * learn about it, and a model that had met one would not recognise the other.
       *
       * ⚠️ **What sharing a name costs is that two tables could come to disagree about what the
       * word MEANS**, and that is the assertion this entry buys: the permanence has to match in
       * every vocabulary that carries the word. ⛔ Without it, a model could learn
       * `until-a-person-changes-it` at one door and `permanent` at the other, which is exactly the
       * *one word, two things* this census exists to refuse.
       */
      {
        rail: 'spawning-disabled',
        by: ['SPAWN_RAILS', 'TOOL_REFUSALS'],
      },
      // ⚑ **D-017** — `496`'s share, `a-person-is-being-asked` in `END_RAILS` and `INTERRUPT_RAILS`,
      // went with `end_agent`: the word is the interrupt door's alone now.
      /**
       * 🔴 **The FOURTH shared word, added at `650`, and it is `496`'s trade paid the same way.**
       *
       * ⛔ **One state of the world: a conversation is reserved and its provider has not arrived.**
       * `interrupt_agent` met it first; `message_agent` met it too, and folded it into
       * `agent-cannot-take-a-message` — *"a person has to put that conversation right"* — about a
       * launch seconds from ready. ⚑ A second spelling of that one fact would be a second thing for
       * a model to learn, so the word is shared and this census is what checks the two tables agree
       * about what it MEANS: `while-this-holds` at both doors.
       *
       * ⚠️ **What made the share honest is that the word now means ONE thing at the interrupt door
       * too** — a reservation a person Closed used to be told it *"has not started yet"*, and since
       * `650` it reads as an ending there. ⛔ The sentence is not shared, for `496`'s reason: each
       * states a fact about its own call, and the uniqueness assertion below keeps it so.
       */
      {
        rail: 'that-conversation-has-not-started',
        by: ['INTERRUPT_RAILS', 'TOOL_REFUSALS'],
      },
      /**
       * ⚑ **D-016 · `give_work`'s `new` asks the grant `create_agent` asks** (R3): one question — may
       * this caller bring an agent into existence — met at two doors, so one word, and the census
       * checks the two tables agree about what it means.
       */
      {
        rail: 'may-not-create-agents',
        by: ['SPAWN_RAILS', 'TOOL_REFUSALS'],
      },
      /**
       * ⚑ **D-016 · a piece the caller spelled that names nothing it may reach** — the reply's door
       * and the doors `TOOL_REFUSALS` prices (`withdraw_task`, `list_tasks`) meet one fact, so one
       * word; each keeps its own sentence, which the uniqueness assertion below holds them to.
       */
      {
        rail: 'no-piece-by-that-name',
        by: ['TOOL_REFUSALS', 'REPLY_RAILS'],
      },
      /**
       * A piece cannot end with the copies passed up of its questions — a conversation holding one
       * is starting, or they could not all be read — met at a take-back, a close and a reply. One
       * fact each, so one word each; each door keeps its own sentence.
       */
      {
        rail: 'a-conversation-with-its-questions-is-starting',
        by: ['TOOL_REFUSALS', 'REPLY_RAILS'],
      },
      {
        rail: 'its-questions-could-not-all-be-read',
        by: ['TOOL_REFUSALS', 'REPLY_RAILS'],
      },
    ] as const

    /**
     * 🔴 **424 · every rail in this app that still promises a retry, as a closed list with its
     * reason.**
     *
     * ⛔ **HO-023 §2.1 is the rule this enforces:** *"`retryable: true` must name something a model
     * can do without destroying anyone's work… either the refusal carries a legitimate remedy, or
     * its permanence is wrong."* ⚑ `422` walked all 21 `while-this-holds` members and found that
     * **12 of them cleared only by destruction or by a door the caller cannot reach**. `424`
     * repriced those twelve; the rails that remained retryable and every later addition are here,
     * each with the act that clears it — performed by the caller, or by nobody at all.
     *
     * ⚠️ **A list, so a rail that becomes retryable has to be ADDED here** — with a sentence saying
     * who clears it. ⛔ That is the whole instrument: the defect `422` measured was not any one
     * word, it was that nothing ever asked the question of the set.
     */
    // ⚑ **D-010 retired the two mailbox words** (`agent-already-has-a-message-waiting` and `703`'s
    // `a-message-you-cannot-withdraw-is-waiting`) with the rule that held one message at a time.
    // ⚑ **D-016** — `agent-already-has-work-open` went with the one-open-task rail; the STALL rule
    // that replaced it, `give_work`'s `its-work-has-stalled`, went too: a give names a stall.
    const STILL_RETRYABLE: readonly (readonly [string, string, string])[] = [
      [
        'SPAWN_RAILS',
        'no-free-worker-at-capacity',
        'a worker becomes free and the caller repeats the same give',
      ],
      [
        'TOOL_REFUSALS',
        'work-record-unavailable',
        'The current work read can become available; retry the same call then.',
      ],
      [
        'QUESTION_RAILS',
        'move-offer-is-held',
        'repeat the offer after the current person request has been recorded',
      ],
      [
        'WORK_SEARCH_RAILS',
        'work-search-unavailable',
        'the read or owned worker becomes available and the caller retries the same query',
      ],
      [
        'WORK_SEARCH_RAILS',
        'work-search-busy',
        'a queued search finishes and the caller retries after a waiting slot is released',
      ],
      [
        'TOOL_REFUSALS',
        'theme-invalid',
        'the caller fixes the printed problems and sends the theme again',
      ],
      ['TOOL_REFUSALS', 'theme-exists', 'the caller saves under a new id, or sends replace: true'],
      ['TOOL_REFUSALS', 'theme-unknown', 'the caller lists the themes and uses an id on that list'],
      [
        'TOOL_REFUSALS',
        'theme-too-large',
        'the caller uses fewer or smaller files and sends the theme again',
      ],
      [
        'TOOL_REFUSALS',
        'it-is-being-archived-or-deleted',
        'the archive or the delete lands by itself, and the same restore_agent call then answers',
      ],
      [
        'SPAWN_RAILS',
        'it-would-wait-on-itself',
        'the work the service waits on through the caller ends, and the same give then answers',
      ],
      [
        'SPAWN_RAILS',
        'its-waits-cannot-all-be-checked',
        'enough of the work the service waits on ends to check the rest, and the same give then answers',
      ],
      [
        'INTERRUPT_RAILS',
        'that-service-is-on-another-callers-piece',
        'the piece the service is on ends, and the same stop then reaches the piece it goes on to',
      ],
      [
        'TOOL_REFUSALS',
        'that-piece-is-still-queued',
        'the piece is handed over to the service, and the same message then reaches it',
      ],
      [
        'TOOL_REFUSALS',
        // 🔴 **429's addition, and it is the TENTH** — the first rail added since `425` made this a
        // biconditional, and it answers both halves in its own commit. ⚑ The clause is unusual on
        // this list and it is the true one: the world does not improve, the flush merely ENDS, and
        // when it does the retry lands on an arm of the same verb that never touches a mailbox.
        'that-work-is-being-sent',
        'the flush in flight ends at the next turn boundary — nobody decides anything',
      ],
      // A piece's ending waits for a conversation holding a copy of its questions to start; one
      // still starting lands or fails within a launch's bound, and the same call then ends it.
      [
        'TOOL_REFUSALS',
        'a-conversation-with-its-questions-is-starting',
        'the start under way lands or fails within its bound — nobody decides anything',
      ],
      [
        'REPLY_RAILS',
        'a-conversation-with-its-questions-is-starting',
        'the start under way lands or fails within its bound — nobody decides anything',
      ],
      // A read of the questions that failed once may pass the next time; the words ask a person
      // when it does not.
      [
        'TOOL_REFUSALS',
        'its-questions-could-not-all-be-read',
        'the caller tries again, and asks a person if the read fails again',
      ],
      [
        'REPLY_RAILS',
        'its-questions-could-not-all-be-read',
        'the caller tries again, and asks a person if the read fails again',
      ],
      [
        'REPLY_RAILS',
        'summary-too-long',
        'the caller sends a shorter summary, with the long form as a workspace artefact',
      ],
      [
        'QUESTION_RAILS',
        'that-answer-cannot-be-sent',
        'the caller answers every part, with a value the request offers',
      ],
      [
        'QUESTION_RAILS',
        'answer-too-long',
        'the caller answers again in fewer words, with the long form in a file it names',
      ],
      [
        'INTERRUPT_RAILS',
        'that-conversation-has-not-started',
        'the launch already in flight settles, either way, without anyone acting',
      ],
      [
        'TOOL_REFUSALS',
        // 🔴 **650's first addition** — the same word and the same clause as the row above, because
        // it is the same fact met at a second door (see `DELIBERATELY_SHARED`).
        'that-conversation-has-not-started',
        'the launch already in flight settles, either way, without anyone acting',
      ],
      [
        'TOOL_REFUSALS',
        // 🔴 **657's addition** — and it replaces `650`'s `agent-started-a-turn-first`, which `657`
        // retired: a lost race is HELD now, so it is not a refusal a caller retries.
        'agent-took-too-long-to-start',
        'the timed-out launch is stopped and its reservation abandoned — nobody decides anything',
      ],
      // ⚑ **D-016** — a second give in the same tick waited on the first one's start, which failed.
      [
        'TOOL_REFUSALS',
        'the-start-it-waited-on-did-not-happen',
        'the start the give waited on settles, either way — nobody decides anything',
      ],
      // ⚑ **663** — a wake names the same id, so it can meet the run it is replacing still stopping.
      [
        'TOOL_REFUSALS',
        'that-conversation-is-still-stopping',
        'the previous run is confirmed stopped, or its late provider is closed — nobody decides anything',
      ],
      // ⚑ **705 · R39** — a wake refused because the machine ran short of descriptors, a process slot
      // or memory (`transientSetupFailureOf`).
      [
        'TOOL_REFUSALS',
        'that-conversation-could-not-be-woken-just-now',
        'something else on the machine lets go of what it ran short of — nobody decides anything',
      ],
      // ⚑ **707 · R39, extended** — the same shortage, met by a SPAWN (`705` F-2).
      [
        'TOOL_REFUSALS',
        'agent-could-not-start-just-now',
        'something else on the machine lets go of what it ran short of — nobody decides anything',
      ],
      [
        'RESOURCE_RAILS',
        'resource-unreadable',
        // ⚑ **733** — no *Markdown* and no *workspace*: the act is a file of a type the store holds,
        // anywhere (`726` · R92, `HO-097`).
        'the worker writes a readable file of a type the store holds and names that path',
      ],
      [
        'RESOURCE_RAILS',
        'resource-too-large',
        'the worker writes a smaller derived file and names that path',
      ],
      [
        'RESOURCE_RAILS',
        'resource-empty',
        'the worker writes a non-empty file and names that path',
      ],
      [
        'RESOURCE_RAILS',
        'resource-not-text',
        'the worker writes a UTF-8 derivative and names that path',
      ],
      // ⚑ **D-042** — a person changed that agent's provider while the give read the list; the same
      // give again reads the list of the provider it now starts on. ⚠️ `models-unavailable` is NOT
      // here: most of its causes clear only when a person acts, so it is `until-a-person-changes-it`.
      [
        'MODEL_RAILS',
        'the-provider-moved-meanwhile',
        'the same give again reads the list of the provider that agent now starts on — nobody decides anything',
      ],
      // The provider was only too slow to give its list: the same give asks it again.
      [
        'MODEL_RAILS',
        'models-not-read-in-time',
        'the same give again asks the provider for its list again — nobody decides anything',
      ],
    ]

    /**
     * ⛔ **The twelve `422` measured, with what `424` did to each** — the other side of the same
     * question, and the reason this is a pair rather than one assertion. ⚑ A retryable list that
     * nothing checks against the *names* of the twelve would go on passing if a rail were renamed
     * rather than repriced.
     *
     * ⚠️ **D-014 deleted two of the twelve** — `too-many-for-this-parent` and `too-many-live-spawns`
     * went with the fan-out cap. ⚑ **D-016 deleted three more and renamed three**:
     * `profile-already-live` went (a give reaches the one conversation its giver has with that
     * agent), and `no-such-project` and `no-such-task` with projects and the document registry;
     * `no-task-by-that-name` is `no-piece-by-that-name`, and the registry's `no-such-document` and
     * `document-registry-unavailable` are the resource store's `no-such-resource` and
     * `resource-store-unavailable`. So the seven that still exist are what is left to check.
     */
    const THE_TWELVE: readonly (readonly [string, string])[] = [
      ['TOOL_REFUSALS', 'no-such-agent'],
      ['TOOL_REFUSALS', 'agent-cannot-take-a-message'],
      ['REPLY_RAILS', 'no-piece-by-that-name'],
      ['QUESTION_RAILS', 'no-question-by-that-name'],
      ['INTERRUPT_RAILS', 'a-person-is-being-asked'],
      ['RESOURCE_RAILS', 'no-such-resource'],
      ['RESOURCE_RAILS', 'resource-store-unavailable'],
    ]

    it('🔴 424 · every rail that promises a retry is in the named roster derived from the vocabularies', () => {
      const retryable = VOCABULARIES.flatMap((one) =>
        one.rails
          .filter((rail) => one.permanence(rail) === 'while-this-holds')
          .map((rail) => `${one.name} · ${rail}`),
      )

      expect(retryable.sort()).toEqual(
        STILL_RETRYABLE.map(([vocabulary, rail]) => `${vocabulary} · ${rail}`).sort(),
      )
      // ⛔ **Non-vacuity**: an empty walk would satisfy the equality above only if the list were
      // empty too, and a `retryable` that answered `false` for everything is the shape this whole
      // dispatch could have produced by accident.
      // ⚑ **703 · one more**: `a-message-you-cannot-withdraw-is-waiting`, split off the held rail.
      // ⚑ **707 · one more**: `agent-could-not-start-just-now` (R39, extended).
      // ⚑ **D-010 · two fewer**: both mailbox words.
      // ⚑ **D-016 · one more**: `agent-already-has-work-open` went, and `its-work-has-stalled` and
      // `the-start-it-waited-on-did-not-happen` came.
      // ⚑ **D-042 · one more**: `MODEL_RAILS`' `the-provider-moved-meanwhile`.
      // ⚑ **One more**: `QUESTION_RAILS`' `answer-too-long`.
      // ⚑ **One more**: `restore_agent`'s `it-is-being-archived-or-deleted`.
      // ⚑ **One more**: `MODEL_RAILS`' `models-not-read-in-time`.
      // ⚑ **One more**: `SPAWN_RAILS`' `it-would-wait-on-itself`, a give to a service that waits on
      // its caller. ⚑ **One more**: `its-waits-cannot-all-be-checked`, one whose waits reach too far.
      // ⚑ **Two more**: a stop of a service on another caller's piece, and a message about a piece
      // still queued at one.
      // Move and work search each add one explicitly named retryable rail; one went:
      // `its-work-has-stalled` went, and a give names a stall instead.
      // Four more: a piece that cannot end with the copies of its questions, at two vocabularies.
      // A full work-search queue clears when a waiting slot becomes free.
      expect(retryable.length).toBe(35)
      // ⚑ …and `retryable` still agrees with the word, at every door, over the same walk.
      for (const [name, rail] of STILL_RETRYABLE.map(([n, r]) => [n, r] as const)) {
        const vocabulary = VOCABULARIES.find((one) => one.name === name)
        expect(vocabulary, name).toBeDefined()
        expect(vocabulary!.permanence(rail), rail).toBe('while-this-holds')
      }
    })

    it('⛔ 424 · and none of the twelve `422` measured says `while-this-holds` any more', () => {
      for (const [name, rail] of THE_TWELVE) {
        const vocabulary = VOCABULARIES.find((one) => one.name === name)
        expect(vocabulary, name).toBeDefined()
        // ⚠️ **The rail still EXISTS in that vocabulary**, or this whole loop passes over a
        // misspelling — a negative that a typo satisfies is the defect standing rule 4 is about.
        expect(vocabulary!.rails, `${name} no longer has ${rail}`).toContain(rail)
        expect(vocabulary!.permanence(rail), rail).not.toBe('while-this-holds')
      }
      // ⛔ **The control that plants TWO** (standing rule 12): a rail that IS retryable must be
      // seen as retryable by the very same reader, or *"none of the twelve"* is a fact about the
      // reader rather than about the twelve.
      for (const [name, rail] of [
        ['SPAWN_RAILS', 'it-would-wait-on-itself'],
        ['RESOURCE_RAILS', 'resource-empty'],
      ] as const) {
        const vocabulary = VOCABULARIES.find((one) => one.name === name)
        expect(vocabulary!.permanence(rail), rail).toBe('while-this-holds')
      }
    })

    /** ⚠️ Prose quotes code, so a census that reads source has to read the code only. */
    const codeOnly = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

    const everyModule = (): { path: string; source: string }[] => {
      const found: { path: string; source: string }[] = []
      const walk = (dir: string, base: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) walk(full, base)
          else if (entry.name.endsWith('.ts')) {
            found.push({ path: relative(base, full), source: readFileSync(full, 'utf8') })
          }
        }
      }
      walk(mainRoot, mainRoot)
      walk(sharedRoot, join(sharedRoot, '..'))
      return found
    }

    /**
     * 🔴 **What makes a module a rail vocabulary, mechanically.**
     *
     * ⛔ **It names one of `RAIL_PERMANENCES` in its CODE.** Every door prices its own rails against
     * those shared words, so a list that does not is not a rail vocabulary and a module that does is
     * either one or the file that defines the words.
     *
     * ⚠️ **Two nearer-looking derivations were measured and BOTH miss a list.** *"Imports
     * `RailPermanence`"* missed `DOCUMENT_RAILS` (D-016's `RESOURCE_RAILS`), which restated a
     * narrowed pair inline; *"declares
     * `Readonly<Record<…, RailPermanence>>`"* misses it for the same reason. ⛔ `shared/refusals.ts`
     * asserted the first of those in prose until `412` — *"every one of them imports
     * `RailPermanence`"* — which is how a false docblock costs an instrument rather than a reader.
     *
     * ⚑ **Names, not a shape**, so a vocabulary whose array is spelled some new way is still found.
     */
    const namesAPermanence = (source: string): boolean =>
      RAIL_PERMANENCES.some((word) => codeOnly(source).includes(`'${word}'`))

    /** Modules that only read a refusal's permanence to say it in words; they price no rail. */
    const CONSUMERS: readonly string[] = ['runtime/agent-tool-answer-words.ts']

    it('🔴 the registered vocabularies are ALL of them — nothing in main/ or shared/ prices a rail outside this list', () => {
      const modules = everyModule()
      const pricing = modules
        .filter((file) => namesAPermanence(file.source))
        .map((file) => file.path.split('\\').join('/'))
        .sort()

      // The shared module declares the words; the theme wrapper repeats them without pricing
      // any rails of its own. Its two references are pinned, and any additional pricing fails.
      const wrapper = codeOnly(readFileSync(join(mainRoot, 'themes/agent-tools.ts'), 'utf8'))
      expect(wrapper).toContain("import { PERMANENCE_SAID } from '../../shared/refusals'")
      const classification = "const permanent = data?.['permanence'] === 'permanent'"
      const repetition = "PERMANENCE_SAID['while-this-holds']"
      expect(wrapper).toContain(classification)
      expect(wrapper).toContain(repetition)
      expect(wrapper).toContain("`This refusal holds ${PERMANENCE_SAID['while-this-holds']}.`")
      expect(wrapper).toContain(
        "return { ...answer, text: [answer.text, ...lines, clause].join(' ') }",
      )
      expect(namesAPermanence(wrapper.replace(classification, '').replace(repetition, ''))).toBe(
        false,
      )
      const expected = [
        ...VOCABULARIES.map((one) => one.module),
        'shared/refusals.ts',
        'themes/agent-tools.ts',
        ...CONSUMERS,
      ].sort()
      expect(pricing).toEqual(expected)
      for (const path of CONSUMERS) {
        const found = modules.find((one) => one.path.split('\\').join('/') === path)
        const code = codeOnly(found?.source ?? '')
        const named = RAIL_PERMANENCES.flatMap((word) => code.split(`'${word}'`).slice(1))
        const compared = RAIL_PERMANENCES.flatMap((word) =>
          code.split(new RegExp(`[!=]==\\s*'${word}'`)).slice(1),
        )
        expect(named.length, `${path} names no permanence`).toBeGreaterThan(0)
        expect(compared.length, `${path} prices a rail`).toBe(named.length)
      }
    })

    it('⚠️ …and the sweep that says so finds TWO planted modules, and no commented one', () => {
      // ⛔ **The control plants TWO** (standing rule 12): `store.create(` read only the first call
      // per file and was blind to a second, which is exactly the defect a census exists to catch.
      const planted = [
        { path: 'runtime/a-new-door.ts', source: `const P = { a: 'permanent' as const }\n` },
        {
          path: 'runtime/another-door.ts',
          source: `const Q = { b: 'while-this-holds' as const }\n`,
        },
        // ⚑ …and the negative control: a member that exists only in PROSE must not be found, or
        // the strip is doing nothing and every docblock quoting a rail would join the list.
        {
          path: 'runtime/only-a-docblock.ts',
          source: `/** it is 'until-a-person-changes-it'. */\nexport const X = 1\n`,
        },
        {
          path: 'runtime/a-line-comment.ts',
          source: `// 'permanent', said a comment\nexport const Y = 2\n`,
        },
      ]
      expect(
        planted.filter((file) => namesAPermanence(file.source)).map((one) => one.path),
      ).toEqual(['runtime/a-new-door.ts', 'runtime/another-door.ts'])
    })

    it('⛔ every rail NAME shared across vocabularies is one of the named exceptions', () => {
      const names = VOCABULARIES.flatMap((one) => one.rails)
      const duplicated = [...new Set(names.filter((name, at) => names.indexOf(name) !== at))]
      expect(duplicated.sort()).toEqual(DELIBERATELY_SHARED.map((one) => one.rail).sort())
      // ⚑ **…and each is shared by exactly the lists this says it is**, so moving a share elsewhere is
      // a red rather than a pass — the exceptions are located, not merely counted.
      for (const shared of DELIBERATELY_SHARED) {
        expect(
          VOCABULARIES.filter((one) => (one.rails as readonly string[]).includes(shared.rail))
            .map((one) => one.name)
            .sort(),
          shared.rail,
        ).toEqual([...shared.by].sort())
        // 🔴 **And what makes sharing SAFE is measured rather than assumed** (419): every
        // vocabulary that carries the word answers the same permanence for it. ⛔ A model meets all
        // of these through one door, and a word that meant `until-a-person-changes-it` at one and
        // `permanent` at another would be the *one word, two things* this census refuses — arriving
        // through the exception rather than around it.
        const permanences = new Set(
          VOCABULARIES.filter((one) => (one.rails as readonly string[]).includes(shared.rail)).map(
            (one) => one.permanence(shared.rail),
          ),
        )
        expect(permanences.size, `${shared.rail} means two things`).toBe(1)
      }
      // ⚠️ …and no vocabulary repeats a name inside itself, which the concatenation above hides.
      for (const one of VOCABULARIES) {
        expect(new Set(one.rails).size, one.name).toBe(one.rails.length)
      }
    })

    it('⛔ no two rails ANYWHERE share a SENTENCE — one model meets every vocabulary through one door', () => {
      const sentences = VOCABULARIES.flatMap((one) => one.rails.map((rail) => one.reason(rail)))
      expect(new Set(sentences).size).toBe(sentences.length)
      // ⚑ **Non-vacuity: these really are prose**, or the set above is comparing `undefined` to
      // itself — which is how `347`'s version of this census passed measuring nothing.
      expect(sentences.every((one) => typeof one === 'string' && one.includes(' '))).toBe(true)
      expect(sentences).toHaveLength(VOCABULARIES.flatMap((one) => one.rails).length)
    })

    it('⚑ …and the values this walks are the lists the modules export, not a copy', () => {
      // ⛔ **The registry above is a list of REFERENCES**, so a member added to any vocabulary is
      // swept without touching this file. ⚠️ Asserted rather than assumed, because a registry that
      // had inlined its members would pass every assertion above and cover nothing new.
      for (const one of VOCABULARIES) {
        const source = codeOnly(
          readFileSync(
            join(one.module.startsWith('shared/') ? join(mainRoot, '..') : mainRoot, one.module),
            'utf8',
          ),
        )
        expect(source, `${one.name} is not exported by ${one.module}`).toContain(
          `export const ${one.name} = [`,
        )
        for (const rail of one.rails) {
          expect(source, `${one.name} lists ${rail} nowhere in ${one.module}`).toContain(
            `'${rail}'`,
          )
        }
      }
    })
  })
})
