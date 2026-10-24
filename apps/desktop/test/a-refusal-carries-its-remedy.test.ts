import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
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
import {
  SPAWN_RAILS,
  permanenceOf,
  refuse,
  remedyOf,
  type SpawnRail,
} from '../src/main/runtime/spawn-rails'
import {
  MESSAGE_RAILS,
  messagePermanenceOf,
  messageRemedyOf,
  refuseMessage,
  type MessageRail,
} from '../src/main/runtime/message-rails'
import {
  REPLY_RAILS,
  REPLY_SUMMARY_LIMIT,
  replyPermanenceOf,
  replyRemedyOf,
  refuseReply,
  type ReplyRail,
} from '../src/main/runtime/reply-rails'
import {
  QUESTION_RAILS,
  questionPermanenceOf,
  questionRemedyOf,
  refuseQuestion,
  type QuestionRail,
} from '../src/main/runtime/question-rails'
import {
  INTERRUPT_RAILS,
  interruptPermanenceOf,
  interruptRemedyOf,
  refuseInterrupt,
  type InterruptRail,
} from '../src/main/runtime/interrupt-rails'
import {
  TOOL_REFUSALS,
  agentToolsFor,
  refusalIn,
  refuseTool,
  toolRemedyOf,
  agentCallerId,
  type AgentToolHost,
  type ToolName,
  type ToolRefusal,
} from '../src/main/runtime/agent-tools'
import {
  RESOURCE_RAILS,
  readOfferedResource,
  resourceRemedyOf,
  resourcesRoot,
  refuseResource,
  type ResourceRail,
} from '../src/main/resources/resources'
import {
  PERMANENCE_SAID,
  RAIL_PERMANENCES,
  REFUSAL_REMEDIES,
  isRefusalRemedy,
  type RailPermanence,
  type RefusalRemedy,
} from '../src/shared/refusals'
import { applyEvent, createTranscript, type NoticeItem } from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type {
  RuntimeEventMessage,
  ToolRefusedEvent,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **425 · the remedy a refusal carries** (HO-023 §2.2, `422` §5).
 *
 * ## ⛔ The defect, in the facts a person was left with
 *
 * ⚠️ **The PO read his own ledger and found this:**
 *
 * ```
 * refused: spawn_agent · profile-already-live · while this holds · retrying may work
 * ```
 *
 * ⛔ **The rail had already composed a way out** — *"send a message to that one instead"* — and the
 * MODEL was handed it, in `PublishedRefusal.reason`, on every then-supported provider. ⚑ **`405`
 * §2's *record the refusal, not the request* is what threw it away**, and what it threw away was
 * neither the refusal nor the request: it was **what this app itself knew you could do next**.
 *
 * Both the model and the person must receive the refusal and its available remedy.
 *
 * ## ⚑ The property
 *
 * > **Where the app knows what a caller may do instead, both readers are told — the model in its tool
 * > answer and the person in the transcript — and where it does not know, neither is told anything
 * > invented.**
 *
 * ⚠️ **The second clause is the harder one and most of this file is about it.** At `425`, forty-three
 * of the then fifty-two vocabulary memberships carried NOTHING, and that was the finished state
 * rather than a half-done one: `422` §5.1 had measured that the twelve which then looked retryable
 * had clauses that were false, destructive, person-only, or advice for a DIFFERENT call.
 * ⛔ **Inventing words for those would preserve the defect in a new field.**
 *
 * 🔴 **`424` then repriced exactly those twelve, so the property is now a BICONDITIONAL** — a rail
 * carries an act if and only if this app can retry it. ⚑ §1 asserts it in both directions.
 *
 * ## 🔴 Where standing rule 3's pairs live
 *
 * ⛔ **The non-resource rails that carry a remedy are refused for real in the files that already
 * drive them**, each beside the same call one fact over admitted, and each now asserts its word:
 *
 *  - `its-work-has-stalled` was the first of these until a give stopped being refused over a
 *    stall, and its word went with it. §4 below builds `summary-too-long` for real instead.
 *  - `summary-too-long` — `a-reply-and-its-absence.test.ts` §3, one unit under the bound.
 *  - `that-answer-cannot-be-sent` — `a-question-finds-a-person.test.ts` §4, with the offered label.
 *  - `answer-too-long` — `the-rest-of-r18-and-the-answer-with-no-bound.test.ts` §2, one unit over the
 *    bound, then the same question answered at it.
 *  - `that-conversation-has-not-started` — `the-interruption-that-looks-like-a-fault.test.ts` §5, at
 *    `admitInterrupt`; ⚑ **and since `650` through `message_agent` as well**, in
 *    `a-refusal-that-clears-on-its-own.test.ts` §1–§3, where a held launch is refused and the same
 *    call is admitted once it lands — or meets `no-such-agent` once it fails. ⛔ *"The only place
 *    this rail is reachable"* stopped being true when the word was shared.
 *  - `agent-took-too-long-to-start` — `a-launch-that-did-not-start.test.ts` §1, where a launch that
 *    never answers is refused through `spawn_agent` and the same call starts once it can.
 *  - `agent-could-not-start-just-now` — `a-spawn-that-ran-short.test.ts` §1 (`707`), where a spawn
 *    the machine ran short for is refused and the same call starts once the shortage has passed.
 *  - ⛔ `agent-started-a-turn-first` stood in this list from `650` to `657`; `657` made a lost race a
 *    HOLD and retired the word — `a-refusal-that-clears-on-its-own.test.ts` §4 measures the hold.
 *  - `that-work-is-being-sent` — `taking-work-back.test.ts` §3, where a provider-boundary gate holds
 *    the flush in flight, the withdrawal is refused, and the same call is admitted after release.
 *  - ⛔ `a-message-you-cannot-withdraw-is-waiting` stood in this list from `703` to D-010, which let
 *    a conversation hold any number of messages and retired the word.
 *
 * ⚑ **The resource shapes are walked here: §3 below both refuses them and FOLLOWS the remedy** —
 * write the artifact, name it, succeed. 🔴 **A remedy nobody has walked is a sentence, not a
 * remedy.**
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

/**
 * ⛔ **Every vocabulary, as DATA** — so every claim below is walked rather than sampled.
 *
 * ⚠️ **`353`'s idiom, and `374`'s census one dispatch further on.** A remedy table omitted from this
 * roster would pass every assertion written only about the tables which remained.
 */
interface Vocabulary {
  readonly name: string
  readonly rails: readonly string[]
  readonly permanenceOf: (rail: string) => RailPermanence
  readonly remedyOf: (rail: string) => RefusalRemedy | null
  /** The door's own builder, so the TABLE and the PAYLOAD can be compared for every member. */
  readonly built: (rail: string) => { permanence: string; remedy: RefusalRemedy | null }
}

const VOCABULARIES: readonly Vocabulary[] = [
  {
    name: 'SPAWN_RAILS',
    rails: SPAWN_RAILS,
    permanenceOf: (rail) => permanenceOf(rail as SpawnRail),
    remedyOf: (rail) => remedyOf(rail as SpawnRail),
    built: (rail) => refuse(rail as SpawnRail),
  },
  {
    name: 'MESSAGE_RAILS',
    rails: MESSAGE_RAILS,
    permanenceOf: (rail) => messagePermanenceOf(rail as MessageRail),
    remedyOf: (rail) => messageRemedyOf(rail as MessageRail),
    built: (rail) => refuseMessage(rail as MessageRail),
  },
  {
    name: 'TOOL_REFUSALS',
    rails: TOOL_REFUSALS,
    permanenceOf: (rail) => refuseTool(rail as ToolRefusal).permanence,
    remedyOf: (rail) => toolRemedyOf(rail as ToolRefusal),
    built: (rail) => refuseTool(rail as ToolRefusal),
  },
  {
    name: 'REPLY_RAILS',
    rails: REPLY_RAILS,
    permanenceOf: (rail) => replyPermanenceOf(rail as ReplyRail),
    remedyOf: (rail) => replyRemedyOf(rail as ReplyRail),
    built: (rail) => refuseReply(rail as ReplyRail),
  },
  {
    name: 'QUESTION_RAILS',
    rails: QUESTION_RAILS,
    permanenceOf: (rail) => questionPermanenceOf(rail as QuestionRail),
    remedyOf: (rail) => questionRemedyOf(rail as QuestionRail),
    built: (rail) => refuseQuestion(rail as QuestionRail),
  },
  {
    name: 'INTERRUPT_RAILS',
    rails: INTERRUPT_RAILS,
    permanenceOf: (rail) => interruptPermanenceOf(rail as InterruptRail),
    remedyOf: (rail) => interruptRemedyOf(rail as InterruptRail),
    built: (rail) => refuseInterrupt(rail as InterruptRail),
  },
  // ⚑ **D-017 — `END_RAILS` went with `end_agent`**: nothing ends a conversation.
  // ⚑ **D-016 — `DOCUMENT_RAILS` went with the document registry**; a reply's files are RESOURCES,
  // and `resources.ts` holds the words a kept or read resource is refused with.
  {
    name: 'RESOURCE_RAILS',
    rails: RESOURCE_RAILS,
    permanenceOf: (rail) => refuseResource(rail as ResourceRail).permanence,
    remedyOf: (rail) => resourceRemedyOf(rail as ResourceRail),
    built: (rail) => refuseResource(rail as ResourceRail),
  },
]

interface RailPolicy {
  readonly vocabulary: string
  readonly rail: string
  readonly permanence: RailPermanence
  readonly remedy: RefusalRemedy | null
}

/** Every vocabulary + rail membership, with the policy facts read from that exact owner. */
const everyRail = (vocabularies: readonly Vocabulary[] = VOCABULARIES): RailPolicy[] =>
  vocabularies.flatMap((vocabulary) =>
    vocabulary.rails.map((rail) => ({
      vocabulary: vocabulary.name,
      rail,
      permanence: vocabulary.permanenceOf(rail),
      remedy: vocabulary.remedyOf(rail),
    })),
  )

describe('425 · a refusal carries its remedy', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-remedy-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-remedy-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId = 'pm',
    approvalMode: 'ask' | 'auto' = 'ask',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode },
      window,
    )
    return sessionId
  }

  /** ⛔ Bounded, and it waits on the THING. */
  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const grant = (profileId: string, edit: Parameters<SessionStore['setCapabilities']>[1]): void => {
    expect(store.setCapabilities(profileId, edit)).toBe(true)
  }

  const callerOf = (of: AgentToolHost, sessionId: string) => {
    const set = agentToolsFor(of, sessionId)
    return async (name: ToolName, args: Record<string, unknown> = {}) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }
  }

  const events = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((one) => one.event)

  const refusalsIn = (sessionId: string): ToolRefusedEvent[] =>
    events(sessionId).filter((one): one is ToolRefusedEvent => one.type === 'tool_refused')

  const theRefusalIn = (sessionId: string): ToolRefusedEvent => {
    const rows = refusalsIn(sessionId)
    expect(rows).toHaveLength(1)
    const [row] = rows
    if (row === undefined) throw new Error(`${sessionId} recorded no refusal`)
    return row
  }

  /** The one transcript item a row draws, as a notice — and a failure when it draws anything else. */
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

  /** A `tool_refused` row exactly as the host writes one, for the reader tests. */
  const rowSaying = (remedy: unknown): ToolRefusedEvent =>
    ({
      type: 'tool_refused',
      tool: 'message_agent',
      rail: 'a-rail',
      permanence: 'while-this-holds',
      retryable: true,
      remedy,
    }) as ToolRefusedEvent

  /** Write a file inside the session's workspace and answer its absolute path. */
  const wrote = (name: string, text: string | Buffer): string => {
    const path = join(work, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
    return path
  }

  /**
   * ⚑ **D-016 · a file is offered as a RESOURCE, by a reply** — the document registry is gone. A
   * person's conversation gives a piece; the conversation it reaches is the one that offers files,
   * by replying with them. ⛔ Nothing here writes a `work_resource` row by hand.
   */
  const aPieceToReplyTo = async (): Promise<{ owner: string; label: string }> => {
    await bringIdentityIntoBeing('worker')
    const giver = await personOpens()
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'write the long form',
        brief: 'write the long form',
      },
      { ownerId: agentCallerId(giver) },
    )
    if (!given.ok) throw new Error(`expected a give, got ${given.refusal.rail}`)
    return { owner: given.owner, label: given.label }
  }

  /** The owner replies naming one file — the one door a resource is kept through. */
  const offer = (piece: { owner: string; label: string }, resourcePath: string) =>
    host.replyToParent(
      {
        piece: piece.label,
        outcome: 'done',
        summary: 'done it',
        resourcePaths: [resourcePath],
        needsUserAction: false,
      },
      { ownerId: agentCallerId(piece.owner) },
    )

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the remedy/permanence partition, walked from its owners
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the partition, walked from the vocabularies', () => {
    it('🔴 the rails that carry a remedy are exactly these memberships', () => {
      const carrying = everyRail()
        .filter((one) => one.remedy !== null)
        .map((one) => `${one.vocabulary} · ${one.rail}`)
        .sort()
      // ⛔ **Named as well as counted.** `a-title-that-names-a-count-the-assertion-never-checks` is
      // the hazard: a count passes while the wrong memberships carry the field.
      // ⚑ **`429` added the then-tenth membership**, the first added after this became a
      // biconditional, so it had to answer both halves in its own commit — the guarantee firing for
      // its intended purpose rather than by accident.
      // 🔴 **`650` added the eleventh and twelfth**, both split out of `agent-cannot-take-a-message`
      // because each clears with nobody acting — and the biconditional is what made them carry the
      // act: a launch in flight (sharing `INTERRUPT_RAILS`' word) and a turn that reached the agent
      // first. ⛔ The catch-all they left is still here as a `null`, in §1's roster below.
      // ⚠️ **657 · one out and one in, so still twelve.** The lost race is a HOLD now and its word is
      // retired; a spawn whose provider did not answer in time is refused with an act, because the
      // same call is a fresh launch nobody has to act before.
      // ⚑ **D-016 · one out and two in, so fifteen.** The open-work rail went with the one-open-task
      // rule and its act went to the STALL RULE (`its-work-has-stalled`); a give queued behind a
      // start that did not happen is refused with the same call once it has settled
      // (`the-start-it-waited-on-did-not-happen`). The document registry's four file shapes are the
      // resource store's four now, with the same act.
      expect(carrying).toEqual(
        [
          'INTERRUPT_RAILS · that-conversation-has-not-started',
          // ⚑ **The sixteenth**: an answer over the bound is refused, the question still open, and the
          // same call with shorter words lands.
          'QUESTION_RAILS · answer-too-long',
          'QUESTION_RAILS · move-offer-is-held',
          'QUESTION_RAILS · that-answer-cannot-be-sent',
          'REPLY_RAILS · summary-too-long',
          'RESOURCE_RAILS · resource-empty',
          'RESOURCE_RAILS · resource-not-text',
          'RESOURCE_RAILS · resource-too-large',
          'RESOURCE_RAILS · resource-unreadable',
          // ⚑ **D-010 retired two** — `703`'s held message the caller cannot withdraw, and
          // `agent-already-has-a-message-waiting`: a conversation holds any number of messages now.
          // ⚑ **707 · the sixteenth (R39, extended)**: a spawn refused because the machine ran short —
          // the wake's fourteenth, at the start door.
          'TOOL_REFUSALS · agent-could-not-start-just-now',
          'TOOL_REFUSALS · agent-took-too-long-to-start',
          // ⚑ **705 · the fourteenth (R39)**: a wake refused because the machine ran short — a
          // shortage it gets back with nobody acting, so the same call once it has passed.
          'TOOL_REFUSALS · that-conversation-could-not-be-woken-just-now',
          'TOOL_REFUSALS · that-conversation-has-not-started',
          // ⚑ **663 · the thirteenth**: a wake names the SAME id, so its retry can meet the launch it
          // gave up on — a stop in flight, cleared with nobody acting.
          'TOOL_REFUSALS · that-conversation-is-still-stopping',
          'TOOL_REFUSALS · that-work-is-being-sent',
          'TOOL_REFUSALS · work-record-unavailable',
          'TOOL_REFUSALS · the-start-it-waited-on-did-not-happen',
          // ⚑ **The seventeenth**: a restore while an archive or a delete of that conversation is
          // still under way; the same call once it has landed.
          'TOOL_REFUSALS · it-is-being-archived-or-deleted',
          'TOOL_REFUSALS · theme-invalid',
          'TOOL_REFUSALS · theme-exists',
          'TOOL_REFUSALS · theme-unknown',
          'TOOL_REFUSALS · theme-too-large',
          // ⚑ **The eighteenth**: a give to a service that already waits on its caller; the same
          // give once that work has ended.
          'SPAWN_RAILS · it-would-wait-on-itself',
          // ⚑ **The nineteenth**: a give to a service whose waits reach too far to check; the same
          // give once some of that work has ended.
          'SPAWN_RAILS · its-waits-cannot-all-be-checked',
          'SPAWN_RAILS · no-free-worker-at-capacity',
          // ⚑ **The twentieth**: a stop of a service on another caller's piece; the same stop once
          // that piece has ended.
          'INTERRUPT_RAILS · that-service-is-on-another-callers-piece',
          // ⚑ **The twenty-first**: a message about a piece still queued at a service; the same
          // message once it is handed over.
          'TOOL_REFUSALS · that-piece-is-still-queued',
          // A piece that cannot end with the copies passed up of its questions, at a take-back, a
          // close and a reply: the same call once the start has landed, or the read passes.
          'REPLY_RAILS · a-conversation-with-its-questions-is-starting',
          'REPLY_RAILS · its-questions-could-not-all-be-read',
          'TOOL_REFUSALS · a-conversation-with-its-questions-is-starting',
          'TOOL_REFUSALS · its-questions-could-not-all-be-read',
        ].sort(),
      )
      // ⚑ One fewer — `its-work-has-stalled` went, so a give is no longer refused over a stall;
      // services added two. Four more: a piece that cannot end with the copies of its questions.
      expect(carrying).toHaveLength(31)
    })

    it('🔴 the named rails with no remedy are independently not retryable', () => {
      // ⚑ **The second clause of the property, and the one HO-023 §2.2 said it would read for.**
      // ⛔ `422` measured twelve then-`while-this-holds` memberships whose clauses were false,
      // destructive, person-only, or advice for composing a DIFFERENT call. `425` wrote `null` for
      // those memberships and `424` independently repriced them from the other side.
      //
      // ⚑ **`441` then added rails priced by this rule rather than against it.** In particular,
      // `a-proposal-is-already-waiting` was drafted `while-this-holds` with an act, and the
      // biconditional below refused it: what clears a proposal parked on a person is that person
      // deciding, which is `a-person-is-being-asked`'s row exactly. ⚑ **D-016** — that word and
      // `no-person-to-ask` went with proposals, and are gone from the roster below.
      const NAMED_WITHOUT_REMEDIES: readonly (readonly [string, string])[] = [
        ['SPAWN_RAILS', 'worker-binding-is-unknown'],
        ['SPAWN_RAILS', 'parallel-not-for-a-service'],
        ['INTERRUPT_RAILS', 'a-person-is-being-asked'],
        // ⚑ **`496`'s rail, and the biconditional decided it before the table was written.** ⛔ The
        // PO named a real act — *withdraw the work, or wait for the person* — and neither half makes
        // the identical call succeed: `withdrawTask` leaves the child parked on the card, so
        // `withdraw-the-work-or-ask-about-it` here would be advice for a DIFFERENT call in the field
        // `425` §2 reserves for THIS one. ⚠️ **The sentence carries the act instead**, which
        // `the-card-a-third-party-was-holding.test.ts` §5 walks end to end. ⚑ **D-017 — that
        // membership went with `END_RAILS`** (nothing ends a conversation).
        //
        // ⚑ **D-017's three, each decided by the biconditional before the table was written**: a
        // conversation not below the caller (`permanent` — who started it is fixed), one parked on
        // a question another conversation owes (`until-a-person-changes-it`), and a row a message
        // cannot start (`permanent`). ⚠️ Each SENTENCE names what is left, which is a different call.
        ['INTERRUPT_RAILS', 'not-below-you'],
        ['INTERRUPT_RAILS', 'it-is-waiting-on-an-answer'],
        ['TOOL_REFUSALS', 'that-conversation-takes-no-messages'],
        ['TOOL_REFUSALS', 'agent-cannot-take-a-message'],
        // ⚑ **D-016 · the document registry's words are the resource store's** — a store with
        // nowhere to keep, and the reader's `517` word for bytes it cannot read (HO-043 §1), which
        // since D-016 also answers a row that names a place outside the tree. ⛔ Neither act exists:
        // nothing a caller can call clears whatever is standing where this app keeps a file.
        ['RESOURCE_RAILS', 'resource-store-unavailable'],
        ['RESOURCE_RAILS', 'resource-bytes-unreadable'],
        ['QUESTION_RAILS', 'no-question-by-that-name'],
        ['TOOL_REFUSALS', 'no-such-agent'],
        ['RESOURCE_RAILS', 'no-such-resource'],
        // ⚑ **D-016** — `no-such-project` and `no-such-task` went with projects and the registry, and
        // the reply's unknown task is its unknown piece.
        ['REPLY_RAILS', 'no-piece-by-that-name'],
        // ⚑ **D-016** — `profile-already-live` went with `spawn_agent`: a give finds the one
        // conversation it has instead of being refused it.
        // ⚑ **D-014 · the two fan-out counts left with the cap they enforced.**
      ]
      const policies = everyRail()
      for (const [vocabulary, rail] of NAMED_WITHOUT_REMEDIES) {
        const label = `${vocabulary} · ${rail}`
        const matches = policies.filter((one) => one.vocabulary === vocabulary && one.rail === rail)
        expect(matches, `${label} is not exactly one vocabulary membership`).toHaveLength(1)
        const [policy] = matches
        if (policy === undefined) throw new Error(`${label} has no policy`)
        // ⛔ **The remedy answer**: nothing to promise.
        expect(policy.remedy, label).toBeNull()
        // ⛔ **The permanence answer**: nothing this app can retry either.
        expect(policy.permanence, label).not.toBe('while-this-holds')
      }

      // 🔴 **So the property has collapsed into a BICONDITIONAL, and that is the headline.**
      // ⛔ Every rail this app can retry carries an act, and no rail it cannot retry pretends to.
      // ⚠️ Asserted in both directions over the whole roster — a one-directional check passes over a
      // table that has quietly stopped answering.
      for (const one of everyRail()) {
        expect(one.remedy !== null, `${one.vocabulary} · ${one.rail}`).toBe(
          one.permanence === 'while-this-holds',
        )
      }
      // ⚑ **At `422`, twenty-one memberships looked retryable; `424` repriced twelve and left nine.**
      // `429` later added another under the biconditional, and `650` two more; `657` retired one of
      // those and added another, so the count holds. The live roster is
      // owner-derived here; its cardinality and the absence of a silent member are separate machine
      // assertions.
      // ⚑ `663` added one more — a wake whose last run is not confirmed stopped.
      // ⚑ `705` one more (R39) — a wake whose provider the machine could not start just now.
      // ⚑ `703` one more — a held message the caller cannot withdraw (`698` F-B).
      // ⚑ `707` one more (R39, extended) — the same shortage at `spawn_agent`'s door.
      // ⚑ D-010 two fewer — both mailbox words, with the one-held-message rule.
      // ⚑ D-016 one fewer and two more — the open-work rail out; the stall rule and a start that did
      // not happen in.
      // ⚑ One more — an answer over the bound, refused with the question still open.
      // ⚑ One more — a restore while an archive or a delete is still under way.
      // ⚑ Two more — a give to a service that waits on its caller, and one whose waits can't all be
      // checked.
      // ⚑ Two more — a stop of a service on another caller's piece, and a message about a piece
      // still queued at one. One fewer — the stall rule refuses nothing now; the give's answer
      // names the stall.
      // ⚑ Four more — a piece that cannot end with the copies of its questions, two words at two
      // vocabularies.
      const retryable = everyRail().filter((one) => one.permanence === 'while-this-holds')
      expect(retryable).toHaveLength(31)
      expect(retryable.filter((one) => one.remedy === null)).toEqual([])
    })

    it('⛔ the pair walk sees both planted divergences behind shared rail spellings', () => {
      // 🔴 **The defect, constructed without changing a product vocabulary.** Both spellings below
      // belong to `SPAWN_RAILS` first and `TOOL_REFUSALS` later. One plant changes the TOOL remedy;
      // the other changes the TOOL permanence. A lookup by spelling reads the first owner for each
      // fact and reports no mismatch for either TOOL membership planted here.
      const planted = VOCABULARIES.map((vocabulary): Vocabulary =>
        vocabulary.name !== 'TOOL_REFUSALS'
          ? vocabulary
          : {
              ...vocabulary,
              remedyOf: (rail) =>
                rail === 'malformed-request'
                  ? 'make-the-same-call-when-this-settles'
                  : vocabulary.remedyOf(rail),
              permanenceOf: (rail) =>
                rail === 'spawning-disabled' ? 'while-this-holds' : vocabulary.permanenceOf(rail),
            },
      )
      const wrong = everyRail(planted).filter(
        (one) => (one.remedy !== null) !== (one.permanence === 'while-this-holds'),
      )
      expect(wrong.map((one) => `${one.vocabulary} · ${one.rail}`)).toEqual([
        'TOOL_REFUSALS · malformed-request',
        'TOOL_REFUSALS · spawning-disabled',
      ])
    })

    it('⛔ not one rail this app cannot retry carries a remedy', () => {
      // ⚠️ **`425` §3.1 ruled over the twenty-one memberships `422` had measured**, so every other
      // membership answered `null` — including rails whose SENTENCES already teach a next call.
      // ⛔ Widening the ruling here would decide something nobody has ruled; it is a finding instead.
      const quiet = everyRail().filter((one) => one.permanence !== 'while-this-holds')
      const wrong = quiet.filter((one) => one.remedy !== null)
      expect(wrong).toEqual([])
      // ⚑ **The historical checkpoints remain explicit, not mistaken for a live total.** At `425`
      // there were forty-three such memberships: thirty before `424` repriced twelve and split
      // another. `429` brought that to forty-six by adding three permanent rails, each a fact about a
      // CALL rather than the world. `437` added the forty-seventh under HO-025 §1's split.
      // ⛔ **HO-025 §1 allows a permanent rail to carry a remedy and `no-open-work-by-that-name`
      // still carries none** — deliberately: it folds three causes and a remedy would have to be
      // true of all three, which is the `document-registry-unavailable` shape `425` withdrew. ⚠️ So
      // this assertion is no longer the biconditional its title reads as, and the day a permanent
      // rail DOES carry a remedy it will go red for a reason it does not mean. **That is a finding
      // reported to the PM by `433` and again by `437`, not something either was licensed to fix.**
      // ⚑ **`439` brought the checkpoint to fifty** — `may-not-read-a-project` and
      // `read-outside-your-project` on
      // `MESSAGE_RAILS`, plus `no-project-by-that-name` on `TOOL_REFUSALS`. ⛔ All three carry
      // `null`, and each is why: a capability a person has not granted, a project boundary, and a
      // name that names nothing. `441` added four more under the same rule. The live total is derived
      // by `everyRail` and pinned only in the machine assertion below.
      // ⚑ **Fifty-five since `459` added `not-your-project` to `SPAWN_RAILS`** (HO-027 §2.2). ⛔ It
      // carries `null` and the biconditional decided it before anybody wrote the table: `permanent`,
      // therefore not retryable, therefore silent. ⚠️ The act that would clear it — propose the
      // project and have a person approve it — is a DIFFERENT call, and `425` §2 is the rule that a
      // remedy names what is left for THIS one.
      // ⚑ **Fifty-eight since `489` added the three a declared FOLDER meets** (HO-031 §2.6).
      // ⛔ All three carry `null`, and the biconditional decided every one of them before the table
      // was written: `folder-is-not-allowed` and `folder-already-exists` are `permanent`,
      // `no-such-folder` is `until-a-person-changes-it`, and not one of the three is retryable. ⚠️
      // The acts they leave — name somewhere else, make the directory or declare that approving
      // should, say it is already there — are all a DIFFERENT call, which is `425` §2's rule again.
      // ⚑ **Fifty-nine since `496` gave ENDING a vocabulary of its own** (HO-034 §1). ⛔ Its one
      // member carries `null` for the reason written beside it in `NAMED_WITHOUT_REMEDIES` above.
      // ⚑ **Sixty-one since `517` split the document READER's answers** (HO-043 §1).
      // ⛔ `document-path-outside-tree` is `permanent` and `document-bytes-unreadable` is
      // `until-a-person-changes-it`; the biconditional decided both `null` before the table was
      // written, and each says in its own sentence what is left — *no call you can make moves it
      // back inside*, and *asking again will not help until a person has looked at it*.
      // ⚑ **Sixty-three since `553` split the assignment off the message door** (HO-060 §2).
      // ⛔ Both are `until-a-person-changes-it` and neither is retryable, so the biconditional
      // decided both `null` before the table was written. ⚠️ **And `may-not-assign-work` is the
      // one where a remedy was tempting and still wrong**: *ask it instead* is genuinely open to
      // this caller — HO-060 §2.1 keeps that arm open — but a `RefusalRemedy` means *the thing you
      // were trying to do is waiting on something*, and asking is a different act with a different
      // outcome. ⚑ Each says so in its own SENTENCE, which is what this assertion is about.
      // ⚑ **Sixty-five since `582` gave the `configured` layer its own two rails**:
      // `may-not-write-rules` and `may-not-relay-a-rule`, which could not be one rail because they
      // carry different news — the first means *nothing will happen until somebody grants you
      // this*, the second means *your request is fine and the shortcut you took is not yours*, and
      // a caller told the first would stop asking. ⛔ Both are `until-a-person-changes-it` and
      // neither is retryable, so the biconditional decided both `null` before the table was
      // written. ⚠️ **And `may-not-relay-a-rule` is the one where a remedy was tempting and still
      // wrong**: *ask instead* is genuinely open to this caller, and its SENTENCE says so — but a
      // `RefusalRemedy` means *the thing you were trying to do is waiting on something*, and
      // asking is a different act with a different outcome (`may-not-assign-work`'s own ruling).
      // ⚑ **Sixty-seven since `611` gave the pass-up door its own two rails** (HO-088 §3.2):
      // `nobody-to-pass-it-up-to` and `this-app-does-not-hold-those-words`, which could not be one
      // rail because they carry different news — the first means *that end does not exist for this
      // conversation and the other one does*, the second means *the words are gone and nothing
      // will bring them back*. ⛔ Both are `permanent`, so the biconditional decided both `null`
      // before the table was written. ⚠️ **And `nobody-to-pass-it-up-to` is the one where a remedy
      // was tempting and still wrong**: *pass it to a person instead* is genuinely open to this
      // caller, and its SENTENCE says so — but a `RefusalRemedy` means *the thing you were trying
      // to do is waiting on something*, and naming the other end is a different call.
      // ⚑ **Sixty-eight since `628` split `that-is-work-you-hold` off** (`HO-095` §3.2). ⛔ It is
      // `permanent` — a `message_agent` naming work the caller HOLDS can never become the right
      // call — so the biconditional decided the `null` before the table was written. ⚠️ **And it
      // is the third row on this list where a remedy was tempting and still wrong**: *ask with
      // `ask_question` instead* is genuinely open to this caller, and its SENTENCE names it — but
      // a `RefusalRemedy` means *the thing you were trying to do is waiting on something*, and
      // asking is a different call that keeps the work rather than sending it.
      // ⚑ **Sixty-nine since `657` answered a failed launch** — `agent-did-not-start` is a person's
      // to change (a Close, a sign-in, a missing binary), so the biconditional decided its `null`.
      // ⚑ **Seventy since `661` gave the answer doors `the-conversation-that-asked-has-ended`**
      // (`656` F3). ⛔ It is `until-a-person-changes-it` — a reopen is what changes it — so
      // the biconditional decided the `null`; the next step (the question coming back) is in its
      // SENTENCE, where a non-retryable rail puts it.
      // ⚑ **Seventy-two since `663` gave `resume_agent` two words that no retry passes** — one
      // `permanent` (a conversation already running: the act is `message_agent`, a different call) and
      // one a person's to change (a conversation that could not be brought back) — so the
      // biconditional decided both `null`s.
      // ⚑ **Seventy-three since `675` gave a wake the fold refuses its own word**
      // (`no-conversation-of-yours-to-wake`, `663` F4). ⛔ It is `no-such-agent`'s fold and its price —
      // `permanent`: the identical wake succeeds only in a different world, one where the caller
      // started that conversation and gave it work — so the biconditional decided its `null`; the
      // door a wakeable id comes from (`list_tasks`) is in its SENTENCE.
      // Location alone causes no refusal: `SPAWN_RAILS`’ `cwd-outside-parent`,
      // `TOOL_REFUSALS`’ `folder-is-not-allowed`, and `DOCUMENT_RAILS`’
      // `resource-outside-workspace` are absent. All three were permanent, non-retryable,
      // and carried `null`, so their absence does not alter the retryability biconditional.
      // ⚑ **D-009** — +3: the three question rails F012 added, each `permanent` with no remedy.
      // ⚑ **D-012** — +2: `read_transcript`'s reach (`permanent`) and a shared service's
      // (`until-a-person-changes-it`), neither retryable, neither with a remedy.
      // ⚑ **D-014** — −8 +1: the start grant and the two fan-out counts at the spawn door, the four
      // end and interrupt grant rails at the message door, and the create-projects grant went; the
      // give door gained `assign-work-to-one-you-did-not-start` (not retryable, no remedy).
      // ⚑ **D-017** — −1: `the-conversation-that-asked-has-ended` went (`661`'s row above): an
      // answer to a question this app asked is written into its asker's ledger and starts it.
      // ⚑ **D-017, commit 3** — −4 +3: `END_RAILS`' one member, `INTERRUPT_RAILS`'
      // `that-conversation-has-already-ended` and the wake's `that-conversation-is-running` and
      // `no-conversation-of-yours-to-wake` went with the ending and `resume_agent`; `not-below-you`,
      // `it-is-waiting-on-an-answer` and `that-conversation-takes-no-messages` came (see
      // `NAMED_WITHOUT_REMEDIES` above).
      // ⚑ **D-016** — −12, every one `null` and none retryable: `TOOL_REFUSALS`'
      // `no-project-by-that-name`, `project-name-taken`, `a-proposal-is-already-waiting`,
      // `no-person-to-ask`, `that-agent-serves-every-caller` (with `takes_work_from`) and the two
      // folder words `489` spread in; `MESSAGE_RAILS`' `message-outside-your-project`,
      // `may-not-read-a-project`, `read-outside-your-project` and
      // `assign-work-outside-your-project`; and `SPAWN_RAILS`' `not-your-project` — all with
      // projects and proposals.
      // ⚑ **D-016, commit 3 (the tree)** — +4, none retryable and none with a remedy:
      // `SPAWN_RAILS` lost `no-such-parent`, `not-your-parent`, `not-the-model-a-person-chose`,
      // `profile-already-live` and `unknown-profile` with `spawn_agent`, and gained the give's
      // `no-piece-to-give-from`, `name-the-piece-you-give-from`, `no-piece-you-hold-by-that-name`,
      // `that-profile-exists`, `may-not-create-agents` and `no-such-profile`; `MESSAGE_RAILS` lost
      // `assign-work-to-one-you-did-not-start`; `TOOL_REFUSALS` renamed its task words to pieces
      // and gained `no-piece-by-that-name`, `that-is-your-own-work`, `that-piece-has-ended` and
      // `the-giver-names-a-piece`, less the open-work rail; `REPLY_RAILS` renamed its two task
      // words to pieces and gained `a-person-gave-that-piece`; `QUESTION_RAILS` gained
      // `name-the-piece-you-ask-about` and `no-piece-to-ask-about`; and the document registry's ten
      // quiet words became the resource store's seven.
      // ⚑ **D-016, commit 5 (the giver's verbs)** — +2, both `permanent` and so both `null` by the
      // biconditional: `TOOL_REFUSALS`' `the-giver-briefs-and-closes-a-piece` (an owner asking for
      // a brief or a close — the giver's acts, whatever the moment) and
      // `that-piece-was-already-closed` (a take-back of a piece its giver closed).
      // ⚑ **D-016, commit 6 (a request the person makes)** — +1, `permanent` and so `null` by the
      // biconditional: `TOOL_REFUSALS`' `no-work-of-your-own` (`take_on_work` from a caller that
      // owns no root, which it never will). ⚠️ Its SENTENCE carries what is left — do the work as
      // part of a piece it holds, or without one — and that is a different call.
      // ⚑ **+1**, `permanent` and so `null`: `TOOL_REFUSALS`' `that-agent-is-not-below-you`
      // (`message_agent` with interrupt, to an agent the caller may not interrupt).
      // ⚑ **F009 · +1**, `permanent` and so `null`: `TOOL_REFUSALS`' `no-agent-by-that-name`
      // (`list_profiles` naming an agent this app does not hold) — its sentence names the list.
      // ⚑ **+1**, `until-a-person-changes-it` and so `null`: `SPAWN_RAILS`' `its-provider-is-not-chosen`
      // (an agent with no provider saved whose conversations ran on both) — its sentence names a
      // person's choice on its sheet, or another agent.
      // ⚑ **+2**, `restore_agent`'s: `that-conversation-is-not-archived` (`permanent`) and
      // `it-could-not-be-restored` (`until-a-person-changes-it`: a person repairs the file this app
      // keeps the archived conversations in). Its third word is retryable and carries the act.
      // ⚑ **+3**, a give to a service: `services-are-off` and `its-kind-is-unknown`
      // (`until-a-person-changes-it`) and `that-is-this-conversation` (`permanent`) — each sentence
      // names another agent, or doing it here.
      // ⚑ **+1**, `permanent` and so `null`: `its-record-cannot-be-read`, a give to a service whose
      // waits can't be read — its sentence names another agent.
      // ⚑ **+3**, `request_mcp_server`'s: `server-already-registered` (`permanent`), and
      // `server-already-asked-for` and `too-many-server-requests` (`until-a-person-changes-it`: the
      // person deciding what waits clears them) — each sentence says what to do instead.
      // ⚑ **+2**, the move offer's two that carry no act.
      // ⚑ **+1**, `until-a-person-changes-it` and so `null`: `services-are-off-so-none-is-made`, a
      // service asked for while services are off — its sentence names the person who turns them on.
      expect(quiet).toHaveLength(85)
      for (const rail of ['move-offer-not-available', 'move-offer-needs-a-person']) {
        expect(quiet).toContainEqual(
          expect.objectContaining({ vocabulary: 'QUESTION_RAILS', rail, remedy: null }),
        )
      }
      expect(quiet.filter((one) => one.rail === 'result-document-not-returned')).toMatchObject([
        { rail: 'result-document-not-returned', permanence: 'permanent', remedy: null },
      ])
      expect(quiet).toContainEqual(
        expect.objectContaining({
          vocabulary: 'TOOL_REFUSALS',
          rail: 'theme-is-built-in',
          remedy: null,
        }),
      )
      // 🔴 **`499` · the rail this line named was `spawn-must-prompt`, and HO-036 withdrew
      // it.** ⚑ The point of the assertion is unchanged and is the reason it is here: a rail with
      // NO remedy code must still say, in its own sentence, what the caller may do — and
      // `wider-than-its-parent` says it first: do the work here, or ask the person who can decide
      // whether to change the caller's OWN approval mode. A give names no mode, so the caller has no
      // setting to send again without. ⚑ **D-038 moved the act**: it named *that agent’s provider or
      // approval mode*, but an agent has no mode of its own, and since the rail compares reach no
      // provider it could be moved to changes the verdict.
      expect(refuse('wider-than-its-parent').reason).toContain(
        'Do this work here, or ask a person whether to change your approval mode',
      )
      expect(refuseTool('agent-name-taken').reason).toContain('Choose a different name')
    })

    it('⚑ the closed remedy words fold memberships instead of respelling their rails', () => {
      // 🔴 **This is the test of whether the vocabulary is a REMEDY vocabulary at all.** ⛔ One code
      // per rail would answer *what was refused*, which the row already says; these answer *what is
      // left*, and two rails can leave a caller with the same thing to do.
      // ⚑ Six — `withdraw-the-work-or-ask-about-it` went with the stall rule, its last rail.
      expect(REFUSAL_REMEDIES).toHaveLength(6)
      const by = new Map<RefusalRemedy, string[]>()
      for (const one of everyRail()) {
        const said = one.remedy
        if (said === null) continue
        by.set(said, [...(by.get(said) ?? []), `${one.vocabulary} · ${one.rail}`].sort())
      }
      // ⛔ **Every member is REACHED** — a word no rail uses is a word nothing measures
      // (`a-closed-vocabulary-guards-what-a-member-says`).
      expect([...by.keys()].sort()).toEqual([...REFUSAL_REMEDIES].sort())
      expect(by.get('change-what-you-sent-and-call-again')).toEqual([
        'TOOL_REFUSALS · theme-exists',
        'TOOL_REFUSALS · theme-invalid',
        'TOOL_REFUSALS · theme-too-large',
        'TOOL_REFUSALS · theme-unknown',
      ])
      // ⚑ **And the named folds are the argument**: rails one door apart share *nothing, then the
      // same call*, and the resource shapes share one act.
      // ⛔ **The fold that was WRONG, and is the reason this assertion names its members.** ⚠️ The
      // first draft folded `agent-already-has-a-message-waiting` in here, on the reading that a held
      // message clears and the same call then works. `RuntimeHost.queueMessage`'s own ordering note
      // says otherwise — *"every held WORK message already has an open task of its own"* — so the
      // identical call meets the NEXT rail. ⚑ It shares that rail's word instead.
      // ⚑ **429 · a SECOND rail joined this word**, and its retry lands on a different arm of the
      // same verb rather than on a world that improved — see `that-work-is-being-sent`.
      // 🔴 **650 · two more, and one of them is the FIRST shared spelling on this word.** ⛔ A launch
      // in flight is `that-conversation-has-not-started` at both doors now, so the word folds two
      // memberships of ONE rail name — which is the fold this assertion was written to show.
      // ⚠️ **657 · the lost race left and the launch that took too long joined** — the same act,
      // the same call once the thing in flight has landed.
      // 🔴 **703 · and the held message joins after all — the half the note above was never about.**
      // ⚠️ `withdraw_task` reaches only work the caller gave to a conversation it commands, and that
      // keeps its word; ⛔ everything else held is a word of its own (`698` F-B), whose act is the
      // same call once something has settled — the held message, or the open work a WORK call would
      // meet next (`703`'s review), which its sentence names. ⛔ **D-010 retired it again**, with the
      // rule that held one message at a time.
      expect(by.get('make-the-same-call-when-this-settles')).toEqual(
        [
          'INTERRUPT_RAILS · that-conversation-has-not-started',
          'QUESTION_RAILS · move-offer-is-held',
          // ⚑ **707 · R39, extended · the wake's act at the spawn door** — the same call, once it passes.
          'TOOL_REFUSALS · agent-could-not-start-just-now',
          'TOOL_REFUSALS · agent-took-too-long-to-start',
          // ⚑ **705 · R39 · the same act once a shortage has passed** — nothing to change but the moment.
          'TOOL_REFUSALS · that-conversation-could-not-be-woken-just-now',
          'TOOL_REFUSALS · that-conversation-has-not-started',
          // ⚑ **663 · the same act on the other side of a run** — the same call once the stop has landed.
          'TOOL_REFUSALS · that-conversation-is-still-stopping',
          'TOOL_REFUSALS · that-work-is-being-sent',
          'TOOL_REFUSALS · work-record-unavailable',
          // ⚑ **D-016** — a give held behind a start that did not happen: the same give, once it has.
          'TOOL_REFUSALS · the-start-it-waited-on-did-not-happen',
          // A restore behind an archive or a delete still under way: the same call, once it has landed.
          'TOOL_REFUSALS · it-is-being-archived-or-deleted',
          // A give to a service that waits on its caller: the same give, once that work has ended.
          'SPAWN_RAILS · it-would-wait-on-itself',
          // A give to a service whose waits can't all be checked: the same give, once some has ended.
          'SPAWN_RAILS · its-waits-cannot-all-be-checked',
          'SPAWN_RAILS · no-free-worker-at-capacity',
          // A stop of a service on another caller's piece: the same stop, once that piece has ended.
          'INTERRUPT_RAILS · that-service-is-on-another-callers-piece',
          // A message about a piece queued at a service: the same message, once it is handed over.
          'TOOL_REFUSALS · that-piece-is-still-queued',
          // A piece that cannot end with the copies passed up of its questions, at a take-back, a
          // close and a reply: the same call once the start has landed, or the read passes.
          'REPLY_RAILS · a-conversation-with-its-questions-is-starting',
          'REPLY_RAILS · its-questions-could-not-all-be-read',
          'TOOL_REFUSALS · a-conversation-with-its-questions-is-starting',
          'TOOL_REFUSALS · its-questions-could-not-all-be-read',
        ].sort(),
      )
      // 🔴 **429 · the WORD changed because the act did.** ⛔ `425` wrote
      // `ask-about-the-open-work-or-wait` while `422` §3's measurement stood — *the roster has no
      // withdraw verb at all* — and *wait* was the arm that walked a model into `415` §6.3's
      // duplicate. ⚑ The two rails are unchanged; what they leave a caller to do is not.
      // ⚑ **D-010** — the mailbox rail that shared it is retired. ⚑ **D-016** — and the open-work
      // rail with the one-open-task rule: the word went to the STALL RULE, whose act is the same.
      // ⚑ And the stall rule refuses nothing now: the give's answer names the stalled
      // piece with the same act, so the word went with its last rail.
      expect(REFUSAL_REMEDIES as readonly string[]).not.toContain(
        'withdraw-the-work-or-ask-about-it',
      )
      // ⚑ An answer's act is a summary's, said of an answer: it carries no file, so a path goes in it.
      expect(by.get('shorten-the-answer-or-put-the-long-form-in-a-file')).toEqual([
        'QUESTION_RAILS · answer-too-long',
      ])
      expect(by.get('offer-a-workspace-markdown-file-that-reads')).toEqual([
        'RESOURCE_RAILS · resource-empty',
        'RESOURCE_RAILS · resource-not-text',
        'RESOURCE_RAILS · resource-too-large',
        'RESOURCE_RAILS · resource-unreadable',
      ])
      // ⛔ **No remedy is spelled like a rail**, which a fold onto rail names would have produced.
      const rails = new Set(everyRail().map((one) => one.rail))
      for (const said of REFUSAL_REMEDIES) expect(rails.has(said)).toBe(false)
    })

    it('⛔ every door BUILDS the word its table says, walked over every rail there is', () => {
      // ⚠️ **The table and the payload are two things and either can move.** ⛔ A door that stopped
      // reading its table would publish `undefined` into a field a ledger keeps forever.
      const walked: string[] = []
      for (const vocabulary of VOCABULARIES) {
        for (const rail of vocabulary.rails) {
          const built = vocabulary.built(rail)
          const label = `${vocabulary.name} · ${rail}`
          expect(built.remedy, label).toBe(vocabulary.remedyOf(rail))
          // ⚑ **And the field EXISTS on every payload**, not only where it is non-null — `405`'s
          // quartet became a quintet in every vocabulary at once.
          expect(Object.keys(built), label).toContain('remedy')
          walked.push(label)
        }
      }
      // ⚑ **Fifty-two since `424` split `that-agent-is-you` out of `agent-cannot-take-a-message`,**
      // and that rail is why this table is a `Record` rather than a lookup with a default: the merge
      // would not compile until `425` had answered for it.
      // ⚑ **Fifty-six since `429` added four to `TOOL_REFUSALS`.**
      // ⚑ **Fifty-seven since `437` added one to `QUESTION_RAILS`** — `no-open-work-by-that-name`,
      // the ask door's whole vocabulary.
      // ⚑ **Sixty since `439` added two to `MESSAGE_RAILS`** for its `read` act, and one to
      // `TOOL_REFUSALS` — `no-project-by-that-name`, which the project door asks after the reach.
      // ⚑ **Sixty-four since `441` added four to `TOOL_REFUSALS`.** The machine boundary remains
      // beside an owner-qualified equality that names every membership.
      // ⚑ **Sixty-five since `459` added one to `SPAWN_RAILS`.**
      // ⚑ **Sixty-eight since `489` added three to `TOOL_REFUSALS`** — `project-folder-rails.ts`'
      // own vocabulary, spread into the model's one closed list rather than re-typed there.
      // ⚑ **Sixty-nine since `496` gave ENDING its own one-member vocabulary** (HO-034 §1), whose
      // word is `INTERRUPT_RAILS`' word shared under the census's named exception and whose sentence
      // could not be.
      // ⚑ **Seventy-one since `517` gave the document reader two answers it could not give**
      // (HO-043 §1): `document-path-outside-tree`, because a row that points out of the tree is
      // not `resource-outside-workspace`'s *the path you named*, and `document-bytes-unreadable`,
      // because *the file is gone* was being said about a file that is sitting there.
      // ⚑ **Seventy-three since `553` gave assigning work its own two rails** (HO-060 §2):
      // `may-not-assign-work` and `assign-work-outside-your-project`, which could not be narrower
      // spellings of the two `message` rails because a caller that meets either of them CAN still
      // speak to the conversation it named.
      // ⚑ **Seventy-five since `582` gave the `configured` layer its own two rails** — see the
      // note on `quiet` above for why they are two and not one.
      // ⚑ **Seventy-seven since `611` gave the pass-up door its own two rails** — see the note on
      // `quiet` above for why they are two and not one.
      // ⚑ **Seventy-eight since `628` gave `message_agent` the rail that names the MISTAKE** —
      // see the note on `quiet` above. ⛔ It could not be a narrower spelling of
      // `no-task-you-gave-that-agent`, which is `that-agent-is-you`'s own argument one object
      // over: a caller speaking about work it holds was told the id was not hers, which is the one
      // thing it was not.
      // ⚑ **Eighty since `650` split two arms out of `agent-cannot-take-a-message`**, each of which
      // clears with nobody acting — a launch in flight and a turn another sender opened first. ⛔ The
      // catch-all could not have carried either: its permanence is one word, and no single word is
      // true of those and of the sign-in arm it still folds.
      // ⚑ **Eighty-one since `657`**: one retired (a lost race is held now) and two added (a spawn
      // whose conversation did not start, and one whose provider did not answer in time).
      // ⚑ **Eighty-two since `661` split `the-conversation-that-asked-has-ended` off
      // `question-has-already-ended`**, whose *never* is false of an app-raised question a reopen in
      // this app run routes again — see the note on `quiet` above.
      // ⚑ **Eighty-five since `663` gave `resume_agent` its three words** — running, still stopping,
      // and could not be resumed; its other answers are words it shares.
      // ⚑ **Eighty-six since `675`** — `no-conversation-of-yours-to-wake`, the fold's own word at the
      // wake door, which answered `no-such-agent` until then.
      // ⚑ **Eighty-seven since `677`**: `spawn_agent`'s `not-the-model-a-person-chose`.
      // ⚑ **Eighty-nine since `679`** — `more-than-one-question-has-that-id`, the word both answer
      // doors refuse an id with when two of the caller's children raised a request under it, and
      // `that-conversation-did-not-ask-that`, for an `asked_by` that raised nothing by it.
      // ⚑ **Ninety since `705`** — `that-conversation-could-not-be-woken-just-now` (R39).
      // ⚑ **Ninety-one since `703`** — `a-message-you-cannot-withdraw-is-waiting`, the held rail's
      // word for a held message the caller cannot withdraw, whose act `withdraw_task` never was.
      // ⚑ **Ninety-two since `707`** — `agent-could-not-start-just-now` (R39, extended).
      // ⚑ **Ninety-three since `710`** — `agent-could-not-be-started` (R51), its permanent mirror.
      // ⚑ **Ninety since `726` · R92** — `cwd-outside-parent`, `folder-is-not-allowed` and
      // `resource-outside-workspace` went with the location guards they named (see `quiet` above).
      // ⚑ **D-009** — +3: the same three, each built at its door.
      // ⚑ **D-010** — −2: both mailbox words, with the one-held-message rule.
      // ⚑ **D-012** — +2: `read_transcript`'s two words.
      // ⚑ **D-014** — −8 +1: the words that went with the start grant, the fan-out cap, the end and
      // interrupt grant and the create-projects grant, and the give door's new relationship word.
      // ⚑ **D-017** — −1: `the-conversation-that-asked-has-ended`, with the rail (see `quiet` above).
      // ⚑ **D-017, commit 3** — −4 +3, the same memberships as `quiet` above.
      // ⚑ **D-016** — −12, the same memberships as `quiet` above.
      // ⚑ **D-016, commit 3 (the tree)** — +5: the four `quiet` gained, and the stall rule's and the
      // unhappened start's retryable words beside the open-work rail that went.
      // ⚑ **D-016, commit 5 (the giver's verbs)** — +2, the same two words as `quiet` above.
      // ⚑ **D-016, commit 6 (a request the person makes)** — +1, the same word as `quiet` above.
      // ⚑ **Eighty-one** — `answer-too-long`, an answer over the bound.
      // ⚑ **Eighty-two** — `that-agent-is-not-below-you`, the same word as `quiet` above.
      // ⚑ **Eighty-three** — F009's `no-agent-by-that-name`, the same word as `quiet` above.
      // ⚑ **Eighty-four** — `its-provider-is-not-chosen`, the same word as `quiet` above.
      // ⚑ **Eighty-seven** — `restore_agent`'s three: the two `quiet` gained, and
      // `it-is-being-archived-or-deleted`, which the same call clears once that has landed.
      // ⚑ **Ninety-three** — a give to a service's six: the four `quiet` gained, and
      // `it-would-wait-on-itself` and `its-waits-cannot-all-be-checked`, which the same give clears
      // once that work has ended.
      // ⚑ **Two more** — a stop of a service on another caller's piece, and a message about a
      // piece still queued at one, each the same call once that has settled.
      // ⚑ **Three more** came with Move and work search, and one went: the stall rule is out, so
      // a give is no longer refused over a stall.
      // The walk includes worker selection and the current-work read failure.
      // ⚑ And one more: a service asked for while services are off.
      // ⚑ Four more: a piece that cannot end with the copies of its questions, at two vocabularies.
      expect(walked).toHaveLength(116)
      expect(walked).toEqual(everyRail().map((one) => `${one.vocabulary} · ${one.rail}`))
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a remedy CANNOT say — §2 of the brief, by construction
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · a remedy is what you may do, never what you asked for', () => {
    it('🔴 a remedy carries no data at all, so it cannot be a lie about entitlement', () => {
      // ⛔ **`422` measured that `profile-already-live` COULD name a session the caller may not
      // reach** — app-wide until `428` re-keyed it to parent + identity — whose own remedy would
      // have answered `no-such-agent`; so a remedy that names an OBJECT is
      // a remedy that can be a lie. ⚑ **The shape makes that impossible rather than unlikely**: the
      // word is a string literal from a fixed list with nowhere to put an id.
      for (const said of REFUSAL_REMEDIES) {
        expect(typeof said).toBe('string')
        // ⚠️ **No interpolation slot, no separator a path or an id could arrive through.**
        expect(said).toMatch(/^[a-z]+(-[a-z]+)+$/)
      }
    })

    it('⛔ the same rail refused with different detail says the same word, byte for byte', () => {
      // 🔴 **The detail is where a session id, a path and a caller's own prose live**, and the remedy
      // is derived from the RAIL alone. ⚑ A remedy computed from the request would differ here.
      const first = refuseResource('resource-too-large', {
        bytes: 9_000_000,
        limit: 1_048_576,
        path: '/Users/somebody/northwind-acquisition/secret.md',
      })
      const second = refuseResource('resource-too-large', {})
      expect(first.remedy).toBe(second.remedy)
      expect(first.remedy).toBe('offer-a-workspace-markdown-file-that-reads')
    })

    it('🔴 nothing a caller wrote reaches the row, and the remedy did not re-open that door', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm')
      // ⚑ **D-014 · refused by the depth a person set**, since any agent may give to any agent: a
      // `max_depth` of 0 leaves this conversation no room for a piece below its own.
      grant('pm', { maxDepth: 0 })
      const call = callerOf(host, pm)
      const secret = 'Northwind: do not write this into a ledger'
      await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: secret,
        brief: secret,
      })

      const row = theRefusalIn(pm)
      const written = JSON.stringify(row)
      expect(written).not.toContain('Northwind')
      // ⚑ **The positive control over the same string** — an empty row would pass the negative.
      expect(written).toContain('too-deep')
      // ⛔ **And the new field is one of the closed words or `null`, never free text.**
      expect(row.remedy === null || isRefusalRemedy(row.remedy)).toBe(true)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the resource remedies written from nothing — and FOLLOWED
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the resource shapes, refused and then satisfied', () => {
    it('🔴 each malformed resource shape is refused with the same act, and the act works', async () => {
      const piece = await aPieceToReplyTo()
      // ⛔ **Each way of failing the requirement is named**, and each fixture is written so the rail
      // it reaches is the one named — `put-the-hazard-on-the-path-the-code-walks`. ⚑ D-016: an
      // EMPTY file is one with no bytes at all (`resource-empty`); whitespace is text.
      const shapes: { rail: ResourceRail; path: string }[] = [
        { rail: 'resource-unreadable', path: join(work, 'nothing-here.md') },
        { rail: 'resource-too-large', path: wrote('big.md', `${'a'.repeat(1_048_576)}\n`) },
        { rail: 'resource-empty', path: wrote('empty.md', '') },
        { rail: 'resource-not-text', path: wrote('bytes.md', Buffer.from([0xff, 0xfe, 0x00])) },
      ]
      for (const shape of shapes) {
        const refused = await offer(piece, shape.path)
        expect(refused.ok, shape.rail).toBe(false)
        if (refused.ok) continue
        expect(refused.refusal.rail).toBe(shape.rail)
        // ⚑ **One word for these rails**, because the act is one act.
        expect(refused.refusal.remedy, shape.rail).toBe(
          'offer-a-workspace-markdown-file-that-reads',
        )
        // 🔴 **And the MODEL is told it in prose too** — at `425`, these resource remedies were the
        // ones written from nothing, so until then each sentence said what was wrong and stopped.
        expect(refused.refusal.reason, shape.rail).toContain('offer that path instead')
        // ⛔ **The remedy promises no provider verb** (`422` §3): a file the agent writes, not a tool
        // one provider spells differently from another. (`726` · R92 dropped *"inside this
        // conversation’s working directory"* from the act: a file anywhere is offered.)
        for (const verb of ['Write tool', 'apply_patch', 'shell', 'grant']) {
          expect(refused.refusal.reason, `${shape.rail} names ${verb}`).not.toContain(verb)
        }
      }

      // 🔴 **THE REMEDY, FOLLOWED.** ⛔ *A remedy nobody has walked is a sentence, not a remedy* —
      // so the artifact the word describes is written, named, and accepted, through the same door
      // that refused every shape above.
      const followed = await offer(piece, wrote('the-long-form.md', '# It fits\n\nAll of it.\n'))
      expect(followed.ok, JSON.stringify(followed)).toBe(true)
      // ⚑ **And the file that was refused is still exactly where it was** — nothing in the remedy
      // asked this app to have changed it. ⚑ D-016: read by the same reader the reply asked, since
      // the piece is answered now and a second reply would meet that instead.
      expect(readOfferedResource(join(work, 'empty.md')).ok).toBe(false)
    })

    it('⛔ permanent resource-shape rails carry nothing, beside a present remedy', async () => {
      const piece = await aPieceToReplyTo()
      // ⚠️ **`an-unenumerated-state-counts-as-success` is the trap**: the empty answer has to be
      // measured with a present one beside it, or *nothing* and *never asked* look the same.
      // ⚑ `726` · R92 removed the first permanent shape this walked — `resource-outside-workspace`,
      // a file outside the offering conversation's folder. The one left is the file's TYPE.
      const notMarkdown = await offer(piece, wrote('notes.txt', 'plain\n'))
      expect(notMarkdown.ok).toBe(false)
      if (!notMarkdown.ok) {
        expect(notMarkdown.refusal.rail).toBe('resource-not-a-form-this-app-keeps')
        expect(notMarkdown.refusal.remedy).toBeNull()
      }
      // ⚑ **The present one, over the same door and the same reader.**
      const refused = await offer(piece, wrote('nothing.md', ''))
      expect(refused.ok).toBe(false)
      if (!refused.ok) {
        expect(refused.refusal.remedy).toBe('offer-a-workspace-markdown-file-that-reads')
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the seam — door → payload → ledger → both readers, in one call
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the whole way from the rail to the person', () => {
    it('🔴 a refusal with an act reaches the ledger and the transcript says what the act is', async () => {
      await bringIdentityIntoBeing('worker')
      // ⚑ **An `auto` PM**, so the worker its give starts runs its brief to the end, then answers it
      // with a summary over the limit: a refusal whose act is to shorten it, built for real rather
      // than injected at the host seam. ⚠️ This was once a give refused over a stall, and that
      // rail refuses nothing now.
      const pm = await personOpens('pm', 'auto')
      const first = await callerOf(host, pm)('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'work',
        brief: 'work',
      })
      expect(first.outcome, JSON.stringify(first)).toBe('ok')
      const child = first.agent as string
      await waitFor(
        () => events(child).some((one) => one.type === 'turn'),
        'the brief’s turn to end',
      )

      const refused = await callerOf(host, child)('reply_to_parent', {
        piece: first.label,
        outcome: 'done',
        summary: 'x'.repeat(REPLY_SUMMARY_LIMIT + 1),
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('summary-too-long')
      // **The model**, which already had the sentence and now has the word beside it.
      expect(refused.remedy).toBe('shorten-the-summary-and-attach-the-long-form')

      // **The ledger**, which had neither.
      const row = theRefusalIn(child)
      expect(row.remedy).toBe('shorten-the-summary-and-attach-the-long-form')

      // **The person**, in their own register — *it*, never *you*.
      const said = theNoticeFor(row).text
      expect(said).toContain('it can shorten the summary and put the long form in a file it names')
      expect(said).not.toContain('shorten-the-summary-and-attach-the-long-form')
      // ⛔ **The facts the PO was left with are all still there** — the remedy is beside them.
      expect(said).toContain('reply_to_parent')
      expect(said).toContain('summary-too-long')
      // ⚑ **627 · looked up, not spelled** — see `PERMANENCE_SAID`'s own note (`HO-096` §2.4).
      expect(said).toContain(PERMANENCE_SAID['while-this-holds'])
      expect(said).toContain('retrying may work')

      // **The raw stream**, which names the WORD rather than the clause.
      const line = describeEvent(row)
      expect(line).toContain('shorten-the-summary-and-attach-the-long-form')
      expect(line).not.toContain('it can shorten the summary')
    })

    it('⚑ the same call with nothing held is admitted, writes no row, and carries no remedy', async () => {
      await bringIdentityIntoBeing('worker')
      const pm = await personOpens('pm', 'auto')
      const call = callerOf(host, pm)
      // ⛔ **Standing rule 3 over the SAME reader** — a call admitted writes no row and carries no
      // remedy.
      const sent = await call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'work',
        brief: 'work',
      })
      expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
      expect(sent).not.toHaveProperty('remedy')
      expect(refusalsIn(pm)).toEqual([])
    })

    it('⛔ `refusalIn` carries the word out of an untyped payload, walked over a vocabulary', () => {
      // ⚠️ **The answer is where the payload's type is gone**, so the field is read back off a bag.
      for (const rail of TOOL_REFUSALS) {
        const payload = refuseTool(rail, { agent: 'sess_1' })
        const read = refusalIn('a_tool', { ...payload })
        expect(read?.remedy, rail).toBe(payload.remedy)
      }
      // 🔴 **A remedy this build cannot read is NOT a reason to drop the row.** ⛔ Unlike the rail and
      // the permanence, the absence of an act is an ordinary answer — `425` wrote twelve `null`s for
      // the twenty-one memberships `422` had investigated — so the row still says which rule stopped
      // the call.
      const later = refusalIn('a_tool', {
        outcome: 'refused',
        rail: 'a-rail',
        permanence: 'while-this-holds',
        retryable: true,
        remedy: 'a-word-from-a-later-build',
      })
      expect(later).not.toBeNull()
      expect(later?.rail).toBe('a-rail')
      expect(later?.remedy).toBeNull()
      // ⚑ **And a payload with no remedy field at all reads the same way.**
      expect(
        refusalIn('a_tool', {
          outcome: 'refused',
          rail: 'a-rail',
          permanence: 'permanent',
          retryable: false,
        })?.remedy,
      ).toBeNull()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · nothing invented — the reader that draws nothing, measured
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · where the app does not know, neither reader is told anything', () => {
    it('🔴 absent, null and a word from a later build all draw NOTHING — with a present one beside', () => {
      // ⛔ **The PO's live database is the fixture.** Every `tool_refused` row written before this
      // dispatch arrives with no field at all, and the app must read them without apologising.
      const bare: ToolRefusedEvent = {
        type: 'tool_refused',
        tool: 'message_agent',
        rail: 'a-rail',
        permanence: 'while-this-holds',
        retryable: true,
      }
      const drawn = [
        theNoticeFor(bare).text,
        theNoticeFor(rowSaying(null)).text,
        theNoticeFor(rowSaying('a-word-from-a-later-build')).text,
      ]
      // ⚑ **Each absent or unreadable variant is the line as it read BEFORE this dispatch**, to the
      // character.
      // ⚑ **627 · composed from the vocabulary, so *the line as it read before* stays true of the
      // line this build draws** (`HO-096` §2.4). ⛔ A literal here would have pinned a clause this
      // dispatch replaced, and the three variants it compares are about a REMEDY, not a permanence.
      const before = `refused: message_agent · a-rail · ${PERMANENCE_SAID['while-this-holds']} · retrying may work`
      expect(drawn).toEqual([before, before, before])
      for (const line of drawn) expect(line).not.toContain('undefined')
      expect(drawn[2]).not.toContain('a-word-from-a-later-build')
      // 🔴 **The present one beside them**, over the same reader — without it this measures a reader
      // that draws nothing for everything (`an-unenumerated-state-counts-as-success`).
      const present = theNoticeFor(rowSaying('make-the-same-call-when-this-settles')).text
      expect(present.startsWith(before)).toBe(true)
      expect(present.length).toBeGreaterThan(before.length)

      // ⚠️ **And the raw stream answers each variant the same way.**
      expect(describeEvent(bare)).toBe(describeEvent(rowSaying(null)))
      expect(describeEvent(rowSaying('a-word-from-a-later-build'))).toBe(describeEvent(bare))
      expect(describeEvent(rowSaying('make-the-same-call-when-this-settles'))).toContain(
        'make-the-same-call-when-this-settles',
      )
      expect(isRefusalRemedy('a-word-from-a-later-build')).toBe(false)
    })

    it('⚑ every word renders as a clause of its own, walked from the vocabulary', () => {
      const said = REFUSAL_REMEDIES.map((remedy) => theNoticeFor(rowSaying(remedy)).text)
      // ⛔ **Every clause is distinct, and none is the bare word.** ⚠️ A rail map folded onto a
      // smaller remedy vocabulary is exactly the shape where a copy-paste makes sibling words say
      // one thing and nothing fails — `a-file-level-contains-cannot-tell-sibling-declarations-apart`.
      expect(new Set(said).size).toBe(REFUSAL_REMEDIES.length)
      for (const [at, remedy] of REFUSAL_REMEDIES.entries()) {
        expect(said[at], remedy).not.toContain(remedy)
        // ⚑ **The person's register: about the agent, never addressed to the reader.**
        expect(said[at], remedy).not.toContain('you ')
      }
    })

    it('⛔ the permanence is still printed when this build does not know it, and the remedy is not', () => {
      // 🔴 **The difference between the two guards, asserted rather than argued.** ⚠️ A permanence is
      // a fact about the refusal and every row has one, so an unknown word is printed AS ITSELF.
      // ⛔ A remedy is a PROMISE about an act, and a build that does not know the word cannot say the
      // act still exists.
      const strange = theNoticeFor({
        type: 'tool_refused',
        tool: 'message_agent',
        rail: 'a-rail',
        permanence: 'a-word-from-a-later-build' as never,
        retryable: true,
        remedy: 'another-word-from-a-later-build' as never,
      }).text
      expect(strange).toContain('a-word-from-a-later-build')
      expect(strange).not.toContain('another-word-from-a-later-build')
      // ⚑ **And every known permanence still renders**, so the line above is a difference and not a
      // reader that has stopped working.
      for (const permanence of RAIL_PERMANENCES) {
        expect(
          theNoticeFor({
            type: 'tool_refused',
            tool: 'message_agent',
            rail: 'a-rail',
            permanence,
            retryable: false,
          }).text,
        ).not.toContain(permanence)
      }
    })
  })
})
