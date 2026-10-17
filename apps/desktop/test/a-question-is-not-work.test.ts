import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeProviderSessions, FakeRuntime, parametersOf, ResumeError } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { SPAWN_RAILS } from '../src/main/runtime/spawn-rails'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { composeProfileBundle } from '../src/main/runtime/factory-text'
import { REPLY_DELIVERIES, REPLY_LANDED } from '../src/main/runtime/reply-rails'
import { stillHeld } from '../src/shared/mailbox'
import { AGENT_MESSAGE_KINDS, TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **415 · a question is not work** — HO-021 §1, the three properties, and the fourth this
 * dispatch was licensed to name.
 *
 * ## ⛔ Why this is code and not an instruction
 *
 * **`412` shipped HO-020's stall rule and measured it on both providers.** ⚠️ Claude's BroBot held
 * it on disk and broke it three times; **Codex's project manager obeyed it exactly** — *"can you
 * resume the already-assigned task without receiving a new piece of work?"* — **and the app
 * recorded that question as task #4.** ⛔ **Obedience produced the same outcome as disobedience**,
 * which is standing rule 15 and the reason `workBeingAssigned` is the defect rather than the text.
 *
 * ## ⚑ The four properties, and where each is measured
 *
 *  - **§1 · property 1** — *an agent can ask about work it gave without that question becoming new
 *    work.* The caller DECLARES (HO-021 §4: the flag was in the PO's own tool sketch and never
 *    reached the specification), the app does not guess, and what a model is TOLD moves with it.
 *  - **§2 · property 3** — *a child holding an open task does not receive a second piece of work.*
 *    ⛔ Two rails answer that, in an order this section pins: `354`'s singleton first, because words
 *    waiting to be sent are the nearer obstacle, and `415`'s open-work rail behind it, because an
 *    idle child with an open task has an empty slot — **which is the hole HO-021 §1 named.**
 *    ⚑ **D-016 · both rails are gone and the STALL RULE answers the hole**: a give to a helper
 *    whose turn ended with the giver's piece open is refused (`its-work-has-stalled`).
 *  - **§3 · property 2** — *a reply is never new work for its recipient*, proved by refusal, by the
 *    paired positive, and by a three-tier chain in which a project manager holding an open task of
 *    its own receives its worker's reply.
 *  - **§4 · the fourth property** — *a reply that cannot be delivered is surfaced, never swallowed.*
 *    ⚑ The PO placed a lost reply above every other failure in this round: *"the one failure mode
 *    with no signal."*
 *
 * ## ⚠️ What this suite does NOT do
 *
 * ⛔ **It asserts nothing about a model obeying anything.** `412` is the reason: the instruction was
 * followed and the outcome was identical, so a test that drives a provider and reads its compliance
 * measures the model rather than the app. **Every rail here is demonstrated by an actual refusal
 * and paired with the same call one fact over admitted** (standing rule 3).
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

/**
 * The line `messageNamingThePiece` composes — quoted once, as `412`'s own suite quotes it (D-016's
 * spelling: the piece by its label, where `messageNamingTheTask` named a task id).
 */
const FINISHING_LINE = 'Finish it by calling reply_to_parent with piece '

/**
 * ⚑ **D-030 · why a reply's words reached nobody when its giver's record would not take them** —
 * quoted once, as the line above is.
 */
const THE_RECORD_REFUSED_IT = 'BroCrew could not write it into that conversation’s record.'

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
  /**
   * ⚑ **D-017 · R10 — the next reopen fails for a reason of THIS attempt** (a `ResumeError` its
   * adapter did not mark `noSuchSession`), once. ⛔ Not `issued.forgetAll()`: a provider that no
   * longer has the conversation gets it REPLACED, and the words land in the replacement.
   */
  static nextResumeThrows: Error | null = null
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
    const failure = ToolWatchingRuntime.nextResumeThrows
    if (failure !== null) {
      ToolWatchingRuntime.nextResumeThrows = null
      throw failure
    }
    const handle = await super.resume(ref, options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('415 · a question is not work', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-415-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-415-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    ToolWatchingRuntime.nextResumeThrows = null
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
   * 🔴 **What the PROVIDER was handed** — `412`'s instrument, unchanged. `FakeSessionHandle.send`
   * republishes its argument as `echo: <text>`, which is the only place the string that crossed the
   * adapter boundary is observable from the ledger.
   */
  const saidToProvider = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => text.slice('echo: '.length))

  const openTasksOf = (sessionId: string): readonly string[] =>
    store
      .piecesOwnedBy(sessionId)
      .filter((task) => TASK_IS_OPEN[task.state])
      .map((task) => task.piece)

  /**
   * A PM in a window with one child of its own, started through the real door (`379`'s helper).
   * ⚑ **D-016 · the door is a give**: the child holds the piece it opened, and its brief is the
   * child's first turn — in the PM's `ask`, parked on a card.
   */
  const aPmAndItsWorker = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
    label: string
  }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    // ⛔ No grant is set for the give (D-014: any agent may give work to any agent).
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief: 'the first piece',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      pm,
      worker: given.agent as string,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  /**
   * 🔴 **Three tiers, through the real doors** — the shape HO-021 §5 asked for by name: *"in a
   * three-tier chain the PM holds an open task of its own while its worker answers."*
   */
  const aChainOfThree = async (): Promise<{
    brobot: string
    pm: string
    worker: string
    brobotTools: AgentToolset
    pmTools: AgentToolset
    workerTools: AgentToolset
    /** ⚑ **D-016** — the piece BroBot gave the PM, and the one the PM gave the worker. */
    pmPiece: string
    workerPiece: string
  }> => {
    for (const profile of ['pm', 'worker']) await bringIdentityIntoBeing(profile)
    const brobot = await personOpens('brobot')
    const brobotTools = theToolsetJustHandedOut()
    // ⛔ No grant is set for either give (D-014: any agent may give work to any agent).
    // ⚑ **D-016 · each give's brief is its child's first turn**, parked on a card in BroBot's `ask`.
    const madePm = await callOn(brobotTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'pm',
      title: 'run the project',
      brief: 'plan the world clock page',
    })
    expect(madePm.outcome, JSON.stringify(madePm)).toBe('ok')
    const pm = madePm.agent as string
    const pmTools = theToolsetJustHandedOut()
    const madeWorker = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'do the work',
      brief: 'find the flake',
    })
    expect(madeWorker.outcome, JSON.stringify(madeWorker)).toBe('ok')
    return {
      brobot,
      pm,
      worker: madeWorker.agent as string,
      brobotTools,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      pmPiece: madePm.piece as string,
      workerPiece: madeWorker.piece as string,
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

  const sourceOf = (dir: string, file: string): string => readFileSync(join(dir, file), 'utf8')

  /** Prose quotes code, so a census that COUNTS has to read the code only (`412`'s helper). */
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const filesUnder = (dir: string): { path: string; text: string }[] =>
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => {
        const full = join(entry.parentPath, entry.name)
        return { path: relative(dir, full).replaceAll('\\', '/'), text: readFileSync(full, 'utf8') }
      })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · property 1 — an agent can ask without opening work
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the caller declares, and the app stops guessing', () => {
    it('🔴 a question opens NO piece, and the same words as a give open one', async () => {
      // ⚑ **D-016 · the declaration is the VERB now**: `message_agent` hands nothing over whatever
      // its kind, and `give_work` is the one call that opens a piece.
      const { worker, pmTools, piece } = await aPmAndItsWorker()

      const asked = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'what happened to the thing I gave you?',
        kind: 'follow-up',
        piece,
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      // ⛔ **Nothing new on any board.** This is HO-020's cascade at its source: the question Codex's
      // project manager asked was recorded as task #4. ⚑ The one piece is the give's own.
      expect(openTasksOf(worker)).toEqual([piece])
      // ⚑ **…and the words still arrived**, which is what makes the absence above a CLASSIFICATION
      // rather than a refusal wearing a different hat. ⚠️ Held behind the brief's card, so the
      // brief's turn is let finish first.
      await letTheTurnFinish(worker)
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes('what happened to the thing')),
        'the question to reach the provider',
      )

      // ⚑ **The same words one fact over** (standing rule 3): the identical caller and target, with
      // the declaration changed — the words given as work — and nothing else.
      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'do the thing',
        brief: 'do the thing',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      expect(given.agent).toBe(worker)
      expect(store.piecesOwnedBy(worker)).toHaveLength(2)
      expect(store.piecesOwnedBy(worker)[1]?.brief).toBe('do the thing')
    })

    it('⛔ a held follow-up keeps its semantic kind separate from the mailbox slot kind', async () => {
      const { pm, worker, pmTools, piece, label } = await aPmAndItsWorker()
      // ⚑ **D-016** — the brief's own turn is what keeps the worker busy.
      await cardOn(worker)

      const asked = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'what happened while you were busy?',
        kind: 'follow-up',
        piece,
      })
      expect(asked).toMatchObject({ outcome: 'ok', delivery: 'queued', kind: 'follow-up' })
      expect(asked).not.toHaveProperty('message')

      const receipt = [...ledger(pm)].reverse().find((event) => event.type === 'message_sent')
      // ⚑ **D-016 · the sender's receipt names the piece the follow-up is ABOUT** — and hands none.
      expect(receipt).toMatchObject({
        type: 'message_sent',
        to: worker,
        delivery: 'queued',
        kind: 'follow-up',
        piece,
        label,
      })

      const queued = [...ledger(worker)]
        .reverse()
        .find(
          (event) =>
            event.type === 'message_queued' && event.text === 'what happened while you were busy?',
        )
      expect(queued).toMatchObject({ type: 'message_queued', kind: 'work' })
      expect(queued?.type === 'message_queued' ? queued.messageId : undefined).toMatch(/^msg_/)
      // ⛔ **And it opened nothing** — the one `work_given` is the give's.
      expect(ledger(worker).filter((event) => event.type === 'work_given')).toHaveLength(1)
      expect(openTasksOf(worker)).toEqual([piece])
    })

    it('⛔ and the model is TOLD which it is — a follow-up carries no finishing line', async () => {
      // 🔴 **`412`'s line says *"Finish this piece of work"*, and it was right about every
      // agent-to-agent message only because every one of them minted a task.** ⛔ A question that
      // carried it would tell a worker it had received work the app never recorded — standing rule
      // 15 inverted: the code right and the text wrong.
      const { worker, pmTools, piece, label } = await aPmAndItsWorker()

      // ⚑ **The control first, and the order is forced rather than chosen**: each message parks the
      // child on a card, so the second of any pair is HELD — and a held message is composed at the
      // flush, which is a different branch from the one this test is about. ⚑ **D-016** — the
      // control is the give's own brief, the child's first turn.
      await waitFor(() => saidToProvider(worker).length === 1, 'the work to reach the provider')
      expect(saidToProvider(worker)[0]).toContain(`${FINISHING_LINE}${label}`)

      await letTheTurnFinish(worker)
      await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'how far have you got?',
        kind: 'follow-up',
        piece,
      })
      await waitFor(() => saidToProvider(worker).length === 2, 'the question to reach the provider')
      expect(saidToProvider(worker)[1]).toContain('how far have you got?')
      expect(saidToProvider(worker)[1]).not.toContain(FINISHING_LINE)
    })

    it('🔴 D-010 · an OMITTED declaration is REFUSED — there is no default to fall back on', async () => {
      /**
       * ⚑ **Re-aimed twice, and the world moved each time** (standing rule 26). `415` defaulted an
       * omitted kind to `work`; `553` (HO-060 §3) moved the default to `question`, because *"a
       * model that simply sends a message assigns work"*. ⛔ **D-010 took the default away**: a
       * question is `ask_question` now, and a caller that has not said which kind it means has not
       * decided — so the call is refused, and the refusal names the vocabulary and the other door.
       */
      const { worker, pmTools, piece } = await aPmAndItsWorker()
      // ⚑ **D-016** — the give's brief is the worker's first turn: let it reach the provider first,
      // so a refused call that DID send would show as a second entry, not race the first.
      await waitFor(() => saidToProvider(worker).length === 1, 'the brief to reach the provider')
      const refused = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'no kind at all',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('malformed-request')
      const problems = (refused.detail as { problems: string[] }).problems.join(' ')
      for (const member of AGENT_MESSAGE_KINDS) expect(problems).toContain(member)
      expect(problems).toContain('ask_question')
      // ⛔ **And nothing happened**: no piece beyond the give's, and no words held or on the way to
      // the provider.
      expect(openTasksOf(worker)).toEqual([piece])
      expect(saidToProvider(worker).filter((said) => said.includes('no kind at all'))).toEqual([])
      expect(saidToProvider(worker)).toHaveLength(1)
      expect(JSON.stringify(ledger(worker))).not.toContain('no kind at all')
      // ⚑ **THE CONTROL, one argument over**: the same call naming a kind lands.
      const said = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'a note this time',
        kind: 'note',
      })
      expect(said.outcome, JSON.stringify(said)).toBe('ok')
      expect(said.kind).toBe('note')
      expect(openTasksOf(worker)).toEqual([piece])
    })

    it('⛔ a kind this app has not been taught is REFUSED, and the refusal names the vocabulary', async () => {
      // ⚑ **`325`'s rule and `reply_to_parent`'s `outcome` precedent**: a vocabulary the validator
      // has not been taught is a refusal, never a pass — and never a transport error, which `307`
      // measured *"carries no machine-readable policy meaning"*.
      const { worker, pmTools, piece } = await aPmAndItsWorker()
      // ⚑ **D-016** — the give's brief is the worker's first turn: let it reach the provider first.
      await waitFor(() => saidToProvider(worker).length === 1, 'the brief to reach the provider')
      const refused = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'something',
        kind: 'informational',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('malformed-request')
      const problems = (refused.detail as { problems: string[] }).problems.join(' ')
      for (const member of AGENT_MESSAGE_KINDS) expect(problems).toContain(member)
      // ⛔ **And nothing happened**: no piece beyond the give's, and no words held or sent.
      expect(openTasksOf(worker)).toEqual([piece])
      expect(saidToProvider(worker).filter((said) => said.includes('something'))).toEqual([])
      expect(saidToProvider(worker)).toHaveLength(1)
      expect(JSON.stringify(ledger(worker))).not.toContain('"something"')
    })

    it('🔴 the argument is ADVERTISED, which is the half a green test cannot see', () => {
      // ⛔ **Since `348` both adapters build their schema with `z.looseObject`, so an UNDOCUMENTED
      // key is not stripped** — it reaches the handler, the behaviour changes, and a test that sends
      // it passes **while no model has ever been told the argument exists.** ⚑ What a model is told
      // is the JSON Schema built from the tool's `input` shape, and this reads it back out.
      const tools = agentToolsFor(host, 'sess_1')
      const message = tools.tools.find((one) => one.name === 'message_agent')
      expect(message, 'message_agent is not published').toBeDefined()
      const parameters = parametersOf(message?.input ?? {})
      const kind = parameters.find((one) => one.name === 'kind')
      expect(kind, JSON.stringify(parameters)).toBeDefined()
      // ⚠️ **Optional in the SCHEMA and required at the door** (D-010): a schema-required argument
      // is a transport error on Claude and a hint on Codex (`538` §3.3), and the door refuses its
      // absence by name on both — measured in the omitted-declaration test above.
      expect(kind?.required).toBe(false)
      // ⛔ **The description names the whole vocabulary AS A LIST, and the default beside it.**
      // ⚠️ **This read *"every member appears somewhere in the description"* and a mutation walked
      // straight through it** (`415` `M4`): the prose below the list says *'work' is something for
      // it to do* and *'note' tells it something*, so both words are in the sentence
      // whatever the enumeration does — `an-assertion-can-be-satisfied-by-a-neighbouring-element`,
      // found by the table rather than by reading. ⚑ The joined list is the DERIVED half, and it is
      // the half that would go missing.
      expect(kind?.description ?? '').toContain(AGENT_MESSAGE_KINDS.join(', '))
      for (const member of AGENT_MESSAGE_KINDS) expect(kind?.description ?? '').toContain(member)
      expect(kind?.description ?? '').toContain('There is no default')
    })

    it('⚠️ …and both adapters build that schema the same way — the claim, measured', () => {
      // 🔴 **`parametersOf`'s own docblock says it matches both adapters *"exactly"*, and a
      // docblock's universality claim is the specification the next census is written to.** ⛔ So
      // it is read rather than trusted: the three call sites that turn a tool's `input` into what a
      // model sees all use the same loose spelling.
      const spellings = [
        sourceOf(join(here, '../../../packages/runtime/src'), 'tool-inventory.ts'),
        sourceOf(join(here, '../../../packages/runtime/src/codex'), 'agent-tools.ts'),
        sourceOf(join(here, '../../../packages/runtime/src/claude'), 'agent-tools.ts'),
      ]
      for (const source of spellings) expect(codeOnly(source)).toContain('z.looseObject(')
      // ⚑ **The control that this is not vacuous**: a strict object anywhere in that trio would be
      // the defect `348` measured, so its absence is asserted rather than assumed.
      for (const source of spellings) expect(codeOnly(source)).not.toContain('z.strictObject(')
    })

    it('⚑ the stall remedy is the ask-and-wait skill’s, and the core offers no new work for one', () => {
      // PE-004: a follow-up drives the stalled piece, and a new give could repeat HO-020's cascade.
      // The remedy is in the ask-and-wait skill; the core may say when to look at a stall, but no
      // sentence of it about one names a remedy or offers new work.
      const said = composeProfileBundle({ configured: null })
      // The word, not its letters: the core's "an installed skill" is not about a stall.
      const aboutAStall = (text: string): string[] =>
        text.split(/(?<=[.!?])\s+/).filter((one) => /\bstall(s|ed|ing)?\b/i.test(one))
      const aRemedy =
        /give_work|\bgive\b[^.]*\bagain\b|new (piece|work)|follow[ -]?up|message_agent|withdraw|take_on_work/i
      const offered = (text: string): string[] =>
        aboutAStall(text).filter((sentence) => aRemedy.test(sentence))
      expect(offered(said)).toEqual([])
      // The controls: a stall sentence that offers new work is caught, and only the word counts.
      expect(offered(`${said}\nA piece stalled; give it again with give_work.`)).toHaveLength(1)
      expect(offered(`${said}\nFor a stall, give the work again.`)).toHaveLength(1)
      expect(aboutAStall('Use an installed skill.')).toEqual([])
      expect(AGENT_MESSAGE_KINDS).toContain('follow-up')
    })

    it('⛔ the agent door and the app’s personal-work note are the only explicit callers', () => {
      // ⚑ **`394`'s rule for the parameter beside it, pointed the same way**: the widening is
      // opt-in at the call site, so every caller that existed before `415` keeps the task it always
      // minted. ⚠️ A census with a control that plants TWO (standing rule 12).
      //
      // ⚑ **D-016 · read per CALL, not per line** — `message_agent`'s call gained the piece a
      // message is about and is written one argument a line, so a line-wise read found no declaring
      // line at all. ⛔ Each call is its whole argument list, read to its closing paren.
      const callsIn = (text: string): string[] => {
        const found: string[] = []
        for (let at = text.indexOf('queueMessage('); at !== -1;) {
          const opens = at + 'queueMessage('.length
          let depth = 1
          let end = opens
          while (end < text.length && depth > 0) {
            if (text[end] === '(') depth += 1
            if (text[end] === ')') depth -= 1
            end += 1
          }
          found.push(text.slice(at, end).replace(/\s+/g, ' '))
          at = text.indexOf('queueMessage(', end)
        }
        return found
      }
      const declares = (call: string): boolean =>
        /,\s*says\s*,?\s*\)|,\s*'(?:note|follow-up)'/.test(call)
      const calls = filesUnder(mainRoot).flatMap((file) =>
        callsIn(codeOnly(file.text)).map((call) => ({ path: file.path, call })),
      )
      expect(calls.length, 'the census found nothing to read').toBeGreaterThanOrEqual(4)
      const declaring = calls.filter((one) => declares(one.call))
      // The host forwards agent declarations and explicitly marks its personal-work notice as a note.
      expect(declaring.map((one) => one.path)).toEqual([
        'runtime/agent-tools.ts',
        'runtime/runtime-host.ts',
        'runtime/runtime-host.ts',
      ])
      const appNote = declaring.find((one) =>
        one.call.includes("appNotice: 'a-person-gave-new-work'"),
      )
      expect(appNote).toBeDefined()
      expect(appNote!.call).toContain('THE_APP_ITSELF')
      expect(appNote!.call).toContain("'notice'")
      expect(appNote!.call).toContain("'note'")

      // ⛔ **The control, planting TWO** — a sweep that read only the first match per file would
      // pass this suite and miss a second declaring call site in an 8,700-line host.
      const planted = [
        { path: 'a.ts', text: "host.queueMessage(a, b, by, [], 'work', {}, says)" },
        {
          path: 'b.ts',
          text: "await this.queueMessage(\n  id,\n  text,\n  THE_APP_ITSELF,\n  [],\n  'work',\n  {},\n  says,\n)",
        },
      ]
      const found = planted.flatMap((file) =>
        callsIn(file.text)
          .filter((call) => declares(call))
          .map(() => file.path),
      )
      expect(found).toEqual(['a.ts', 'b.ts'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · property 3 — a child holding an open task receives no second piece of work
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⚑ **D-016 · the one-open-task rail is gone, and the STALL RULE is what took its place**: a
   * give is refused `its-work-has-stalled` by a helper whose last turn ended with a piece from this
   * giver still open — HO-021 §1's hole (*"an idle child with an open task has an empty slot and
   * accepts more"*) answered by the rule that replaced the rail. ⛔ A busy child is no longer
   * refused at all: it takes the give, held, and the two cases that measured the rail behind held
   * work and its hand-written openness went with it.
   */
  describe('§2 · the rail, and the one it stands behind', () => {
    it('🔴 an IDLE child whose piece STALLED takes a give, and the answer names the piece', async () => {
      // ⛔ **HO-021 §1's hole, exactly**: *"the singleton I ruled in HO-007 P1 was keyed to the
      // queue slot; an idle child with an open task has an empty slot and accepts more."* ⚑ A
      // stalled child is idle, which is the state everything HO-020 measured arrived into.
      // ⚑ It accepts more, and the giver is told of the piece it left open.
      const { worker, pmTools, piece, label } = await aPmAndItsWorker()
      await letTheTurnFinish(worker)
      await waitFor(
        () => store.piecesOwnedBy(worker)[0]?.state === 'stalled',
        'the piece to stop being driven',
      )
      // ⚠️ **The premise, asserted rather than assumed**: the mailbox really is empty. ⛔ Read
      // through `stillHeld`, which is the ledger's own answer rather than this test's reading of it.
      expect(stillHeld(store.events(worker))).toEqual([])

      const given = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and another',
        brief: 'and another',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      // 🔴 **Scoped to the field that carries the stalled piece**, because an assertion over the
      // whole payload could be satisfied by a neighbouring element.
      expect(given.stalled).toEqual([label])
      // ⚑ **And the work was handed over**, beside the piece that stalled.
      await waitFor(
        () => saidToProvider(worker).some((said) => said.includes('and another')),
        'the new brief to reach the provider',
      )
      expect(openTasksOf(worker)).toEqual([piece, given.piece])
    })

    it('⚑ …and the same call one fact over is ADMITTED — as a question, and after the answer', async () => {
      const { worker, pmTools, workerTools, piece } = await aPmAndItsWorker()
      await letTheTurnFinish(worker)
      await waitFor(
        () => store.piecesOwnedBy(worker)[0]?.state === 'stalled',
        'the piece to stop being driven',
      )

      // 🔴 **The investigate half, which HO-021 §1 ruled must survive the rail**: a key of *"this
      // child has an open task"* alone would refuse this too, *"which enforces the letter of HO-020
      // §2.2 by deleting its investigate half."*
      const asked = await callOn(pmTools, 'message_agent', {
        agent: worker,
        text: 'what happened?',
        kind: 'follow-up',
        piece,
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)

      // ⚑ **And the other fact over: the work is ANSWERED, so the next piece is admitted.** ⛔ This
      // is what makes the refusal `while-this-holds` true rather than decorative.
      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'that one is finished',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      const second = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'and another',
        brief: 'and another',
      })
      expect(second.outcome, JSON.stringify(second)).toBe('ok')
      expect(store.piecesOwnedBy(worker)).toHaveLength(2)
      // ⚑ **425 · an ADMITTED call carries no remedy, because there is nothing to remedy.** ⛔ The
      // field is absent from an `ok` payload rather than present-and-null: a caller that got what it
      // asked for is not handed a way out of it.
      expect(asked).not.toHaveProperty('remedy')
      expect(second).not.toHaveProperty('remedy')
    })

    // ⛔ **`D-010 · work behind HELD work meets the open-work rail` is gone with its subject**
    // (D-016): the one-open-task rail left the product, and a give to a busy child is held.

    it('⛔ a PERSON is never refused by it, however much work that child holds', async () => {
      // 🔴 **Only a give is asked the rule**, and this is the half of it that matters to somebody
      // using the app: the composer reaches the same `queueMessage`, and a person typing into a
      // child is not giving anything.
      const { worker, piece } = await aPmAndItsWorker()
      expect(openTasksOf(worker)).toEqual([piece])
      await cardOn(worker)

      host.claimSession(worker, window)
      claimed.add(worker)
      await host.queueMessage(worker, 'what are you doing?', window)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'message_queued' && event.text === 'what are you doing?',
          ),
        'the person’s message to be held',
      )
      // ⚑ **Held, not refused** — and it opened nothing: only a give opens a piece (D-016).
      expect(openTasksOf(worker)).toEqual([piece])
    })

    // ⛔ **`*open* is TASK_IS_OPEN and not a hand-written list of states` is gone with its
    // subject** (D-016): it read the open-work rail's own reader, `workAlreadyOpenIn`, which went
    // with the rail. ⚑ A give's answer names the stalls, each with its cause, not openness.

    it('🔴 a stall refuses no give: its rail is gone, and the give’s answer teaches the remedy', () => {
      // ⚑ The give goes through, and its answer names the stalled piece with a follow-up
      // and `withdraw_task`, word for word in `a-conversation-holding-open-work-takes-no-more-from-anyone`.
      expect(SPAWN_RAILS as readonly string[]).not.toContain('its-work-has-stalled')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · property 2 — a reply is never new work for its recipient
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the reply, protected above the rest', () => {
    it('🔴 a project manager holding an open task RECEIVES its worker’s reply', async () => {
      // ⛔ **HO-021 §5's own scenario**: *"in a three-tier chain the PM holds an open task of its own
      // while its worker answers."* ⚑ The reply is delivered as `THE_APP_ITSELF`, which gives no
      // piece — **property 2 by construction rather than by an exemption.** ⚑ **D-016** — each tier's
      // work is the give that started it.
      const { brobot, pm, workerTools, workerPiece } = await aChainOfThree()
      // ⚠️ **The premise of the whole section, asserted**: the parent really is holding open work.
      expect(openTasksOf(pm)).toHaveLength(1)

      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece: workerPiece,
        outcome: 'done',
        summary: 'it is the login flow',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      // 🔴 **It LANDED**, which is the assertion a refusal would have taken away.
      expect(replied.delivered).toBe('held')
      await waitFor(
        () =>
          ledger(pm).some(
            (event) =>
              (event.type === 'message_queued' || event.type === 'user_turn') &&
              event.text.includes('it is the login flow'),
          ),
        'the reply to reach the project manager',
      )
      // ⛔ **And it opened nothing**: the PM still holds exactly the one piece BroBot gave it.
      expect(openTasksOf(pm)).toHaveLength(1)
      expect(store.piecesOwnedBy(pm)).toHaveLength(1)
      expect(store.piecesOwnedBy(pm)[0]?.giver).toBe(brobot)
    })

    // ⛔ **`…and a second piece of WORK to that same parent, at that same moment, is refused` is
    // gone with its subject** (D-016): it was the one-open-task rail's refusal, and a second give
    // to a busy parent is held now.

    it('⚠️ a reply carries no finishing line either — it names a piece and hands none over', async () => {
      // 🔴 **`replyText` renders the piece's label because a parent is reading it**, so an
      // assertion on the label alone would pass here for the wrong reason. ⛔ The assertion is on
      // the LINE — `412` wrote it this way and `415` is the dispatch that could have broken it.
      const { pm, workerTools, piece, label } = await aPmAndItsWorker()
      await callOn(workerTools, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'finished it',
      })
      await waitFor(() => saidToProvider(pm).length > 0, 'the reply to reach the parent')
      const intoTheParent = saidToProvider(pm).at(-1) ?? ''
      expect(intoTheParent).toContain(label)
      expect(intoTheParent).not.toContain(FINISHING_LINE)
      expect(store.piecesOwnedBy(pm)).toEqual([])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the fourth property — a reply that cannot be delivered is surfaced, never swallowed
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a reply that landed nowhere leaves a row', () => {
    it('🔴 a parent that cannot be started, and whose record will not take the words: the reply is recorded and the failure is written down', async () => {
      // ⚑ **D-016** — the work is the give that started the worker.
      const { pm, worker, workerTools, piece } = await aPmAndItsWorker()
      await host.close(pm, window)
      // ⚑ **D-017 · R14 — a parent that has merely STOPPED is started by the reply** and reads it;
      // here that start fails: its provider could not bring it back THIS time. ⚠️ **R10: not a
      // provider that no longer has it** — that parent is replaced, and the reply lands in the
      // conversation that took its place.
      const ref = store.find(pm)?.ref
      if (ref === undefined) throw new Error('the parent has no provider ref')
      ToolWatchingRuntime.nextResumeThrows = new ResumeError(
        ref,
        'resume failed: the handshake died',
      )
      // ⚑ **D-030 — a failed start alone KEEPS the words** for the parent's next start
      // (`a-reply-and-its-absence` §5), so they land nowhere only when the parent's record will not
      // take them either. ⚠️ Only that write is refused; every other row goes in.
      const append = store.append.bind(store)
      let refused = 0
      const refusing = vi
        .spyOn(store, 'append')
        .mockImplementation((sessionId, ordinal, event, at) => {
          if (
            sessionId === pm &&
            event.type === 'message_queued' &&
            event.text.includes('nobody is there to read this')
          ) {
            refused += 1
            throw new Error('SQLITE_FULL: database or disk is full')
          }
          append(sessionId, ordinal, event, at)
        })

      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'nobody is there to read this',
      })
      refusing.mockRestore()
      // ⚑ **The premise**: the start was tried and failed, and the parent's record refused the words
      // once — so nothing holds them for it.
      expect(ToolWatchingRuntime.nextResumeThrows).toBeNull()
      expect(refused).toBe(1)
      expect(
        ledger(pm).some(
          (event) =>
            event.type === 'message_queued' && event.text.includes('nobody is there to read this'),
        ),
      ).toBe(false)
      // ⛔ **The task is closed either way** — `393`'s ordering: the ledger row cannot be
      // conditional on somebody being there to read it.
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      expect(replied.delivered).toBe('not-delivered')
      // ⚑ **D-030 — why, in this app's words**: the store's own message goes to the log, never here.
      expect(replied.why).toBe(THE_RECORD_REFUSED_IT)
      expect(JSON.stringify(replied)).not.toContain('SQLITE_FULL')
      expect(JSON.stringify(replied)).not.toContain('fake_claude_')
      expect(store.piecesOwnedBy(worker)[0]?.state).toBe('answered')

      // 🔴 **The signal.** ⚠️ Until `415` the only trace of an answer that reached nobody was a
      // `console.warn` in a process nobody is watching.
      const rows = ledger(worker).filter((event) => event.type === 'reply_undelivered')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        piece,
        parent: pm,
        because: 'not-delivered',
        detail: THE_RECORD_REFUSED_IT,
      })
      // ⚑ **In the REPLIER's ledger**, which is the one place that is always writable: the
      // conversation this row is about is the one whose record would not take the words.
      expect(ledger(pm).filter((event) => event.type === 'reply_undelivered')).toEqual([])
    })

    it('⛔ …and a reply that LANDED writes no such row — the control', async () => {
      // ⚑ **D-016** — the work is the give that started the worker.
      const { pm, worker, workerTools, piece } = await aPmAndItsWorker()
      // ⚑ **D-017 · R14 — one fact over from the subject**: the parent has stopped the same way,
      // and its provider still has it, so the reply STARTS it and lands.
      await host.close(pm, window)
      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'this one arrives',
      })
      expect(replied.delivered).toBe('sent')
      expect(ledger(worker).filter((event) => event.type === 'reply_undelivered')).toEqual([])
      expect(
        ledger(pm).some(
          (event) => event.type === 'user_turn' && event.text.includes('this one arrives'),
        ),
      ).toBe(true)
    })

    it('🔴 D-010 · a parent already holding a message HOLDS the reply beside it — landed, not lost', async () => {
      // ⛔ **The state `393` named and could not finish**: *"a parent with two children that both
      // finish while it is busy hears from one of them."* ⚑ D-010 finished it: the mailbox holds
      // any number, so the reply waits its turn behind the person's message.
      // ⚑ **D-016** — the work is the give that started the worker.
      const { pm, worker, workerTools, piece } = await aPmAndItsWorker()
      // The parent is mid-turn and holding a message a person wrote.
      await host.send(pm, 'a person types', window)
      await cardOn(pm)
      await host.queueMessage(pm, 'and holds this', window)

      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece,
        outcome: 'done',
        summary: 'the reply that waits its turn',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      expect(replied.delivered).toBe('held')
      expect(ledger(worker).filter((event) => event.type === 'reply_undelivered')).toEqual([])
      // ⚑ **Both wait, the person's first** — ledger order is delivery order.
      const held = ledger(pm).flatMap((event) =>
        event.type === 'message_queued' ? [event.text] : [],
      )
      expect(held).toHaveLength(2)
      expect(held[0]).toBe('and holds this')
      expect(held[1]).toContain('the reply that waits its turn')

      // ⚑ **And each goes as its own turn**: the parent's turn ends, the person's message goes and
      // parks on a card of its own, and answering that lets the reply go.
      const cards = (): number =>
        ledger(pm).filter((event) => event.type === 'permission_request').length
      const before = cards()
      // ⚠️ The pm is a PERSON's conversation, already claimed by `window` — answered directly.
      await host.respondPermission(pm, await cardOn(pm), { outcome: 'allow' }, window)
      await waitFor(
        () => saidToProvider(pm).some((text) => text.includes('and holds this')),
        "the person's message",
      )
      await waitFor(() => cards() > before, "the person's message's own card")
      await host.respondPermission(pm, await cardOn(pm), { outcome: 'allow' }, window)
      await waitFor(
        () => saidToProvider(pm).some((text) => text.includes('the reply that waits its turn')),
        'the reply reaching the parent',
      )
    })

    it('🔴 which answers land is a TABLE over REPLY_DELIVERIES, so a fifth cannot inherit silence', () => {
      // ⛔ **`an-unenumerated-state-counts-as-success`, one vocabulary over.** A new delivery answer
      // that nobody classified would otherwise mean *"landed"* by being forgotten.
      expect(Object.keys(REPLY_LANDED).sort()).toEqual([...REPLY_DELIVERIES].sort())
      expect(REPLY_DELIVERIES.filter((one) => REPLY_LANDED[one])).toEqual(['sent', 'held', 'kept'])
      // ⚑ **`held` is landed**: it is in the parent's mailbox and goes when its turn ends. ⛔ Its
      // unlanded twin `parent-is-holding-a-message` is gone since D-010 — a busy parent holds it.
      expect(REPLY_LANDED.held).toBe(true)
      // ⚑ **D-030 · and so is `kept`**: it is in the parent's ledger and goes at its next start.
      expect(REPLY_LANDED.kept).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · 628 · the check-in that went the wrong way, and the refusal that now says so
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **`HO-095` §3 · the defect this file's own subject produced one dispatch later.**
   *
   * ⛔ **BroBot told its project manager, verbatim:** *"Send me the plan with `message_agent` as a
   * question — not `reply_to_parent`. Do not close this task."* ⚑ The worry was right and the
   * remedy was wrong, and the first consequence is the one measured here: the call was refused
   * `no-task-you-gave-that-agent` (`not-a-piece-you-gave` since D-016), which was TRUE and told
   * her nothing she could act on.
   *
   * ⚠️ **§1 of this file is the shape from the other end** — a parent asking DOWN about work it
   * gave. ⛔ This is a child asking UP about work it HOLDS, and the two lookups are different
   * halves of one reading (`tasksVisibleTo`; `pieceBoard` since D-016).
   */
  describe('§6 · a child speaking UP about work it holds', () => {
    it('🔴 `message_agent` naming a task the caller HOLDS is refused, and named as the mistake', async () => {
      // ⚑ **Through the real door**: BroBot gives the PM a piece of work, so the PM holds a piece —
      // ⚑ **D-016** — the give that started it.
      const { brobot, pm, pmTools } = await aChainOfThree()
      const held = store.piecesOwnedBy(pm)[0]
      expect(held, 'the PM holds no piece, so nothing below is being measured').toBeDefined()

      // ⛔ **The exact call `HO-095` §3 measured**: the manager, naming the task it HOLDS,
      // addressed to the conversation that gave it.
      const refused = await callOn(pmTools, 'message_agent', {
        agent: brobot,
        text: 'here is my plan, may I proceed?',
        kind: 'follow-up',
        piece: held?.piece,
      })

      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      // 🔴 **The new word, and it names the MISTAKE rather than the state** — `that-agent-is-you`'s
      // own shape (`424`), one object over.
      expect(refused.rail).toBe('that-is-work-you-hold')
      const reason = String(refused.reason)
      expect(reason).toContain('HOLDING')
      expect(reason).toContain('ask_question')
      expect(reason).toContain('stays yours and stays open')
      expect(reason).toContain('reply_to_parent')
      // ⚑ **Nothing was sent**, which every sentence in this table says and a caller must never
      // have to guess.
      expect(saidToProvider(brobot)).toEqual([])
    })

    it('⛔ …and the remedy it names WORKS, which is what makes it a remedy', async () => {
      // 🔴 **The brief's criterion 4: performable BY THE REFUSED CALLER**, not merely present in a
      // string. ⚠️ `a-priced-cost-can-name-a-remedy-that-does-not-exist` is what this is measured
      // against — so the same caller, the same task, makes the call the sentence named.
      const { brobot, pm, pmTools } = await aChainOfThree()
      const held = store.piecesOwnedBy(pm)[0]

      const asked = await callOn(pmTools, 'ask_question', {
        piece: held?.piece,
        question: 'here is my plan, may I proceed?',
        // ⚑ **The vocabulary's own word, read off the refusal rather than guessed** —
        // `ask_question:who_answers` is `['the-parent', 'a-person']`, and `611` kept the first
        // spelling when it renamed the verb.
        who_answers: 'the-parent',
      })

      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      // ⛔ **The work is still the PM's and still open**, which is the clause the sentence promises
      // — and the one `reply_to_parent` would have broken.
      expect(store.piecesOwnedBy(pm)[0]?.state).not.toBe('answered')
      expect(TASK_IS_OPEN[store.piecesOwnedBy(pm)[0]?.state ?? 'answered']).toBe(true)
      // ⚑ **And the question is RECORDED**, which is consequence 2 of `HO-095` §3 closed: it is
      // the absence of this row that made the manager read as *idle* while she waited.
      expect(host.questionsWaitingOn(brobot).length).toBeGreaterThan(0)
    })

    it('⚠️ an id that is NOBODY’s still meets the old refusal — the repair is a split', async () => {
      // ⛔ **The new rail takes ONE case and not the family**, which is what keeps
      // `not-a-piece-you-gave` (D-016's name for `no-task-you-gave-that-agent`) truthful where it
      // is the truth.
      const { brobot, pmTools } = await aChainOfThree()
      const refused = await callOn(pmTools, 'message_agent', {
        agent: brobot,
        text: 'about that',
        kind: 'follow-up',
        piece: 'work_00000000-0000-4000-8000-000000000000',
      })
      expect(refused.rail).toBe('not-a-piece-you-gave')
      expect(String(refused.reason)).toContain('not a piece you gave')
    })
  })
})
