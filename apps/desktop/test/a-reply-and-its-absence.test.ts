import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, ResumeError } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { isGiverStallNotice, RuntimeHost } from './helpers/giver-notice-host'
import type { RuntimeEventSink } from './helpers/giver-notice-host'
import {
  REPLY_ADDRESSING_KEYS,
  TOOL_NAMES,
  agentCallerId,
  agentToolsFor,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import {
  REPLY_DELIVERIES,
  REPLY_RAILS,
  REPLY_SUMMARY_LIMIT,
  refuseReply,
  replyPermanenceOf,
  replyRetryableOf,
} from '../src/main/runtime/reply-rails'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { REQUEST_STATES } from '../src/shared/questions'
import { TASK_IS_OPEN, TASK_OUTCOMES, TASK_STATES, derivePieces } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **393 · a reply, and its absence** — Slice 4 S2 + S3, HO-007 criteria 3 and 4, HO-015 §1.3.
 *
 * ## ⛔ Why one suite and not two
 *
 * The brief's own sentence: *"what makes a reply findable is exactly what makes its absence
 * detectable."* ⚑ **The absence is not a second mechanism — it is the SAME fold, read where no
 * `task_replied` (`work_replied` since D-016) landed.** `silent` existed before this dispatch and fired on every ordinary turn
 * ending, because there was no reply for a task to be missing; §3 is where it starts meaning
 * something, and it means it because §2 exists.
 *
 * ## ⚠️ Where the readings diverge, which is where every section is written
 *
 *  - **§1** the rails — each refusal paired with the identical call one fact over, so a test that
 *    stops reaching the rule goes red rather than green.
 *  - **§2** the reply — and the fold, over the ledger ALONE in an otherwise empty database.
 *  - **§3** the absence — produced by a real sequence, and SEEN by the parent through the only
 *    reader that outlives the conversation that held the work.
 *  - **§4** the resource (the document until D-016) — a reply too long to inline, and the
 *    refusals that leave the piece open.
 *  - **§5** delivery — the four answers, and the one that proves a reply mints no task — and since
 *    `710` the two that prove WHO delivers it: the app, never the child (`393` M5's killers).
 *  - **§6** a restart — a cold resume, then a reply, with the destination derived after the app
 *    that recorded it has gone.
 *  - **§7** the censuses.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools, real filesystem.** The only double is
 * the provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

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

/** `373`'s double; its registry is shared so a restart can find refs the first launch issued. */
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

describe('393 · a reply, and its absence', () => {
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
  let secondWindow: RecordingSink
  let claimed: Set<string>
  /**
   * ⚠️ **A fresh identity per pair, so no pair can read another pair's conversations.** ⛔ Within a
   * pair it is load-bearing as well: `341`'s `profile-already-live`, re-keyed by `428` to PARENT +
   * IDENTITY, refuses ONE parent a second live conversation of an identity it already has — so a
   * section needing a second child needs a second identity, and reusing a slug would be measuring
   * that rail instead of the one the test is about.
   */
  let pairs: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-reply-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-reply-root-'))
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
    secondWindow = new RecordingSink('webContents:2')
    claimed = new Set<string>()
    pairs = 0
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string, projectSlug?: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      {
        provider: 'claude',
        profileId,
        approvalMode: 'ask',
        cwd: root,
        ...(projectSlug === undefined ? {} : { projectSlug }),
      },
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

  /**
   * ⚑ **The toolset a session's calls are driven through.**
   *
   * ⛔ **Built the way the launch builds it, against the CURRENT host** — `agentToolsFor(host, id)`,
   * which is the exact expression both launch paths use and which a source census in
   * `a-parent-that-survives-a-restart.test.ts` pins verbatim. ⚠️ **That matters most in §6**: after a
   * restart the object a resumed child would really call closes over the NEW host, and a toolset
   * captured from the first launch would be driving a host that has been closed.
   *
   * ⚑ **The capture is still taken and still asserted** — see the test below — so *"the provider was
   * actually handed one"* remains a measurement rather than an assumption.
   */
  const toolsOf = (sessionId: string): AgentToolset => agentToolsFor(host, sessionId)

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

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

  /** Answer the open card so the turn runs to its own terminal (`379`'s helper, unchanged). */
  /**
   * ⚑ **496 · end a conversation whose work is still being driven — as the PERSON.**
   *
   * ⛔ **Since HO-034 §1 an agent may not end a conversation somebody is being asked something in**,
   * and every turn the Fake drives in `ask` mode parks on a person's card — so the only ending that
   * still reaches work in flight is the one a person performs. ⚠️ **It is the same teardown**:
   * `endAgent` escalates to `THE_APP_ITSELF` and calls exactly this, so the turn it interrupts is
   * written by the same code either way and what these tests measure is unchanged.
   */
  const thePersonEndsIt = async (sessionId: string): Promise<void> => {
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.close(sessionId, window)
  }

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const before = ledger(sessionId).filter((event) => event.type === 'turn').length
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).filter((event) => event.type === 'turn').length > before,
      'the turn to reach its own terminal',
    )
  }

  /**
   * ⚑ **D-016 · a give, by the agent's profile** — to a sibling identity it starts that agent's
   * conversation, and to the worker's own it reaches the worker. Returns who holds the piece.
   */
  const giveTo = async (
    tools: AgentToolset,
    profile: string,
    text: string,
  ): Promise<{ agent: string; piece: string; label: string }> => {
    const given = await callOn(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: text,
      brief: text,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      agent: given.agent as string,
      piece: given.piece as string,
      label: given.label as string,
    }
  }

  /**
   * `373`'s helper: a PM in a window with one child of its own, started through the real door —
   * ⚑ **D-016 · a give**, so the child holds the piece it opened and its brief is its first turn
   * (in the PM's `ask`, parked on a card).
   */
  const aPmAndItsWorker = async (
    text: string,
    options: { pmProfile?: string; workerProfile?: string; projectSlug?: string } = {},
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    siblings: readonly string[]
    task: string
  }> => {
    const nth = ++pairs
    const pmProfile = options.pmProfile ?? `pm-${String(nth)}`
    const workerProfile = options.workerProfile ?? `worker-${String(nth)}`
    // ⚠️ **Three identities, because a give reaches the ONE conversation a giver has with an
    // agent** (D-016): a section that needs a SECOND child of this same PM needs a second identity.
    // ⛔ No grant is written: any agent may give work to any agent this app holds (D-014).
    const siblings = [workerProfile, `${workerProfile}-b`, `${workerProfile}-c`]
    for (const one of siblings) await bringIdentityIntoBeing(one)
    const pm = await personOpens(pmProfile, options.projectSlug)
    const pmTools = toolsOf(pm)
    const given = await giveTo(pmTools, workerProfile, text)
    return { pm, worker: given.agent, pmTools, siblings, task: given.piece }
  }

  /** A PM, a worker, and one piece of work already given — the state every section starts from. */
  const workWasGiven = (
    text = 'the work',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    siblings: readonly string[]
    task: string
  }> => aPmAndItsWorker(text)

  const taskOf = (sessionId: string, piece: string) =>
    store.piecesOwnedBy(sessionId).find((one) => one.piece === piece)

  const reply = async (
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => callOn(toolsOf(sessionId), 'reply_to_parent', args)

  /** ⚑ D-030 · the receipt a replier READS — its words, where `reply` reads the structured answer. */
  const replyReceipt = async (
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const tool = toolsOf(sessionId).tools.find((one) => one.name === 'reply_to_parent')
    if (tool === undefined) throw new Error('no reply_to_parent')
    return (await tool.call(args)).text
  }

  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the rails — each refusal paired with the identical call one fact over
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the rails, before the tool', () => {
    it('🔴 a conversation nobody gave work to is refused, and the same call with a real task lands', async () => {
      // ⚠️ **§4.1's *"a caller with no parent"*, and it is the ORDINARY answer rather than an error
      // path.** A first launch has no parent and no tasks; the honest thing to tell it is that there
      // is no such task, in the same words as every other miss.
      const alone = await personOpens('lonely')
      const refused = await reply(alone, {
        piece: 'work_00000000-0000-0000-0000-000000000000',
        outcome: 'done',
        summary: 'nothing was ever given to me',
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('no-piece-by-that-name')
      // 🔴 **`permanent` since `424`** (HO-023 §2.1, `422` row 8). ⛔ The word used to be
      // `while-this-holds` on the argument that *"a conversation that has not been given work yet
      // may be given some in the next minute"* — which is about a DIFFERENT id. A piece id is
      // `work_<uuid4>`, minted by this app, so the one in this call never becomes this
      // conversation's; what the caller must change is the call, and `list_tasks` is how.
      expect(refused.permanence).toBe('permanent')
      expect(refused.retryable).toBe(false)

      // ⛔ **The same call one fact over.** Nothing about the arguments changed except the id, and
      // the fact that moved is *"this conversation has been given work"*.
      const { worker, task } = await workWasGiven()
      const landed = await reply(worker, { piece: task, outcome: 'done', summary: 'done it' })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
    })

    it("🔴 another conversation's task id is refused in the SAME words, so probing enumerates nothing", async () => {
      // ⛔ **The addressing rail, and it is structural rather than ordered** (HO-015 §1.3). The
      // lookup never leaves the caller's own ledger, so *"not yours"* and *"no such thing"* are not
      // two answers that had to be folded — they are one absence.
      const mine = await workWasGiven('yours')
      const theirs = await workWasGiven('mine')
      const trespass = await reply(mine.worker, {
        piece: theirs.task,
        outcome: 'done',
        summary: 'a task that is not mine',
      })
      const invented = await reply(mine.worker, {
        piece: 'work_11111111-1111-1111-1111-111111111111',
        outcome: 'done',
        summary: 'a task nobody ever minted',
      })
      // ⚑ **BYTE-IDENTICAL apart from the name each call spelled** — `380`'s comparison for
      // `no-such-document`. A caller that could tell the two apart could walk ids and learn which
      // work exists. ⚑ **D-016** — the detail echoes what the caller named and nothing the app
      // found, so that echo is the one difference, and it is the caller's own.
      expect({ ...trespass, detail: null }).toEqual({ ...invented, detail: null })
      expect(trespass.detail).toEqual({ piece: theirs.task })
      expect(invented.detail).toEqual({ piece: 'work_11111111-1111-1111-1111-111111111111' })
      expect(trespass.rail).toBe('no-piece-by-that-name')
      // ⛔ **And the world did not move**: the other conversation's task is untouched and still open.
      expect(taskOf(theirs.worker, theirs.task)?.state).toBe('working')
      // ⚠️ **The paired positive over the SAME caller** — one fact over is which id it named.
      const own = await reply(mine.worker, {
        piece: mine.task,
        outcome: 'done',
        summary: 'the one I was actually given',
      })
      expect(own.outcome).toBe('ok')
    })

    it('🔴 a second reply to one task is refused, PERMANENTLY, and a sibling task still lands', async () => {
      // ⚑ **§4.3 answered in the payload, which is what the brief asked for by name**: it is a
      // refusal, and it is permanent, and the caller is told so rather than having to infer it.
      const { worker, pmTools, siblings, task } = await workWasGiven('the first')
      expect((await reply(worker, { piece: task, outcome: 'done', summary: 'once' })).outcome).toBe(
        'ok',
      )
      const again = await reply(worker, { piece: task, outcome: 'failed', summary: 'twice' })
      expect(again.rail).toBe('piece-already-ended')
      expect(again.permanence).toBe('permanent')
      expect(again.retryable).toBe(false)
      expect((again.detail as { state?: string }).state).toBe('answered')
      expect(again.reason).toContain('You already replied')
      expect(again.reason).toContain('no further reply is owed')
      // ⛔ **And nothing was overwritten.** The second reply's outcome is not on the row — a task
      // answered once keeps the answer a parent has already read.
      expect(taskOf(worker, task)?.outcome).toBe('done')

      // ⚠️ **One fact over: a DIFFERENT piece, same caller, same everything else.** Without this the
      // refusal above would also pass against a tool that refused every second call. ⚑ **D-016** —
      // a second give to the same agent reaches the same worker.
      const second = await giveTo(pmTools, siblings[0] as string, 'the second')
      expect(second.agent).toBe(worker)
      const next = second.piece
      expect(next).not.toBe(task)
      expect(
        (await reply(worker, { piece: next, outcome: 'blocked', summary: 'the other one' }))
          .outcome,
      ).toBe('ok')
    })

    it('⚠️ …and a withdrawn task refuses under the same rail, naming which ending it was', async () => {
      // ⛔ **Three endings reach one rail and `detail.state` tells them apart** — because a model
      // deciding what to do next needs *you already did this* to be distinguishable from *somebody
      // took it back*.
      // ⛔ **415 · the running one is ANSWERED before the held one is given** (HO-021 §1 property
      // 3). ⚑ The subject is the WITHDRAWN task below and the rail it refuses a reply under, and
      // both are reached exactly as before — what changed is that the conversation is not holding
      // two open pieces of work on the way there.
      const { worker, pmTools, siblings, task } = await workWasGiven('the running one')
      await cardOn(worker)
      const closed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'the running one is done',
      })
      expect(closed.outcome, JSON.stringify(closed)).toBe('ok')
      // ⚑ **D-016** — the held one is a second give, its brief held behind the running turn's card.
      // ⛔ **Called directly, not through `giveTo`**, so the raw result is read: a held give carries
      // no `message` property (`650` F3 — *reported as not queued*).
      const held = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: siblings[0] as string,
        title: 'the held one',
        brief: 'the held one',
      })
      expect(held.outcome, JSON.stringify(held)).toBe('ok')
      expect(held.agent).toBe(worker)
      expect(held).not.toHaveProperty('message')
      const heldTask = held.piece as string
      const heldRow = [...ledger(worker)]
        .reverse()
        .find((event) => event.type === 'message_queued' && event.text === 'the held one')
      if (heldRow?.type !== 'message_queued' || heldRow.messageId === undefined) {
        throw new Error('the held message was not recorded')
      }
      // ⚠️ **A window has to take the child over before it may cancel for it** — a given child has
      // no owner, and `cancelQueuedMessage` is a window's verb.
      host.claimSession(worker, window)
      claimed.add(worker)
      await host.cancelQueuedMessage(worker, heldRow.messageId, window)
      expect(taskOf(worker, heldTask)?.state).toBe('withdrawn')

      const refused = await reply(worker, {
        piece: heldTask,
        outcome: 'done',
        summary: 'work nobody wanted any more',
      })
      expect(refused.rail).toBe('piece-already-ended')
      expect((refused.detail as { state?: string }).state).toBe('withdrawn')
      expect(refused.reason).toContain('It was taken back')
      expect(refused.reason).toContain('no further reply is owed')
      // ⚑ **One fact over: a sibling task, still open, in the same conversation.** ⛔ **415 · it is
      // given AFTER the cancel rather than before it** — the conversation is holding nothing open
      // at that moment, which is the only time a second piece of work is admitted (HO-021 §1
      // property 3). ⚠️ The control is unchanged in what it controls for: a reply that lands, from
      // the same caller, against a task that has not ended.
      const alive = await giveTo(pmTools, siblings[0] as string, 'the live one')
      expect(alive.agent).toBe(worker)
      const open = alive.piece
      expect(open).not.toBe(heldTask)
      expect(
        (await reply(worker, { piece: open, outcome: 'done', summary: 'the live one' })).outcome,
      ).toBe('ok')
    })

    it('🔴 a summary one unit over the bound is refused; one unit under it lands', async () => {
      // ⛔ **The literals, not `REPLY_SUMMARY_LIMIT ± 1`** — `380`'s lesson on `MAX_DOCUMENT_BYTES`:
      // a bound written as the constant moves with it and pins nothing.
      expect(REPLY_SUMMARY_LIMIT).toBe(1280)
      const over = await workWasGiven('long')
      const refused = await reply(over.worker, {
        piece: over.task,
        outcome: 'done',
        summary: 'x'.repeat(1281),
      })
      expect(refused.rail).toBe('summary-too-long')
      expect(refused.permanence).toBe('while-this-holds')
      expect(refused.retryable).toBe(true)
      expect(refused.detail).toMatchObject({ limit: 1280, was: 1281 })
      expect(refused.reason).toContain(
        'the summary is 1,281 characters; the most is 1,280, so cut at least 1.',
      )
      // ⚑ **Nothing was shortened and nothing was recorded** — HO-007 S2's *"no silent truncation
      // or erasure anywhere on this path"*, asserted as the task still being open.
      expect(taskOf(over.worker, over.task)?.state).toBe('working')
      expect(ledger(over.worker).some((event) => event.type === 'work_replied')).toBe(false)
      // ⚠️ **And the sentence sends the caller to the remedy that exists**, rather than describing
      // how the app stores things.
      expect(refused.reason).toContain('resource_path')
      expect(refused.reason).toContain('Nothing was shortened for you')
      // 🔴 **425 · and now the same remedy as a WORD, so the ledger can carry it** (HO-023 §2.2).
      // ⚑ **This is the cleanest rail in the whole dispatch**: the refusal is about the caller's own
      // words, the caller can change them, and the act needs nothing from anybody else. ⛔ The word
      // requires an ARTIFACT and never a provider verb — `422` §3 — which is why it says *a file*
      // and the sentence one line up says `resource_path`.
      expect(refused.remedy).toBe('shorten-the-summary-and-attach-the-long-form')

      // ⛔ **One unit under, and it is the SAME call otherwise.**
      const under = await reply(over.worker, {
        piece: over.task,
        outcome: 'done',
        summary: 'x'.repeat(1280),
      })
      expect(under.outcome, JSON.stringify(under)).toBe('ok')
      expect(taskOf(over.worker, over.task)?.state).toBe('answered')
      // ⚑ **425 · the admitted call carries no remedy at all**, because there is nothing left to do.
      expect(under).not.toHaveProperty('remedy')
    })

    it('🔴 every spelling of a destination is REFUSED, never overridden — and the same call without it lands', async () => {
      // 🔴 **`371`'s defect, said out loud and not repeated.** That dispatch silently overrode a
      // `parentSessionId` and told the caller its argument had been taken; HO-015 §1.3 rules that a
      // model-supplied parent address is an addressing primitive an agent could aim, and the answer
      // to one is a refusal.
      const { worker, task, pm } = await workWasGiven()
      for (const aimed of REPLY_ADDRESSING_KEYS) {
        const refused = await reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'aimed',
          [aimed]: pm,
        })
        expect(refused.outcome, aimed).toBe('refused')
        expect(refused.rail, aimed).toBe('malformed-request')
        expect(refused.permanence, aimed).toBe('permanent')
        // ⛔ **The refusal NAMES the key**, so a model learns which argument it must drop rather
        // than being told its call was malformed and guessing.
        expect(JSON.stringify(refused.detail), aimed).toContain(aimed)
        // ⚠️ **And nothing was recorded on any of the attempts.**
        expect(taskOf(worker, task)?.state).toBe('working')
      }
      expect(REPLY_ADDRESSING_KEYS.length).toBeGreaterThan(5)
      // ⚑ **One fact over: the identical call with the key removed.**
      const landed = await reply(worker, { piece: task, outcome: 'done', summary: 'aimed' })
      expect(landed.outcome).toBe('ok')
    })

    it('⚠️ an outcome the vocabulary does not hold is refused BY NAME, and each of the three lands', async () => {
      // ⛔ **`325`'s `holdersOf` from the other side**: a value the validator has not been taught is
      // a refusal, never a pass — and the refusal names the three so a model that guessed is told
      // what to say.
      const { worker, task } = await workWasGiven()
      const refused = await reply(worker, {
        piece: task,
        outcome: 'succeeded',
        summary: 'a word nobody taught it',
      })
      expect(refused.rail).toBe('malformed-request')
      const problems = (refused.detail as { problems?: string[] }).problems ?? []
      expect(problems.join(' ')).toContain('done, blocked, failed')
      expect(taskOf(worker, task)?.state).toBe('working')

      // ⚑ **All three, each on its own task** — a positive that fires only for `done` would leave
      // two thirds of the vocabulary unmeasured.
      for (const outcome of TASK_OUTCOMES) {
        const made = await workWasGiven(`work for ${outcome}`)
        const landed = await reply(made.worker, {
          piece: made.task,
          outcome,
          summary: `it went ${outcome}`,
        })
        expect(landed.outcome, outcome).toBe('ok')
        expect(taskOf(made.worker, made.task)?.outcome, outcome).toBe(outcome)
      }
    })

    it('⛔ an empty summary is refused, and one character is not', async () => {
      const { worker, task } = await workWasGiven()
      const refused = await reply(worker, { piece: task, outcome: 'done', summary: '   ' })
      expect(refused.rail).toBe('malformed-request')
      expect(((refused.detail as { problems?: string[] }).problems ?? []).join(' ')).toContain(
        'summary: must not be empty or blank',
      )
      expect((await reply(worker, { piece: task, outcome: 'done', summary: 'x' })).outcome).toBe(
        'ok',
      )
    })

    it('⚠️ a PERSON asking gets the ordinary answer, not an exemption and not an error', async () => {
      // ⛔ **The shape `assertMayReach` uses read from the other end**: a person is not refused by a
      // rule, they simply hold no tasks. ⚑ And this is the call that would throw if the host reached
      // for a session id it had not been given.
      const { worker, task } = await workWasGiven()
      const asPerson = await host.replyToParent(
        {
          piece: task,
          outcome: 'done',
          summary: 'a person typing',
          resourcePaths: [],
          needsUserAction: false,
        },
        { ownerId: 'webContents:1' },
      )
      expect(asPerson.ok).toBe(false)
      expect(asPerson.ok === false && asPerson.refusal.rail).toBe('no-piece-by-that-name')
      // ⚑ **One fact over: the same task, asked by the conversation that holds it.**
      const asAgent = await host.replyToParent(
        {
          piece: task,
          outcome: 'done',
          summary: 'the agent',
          resourcePaths: [],
          needsUserAction: false,
        },
        { ownerId: agentCallerId(worker) },
      )
      expect(asAgent.ok).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the reply — the row it writes, and the fold that reads it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a reply closes the task with its outcome', () => {
    it('🔴 criterion 3 · the task closes, carrying what the agent said and nothing the app invented', async () => {
      const { worker, task } = await workWasGiven()
      expect(taskOf(worker, task)).toMatchObject({ state: 'working', outcome: null, endedAt: null })

      const landed = await reply(worker, {
        piece: task,
        outcome: 'blocked',
        summary: 'the credentials are missing',
        needs_user_action: true,
      })
      expect(landed).toMatchObject({ outcome: 'ok', piece: task, state: 'answered' })
      expect(landed.label).toBe(taskOf(worker, task)?.label)

      const row = taskOf(worker, task)
      expect(row).toMatchObject({
        state: 'answered',
        outcome: 'blocked',
        resources: [],
        needsUserAction: true,
      })
      // ⛔ **`answered` is CLOSED, so it carries an ending** — the one thing `silent` deliberately
      // does not.
      expect(TASK_IS_OPEN.answered).toBe(false)
      expect(typeof row?.endedAt).toBe('number')
    })

    it('⛔ the reply is ONE ledger row, in the CHILD’s ledger, and the parent’s holds no copy', async () => {
      const { pm, worker, task } = await workWasGiven()
      await reply(worker, { piece: task, outcome: 'done', summary: 'the answer' })
      const replies = ledger(worker).filter((event) => event.type === 'work_replied')
      expect(replies).toHaveLength(1)
      // ⚑ **D-016 · `work_replied`**, whose resources are a list — empty when none was handed in.
      expect(replies[0]).toMatchObject({
        piece: task,
        outcome: 'done',
        summary: 'the answer',
        resources: [],
      })
      // ⚑ **Absent, never null** — the shape every optional field on a transcript event uses.
      expect(Object.hasOwn(replies[0] ?? {}, 'needsUserAction')).toBe(false)
      // ⛔ **Nothing of the kind in the parent's ledger.** Two halves of one fact are two things that
      // can disagree; the parent's side is a query.
      expect(ledger(pm).some((event) => event.type === 'work_replied')).toBe(false)
    })

    it('🔴 criterion 2 still holds · the ledger rows ALONE rebuild the answered row exactly', async () => {
      // ⛔ **The only reading that diverges** — a test that keeps the database it derived from passes
      // whether or not the state is stored. This copies the EVENTS into a fold with nothing else.
      const { worker, task } = await workWasGiven()
      await reply(worker, {
        piece: task,
        outcome: 'failed',
        summary: 'it cannot be done',
        needs_user_action: true,
      })
      const derived = store.piecesOwnedBy(worker)
      const rebuilt = derivePieces(worker, store.events(worker))
      expect(rebuilt).toEqual(derived)
      expect(rebuilt[0]).toMatchObject({
        state: 'answered',
        outcome: 'failed',
        needsUserAction: true,
      })
    })

    it('⚠️ the reply lands DURING the turn, so the turn ending finds nothing left to call silent', async () => {
      // 🔴 **The ordering that makes `silent` mean *no reply* rather than *no reply yet*.** A reply
      // is a tool call inside the turn it ends; the task is closed before `turn: completed` arrives,
      // and the fold's `working`-only guard then passes over it.
      const { worker, task } = await workWasGiven()
      await reply(worker, { piece: task, outcome: 'done', summary: 'answered mid-turn' })
      expect(taskOf(worker, task)?.state).toBe('answered')
      await letTheTurnFinish(worker)
      // ⛔ **Still `answered`.** A fold that ran the turn branch over closed rows would overwrite the
      // outcome the agent gave with the app's own guess.
      expect(taskOf(worker, task)).toMatchObject({ state: 'answered', outcome: 'done' })
    })

    it('⚑ a task that already went silent can still be answered, because silence is not an ending', async () => {
      const { worker, task } = await workWasGiven()
      await letTheTurnFinish(worker)
      expect(taskOf(worker, task)?.state).toBe('stalled')
      const late = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'on the next turn',
      })
      expect(late.outcome, JSON.stringify(late)).toBe('ok')
      expect(taskOf(worker, task)).toMatchObject({ state: 'answered', outcome: 'done' })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the absence — produced by a real sequence, and seen by the parent
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the absence, and who can see it', () => {
    it('🔴 a turn that ends with the work unanswered derives to `silent` — from a real sequence', async () => {
      // ⛔ **`374`'s hazard, answered rather than assumed away**: a state no product surface can
      // produce is a green test measuring nothing. Every step here is a real one — a real give
      // through the real door, its brief the child's first turn, a real turn reaching its own
      // terminal.
      const { worker, task } = await workWasGiven()
      expect(taskOf(worker, task)?.state).toBe('working')
      await letTheTurnFinish(worker)
      expect(taskOf(worker, task)).toMatchObject({ state: 'stalled', outcome: null, endedAt: null })
      // ⚑ **OPEN, and that is the ruling `393` did NOT make.** S3 owns *"a turn that ends without a
      // reply fails the task"*; this app can see that nothing was said and cannot see whether that
      // was a failure.
      expect(TASK_IS_OPEN.stalled).toBe(true)
      expect(ledger(worker).some((event) => event.type === 'work_replied')).toBe(false)
    })

    it('⛔ …and a conversation that ENDS with work open leaves it OPEN, which is the other half', async () => {
      // 🔴 **`393` asserted `abandoned` here and HO-018 §2.3 struck it out** (400). ⛔ A conversation
      // that has ended is resumable and a reply really does land through one — §6 of this file
      // measures exactly that — so closing the work was closing something nobody had watched finish.
      // ⚑ **D-016c · a stop moves no piece**: the ending interrupts the turn the brief is parked in
      // on its card, and that turn's own ending is the cause.
      const { worker, task } = await workWasGiven()
      await thePersonEndsIt(worker)
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
        outcome: null,
        endedAt: null,
      })
    })

    it('🔴 the PARENT can see both, through the one reader that outlives the conversation', async () => {
      // ⛔ **This is §5's *"a derived state a parent can see"*, and it is the whole reason
      // `list_tasks` exists.** Every other reader in this app reads LIVE SLOTS — and the sequence
      // that produces the absence deletes the slot.
      const quiet = await workWasGiven('the quiet one')
      await letTheTurnFinish(quiet.worker)
      expect(taskOf(quiet.worker, quiet.task)?.state).toBe('stalled')

      const gone = await giveTo(quiet.pmTools, quiet.siblings[1] as string, 'work that is dropped')
      const goneId = gone.agent
      const goneTask = gone.piece
      await thePersonEndsIt(goneId)

      // ⚑ **D-017 · R2 — the child the person closed has STOPPED, and it is still within the
      // parent's reach**: the status reader and the list name it, where before they could not.
      // ⚑ **D-016 · the card now names the pieces it holds** (`AgentCard.pieces`) — but not WHY one
      // stands where it does: no cause is on the card, so the reader below is still the one that
      // tells a parent that.
      const status = await callOn(quiet.pmTools, 'get_agent_status', { agent: goneId })
      expect(status.outcome, JSON.stringify(status)).toBe('ok')
      expect(
        (status.agent as { pieces: { piece: string }[] }).pieces.map((one) => one.piece),
      ).toEqual([goneTask])
      expect(JSON.stringify(status)).not.toContain('turn_interrupted')
      expect(
        ((await callOn(quiet.pmTools, 'list_agents', {})).agents as { agent: string }[]).map(
          (card) => card.agent,
        ),
      ).toContain(goneId)

      const seen = await callOn(quiet.pmTools, 'list_tasks', {})
      const gaveOut = seen.you_gave as { piece: string; state: string }[]
      expect(gaveOut.map((one) => one.piece).sort()).toEqual([quiet.task, goneTask].sort())
      expect(gaveOut.find((one) => one.piece === quiet.task)?.state).toBe('stalled')
      // ⚑ **Both are `stalled` and the CAUSE is what tells them apart** (400) — one child went quiet
      // at the end of its turn and the other's turn was stopped under it, and a parent acts
      // differently on each. ⛔ A state name alone could not say that, which is why the cause is a
      // field rather than a second word. ⚑ **D-016c** — the stop is never the cause: the ending
      // interrupted the turn the second child was parked in, and that is what it says.
      expect(gaveOut.find((one) => one.piece === goneTask)?.state).toBe('stalled')
      const causes = seen.you_gave as { piece: string; stalled_because: string }[]
      expect(causes.find((one) => one.piece === quiet.task)?.stalled_because).toBe('turn_ended')
      expect(causes.find((one) => one.piece === goneTask)?.stalled_because).toBe('turn_interrupted')
      // ⚑ **And the words say what the state means**, because a state name is this app's vocabulary
      // and a reader needs the fact.
      const answered = await callOn(quiet.pmTools, 'list_tasks', {})
      expect(answered.outcome).toBe('ok')
    })

    it('⚑ a CHILD sees the work it was given, which is the only way it can learn the id to quote', async () => {
      // 🔴 **The piece id is on `work_given` and NOT in the words the parent wrote.** Without this
      // reader a worker could be instructed to call `reply_to_parent` and have no way to name the
      // work — the model-flakiness failure HO-009 §1 exists to remove, manufactured by us.
      // ⚑ **D-016 · the brief's own sender line names its label too**; this is the reader beside it.
      const { pm, worker, task } = await workWasGiven('read the brief')
      const mine = await callOn(toolsOf(worker), 'list_tasks', {})
      const given = mine.you_hold as { piece: string; title: string; giver: string }[]
      expect(given.map((one) => one.piece)).toEqual([task])
      expect(given[0]?.title).toBe('read the brief')
      expect(given[0]?.giver).toBe(pm)
      // ⛔ **And the child's own OUTGOING list is empty** — the two directions are separate answers,
      // and a reader that folded them would tell a worker it had given itself work.
      expect(mine.you_gave).toEqual([])
      // ⚑ **The id it just read is the id that works.**
      expect(
        (
          await reply(worker, {
            piece: given[0]?.piece as string,
            outcome: 'done',
            summary: 'read',
          })
        ).outcome,
      ).toBe('ok')
    })

    it('⚠️ an answered task reports its outcome to the parent, so silence and an answer are distinguishable', async () => {
      const quiet = await workWasGiven('the quiet one')
      const loud = await giveTo(quiet.pmTools, quiet.siblings[1] as string, 'the answered one')
      const loudId = loud.agent
      const loudTask = loud.piece
      await reply(loudId, { piece: loudTask, outcome: 'done', summary: 'here it is' })
      await letTheTurnFinish(quiet.worker)

      // ⚑ The board lists what is open; a piece that was answered is listed when asked for.
      const seen = (await callOn(quiet.pmTools, 'list_tasks', { state: 'all' })).you_gave as {
        piece: string
        state: string
        outcome: string | null
      }[]
      expect(seen.find((one) => one.piece === loudTask)).toMatchObject({
        state: 'answered',
        outcome: 'done',
      })
      // ⛔ **`null` is not a fourth outcome.** It means no reply has landed, which is the whole of
      // what `silent` puts a name on.
      expect(seen.find((one) => one.piece === quiet.task)).toMatchObject({
        state: 'stalled',
        outcome: null,
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the document — a reply too long to inline
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a resource-backed reply', () => {
    const wrote = (name: string, text: string): string => {
      const path = join(root, name)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
      return path
    }

    it('🔴 criterion 12 · the body is kept and hashed, and the reply carries its ID', async () => {
      // ⚑ **D-016 · a resource, where it was a document**: the file is copied byte for byte and
      // hashed, and the reply names it by a `res_…` id. ⛔ There is no number any more — a resource
      // belongs to its piece, and the piece has the label.
      const { worker, task } = await workWasGiven()
      const text = `# The answer\n\n${'detail '.repeat(200)}\n`
      const body = wrote('answer.md', text)
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'the header; the body is the resource',
        resource_paths: [body],
      })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      const resources = landed.resources as string[]
      expect(resources).toHaveLength(1)
      const resourceId = resources[0] as string
      expect(resourceId).toMatch(/^res_/)
      expect(taskOf(worker, task)).toMatchObject({ state: 'answered', resources: [resourceId] })
      // ⛔ **A receipt carries NO PATH** (380), and neither does the row: a resource is reached by
      // its id, and `read_document` is the door that needs no path.
      expect(JSON.stringify(landed)).not.toContain(resourcesRoot(userData))
      expect(JSON.stringify(landed)).not.toContain(body)
      // ⚑ **The row is the PIECE's**, and the hash is the bytes' own.
      const record = store.resource(resourceId)
      expect(record?.piece).toBe(task)
      expect(record?.name).toBe('answer.md')
      expect(record?.bytes).toBe(Buffer.byteLength(text))
      expect(record?.sha256).toMatch(/^[0-9a-f]{64}$/)
    })

    it('🔴 726 · R92 — a resource outside the workspace is kept, and the reply lands', async () => {
      // ⛔ On `main` this was refused (`resource-outside-workspace`, `permanent`): a file an agent
      // offered had to be inside its own conversation's working directory — and BOTH arms below
      // were, since location was asked before existence, so even the missing file was called
      // outside. ⚑ R92: *"any path a person or an agent names is opened if it exists and is
      // readable"* — so the two arms now differ in exactly that one fact.
      const outside = mkdtempSync(join(tmpdir(), 'brobot2-reply-outside-'))
      try {
        const { worker, pmTools, task } = await workWasGiven()
        // ⚑ **The CONTROL first, and it keeps `380`'s sentence measured**: a file that is not there
        // is still refused, and NOTHING is recorded — every file is read before any is kept, so
        // *"nothing was kept and nothing was recorded"* is true because nothing happened.
        const missing = await reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'a body that is not there',
          resource_paths: [join(outside, 'not-written.md')],
        })
        expect(missing.outcome).toBe('refused')
        expect(missing.rail).toBe('resource-unreadable')
        expect(taskOf(worker, task)?.state).toBe('working')
        expect(ledger(worker).some((event) => event.type === 'work_replied')).toBe(false)

        // 🔴 **One fact over — the same folder, a file that IS there — and it lands.**
        const escaped = join(outside, 'answer.md')
        writeFileSync(escaped, '# not in my folder\n')
        const landed = await reply(worker, {
          piece: task,
          outcome: 'done',
          summary: 'a body somewhere else',
          resource_paths: [escaped],
        })
        expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
        const resourceId = (landed.resources as string[])[0] as string
        expect(taskOf(worker, task)).toMatchObject({ state: 'answered', resources: [resourceId] })
        // ⚑ **And the bytes kept are that file's**, read back through the parent's own door.
        const read = pmTools.tools.find((one) => one.name === 'read_document')
        expect((await read!.call({ resource: resourceId })).text).toContain('not in my folder')
      } finally {
        rmSync(outside, { recursive: true, force: true })
      }
    })

    it('⚠️ …and the resource refusal arrives in the resource module’s own words, not translated into this tool’s', async () => {
      const { worker, task } = await workWasGiven()
      const refused = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'a body that is not there',
        resource_paths: [join(root, 'nothing-here.md')],
      })
      expect(refused.rail).toBe('resource-unreadable')
      // ⚑ **D-016 · door-neutral words**: three doors keep a file (a reply, a give's inputs and
      // `update_work`), and each records nothing when one is refused — so the sentence says so.
      expect(refused.reason).toContain('nothing was kept and nothing was recorded')
      // ⛔ **`341`'s shape, whichever vocabulary built it** — a model meets one grammar everywhere.
      // ⚑ **The complete payload shape is pinned below as data.** `425` added `remedy` to every
      // registered vocabulary at once for exactly this reason.
      expect(Object.keys(refused).sort()).toEqual([
        'detail',
        'outcome',
        'permanence',
        'rail',
        'reason',
        'remedy',
        'retryable',
      ])
      // 🔴 **425 · and this rail is one of the four whose remedy was written from nothing.** The
      // model is told the act in prose AND handed the word, which is what makes the durable row able
      // to say it without a second spelling of the sentence.
      expect(refused.remedy).toBe('offer-a-workspace-markdown-file-that-reads')
      expect(refused.reason).toContain('offer that path instead')
    })

    it('⚑ the parent can read the body it was told about, and the summary stayed the header', async () => {
      const { worker, pmTools, task } = await workWasGiven()
      const body = wrote('long.md', '# The long form\n\nEverything that did not fit.\n')
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'the header only',
        resource_paths: [body],
      })
      const resourceId = (landed.resources as string[])[0] as string
      const read = await callOn(pmTools, 'read_document', { resource: resourceId })
      expect(read.outcome, JSON.stringify(read)).toBe('ok')
      // ⚑ **675 · the body is the answer's PROSE**, and the payload names only what it is (`as`) —
      // the text was said twice until then, doubling a model's context on every read.
      expect(read.content).toEqual({ as: 'markdown' })
      const tool = pmTools.tools.find((one) => one.name === 'read_document')
      expect((await tool!.call({ resource: resourceId })).text).toContain(
        'Everything that did not fit.',
      )
      expect(read.piece).toBe(task)
      // ⛔ **The summary is not the body and was never merged with it.**
      const replied = ledger(worker).find((event) => event.type === 'work_replied')
      expect(replied?.type === 'work_replied' && replied.summary).toBe('the header only')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · delivery — every answer, and the one that proves a reply is not work
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what became of the words', () => {
    it('🔴 an idle parent receives the reply as an ordinary turn — and is given NO task by it', async () => {
      const { pm, worker, task } = await workWasGiven()
      const before = store.piecesOwnedBy(pm)
      const label = taskOf(worker, task)?.label ?? 'no label'
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'the words the parent reads',
      })
      expect(landed.delivered).toBe('sent')
      const arrived = ledger(pm)
        .filter((event) => event.type === 'user_turn')
        .at(-1)
      expect(arrived?.type === 'user_turn' && arrived.text).toContain('the words the parent reads')
      // ⚑ **D-016 · the words name the piece by its label**, which is how a parent reads it.
      expect(arrived?.type === 'user_turn' && arrived.text).toContain(label)
      // 🔴 **The mint is untouched.** A reply reaches `queueMessage` as `THE_APP_ITSELF`, and only a
      // give opens a piece (D-016) — so answering work does not hand the parent new work. The arms
      // below are what keeps the app's caller.
      expect(store.piecesOwnedBy(pm)).toEqual(before)
      expect(ledger(pm).some((event) => event.type === 'work_given')).toBe(false)
      // ⚑ **710 · `707` F-5 — delivered AS THE APP, measured where the two readings part**: the
      // app's words carry no agent's declared kind, and the replier's own ledger gets no receipt of
      // a message it did not send (`393` M5 hands the delivery to the CHILD, and both appear).
      expect(arrived).not.toHaveProperty('says')
      expect(ledger(worker).some((event) => event.type === 'message_sent')).toBe(false)
    })

    /**
     * ⚑ **710 · `707` F-5 — the replier's own reach is never asked**, which is `deliverReply`'s stated
     * property: the app delivers the answer, so a child a person narrowed to `can_message: none` is
     * still heard by the parent that gave it the work. ⛔ Delivered as the child, it would be refused
     * at the words door and the reply would reach nobody — `not-delivered` about a task already closed.
     */
    it('⚑ a child a person narrowed to no reach at all is still heard — the app delivers its answer', async () => {
      const { pm, worker, siblings, task } = await workWasGiven()
      expect(store.setCapabilities(siblings[0] as string, { canMessage: 'none' })).toBe(true)
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'heard despite the narrowing',
      })
      expect(landed.delivered).toBe('sent')
      expect(
        ledger(pm).some(
          (event) =>
            event.type === 'user_turn' && event.text.includes('heard despite the narrowing'),
        ),
      ).toBe(true)
    })

    it('⚠️ a busy parent HOLDS it — and, since D-010, holds a second child’s reply beside it', async () => {
      const { pm, worker, pmTools, siblings, task } = await workWasGiven('first')
      // ⛔ **Busy for real**: a turn the app started and parked on a card.
      await host.send(pm, 'the parent is thinking', window)
      await cardOn(pm)
      const held = await reply(worker, { piece: task, outcome: 'done', summary: 'held for you' })
      expect(held.delivered).toBe('held')
      expect(taskOf(worker, task)?.state).toBe('answered')

      // ⚑ **A second child finishing while the first reply is still held.** ⛔ Until D-010 `354`'s
      // singleton refused it (`parent-is-holding-a-message`) and the words waited for nobody — the
      // state `393` could not finish: *a parent with two children that both finish while it is busy
      // hears from one of them.* ⚑ It hears from both now.
      const second = await giveTo(pmTools, siblings[1] as string, 'the second piece')
      const secondId = second.agent
      const secondTask = second.piece
      const crowded = await reply(secondId, {
        piece: secondTask,
        outcome: 'done',
        summary: 'nobody will read this now',
      })
      expect(crowded.outcome).toBe('ok')
      expect(crowded.delivered).toBe('held')
      const waiting = ledger(pm).flatMap((event) =>
        event.type === 'message_queued' ? [event.text] : [],
      )
      expect(waiting).toHaveLength(2)
      expect(waiting[1]).toContain('nobody will read this now')
      // ⛔ **The task is STILL ANSWERED.** The durable fact never depends on somebody being there to
      // read it — which is what makes `list_tasks` the backstop rather than a nicety.
      expect(taskOf(secondId, secondTask)).toMatchObject({ state: 'answered', outcome: 'done' })
      const seen = (await callOn(pmTools, 'list_tasks', {})).you_gave as { piece: string }[]
      expect(seen.map((one) => one.piece)).toContain(secondTask)
    })

    it('⛔ a parent that cannot be started is named as such, with why, and the reply is kept for its next start', async () => {
      const { pm, worker, task } = await workWasGiven()
      await host.close(pm, window)
      // ⚑ **D-017 · R14 — a parent that has merely stopped is not gone**: the reply starts it
      // (`a-question-is-not-work` §4's control). ⚑ **D-030 — and when that start fails**, here
      // because its provider could not bring it back THIS time, the parent can still hear it: the
      // reply is kept in its ledger for its next start. ⚠️ **R10: not a provider that no longer has
      // the conversation** — that parent is replaced, and the reply lands in its replacement.
      const ref = store.find(pm)?.ref
      if (ref === undefined) throw new Error('the parent has no provider ref')
      ToolWatchingRuntime.nextResumeThrows = new ResumeError(
        ref,
        'resume failed: the handshake died',
      )
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'nobody is there',
      })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      expect(landed.delivered).toBe('kept')
      // ⚑ **The replier is told the start's own reason, in words** — never the raw error.
      expect(landed.why).toMatch(
        /^This conversation did not start: its provider could not bring it back/,
      )
      expect(String(landed.why)).not.toContain(pm)
      expect(taskOf(worker, task)).toMatchObject({ state: 'answered', outcome: 'done' })
      // ⚑ **Kept where the parent's next start reads it**: one open held message in ITS ledger,
      // carried from the worker, and no row in the worker's that says the reply was lost.
      const kept = ledger(pm).flatMap((event) =>
        event.type === 'message_queued' && event.text.includes('nobody is there') ? [event] : [],
      )
      expect(kept).toHaveLength(1)
      expect(kept[0]).toMatchObject({ kind: 'work', relayedFrom: worker, forItsNextStart: true })
      const ended = (): boolean =>
        ledger(pm).some(
          (event) => event.type === 'message_unqueued' && event.messageId === kept[0]?.messageId,
        )
      expect(ended()).toBe(false)
      expect(ledger(worker).filter((event) => event.type === 'reply_undelivered')).toEqual([])

      // ⚑ **…and the parent's next start sends it** — a person's Reopen, here.
      await host.resumeSession(pm, window)
      await waitFor(
        () =>
          ledger(pm).some(
            (event) => event.type === 'user_turn' && event.text.includes('nobody is there'),
          ),
        'the kept reply to reach the parent at its next start',
      )
      expect(ended()).toBe(true)
    })

    it('🔴 D-030 · the receipt says where the reply went: straight away, held, or kept for the next start', async () => {
      const receiptBeforeReminder = (text: string): string => {
        const suffix =
          " If this work taught you a tested method you would reuse, save it now as your Saved methods section says; otherwise you're done."
        expect(text.endsWith(suffix)).toBe(true)
        return text.slice(0, -suffix.length)
      }
      // sent — an idle parent.
      const idle = await workWasGiven()
      const idleLabel = taskOf(idle.worker, idle.task)?.label ?? 'no label'
      const sent = await replyReceipt(idle.worker, {
        piece: idle.task,
        outcome: 'done',
        summary: 'a',
      })
      expect(receiptBeforeReminder(sent)).toMatch(
        new RegExp(`^${idleLabel} answered · it went to .+ straight away\\.$`),
      )

      // held — a parent whose turn is stopped on a person's card: it waits for that answer.
      const busy = await workWasGiven()
      const busyLabel = taskOf(busy.worker, busy.task)?.label ?? 'no label'
      await host.send(busy.pm, 'the parent is thinking', window)
      await cardOn(busy.pm)
      const held = await replyReceipt(busy.worker, {
        piece: busy.task,
        outcome: 'done',
        summary: 'b',
      })
      expect(receiptBeforeReminder(held)).toMatch(
        new RegExp(
          `^${busyLabel} answered · it is held for .+\\. Its turn is stopped until a person answers `,
        ),
      )

      // kept — a parent whose start fails this time.
      const gone = await workWasGiven()
      const goneLabel = taskOf(gone.worker, gone.task)?.label ?? 'no label'
      await host.close(gone.pm, window)
      const ref = store.find(gone.pm)?.ref
      if (ref === undefined) throw new Error('the parent has no provider ref')
      ToolWatchingRuntime.nextResumeThrows = new ResumeError(
        ref,
        'resume failed: the handshake died',
      )
      const kept = await replyReceipt(gone.worker, {
        piece: gone.task,
        outcome: 'done',
        summary: 'c',
      })
      expect(receiptBeforeReminder(kept)).toMatch(
        new RegExp(
          `^${goneLabel} answered · kept on ${goneLabel}; .+ gets it when it next starts, or later if its provider’s usage limit holds then\\.$`,
        ),
      )
      expect(kept).not.toContain('could not be told')
    })

    it('⚑ the delivered words name the piece, the outcome and the resource — and no path', async () => {
      const { pm, worker, task } = await workWasGiven()
      const label = taskOf(worker, task)?.label ?? 'no label'
      const body = join(root, 'body.md')
      writeFileSync(body, '# body\n')
      const landed = await reply(worker, {
        piece: task,
        outcome: 'blocked',
        summary: 'the header',
        resource_paths: [body],
        needs_user_action: true,
      })
      const arrived = ledger(pm)
        .filter((event) => event.type === 'user_turn')
        .at(-1)
      const text = arrived?.type === 'user_turn' ? arrived.text : ''
      expect(text).toContain(label)
      expect(text).toContain('blocked')
      expect(text).toContain('the header')
      expect(text).toContain((landed.resources as string[])[0] as string)
      expect(text).toContain('read_document')
      expect(text).toContain('a person has to act')
      // ⛔ **An id, never a path** (380).
      expect(text).not.toContain(resourcesRoot(userData))
      expect(text).not.toContain(body)
    })

    it('⚠️ every delivery answer this app can give is reachable, and none of them is a state of the REPLY', () => {
      // ⚑ **Each is a product sequence rather than a claim.** D-010 retired
      // `parent-is-holding-a-message` (a busy parent holds), and D-017 · R14 retired
      // `no-conversation` (a giver that is not running is started for the reply). ⚑ **D-030** — a
      // start that FAILS answers `kept` (the parent that cannot be started, above), and
      // `not-delivered` is left to words nothing holds: a parent whose record will not take them
      // is `a-question-is-not-work` §4's.
      expect([...REPLY_DELIVERIES]).toEqual(['sent', 'held', 'kept', 'not-delivered'])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · a restart — the destination derived after the app that recorded it has gone
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · across a real restart', () => {
    it('🔴 a task that went quiet survives the restart, and the reply lands after it — to the resumed parent', async () => {
      // ⛔ **The question `393` §3 told me to ask rather than assume**: `373` fixed `commandedBy`
      // returning null after a cold resume, and the task edge is a DIFFERENT fact. ⚑ This is where it
      // is answered: the edge is a ledger row, so the destination is derived from the same events
      // after the restart as before it — nothing on the slot is involved.
      const { pm, worker, task } = await workWasGiven('work that outlives a quit')
      await letTheTurnFinish(worker)
      expect(taskOf(worker, task)?.state).toBe('stalled')
      const before = store.piecesOwnedBy(worker)

      await host.closeAll()

      // ⚑ **D-016c · the quit moves neither the STATE nor the CAUSE**: a stop moves no piece, so
      // *its turn ended* stands — cause and clock — between the quit and the resume, where `648`
      // asserted the ending's own cause had replaced it.
      const whileEnded = store.piecesOwnedBy(worker)
      expect(whileEnded).toEqual(before)

      host = buildHost()
      await host.resumeSession(pm, secondWindow)
      await host.resumeSession(worker, secondWindow)

      // 🔴 **And the resume moves nothing either.** ⛔ `646` F1 measured a parent reading *the
      // conversation it was given to has ended* about a conversation it could message. ⚑ **Every
      // durable field identical to before the quit** — `379` §5's assertion, in the strongest form
      // the row admits.
      const after = store.piecesOwnedBy(worker)
      expect(after).toEqual(before)
      expect(before[0]?.stalledBecause).toBe('turn_ended')

      // 🔴 **And now the reply, through the toolset the RESUME handed out.**
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'finished after the restart',
      })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      expect(taskOf(worker, task)).toMatchObject({ state: 'answered', outcome: 'done' })
      // ⛔ **It reached the resumed parent.** The destination came off the ledger, not off a slot
      // field that dies with the process.
      expect(landed.delivered).toBe('sent')
      const arrived = ledger(pm)
        .filter((event) => event.type === 'user_turn')
        .at(-1)
      expect(arrived?.type === 'user_turn' && arrived.text).toContain('finished after the restart')
    })

    it('⚠️ …and the parent sees it in `list_tasks` after the restart, from the ledger alone', async () => {
      const { pm, worker, task } = await workWasGiven()
      await letTheTurnFinish(worker)
      await host.closeAll()
      host = buildHost()
      await host.resumeSession(pm, secondWindow)
      await host.resumeSession(worker, secondWindow)
      await reply(worker, { piece: task, outcome: 'blocked', summary: 'after the quit' })

      const seen = (await callOn(toolsOf(pm), 'list_tasks', { state: 'all' })).you_gave as {
        piece: string
        state: string
        outcome: string | null
      }[]
      expect(seen).toHaveLength(1)
      expect(seen[0]).toMatchObject({ piece: task, state: 'answered', outcome: 'blocked' })
    })

    it('🔴 a task still RUNNING when the app quit CAN be answered afterwards — the finding, repaired', async () => {
      // 🔴 **This assertion was the finding, and `400` is the commit it was written to go red on.**
      //
      // ⛔ **It read *"cannot be answered — and the refusal says which ending it was"***: `379` had a
      // quit derive a running task to `abandoned`, `393` recorded the consequence — *the child cannot
      // then close the work it was doing* — and both left it, because whether a quit should abandon
      // running work was the PO's to rule. ⚑ **HO-018 §2.3 ruled it**: *"I meant the app being killed
      // while work is in progress… nothing about a quit tells us the work failed."*
      //
      // ⚠️ **Replaced by the opposite claim rather than adjusted until it passed** (`396`'s rule),
      // and the whole loop is exercised: quit mid-turn, relaunch, resume both sides, and the child
      // closes the work it was doing when the power went out.
      const { pm, worker, task } = await workWasGiven('work interrupted by a quit')
      expect(taskOf(worker, task)?.state).toBe('working')

      await host.closeAll()
      host = buildHost()
      await host.resumeSession(pm, secondWindow)
      await host.resumeSession(worker, secondWindow)

      // ⛔ **Open, with the condition on it**, which is HO-018's *"a condition on a task that stays
      // open"* read back off a real ledger through a real relaunch.
      //
      // ⚠️ **The cause is the TURN's and not the quit's** (D-016c). ⛔ This task was `working` when
      // the app went, so the turn `closeAll` force-ended stalled it `turn_interrupted`, and neither
      // the quit nor the resume moved it.
      // ⚑ **What this test is about is untouched**: the row is OPEN, and a late reply lands on it.
      expect(taskOf(worker, task)).toMatchObject({
        state: 'stalled',
        stalledBecause: 'turn_interrupted',
        endedAt: null,
      })
      const landed = await reply(worker, {
        piece: task,
        outcome: 'done',
        summary: 'I did finish it, actually',
      })
      expect(landed.outcome, JSON.stringify(landed)).toBe('ok')
      expect(taskOf(worker, task)).toMatchObject({ state: 'answered', outcome: 'done' })
      // ⚑ **And it reached the resumed parent**, which is the half that makes the repair worth
      // having rather than merely tidier.
      //
      // 🔴 **This read `toBe('sent')` until `404`, and what it was measuring is now unmeasurable
      // here.** ⛔ `sent` and `held` are the two halves of *delivered*, and which one a reply gets
      // says whether the parent happened to be busy — so pinning `sent` pinned *nothing else was
      // talking to the PM at that instant*. ⚠️ **Something is now**: `404` pushes the notice about
      // this very task into the parent the moment it registers, and a turn carrying it is running
      // when the reply arrives.
      //
      // ⚑ **Replaced by the stronger claim rather than by the looser one.** *Delivered* is asserted
      // as the closed pair, and then the words are read out of the PARENT's own ledger — arrival,
      // which is what the sentence above this one actually claims, instead of immediacy.
      expect(['sent', 'held']).toContain(landed.delivered)
      // ⚑ **Arrival read off the PARENT's own ledger, on whichever of the two rows carried it.** ⛔ A
      // `held` reply is in the parent's mailbox with its words durably recorded — `message_queued`
      // — and a `sent` one is a turn; both are *it reached the parent*, and neither is *the parent
      // happened to be free*. ⚠️ This test does not drive the parent's own turn to its end, so
      // waiting for the flush would be waiting on a card nobody in it answers.
      const carried = ledger(pm).filter(
        (event) =>
          (event.type === 'user_turn' || event.type === 'message_queued') &&
          event.text.includes('I did finish it'),
      )
      expect(carried, JSON.stringify(landed)).toHaveLength(1)
      // ⛔ **And the reason it is `held` rather than `sent`, named** — a poll of `list_tasks` would
      // not have made the parent busy, and this notice is the push `402`'s F6 said was missing.
      expect(
        ledger(pm).filter((event) => event.type === 'user_turn' && isGiverStallNotice(event.text)),
      ).toHaveLength(1)
      const seen = (await callOn(toolsOf(pm), 'list_tasks', {})).you_gave as {
        piece: string
        state: string
      }[]
      expect(seen.find((one) => one.piece === task)?.state).toBe('answered')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the censuses
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · what nothing in this file may quietly stop being true', () => {
    it('⛔ shared rail names are the named exceptions, and no sentence is shared', async () => {
      // ⚑ **`374`'s rule, extended to the reply list.** A model meets the complete roster through
      // one door and must not see one word mean two things.
      const { SPAWN_RAILS, describeRail } = await import('../src/main/runtime/spawn-rails')
      const { MESSAGE_RAILS, describeMessageRail } =
        await import('../src/main/runtime/message-rails')
      // ⚑ **D-016 · the resource module's words, where the document registry's were.**
      const { RESOURCE_RAILS, refuseResource } = await import('../src/main/resources/resources')
      const { TOOL_REFUSALS, refuseTool } = await import('../src/main/runtime/agent-tools')
      const names = [
        ...SPAWN_RAILS,
        ...MESSAGE_RAILS,
        ...RESOURCE_RAILS,
        ...TOOL_REFUSALS,
        ...REPLY_RAILS,
      ]
      // ⛔ **`malformed-request` is deliberately shared between the spawn door and the tools** and
      // was so before this dispatch; every OTHER name must be unique, and `393` added none that
      // collides. ⚠️ (`no-task-by-that-name` was spelled so because the document registry owned
      // `no-such-task`; D-016 took both, and the reply's word is `no-piece-by-that-name`.)
      //
      // 🔴 **`spawning-disabled` is the SECOND deliberate share, added at 419.** ⛔ Two doors stand
      // in front of ONE switch a person threw — `give_work` (it was `spawn_agent`'s) and
      // `create_agent` — and a second
      // spelling would be a second thing for a model to learn about it, which is `374`'s rule
      // broken rather than kept. ⚠️ **What sharing a name costs is that the two tables could come
      // to disagree about what the word MEANS**, and that is asserted next door rather than here:
      // `what-an-agent-is-told-about-its-work.test.ts` §3 checks that every vocabulary carrying a
      // shared word answers the same PERMANENCE for it.
      // ⚑ **D-016 · two more deliberate shares.** `may-not-create-agents` is one grant a person
      // narrowed, met at `create_agent` and at a give with `new: true`; `no-piece-by-that-name` is
      // one absence — the caller holds no piece by that name — met at `reply_to_parent` and at the
      // tools that name a piece (`withdraw_task`, `list_tasks`), each in its own sentence.
      // A piece that cannot end with the copies of its questions is one fact at a take-back, a
      // close and a reply, so its two words are shared too, each in its own sentence.
      const duplicated = names.filter((name, index) => names.indexOf(name) !== index)
      expect([...new Set(duplicated)].sort()).toEqual([
        'a-conversation-with-its-questions-is-starting',
        'its-questions-could-not-all-be-read',
        'malformed-request',
        'may-not-create-agents',
        'no-piece-by-that-name',
        'spawning-disabled',
      ])
      // ⚠️ **`describeRail` and `describeMessageRail` return the STRING**, not a payload — a
      // `.reason` on them is `undefined`, which is how `347`'s own version of this census went green
      // measuring nothing until it was found reviewing that diff.
      const sentences = [
        ...SPAWN_RAILS.map((rail) => describeRail(rail)),
        ...MESSAGE_RAILS.map((rail) => describeMessageRail(rail)),
        ...RESOURCE_RAILS.map((rail) => refuseResource(rail).reason),
        ...TOOL_REFUSALS.map((rail) => refuseTool(rail).reason),
        ...REPLY_RAILS.map((rail) => refuseReply(rail).reason),
      ]
      expect(new Set(sentences).size).toBe(sentences.length)
      // ⚑ **Non-vacuity: these really are prose, not slugs**, or the set above would be comparing
      // `undefined` to itself.
      expect(sentences.every((one) => one.includes(' '))).toBe(true)
      expect(sentences.length).toBe(names.length)
    })

    it('⛔ every reply rail has a permanence, a retryability derived from it, and a sentence of substance', () => {
      for (const rail of REPLY_RAILS) {
        const refusal = refuseReply(rail)
        expect(refusal.rail).toBe(rail)
        expect(refusal.permanence).toBe(replyPermanenceOf(rail))
        // ⛔ **Derived, so the two cannot disagree** — never written twice.
        expect(refusal.retryable).toBe(replyRetryableOf(rail))
        expect(refusal.retryable).toBe(refusal.permanence === 'while-this-holds')
        expect(refusal.reason.length).toBeGreaterThan(60)
      }
      // ⚑ **Non-vacuity: the list must contain both answers**, or the derivation above is measured
      // in one direction only.
      expect(REPLY_RAILS.filter((rail) => replyRetryableOf(rail))).not.toEqual([])
      expect(REPLY_RAILS.filter((rail) => !replyRetryableOf(rail))).not.toEqual([])
    })

    it('⛔ no reply sentence describes how the app works', () => {
      // ⚠️ **HO-015 §2, standing.** A refusal instructs or states a fact about THIS call. None of
      // these may say where a reply goes, who the parent is, or what the app does with it.
      for (const rail of REPLY_RAILS) {
        const reason = refuseReply(rail).reason
        expect(reason, rail).not.toMatch(/your parent|the parent|routed|delivered/i)
        expect(reason, rail).not.toMatch(/ledger|derive|fold|session/i)
      }
    })

    it('⛔ not one capability check reached this dispatch’s new code', () => {
      // ⚑ **`the-five-tools.test.ts` §6's census, asked of the two files `393` added or grew.** A
      // rail keyed on a grant here would be one rule in two places, and the copy that drifts is
      // always the one further from the thing it protects.
      const forbidden = ['canMessage', 'canAssignWork', 'canCreateAgents', 'capabilitiesOf']
      // ⚑ **D-016 · a RESOURCE has a role** — what a kept file is to its piece (`RESOURCE_ROLES`) —
      // and the two doors that hand one back report it; `update_work` words its answer by whether
      // the caller kept what it MADE, and the host lists a piece's INPUTS in its brief and, D-026,
      // reports each kept file's role to a window (`keptFileOf`); D-037, `find_files` says each
      // file it finds is an input or kept. ⛔ None of them is an identity's role, so each spelling is
      // counted in its own file (another would be a new read) and taken out before the census reads.
      // Each spelling, and how many times it is read in its file.
      const RESOURCE_ROLE_READS: Readonly<Record<string, Readonly<Record<string, number>>>> = {
        'agent-tools.ts': {
          'role: read.resource.role': 1,
          'role: one.role': 1,
          // A piece's record lists its inputs apart from the rest of its files.
          "one.role === 'input'": 1,
          "one.role !== 'input'": 2,
          'role: one.file.role': 1,
          "file.role === 'input'": 1,
        },
        'runtime-host.ts': { "one.role === 'input'": 1, 'role: resource.role': 1 },
      }
      const withoutResourceRoles = (file: string, code: string): string =>
        Object.keys(RESOURCE_ROLE_READS[file] ?? {}).reduce(
          (left, spelled) => left.split(spelled).join(''),
          code,
        )
      for (const [file, counts] of Object.entries(RESOURCE_ROLE_READS)) {
        const code = codeOnly(readFileSync(join(mainRoot, 'runtime', file), 'utf8'))
        for (const [spelled, times] of Object.entries(counts)) {
          expect(code.split(spelled).length - 1, `${file}: ${spelled}`).toBe(times)
        }
      }
      for (const file of ['reply-rails.ts', 'agent-tools.ts']) {
        const code = withoutResourceRoles(
          file,
          codeOnly(readFileSync(join(mainRoot, 'runtime', file), 'utf8')),
        )
        for (const word of forbidden) {
          expect(code, `${file} reads ${word}`).not.toContain(word)
        }
        // 🔴 **D-014 · there is no role to read**: the field left every identity, `create_agent`
        // takes none and `list_profiles` reports none. ⛔ Standing rule 10 said a role never gates
        // anything; the census now says neither spelling of one appears in this code at all.
        expect(code, `${file} reads a role off something`).not.toMatch(/\broleOf\b|\.role\b/)
      }
      // ⛔ **Nor does the host or the factory text**, which is where a stored role used to be read
      // into a launch context.
      for (const file of ['runtime-host.ts', 'factory-text.ts']) {
        const code = withoutResourceRoles(
          file,
          codeOnly(readFileSync(join(mainRoot, 'runtime', file), 'utf8')),
        )
        expect(code, `${file} reads a role off something`).not.toMatch(/\broleOf\b|\.role\b/)
      }
      // ⚠️ **The control that plants both spellings the census WOULD fire on** (standing rule 12),
      // so the absences above are not passes over code no regex could ever match.
      expect(codeOnly('const heading = context.role')).toMatch(/\broleOf\b|\.role\b/)
      expect(codeOnly('const role = store.roleOf(slug)')).toMatch(/\broleOf\b|\.role\b/)
      // ⛔ **The control that plants two grant words** (standing rule 12): the census must be able
      // to SEE such a word, or it is asserting nothing. The rails' real neighbour contains both.
      const neighbour = codeOnly(
        readFileSync(join(mainRoot, 'runtime', 'message-rails.ts'), 'utf8'),
      )
      expect(neighbour).toContain('canMessage')
      expect(neighbour).toContain('canAssignWork')
    })

    it('⚠️ the summary bound is named in exactly one place, and the refusal reads it from there', () => {
      // 🔴 **`a-bound-written-as-the-constant-cannot-pin-it`, from the other side**: the CONSTANT
      // must not be duplicated, or the refusal and the check could disagree.
      const rails = readFileSync(join(mainRoot, 'runtime', 'reply-rails.ts'), 'utf8')
      const code = codeOnly(rails)
      expect([...code.matchAll(/1_?280/g)]).toHaveLength(1)
      expect(code).toContain('REPLY_SUMMARY_LIMIT')
      // The numeric detail and the reason both state the shared limit.
      expect(refuseReply('summary-too-long', { limit: REPLY_SUMMARY_LIMIT }).detail.limit).toBe(
        1280,
      )
      expect(refuseReply('summary-too-long').reason).toContain('exceeds 1,280 characters')
    })

    it('⛔ the task states and the open table move together, and only a DECISION closes one', () => {
      expect(Object.keys(TASK_IS_OPEN).sort()).toEqual([...TASK_STATES].sort())
      // 🔴 **`abandoned` left this vocabulary at `400`** (HO-018 §2.3) and the REQUEST one still has
      // it — `398` §3 measured that the word means different things in the two, and only one of them
      // moved. ⛔ What is left is three closed states and every one of them is somebody DECIDING: the
      // agent saying how it went, the parent taking the work back, and (D-016) the parent closing it
      // without a reply.
      expect(TASK_STATES.filter((state) => !TASK_IS_OPEN[state])).toEqual([
        'answered',
        'withdrawn',
        'closed',
      ])
      expect([...TASK_STATES]).not.toContain('abandoned')
      expect([...REQUEST_STATES]).toContain('abandoned')
      // ⚑ **The one entry worth arguing about, pinned by name** so it cannot quietly flip.
      expect(TASK_IS_OPEN.stalled).toBe(true)
      expect(TASK_IS_OPEN.answered).toBe(false)
    })

    it('⛔ every refusal on this path is a RETURNED payload — the handler cannot throw one', () => {
      // ⚑ **§4's requirement, as a property of the code rather than as a hope.** `307` measured that
      // a thrown handler becomes transport-shaped `-32603` and *"carries no machine-readable policy
      // meaning"*; the child learns a tool broke. ⛔ So neither new tool's body may contain a
      // `throw`, and both refusal sources are RETURNED unions — `admitReply` answers
      // `ReplyRefusal | null`, `registerDocument` answers `{ok}`.
      const tools = readFileSync(join(mainRoot, 'runtime', 'agent-tools.ts'), 'utf8')
      for (const name of ['reply_to_parent', 'list_tasks']) {
        const from = tools.indexOf(`name: '${name}',`)
        expect(from, `${name} is not in the file`).toBeGreaterThan(0)
        const next = tools.indexOf("      name: '", from + 10)
        const body = codeOnly(tools.slice(from, next === -1 ? tools.length : next))
        expect(body, `${name} throws`).not.toContain('throw ')
      }
      // ⛔ **The control that plants two** (standing rule 12): the census must be able to SEE a
      // `throw`, or it is asserting nothing. `message_agent`'s delivery classifier has one,
      // deliberately — a start that failed for a reason no wake recognises is a fault, not a policy
      // refusal — and that is what makes the two absences above a measurement. ⚠️ D-014:
      // `end_agent`'s rethrow went with the grant check it guarded. ⚑ **D-016** — the catch moved
      // out of `message_agent` into `whatADeliveryMet`, which `give_work` shares.
      const floor = tools.indexOf('function whatADeliveryMet(')
      expect(floor, 'whatADeliveryMet is not in the file').toBeGreaterThan(0)
      const floorBody = codeOnly(tools.slice(floor, tools.indexOf('\n}\n', floor)))
      expect(floorBody).toContain('throw error.cause')
      expect(
        codeOnly(readFileSync(join(mainRoot, 'runtime', 'reply-rails.ts'), 'utf8')),
      ).not.toContain('throw ')
      expect(
        codeOnly(readFileSync(join(mainRoot, 'runtime', 'runtime-host.ts'), 'utf8')),
      ).toContain('throw new MessagingRefused')
      // ⚑ …and the same shape one file over: `admitReply` ANSWERS a refusal and never raises one.
      // ⚠️ The plant for this half is `runtime-host.ts`, not `message-rails.ts` — that file declares
      // `MessagingRefused` and throws nothing; the host is what raises it. **Written after the
      // first version of this line passed on a file that could not have contained a `throw`**, which
      // is a control that proves the grep works only if the grep could have failed.
    })

    it('⚑ the inventory grew by exactly the two tools this dispatch published', () => {
      expect(TOOL_NAMES).toContain('reply_to_parent')
      expect(TOOL_NAMES).toContain('list_tasks')
      // ⚑ **D-017 — one place earlier each**: `end_agent`, which stood before them, is gone.
      expect(TOOL_NAMES.indexOf('reply_to_parent')).toBe(5)
      expect(TOOL_NAMES.indexOf('list_tasks')).toBe(6)
    })
  })
})
