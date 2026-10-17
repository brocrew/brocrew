import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { distil } from '../src/main/runtime/digest'
import {
  ABOUT_WORK_SAYS,
  NOTHING_NAMED_THE_WORK,
  aboutTheWork,
  escalationChain,
  type AboutWork,
  type AboutWorkIs,
  type RoutedRequest,
  type WorkInHand,
} from '../src/shared/questions'
import { derivePieces, openWorkOf, workNamed } from '../src/shared/tasks'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **474 · what a request is about, and whose it is** — `463`'s F4 and F2, which are two halves of
 * criterion 20's *partly*.
 *
 * ## ⛔ F4 · the exact task edge was written and then discarded
 *
 * ⚑ **`463` measured it in as many words:** *"The request-to-task edge is absent for the ordinary
 * three row families; even where `question_asked.taskId` exists, the person-reader discards it and
 * shows all open work instead."* 🔴 **Which is worse than nothing** — a list of every open task,
 * under the sentence *"which of it this is about is not recorded"*, reads as an answer.
 *
 * ⚠️ **The value was never missing.** `437` wrote `question_asked.taskId` into the asker's own
 * ledger and `466` drew it in the digest, so it demonstrably survived to ONE reader. ⛔ **§3 names
 * which of the two was doing the wrong thing and where the value fell out.**
 *
 * ## ⛔ F2 · request correlation was project-global on a session-local id
 *
 * ⚑ **A provider mints its request ids per conversation, and this is derived rather than restated.**
 * Codex's is a JSON-RPC `RequestId` — `codex-runtime.ts`'s `requestKey` renders it
 * `` `${typeof id}:${id}` ``, so the first server request of every connection is `number:1` — and
 * Claude's is an SDK `toolUseID`, which that adapter calls *"unique per tool call and scoped to the
 * turn that raised them"*. 🔴 **Two conversations therefore share ids by construction**, and every
 * fixture in this repo before `463` used one conversation, so nothing could see it.
 *
 * ⛔ **Two folds crossed conversations on a bare id** and §1 pins both:
 *
 *  - **`digest.ts`'s four request sets.** `SessionStore.digestWindow` is the one read in this app
 *    that *"asks about every placed conversation and gets back rows from many of them at once"*, and
 *    `routed`, `travelled`, `ended` and `questionsNamingWork` were `Set<requestId>`.
 *  - **`escalationChain`'s cycle refusal.** It walked a chain of DIFFERENT conversations while
 *    holding session ids and request ids in ONE set, so a parent whose open question shared a
 *    descendant's id was refused as a cycle and the queue drew *"the chain above this could not be
 *    followed"* over a chain that was perfectly followable.
 *
 * ## ⚑ Which id, and which questions it answers (§2's trap)
 *
 * ⛔ **This dispatch keys on `requestId`, and `requestId` has TWO mints.** The app's own is
 * `newAskedQuestionId`, `req_<uuid4>`, globally unique; the provider's is session-local. ⚠️ The
 * field answers *which card is this*, *which routing is this* and *which request does this answer
 * close* — three questions, all of them about one card in one conversation, and none of them about
 * a project. ⛔ **So the pair is `(conversation, request id)` and the conversation is the ledger the
 * row was read from**, which is where the provider minted it.
 *
 * ⚑ **A piece id and `messageId` are NOT re-keyed and the reason is measured, not assumed.**
 * `db/ids.ts`: `newWorkId` is `` `work_${randomUUID()}` `` — minted by this app, globally unique —
 * so the digest's piece maps and the piece folds are already sound on a bare id. §1.3 is the census
 * that says so and would fail if a provider ever minted one.
 *
 * ## ⛔ No schema change, stated rather than inferred (§2's fourth trap)
 *
 * 🔴 **This is a READ-PATH fix and it writes nothing new.** No column, no new durable row, no new
 * file under userData — the work a question names was already in the `question_asked` payload
 * (`$.piece` since D-016) and the change to SQL is one more `json_extract` in a SELECT. ⚑ **So
 * `clean-base` is owed nothing**, and §4 pins the absence rather than leaving it to be believed.
 *
 * ## ⚑ D-016 · no projects
 *
 * ⛔ **The digest reads one window over every conversation an agent of this app holds**, not a
 * project, and the work a question names is its label alone (`WorkInHand` is `{ label }`). ⚠️
 * Proposals went, and `newProposalId` with them. What `474` measured — a provider's request id is
 * session-local, so the fold that crosses conversations keys on the pair — is exactly as true of
 * the window as it was of a project, and every section below still asks it.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const MIGRATIONS = join(HERE, '..', 'src', 'main', 'db', 'migrations')

/** ⚠️ **Code only** — a docblock quoting the call a census retired turns that census green. */
function withoutProse(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

const sourceOf = (...parts: string[]): string =>
  withoutProse(readFileSync(join(SRC, ...parts), 'utf8'))

/** ⚑ **The search shape for a call-site census** — every file a caller could live in. */
function everySourceFileUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? everySourceFileUnder(join(dir, entry.name))
      : /\.(ts|vue)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  )
}

const FROM = 1_760_000_000_000
const TO = FROM + 12 * 60 * 60 * 1_000

/**
 * ⛔ **The id two Codex conversations share by construction** — `requestKey(1)`, and it is spelled
 * the way the adapter spells it rather than as an invented `same-id`. ⚑ The colon in it is also why
 * the digest's joiner is a NUL: a `:` would make `(number, 1)` and `(number:1, …)` ambiguous.
 */
const COLLIDING = 'number:1'

describe('474 · what a request is about, and whose it is', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let counter: number
  const ordinals = new Map<string, number>()

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-474-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-474-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, MIGRATIONS)
    clock = FROM + 60_000
    counter = 0
    ordinals.clear()
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new FakeRuntime(provider, { sessions: new FakeProviderSessions() }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const conversation = (id: string): void => {
    store.create({
      id,
      provider: 'codex',
      // ⚑ A distinct folder per conversation, though a person's chain names the conversation's
      // AGENT since `734` (R41) — and the basename only where there is none.
      cwd: join(root, id),
      approvalMode: 'ask',
      profileId: `profile-${id}`,
    })
  }

  const at = (id: string, when: number, event: TranscriptEvent): void => {
    const ordinal = ordinals.get(id) ?? 0
    ordinals.set(id, ordinal + 1)
    store.append(id, ordinal, event, when)
  }

  /** ⚑ One piece given, so the asker holds labelled work a question can name. */
  const give = (id: string, piece: string, label: string, when: number): void => {
    at(id, when, {
      type: 'work_given',
      piece,
      label,
      parent: 'work_parents_root',
      givenBy: 'sess_parent',
      title: `work ${piece}`,
      brief: `work ${piece}`,
    })
  }

  /** The label of the root a conversation a person started owns. */
  const rootLabel = (id: string): string => {
    const root = store.rootOf(id)
    if (root === null) throw new Error(`${id} owns no root`)
    return root.label
  }

  /**
   * ⛔ **A question the app authored, which is the only row in this app that names its work**
   * (`437`), routed to the parent and escalated so a person's reader can see it.
   */
  const askedAboutWork = (
    id: string,
    requestId: string,
    piece: string,
    label: string,
    when: number,
    parent = 'sess_parent',
  ): void => {
    at(id, when, {
      type: 'question_asked',
      requestId,
      piece,
      label,
      prompt: 'which database?',
      questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
    })
    at(id, when + 1, { type: 'request_routed', requestId, to: 'the-parent', parent })
    at(id, when + 2, { type: 'request_escalated', requestId })
  }

  /**
   * ⛔ **A question the PROVIDER raised**, which names no work and never can — `430`'s measured
   * absence, and the population every fixture in this repo was written against.
   */
  const providerAsked = (
    id: string,
    requestId: string,
    when: number,
    parent = 'sess_parent',
  ): void => {
    at(id, when, {
      type: 'user_input_request',
      id: requestId,
      prompt: 'which database?',
      questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
    })
    at(id, when + 1, { type: 'request_routed', requestId, to: 'the-parent', parent })
    at(id, when + 2, { type: 'request_escalated', requestId })
  }

  const rowFor = (requestId: string): { about: AboutWork; work: readonly WorkInHand[] } => {
    const found = host.questionsForAPerson().rows.find((one) => one.request.requestId === requestId)
    if (found === undefined) throw new Error(`no person's row for ${requestId}`)
    return { about: found.about, work: found.work }
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the colliding pair — two conversations, one provider request id
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · two conversations sharing one provider request id', () => {
    /** ⚑ One routed request, spelled out, so a section can move exactly one fact. */
    const routed = (over: Partial<RoutedRequest> & { requestId: string; askedBy: string }) => ({
      parent: 'sess_parent',
      went: { is: 'the-parent', to: 'the-parent' } as const,
      at: FROM,
      state: 'open' as const,
      endedAt: null,
      escalatedAt: FROM + 1,
      ...over,
    })

    /**
     * 🔴 **The chain, and this is the defect a person actually saw.**
     *
     * ⛔ **`escalationChain` walked conversations while refusing on ids from two namespaces.** A
     * child waiting on a parent that is itself waiting is the ordinary two-hop chain criterion 11
     * is about; give both conversations the request id every Codex connection starts with and the
     * walk stopped at hop one, `endsWithAPerson` went false, and `PersonsQueue.vue` drew *"the
     * chain above this could not be followed, so nobody past the last conversation named here has
     * been identified as the one to answer."*
     *
     * ⚠️ **Measured where the two readings DIVERGE** (standing rule 3): the same two hops with two
     * different ids is the control, and it answered correctly the whole time — which is why one
     * conversation, or two with distinct ids, could never expose this.
     */
    it('🔴 the chain follows a parent whose open question shares the child’s request id', () => {
      const child = routed({ requestId: COLLIDING, askedBy: 'sess_child', parent: 'sess_parent' })
      const parentsOwn = routed({
        requestId: COLLIDING,
        askedBy: 'sess_parent',
        parent: 'sess_grandparent',
      })
      const openIn = new Map<string, RoutedRequest>([['sess_parent', parentsOwn]])
      const collided = escalationChain(child, (id) => openIn.get(id) ?? null)
      expect(collided.links.map((one) => one.waiting)).toEqual(['sess_child', 'sess_parent'])
      expect(collided.endsWithAPerson).toBe(true)

      // ⚑ **The control, one fact over**: the same two hops with two different ids. ⛔ It answered
      // this way before `474` as well, which is precisely why the collision was invisible.
      const distinct = escalationChain(child, (id) =>
        id === 'sess_parent' ? { ...parentsOwn, requestId: 'number:2' } : null,
      )
      expect(distinct.links.map((one) => one.waiting)).toEqual(['sess_child', 'sess_parent'])
      expect(distinct.endsWithAPerson).toBe(true)
    })

    /**
     * ⛔ **The refusal the removed conjunct was NOT carrying.** A conversation seen twice is a real
     * cycle and is still refused — with two DIFFERENT request ids, so the answer cannot come from
     * the half `474` deleted.
     */
    it('⛔ a real cycle is still refused, and its two requests have different ids', () => {
      const a = routed({ requestId: 'number:1', askedBy: 'sess_a', parent: 'sess_b' })
      const b = routed({ requestId: 'number:9', askedBy: 'sess_b', parent: 'sess_a' })
      const walked = escalationChain(a, (id) => (id === 'sess_b' ? b : id === 'sess_a' ? a : null))
      expect(walked.endsWithAPerson).toBe(false)
      expect(walked.links.map((one) => one.waiting)).toEqual(['sess_a', 'sess_b'])
    })

    /**
     * 🔴 **The digest, and the gap it hid.** One conversation's `user_decision` closed another
     * conversation's open routing, so `open-is-not-waiting` — the gap whose entire job is to say
     * *nothing this digest reads ended one* — reported nothing.
     *
     * ⛔ **Planted by hand** (§2's trap): two `request_routed` rows with one id, in two ledgers,
     * and one answer.
     */
    it('🔴 one conversation’s answer does not close another conversation’s request', () => {
      for (const id of ['sess_open', 'sess_answered']) conversation(id)
      at('sess_open', FROM + 10, {
        type: 'request_routed',
        requestId: COLLIDING,
        to: 'the-parent',
        parent: 'sess_parent',
      })
      at('sess_answered', FROM + 11, {
        type: 'request_routed',
        requestId: COLLIDING,
        to: 'the-parent',
        parent: 'sess_parent',
      })
      at('sess_answered', FROM + 12, {
        type: 'user_decision',
        requestId: COLLIDING,
        outcome: 'answered',
      })
      const drawn = distil(store.digestWindow(FROM, TO), (id) => id)
      const gap = drawn.gaps.find((one) => one.kind === 'open-is-not-waiting')
      expect(gap?.count).toBe(1)
      // ⚑ **The control that plants TWO** (standing rule 12): both routings are in the window, so
      // *"it counted the only row it found"* is not what passed. `question-travelled` counts them.
      const travelled = drawn.lines.find((one) => one.kind === 'question-travelled')
      expect(travelled?.count).toBe(2)
    })

    /**
     * ⛔ **And the other direction: one conversation's `question_asked` does not name another
     * conversation's work.** `question-without-work` asks *which work is this about* of every
     * routing that travelled, and a collided key answered it for a request nobody had named.
     */
    it('🔴 one conversation’s named work does not answer another conversation’s gap', () => {
      for (const id of ['sess_unnamed', 'sess_named']) conversation(id)
      at('sess_unnamed', FROM + 10, {
        type: 'request_routed',
        requestId: COLLIDING,
        to: 'the-parent',
        parent: 'sess_parent',
      })
      at('sess_named', FROM + 11, {
        type: 'question_asked',
        requestId: COLLIDING,
        piece: 'work_named',
        label: 'W5.1',
        prompt: 'which database?',
        questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
      })
      at('sess_named', FROM + 12, {
        type: 'request_routed',
        requestId: COLLIDING,
        to: 'the-parent',
        parent: 'sess_parent',
      })
      const drawn = distil(store.digestWindow(FROM, TO), (id) => id)
      expect(drawn.gaps.find((one) => one.kind === 'question-without-work')?.count).toBe(1)
      // ⚑ The named one still draws its own edge, so the fix narrowed nothing.
      expect(drawn.lines.find((one) => one.kind === 'question-about-work')?.count).toBe(1)
    })

    /**
     * ⛔ **Every correlation map in this app, and the key each one uses** (§1.2's *enumerate rather
     * than fix the one that was found*). ⚠️ **The search shape is stated** so the negative means
     * something: every `Map` or `Set` in the source trees whose membership is tested with a request
     * id, read as source rather than as a type — `a-payload-census-must-read-call-sites-not-types`.
     *
     * | fold | key today | scope | could collide |
     * |---|---|---|---|
     * | `digest.ts` `routed` / `travelled` / `ended` / `questionsNamingWork` | `(session, request)` | a WINDOW (a PROJECT until D-016) | **it did — `474`** |
     * | `digest.ts` `ourCalls` / `childMax` / `childSeen` | `(session, id)` | a WINDOW | no — `466` |
     * | `digest.ts` `given` / `spokenFor` / `questionsAboutPiece` | piece | a WINDOW | no — `work_<uuid4>` |
     * | `questions.ts` `escalationChain` `seen` | conversations only | a CHAIN | **it did — `474`** |
     * | `questions.ts` `deriveRoutedRequests` `open` / `everSeen` | `requestId` | ONE ledger | no |
     * | `tasks.ts` `derivePieces` `travelled` / `byMessage` | id | ONE ledger | no |
     * | `session-store.ts` `questionsRaisedIn` | `requestId` | ONE ledger + generation | no |
     * | `runtime-host.ts` `questionsThisAppHolds` | `req_<uuid4>` | the process | no |
     * | `runtime-host.ts` `oneQuestionReadPerAnswer` | `(session, request)` | an ANSWER | no |
     * | `transcript.ts` `requestItems` | `requestId` | ONE transcript | no |
     * | `session-record.ts` `requests` | `requestId` | ONE record | no |
     * | `attention.ts` answered keys, `persons-queue.ts` `answerable` | `` `${session}:${request}` `` | a WINDOW | no |
     */
    it('⛔ the one fold that crosses conversations keys every request fact by the pair', () => {
      const digest = sourceOf('main', 'runtime', 'digest.ts')
      const adds = digest
        .split('\n')
        .filter((line) => /tally\.(routed|travelled|ended|questionsNamingWork)\.add\(/.test(line))
      // ⛔ **Four sets and eight writers** — `routed`, `travelled` and `questionsNamingWork` are
      // written once each and `ended` by FIVE event types, one of which spells the id `event.id`.
      // ⚠️ **Stated as the number it is**, because a census that found seven would be reading a
      // file that had quietly lost a writer and would pass its own loop.
      //
      // ⚑ **D-016 · `work_taken_back` is the fifth ending** — taking a piece back ends the questions
      // asked about it (HO-082 §2.2's rule, on the piece). ⛔ **A number that had to be edited by
      // hand is the point of writing it down**: this assertion is the only thing in the repo that
      // would have noticed a new ending reaching the digest keyed on a bare request id, which is
      // `474`'s whole subject — a provider request id is session-local, and Codex renders every
      // connection's first one `number:1`.
      //
      // ⚑ **D-016, commit 5 · `work_closed` is the sixth ending, and nine writers** — closing a piece
      // ends the questions asked about it as a take-back does, keyed on the same pairs.
      // ⚑ `work_replied` is the seventh, and ten: a hand-back ends them too, on the same pairs.
      expect(adds).toHaveLength(10)
      for (const line of adds) {
        // ⚑ **`asked` is the pair, built once** — asserted below, so a writer that adds it is
        // adding a key and not a bare id.
        expect(
          line.includes('key(row.sessionId,') || line.includes('.add(asked)'),
          `a request fact keyed on a bare id: ${line.trim()}`,
        ).toBe(true)
      }
      expect(digest).toContain('const asked = key(row.sessionId, event.requestId)')
      expect(digest.split('const asked = ').length - 1).toBe(1)
      // ⚑ **The control, because a filter that matched nothing would also pass the loop above.**
      expect(
        adds.some((line) => line.includes('event.id')),
        'the `request_resolved` writer is not in this census',
      ).toBe(true)
      // ⛔ **And the joiner is a byte no id can contain.** ⚠️ A `:` would be ambiguous against
      // `requestKey`'s own `number:1`, and a `-` against a uuid.
      expect(digest).toContain("parts.join('\\u0000')")
      expect(COLLIDING).toContain(':')
    })

    it('⛔ the chain no longer tests a request id from another conversation’s namespace', () => {
      const questions = sourceOf('shared', 'questions.ts')
      const chain = questions.slice(
        questions.indexOf('export function escalationChain'),
        questions.indexOf('export interface PersonsDecision'),
      )
      expect(chain).not.toBe('')
      expect(chain).toContain('seen.has(next.askedBy)')
      // ⛔ **The membership test on an id is gone**, and the control below is what makes that a
      // measurement rather than a regex that never fires.
      expect(chain).not.toContain('seen.has(next.requestId)')
      expect(chain.includes('seen.has(next.askedBy) || seen.has(next.requestId)')).toBe(false)
      expect('if (seen.has(next.askedBy) || seen.has(next.requestId)) {').toContain(
        'seen.has(next.requestId)',
      )
    })

    /**
     * ⚑ **The negative this dispatch did NOT widen** — piece and message ids are minted by this app
     * and are globally unique, so the folds that key on them are sound on a bare id. (⚑ D-016 —
     * `newProposalId` went with proposals.)
     * ⛔ **Asserted from `db/ids.ts` rather than believed**: the day one of these starts coming off a
     * provider, this line is where it is caught.
     */
    it('⚑ the ids this app mints itself are uuids, which is why they were not re-keyed', () => {
      const ids = sourceOf('main', 'db', 'ids.ts')
      for (const minted of ['newWorkId', 'newAskedQuestionId']) {
        const line = ids.split('\n').find((one) => one.includes(`export const ${minted}`))
        expect(line, `no such minting function: ${minted}`).toBeDefined()
        expect(line).toContain('randomUUID()')
      }
    })

    /**
     * ⛔ **474 relay 1 · the account `key` holds, asserted as a PARTITION rather than as a list.**
     *
     * ⚑ **`474` and `475` each keyed a new field in this one fold and each argued about the
     * OTHER's subject** — `475`'s `byMessage` explained itself against `ourCalls`, and `474`'s
     * request sets explained themselves against `463` F2 and `ourCalls` too. ⛔ **Two halves that
     * reference each other are not a rule**, so `digest.ts` now carries one: *a collection keys
     * `(conversation, id)` unless EVERY id it can hold was minted by this process*.
     *
     * 🔴 **This is what makes it a rule rather than a paragraph.** Every keyed collection in the
     * fold has to be classified here, so a field added on the wrong side goes red instead of
     * silent — and the next dispatch decides from where its id comes from rather than from which
     * dispatch happened to write the neighbouring line.
     *
     * ⚠️ **The partition IS the control.** A writer this roster does not name fails, a name nothing
     * writes fails, and `groups` is carried explicitly as the one keyed collection keyed by a WORD
     * — so *"not an id"* is a decision this census records rather than a hole it has.
     */
    it('⛔ every keyed collection in the fold is BARE, PAIRED or a word, and nothing else', () => {
      const KEYED: Readonly<Record<string, 'bare' | 'paired' | 'a word'>> = {
        // ⚑ `work_<uuid>` and `msg_<uuid>`, minted in this process, and the conversation a pair
        // would have been made OF. ⚠️ `questionsAboutPiece` is keyed by the piece; what it HOLDS is
        // the pair `asked`, which the census above reads.
        given: 'bare',
        byMessage: 'bare',
        spokenFor: 'bare',
        questionsAboutPiece: 'bare',
        restartedIn: 'bare',
        // ⛔ A provider mints what these hold, and one id this app did not mint is enough.
        routed: 'paired',
        travelled: 'paired',
        ended: 'paired',
        questionsNamingWork: 'paired',
        ourCalls: 'paired',
        childMax: 'paired',
        childSeen: 'paired',
        // ⚠️ Not an id at all — a closed vocabulary of line kinds.
        groups: 'a word',
      }
      const digest = sourceOf('main', 'runtime', 'digest.ts')
      const writers = [...digest.matchAll(/tally\.([A-Za-z]+)\.(?:add|set)\((.*)$/gm)].map(
        ([, field, argument]) => ({ field: field ?? '', argument: argument ?? '' }),
      )
      expect([...new Set(writers.map((one) => one.field))].sort()).toEqual(
        Object.keys(KEYED).sort(),
      )

      for (const { field, argument } of writers) {
        // ⛔ **`childMax` and `childSeen` are written through `reportUsage`, whose PARAMETER is
        // named `key` and shadows the helper** — so their pair is asserted at the call sites that
        // build it, below, which is the census reading who BUILT the value rather than who holds
        // it.
        if (field === 'childMax' || field === 'childSeen') continue
        if (KEYED[field] === 'paired') {
          expect(
            argument.includes('key(row.sessionId,') || argument.startsWith('asked)'),
            `a request fact keyed on a bare id: ${field}`,
          ).toBe(true)
        }
        if (KEYED[field] === 'bare') {
          expect(argument, `an app-minted id paired for no reason: ${field}`).not.toContain('key(')
        }
      }

      const usages = [...digest.matchAll(/reportUsage\(tally, (.*)$/gm)].map(([, rest]) => rest)
      expect(usages).toHaveLength(2)
      for (const rest of usages) expect(rest).toContain('key(row.sessionId,')

      // ⚑ **Both sides are populated**, so neither loop above is passing over an empty filter.
      expect(writers.filter((one) => KEYED[one.field] === 'bare').length).toBeGreaterThan(1)
      expect(writers.filter((one) => KEYED[one.field] === 'paired').length).toBeGreaterThan(1)
    })

    /**
     * ⛔ **Why the BARE side is safe, asserted at the MINT** (474 relay 1) — `475`'s `byMessage` is
     * bare because `newQueuedMessageId` is `msg_<uuid4>` minted in the main process, and a piece is
     * `work_<uuid4>` minted there too — a claim about call sites rather than about a type.
     *
     * ⚠️ **Not covered by the `ids.ts` census above**: `newQueuedMessageId` does not live there, so
     * the one sentence holding up `475`'s key had no test at all until this relay.
     */
    it('⛔ `work_<uuid>` and `msg_<uuid>` are minted in this process, by nobody else', () => {
      const files = everySourceFileUnder(SRC)
      const calls = (
        name: string,
        sources = files.map((file) => ({ file, code: readFileSync(file, 'utf8') })),
      ): string[] =>
        sources
          .flatMap(({ file, code }) =>
            withoutProse(code)
              .split('\n')
              .filter((line) => line.includes(`${name}()`))
              .map(() => relative(SRC, file)),
          )
          .sort()

      // ⚑ **D-016 · the `work_` call sites**: the store mints a root in the transaction that writes
      // its conversation, and the host mints a piece a give hangs under it. ⚑ **D-016 · commit 6 —
      // a THIRD, still the host's**: a piece a conversation takes on for a person (`takeOnWork`),
      // numbered from its root's counter as a give is. ⛔ Both host sites are named by the method
      // that mints, below, so a fourth — or one moved out of the host — is a change this census sees.
      expect(calls('newWorkId')).toEqual([
        join('main', 'db', 'session-store.ts'),
        join('main', 'runtime', 'runtime-host.ts'),
        join('main', 'runtime', 'runtime-host.ts'),
      ])
      // ⚑ **D-017 · R1 — a SECOND `msg_` call site, and still the host's**: the words this app holds
      // for a conversation that is not running (`holdForTheNextStart`) get their id where every held
      // message does, so `byMessage`'s bare key still holds only ids this process minted. ⛔ Both
      // are named by the method that mints, so a fourth — or one moved out of the host — is a change
      // this census sees.
      // ⚑ **D-017 · R10 — a THIRD, still the host's**: what was held for a conversation that could
      // never be reopened is held again in the one that took its place (`handWhatItHeldTo`), under a
      // new id this process mints — the old row ends `abandoned` in the old ledger under its own.
      // ⚑ A FOURTH, still the host's: a give queued at a service names its brief by an id its give
      // carries, and nothing is held in a mailbox until that piece's turn.
      // Personal work queued at a service uses the same message allocator.
      expect(calls('newQueuedMessageId')).toEqual([
        join('main', 'runtime', 'runtime-host.ts'),
        join('main', 'runtime', 'runtime-host.ts'),
        join('main', 'runtime', 'runtime-host.ts'),
        join('main', 'runtime', 'runtime-host.ts'),
        join('main', 'runtime', 'runtime-host.ts'),
      ])
      const host = sourceOf('main', 'runtime', 'runtime-host.ts')
      const minting = (from: string, to: string): string =>
        host.slice(host.indexOf(from), host.indexOf(to, host.indexOf(from)))
      expect(minting('private async queueAs(', '\n  }\n')).toContain('newQueuedMessageId()')
      // The words this app holds for a conversation get their id where they are built
      // (`wordsThisAppHolds`), for a conversation that is not running and for a stop that hands on
      // a reopen's words alike.
      expect(minting('private wordsThisAppHolds(', '\n  }\n')).toContain('newQueuedMessageId()')
      expect(minting('private handWhatItHeldTo(', '\n  }\n')).toContain('newQueuedMessageId()')
      expect(minting('async giveWork(', '\n  }\n')).toContain('newQueuedMessageId()')
      expect(minting('async giveWork(', '\n  }\n')).toContain('newWorkId()')
      expect(minting('\n  async takeOnWork(', '\n  }\n')).toContain('newQueuedMessageId()')
      expect(minting('\n  async takeOnWork(', '\n  }\n')).toContain('newWorkId()')
      expect(sourceOf('main', 'runtime', 'queued-message.ts')).toContain('`msg_${randomUUID()}`')

      // Event ids now have one allocator after removal of the raw transcript copy.
      expect(calls('newEventId')).toEqual([join('main', 'db', 'session-store.ts')])
      // The same search still reports two calls rather than stopping at the first match.
      const fixture = join(SRC, 'fictional.ts')
      expect(calls('newEventId', [{ file: fixture, code: 'newEventId()\nnewEventId()' }])).toEqual([
        'fictional.ts',
        'fictional.ts',
      ])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the edge, carried to the person
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the edge, carried', () => {
    /**
     * 🔴 **F4's whole property, end to end through the real reader.** A worker holding two pieces of
     * work asks its parent about ONE of them; the person's queue names that one.
     *
     * ⛔ **Two pieces, because one proves nothing.** `463` §11 lists *"This is about #5/#1/#4 when
     * only one task happened to be open"* as a sentence it was tempted to write —
     * `a-comparison-tested-where-both-sides-agree`. ⚑ With two open, naming the right one is a
     * measurement.
     */
    it('🔴 a question that named its work says which work, by the label a person quotes', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      give('sess_worker', 'work_b', 'W5.4', FROM + 11)
      askedAboutWork('sess_worker', 'req_asked', 'work_b', 'W5.4', FROM + 20)

      const row = rowFor('req_asked')
      expect(row.about).toEqual({
        is: 'the-asker-named-it',
        work: { label: 'W5.4' },
      })
      // ⛔ **The conversation's other work is still carried** — its own root first, then what it
      // holds — because a person moving a blocked conversation wants to see everything it is
      // holding. ⚠️ The edge is an addition, not a narrowing.
      expect(row.work.map((one) => one.label)).toEqual([rootLabel('sess_worker'), 'W5.3', 'W5.4'])
    })

    /**
     * ⛔ **The honest sentence `463` F4 told us to keep.** A provider-raised question names no piece
     * and never can, and this arm must go on saying so — measured beside the arm above, in the same
     * conversation, with the same two open pieces.
     */
    it('⛔ a provider-raised question still says nothing recorded which work it is about', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      give('sess_worker', 'work_b', 'W5.4', FROM + 11)
      askedAboutWork('sess_worker', 'req_asked', 'work_b', 'W5.4', FROM + 20)
      providerAsked('sess_worker', 'number:1', FROM + 30)

      expect(rowFor('number:1').about).toEqual({ is: 'nothing-recorded-it' })
      // 🔴 **Both rows, one conversation, two different answers** — which is the divergence that
      // makes the pair a measurement rather than a label.
      expect(rowFor('req_asked').about.is).toBe('the-asker-named-it')
    })

    /**
     * 🔴 **The third arm, and the reason there are three.** A row that NAMES work this read cannot
     * place is not a row that named nothing: folding the two together would report this app's own
     * short read as a fact about the ledger.
     *
     * ⛔ **Reachable without a defect**: `importBundle` takes a conversation's events without its
     * whole history, and `derivePieces` skips a give it cannot parse. ⚑ Here the give simply is not
     * in the ledger, which is what either of those leaves behind.
     */
    it('🔴 a named task nothing answers to is not the same answer as a question that named none', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      askedAboutWork('sess_worker', 'req_ghost', 'work_that_was_never_given', 'W5.9', FROM + 20)
      providerAsked('sess_worker', 'number:1', FROM + 30)

      expect(rowFor('req_ghost').about).toEqual({ is: 'named-work-nothing-answers-to' })
      expect(rowFor('number:1').about).toEqual({ is: 'nothing-recorded-it' })
      // ⛔ **Three arms, three sentences, and none of them is another's.**
      expect(new Set(Object.values(ABOUT_WORK_SAYS)).size).toBe(3)
    })

    /**
     * ⛔ **A question ends with the piece it is about**, a hand-back included: it leaves the
     * person's queue, as a take-back's and a close's do. ⚑ The asker's own record of it still names
     * the piece it was asked under.
     */
    it('⛔ a question about work that has since been handed back ends with it, and its record still names the piece', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      askedAboutWork('sess_worker', 'req_asked', 'work_a', 'W5.3', FROM + 20)
      at('sess_worker', FROM + 40, {
        type: 'work_replied',
        piece: 'work_a',
        outcome: 'done',
        summary: 'shipped',
        resources: [],
      })

      expect(
        store.routedRequestsOf('sess_worker').find((one) => one.requestId === 'req_asked')?.state,
      ).toBe('work-replied')
      expect(
        host.questionsForAPerson().rows.find((one) => one.request.requestId === 'req_asked'),
      ).toBeUndefined()
      expect(store.questionsRaisedIn('sess_worker').get('req_asked')?.piece).toBe('work_a')
    })

    /**
     * 🔴 **The fold reads the WORK before the word** — `471`'s `folderIsOf` instinct, on this axis.
     * ⛔ A caller cannot talk the fold into the strong arm, and the failing direction is always the
     * weaker claim.
     */
    it('⛔ the arm is chosen by what was FOUND, never by what the caller named', () => {
      const found = { label: 'W1.7' }
      expect(aboutTheWork('work_a', () => found)).toEqual({ is: 'the-asker-named-it', work: found })
      // ⛔ A named id that resolves to nothing cannot become the strong arm…
      expect(aboutTheWork('work_a', () => null)).toEqual({ is: 'named-work-nothing-answers-to' })
      // …and an unnamed one never calls `find` at all, so it cannot be handed work either.
      let asked = 0
      expect(
        aboutTheWork(null, () => {
          asked += 1
          return found
        }),
      ).toEqual({ is: 'nothing-recorded-it' })
      expect(asked, 'the fold looked for work nothing had named').toBe(0)
      // ⚑ **The population that cannot name work is DERIVED and never spelled** — a permission
      // reaches the queue through this constant (and a proposal did, until D-016).
      expect(NOTHING_NAMED_THE_WORK).toEqual({ is: 'nothing-recorded-it' })
    })

    /**
     * ⛔ **The disagreeing pair is unconstructable, which is the point of the union.** ⚠️ Type-level
     * refusals with the positive controls that make them mean something.
     */
    it('⛔ work standing under the wrong word does not compile', () => {
      const workless = (): AboutWork => {
        // @ts-expect-error — `the-asker-named-it` is the only arm that has a `work` field.
        const value: AboutWork = { is: 'the-asker-named-it' }
        return value
      }
      const misplaced = (): AboutWork => {
        const value: AboutWork = {
          is: 'nothing-recorded-it',
          // @ts-expect-error — `nothing-recorded-it` has no `work` field to carry one.
          work: { label: 'W1.1' },
        }
        return value
      }
      expect(workless).toBeTypeOf('function')
      expect(misplaced).toBeTypeOf('function')
      // ⚑ **The positive controls**: both legal shapes still compile and still differ.
      const named: AboutWork = { is: 'the-asker-named-it', work: { label: 'W1.1' } }
      const none: AboutWork = { is: 'nothing-recorded-it' }
      expect(named.is).not.toBe(none.is)
      const everyWord: AboutWorkIs[] = [
        'the-asker-named-it',
        'named-work-nothing-answers-to',
        'nothing-recorded-it',
      ]
      expect(Object.keys(ABOUT_WORK_SAYS).sort()).toEqual([...everyWord].sort())
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · which reader was doing the wrong thing
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · why the edge reached the digest and not the person', () => {
    /**
     * 🔴 **The answer to §3.3, and it is one reader's defect.**
     *
     * ⛔ **The digest was right.** `466` read `question_asked.taskId` straight off the ledger row in
     * `distil`'s own fold, so nothing stood between the write and that reader.
     *
     * 🔴 **The person's reader never asked for the column.** `questionsForAPerson` answers *which
     * work* out of `SessionStore.piecesOwnedBy`, and the only place it could have learned a
     * question's subject is `questionsRaisedIn` — whose SELECT listed `id`, `prompt` and `questions`
     * and **not the work**. ⚠️ **So the value did not survive as far as the fold that discarded it**: it was
     * dropped in SQL, one layer below the reader `463` blamed, and the surface then stated an
     * absence about a fact the database was holding.
     *
     * ⚑ **Both halves are censused here**, because the repair is a SELECT and a SELECT is the
     * easiest thing in this app to quietly narrow again.
     */
    it('🔴 the store read now selects the piece, which is where the value used to fall out', () => {
      const ledger = sourceOf('main', 'db', 'session-store.ts')
      const select = ledger.slice(
        ledger.indexOf('const selectQuestionsRaised'),
        ledger.indexOf('const selectLastTurnEndingEvents'),
      )
      expect(select).not.toBe('')
      expect(select).toContain("json_extract(payload, '$.piece') AS piece")
      expect(select).toContain("type IN ('user_input_request', 'question_asked')")
      // ⚑ **And the reader puts it on the row** rather than selecting a column nobody reads.
      expect(ledger).toContain('piece: row.piece,')
    })

    it('⛔ the person’s reader reads the question row, and asks the ASKER for it', () => {
      const runtime = sourceOf('main', 'runtime', 'runtime-host.ts')
      const method = runtime.slice(
        runtime.indexOf('questionsForAPerson(): LedgerWalk<PersonsQuestion>'),
        runtime.indexOf('questionsAPersonMayNotDelegate'),
      )
      expect(method).not.toBe('')
      expect(method).toContain('raisedIn(request.askedBy).get(request.requestId)')
      expect(method).toContain('workNamed(pieces(request.askedBy), id)')
      // ⛔ **One ledger read per asker, not two** — the memo is shared by both folds.
      expect(method).toContain('this.onePieceReadPerAnswer()')
      expect(method).toContain('this.oneWorkReadPerAnswer(pieces)')
    })

    /**
     * ⚑ **The digest's arm is unchanged and is asserted so** — `463` F4 says the edge *"survives to
     * one reader"*, and a dispatch that repaired the other one must not have moved this.
     */
    it('⚑ the digest still draws the edge, and still draws no question', () => {
      conversation('sess_worker')
      give('sess_worker', 'work_a', 'W5.3', FROM + 10)
      askedAboutWork('sess_worker', 'req_asked', 'work_a', 'W5.3', FROM + 20)
      const drawn = distil(store.digestWindow(FROM, TO), (id) => id)
      const line = drawn.lines.find((one) => one.kind === 'question-about-work')
      expect(line?.count).toBe(1)
      expect(line?.text).toContain('W5.3')
      // ⛔ The words are still nowhere in it — `digest.ts`' own ruling.
      expect(JSON.stringify(drawn)).not.toContain('which database?')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the transcript projection, and what this dispatch did NOT write
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the transcript projection', () => {
    const ASKED: Extract<TranscriptEvent, { type: 'question_asked' }> = {
      type: 'question_asked',
      requestId: 'req_asked',
      piece: 'work_a',
      label: 'W5.3',
      prompt: 'which database?',
      questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
    }

    const GIVEN: TranscriptEvent = {
      type: 'work_given',
      piece: 'work_a',
      label: 'W5.3',
      parent: 'work_parents_root',
      givenBy: 'sess_parent',
      title: 'migrate the schema',
      brief: 'migrate the schema',
    }

    /**
     * 🔴 **The other reader `463` F4 named.** ⛔ The question's WORDS are still not drawn — they are
     * on the `ask_parent` call in this transcript and again in the parent's — and the EDGE is,
     * because nothing on this page said which work the conversation stopped over.
     */
    it('🔴 the transcript names the work a question is about', () => {
      const state = createTranscript()
      applyEvent(state, GIVEN)
      applyEvent(state, ASKED)
      expect(state.items).toHaveLength(1)
      const item = state.items[0]
      expect(item?.kind).toBe('notice')
      const text = item?.kind === 'notice' ? item.text : ''
      expect(text).toContain('W5.3')
      // ⛔ **Still no question**: the ruling `437` wrote about the words is untouched.
      expect(text).not.toContain('which database?')
    })

    /**
     * ⛔ **The honest absence, and it is the digest's own rule for the same edge** (`466`: *"the
     * honest absence of it"*). ⚑ **D-016 · the question row carries its piece's label**, so a
     * question about work older than the retained suffix still names it; a row that carries no
     * readable label names no piece rather than a wrong one.
     */
    it('⛔ a question whose row carries no label names no piece', () => {
      const state = createTranscript()
      const unlabelled: TranscriptEvent = {
        type: 'question_asked',
        requestId: ASKED.requestId,
        piece: 'work_a',
        prompt: ASKED.prompt,
        questions: ASKED.questions,
      }
      applyEvent(state, unlabelled)
      const item = state.items[0]
      const text = item?.kind === 'notice' ? item.text : ''
      expect(text).toBe('asked about a piece of work')
      expect(text).not.toContain('W5')
      // ⚑ **The pair, where the two readings diverge**: the same row with and without its label
      // says two different things, so neither sentence is a constant.
      const withIt = createTranscript()
      applyEvent(withIt, ASKED)
      const other = withIt.items[0]
      expect(other?.kind === 'notice' ? other.text : '').not.toBe(text)
    })

    /**
     * ⛔ **The give still draws nothing** — `379`'s ruling, which `474` did not reopen. ⚑ What it
     * leaves behind is the piece's label and title.
     */
    it('⛔ the assignment is still ledger-only, and only leaves the label behind', () => {
      const state = createTranscript()
      applyEvent(state, GIVEN)
      expect(state.items).toEqual([])
      expect(state.piecesGiven.get('work_a')).toEqual({
        label: 'W5.3',
        title: 'migrate the schema',
      })
    })

    /**
     * 🔴 **No schema change, and it is stated rather than inferred** (§2's fourth trap). ⛔ A new
     * durable write under userData owes `clean-base` a decision; this dispatch makes none, so the
     * decision is *nothing is owed* and this is the line that keeps it true.
     */
    it('🔴 no migration, no column and no new durable write', () => {
      const schema = sourceOf('main', 'db', 'schema.ts')
      for (const spelling of ['about_work', 'aboutWork', 'named_work', 'question_task']) {
        expect(schema, `474 grew a column: ${spelling}`).not.toContain(spelling)
      }
      // 🔴 **500 · and over every migration.** ⛔ What `474` promised is that it wrote no column,
      // whichever number a migration carries — since D-016 the one that builds the tree, `0000`, and
      // whatever lands after it.
      const everySql = readdirSync(MIGRATIONS)
        .filter((name) => name.endsWith('.sql'))
        .map((name) => readFileSync(join(MIGRATIONS, name), 'utf8'))
      expect(everySql.length).toBeGreaterThanOrEqual(1)
      for (const sql of everySql) {
        for (const spelling of ['about_work', 'named_work', 'question_task']) {
          expect(sql, `474 grew a column: ${spelling}`).not.toContain(spelling)
        }
      }
      // ⚑ **The control, because four absences prove nothing without one presence**: the census is
      // reading the real schema and the real folder.
      expect(schema).toContain('export const work = sqliteTable(')
      expect(readdirSync(MIGRATIONS).some((name) => name.startsWith('0000'))).toBe(true)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the pure folds this rests on
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · `workNamed`, beside the predicate it deliberately does not ask', () => {
    const tasks = (): ReturnType<typeof derivePieces> =>
      derivePieces('sess_worker', [
        {
          ordinal: 0,
          at: FROM,
          event: {
            type: 'work_given',
            piece: 'work_open',
            label: 'W5.1',
            parent: 'work_parents_root',
            givenBy: 'sess_parent',
            title: 'one',
            brief: 'one',
          },
        },
        {
          ordinal: 1,
          at: FROM + 1,
          event: {
            type: 'work_given',
            piece: 'work_done',
            label: 'W5.2',
            parent: 'work_parents_root',
            givenBy: 'sess_parent',
            title: 'two',
            brief: 'two',
          },
        },
        {
          ordinal: 2,
          at: FROM + 2,
          event: {
            type: 'work_replied',
            piece: 'work_done',
            outcome: 'done',
            summary: 'shipped',
            resources: [],
          },
        },
      ] satisfies PersistedEventInfo[])

    it('⛔ it finds ENDED work, which `openWorkOf` filters out', () => {
      const rows = tasks()
      expect(openWorkOf(rows).map((one) => one.label)).toEqual(['W5.1'])
      expect(workNamed(rows, 'work_done')).toEqual({ label: 'W5.2' })
      expect(workNamed(rows, 'work_open')).toEqual({ label: 'W5.1' })
      // ⛔ An id nothing answers to is `null` and never a guess at the only row.
      expect(workNamed(rows, 'work_nobody_gave')).toBeNull()
      // ⚑ The control that plants TWO: with one piece the line above would pass for a fold that
      // always returned its single row.
      expect(rows).toHaveLength(2)
    })
  })
})
