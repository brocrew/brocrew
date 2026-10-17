import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type FakeSessionHandle,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { distil } from '../src/main/runtime/digest'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { HAND_CARRIED, V23_FIELD_MAP } from '../src/renderer/src/lib/design-v2-map'
import {
  applyEvent,
  createTranscript,
  markReadOnly,
  type PermissionItem,
  type TranscriptState,
  type UserInputItem,
} from '../src/renderer/src/lib/transcript'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import {
  WHO_DID_IT,
  WHO_DID_IT_SAYS,
  didIt,
  nothingRecordsWho,
  whoAnsweredIt,
  type ActedBy,
} from '../src/shared/who-did-it'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **503 · who answered it** — HO-037 §2, landed.
 *
 * > ⚑ *"The Requests surface shows who answered."*
 * >
 * > ⛔ *"My* omit the row entirely, do not add the label anywhere *rested on one premise —*
 * > nothing records who decided. *`477` ended that premise, so the ruling dies with it rather than
 * > needing to be argued down."*
 * >
 * > ⚠️ *"A person can only ever have answered a permission, but a question may have been answered
 * > by a parent agent. So the actor is what distinguishes* I decided this *from* the project
 * > manager handled it *— which is the escalation picture, on the surface where the escalation
 * > lands."*
 *
 * ## ⛔ What each section is for
 *
 *  - **§1** — is `494` F2 right? ⚠️ **The brief cites `494` and a docblock, which is two claims and
 *    no measurement**, so this asks the code twice: a census over every production writer of
 *    `user_decision`, and the two doors driven for real. 🔴 **The two doors are where the readings
 *    DIVERGE** — the same event type, answered by a window and by a parent agent, producing two
 *    different words — which is standing rule 3 and the reason `463` F1 existed at all.
 *  - **§2** — the fold. The actor reaches the item off the row that set the outcome, and off
 *    nothing else; and the THIRD population — a card a teardown settled — carries no actor and no
 *    ledger gap either.
 *  - **§3** — the words. `WHO_DID_IT_SAYS`' vocabulary, `465`'s sentence for the absence with the
 *    digest composing the same bytes, and the conversation id kept off the surface a person reads.
 *  - **§4** — the map, which `494` F2 found carrying two sentences that went false at `477`.
 *
 * ## ⚑ The instruments are production doors
 *
 * ⛔ **Except the one population no door can produce**: a row written before this app recorded an
 * actor. It is planted, for `477`'s own stated reason — manufacturing it by deleting the field
 * afterwards would be a fixture built out of the thing under test.
 *
 * ⚑ The provider is a double, every directory is temporary, and no live app, port, provider home
 * or `auth.json` is touched.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')

const HOUR = 3_600_000
const FROM = 1_800_000_000_000
const TO = FROM + 12 * HOUR
const INSIDE = FROM + 6 * HOUR

/** A window sink: `aPersonIsBehindIt` is what the person's answer door reads (`340`, `349`). */
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

/** Keep the provider handles, so a card can be raised through the real path. */
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
  override async resume(ref: SessionRef, options: ResumeOptions): Promise<FakeSessionHandle> {
    const handle = await super.resume(ref, options)
    this.handles.push(handle)
    return handle
  }
}

/* ------------------------------------------------------------------ the census's search shape */

/**
 * ⛔ **Prose stripped before anything is counted.** This file's subject is a docblock that stayed
 * true-looking for a month, and `runtime-host.ts` quotes `type: 'user_decision'` in comments about
 * the writers — `a-source-census-must-strip-prose-before-it-asserts`.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * ⛔ **Every production source in the tree**, and the breadth is the point: *a negative is only as
 * strong as the search shape*. ⚠️ A walk of `src/main` alone would have answered *"five, all in
 * `runtime-host.ts`"* by construction — it is the only place it looked.
 *
 * ⚑ Test files are excluded and nothing else is: the renderer, the shared layer and both runtime
 * packages are all searched, so a writer appearing anywhere is a red row rather than a blind spot.
 */
function everyProductionSource(): { name: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? entry.name === 'node_modules' || entry.name === 'dist'
          ? []
          : walk(`${dir}/${entry.name}`)
        : /\.(ts|vue)$/.test(entry.name)
          ? [`${dir}/${entry.name}`]
          : [],
    )
  const roots = [
    SRC,
    join(here, '../../../packages/runtime/src'),
    join(here, '../../../packages/shared/src'),
    join(here, '../../../packages/orchestration/src'),
  ]
  return roots
    .flatMap((root) => walk(root).map((path) => ({ root, path })))
    .map(({ root, path }) => ({
      name: path.slice(root.length + 1),
      source: code(readFileSync(path, 'utf8')),
    }))
}

/**
 * Every object literal in `source` that opens with `type: 'user_decision'`, as the text from that
 * key to the end of the literal.
 *
 * ⚠️ **The slice ends at the literal's own closing brace, counted** — a fixed-width slice runs into
 * the next region and would read a neighbouring call's `by`.
 */
function decisionLiterals(source: string): string[] {
  const found: string[] = []
  const key = "type: 'user_decision',"
  for (let from = source.indexOf(key); from !== -1; from = source.indexOf(key, from + 1)) {
    let depth = 1
    let cursor = from + key.length
    while (cursor < source.length && depth > 0) {
      if (source[cursor] === '{') depth++
      else if (source[cursor] === '}') depth--
      cursor++
    }
    found.push(source.slice(from, cursor))
  }
  return found
}

describe('503 · who answered it', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let clock: number
  let counter: number
  let handles: FakeSessionHandle[]
  let window: RecordingSink
  let ordinals: Map<string, number>

  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-503-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-503-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = INSIDE
    counter = 0
    handles = []
    ordinals = new Map()
    const sessions = new FakeProviderSessions()
    store = createSessionStore(db, tick)
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, sessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_503_${String(++counter)}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    window = new RecordingSink('webContents:503')
    // ⚑ **D-016** — the two projects this file placed its conversations in (`who`, `old`) went with
    // projects; the digest reads one window, and §3's is planted with the one conversation it reads.
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  const at = (id: string, when: number, event: TranscriptEvent): void => {
    const ordinal = ordinals.get(id) ?? 0
    ordinals.set(id, ordinal + 1)
    store.append(id, ordinal, event, when)
  }

  const callOn = async (
    tools: AgentToolset,
    name: ToolName,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = tools.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    // ⛔ **Bounded, and it reports rather than hangs** (standing rule 13).
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const decisionsIn = (sessionId: string): TranscriptEvent[] =>
    store
      .events(sessionId)
      .map(({ event }) => event)
      .filter((event) => event.type === 'user_decision')

  const opened = async (profileId: string): Promise<string> => {
    const created = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', cwd: root },
      window,
    )
    return created.sessionId
  }

  const liveHandle = (): FakeSessionHandle => {
    const handle = handles.at(-1)
    if (handle === undefined) throw new Error('the conversation received no provider handle')
    return handle
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · is `494` F2 right — the actor is on the row, from every producer
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the row', () => {
    it('⛔ every production writer of `user_decision` derives the actor from its CALLER', () => {
      const writers = everyProductionSource().flatMap(({ name, source }) =>
        decisionLiterals(source).map((literal) => ({ name, literal })),
      )
      // ⚑ **The walk really did leave its own root** — without this the list below could be five
      // because the search only ever entered one directory.
      expect(everyProductionSource().length).toBeGreaterThan(200)
      // ⚑ **Pinned, because a writer ADDED without the field is exactly the regression this
      // guards** — and a count of "more than zero" would pass over one.
      //
      // ⚑ **D-017 · R6 — one shorter, and not because a door lost its row**: every decision on a
      // question THIS APP asked — an agent's answer or decline, a person's answer or decline — is
      // written by ONE writer now (`decideAQuestionThisAppAsked`, into the asker's ledger whether or
      // not it is running), where each door used to spell its own.
      expect(writers.map((one) => one.name)).toEqual([
        'main/runtime/move-request.ts',
        'main/runtime/runtime-host.ts',
        // ⚑ **D-009** — an agent saying it cannot answer a PROVIDER's question, from its caller too.
        'main/runtime/runtime-host.ts',
        'main/runtime/runtime-host.ts',
        'main/runtime/runtime-host.ts',
        'main/runtime/runtime-host.ts',
        'main/runtime/runtime-host.ts',
      ])
      for (const { name, literal } of writers) {
        if (name === 'main/runtime/move-request.ts') {
          expect(literal).toContain('by,')
          const helper = code(
            readFileSync(join(here, '../src/main/runtime/move-request.ts'), 'utf8'),
          )
          expect(helper).toContain("if (by.who !== 'a-person') throw")
          const host = code(readFileSync(join(here, '../src/main/runtime/runtime-host.ts'), 'utf8'))
          expect(host).toMatch(/recordMovedRequest\([\s\S]*?whoDidIt\(by\)/)
        } else {
          expect(literal, `${name} writes a decision row with no actor`).toContain('by: whoDidIt(')
        }
        // ⛔ **From the CALLER and never from the payload** — `MessageSentEvent.onBehalfOfAPerson`'s
        // standard. ⚑ The stronger half of this — that no tool and no IPC payload HAS a field a
        // caller could say it with — is `who-did-it.test.ts` §2's, asserted against the type; this
        // is the shape check that no writer reached for one anyway.
        expect(literal, `${name} takes the actor from a payload`).not.toMatch(/by:\s*input\./)
      }

      // ⚑ **The control, and it is what stops the loop above being a formality**: the shape CAN
      // find a literal that omits the field, and it stops at the literal's own brace rather than
      // running into a neighbour that happens to have one.
      const planted =
        "this.publishOurs(s, {\n  type: 'user_decision',\n  requestId: r,\n  outcome: 'allow',\n})\n" +
        "this.publishOurs(s, {\n  type: 'user_decision',\n  outcome: 'allow',\n  by: whoDidIt(by),\n})"
      const slices = decisionLiterals(planted)
      expect(slices.length).toBe(2)
      expect(slices[0]).not.toContain('by: whoDidIt(')
      expect(slices[1]).toContain('by: whoDidIt(')

      // …and the strip really removes prose, so a comment quoting the key is not counted as a
      // sixth writer.
      expect(decisionLiterals(code("// type: 'user_decision', by: whoDidIt(by)\n"))).toEqual([])
    })

    it('🔴 a PERSON answers a permission and a PARENT AGENT answers a question — two words, one event type', async () => {
      // ⛔ **The divergence, and it is the PO's whole reason.** A permission can only ever have
      // been answered by a person; a routed question can have been answered by the parent. Both
      // write `user_decision`, so a surface reading only one of the two doors would report a word
      // it had never seen vary.

      // ── a person, at a permission card, through the window door
      const asking = await opened('person')
      const card = liveHandle().simulatePermission('perm_1', {
        action: 'Bash',
        detail: 'run: ls',
        availableDecisions: ['allow', 'deny'],
      })
      expect(await host.respondPermission(asking, 'perm_1', { outcome: 'allow' }, window)).toEqual({
        outcome: 'taken',
      })
      await expect(card).resolves.toMatchObject({ outcome: 'allow' })
      expect(decisionsIn(asking)).toEqual([
        { type: 'user_decision', requestId: 'perm_1', outcome: 'allow', by: { who: 'a-person' } },
      ])

      // ── a parent agent, at its worker's routed question, through the agent door
      // ⚑ **D-016** — the worker is started by a give: its brief is its first turn.
      const worker0 = await opened('worker')
      await host.close(worker0, window)
      const parent = await opened('parent')
      const spawned = await callOn(agentToolsFor(host, parent), 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'Raise the question',
        brief: 'raise the question whose answerer is under test',
      })
      expect(spawned.outcome, JSON.stringify(spawned)).toBe('ok')
      const worker = spawned.agent as string
      const asked = liveHandle().simulateUserInput('Which database?', ['Postgres', 'SQLite'])
      await waitFor(
        () =>
          store
            .events(worker)
            .some(({ event }) => event.type === 'request_routed' && event.requestId === asked.id),
        'the worker question to route to its parent',
      )
      const answered = await host.answerQuestion(
        { questionId: asked.id, answers: [{ part: 'q0', answer: ['Postgres'] }] },
        { ownerId: `agent:${parent}` },
      )
      expect(answered.ok, JSON.stringify(answered)).toBe(true)
      expect(decisionsIn(worker)).toEqual([
        {
          type: 'user_decision',
          requestId: asked.id,
          outcome: 'answered',
          // ⚑ **The parent's SESSION id**, which is the arm's own rule — a reader joins the row to
          // that conversation's ledger rather than having to know how a caller id is spelled.
          by: { who: 'an-agent', agent: parent },
        },
      ])

      // 🔴 **The two words differ**, which is the measurement: without this the pair above would be
      // two spellings of whatever the last door happened to write.
      const words = [decisionsIn(asking), decisionsIn(worker)].map(
        (rows) => (rows[0] as { by?: ActedBy }).by?.who,
      )
      expect(words).toEqual(['a-person', 'an-agent'])
    })

    it('⚠️ a person answering the same QUESTION writes `a-person` — so the word tracks the door, not the kind', async () => {
      // ⛔ **The cell one fact over from the agent's.** Without it, `an-agent` above could be a
      // property of questions rather than of who answered one.
      const sessionId = await opened('person-question')
      const asked = liveHandle().simulateUserInput('Which database?', ['Postgres', 'SQLite'])
      expect(
        await host.respondUserInput(
          sessionId,
          asked.id,
          { kind: 'answer', answers: { q0: ['Postgres'] } },
          window,
        ),
      ).toEqual({ outcome: 'taken' })
      await expect(asked.answered).resolves.toMatchObject({ kind: 'answer' })
      expect(decisionsIn(sessionId)).toEqual([
        {
          type: 'user_decision',
          requestId: asked.id,
          outcome: 'answered',
          by: { who: 'a-person' },
        },
      ])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the fold — the item says what the row says, and nothing more
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the fold', () => {
    const CARD: TranscriptEvent = {
      type: 'permission_request',
      id: 'req_1',
      kind: 'command',
      action: 'Bash',
      detail: 'run: ls',
      scope: {
        cwd: '/work',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny'],
        underDisclosed: false,
      },
    } as never

    const QUESTION: TranscriptEvent = {
      type: 'user_input_request',
      id: 'ui_1',
      prompt: 'AskUserQuestion',
      questions: [{ id: 'q0', prompt: 'Which one?', options: [{ label: 'a' }, { label: 'b' }] }],
    } as never

    const fold = (...events: TranscriptEvent[]): TranscriptState => {
      const state = createTranscript()
      for (const event of events) applyEvent(state, event)
      return state
    }

    const permissionIn = (state: TranscriptState): PermissionItem => {
      const item = state.items.find((one) => one.kind === 'permission')
      expect(item, 'the fold built no permission card').toBeDefined()
      return item as PermissionItem
    }

    const questionIn = (state: TranscriptState): UserInputItem => {
      const item = state.items.find((one) => one.kind === 'userInput')
      expect(item, 'the fold built no question card').toBeDefined()
      return item as UserInputItem
    }

    it('⛔ the actor arrives with the outcome, on both card kinds', () => {
      const permission = permissionIn(
        fold(CARD, {
          type: 'user_decision',
          requestId: 'req_1',
          outcome: 'deny',
          by: { who: 'a-person' },
        } as never),
      )
      expect(permission.outcome).toBe('deny')
      expect(permission.by).toEqual({ who: 'a-person' })

      const question = questionIn(
        fold(QUESTION, {
          type: 'user_decision',
          requestId: 'ui_1',
          outcome: 'answered',
          by: { who: 'an-agent', agent: 'sess_parent' },
        } as never),
      )
      expect(question.answered).toBe('answered')
      expect(question.by).toEqual({ who: 'an-agent', agent: 'sess_parent' })
    })

    it('🔴 a row written before `477` leaves the field absent — and the card still says it was answered', () => {
      // ⛔ **The one population no door can produce**, planted for that reason (HO-029 §2.2).
      const permission = permissionIn(
        fold(CARD, { type: 'user_decision', requestId: 'req_1', outcome: 'allow' } as never),
      )
      expect(permission.outcome).toBe('allow')
      expect(permission.by).toBeUndefined()
      // ⚑ …and the surface has a sentence for exactly this, rather than a blank.
      expect(whoAnsweredIt(permission.by)).toBe('Nothing in the ledger records who answered it')
    })

    it('⛔ a card a TEARDOWN settled carries no actor and no ledger gap — it is a third population', () => {
      // 🔴 **The distinction the cards are keyed on.** `settled`/`answered` is true of a card
      // nobody ever answered; drawing either arm over it would be this app stating something that
      // is not true of it. ⚠️ Through the real door — `markReadOnly` — and not by hand.
      const state = fold(CARD, QUESTION)
      markReadOnly(state, 'settled when this conversation was last open')
      const permission = permissionIn(state)
      const question = questionIn(state)
      expect(permission.note).toBe('settled when this conversation was last open')
      expect(permission.outcome).toBeNull()
      expect(permission.by).toBeUndefined()
      expect(question.answered).toBeNull()
      expect(question.by).toBeUndefined()
    })

    it('⚠️ a second decision on the same request cannot leave the first one’s actor behind', () => {
      // ⛔ **`by` is assigned whether or not the row names anybody**, which is `whoCancelledIt`'s
      // own rule one subject over. Written conditionally, a card would keep an actor from a row
      // that has been superseded by one that names nobody — the app attributing a decision to
      // somebody the ledger does not.
      const state = fold(CARD, {
        type: 'user_decision',
        requestId: 'req_1',
        outcome: 'allow',
        by: { who: 'a-person' },
      } as never)
      expect(permissionIn(state).by).toEqual({ who: 'a-person' })
      applyEvent(state, {
        type: 'user_decision',
        requestId: 'req_1',
        outcome: 'deny',
      } as never)
      expect(permissionIn(state).outcome).toBe('deny')
      expect(permissionIn(state).by).toBeUndefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the words
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the words', () => {
    it('⛔ every member of the vocabulary gets a clause, and it is the vocabulary’s own sentence', () => {
      for (const word of WHO_DID_IT) {
        const actor = (
          word === 'an-agent' ? { who: word, agent: 'sess_x' } : { who: word }
        ) as ActedBy
        const said = whoAnsweredIt(actor)
        expect(said, word).toBe(`by ${WHO_DID_IT_SAYS[word]}`)
        // ⚑ Never a blank, and never the word `undefined` — which is what indexing the table with
        // a word this build has no sentence for produces.
        expect(said, word).not.toContain('undefined')
      }
      // ⚑ **The control**: the clause is capable of differing between members, so the loop is a
      // measurement rather than a shape check.
      expect(new Set(WHO_DID_IT.map((word) => whoAnsweredIt({ who: word } as ActedBy))).size).toBe(
        WHO_DID_IT.length,
      )
    })

    it('🔴 the conversation’s id stays on the Events tab and off the card', () => {
      // ⛔ **`413 §4`, restated in `describe-event.ts`**: *"the id is printed HERE and nowhere a
      // person reads"*. ⚑ Two phrasings over one vocabulary, and the difference between them IS
      // the rule — so both are asserted, in the same cell, where they diverge.
      const actor: ActedBy = { who: 'an-agent', agent: 'sess_the_parent' }
      expect(whoAnsweredIt(actor)).toBe('by an agent')
      expect(whoAnsweredIt(actor)).not.toContain('sess_the_parent')
      expect(didIt(actor)).toBe('sess_the_parent')
      // …and the Events tab really does draw it, so this is a claim about the product.
      expect(
        describeEvent({
          type: 'user_decision',
          requestId: 'req_1',
          outcome: 'allow',
          by: actor,
        } as never),
      ).toContain('sess_the_parent')
    })

    it('⛔ `465`’s sentence has ONE source of bytes, and the digest composes it from there', async () => {
      // ⚑ **The card and the digest describe the same population.** Two composers would be two
      // chances to disagree about the fact this app has to be most careful with.
      expect(whoAnsweredIt(undefined)).toBe(nothingRecordsWho('answered', 1))
      expect(whoAnsweredIt(undefined)).toBe('Nothing in the ledger records who answered it')

      // 🔴 **The digest, driven — a window holding only rows written before `477`.**
      store.create({
        id: 'sess_old',
        provider: 'codex',
        cwd: root,
        approvalMode: 'ask',
        profileId: 'sess_old',
      })
      at('sess_old', INSIDE, {
        type: 'user_decision',
        requestId: 'req_before_477',
        outcome: 'allow',
      } as never)
      const digest = distil(store.digestWindow(FROM, TO), (id) => id.replace('sess_', ''))
      const line = digest.lines.find((one) => one.kind === 'request-answered')
      expect(line, 'the digest drew no answered line').toBeDefined()
      expect(line!.text).toContain(nothingRecordsWho('answered', 1))
      // ⚠️ …and the plural arm is the digest's and not the card's, so the shared builder is
      // genuinely shared rather than a constant with one reader.
      expect(nothingRecordsWho('answered', 2)).toBe(
        'Nothing in the ledger records who answered them',
      )
    })

    it('⚠️ a word off a replayed ledger this build has no sentence for is said as itself, never `undefined`', () => {
      // ⛔ **The boundary is the LEDGER, not the wire** — `isProposalEnding`'s reason, and
      // `isWhoDidIt`'s: `TranscriptEvent` is `JSON.parse`d and cast with no schema, so a row
      // written by a build whose vocabulary has moved reaches a reader as a word it does not know.
      const later = { who: 'a-kind-a-later-build-wrote' } as unknown as ActedBy
      expect(whoAnsweredIt(later)).toBe('by a-kind-a-later-build-wrote')
      // 🔴 **And the Events tab, which has drawn this value since `477`** and would have printed
      // the string `undefined` for such a row until this dispatch.
      expect(didIt(later)).toBe('a-kind-a-later-build-wrote')
      expect(didIt(later)).not.toContain('undefined')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the map — `494` F2's two sentences, corrected with the surface (rule 19's corollary)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the map', () => {
    it('⛔ the actor slot names its source and its absent sentence is the one the product composes', () => {
      const actor = V23_FIELD_MAP.find((field) => field.path === 'requests[].actor')
      expect(actor, 'the map no longer answers for the actor').toBeDefined()
      expect(actor!.binding.state).toBe('derived')
      expect(
        actor!.binding.state === 'hole' ? [] : actor!.binding.from.map((one) => one.symbol),
      ).toEqual(['UserDecisionEvent'])
      // ⚑ **Resolved against the product rather than transcribed**: the sentence the map says the
      // surface draws is the sentence the surface draws.
      expect(actor!.absent).toContain(whoAnsweredIt(undefined))
      // ⛔ …and the retired ruling is gone rather than reworded.
      expect(actor!.absent).not.toContain('Omit the row')
    })

    it('🔴 the v2.3 sentence `494` F2 found false is `supported`, and names a source', () => {
      const quote =
        'An answer or denial stays attributed, with its reason and final provider outcome.'
      const sentence = HAND_CARRIED.find((one) => one.quote === quote)
      expect(sentence, 'the audit no longer holds the sentence').toBeDefined()
      expect(sentence!.verdict).toBe('supported')
      expect(sentence!.renderFrom.map((one) => one.symbol)).toContain('UserDecisionEvent')
      expect(sentence!.heldIn).toEqual(['v2.3'])
    })
  })
})
