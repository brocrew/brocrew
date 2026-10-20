import { navigationReply } from './helpers/navigation-reply'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { permanenceOf, retryableOf, refuse } from '../src/main/runtime/spawn-rails'
import type { AgentToolHost } from '../src/main/runtime/agent-tools'
import {
  TOOL_REFUSALS,
  agentToolsFor,
  refuseTool,
  refusalIn,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { MAX_TEXT_RESOURCE_BYTES, refuseResource } from '../src/main/resources/resources'
import {
  MAX_REFUSAL_TOLD,
  PERMANENCE_SAID,
  RAIL_PERMANENCES,
  isRailPermanence,
  refusalToldOf,
  storedRefusalTold,
} from '../src/shared/refusals'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import type {
  RuntimeEventMessage,
  ToolRefusedEvent,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import { permanenceInWords } from '../src/main/runtime/agent-tool-answer-words'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

/**
 * 🔴 **405 · a refusal you can see** (HO-019 §4, `402` F2).
 *
 * ## ⛔ The defect, in the two rows a person was left with
 *
 * `402` drove a real Codex worker this app refused and read its ledger back:
 *
 * ```
 * tool_call    name: brobot__spawn_agent   summary: dynamicToolCall
 * tool_result  summary: dynamicToolCall    ok: true
 * ```
 *
 * ⚑ **`ok: true` is CORRECT** — `307` measured that a refusal must be a SUCCESSFUL call whose
 * payload denies the request, because a thrown handler reaches a model as transport-shaped `-32603`
 * and *"carries no machine-readable policy meaning"*. ⛔ **And those are the same two rows an
 * ADMITTED spawn writes**, so the ledger cannot tell a rail doing its job from a rail that never
 * fired.
 *
 * 🔴 **HO-019 §4:** *"Our entire rail discipline is demonstrated by an actual refusal — and if the
 * ledger cannot tell the two apart, that discipline is provable in TESTS and invisible in
 * PRODUCTION."* ⚠️ **F4 is the proof of why it matters**: the only reason anybody saw a model route
 * around one of our rails is that a person happened to be reading a live run.
 *
 * ## ⚑ What this file measures
 *
 * ⛔ **Real host, real SQLite ledger, real migrations, real rails.** The only double is the provider.
 * Every refusal below is a REAL rail answering a real call — nothing is constructed — and every one
 * is paired with the same call one fact over ADMITTED, which is standing rule 3.
 *
 * ⚑ **D-016 · the door that starts a conversation is `give_work`** — `spawn_agent` is gone, and its
 * `unknown-profile` is the give's `no-such-profile` (R3). Every rail below is re-aimed at it.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('405 · a refusal you can see', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-refusal-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-refusal-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 3_000_000
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = aHostOn(store)
    window = new RecordingSink('webContents:1')
  })

  /** A host on one store, as the app builds it at a launch. */
  const aHostOn = (on: SessionStore): RuntimeHost =>
    new RuntimeHost({
      store: on,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => join(userData, 'resources'),
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

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode },
      window,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const grant = (profileId: string, edit: Parameters<SessionStore['setCapabilities']>[1]): void => {
    expect(store.setCapabilities(profileId, edit)).toBe(true)
  }

  /** The toolset one session is offered, called the way a provider would call it. */
  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    const call = async (name: ToolName, args: Record<string, unknown> = {}) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return answered.structured as Record<string, unknown>
    }
    return { set, call }
  }

  /**
   * ⛔ **The host seam `agentToolsFor` is actually given**, with one or two members replaced.
   *
   * ⚠️ **Every member is delegated to the real host** rather than stubbed, so a test that overrides
   * one is measuring the real thing everywhere else. ⚑ It is written out in full deliberately: the
   * list is `AgentToolHost`'s, and a member added to that interface makes this fail to compile —
   * which is how `a-task-you-can-see.test.ts`'s census of the same surface behaves one file over.
   */
  const seam = (over: Partial<AgentToolHost>): AgentToolHost => ({
    // ⚑ **D-016 · the give and its readers**, delegated like every other member.
    giveWork: (...args) => host.giveWork(...args),
    updateWork: (...args) => host.updateWork(...args),
    // ⚑ **D-016 · commit 6 · `take_on_work`'s door**, delegated like every other member.
    takeOnWork: (...args) => host.takeOnWork(...args),
    whatAPieceIsTo: (...args) => host.whatAPieceIsTo(...args),
    mayCreateAgents: (...args) => host.mayCreateAgents(...args),
    mayReachAtAll: (...args) => host.mayReachAtAll(...args),
    readResource: (...args) => host.readResource(...args),
    queueMessage: (...args) => host.queueMessage(...args),
    messageAgentNow: (...args) => host.messageAgentNow(...args),
    agentsVisibleTo: (...args) => host.agentsVisibleTo(...args),
    archivedVisibleTo: (...args) => host.archivedVisibleTo(...args),
    restoreAsAnAgent: (...args) => host.restoreAsAnAgent(...args),
    whenItWasArchived: (...args) => host.whenItWasArchived(...args),
    profilesVisibleTo: (...args) => host.profilesVisibleTo(...args),
    // ⚑ **F009 · one agent's record** — added because the interface gained it, which is what this
    // seam is for.
    agentRecord: (...args) => host.agentRecord(...args),
    agentCard: (...args) => host.agentCard(...args),
    whatOpenedItsLastTurn: (...args) => host.whatOpenedItsLastTurn(...args),
    // ⚑ **D-017's two readers** (R12's reach answer, R10's replacement), delegated like every other
    // member — see this helper's own note.
    whyItIsOutOfReach: (...args) => host.whyItIsOutOfReach(...args),
    // ⚑ **D-016 · commit 7 · R1 — the one reading of an agent address**, delegated like every other
    // member — see this helper's own note.
    theConversationAddressed: (...args) => host.theConversationAddressed(...args),
    tookItsPlace: (...args) => host.tookItsPlace(...args),
    // ⚑ Added because the interface gained it, which is what this seam is for.
    whyWhatIsHeldWaits: (...args) => host.whyWhatIsHeldWaits(...args),
    // ⚑ **437's verb, delegated like every other member** — see this helper's own note.
    raiseAQuestion: (...args) => host.raiseAQuestion(...args),
    requestAnAction: (...args) => host.requestAnAction(...args),
    // ⚑ **611 · delegated like every other member** — see this helper's own note.
    passQuestionUp: (...args) => host.passQuestionUp(...args),
    withdrawQuestion: (...args) => host.withdrawQuestion(...args),
    // ⚑ **D-012's reader, delegated like every other member.**
    readTranscript: (...args) => host.readTranscript(...args),
    replyToParent: (...args) => host.replyToParent(...args),
    maySaveMemory: (...args) => host.maySaveMemory(...args),
    pieceBoard: (...args) => host.pieceBoard(...args),
    answersHeldFor: (...args) => host.answersHeldFor(...args),
    pieceRecord: (...args) => host.pieceRecord(...args),
    // ⚑ **D-024 · R3 · `list_tasks` with `made`** — added because the interface gained it, which is
    // what this seam is for.
    madeByItsProfile: (...args) => host.madeByItsProfile(...args),
    // ⚑ **D-037 · `find_files`** — added because the interface gained it, which is what this seam is
    // for.
    findKeptFiles: (...args) => host.findKeptFiles(...args),
    // ⚑ **724's reader, delegated like every other member.**
    whatToCallTheConversation: (...args) => host.whatToCallTheConversation(...args),
    // ⚑ **D-016 · commit 7 · R3 — a conversation named by the piece it owns, and its address**,
    // delegated like every other member.
    nameByItsWork: (...args) => host.nameByItsWork(...args),
    // ⚑ **F033 · …and in a sentence about one piece, both** — added because the interface gained
    // them, which is what this seam is for.
    nameByItsWorkUnder: (...args) => host.nameByItsWorkUnder(...args),
    addressOf: (...args) => host.addressOf(...args),
    addressOfUnder: (...args) => host.addressOfUnder(...args),
    // ⚑ **429's verb** — added because the interface gained it, which is what this seam is for.
    takeBackPiece: (...args) => host.takeBackPiece(...args),
    // ⚑ **703 · delegated like every other member** — see this helper's own note.
    takeBackWhatItsQuestionMadeFalse: (...args) => host.takeBackWhatItsQuestionMadeFalse(...args),
    answerQuestion: (...args) => host.answerQuestion(...args),
    interruptAgent: (...args) => host.interruptAgent(...args),
    // ⚑ **676 · `list_questions`' counted read** — `questionsWaitingOn` with its unread count.
    questionsListedFor: (...args) => host.questionsListedFor(...args),
    createAgentFor: (...args) => host.createAgentFor(...args),
    // ⚑ **D-042 · R2 — `create_agent`'s default, judged by the one seam** — added because the
    // interface gained it, which is what this seam is for.
    judgeTheDefaultItNames: (...args) => host.judgeTheDefaultItNames(...args),
    // ⚑ **582 · straight through to the real host**, like its neighbour.
    proposeAgentRules: (...args) => host.proposeAgentRules(...args),
    requestMcpServer: (...args) => host.requestMcpServer(...args),
    noteRefusal: (...args) => {
      host.noteRefusal(...args)
    },
    ...over,
  })

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((one) => one.event)

  /**
   * ⚠️ **A named reader, and the negatives below depend on it being one.** `store.events` answers
   * `{ordinal, at, event}` rows, so a filter on `.type` reads `undefined` on every one of them and a
   * *"no refusal was recorded"* assertion passes over a list of nothing — the exact vacuity
   * `the-five-tools.test.ts` caught in its own first draft. ⛔ Every negative here is paired with a
   * positive over the same reader.
   */
  const refusalsIn = (sessionId: string): ToolRefusedEvent[] =>
    events(sessionId).filter((one): one is ToolRefusedEvent => one.type === 'tool_refused')

  /** The one refusal this conversation recorded — and a failure, loudly, when it is not one. */
  const theRefusalIn = (sessionId: string): ToolRefusedEvent => {
    const rows = refusalsIn(sessionId)
    expect(rows).toHaveLength(1)
    const [row] = rows
    if (row === undefined) throw new Error(`${sessionId} recorded no refusal`)
    return row
  }

  /** The one transcript item this row draws, as a notice — and a failure when it draws anything else. */
  const theNoticeFor = (event: TranscriptEvent): NoticeItem => {
    const state = createTranscript()
    applyEvent(state, event)
    expect(state.items).toHaveLength(1)
    const [item] = state.items
    if (item === undefined || item.kind !== 'notice') {
      throw new Error(`${event.type} drew ${item === undefined ? 'nothing' : item.kind}`)
    }
    return item
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the headline — a real rail, and the same call one fact over
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a refusal is in the ledger, and an admitted call is not', () => {
    it('🔴 `no-such-profile` — refused with its rail, its permanence and its retryability', async () => {
      const pm = await personOpens('pm')
      // ⛔ **No grant and no identity arranged, so the rail is the world as it is.** Any agent may
      // give to any agent this app holds (D-014), and nobody has run a conversation as `worker`.
      const { call } = toolsOf(pm)

      const refused = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'do the thing',
        brief: 'do the thing',
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('no-such-profile')

      const row = theRefusalIn(pm)
      expect(row.tool).toBe('give_work')
      expect(row.rail).toBe('no-such-profile')
      // ⛔ **Asserted against the RAIL's own table, never against a word typed out here.** Standing
      // rule 1: a restated fact drifts, and a test that pinned `'permanent'` as a literal would keep
      // passing after somebody changed the rail's mind about it.
      expect(row.permanence).toBe(permanenceOf('no-such-profile'))
      expect(row.retryable).toBe(retryableOf('no-such-profile'))
      // ⚑ **And the row agrees with what the MODEL was told**, which is the whole claim: the
      // transcript and the payload are the same refusal.
      expect(row.permanence).toBe(refused.permanence)
      expect(row.retryable).toBe(refused.retryable)
    })

    it('⚑ the paired positive — one identity over, the identical call is admitted and writes NO row', async () => {
      // ⛔ **The ONE fact that differs from the test above**: `worker` exists. Same tool, same
      // arguments, same caller — standing rule 3's *"the same call one fact over allowed"*.
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      const { call } = toolsOf(pm)

      const admitted = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'do the thing',
        brief: 'do the thing',
      })
      expect(admitted.outcome).toBe('ok')
      expect(host.sessionIds).toContain(admitted.agent as string)

      // ⚠️ **Paired with a positive over the SAME reader**, so this negative cannot pass because
      // `refusalsIn` is broken.
      expect(events(pm).length).toBeGreaterThan(0)
      expect(refusalsIn(pm)).toEqual([])
    })

    it('🔴 `too-deep` — the second rail `402` produced live, and it reads DIFFERENTLY from the first', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      // ⛔ **The identity exists AND the depth is refused**, so the rail that fires is the depth one
      // and not the existence one — `admitGive` asks depth first (R2).
      grant('pm', { maxDepth: 0 })
      const { call } = toolsOf(pm)

      const refused = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'deeper',
        brief: 'deeper',
      })
      expect(refused.rail).toBe('too-deep')

      const row = theRefusalIn(pm)
      expect(row.rail).toBe('too-deep')
      expect(row.permanence).toBe(permanenceOf('too-deep'))
      expect(row.retryable).toBe(retryableOf('too-deep'))
      // 🔴 **The two rails DIVERGE, and that is the point of measuring both** (standing rule 3).
      // ⛔ Three of `341`'s own rows survived because they had only ever been measured where two
      // readings agree (`a-comparison-tested-where-both-sides-agree`). ⚑ `no-such-profile` is a
      // fact about the CALL and is `permanent`, so a row that recorded a constant permanence would
      // satisfy §1's first test and die here.
      expect(permanenceOf('too-deep')).not.toBe(permanenceOf('no-such-profile'))
      expect(row.permanence).toBe('until-a-person-changes-it')
      // ⚑ **And `max_depth` is why**: a count on the grant sheet, with no call the caller could
      // change — the door fills in the parent itself.
      expect(row.retryable).toBe(false)
    })

    it('⚑ the paired positive for depth — `maxDepth` back at its default admits the identical call', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      // ⚑ `null` is *use the default*, which is the one fact that differs from the test above.
      grant('pm', { maxDepth: null })
      const { call } = toolsOf(pm)
      const admitted = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'deeper',
        brief: 'deeper',
      })
      expect(admitted.outcome).toBe('ok')
      expect(events(pm).length).toBeGreaterThan(0)
      expect(refusalsIn(pm)).toEqual([])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · representative doors, because recording is at the EXIT and not scattered returns
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · each named refusal call leaves its own row', () => {
    it('🔴 a spawn rail, a tool refusal, a reply rail and a question rail each land with their own word', async () => {
      await bringIdentityIntoBeing('worker')
      // ⚑ **D-016 · an `auto` PM**, so the worker its give starts runs its brief to the END with the
      // piece still open, and can ask about it — the question the fifth door below answers.
      const pm = await personOpens('pm', 'auto')
      const { call } = toolsOf(pm)

      // 1 · `SPAWN_RAILS` — the door `341` built, refused by the depth a person set: the one
      // start rail that waits on a person now that any agent may give to any agent (D-014).
      grant('pm', { maxDepth: 0 })
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      })
      // 2 · `TOOL_REFUSALS` — this file's own vocabulary. ⚑ D-016: a note, since a follow-up names
      // a piece and this one only needs an agent that is not there.
      await call('message_agent', { agent: 'sess_nobody', text: 'hello', kind: 'note' })
      // 3 · `REPLY_RAILS` — 393's door.
      await call('reply_to_parent', { piece: 'W99.9', outcome: 'done', summary: 'done it' })
      // 4 · `QUESTION_RAILS` — 394's door.
      await call('answer_question', {
        question: 'req_nobody',
        answers: [{ part: 'p', answer: ['yes'] }],
      })
      // 5 · 🔴 **The sample's only RETRYABLE row** (424). ⛔ **The four above were `{true, false}`
      // between them until `424` turned three of them over**: `no-such-agent`, the reply's unknown
      // piece and `no-question-by-that-name` are all `permanent` now, and `too-deep` waits on a
      // person — so without a fifth door the set assertion below would have become *"they are all
      // false"*, which a hardcoded field satisfies. ⚑ **An answer over the bound is the real
      // transient one** (a give is no longer refused over a stall): the same call with shorter words
      // lands, and nobody else has to decide anything.
      grant('pm', { maxDepth: null })
      const given = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'a piece',
        brief: 'go',
      })
      const asked = await toolsOf(given.agent as string).call('ask_question', {
        who_answers: 'the-parent',
        piece: given.label,
        question: 'what should it say?',
      })
      expect(asked.outcome, JSON.stringify(asked)).toBe('ok')
      await call('answer_question', {
        question: asked.question,
        answers: [{ part: 'answer', answer: ['y'.repeat(1281)] }],
      })

      const rows = refusalsIn(pm)
      expect(rows.map((one) => one.tool)).toEqual([
        'give_work',
        'message_agent',
        'reply_to_parent',
        'answer_question',
        'answer_question',
      ])
      expect(rows.map((one) => one.rail)).toEqual([
        'too-deep',
        'no-such-agent',
        'no-piece-by-that-name',
        'no-question-by-that-name',
        'answer-too-long',
      ])
      // 🔴 **The complete permanence and retryability vocabularies are present in this sample.** ⛔ A row
      // that hardcoded either field would pass a suite that only ever refused one door.
      expect(new Set(rows.map((one) => one.permanence))).toEqual(
        new Set(['permanent', 'until-a-person-changes-it', 'while-this-holds']),
      )
      expect(new Set(rows.map((one) => one.retryable))).toEqual(new Set([true, false]))
    })

    it('⚑ the paired positive — a reader that ANSWERS writes no row at all', async () => {
      const pm = await personOpens('pm')
      const { call } = toolsOf(pm)
      const listed = await call('list_agents')
      expect(listed.outcome).toBe('ok')
      const asked = await call('list_tasks')
      expect(asked.outcome).toBe('ok')
      expect(events(pm).length).toBeGreaterThan(0)
      expect(refusalsIn(pm)).toEqual([])
    })

    it("⛔ the row lands in the CALLER's ledger and in nobody else's", async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      const { call } = toolsOf(pm)
      const spawned = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'work',
        brief: 'work',
      })
      const child = spawned.agent as string

      // ⚑ **The CHILD asks for something that cannot be** — an agent nobody has made.
      const childTools = toolsOf(child)
      const refused = await childTools.call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'nobody-by-that-name',
        title: 'a helper of my own',
        brief: 'a helper of my own',
      })
      expect(refused.rail).toBe('no-such-profile')

      // ⛔ **The child's ledger, because the child is who tried.** ⚠️ Not the parent's: the parent
      // did not call anything, and a refusal drawn into its transcript would tell a conversation
      // about a rule that stopped somebody else.
      expect(refusalsIn(child).map((one) => one.tool)).toEqual(['give_work'])
      expect(events(pm).length).toBeGreaterThan(0)
      expect(refusalsIn(pm)).toEqual([])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · what is recorded, and what §2 of the brief says must NOT be
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the refusal, not the request', () => {
    it('keeps a supplied resource path in actionable prose and out of the stored quotation', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      const file = join(work, 'PRIVATE_CALLER_PATH.md')
      writeFileSync(file, Buffer.alloc(MAX_TEXT_RESOURCE_BYTES + 1, 'x'))
      const { set } = toolsOf(pm)
      const give = set.tools.find((one) => one.name === 'give_work')!
      const answered = await give.call({
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Read the fictional input',
        brief: 'Read the fictional input',
        inputs: [file],
      })
      expect(answered.structured).toMatchObject({ outcome: 'refused', rail: 'resource-too-large' })
      expect(answered.text).toContain(file)
      expect(JSON.stringify(answered.structured!['detail'])).toContain(JSON.stringify(file))
      const rows = refusalsIn(pm)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.told).toEqual({ text: answered.structured!['reason'], dropped: 0 })
      expect(JSON.stringify(rows)).not.toContain(file)
      expect(JSON.stringify(rows)).not.toContain('PRIVATE_CALLER_PATH')
      expect(rows[0]?.rail).toBe('resource-too-large')
      expect(
        answered.text.startsWith(`refused (resource-too-large): ${String(rows[0]?.told?.text)}`),
      ).toBe(true)
    })

    it('🔴 nothing a caller wrote reaches the ledger — not the arguments and not the detail; the sentence the app composed does', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      // ⚑ **Refused by the depth a person set** — the give's one start rail that waits on a person.
      grant('pm', { maxDepth: 0 })
      const { call } = toolsOf(pm)
      // ⛔ **Words a person could have written**, in the fields `give_work` carries them in: the
      // `title` and `brief` are the work itself and `folder` is a path on this machine.
      const secretPurpose = 'ship the acquisition memo for Northwind before Friday'
      const secretFolder = join(work, 'northwind-acquisition')
      mkdirSync(secretFolder, { recursive: true })
      const refused = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: secretPurpose,
        brief: secretPurpose,
        folder: secretFolder,
      })
      expect(refused.outcome).toBe('refused')

      const row = theRefusalIn(pm)
      const written = JSON.stringify(row)
      expect(written).not.toContain('Northwind')
      expect(written).not.toContain('northwind-acquisition')
      // ⚑ **The door's own sentence is kept, whole** — what the caller was handed, so a person can
      // read all of it after a restart. ⛔ It is the app's words: none of the caller's are in it.
      expect(row.told).toEqual({
        text: `${String(refused.reason)} ${permanenceInWords(row.rail, row.permanence)}`,
        dropped: 0,
      })
      expect(refused.reason as string).not.toContain('Northwind')
      // ⚑ **The positive control, over the same string** — the negatives above are worth nothing
      // without it, because an empty row would pass all three.
      expect(written).toContain('too-deep')
      expect(written).toContain('give_work')
      // ⛔ **Exactly seven keys, so a later field cannot arrive unnoticed.** ⚑ **425 added the sixth**
      // — `remedy` — and this assertion is the reason the addition had to be argued rather than
      // dropped in: a row that gains a field silently is a row whose *record the refusal, not the
      // request* claim nobody re-checked. ⚑ The seventh is `told`, the sentence above.
      expect(Object.keys(row).sort()).toEqual([
        'permanence',
        'rail',
        'remedy',
        'retryable',
        'told',
        'tool',
        'type',
      ] as string[])
      // 🔴 **And the sixth field is `null` here, which is the whole of `425` §3.1 in one line.**
      // `too-deep` is a depth a person set; nothing this caller can do changes it, so the app says
      // nothing rather than inventing an act. ⚠️ The paired positive — a rail that DOES carry one —
      // is `a-refusal-carries-its-remedy.test.ts` §1.
      expect(row.remedy).toBeNull()
    })

    it('⚠️ a BROKEN tool is not a refusal, and writes nothing', async () => {
      const pm = await personOpens('pm')
      // ⛔ **307's line: a thrown handler is a BROKEN TOOL and deliberately not a policy decision.**
      // Both adapters answer one with `isError`/`success: false`, *"and saying so is what keeps a
      // refusal meaning something"*.
      //
      // 🔴 **Measured through the SEAM and not by replacing the published tool's `call`.** ⚠️ A first
      // draft did the second — `{...set.tools[n], call: () => reject()}` — which replaces the
      // recording wrapper itself, so it asserted nothing about the wrapper at all and would have
      // passed against every shape this row can take.
      const noted: [string, string][] = []
      const broken = seam({
        giveWork: () => Promise.reject(new Error('the door blew up')),
        noteRefusal: (_id, tool, refused) => {
          noted.push([tool, refused.rail])
        },
      })
      const tools = agentToolsFor(broken, pm)
      const invoke = async (name: ToolName, args: Record<string, unknown>) => {
        const one = tools.tools.find((tool) => tool.name === name)
        if (one === undefined) throw new Error(`no such tool: ${name}`)
        return one.call(args)
      }
      await expect(invoke('give_work', { profile: 'w', title: 'x', brief: 'x' })).rejects.toThrow(
        'the door blew up',
      )
      expect(noted).toEqual([])
      expect(refusalsIn(pm)).toEqual([])

      // ⚑ **The paired positive, over the SAME recorder** — a negative that reads a recorder nothing
      // ever writes to is a negative that would pass over a wrapper that had been deleted.
      await invoke('message_agent', { agent: 'sess_nobody', text: 'hello', kind: 'note' })
      expect(noted).toEqual([['message_agent', 'no-such-agent']])
    })

    // ⚑ **D-017 — *an end that FAILED is not a refusal either* (`375 M9`) is gone with
    // `end_agent`** (nothing ends a conversation). The rule it measured one door over — a thrown
    // handler is a broken tool, never a refusal — is the test above.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the census, with a control that plants TWO
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * ⛔ **Every payload this app hands a model saying `refused` is built by a named builder**, which
   * is what makes {@link refusalIn} — which reads the quartet back off an untyped bag — safe.
   *
   * ⚠️ **Prose-stripped**, because this file's subject is refusals and its own comments say
   * `outcome: 'refused'` while discussing them. ⛔ A census that read a docblock would report the
   * very shape it exists to find.
   */
  const REFUSAL_BUILDERS = [
    'refuseTool',
    'carryRailRefusal',
    'carryMessageRefusal',
    'carryReplyRefusal',
    'carryInterruptRefusal',
    'carryQuestionRefusal',
    // ⚑ **496 · the seventh was `carryEndRefusal`**, `END_RAILS`' own carrier. ⚑ **D-017 — gone
    // with `end_agent` and its vocabulary** (nothing ends a conversation).
  ]

  const withoutProse = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  /**
   * Every `outcome: 'refused'` that is NOT inside one of the builders, by index.
   *
   * ⚠️ **`readonly` is excluded, and it is a DECLARATION rather than a payload.** Both
   * {@link PublishedRefusal} and `ToolRefusalPayload` declare the discriminant as a field type, and
   * a census that counted those would report two strays that are the very types making the builders
   * safe. ⛔ The control below plants one of each so the exclusion is measured and not assumed.
   */
  const BUILT = /(?<!readonly )outcome: 'refused'/g

  const straysIn = (source: string): number[] => {
    const code = withoutProse(source)
    const spans: [number, number][] = []
    for (const name of REFUSAL_BUILDERS) {
      const opens = code.indexOf(`function ${name}(`)
      if (opens < 0) continue
      const closes = code.indexOf('\n}', opens)
      spans.push([opens, closes < 0 ? code.length : closes])
    }
    const found: number[] = []
    for (const hit of code.matchAll(BUILT)) {
      const at = hit.index
      if (!spans.some(([from, to]) => at > from && at < to)) found.push(at)
    }
    return found
  }

  describe('§3b · the sentence the caller was handed is kept whole, and read after a restart', () => {
    /** A refusal row as a build before the sentence was kept wrote it. */
    const AN_OLDER_ROW: ToolRefusedEvent = {
      type: 'tool_refused',
      tool: 'give_work',
      rail: 'no-such-profile',
      permanence: 'permanent',
      retryable: false,
      remedy: null,
    }
    /** Rows written into a conversation nothing runs, as a file a person imported would bring them. */
    const stored = (sessionId: string, rows: readonly object[]): ToolRefusedEvent[] => {
      for (const row of rows) {
        store.append(sessionId, store.nextOrdinal(sessionId), row as TranscriptEvent, tick())
      }
      return refusalsIn(sessionId)
    }

    it('🔴 a sentence longer than a receipt keeps is on the row whole, and a new host on the same file reads it back', async () => {
      const pm = await personOpens('pm')
      const refused = await toolsOf(pm).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'ghost',
        title: 'count the rows',
        brief: 'count the rows',
      })
      expect(refused.outcome).toBe('refused')
      const reason = refused.reason as string
      // ⚑ Longer than the 200 characters a tool's own row keeps of what it answered.
      expect(reason.length).toBeGreaterThan(200)
      const sentence = `${reason} ${permanenceInWords('no-such-profile', 'permanent')}`
      expect(theRefusalIn(pm).told).toEqual({ text: sentence, dropped: 0 })

      // The app is closed, and started again on the same file.
      await host.closeAll()
      db.close()
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      store = createSessionStore(db, tick)
      host = aHostOn(store)
      expect(theRefusalIn(pm).told).toEqual({ text: sentence, dropped: 0 })
      // ⚑ …and it is in the page a window is handed when it opens the conversation.
      const opened = await host.look(pm, new RecordingSink('webContents:2'), false)
      const drawn = opened.history.entries
        .map((one) => one.event)
        .filter((one): one is ToolRefusedEvent => one.type === 'tool_refused')
      expect(drawn).toHaveLength(1)
      expect(drawn[0]?.told).toEqual({ text: sentence, dropped: 0 })
    })

    it('⛔ the work a caller wrote is in no kept sentence — a brief, a title, a message, a summary, an answer — at four doors', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      grant('pm', { maxDepth: 0 })
      const { call } = toolsOf(pm)
      // ⚑ One word, written into every field that carries a caller's own work.
      const WORK = 'Northwind'
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: `${WORK} memo`,
        brief: `ship ${WORK}`,
      })
      await call('message_agent', { agent: 'sess_nobody', text: `about ${WORK}`, kind: 'note' })
      await call('reply_to_parent', { piece: 'W99.9', outcome: 'done', summary: `${WORK} is done` })
      await call('answer_question', {
        question: 'req_nobody',
        answers: [{ part: 'p', answer: [`${WORK}, yes`] }],
      })
      const rows = refusalsIn(pm)
      expect(rows.map((one) => one.rail)).toEqual([
        'too-deep',
        'no-such-agent',
        'no-piece-by-that-name',
        'no-question-by-that-name',
      ])
      // ⚑ Each row keeps a sentence, so the negative below is not over nothing.
      for (const row of rows) expect(row.told?.text.length ?? 0).toBeGreaterThan(20)
      expect(JSON.stringify(rows)).not.toContain(WORK)
    })

    it('🔴 a malformed give keeps its problems in the record only while no field the caller named is among them', async () => {
      const pm = await personOpens('pm')
      const { set } = toolsOf(pm)
      const give = async (args: Record<string, unknown>): Promise<string> => {
        const tool = set.tools.find((one) => one.name === 'give_work')
        if (tool === undefined) throw new Error('no give_work')
        return (await tool.call(args)).text
      }
      const asked = {
        profile: 'worker',
        title: 'x',
        brief: 'x',
        definition_of_done: ['A list where text belongs.'],
      }
      const wrongType = await give(asked)
      const withAKeyOfItsOwn = await give({ ...asked, PRIVATE_CALLER_KEY: 1 })
      const takeOn = set.tools.find((one) => one.name === 'take_on_work')
      if (takeOn === undefined) throw new Error('no take_on_work')
      const takenWithAKey = await takeOn.call({
        title: 'x',
        brief: 'x',
        definition_of_done: 'The requested result and its checks are recorded.',
        PRIVATE_TAKE_KEY: 1,
      })

      const rows = refusalsIn(pm)
      expect(rows.map((one) => one.rail)).toEqual([
        'malformed-request',
        'malformed-request',
        'malformed-request',
      ])
      const problem = 'Problems: definition_of_done: expected text, got a list.'
      // ⚑ Our own words, the problem line among them, kept whole: the receipt itself.
      expect(wrongType).toContain(problem)
      expect(rows[0]?.told).toEqual({
        text: wrongType.slice('refused (malformed-request): '.length),
        dropped: 0,
      })
      // ⛔ …and no value the caller sent is in them.
      expect(wrongType).not.toContain('A list where text belongs')
      // ⛔ A field the caller named is told to it, and its name never reaches the record.
      expect(withAKeyOfItsOwn).toContain('PRIVATE_CALLER_KEY')
      expect(takenWithAKey.text).toContain('PRIVATE_TAKE_KEY')
      expect(rows[1]?.told).toEqual({ text: refuse('malformed-request').reason, dropped: 0 })
      expect(rows[2]?.told).toEqual({ text: takenWithAKey.structured?.['reason'], dropped: 0 })
      for (const own of ['PRIVATE_CALLER_KEY', 'PRIVATE_TAKE_KEY', 'A list where text belongs'])
        expect(JSON.stringify(rows)).not.toContain(own)
    })

    it('🔴 the kept app sentence is a prefix of the receipt, in its order, at every door sampled', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      grant('pm', { maxDepth: 0 })
      const { set } = toolsOf(pm)
      const texts: string[] = []
      const said = async (name: ToolName, args: Record<string, unknown>): Promise<void> => {
        const tool = set.tools.find((one) => one.name === name)
        if (tool === undefined) throw new Error(`no such tool: ${name}`)
        texts.push((await tool.call(args)).text)
      }
      await said('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      })
      await said('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'ghost',
        title: 'x',
        brief: 'x',
      })
      await said('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
        unasked: 1,
      })
      await said('message_agent', { agent: 'sess_nobody', text: 'hello', kind: 'note' })
      await said('reply_to_parent', { piece: 'W99.9', outcome: 'done', summary: 'done it' })
      await said('answer_question', {
        question: 'req_nobody',
        answers: [{ part: 'p', answer: ['y'] }],
      })
      const rows = refusalsIn(pm)
      expect(rows).toHaveLength(texts.length)
      rows.forEach((row, at) => {
        // ⚑ What the window joins on today is the receipt's first 200 characters: the kept sentence
        // must read on from them word for word.
        const { prose: said } = navigationReply(texts[at] ?? '')
        expect(said.startsWith(`refused (${row.rail}): ${row.told?.text ?? ''}`), said).toBe(true)
        // Detail-bearing answers keep only the existing reason; app-only answers keep their tail.
        const permanence = permanenceInWords(row.rail, row.permanence)
        expect(said.endsWith(` ${permanence}`), said).toBe(true)
        if (row.rail === 'malformed-request') {
          expect(row.told).toEqual({ text: refuse('malformed-request').reason, dropped: 0 })
          expect(said).toContain('unasked')
          expect(JSON.stringify(row)).not.toContain('unasked')
        } else {
          expect(row.told).toEqual({
            text: said.slice(`refused (${row.rail}): `.length),
            dropped: 0,
          })
          expect((row.told?.text ?? '').split(permanence).length - 1).toBe(1)
        }
      })
    })

    it('⚑ a call that is answered keeps nothing whole: no refusal row, and no sentence anywhere in its ledger', async () => {
      const pm = await personOpens('pm')
      const answered = await toolsOf(pm).call('list_profiles')
      expect(answered.outcome).toBe('ok')
      expect(refusalsIn(pm)).toEqual([])
      expect(events(pm).some((one) => 'told' in one)).toBe(false)
    })

    it('⚑ a row written before the sentence was kept reads as it did, and draws the line it drew', async () => {
      const pm = await personOpens('pm')
      await host.close(pm, window)
      const [older] = stored(pm, [AN_OLDER_ROW])
      expect(older).toEqual(AN_OLDER_ROW)
      expect(older !== undefined && 'told' in older).toBe(false)
      // ⚑ The line a row draws does not read the sentence: a build that does not know the field
      // draws a row that has it exactly as it draws one that has not.
      const withIt: ToolRefusedEvent = { ...AN_OLDER_ROW, told: refusalToldOf('a sentence') }
      expect(theNoticeFor(withIt).text).toBe(theNoticeFor(AN_OLDER_ROW).text)
    })

    it('⛔ a stored sentence this app could not have written is not handed on, and one over the bound is cut again and counted', async () => {
      const pm = await personOpens('pm')
      await host.close(pm, window)
      const over = 'é'.repeat(MAX_REFUSAL_TOLD + 7)
      const rows = stored(pm, [
        { ...AN_OLDER_ROW, told: 'a bare string' },
        { ...AN_OLDER_ROW, told: { text: 42, dropped: 0 } },
        { ...AN_OLDER_ROW, told: { text: 'said', dropped: -1 } },
        { ...AN_OLDER_ROW, told: { text: 'said', dropped: 1.5 } },
        { ...AN_OLDER_ROW, told: { text: '', dropped: 0 } },
        { ...AN_OLDER_ROW, told: ['said'] },
        // ⚑ The positive: a sentence as this app writes it comes back as it is.
        { ...AN_OLDER_ROW, told: { text: 'said', dropped: 3 } },
        { ...AN_OLDER_ROW, told: { text: over, dropped: 2 } },
      ])
      expect(rows).toHaveLength(8)
      for (const dropped of rows.slice(0, 6)) expect(dropped).toEqual(AN_OLDER_ROW)
      expect(rows[6]?.told).toEqual({ text: 'said', dropped: 3 })
      expect(rows[7]?.told).toEqual({ text: 'é'.repeat(MAX_REFUSAL_TOLD), dropped: 9 })
    })

    it('⛔ a stored count that would no longer be a whole safe number once the cut is added drops the sentence and keeps the row; one that reaches the bound exactly is kept', async () => {
      const pm = await personOpens('pm')
      await host.close(pm, window)
      const oneOver = 'x'.repeat(MAX_REFUSAL_TOLD + 1)
      const rows = stored(pm, [
        { ...AN_OLDER_ROW, told: { text: oneOver, dropped: Number.MAX_SAFE_INTEGER } },
        { ...AN_OLDER_ROW, told: { text: oneOver, dropped: Number.MAX_SAFE_INTEGER - 1 } },
      ])
      expect(rows).toHaveLength(2)
      // ⛔ One more than the bound: no sentence, and every other field as it was written.
      expect(rows[0]).toEqual(AN_OLDER_ROW)
      // ⚑ Exactly the bound: kept, cut, and counted.
      expect(rows[1]?.told).toEqual({
        text: 'x'.repeat(MAX_REFUSAL_TOLD),
        dropped: Number.MAX_SAFE_INTEGER,
      })
      expect({ ...rows[1], told: undefined }).toEqual({ ...AN_OLDER_ROW, told: undefined })
      // ⚑ The read's own check, met directly: the store bounds a row on its way in as well as on
      // its way out, so the path above reaches the read with a count already cut once.
      expect(storedRefusalTold({ text: oneOver, dropped: Number.MAX_SAFE_INTEGER })).toBeUndefined()
      expect(storedRefusalTold({ text: oneOver, dropped: Number.MAX_SAFE_INTEGER - 1 })).toEqual({
        text: 'x'.repeat(MAX_REFUSAL_TOLD),
        dropped: Number.MAX_SAFE_INTEGER,
      })
    })

    it('⚑ a sentence past the bound is cut by whole characters, and the row says how many were cut', () => {
      const within = 'x'.repeat(MAX_REFUSAL_TOLD)
      expect(refusalToldOf(within)).toEqual({ text: within, dropped: 0 })
      // ⚑ Each of these is one character and two UTF-16 units: the cut leaves no half of one.
      const wide = '🙂'.repeat(MAX_REFUSAL_TOLD + 5)
      const kept = refusalToldOf(wide)
      expect(kept.dropped).toBe(5)
      expect([...kept.text]).toHaveLength(MAX_REFUSAL_TOLD)
      expect(kept.text.endsWith('🙂')).toBe(true)
      // ⚑ …and one that only looks long in units is whole.
      const justWithin = '🙂'.repeat(MAX_REFUSAL_TOLD)
      expect(refusalToldOf(justWithin)).toEqual({ text: justWithin, dropped: 0 })
    })

    it('⚑ a refusal whose payload carries no sentence still writes its row, without one', () => {
      const facts = refusalIn('give_work', {
        outcome: 'refused',
        rail: 'too-deep',
        permanence: 'while-this-holds',
        retryable: true,
        remedy: null,
      })
      expect(facts).toEqual({
        rail: 'too-deep',
        permanence: 'while-this-holds',
        retryable: true,
        remedy: null,
      })
      expect(refusalIn('give_work', { ...refuseTool('malformed-request', {}) })?.told).toEqual({
        text: refuseTool('malformed-request', {}).reason,
        dropped: 0,
      })
    })
  })

  describe('§4 · nothing builds a refusal payload by hand', () => {
    it('⛔ every `outcome: refused` in `agent-tools.ts` comes from a builder', () => {
      const source = readFileSync(join(mainRoot, 'runtime', 'agent-tools.ts'), 'utf8')
      expect(straysIn(source)).toEqual([])
      // ⚑ **Non-vacuity**: the census found the builders, and it found their payloads.
      for (const name of REFUSAL_BUILDERS) {
        expect(source, `${name} was renamed or removed`).toContain(`function ${name}(`)
      }
      expect(withoutProse(source).split("outcome: 'refused'").length - 1).toBeGreaterThanOrEqual(
        REFUSAL_BUILDERS.length - 1,
      )
    })

    it('⚑ the control plants TWO, and the census reports BOTH', () => {
      // ⛔ **TWO, not one** (standing rule 12). A census that stops at the first stray is exactly as
      // wrong as one that finds none, and twice this month a control that planted one hid that.
      const planted = [
        "/** a docblock saying outcome: 'refused' at length */",
        'type Shape = {',
        "  readonly outcome: 'refused'",
        '}',
        'function carryRailRefusal(refusal) {',
        "  return { outcome: 'refused', rail: refusal.rail }",
        '}',
        'function somebodyElse() {',
        "  return { outcome: 'refused', rail: 'invented-here' }",
        '}',
        "const inline = { outcome: 'refused' }",
      ].join('\n')
      // ⛔ **TWO strays and not three**: the `readonly` declaration above is a TYPE and the docblock
      // is prose, so this control measures the exclusion, the strip and the span in one sample.
      expect(straysIn(planted)).toHaveLength(2)
      // ⚠️ **And the strip really strips**, proven on text this test owns rather than on wording
      // somebody may reasonably reword.
      expect(withoutProse(planted)).not.toContain('a docblock saying')
      expect(withoutProse(planted)).toContain("rail: 'invented-here'")
    })

    it('🔴 `refusalIn` reads every member of a vocabulary, walked rather than sampled', () => {
      // ⛔ **The list, not three remembered members** — `353`'s idiom.
      for (const rail of TOOL_REFUSALS) {
        const payload = refuseTool(rail, { agent: 'sess_1' })
        const read = refusalIn('a_tool', { ...payload })
        expect(read, rail).not.toBeNull()
        expect(read?.rail).toBe(rail)
        expect(read?.permanence).toBe(payload.permanence)
        expect(read?.retryable).toBe(payload.retryable)
      }
      // ⚑ **The resource vocabulary is built in another file entirely** — `resources.ts` (the
      // document registry's successor, D-016) — and `carryReplyRefusal` spreads it unchanged. So it
      // is read here too, or the one payload that no builder in `agent-tools.ts` makes would be the
      // one nobody checked.
      const resource = refuseResource('no-such-resource', { resource: 'res_0001' })
      const read = refusalIn('read_document', { ...resource })
      expect(read?.rail).toBe('no-such-resource')
      expect(read?.permanence).toBe(resource.permanence)
      // ⚠️ **An `ok` answer is not a refusal and says so quietly.**
      expect(refusalIn('list_agents', { outcome: 'ok', agents: [] })).toBeNull()
      expect(refusalIn('list_agents', undefined)).toBeNull()
      // ⛔ **A payload that SAYS refused and cannot be read is not published as a partial row.**
      expect(
        refusalIn('a_tool', { outcome: 'refused', rail: 'x', permanence: 'invented' }),
      ).toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the surface a person reads
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · a person reading a transcript can see it', () => {
    it('🔴 the refused call draws a notice naming the tool and the rule; the admitted one draws nothing', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      grant('pm', { maxDepth: 0 })
      const { call } = toolsOf(pm)
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      })

      const said = theNoticeFor(theRefusalIn(pm)).text
      expect(said).toContain('give_work')
      expect(said).toContain('too-deep')
      // ⛔ **Both halves of what the model was told about coming back.**
      expect(said).toContain('until somebody changes it')
      expect(said).toContain('retrying will not help')

      // ⚑ **The paired positive for the SURFACE**: the two rows an admitted call leaves draw a tool
      // row and no notice, which is `402` F2's *"a tool call that worked"* — correct, once there is
      // something else on screen when it did not.
      const admitted = createTranscript()
      applyEvent(admitted, { type: 'tool_call', id: 't1', name: 'give_work', summary: 'x' })
      applyEvent(admitted, { type: 'tool_result', id: 't1', summary: 'x', ok: true })
      expect(admitted.items.filter((item) => item.kind === 'notice')).toEqual([])
      expect(admitted.items.filter((item) => item.kind === 'tool')).toHaveLength(1)
    })

    it('⛔ the notice is `warn`, so the reading view cannot drop it', async () => {
      const pm = await personOpens('pm')
      const { call } = toolsOf(pm)
      await call('message_agent', { agent: 'sess_nobody', text: 'hello', kind: 'note' })
      const item = theNoticeFor(theRefusalIn(pm))
      // 🔴 **`info` is dropped by `transcript-mode.ts`'s reading view**, and the reading view is
      // where HO-019 §4's invisibility would come back. ⚠️ And not `error`: a rail refusing
      // something is this app working.
      expect(item.level).toBe('warn')
      // 🔴 **The load-bearing clause, asserted BY NAME rather than through the level** (standing
      // rule 5). ⛔ `isVisibleIn` is what decides it: `mode === 'debug' || item.level !== 'info'`.
      // ⚠️ **`'normal'` is the reading view's own spelling** — `TranscriptMode` is
      // `'debug' | 'normal'`, and the prose in this app calls the second one the reading view.
      expect(isVisibleIn('normal', item)).toBe(true)
      expect(isVisibleIn('debug', item)).toBe(true)
      // ⚑ **The control that makes it a measurement**: the SAME item at `info` disappears from the
      // reading view, so this is a fact about the level and not about notices in general.
      expect(isVisibleIn('normal', { ...item, level: 'info' })).toBe(false)
      // ⚑ **The clause is a rendering of the ROW and not a constant**, which is what the pair below
      // measures. ⚠️ **The real refusal changed sides at `424`** — `no-such-agent` is `permanent`
      // now — so the row this test drives says *will not help*, and the control says the other
      // thing about the same renderer.
      expect(item.text).toContain('retrying will not help')
      expect(item.text).toContain('this exact call can never succeed')
      const transient = theNoticeFor({
        ...theRefusalIn(pm),
        permanence: 'while-this-holds',
        retryable: true,
      })
      expect(transient.text).toContain('retrying may work')
      // ⚑ **627 · looked up, not spelled** (`HO-096` §2.4). ⛔ This read `'while this holds'`, which
      // was the enum member with its hyphens taken out — and `627` replaced that clause because a
      // person had to decode it. ⚠️ Aimed at the table, the assertion moves with the words.
      expect(transient.text).toContain(PERMANENCE_SAID['while-this-holds'])
    })

    it('⚑ every permanence renders as a clause, walked from the vocabulary', () => {
      const said = RAIL_PERMANENCES.map(
        (permanence) =>
          theNoticeFor({
            type: 'tool_refused',
            tool: 'give_work',
            rail: 'a-rail',
            permanence,
            retryable: false,
          }).text,
      )
      // ⛔ **Three distinct clauses, and none of them the bare word.** A lookup that fell through
      // would print the vocabulary at a person, which is the failure this exists to stop.
      expect(new Set(said).size).toBe(RAIL_PERMANENCES.length)
      for (const [at, permanence] of RAIL_PERMANENCES.entries()) {
        expect(said[at], permanence).not.toContain(permanence)
        expect(said[at]).toContain('a-rail')
      }
      // ⚠️ **A word this build does not know is printed AS ITSELF**, never as `undefined` — a ledger
      // is replayed by a build that is not the one that wrote it.
      const later = theNoticeFor({
        type: 'tool_refused',
        tool: 'give_work',
        rail: 'a-rail',
        permanence: 'a-word-from-a-later-build' as never,
        retryable: false,
      })
      expect(later.text).toContain('a-word-from-a-later-build')
      expect(isRailPermanence('a-word-from-a-later-build')).toBe(false)
    })

    it('⚑ the raw event log gives it a line of its own', async () => {
      const pm = await personOpens('pm')
      const { call } = toolsOf(pm)
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'nobody',
        title: 'x',
        brief: 'x',
      })
      const line = describeEvent(theRefusalIn(pm))
      expect(line).toContain('give_work')
      expect(line).toContain('no-such-profile')
      expect(line).toContain('(ours)')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the writer — §3.1's hazard, measured
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · written by the host that owns the ledger', () => {
    it("🔴 the row takes the host's own ordinal, and everything after it still lands", async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      grant('pm', { maxDepth: 0 })
      const { call } = toolsOf(pm)
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'x',
        brief: 'x',
      })
      // ⛔ **A durable event AFTER the refusal.** `398` §6 measured that a store-side append into a
      // running ledger collides with `HostedSession.ordinal`, after which `record()` logs the first
      // collision and returns — **every later durable event dropped silently**. So the assertion is
      // not *"the row is there"*; it is *"the row is there and the ledger still works"*.
      await host.send(pm, 'and now a turn of my own', window)

      const rows = store.events(pm)
      const ordinals = rows.map((one) => one.ordinal)
      expect(ordinals).toEqual(ordinals.map((_, at) => at))
      expect(new Set(ordinals).size).toBe(ordinals.length)
      const kinds = rows.map((one) => one.event.type)
      expect(kinds).toContain('tool_refused')
      // ⚑ The refusal is BEFORE the later turn, and the later turn is there — which is the half a
      // dropped-append defect takes away.
      expect(kinds.lastIndexOf('user_turn')).toBeGreaterThan(kinds.indexOf('tool_refused'))
    })

    it('⚑ the live runner\u2019s own fold reads the row, and reads it structurally', () => {
      // 🔴 **`405` §4: *the instrument this unblocks*.** ⛔ `402`'s runner folds the ledger for its
      // verdicts and could not tell a refused spawn from an admitted one, *"which is why F4 needed a
      // person reading a transcript"*. ⚑ Its `refusedSpawnOf` now reads `tool_refused` first.
      //
      // ⚠️ **A source census and it says so.** That fold lives inside a `.smoke.ts` file whose top
      // level registers a LIVE run, so importing it here would add a real provider suite to `test`.
      // ⛔ This dispatch did not run that arm live, and a live-only change with no cheap gate at all
      // is dark by default (`a-guard-that-only-a-live-run-can-trip-is-dark-by-default`) — so the
      // shape is pinned here and the run is the PM's.
      const stage = readFileSync(join(here, '../smoke/lifecycle-stage.smoke.ts'), 'utf8')
      const code = withoutProse(stage)
      const opens = code.indexOf('function refusedSpawnOf(')
      expect(opens, 'refusedSpawnOf was renamed or removed').toBeGreaterThan(0)
      const fold = code.slice(opens, code.indexOf('\n}', opens))
      // ⛔ **Inside the fold**, not merely somewhere in a 1,200-line file — the census that read the
      // whole file could not tell this function from the comment block six hundred lines above it.
      expect(fold).toContain("event.type === 'tool_refused'")
      // 🔴 **445 · the scope is a LIST, and this asserts the list rather than one member.**
      //
      // ⛔ **It read `event.tool === 'spawn_agent'`**, which was the whole scope until `419`
      // published a second verb that brings a conversation into being. ⚠️ **Measured live**: a Codex
      // worker asked to delegate called `create_agent`, and the row that reads this fold reported
      // *"the worker never tried to create an agent"* about a ledger holding the call — a sentence
      // that was false rather than merely missing. ⚑ Pinning the CONSTANT keeps this census exact:
      // a fold that quietly went back to one verb, or forward to any verb at all, fails here.
      expect(fold).toContain('VERBS_THAT_BRING_ONE_INTO_BEING')
      // ⚑ **D-016** — `give_work` took `spawn_agent`'s place in the list.
      expect(code).toContain(
        "const VERBS_THAT_BRING_ONE_INTO_BEING = ['give_work', 'create_agent'] as const",
      )
      // ⚑ **And row 6 reads it**, which is the half that makes the fold matter. ⚠️ D-014: the
      // row's verdict is the helper's shape, and the refusal the worker met is NAMED beside it, so
      // a rail that refused the helper is on the page rather than folded into *it did not try*.
      const row = code.slice(
        code.indexOf('const theWorkersHelper = '),
        code.indexOf('\n  }\n', code.indexOf('const theWorkersHelper = ')),
      )
      expect(row, 'row 6 was renamed or removed').toContain('refusedSpawnOf(store, explorer)')
      expect(row).toContain('JSON.stringify(refusal)')
      // ⚠️ **The control plants THREE**, all outside the fold: a mention in prose, a mention in code
      // elsewhere, and the vocabulary's own name elsewhere. None may satisfy the assertions above.
      const planted = [
        "// a comment naming event.type === 'tool_refused' at length",
        "const elsewhere = e.type === 'tool_refused'",
        'const alsoElsewhere = VERBS_THAT_BRING_ONE_INTO_BEING',
        'function refusedSpawnOf(store, sessionId) {',
        '  return null',
        '}',
      ].join('\n')
      const plantedCode = withoutProse(planted)
      const plantedFold = plantedCode.slice(
        plantedCode.indexOf('function refusedSpawnOf('),
        plantedCode.indexOf('\n}', plantedCode.indexOf('function refusedSpawnOf(')),
      )
      expect(plantedCode).toContain("const elsewhere = e.type === 'tool_refused'")
      expect(plantedCode).toContain('const alsoElsewhere = VERBS_THAT_BRING_ONE_INTO_BEING')
      expect(plantedCode).not.toContain('a comment naming')
      expect(plantedFold).not.toContain("'tool_refused'")
      expect(plantedFold).not.toContain('VERBS_THAT_BRING_ONE_INTO_BEING')
    })

    it('⛔ a conversation this host is not running gets no row, and does not throw', async () => {
      const pm = await personOpens('pm')
      await host.close(pm, window)
      const { call } = toolsOf(pm)
      // ⚠️ **Not an ordinary case — a toolset is built for a session that is registering, and both
      // call sites do exactly that.** ⛔ It is asserted anyway because a defect that throws here
      // would reach a model as a broken tool, which is the one shape `307` says a refusal must never
      // wear.
      const refused = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'nobody',
        title: 'x',
        brief: 'x',
      })
      expect(refused.outcome).toBe('refused')
      expect(refusalsIn(pm)).toEqual([])
    })
  })
})
