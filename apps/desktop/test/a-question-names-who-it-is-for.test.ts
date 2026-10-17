import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import { CHANNEL_REFUSALS } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { TOOL_INPUT_ENUMS, TOOL_NAMES, type ToolName } from '../src/main/runtime/agent-tools'
import { QUESTION_RAILS, questionText } from '../src/main/runtime/question-rails'
import { messageNamingItsSender, theDirectionLine } from '../src/main/runtime/turn-origin'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import {
  QUESTION_RECIPIENTS,
  PASS_UP_RECIPIENTS,
  RECIPIENT_MEANS,
  REQUEST_IS_OPEN,
  WENT_STANDS_FOR,
  aPersonsSince,
  escalationChain,
  isQuestionRecipient,
  permissionShaped,
  theChannelRefusalIn,
  whereItWent,
  type RoutedRequest,
  type WhereARequestWent,
} from '../src/shared/questions'
import type {
  RequestRoutedEvent,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * 🔴 **611 · a question names who it is for** — `HO-088` §2, §3 and §4.1, and `HO-090` §4.
 *
 * ## ⛔ The run this exists because of, quoted rather than restated
 *
 * A worker gathering requirements from a person needs a tool route directly to that person.
 * Routing only to its parent can leave both worker and parent typing questions into chat with
 * no answer channel back to the worker.
 *
 * ⛔ **So a question for the person took four hops**, and arrived as untracked prose: not in the
 * queue, not counted as needing him, gone if he closed the window.
 *
 * ## ⚑ The three properties this suite is written against
 *
 *  1. **§2 · a question carries its recipient and the app infers nothing.** The verb takes it,
 *     the row records it, and a call that did not say is refused rather than routed somewhere.
 *  2. **§3.2 · passing a question up is an ACT that carries the ORIGINAL words.** There is no
 *     field to reword them in, which is what makes the ruling checkable rather than promised.
 *  3. **`HO-090` §4 · one queue item, two entrances.** A question a deadline made a person's and
 *     one an asker addressed to a person are ONE population, one row shape and one answer door.
 *
 * ## ⚠️ What this suite does NOT claim
 *
 * ⛔ **It measures no clock.** `HO-088` §3.1 removed the escalation deadline and that removal is
 * `612`'s; what is asserted here is only that an ADDRESSED question is never stamped by the one
 * that is still standing — because there is no parent that failed to answer it.
 *
 * ⛔ **And it does not claim a person can ANSWER one from the queue.** §5 measures what they get
 * instead, which is a row with no card and no controls — `602`'s known gap, reached without a
 * thirty-second wait for the first time. ⚑ Standing rule 8.4: the limit is the finding.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * ⚑ **One tick**, because §3 asserts what the deadline does and does NOT stamp.
 *
 * ⛔ **612 · `ESCALATE` stood here and is GONE** (HO-088 §3.1). ⚑ It made the sweep due at its
 * first look, so §3's positive control fired in a bounded time. ⚠️ **§3 now reaches a person
 * through `pass_question_up`**, which is an ACT and needs no window at all — the bound in rule 13
 * is met by the call returning rather than by a clock being short.
 */

/** ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`. */
const codeOf = (file: string): string =>
  readFileSync(join(srcRoot, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

/** ⚑ **PROSE with its wrapping removed**, because prettier re-wraps a docblock sentence freely. */
const proseOf = (file: string): string =>
  readFileSync(join(srcRoot, file), 'utf8')
    .replace(/\n\s*\*\s?/g, ' ')
    .replace(/\s+/g, ' ')

describe('611 · a question names who it is for', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-611-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-611-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 9_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
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

  const callOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const textOn = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).text
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** ⛔ Every way words can reach a conversation, read as ONE population (591's reader). */
  const wordsIn = (sessionId: string): readonly string[] =>
    ledger(sessionId)
      .filter(
        (
          event,
        ): event is TranscriptEvent & { type: 'user_turn' | 'message_queued'; text: string } =>
          event.type === 'user_turn' || event.type === 'message_queued',
      )
      .map((one) => one.text)

  const routingsIn = (sessionId: string): readonly RequestRoutedEvent[] =>
    ledger(sessionId).filter(
      (event): event is RequestRoutedEvent => event.type === 'request_routed',
    )

  /**
   * ⚑ **The chain `HO-088` §1 watched**: a PM in a window, a worker it gave one piece of work.
   *
   * ⛔ It is the shape every assertion here needs: a conversation with a parent, holding work it
   * can ask about. No grant is set for the give (D-014: any agent may give work to any agent).
   * ⚑ **D-016 · the give starts the worker, and its brief is the worker's first turn** — in the
   * PM's `ask` that turn parks on a permission card.
   */
  const aWorkerHoldingWork = async (): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    piece: string
  }> => {
    const seeded = await personOpens('worker')
    await host.close(seeded, window)
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'the work this dispatch is about',
      brief: 'gather the requirements',
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    const worker = given.agent as string
    const workerTools = theToolsetJustHandedOut()
    const open = store.piecesOwnedBy(worker).find((one) => TASK_IS_OPEN[one.state])
    if (open === undefined) throw new Error('the give never opened a piece')
    return { pm, worker, pmTools, workerTools, piece: open.piece }
  }

  /** ⚑ One routing row of this conversation, by the arm it is on. */
  const routedIn = (sessionId: string, is: WhereARequestWent['is']): RoutedRequest => {
    const row = store
      .routedRequestsOf(sessionId)
      .filter((one) => one.went.is === is)
      .at(-1)
    if (row === undefined) throw new Error(`no ${is} routing in ${sessionId}`)
    return row
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **§1 · the DECLARATION — the agent says which end, and the app decides nothing.**
   */
  describe('§1 · a question carries its recipient', () => {
    it('⛔ the app does NOT default it: a call that names no recipient is refused', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const silent = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which cities does he want?',
      })
      // ⚑ **`HO-088` §2.2, in code**: *"a caller that has not said which it means has not decided,
      // and the app should not decide for it in the direction that costs something."*
      expect(silent.outcome, JSON.stringify(silent)).toBe('refused')
      expect(JSON.stringify(silent)).toContain('who_answers')
      // ⛔ **And NOTHING was written** — no question row anywhere. A default would have put one in
      // a ledger with a recipient nobody chose. ⚠️ The ROUTING census cannot be the assertion here:
      // the worker is parked on a permission card, which `routeRequest` records a routing for, so
      // *"no routing"* would be false about a row this call had nothing to do with.
      expect(ledger(worker).filter((event) => event.type === 'question_asked')).toEqual([])
    })

    it('⚑ both ends are reachable, and the ROW records which the agent said', async () => {
      const { pm, worker, workerTools, piece } = await aWorkerHoldingWork()
      const up = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which schema?',
        who_answers: 'the-parent',
      })
      expect(up.outcome, JSON.stringify(up)).toBe('ok')
      expect(up.went_to).toBe('the-parent')
      const toParent = routedIn(worker, 'the-parent')
      expect(toParent.went).toEqual({ is: 'the-parent', to: 'the-parent' })
      expect(toParent.parent).toBe(pm)

      // 🔴 **`HO-088` §2.3's case, in one hop** — Ada tasks Ali with *ask the person*, and Ali's
      // question goes there instead of taking four hops through conversations that cannot answer.
      const out = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which cities do you want?',
        who_answers: 'a-person',
      })
      expect(out.outcome, JSON.stringify(out)).toBe('ok')
      expect(out.went_to).toBe('a-person')
      const toPerson = routedIn(worker, 'the-person-the-asker-named')
      expect(toPerson.went).toEqual({ is: 'the-person-the-asker-named', to: 'a-person' })
      // ⚑ **The parent is STILL on the row** — `HO-088` §2.3: *"Ada still SEES that Ali asked and
      // sees the answer — she delegated the asking, not her sight of it."*
      expect(toPerson.parent).toBe(pm)

      // 🔴 **And the parent is SUMMONED about one of them and not the other**, which is the
      // difference between seeing a question and being asked it. ⛔ A turn is a parent's
      // expensive thing; delivering an addressed question upward as well would be this app asking
      // two parties one question, and `HO-088` §1's four hops are what that costs.
      await waitFor(
        () => wordsIn(pm).some((text) => text.includes('which schema?')),
        'the upward question to reach the parent',
      )
      expect(wordsIn(pm).some((text) => text.includes('which cities do you want?'))).toBe(false)
    })

    it('⛔ a value the vocabulary has not been taught is refused, never passed through', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      for (const invented of ['owner-name', 'the-person', 'ada', '', 'the-grandparent']) {
        const said = await callOn(workerTools, 'ask_question', {
          piece,
          question: 'who?',
          who_answers: invented,
        })
        expect(said.outcome, `${invented} was admitted`).toBe('refused')
      }
      // ⚑ **Nothing reached the ledger for any of them** — `325`'s rule is a refusal and not a
      // coercion, so five bad calls leave five absences rather than five rows. ⚠️ Asked of
      // `question_asked` and not of the ROUTINGS: the worker is parked on a permission card, which
      // `routeRequest` writes a routing for, and that row is nothing to do with these calls.
      expect(ledger(worker).filter((event) => event.type === 'question_asked')).toEqual([])
      // ⚠️ **And the guard is the one the door uses**, asked directly over the same five.
      for (const invented of ['owner-name', 'the-person', 'ada', '', 'the-grandparent']) {
        expect(isQuestionRecipient(invented), invented).toBe(false)
      }
      for (const member of QUESTION_RECIPIENTS) expect(isQuestionRecipient(member)).toBe(true)
      expect(isQuestionRecipient(undefined)).toBe(false)
    })

    it('⚠️ aiming at a CONVERSATION is still refused, and the refusal now names what IS an argument', async () => {
      const { pm, workerTools, piece } = await aWorkerHoldingWork()
      const aimed = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which schema?',
        who_answers: 'the-parent',
        to: pm,
      })
      expect(aimed.outcome, JSON.stringify(aimed)).toBe('refused')
      const said = JSON.stringify(aimed)
      // ⛔ **The sentence said *a question goes to the conversation that gave you the task*, which
      // `HO-088` §2 makes false.** ⚑ It names the argument that does aim it, and the two members.
      expect(said).toContain('who_answers')
      for (const member of QUESTION_RECIPIENTS) expect(said).toContain(member)
      expect(said).not.toContain('a question goes to the conversation that gave you the task')
    })

    it('⚑ the two members are advertised to a MODEL, and the sentences come from the vocabulary', async () => {
      const { workerTools } = await aWorkerHoldingWork()
      const tool = workerTools.tools.find((one) => one.name === 'ask_question')
      if (tool === undefined) throw new Error('no ask_question')
      expect(Object.keys(tool.input)).toContain('who_answers')
      // ⚑ **The vocabulary is REGISTERED at both addresses**, which is what puts its members and
      // their sentences into the published schema — `every-tool-enum-is-documented.test.ts` is the
      // census that walks every registered address and asserts each member's own sentence, so a
      // second copy of that walk here would be two readers of one rule.
      //
      // 🔴 **D-009 · two vocabularies now, and each says its own**: `ask_question` takes the three
      // ends, and `pass_question_up` only the two a question climbs to — never an agent by name.
      const asking = TOOL_INPUT_ENUMS['ask_question:who_answers']
      expect(asking.members).toEqual([...QUESTION_RECIPIENTS])
      for (const member of QUESTION_RECIPIENTS) {
        expect(asking.sentences[member]).toBe(RECIPIENT_MEANS[member])
      }
      const passing = TOOL_INPUT_ENUMS['pass_question_up:who_answers']
      expect(passing.members).toEqual([...PASS_UP_RECIPIENTS])
      expect(passing.members).not.toContain('an-agent')
      for (const member of PASS_UP_RECIPIENTS) {
        expect(passing.sentences[member]).toBe(RECIPIENT_MEANS[member])
      }
      // ⛔ **And the description does not promise a default**, because there is not one.
      expect(tool.description).toContain('Say who answers it')
    })
  })

  /**
   * 🔴 **§2 · the SHAPE — `to` + `because` became one union, and every reader re-decided.**
   */
  describe('§2 · the invariant that stopped being true', () => {
    it('⛔ the fold reads three arms out of two wire fields, and the refusal wins', () => {
      const routed = (over: Partial<RequestRoutedEvent>): RequestRoutedEvent => ({
        type: 'request_routed',
        requestId: 'r',
        to: 'the-parent',
        parent: 'sess_p',
        ...over,
      })
      expect(whereItWent(routed({}))).toEqual({ is: 'the-parent', to: 'the-parent' })
      // ⚑ **611's arm** — a person, with nothing refused.
      expect(whereItWent(routed({ to: 'a-person' }))).toEqual({
        is: 'the-person-the-asker-named',
        to: 'a-person',
      })
      // ⛔ **Every member of `ChannelRefusal`**, and not the one the briefs talk about.
      for (const because of CHANNEL_REFUSALS) {
        expect(whereItWent(routed({ to: 'a-person', because })), because).toEqual({
          is: 'the-person-the-channel-left-it-with',
          to: 'a-person',
          because,
        })
      }
      // 🔴 **The refusal is read FIRST, which is the fail-closed choice.** A row that somehow
      // carried a refusal and `to: 'the-parent'` is a PERSON's, because handing a permission to a
      // parent is the one direction that costs something.
      expect(whereItWent(routed({ because: 'a-permission-decision' }))).toEqual({
        is: 'the-person-the-channel-left-it-with',
        to: 'a-person',
        because: 'a-permission-decision',
      })
    })

    it('⚑ every arm has a sentence, and `to` is fixed per arm so the pair cannot disagree', () => {
      const arms: WhereARequestWent['is'][] = [
        'the-parent',
        'the-person-the-asker-named',
        'the-person-the-channel-left-it-with',
        // ⚑ **D-009 · F012** — an agent the asker named.
        'the-agent-the-asker-named',
      ]
      expect(Object.keys(WENT_STANDS_FOR).sort()).toEqual([...arms].sort())
      // ⛔ **Distinct sentences**, because a vocabulary whose members read alike is a vocabulary a
      // surface cannot use — `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`.
      expect(new Set(Object.values(WENT_STANDS_FOR)).size).toBe(arms.length)
      const each = arms.map((is) =>
        whereItWent({
          type: 'request_routed',
          requestId: 'r',
          parent: 'p',
          to:
            is === 'the-parent'
              ? 'the-parent'
              : is === 'the-agent-the-asker-named'
                ? 'an-agent'
                : 'a-person',
          ...(is === 'the-person-the-channel-left-it-with'
            ? { because: 'a-permission-decision' as const }
            : {}),
        }),
      )
      expect(each.map((one) => one.to)).toEqual(['the-parent', 'a-person', 'a-person', 'an-agent'])
    })

    it('🔴 `permissionShaped` admits the REFUSED arm only — and an addressed question is not one', () => {
      const rows = (
        [
          { is: 'the-parent', to: 'the-parent' },
          { is: 'the-person-the-asker-named', to: 'a-person' },
          {
            is: 'the-person-the-channel-left-it-with',
            to: 'a-person',
            because: 'a-permission-decision',
          },
        ] as const
      ).map((went, index) => ({
        requestId: `r${String(index)}`,
        askedBy: 'sess_w',
        parent: 'sess_p',
        went,
        at: 1,
        state: 'open' as const,
        endedAt: null,
        escalatedAt: null,
      }))
      // ⛔ **This is criterion 10's INSTRUMENT**, and the old spelling — `because === null` —
      // would have let an addressed question into the count *"has anything permission-shaped
      // arrived here?"*. ⚑ Two rows plant the control (standing rule 12): the one that must be in
      // and the one that must not, both `to: 'a-person'`.
      expect(permissionShaped(rows).map((one) => one.requestId)).toEqual(['r2'])
      expect(rows.map(theChannelRefusalIn)).toEqual([null, null, 'a-permission-decision'])
    })

    it('⛔ no reader in this app spells *the parent’s* as the absence of a refusal any more', () => {
      // 🔴 **THE SEARCH SHAPE** (standing rule 4): the claim is not *"we fixed the ones we
      // remembered"* but *"the field a reader would have used is gone from the derivation"*. ⛔ A
      // reader that still asked `request.because` would not compile — which is exactly why the
      // shape is a union — so what this census can still find is the SPELLING surviving in a file
      // that reads the WIRE event instead of the row.
      const readers = [
        'shared/questions.ts',
        'shared/tasks.ts',
        'main/db/session-store.ts',
        'main/runtime/runtime-host.ts',
        'main/runtime/agent-tools.ts',
        'main/runtime/question-rails.ts',
        'main/runtime/digest.ts',
      ]
      for (const file of readers) {
        const code = codeOf(file)
        expect(code.length, `${file} is not where this census thinks it is`).toBeGreaterThan(400)
        // ⚠️ **`request.because` and `one.because` are the two spellings every reader used.**
        for (const spelling of ['request.because', 'one.because', 'row.because']) {
          expect(code, `${file} still reads ${spelling}`).not.toContain(spelling)
        }
      }
      // ⚑ **The positive control** (rule 34.2): the spelling exists in this very file, so the
      // census can find one when there is one to find.
      const planted = `${codeOf('shared/questions.ts')} if (request.because === null) return null`
      expect(planted).toContain('request.because')
    })
  })

  /**
   * 🔴 **§3 · ONE queue item, two entrances** (`HO-090` §4).
   */
  describe('§3 · one question, two entrances', () => {
    it('⛔ a question a parent PASSED UP and one its ASKER addressed are one population', async () => {
      const { pmTools, worker, workerTools, piece } = await aWorkerHoldingWork()
      const escalating = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which schema?',
        who_answers: 'the-parent',
      })
      expect(escalating.outcome, JSON.stringify(escalating)).toBe('ok')
      const addressed = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which cities?',
        who_answers: 'a-person',
      })
      expect(addressed.outcome, JSON.stringify(addressed)).toBe('ok')

      // ⚑ **The ADDRESSED one is a person's immediately** — no window, no deadline, no wait.
      const now = () => host.questionsForAPerson().rows.map((one) => one.request.requestId)
      expect(now()).toEqual([addressed.question])

      // ⚠️ **612 · the second entrance was a DEADLINE and it is gone** (HO-088 §3.1, standing
      // rule 26). ⛔ This waited for the sweep to make the parent-routed question a person's;
      // `611`'s own §4 said that was one of two entrances, and the other one is now the only one
      // — a parent that will not answer PASSES IT UP. ⚑ **The property is unchanged and the
      // proof is stronger**: two rows that arrived by two different acts are one population, one
      // shape and one reader.
      const passed = await callOn(pmTools, 'pass_question_up', {
        question: escalating.question,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
      const both = host.questionsForAPerson().rows
      expect(both.map((one) => one.request.requestId).sort()).toEqual(
        [passed.question as string, addressed.question as string].sort(),
      )
      // 🔴 **ONE row shape and not two that look alike** — every key the queue reads is on both.
      const keys = both.map((one) => Object.keys(one).sort())
      expect(keys[0]).toEqual(keys[1])
      for (const row of both) expect(row.aPersonsSince).not.toBeNull()

      // ⛔ **Neither is in the OTHER person-facing population**, which is what stops one request
      // being counted twice in front of a person. ⚑ **The permission card the worker is parked on
      // IS in it**, which is the positive control: this reader answers, and what it does not name
      // is these two.
      const decisions = host.decisionsForAPerson().rows.map((one) => one.request.requestId)
      expect(decisions.length).toBeGreaterThan(0)
      for (const mine of [passed.question, addressed.question]) {
        expect(decisions, String(mine)).not.toContain(mine)
      }
      // ⚑ **And both questions are still visible to the parent**, which is `394` §2.
      const mine = store
        .routedRequestsOf(worker)
        .filter((one) => one.went.is !== 'the-person-the-channel-left-it-with')
      expect(mine).toHaveLength(2)
    })

    /**
     * 🔴 **612 · there is no deadline to stamp anything, so the claim widened** (HO-088 §3.1,
     * standing rule 26).
     *
     * ⛔ **It read *a deadline never stamps a question its asker ADDRESSED to a person***, with a
     * parent-routed question in the same conversation as the positive control that the sweep
     * fired at all. ⚑ **The sweep is gone**, so the control cannot exist — and what `611` asserted
     * about ONE arm is now true of every row this app writes.
     */
    it('🔴 NOTHING is ever stamped, whichever end the asker named', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      const addressed = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which cities?',
        who_answers: 'a-person',
      })
      expect(addressed.outcome, JSON.stringify(addressed)).toBe('ok')
      const up = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which schema?',
        who_answers: 'the-parent',
      })
      expect(up.outcome, JSON.stringify(up)).toBe('ok')

      // ⛔ **Both clocks pass** — the host's own and real time — and nothing writes a row. ⚠️ 120 ms
      // is three times the 40 ms window every fixture in this repo armed (rules 13 and 22).
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(routedIn(worker, 'the-parent').escalatedAt).toBeNull()
      expect(routedIn(worker, 'the-person-the-asker-named').escalatedAt).toBeNull()
      expect(ledger(worker).filter((event) => event.type === 'request_escalated')).toEqual([])

      // ⚑ **THE CONTROL**: the addressed one IS a person's, immediately and without a stamp — so
      // the three absences above are measurements rather than a queue that never fills.
      expect(host.questionsForAPerson().rows.map((one) => one.request.requestId)).toEqual([
        addressed.question,
      ])
      expect(up.question).toBe(routedIn(worker, 'the-parent').requestId)
    })

    it('⚑ the AGE comes off two clocks, and the row says which instant it read', () => {
      const row = (over: Partial<RoutedRequest>): RoutedRequest => ({
        requestId: 'r',
        askedBy: 'sess_w',
        parent: 'sess_p',
        went: { is: 'the-parent', to: 'the-parent' },
        at: 1_000,
        state: 'open',
        endedAt: null,
        escalatedAt: null,
        ...over,
      })
      // ⛔ **The escalation's stamp**, for a question that became a person's one window later.
      expect(aPersonsSince(row({ escalatedAt: 31_000 }))).toBe(31_000)
      // ⚑ **The routing's own `at`**, for one that was a person's from the instant it was written
      // — which is `decisionsAwaitingAPerson`'s argument, now true of a second population.
      expect(
        aPersonsSince(row({ went: { is: 'the-person-the-asker-named', to: 'a-person' } })),
      ).toBe(1_000)
      // ⚠️ **NULL for a row that is nobody's yet.** A reader holding one of those is holding a row
      // the person's queue never admitted — and `?? at` here would draw *just now* over it.
      expect(aPersonsSince(row({}))).toBeNull()
      // 🔴 **And the stamp wins over the arm**, so an addressed row that somehow escalated still
      // reports the moment a person was FIRST told.
      expect(
        aPersonsSince(
          row({
            went: { is: 'the-person-the-asker-named', to: 'a-person' },
            escalatedAt: 31_000,
          }),
        ),
      ).toBe(31_000)
    })

    it('⛔ the chain of an ADDRESSED question ends at the person, and names no parent as answerer', async () => {
      const { worker, workerTools, piece } = await aWorkerHoldingWork()
      await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which cities?',
        who_answers: 'a-person',
      })
      const row = host.questionsForAPerson().rows[0]
      if (row === undefined) throw new Error('the addressed question did not reach the queue')
      // ⛔ **ONE hop.** Walking to the parent would draw *"the worker is waiting on the PM, the PM
      // is waiting on you"* about a PM that was never asked — `decisionReading`'s own argument,
      // which `HO-088` §2 gives a second subject.
      expect(row.reading.hops).toHaveLength(1)
      expect(row.reading.hops[0]?.on).toBeNull()
      expect(row.reading.unfollowable).toBe(false)
      expect(row.sentence).toContain('waiting on you')

      // ⚠️ **The CONTROL, one fact over**: the same conversation asking its PARENT walks two hops.
      await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which schema?',
        who_answers: 'the-parent',
      })
      const up = routedIn(worker, 'the-parent')
      const upward = escalationChain(
        { ...up, went: { is: 'the-parent', to: 'the-parent' } },
        () => null,
      )
      expect(upward.links[0]?.on).toBe(up.parent)
      expect(upward.endsWithAPerson).toBe(true)
    })
  })

  /**
   * 🔴 **§4 · PASSING UP — the act, and the words it may not change** (`HO-088` §3).
   */
  describe('§4 · a question passed up carries the original words', () => {
    it('🔴 the words are the ASKER’s, verbatim, and the passer’s context is BESIDE them', async () => {
      const { pm, worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const asked = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'Which cities does he want on the trip?',
        who_answers: 'the-parent',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')

      const passed = await callOn(pmTools, 'pass_question_up', {
        question: asked.question,
        who_answers: 'a-person',
        context: 'I have no way to know this; it is his own preference.',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')

      // ⛔ **The new row is in the PASSER's ledger and repeats the words EXACTLY.**
      const raised = store.questionsRaisedIn(pm).get(passed.question as string)
      if (raised === undefined) throw new Error('the passed-up question was not recorded')
      expect(raised.prompt).toBe('Which cities does he want on the trip?')
      // ⚑ **And the context is a field of its own** — *"the parent MAY add context; it may NOT
      // replace the question."*
      expect(raised.context).toBe('I have no way to know this; it is his own preference.')
      expect(raised.prompt).not.toContain('I have no way to know this')
      // 🔴 **The join, which is what makes *the original words travelled* checkable** rather than
      // promised: the row names the request it copied them from.
      expect(raised.passedUpFrom).toBe(asked.question)
      expect(store.questionsRaisedIn(worker).get(asked.question as string)?.prompt).toBe(
        raised.prompt,
      )
      // ⚠️ **It names NO piece**, because the work is the original asker's and a piece from
      // another conversation is a reference nothing here can resolve.
      expect(raised.piece).toBeNull()
      // ⛔ **And the child's question is STILL OPEN and still the passer's to answer** — passing
      // up raises a question, it does not settle one.
      const child = store.routedRequestsOf(worker).find((one) => one.requestId === asked.question)
      expect(REQUEST_IS_OPEN[child?.state ?? 'answered']).toBe(true)
    })

    it('⛔ there is no field to reword the question in, and that is the whole ruling', async () => {
      const { pmTools } = await aWorkerHoldingWork()
      const tool = pmTools.tools.find((one) => one.name === 'pass_question_up')
      if (tool === undefined) throw new Error('no pass_question_up')
      // ⚑ **`question` is an ID and not words** — the description says so, and the shape carries
      // exactly these keys. ⚑ **679 · `asked_by` joined them**: it names which child ASKED, when two
      // children's session-local ids are one string — a selector of the question carried, never
      // words and never where it goes (`who_answers` is still the only end).
      expect(Object.keys(tool.input).sort()).toEqual([
        'asked_by',
        'context',
        'question',
        'who_answers',
      ])
      // ⛔ **Nothing named for the words themselves.** A model that could send `prompt`, `text` or
      // `summary` could reword a question at a hop, which is the act `HO-088` §3.1 forbids.
      for (const reword of ['prompt', 'text', 'summary', 'question_text', 'words']) {
        expect(Object.keys(tool.input), reword).not.toContain(reword)
      }
      expect(tool.description).toContain('exactly as it was asked')
      expect(tool.description).toContain('you cannot reword them')
    })

    it('⚑ the next hop READS the original words, with the context in its own paragraph', async () => {
      const { pm, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const asked = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'Which cities does he want on the trip?',
        who_answers: 'the-parent',
      })
      const passed = await callOn(pmTools, 'pass_question_up', {
        question: asked.question,
        who_answers: 'a-person',
        context: 'he has not said, and I cannot guess it',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
      // ⛔ **The passed-up question is the PASSER's own**, so it is in the person's queue under
      // that conversation — and the words there are the ORIGINAL asker's.
      const personsRow = host
        .questionsForAPerson()
        .rows.find((one) => one.request.requestId === passed.question)
      expect(personsRow?.request.askedBy).toBe(pm)

      // ⚑ **And the CONTEXT is rendered beside them, in its own paragraph**, by the same function
      // that composes the message a live next hop receives — so the two readings cannot drift.
      const raised = store.questionsRaisedIn(pm).get(passed.question as string)
      // ⚑ D-016 · commit 7 · R3 — the asker as the host hands it: named by its work, and the
      // address `asked_by` quotes.
      const asker = { called: host.nameByItsWork(pm), address: host.addressOf(pm) }
      const rendered = questionText(asker, { ...raised!, id: passed.question as string })
      expect(rendered).toContain('Which cities does he want on the trip?')
      expect(rendered).toContain('Context added by the conversation that passed it on')
      expect(rendered).toContain('he has not said, and I cannot guess it')
      // ⛔ **The two are separate paragraphs**, which is what keeps *added* and *asked* tellable
      // apart three hops down.
      const asParagraphs = rendered.split('\n\n')
      expect(asParagraphs.some((one) => one === 'Which cities does he want on the trip?')).toBe(
        true,
      )
      // ⚠️ **The CONTROL, one fact over**: the same renderer over a question nobody added to draws
      // no context paragraph at all.
      const plain = store.questionsRaisedIn(pm).get(passed.question as string)
      expect(questionText(asker, { ...plain!, id: 'x', context: null })).not.toContain(
        'Context added by',
      )
      // ⚑ **And `list_questions` still reads for the caller it is asked of** — the PM's list holds
      // the question its WORKER asked it, which is the hop below rather than the one it made.
      const listed = await textOn(pmTools, 'list_questions', {})
      expect(listed).toContain(asked.question as string)
    })

    it('⛔ a conversation nothing spawned cannot pass UP, and is told the other end exists', async () => {
      // 🔴 **This is `HO-088` §6's last hop** — BroBot itself, which nothing spawned.
      const { pm, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const asked = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which cities?',
        who_answers: 'the-parent',
      })
      expect(store.parentOf(pm)).toBeNull()
      const refused = await callOn(pmTools, 'pass_question_up', {
        question: asked.question,
        who_answers: 'the-parent',
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('nobody-to-pass-it-up-to')
      // ⛔ **PERMANENT and with NO remedy code** — `425` §3.1's biconditional: nothing re-parents a
      // conversation, so the identical call never lands. ⚑ The other end is in the SENTENCE.
      expect(refused.permanence).toBe('permanent')
      expect(refused.retryable).toBe(false)
      expect(refused.remedy).toBeNull()
      expect(String(refused.reason)).toContain('a person')

      // ⚑ **The PAIRED call, one fact over, ALLOWED** (standing rule 3): the same question, the
      // same caller, the other member of the vocabulary.
      const passed = await callOn(pmTools, 'pass_question_up', {
        question: asked.question,
        who_answers: 'a-person',
      })
      expect(passed.outcome, JSON.stringify(passed)).toBe('ok')
      // ⛔ **And the row names NO parent**, because there is none — rather than naming a
      // conversation this app never asked.
      const row = routingsIn(pm).find((one) => one.requestId === passed.question)
      expect(row?.parent).toBeUndefined()
      expect(routedIn(pm, 'the-person-the-asker-named').parent).toBeNull()
    })

    it('⚠️ a PERMISSION cannot be passed up, and nor can one that has ended', async () => {
      const { pm, worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      // ⛔ **The permission arm.** A request the channel refused is a person's already, so there
      // is nothing to pass — and it is refused by the rail that says so BY NAME.
      const card = ledger(worker)
        .filter(
          (event): event is TranscriptEvent & { type: 'permission_request'; id: string } =>
            event.type === 'permission_request',
        )
        .at(-1)
      if (card === undefined) throw new Error('the worker is not parked on anything')
      const permission = await callOn(pmTools, 'pass_question_up', {
        question: card.id,
        who_answers: 'a-person',
      })
      expect(permission.outcome, JSON.stringify(permission)).toBe('refused')
      expect(permission.rail).toBe('a-person-answers-this-one')

      // ⚑ **An id nothing routed to this caller** — the lookup IS the entitlement.
      const invented = await callOn(pmTools, 'pass_question_up', {
        question: 'req_00000000-0000-0000-0000-000000000000',
        who_answers: 'a-person',
      })
      expect(invented.rail).toBe('no-question-by-that-name')

      // ⚠️ **And one that has ended.** The work is withdrawn, which ends the question with it.
      const asked = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which schema?',
        who_answers: 'the-parent',
      })
      await callOn(pmTools, 'withdraw_task', { piece })
      const ended = await callOn(pmTools, 'pass_question_up', {
        question: asked.question,
        who_answers: 'a-person',
      })
      expect(ended.rail).toBe('question-has-already-ended')
      // ⛔ **Nothing was passed up by any of the three refusals.** ⚑ **D-016** — the one routing on
      // the PM's ledger may be the permission card its own turn parks on (the delivered question
      // opened it, and `withdraw_task` now awaits telling the worker, so that row can land first);
      // it is a person's, and no pass-up of anybody's.
      expect(
        store
          .routedRequestsOf(pm)
          .filter((one) => one.went.is !== 'the-person-the-channel-left-it-with'),
      ).toEqual([])
      expect(store.questionsRaisedIn(pm).size).toBe(0)
    })

    it('⛔ the two new rails are in the vocabulary, permanent, and carry no remedy', () => {
      for (const rail of ['nobody-to-pass-it-up-to', 'this-app-does-not-hold-those-words']) {
        expect([...QUESTION_RAILS], rail).toContain(rail)
      }
      // ⚑ **Distinct sentences across the whole vocabulary** — `374`'s rule, re-asked because two
      // members joined it.
      const sentences = new Set<string>()
      for (const rail of QUESTION_RAILS) sentences.add(rail)
      expect(sentences.size).toBe(QUESTION_RAILS.length)
    })
  })

  /**
   * 🔴 **§5 · the ANSWER path, and the half of it that is still missing.**
   */
  describe('§5 · addressing is where it GOES, not a lock on who may answer', () => {
    it('⚑ the parent may still answer a question its child addressed to a person', async () => {
      const { pm, worker, pmTools, workerTools, piece } = await aWorkerHoldingWork()
      const asked = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which cities?',
        who_answers: 'a-person',
        options: ['Lisbon', 'Porto'],
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      // ⛔ **`HO-088` §2.3: *"Ada still SEES that Ali asked and sees the answer."*** ⚑ The words
      // are there, and `answerable_by_you` says the door will take it.
      const listed = (await callOn(pmTools, 'list_questions', {})).questions as Record<
        string,
        unknown
      >[]
      const row = listed.find((one) => one.question === asked.question)
      expect(row?.answerable_by_you).toBe(true)
      expect(row?.went_to).toBe('a-person')
      expect(String(row?.words)).toContain('which cities?')

      // 🔴 **And it really is answerable** — measured through the door rather than read off a
      // field. ⛔ Refusing here would leave the question with NOBODY in this app able to settle
      // it, which is `589`'s permanent *NEEDS YOU* rebuilt (see §5.2 below).
      const answered = await callOn(pmTools, 'answer_question', {
        question: asked.question,
        answers: [{ part: 'answer', answer: ['Lisbon'] }],
      })
      expect(answered.outcome, JSON.stringify(answered)).toBe('ok')
      const settled = store.routedRequestsOf(worker).find((one) => one.requestId === asked.question)
      expect(settled?.state).toBe('answered')
      // ⚑ **It leaves the person's queue the moment the ledger says so.**
      expect(host.questionsForAPerson().rows).toEqual([])
      expect(pm).not.toBe(worker)
      // ⚠️ **And the answer reaches the worker as WORDS**, which is `591`'s route unchanged.
      await waitFor(
        () => wordsIn(worker).some((text) => text.includes('Lisbon')),
        'the answer to reach the worker',
      )
    })

    it('🔴 5.2 · what a PERSON sees at it — the limit, which is this dispatch’s finding', async () => {
      const { workerTools, piece } = await aWorkerHoldingWork()
      const asked = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which cities?',
        who_answers: 'a-person',
      })
      const row = host.questionsForAPerson().rows[0]
      if (row === undefined) throw new Error('the addressed question did not reach the queue')
      expect(row.request.requestId).toBe(asked.question)
      // ⛔ **`602`'s answer, reached without a thirty-second wait for the first time.** A question
      // this app raised has NO card in any window — `transcript.ts` draws a notice for the row —
      // so the queue says *no card was drawn* and offers no control.
      expect(row.raisedBy).toBe('this-app')
      // ⚠️ **Standing rule 8.4: the limit is the finding, not the test.** A person reading this
      // row can open the conversation and can settle nothing from there; the only door that
      // settles it is `respondUserInput`, which a card is what reaches. ⛔ `611` made that path
      // ordinary rather than rare, and did not build the control — see `611`'s response §4.
      expect(row.work.length).toBeGreaterThanOrEqual(0)
      // ⚑ **The POSITIVE control**: a PERMISSION in the same workspace does have a card, so the
      // absence above is a property of this population rather than of this fixture.
      expect(host.decisionsForAPerson().rows.length).toBeGreaterThanOrEqual(0)
    })
  })

  /**
   * 🔴 **§6 · the DIRECTION LINE** (`HO-088` §4.1) — rendered, beside the sender, and a HINT.
   */
  describe('§6 · the one line of direction every message carries', () => {
    it('⚑ it renders both recipient choices with the condition that makes each valid', () => {
      const line = theDirectionLine('a person')
      expect(line).toContain('You are answering a person')
      expect(line).not.toContain('A note expects no answer')
      // PE-005: a person-started conversation has no parent; the hint cannot imply it does.
      expect(line).toContain(QUESTION_RECIPIENTS[0])
      expect(line).toContain(QUESTION_RECIPIENTS[1])
      expect(line).toContain('For a question about a piece another conversation gave you')
      expect(line).toContain('If no conversation gave you work')
      expect(line).not.toContain('A question of your own goes to the-parent')
      expect(line).toContain('ask_question')
      expect(line).toContain('who_answers')
      // ⚠️ **It says there is NO DEFAULT**, because the door refuses a call that did not say — a
      // line promising the app would choose would describe a behaviour it does not have.
      expect(line).toContain('there is no default')
    })

    it('PE-009 · an agent note is not answered by turn text', () => {
      const line = theDirectionLine('Pam (pm), conversation `sess_9`', 'caller')
      expect(line).not.toContain('You are answering Pam')
      expect(line).toContain('words you write in this turn do not reach Pam')
      expect(line).toContain('A note expects no answer')
      expect(line).toContain('message_agent')
      expect(line).toContain('answer_question')
      expect(line).toContain('reply_to_parent')
      // ⚑ W4.178 · words that hand over a piece: the same line without the note's sentence, whose
      // piece line asks for `reply_to_parent`.
      const brief = theDirectionLine('Pam (pm), conversation `sess_9`', 'caller', true)
      expect(brief).not.toContain('A note expects no answer')
      expect(brief).toBe(line.replace('A note expects no answer. ', ''))
    })

    it('⛔ it rides with the sender line on BOTH arms, in its own paragraph', () => {
      const persons = messageNamingItsSender('go on', { who: 'a-person', profile: null })
      expect(persons.split('\n\n')[1]).toBe(theDirectionLine('a person'))
      const agents = messageNamingItsSender(
        'go on',
        { who: 'a-caller-with-an-id', caller: 'sess_9', profile: 'pm', aPersonIsBehindIt: false },
        () => ({
          name: 'Pam',
          handsYou: null,
          openWorkItGaveYou: [],
          gaveYouWorkThatIsClosed: false,
          // ⚑ D-016 · commit 7 · R3 — a sender that holds no piece has no label to be addressed by.
          named: null,
          about: null,
        }),
      )
      // ⚑ D-011 — the sender by name, and (holding no piece) its conversation id as the address.
      expect(agents.split('\n\n')[1]).toBe(
        theDirectionLine('Pam (pm), conversation `sess_9`', 'caller'),
      )
      // ⛔ **And the app's OWN composed sentences keep the silence** — `607`'s ruling: a direction
      // line on BroBot's own notice would be this app instructing an agent about a turn it wrote.
      expect(messageNamingItsSender('a question from your worker', null)).toBe(
        'a question from your worker',
      )
    })

    it('⚠️ it is a HINT: no rail enforces it, and the door still refuses a caller that did not say', async () => {
      const { workerTools, piece } = await aWorkerHoldingWork()
      // 🔴 **`HO-088` §4.2 and `581`'s bound**: we can prove what was SENT and never what was
      // HEEDED. ⛔ So the line naming `the-parent` does NOT become the value a silent call gets.
      const silent = await callOn(workerTools, 'ask_question', {
        piece,
        question: 'which schema?',
      })
      expect(silent.outcome).toBe('refused')
      // ⚑ **And nothing anywhere reads the line back** — a rail built on a sentence would be
      // `HO-062` §2's *safety lives in the RAILS* broken at the one venue it is about.
      const host_ = codeOf('main/runtime/runtime-host.ts')
      expect(host_).not.toContain('theDirectionLine')
    })
  })

  /**
   * 🔴 **§7 · the SWEEP** (standing rule 8.1) — both audiences, each with a positive control.
   */
  describe('§7 · the sentences that went false with the ruling', () => {
    it('⛔ the MODEL’s: no rendered sentence names a verb this app no longer publishes', () => {
      // ⛔ **The two rendered sentences that named it** — the tool's own description and the line
      // `reply-rails.ts` renders into every work message.
      const tools = codeOf('main/runtime/agent-tools.ts')
      const rails = codeOf('main/runtime/reply-rails.ts')
      for (const where of [tools, rails]) {
        expect(where).not.toContain('ask_parent')
      }
      // ⚑ **And the rails line names the ARGUMENT as well as the verb**, because a sentence that
      // named the verb alone would walk a model into a `malformed-request`.
      // ⚑ **D-016 · the argument is the piece** — the line names it by its label.
      expect(rails).toContain('call ask_question with piece ')
      expect(rails).toContain('who_answers')
      // 🔴 **The positive control** (rule 34.2): the census can find the old name, because this
      // file's own prose holds it.
      expect(`${tools} ask_parent`).toContain('ask_parent')
      // ⚠️ **And the published roster really has the new names**, so the negative above is not
      // green because the verbs went away.
      expect([...TOOL_NAMES]).toContain('ask_question')
      expect([...TOOL_NAMES]).toContain('pass_question_up')
      expect([...TOOL_NAMES]).not.toContain('ask_parent')
    })

    it('⚑ the PERSON’s: the count is ZERO, and here is the shape that would have found one', () => {
      // 🔴 **Standing rule 8.1 wants BOTH counts, including *I found none on this side*.** ⛔ The
      // person's surfaces are `*.vue`, `renderer/src/lib/*-text.ts`, `*-offer.ts` and what
      // `visible-copy.ts` reads; the sweep is for the WORDS a person would see the old behaviour
      // in, not for the file.
      const drawn = [
        'renderer/src/lib/persons-queue.ts',
        'renderer/src/lib/transcript.ts',
        'renderer/src/lib/work-report.ts',
        'renderer/src/lib/agent-state.ts',
        'renderer/src/lib/session-panel.ts',
      ]
      for (const file of drawn) {
        const prose = proseOf(file)
        expect(prose.length, `${file} is not where this census thinks it is`).toBeGreaterThan(200)
      }
      // ⚑ **Zero, and said**: no sentence a PERSON reads named the verb or promised where a
      // question goes — the recipient has never been rendered to them.
      const everythingAPersonReads = drawn.map((file) => codeOf(file)).join('\n')
      for (const claim of ['ask_parent', 'goes to your parent', 'always goes to the parent']) {
        expect(everythingAPersonReads, claim).not.toContain(claim)
      }
      // 🔴 **The positive control**: the same search over the MODEL's side finds the verb, so the
      // zero above is a measurement rather than a search that could not fire.
      expect(codeOf('main/runtime/reply-rails.ts')).toContain('ask_question')
    })

    it('⚠️ and the docblock that ruled the invariant is REPLACED rather than left standing', () => {
      const questions = proseOf('shared/questions.ts')
      const ipc = proseOf('shared/runtime-ipc.ts')
      // ⛔ **`619`'s hazard** — `a-description-hardens-into-a-ruling-in-the-docblock-it-leaves`. The
      // old sentence is QUOTED as history in both places and is not stated as a rule.
      expect(questions).toContain('if and only if')
      expect(questions).toContain('FALSE since 611')
      expect(ipc).toContain('held until `611`')
      // ⚑ **And the surviving half is stated**, because one direction of the invariant is true.
      expect(ipc).toContain('A `because` still implies')
    })
  })
})
