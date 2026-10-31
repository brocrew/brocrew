import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime, FakeSessionHandle } from '@brobot2/runtime'
import type { AgentToolset, ResumeOptions, SessionRef, StartOptions } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  THE_APP_ITSELF,
  aPersonTypedIt,
  whoseWordsTheseAre,
} from '../src/main/runtime/runtime-host'
import type { Caller, RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  WINDOW_CALLER_PREFIX,
  aWindowIsAsking,
  sinkOwnerId,
} from '../src/main/runtime/window-caller'
import { resourcesRoot } from '../src/main/resources/resources'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { isVisibleIn } from '../src/renderer/src/lib/transcript-mode'
import { GO_AHEAD_SENDER } from '../src/renderer/src/lib/plan-mode'
import { AN_UNNAMED_RELAYER, RELAYED_MARK } from '../src/renderer/src/lib/relayed-turn'
import { WORK_REPORT_MARK } from '../src/renderer/src/lib/work-report'
import { describeEvent } from '../src/renderer/src/lib/describe-event'
import type { TranscriptItem } from '../src/renderer/src/lib/transcript'
import type { PersistedEventInfo, TranscriptEvent } from '../src/shared/runtime-ipc'
import { TURN_AUTHORSHIP_KEYS, agentName } from '../src/shared/runtime-ipc'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { pieceLine, theOwnerOf } from '../src/shared/piece-called'
import { theDirectionLine } from '../src/main/runtime/turn-origin'
import { replyText } from '../src/main/runtime/reply-rails'

/**
 * App-delivered words must not be attributed to the person.
 *
 * ⚑ The PO's sentence, quoted in the brief that asked for this:
 *
 * A receiver acting on words falsely attributed to the person is acting on false authority. A
 * measured corpus contained 12,646 such messages, so the regression can affect many
 * hand-offs.
 *
 * ## ⛔ What `410` counted, and what the brief got wrong about it
 *
 * ⚠️ **`410` F2, on every run: *"1 unattributed turn on Codex, 2 on Claude, on the project
 * manager."*** The brief reads that as the residue of `routeRequest`, the one producer `406`
 * knowingly left unmarked. ⛔ **It is not.** `routeRequest` is the Claude-only one — row 8 is
 * *not performed* on Codex, so no question is ever routed there — and the turn that is
 * unattributed on BOTH is `message_agent`: **the door every piece of work in this product goes
 * through.** §3 measures that from the code rather than from the count.
 *
 * ## 🔴 So the marking stopped being per-producer
 *
 * ⛔ **`406` marked three call sites by hand and a fourth shipped unmarked; a fifth was never
 * named at all.** ⚑ `413` computes the authorship once, at the door, from WHO IS ASKING — and the
 * default is the app's. A turn is the person's only when a WINDOW sent it, which is a positive
 * test: the next transport this host grows is app-authored by forgetting.
 *
 * ⚑ **Real host, real SQLite, real migrations, real tools.** The only double is the provider.
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

/** ⛔ **Comment-stripped**, so a census reads what the code does and not what a docblock says. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** Every file under a root, as `{ path, text }` — the census shape `404` and `406` use. */
function filesUnder(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(ts|vue)$/.test(entry)) {
        out.push({
          path: relative(root, full).replaceAll('\\', '/'),
          text: readFileSync(full, 'utf8'),
        })
      }
    }
  }
  walk(root)
  return out
}

/** The original caller discovery, including unresolved and member receivers. */
function turnDoorCalls(files: readonly { path: string; text: string }[]): {
  path: string
  verb: string
  line: string
  call: string
}[] {
  const VERBS = ['send', 'sendAs', 'sendInterrupting', 'queueMessage', 'endPlanMode']
  /**
   * ⚑ **The whole CALL, not only its first line** — `message_agent`'s call gained the
   * piece it names and went over several lines, so the line a verb is on no longer holds its
   * caller. ⚠️ Read from the opening bracket to the one that closes it.
   */
  const theCallFrom = (lines: readonly string[], at: number): string => {
    let depth = 0
    let opened = false
    const taken: string[] = []
    for (let index = at; index < lines.length; index++) {
      const line = lines[index] ?? ''
      taken.push(line.trim())
      for (const character of line) {
        if (character === '(') {
          depth++
          opened = true
        } else if (character === ')') depth--
      }
      if (opened && depth <= 0) break
    }
    return taken.join(' ')
  }
  const calls: { path: string; verb: string; line: string; call: string }[] = []
  for (const file of files) {
    const lines = codeOnly(file.text).split('\n')
    lines.forEach((line, at) => {
      for (const verb of VERBS) {
        if (new RegExp(`\\b(host|this)\\.${verb}\\(`).test(line)) {
          calls.push({ path: file.path, verb, line: line.trim(), call: theCallFrom(lines, at) })
        }
      }
    })
  }
  return calls
}

const PACKET_SEND_EXEMPTION = {
  path: 'plugins/lifecycle/transport.ts',
  className: 'PersonChannel',
  method: 'send',
  reason: 'writes authenticated lifecycle frames to the supervisor socket; never a turn',
  bodySha256: '9e2c40d482fe25d52b6d3025900ccba33d4e26130f7003790b7d92d5e875471a',
  calls: [
    {
      expression: "this.send({ kind: 'reply', id: packet.id, ok: true, value: value ?? null })",
      censusText: "this.send({ kind: 'reply', id: packet.id, ok: true, value: value ?? null }),",
      count: 1,
    },
    {
      expression: `this.send({
                  kind: 'reply',
                  id: packet.id,
                  ok: false,
                  value:
                    this.reportRefusals() &&
                    error instanceof PluginSupervisorError &&
                    ['policy-refused', 'source-mismatch', 'incompatible', 'network'].includes(
                      error.code,
                    )
                      ? { pluginRefusal: error.code }
                      : null,
                })`,
      censusText:
        "this.send({ kind: 'reply', id: packet.id, ok: false, value: this.reportRefusals() && error instanceof PluginSupervisorError && ['policy-refused', 'source-mismatch', 'incompatible', 'network'].includes( error.code, ) ? { pluginRefusal: error.code } : null, }),",
      count: 1,
    },
    {
      expression: "this.send({ kind: 'call', id, value })",
      censusText: "this.send({ kind: 'call', id, value })",
      count: 1,
    },
  ],
} as const

/** An exemption stops being valid as soon as its reviewed method changes. */
function checkedPacketSource(text: string): ts.SourceFile {
  const source = ts.createSourceFile(PACKET_SEND_EXEMPTION.path, text, ts.ScriptTarget.Latest, true)
  const classes = source.statements.filter(
    (node): node is ts.ClassDeclaration =>
      ts.isClassDeclaration(node) && node.name?.text === PACKET_SEND_EXEMPTION.className,
  )
  const methods = classes[0]?.members.filter(
    (node): node is ts.MethodDeclaration =>
      ts.isMethodDeclaration(node) && node.name.getText(source) === PACKET_SEND_EXEMPTION.method,
  )
  const method = methods?.[0]
  if (
    classes.length !== 1 ||
    methods?.length !== 1 ||
    !method?.body ||
    !method.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword) ||
    createHash('sha256').update(method.body.getText(source)).digest('hex') !==
      PACKET_SEND_EXEMPTION.bodySha256
  ) {
    throw new Error('The reviewed lifecycle packet method changed; review its exemption again')
  }
  return source
}

/** Remove only the three reviewed calls; the discovery itself stays unchanged. */
function turnCallsExceptReviewedPackets(files: readonly { path: string; text: string }[]) {
  const calls = turnDoorCalls(files)
  const packetFiles = files.filter((file) => file.path === PACKET_SEND_EXEMPTION.path)
  if (packetFiles.length !== 1) throw new Error('The reviewed lifecycle transport is missing')
  const source = checkedPacketSource(packetFiles[0]!.text)
  const owned: ts.CallExpression[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const owner = ts.findAncestor(node, ts.isClassDeclaration)
      if (owner?.name?.text === PACKET_SEND_EXEMPTION.className) owned.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  const exempted = new Set<(typeof calls)[number]>()
  for (const reviewed of PACKET_SEND_EXEMPTION.calls) {
    const expressions = owned.filter((node) => node.getText(source) === reviewed.expression)
    const matches = calls.filter(
      (call) =>
        call.path === PACKET_SEND_EXEMPTION.path &&
        call.verb === 'send' &&
        call.call === reviewed.censusText,
    )
    if (expressions.length !== reviewed.count || matches.length !== reviewed.count)
      throw new Error('The reviewed lifecycle packet calls changed; review their exemption again')
    for (const match of matches) exempted.add(match)
  }
  return calls.filter((call) => !exempted.has(call))
}

/**
 * ⛔ **Every object literal that publishes a `user_turn`, cut by BRACE MATCHING** (`406`'s own
 * lesson: *"a block census needs a brace match"*).
 *
 * ⚠️ **`indexOf('})')` cuts short** — a conditional spread ends `: {})` — and trimming to the
 * first `})` on its own line overran `endPlanMode`'s one-line publish by 1,372 characters. ⚑ This
 * counts depth from the `{` that opens the literal and stops at the one that closes it, so a
 * publish written on one line and one written over twelve are cut the same way.
 */
function userTurnLiterals(source: string): string[] {
  const code = codeOnly(source)
  const out: string[] = []
  const needle = "type: 'user_turn'"
  for (let at = code.indexOf(needle); at !== -1; at = code.indexOf(needle, at + 1)) {
    const open = code.lastIndexOf('{', at)
    if (open === -1) continue
    let depth = 0
    let end = -1
    for (let i = open; i < code.length; i++) {
      if (code[i] === '{') depth++
      else if (code[i] === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) throw new Error('a user_turn literal was never closed')
    out.push(code.slice(open, end + 1))
  }
  return out
}

/**
 * ⛔ **A test has to BE the provider to raise a question** (`394`'s double, reused). Nothing else
 * can produce the event `routeRequest` reads, and §4 is about what happens to the turn that
 * question becomes.
 */
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

describe('413 · words the person did not say', () => {
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

  const buildHost = (withStore: SessionStore = store): RuntimeHost => {
    const built = new RuntimeHost({
      store: withStore,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-words-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-words-root-'))
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
  /** ⛔ **`410`'s own instrument**, in its own words — see row 9b of `lifecycle-stage.smoke.ts`. */
  const unattributedIn = (sessionId: string): Extract<TranscriptEvent, { type: 'user_turn' }>[] =>
    turnsIn(sessionId).filter((turn) => turn.attribution === undefined)

  /**
   * ⚑ **What the PROVIDER received**, read off the double's echo rather than off the call. The
   * fake answers every turn with `assistant_message: "echo: <text>"`, so the child's own ledger
   * holds the exact string that crossed `SessionHandle.send`.
   */
  const providerHeard = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter(
        (event): event is Extract<TranscriptEvent, { type: 'assistant_message' }> =>
          event.type === 'assistant_message',
      )
      .map((event) => event.text.replace(/^echo: /, ''))

  /**
   * ⚑ **A PM with one child of its own, given work through the real door** — `406`'s helper.
   *
   * ⚑ **D-016 · the give IS the work**: `give_work` starts the child and `text` is its brief, the
   * child's first turn — which the FakeRuntime parks on a card, so the child stays BUSY. Returns
   * the piece the give opened as `task`, its label, and the profile it was given to.
   */
  const workWasGiven = async (
    text = 'the work',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    task: string
    label: string
    profile: string
  }> => {
    const nth = ++pairs
    const pmProfile = `pm-${String(nth)}`
    const siblings = [`worker-${String(nth)}-a`, `worker-${String(nth)}-b`]
    for (const one of siblings) await bringIdentityIntoBeing(one)
    const pm = await personOpens(pmProfile)
    const pmTools = agentToolsFor(host, pm)
    const profile = siblings[0] as string
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile,
      title: 'The work',
      brief: text,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      pm,
      worker: given.agent as string,
      pmTools,
      task: given.piece as string,
      label: given.label as string,
      profile,
    }
  }

  /**
   * ⚑ **The card a conversation is parked on, if it still is.** The double raises one per turn and
   * waits, which is what makes a target BUSY — and being busy is the ordinary case this dispatch
   * is about, so most of these tests have to drive a session through more than one turn.
   */
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

  /**
   * ⛔ **Answer whatever this conversation is parked on until `until` holds.**
   *
   * ⚠️ **A spawned conversation is held for NOBODY**, so a person has to take it over first
   * (336's door) — that is what `claimSession` is, and it changes who OWNS the conversation and
   * nothing about who wrote what.
   */
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

  const foldOf = (events: TranscriptEvent[]) => {
    const state = createTranscript()
    events.forEach((event, index) => applyEvent(state, event, 1_000 + index))
    return state
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the census — every producer that puts a turn into a provider, classified
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the census, derived from the call sites', () => {
    const hostSource = (): string => readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8')

    /**
     * ⛔ **The three ways a `user_turn` this app DELIVERS may say who wrote it** — a closed list,
     * and each entry is a claim rather than a pattern that happens to match.
     *
     *  - **`whoseWordsTheseAre(`** — computed at the door from who is asking. Two doors.
     *  - **`queued.authorship`** — the FLUSH, spreading the value the door already computed. ⚠️ It
     *    is deliberately not a second call: the flush has no caller, so anything it re-derived
     *    would be re-derived from a proxy, which is the reasoning `410` measured failing.
     *  - **`attribution: 'app_authored'`** — `endPlanMode`, which composes its own sentence and is
     *    therefore the one producer whose answer does not depend on who pressed the button.
     */
    const MARKINGS = [
      'whoseWordsTheseAre(',
      'queued.authorship',
      "attribution: 'app_authored'",
    ] as const

    it('🔴 every `user_turn` this app publishes says who wrote it, in code and not in prose', () => {
      const transcriptImporters = new Set([
        'providers/claude/import-transcript.ts',
        'providers/codex/import-transcript.ts',
      ])
      // ⛔ **The whole file set, walked** — `413` §3: *"derived from the call sites, not from a
      // list in this brief."* ⚠️ A census that named `runtime-host.ts` would be blind to the next
      // file that learns to publish one, which is the shape of the defect being closed.
      const publishing = filesUnder(mainRoot)
        .map((file) => ({ path: file.path, literals: userTurnLiterals(file.text) }))
        .filter((file) => file.literals.length > 0)
      // ⚑ **The two families, and the count is stated so a NEW one has to be classified here.**
      expect(publishing.map((file) => file.path).sort()).toEqual(
        [...transcriptImporters, 'runtime/runtime-host.ts'].sort(),
      )
      const total = publishing.reduce((sum, file) => sum + file.literals.length, 0)
      // 🔴 **D-027 · seven, where it was six** — the flush publishes ONE `user_turn` for a turn of
      // several held messages, with each message as a part, beside the one it publishes for one.
      // ⚑ Eight: a turn that carries on after a repaired sign-in, marked as this app's own.
      expect(total).toBe(8)

      const used = new Map(MARKINGS.map((marking) => [marking, 0]))
      for (const file of publishing) {
        for (const literal of file.literals) {
          if (transcriptImporters.has(file.path)) {
            // ⛔ **An importer is not delivering a turn to a provider** — it is reading a file that
            // CLAIMS the person said something, which is `074`'s finding and its own value.
            expect(literal, `${file.path}: ${literal}`).toContain(
              "attribution: 'provider_transcript'",
            )
            continue
          }
          const marking = MARKINGS.find((one) => literal.includes(one))
          expect(
            marking,
            `${file.path} publishes a user_turn that says nothing about who wrote it: ${literal}`,
          ).toBeDefined()
          if (marking !== undefined) used.set(marking, (used.get(marking) ?? 0) + 1)
        }
      }
      // ⛔ **Every marking in the table is USED**, so the list cannot quietly grow an entry that
      // admits a shape nothing writes — which is how an allowlist stops being a census.
      expect([...used].filter(([, count]) => count === 0).map(([marking]) => marking)).toEqual([])
      // ⛔ **D-027 · the turn of several says who wrote it PER MESSAGE**: its marking is the held
      // entry's `queued.authorship`, spread into each part — so each message in the turn carries
      // its own writer, and a turn of a person's words and an agent's is never one person's turn.
      // ⚠️ Read inside `parts`, because a marking anywhere in the literal would pass the loop above.
      const several = publishing
        .flatMap((file) => file.literals)
        .filter((literal) => literal.includes('parts:'))
      expect(several).toHaveLength(1)
      const [turn = ''] = several
      expect(turn.slice(turn.indexOf('parts:'))).toContain('...one.queued.authorship,')
    })

    it('⛔ the census plants TWO and finds BOTH — standing rule 12', () => {
      // ⚠️ **Trapped the way the subject is** (`a-control-must-be-trapped-the-way-the-subject-is`):
      // the planted publishes are written in the two real shapes — one over several lines with a
      // conditional spread in it, one on a single line — because a cut that only handled the first
      // would pass the control and fail on the code.
      const planted = [
        "this.publishOurs(session, { type: 'user_turn', text })",
        [
          'this.publishOurs(session, {',
          "  type: 'user_turn',",
          '  text,',
          '  ...(handed.paths.length > 0 ? { attachments: handed.paths } : {}),',
          '})',
        ].join('\n'),
      ].join('\n\n')
      const real = hostSource()
      const found = userTurnLiterals(`${real}\n${planted}\n`)
      // ⛔ **Two MORE than the file has**, which is the half a census that reads only the first
      // match per file cannot report — `store.create(` did exactly that, twice this month.
      expect(found.length).toBe(userTurnLiterals(real).length + 2)
      const unmarked = found.filter(
        (literal) => !MARKINGS.some((marking) => literal.includes(marking)),
      )
      expect(unmarked.length).toBe(2)
    })

    it('🔴 every door into a provider is one of six, and each publishes a turn', () => {
      // ⛔ **`SessionHandle.send` is the only way a string reaches a model** (216 §1, measured
      // there: *"plain text is not the cheap option, it is the only form that reaches a model"*),
      // so the doors are its call sites and nothing else can be one.
      const code = codeOnly(hostSource())
      // 🔴 **662 · three doors now reach the provider THROUGH `handToProvider`**, which performs
      // the one handover itself so the frame and the stamp read the same `from`. ⚠️ **Re-aimed,
      // not weakened** (standing rule 26): a door is still a call site, but three of them are
      // `this.handToProvider(`. The go-ahead and login continuation share the app's stamped
      // send. Both handovers return the provider's promise without adding an async wrapper.
      const composing = code.match(/await this\.handToProvider\(/g) ?? []
      const sending =
        code.match(/return session\.handle\.send\(text, this\.stampFor\(null, \[\]\)\)/g) ?? []
      expect(composing.length).toBe(3)
      expect(sending.length).toBe(1)
      expect(code.match(/await this\.sendTheAppsWords\(/g)).toHaveLength(2)
      expect(code).toContain('await this.sendTheAppsWords(session, text)')
      expect(code).toContain('await this.sendTheAppsWords(session, continuation.text)')
      expect(code).toContain(
        'private sendTheAppsWords(session: HostedSession, text: string): Promise<void>',
      )
      expect(code.match(/await session\.handle\.send\(/g) ?? []).toHaveLength(0)
      expect(code).toContain('return session.handle.send(words, this.stampFor(from, handed))')
      // 🔴 **D-027 · and a fifth: a turn of several held messages**, which the flush hands to
      // `handTogetherToProvider` — the second method that performs a handover, and RETURNS its
      // send for {@link handToProvider}'s ordering reason. ⚑ Pinned by its exact text as that one
      // is, stamped from every message it carries rather than from one `from`. ⚑ Held in `sent`
      // for the one statement that writes whose turn it is once the words have gone, then returned.
      const together = code.match(/await this\.handTogetherToProvider\(/g) ?? []
      expect(together.length).toBe(1)
      expect(code).toContain(
        [
          'const sent = session.handle.send(',
          '      this.withWhatThisLifeOwes(session, turn, currentPiece),',
          '      this.stampForATurnOf(messages),',
          '    )',
        ].join('\n'),
      )
      expect(code).toContain('    return sent\n')
      // ⚑ **And a sixth: a turn that hands over nothing new**, after a repaired sign-in, so the
      // agent answers the message its thread already holds. No string reaches the model through it.
      const carrying = code.match(/await session\.handle\.carryOn!\(\)/g) ?? []
      expect(carrying.length).toBe(1)
      const doors = [...composing, ...sending, ...together, ...carrying]
      expect(doors.length).toBe(6)
      // ⚑ **And each one is followed by a publish**, which is what makes the literal census above
      // a census of the doors rather than of a coincidence: six doors, six literals in this file.
      // ⚑ D-027 · the flush's two — one message's turn, and a turn of several — are two publishes
      // after its two doors.
      expect(userTurnLiterals(hostSource()).length).toBe(6)
    })

    it('⛔ nothing outside `ipc.ts` hands a WINDOW to a turn door — but the one `ipc.ts` handed `startAndSend`', () => {
      // 🔴 **This is the classification half** — `413` §3: *"each classified as the person's or the
      // app's."* ⚑ A door's authorship is decided by its caller, so the census that matters is of
      // who calls one. ⚠️ Derived by reading every call rather than by naming the callers.
      // ⚑ **D-017 · R1 — and `sendAs`, `send`'s own body**: the person's first message into a
      // conversation that was not running is handed straight to it once the start is made
      // (`sendTheFirstMessage`), so the census reads that call too — the door is the body a send
      // reaches, whichever name the call site spells.
      const calls = turnCallsExceptReviewedPackets(filesUnder(mainRoot))
      // ⚠️ **A positive control on the search shape** (standing rule 4): if this found nothing the
      // assertions below would all hold vacuously.
      expect(calls.length).toBeGreaterThanOrEqual(6)
      const byFile = [...new Set(calls.map((one) => one.path))].sort()
      expect(byFile).toEqual([
        'runtime/agent-tools.ts',
        'runtime/ipc.ts',
        'runtime/runtime-host.ts',
      ])
      // ⛔ **`ipc.ts` is the person's door and passes `sink`** — the ONE thing in this app whose
      // `ownerId` is a window's.
      for (const call of calls.filter((one) => one.path === 'runtime/ipc.ts')) {
        expect(call.call, call.call).toContain('sink')
      }
      // ⛔ **`agent-tools.ts` passes `by`**, which is `agent:<session>` and never a window — see
      // §2, which measures what that produces rather than reading it off this line.
      // ⚠️ **`415` added arguments after it and this read `', by)'`** — a census pinned to the END
      // of a line, which dies the day anything is appended
      // (`a-source-census-that-pins-a-line-kills-every-row-on-it`). ⚑ What it is for is that the
      // CALLER is `by`, so it matches the argument and not the bracket after it.
      for (const call of calls.filter((one) => one.path === 'runtime/agent-tools.ts')) {
        expect(call.call, call.call).toMatch(/,\s*by\s*[,)]/)
      }
      // 🔴 **735 · one host call passes a window, and it is the window `ipc.ts` handed it** —
      // `RuntimeHost.startAndSend`'s own send of the person's first message, the person's words.
      // ⛔ Every other call in the host names no window (they pass `THE_APP_ITSELF` or their own
      // caller), and the door is reached from `ipc.ts` alone, with the channel's `sink`.
      const windowsInTheHost = calls.filter(
        (one) => one.path === 'runtime/runtime-host.ts' && /\bsink\b/.test(one.line),
      )
      // ⚑ **D-017 · R1 — the same window, now handed to `send`'s body** once the start is made:
      // `startAndSend` reopens it for the person's window and `sendTheFirstMessage` sends.
      expect(windowsInTheHost.map((one) => one.line)).toEqual([
        'await this.sendAs(sessionId, text, sink, attachments, {',
      ])
      // ⛔ …and that method is reached from `startAndSend` alone, with the `sink` it was handed.
      const hostCode = codeOnly(readFileSync(join(mainRoot, 'runtime/runtime-host.ts'), 'utf8'))
      expect(hostCode.split('this.sendTheFirstMessage(').length - 1).toBe(1)
      const door = hostCode.slice(
        hostCode.indexOf('  async startAndSend('),
        hostCode.indexOf('  private async sendTheFirstMessage('),
      )
      // ⚑ **D-017 · R10 — to the conversation the reopen answered with**: the id itself, or the one
      // that took its place when it could never be reopened. The window is the same `sink`.
      // ⚑ **D-017b** — `startAndSend` widened (attach, claim, or reopen, then send) and hands the
      // answer's own `resumed.sessionId` straight through rather than naming it `ran` first.
      expect(door).toContain(
        'return this.sendTheFirstMessage(\n          resumed.sessionId,\n          text,\n          sink,',
      )
      expect(door).toContain('resumed = await this.reopenForAPerson(at, sink, launchKey)')
      const callers = filesUnder(mainRoot).filter((file) =>
        /\.startAndSend\(/.test(codeOnly(file.text)),
      )
      expect(callers.map((file) => file.path)).toEqual(['runtime/ipc.ts'])
      expect(codeOnly(callers[0]?.text ?? '')).toMatch(
        /host\.startAndSend\(\s*command\.sessionId,\s*command\.text,\s*sink,/,
      )
    })

    it.each([
      ['unresolved member', 'any', 'this.host'],
      ['typed member', 'RuntimeHost', 'this.host'],
      ['redeclared interface member', 'TurnDoor', 'this.host'],
      ['unresolved member with a comment', 'any', 'this.host/* channel */'],
    ])('keeps the old census candidate for a %s', (_label, memberType, receiver) => {
      const calls = turnDoorCalls([
        {
          path: 'runtime/runtime-host.ts',
          text: `export class RuntimeHost {
            private identity = true
            async send(id: string, text: string, sink: unknown) {}
          }`,
        },
        {
          path: 'fictional-member-turn.ts',
          text: `import { RuntimeHost } from './runtime/runtime-host'
            interface TurnDoor {
              send(id: string, text: string, sink: unknown): Promise<void>
            }
            class Relay {
              constructor(private host: ${memberType}) {}
              dispatch(id: string, text: string, sink: unknown) {
                ${receiver}.send(id, text, sink)
              }
            }`,
        },
      ])
      expect(calls.map((one) => ({ path: one.path, call: one.call }))).toEqual([
        { path: 'fictional-member-turn.ts', call: codeOnly(`${receiver}.send(id, text, sink)`) },
      ])
    })

    it('invalidates the packet exemption when the reviewed method body changes', () => {
      const text = readFileSync(join(mainRoot, PACKET_SEND_EXEMPTION.path), 'utf8')
      expect(turnCallsExceptReviewedPackets([{ path: PACKET_SEND_EXEMPTION.path, text }])).toEqual(
        [],
      )
      const changed = text.replace('this.socket.write(', 'this.socket.destroy(')
      expect(changed).not.toBe(text)
      expect(() =>
        turnCallsExceptReviewedPackets([{ path: PACKET_SEND_EXEMPTION.path, text: changed }]),
      ).toThrow('review its exemption again')
    })

    it.each(PACKET_SEND_EXEMPTION.calls)(
      'invalidates a changed reviewed call: $expression',
      (reviewed) => {
        const text = readFileSync(join(mainRoot, PACKET_SEND_EXEMPTION.path), 'utf8')
        const changed = text.replace(
          reviewed.expression,
          reviewed.expression.replace('this.send(', 'this.send( '),
        )
        expect(changed).not.toBe(text)
        expect(() =>
          turnCallsExceptReviewedPackets([{ path: PACKET_SEND_EXEMPTION.path, text: changed }]),
        ).toThrow('review their exemption again')
      },
    )

    it.each(PACKET_SEND_EXEMPTION.calls)(
      'invalidates an increased reviewed-call count: $expression',
      (reviewed) => {
        const text = readFileSync(join(mainRoot, PACKET_SEND_EXEMPTION.path), 'utf8')
        const changed = text.replace(
          '  close(): void {',
          `  duplicate(): void {\n    ${reviewed.expression}\n  }\n  close(): void {`,
        )
        expect(changed).not.toBe(text)
        expect(() =>
          turnCallsExceptReviewedPackets([{ path: PACKET_SEND_EXEMPTION.path, text: changed }]),
        ).toThrow('review their exemption again')
      },
    )

    it('keeps a fourth send in the lifecycle transport in the census', () => {
      const text = readFileSync(join(mainRoot, PACKET_SEND_EXEMPTION.path), 'utf8')
      const extra = "this.send({ kind: 'reply', id: 'fictional-extra', ok: true, value: null })"
      const changed = text.replace(
        '  close(): void {',
        `  extra(): void {\n    ${extra}\n  }\n  close(): void {`,
      )
      expect(
        turnCallsExceptReviewedPackets([{ path: PACKET_SEND_EXEMPTION.path, text: changed }]).map(
          (call) => call.call,
        ),
      ).toEqual([extra])
    })

    it('keeps a turn callback stored on an unrelated class', () => {
      const calls = turnDoorCalls([
        {
          path: 'fictional-bound-turn.ts',
          text: `type Send = (...args: Parameters<RuntimeHost['send']>) => ReturnType<RuntimeHost['send']>
            class Relay {
              constructor(private readonly send: Send) {}
              dispatch(...args: Parameters<Send>) { return this.send(...args) }
            }
            const relay = new Relay(host.send.bind(host))
            relay.dispatch(sessionId, text, sink)`,
        },
      ])
      expect(calls.map((one) => one.path)).toEqual(['fictional-bound-turn.ts'])
      expect(calls[0]?.call).toContain('this.send(...args)')
    })

    it('⚠️ the window prefix has exactly ONE spelling, and the decoder is its inverse', () => {
      // ⛔ **`sessionSpeakingAs`'s own rule, applied to the other kind of caller**: *"it lives
      // beside the encoder so the two spellings cannot drift apart, which is the only reason a
      // prefix scheme is safe to depend on."* ⚠️ Before `413` the encoder was in `ipc.ts` and
      // there was no decoder at all.
      const written = filesUnder(mainRoot).filter(
        (file) =>
          file.path !== 'runtime/window-caller.ts' && codeOnly(file.text).includes("'webContents:"),
      )
      expect(written.map((file) => file.path)).toEqual([])
      // ⛔ **And the excluded file is asserted from the inside — found by `M32` SURVIVING.** ⚠️ A
      // census that skips one file is blind in exactly that file, and the encoder writing the
      // prefix as a literal beside the constant is indistinguishable from the constant to every
      // behavioural test: both produce `webContents:7`. ⚑ So the count is the instrument, and the
      // ONE occurrence is the declaration.
      const owner = codeOnly(readFileSync(join(mainRoot, 'runtime/window-caller.ts'), 'utf8'))
      expect(owner.match(/webContents:/g) ?? []).toHaveLength(1)
      expect(owner).toContain('return `${WINDOW_CALLER_PREFIX}${contents.id}`')
      expect(aWindowIsAsking(sinkOwnerId({ id: 7 }))).toBe(true)
      // ⛔ **A bare prefix names no window**, and admitting it would make the empty string a person.
      expect(aWindowIsAsking(WINDOW_CALLER_PREFIX)).toBe(false)
      expect(aWindowIsAsking(agentCallerId('sess_9'))).toBe(false)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the default — a turn is the person's only when a person demonstrably typed it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the default is the app’s', () => {
    const aWindow: Caller = { ownerId: sinkOwnerId({ id: 4 }) }
    const anAgent: Caller = { ownerId: agentCallerId('sess_child') }

    /**
     * 🔴 **545 · the door's own resolver, and it plants TWO relayers** (standing rule 12) — one this
     * app can name and one it cannot.
     *
     * ⛔ **A single resolvable case cannot tell a correct resolution from a lucky constant**, which
     * is the exact trap `537` F3 found: `RELAYED_SENDER` was right in one photograph and wrong on
     * every hop below it. ⚑ `sess_asked` is the second planting and it is a REAL state rather than
     * a contrivance — `SessionStore.identityOf` answers `null` for a conversation with no binding,
     * and every row written before `545` carries no identity at all.
     */
    const RELAYERS: Record<string, string> = { sess_child: 'project-manager' }
    const identityOf = (conversation: string): string | null => RELAYERS[conversation] ?? null

    it('🔴 a WINDOW is the only caller whose turn goes out unmarked', () => {
      expect(whoseWordsTheseAre(aWindow, identityOf)).toEqual({ humanInitiated: true })
      expect(aPersonTypedIt(aWindow)).toBe(true)
      expect(aPersonTypedIt(anAgent)).toBe(false)
      expect(aPersonTypedIt(THE_APP_ITSELF)).toBe(false)
    })

    it('⛔ a caller this app does not have yet is the APP’s, not the person’s', () => {
      // 🔴 **The whole of `413` §3.** `THE_APP_ITSELF`'s own docblock names the next transport —
      // *"tomorrow the MCP tool a PM would spawn agents through … gets its own prefix from
      // whatever registers it"* — and the tempting predicate (*not the app and not an agent*)
      // would have put it on the person's side of the line. ⚠️ **A planted FUTURE value**
      // (standing rule 12), and it rotates by construction: any prefix that is not `webContents:`
      // reaches this branch, so the test does not stop meaning something when the future arrives.
      const tomorrow: Caller = { ownerId: 'mcp:acme-7' }
      expect(aPersonTypedIt(tomorrow)).toBe(false)
      expect(whoseWordsTheseAre(tomorrow, identityOf)).toEqual({ attribution: 'app_authored' })
    })

    it('⛔ a report forces the marking even from a window — the belt', () => {
      // ⚠️ **Where the two readings DIVERGE** (standing rule 3): no caller passes a report from a
      // window today, so a test that only ever drove the real call sites would measure nothing
      // here. ⛔ `406`'s hazard — *"a turn carrying `work` and no `attribution` would render as the
      // person's own bubble with the facts attached"* — must not come back through the door the
      // default opened.
      const marked = whoseWordsTheseAre(aWindow, identityOf, {
        report: { piece: 'work_1', label: 'W1.1', state: 'answered' },
      })
      expect(marked.attribution).toBe('app_authored')
      expect(marked.work?.piece).toBe('work_1')
    })

    it('⚑ the relay is derived from the caller, and OVERRIDDEN where BroBot carries for somebody', () => {
      expect(whoseWordsTheseAre(anAgent, identityOf).relayedFrom).toBe('sess_child')
      // ⛔ `routeRequest`: the caller is the app and the words are the CHILD's.
      expect(
        whoseWordsTheseAre(THE_APP_ITSELF, identityOf, { carriedFor: 'sess_asked' }).relayedFrom,
      ).toBe('sess_asked')
      expect(whoseWordsTheseAre(THE_APP_ITSELF, identityOf).relayedFrom).toBeUndefined()
    })

    it('🔴 545 · the identity rides the same expression, and cannot travel without the relay', () => {
      // ⛔ **One writer for both halves.** The conversation and the identity behind it are one fact
      // in two fields, and `413`'s own rule for `attribution`/`work` is why they are set in one
      // expression: *"There is one writer for both keys and it is this expression."*
      expect(whoseWordsTheseAre(anAgent, identityOf).relayedFromProfile).toBe('project-manager')
      // ⚑ **The SECOND planting** (standing rule 12) — a relayer this app cannot name. ⛔ The key
      // is ABSENT rather than empty, which is what the renderer's fallback is keyed on.
      const unnameable = whoseWordsTheseAre(THE_APP_ITSELF, identityOf, {
        carriedFor: 'sess_asked',
      })
      expect(unnameable.relayedFrom).toBe('sess_asked')
      expect(unnameable).not.toHaveProperty('relayedFromProfile')
      // ⛔ **And a turn nobody relayed asks the resolver NOTHING** — no relayer, no ledger read,
      // which is `originOf`'s own *both nulls are decided before the store is asked* one method
      // over.
      //
      // ⚠️ **Both callers that reach it, because they take different paths through the function.**
      // A window returns on the early `{}` and never sees the resolver at all; ⛔ **BroBot's own
      // sentence does NOT** — `THE_APP_ITSELF` is app-authored with no relay, so it falls all the
      // way through, and a resolver asked there would read the ledger on every go-ahead this app
      // ever sends. 🔴 A counter driven only by the window measures the early return.
      const counted = (by: Caller): number => {
        let asked = 0
        whoseWordsTheseAre(by, (one) => {
          asked += 1
          return identityOf(one)
        })
        return asked
      }
      expect(counted(aWindow)).toBe(0)
      expect(counted(THE_APP_ITSELF)).toBe(0)
      // ⚑ The paired positive: a caller that DOES have a relayer asks exactly once.
      expect(counted(anAgent)).toBe(1)
    })

    it('🔴 687 · the value the held rows carry WHOLE — and `says`, written for an AGENT and nobody else', () => {
      // ⛔ **This test pinned `heldAuthorship`'s REMOVAL until `687`**: the held row took the
      // subject and never the authorship. ⚑ R22 reversed that — a held go-ahead's authorship IS
      // `attribution`, and removing it left the person's shape — so the held rows now carry what
      // this function produces, and there is no second function left to measure. ⚠️ Re-aimed
      // (standing rule 26) at the key `687` added to the value, and at the case where the two
      // readings of *who is speaking* DIVERGE.
      // ⚑ **D-016** — `follow-up` where this said `work`: the `work` kind went with `message_agent`'s
      // giving, and a give's brief declares no kind at all.
      const whose = whoseWordsTheseAre(
        anAgent,
        identityOf,
        { report: { piece: 't', label: 'W1.2', state: 'working' } },
        'follow-up',
      )
      expect(Object.keys(whose).sort()).toEqual([
        'attribution',
        'relayedFrom',
        'relayedFromProfile',
        'says',
        'work',
      ])
      // 🔴 **Carried for a child**: relayed, and declared by NOBODY — asked of `by`, never of the
      // relay, so the routed question says nothing although it names who it came from.
      const carried = whoseWordsTheseAre(
        THE_APP_ITSELF,
        identityOf,
        { carriedFor: 'sess_asked' },
        'note',
      )
      expect(carried.relayedFrom).toBe('sess_asked')
      expect(carried).not.toHaveProperty('says')
      // ⚑ A window and a caller this app does not have yet declare nothing either.
      expect(whoseWordsTheseAre(aWindow, identityOf, {}, 'follow-up')).toEqual({
        humanInitiated: true,
      })
      expect(whoseWordsTheseAre({ ownerId: 'mcp:acme-7' }, identityOf, {}, 'follow-up')).toEqual({
        attribution: 'app_authored',
      })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · `give_work` (D-016; `message_agent`'s `work` until then) — the producer the brief does not
  // name, and the one on both providers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · work one agent gives another', () => {
    it('🔴 a brief arrives MARKED, and names the conversation that wrote it', async () => {
      const { pm, worker } = await workWasGiven('read the file and report back')
      const arrived = turnsIn(worker).find((turn) => turn.text.includes('read the file'))
      expect(arrived, 'the work never reached the worker as a turn').toBeDefined()
      expect(arrived?.attribution).toBe('app_authored')
      // ⛔ **The ledger holds the name** — `413` §4's condition for attributing at all.
      expect(arrived?.relayedFrom).toBe(pm)
      // ⚑ **And no work report**: nothing has come BACK. `406`'s subject is a report about work
      // that finished; this is work starting, and one entry must not claim the other's meaning.
      expect(arrived?.work).toBeUndefined()
    })

    it('⛔ the conversation it names is the GIVER the piece row already names', async () => {
      // ⚠️ **Two independent readings of one fact, asserted equal.** `work_given.givenBy` is
      // written by `recordTheGive` (D-016's `recordAssignment`) and this is written by
      // `whoseWordsTheseAre`; if they could disagree, `413` §4's *"unless the ledger holds that
      // name"* would be satisfied by a name that is not the right one.
      const { pm, worker } = await workWasGiven('a second piece')
      const given = ledger(worker).find((event) => event.type === 'work_given')
      expect(given?.type === 'work_given' ? given.givenBy : null).toBe(pm)
      const arrived = turnsIn(worker).at(-1)
      expect(arrived?.relayedFrom).toBe(pm)
    })

    it('⚠️ the raw stream says so too, and it is the ONE place the id is printed', () => {
      // ⛔ **`(BroBot wrote it)` stopped being true of every marked turn** — a relayed turn's
      // words are a model's. ⚑ And `413` §4 is honoured by WHERE the id goes: the Events tab is
      // the ledger, and the bubble a person reads names nobody — see §6.
      const line = describeEvent({
        type: 'user_turn',
        text: 'do the thing',
        attribution: 'app_authored',
        relayedFrom: 'sess_pm',
      })
      expect(line).toContain('relayed from sess_pm')
      expect(line).not.toContain('This app wrote it')
      expect(
        describeEvent({ type: 'user_turn', text: 'x', attribution: 'app_authored' }),
      ).toContain('This app wrote it')
      // ⚑ **And the HELD row's line too**, which is the one a reader meets first whenever the
      // target conversation is busy — the ordinary case for work.
      expect(
        describeEvent({
          type: 'message_queued',
          messageId: 'm1',
          text: 'do the thing',
          relayedFrom: 'sess_pm',
        }),
      ).toContain('relayed from sess_pm')
      expect(
        describeEvent({ type: 'message_queued', messageId: 'm2', text: 'mine' }),
      ).not.toContain('relayed')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · `routeRequest` — the fourth producer, which `406` named and left
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · a child’s question, carried to its parent', () => {
    it('🔴 the routed question is MARKED and names the child that asked', async () => {
      const { pm, worker } = await workWasGiven('go and ask me something')
      // ⚑ **The child's own provider raises it**, which is the only way this event exists.
      const raised = latestHandle().simulateUserInput('which branch?', ['main', 'dev'], false)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the question to be routed',
      )
      await waitFor(
        () => turnsIn(pm).some((turn) => turn.text.includes('which branch?')),
        'the question to reach the parent as a turn',
      )
      const carried = turnsIn(pm).find((turn) => turn.text.includes('which branch?'))
      // ⛔ **This is the turn `406` left as the person's** — *"it still renders as the person's own
      // bubble … named here so the next reader finds it before a person does."*
      expect(carried?.attribution).toBe('app_authored')
      expect(carried?.relayedFrom).toBe(worker)
      expect(carried?.work).toBeUndefined()
    })

    it('⛔ the caller is the APP and the name is the CHILD’s — not the caller’s', async () => {
      // ⚠️ **Tested where the two readings DIVERGE** (standing rule 3). `deliverQuestion` calls as
      // `THE_APP_ITSELF`, so a relay derived from the caller alone would be ABSENT here and the
      // turn would fall through to the go-ahead's *"sent for you"* entry — the exact falsehood
      // `406` refused to ship. ⛔ Every other relayed turn derives it from the caller, so this is
      // the one sample where the two rules give different answers.
      const { pm, worker } = await workWasGiven('another question coming')
      const raised = latestHandle().simulateUserInput('deploy now?', ['yes', 'no'], false)
      await waitFor(
        () => turnsIn(pm).some((turn) => turn.text.includes(raised.id)),
        'the question to reach the parent',
      )
      const carried = turnsIn(pm).find((turn) => turn.text.includes(raised.id))
      expect(carried?.relayedFrom).toBe(worker)
      expect(carried?.relayedFrom).not.toBe(pm)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the path `410` found it on — the count, driven to zero
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · `410` F2, on a project manager’s own ledger', () => {
    it('🔴 the PM’s ledger holds ZERO unattributed turns after a full round', async () => {
      // ⛔ **`410`'s instrument, in its own words** — row 9b counts `user_turn` rows on the
      // project manager with no attribution and reports how many *"would draw as the PERSON's own
      // bubble"*. ⚑ Everything below is the shape of that run: a PM that was GIVEN its project by
      // an agent above it, a worker it gave work to, and a question that came back.
      const nth = ++pairs
      const bossProfile = `boss-${String(nth)}`
      const pmProfile = `pm-${String(nth)}`
      const workerProfile = `worker-${String(nth)}`
      for (const one of [pmProfile, workerProfile]) await bringIdentityIntoBeing(one)
      const boss = await personOpens(bossProfile)
      const bossTools = agentToolsFor(host, boss)
      // ⛔ **Step 3 of the lifecycle** — *"BroBot gives the project manager the project, as a
      // numbered task."* This is the turn that was unattributed on BOTH providers. ⚑ **D-016** —
      // the give starts the PM, and the project is its first turn.
      const given = await callOn(bossTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: pmProfile,
        title: 'The project',
        brief: 'deliver the project',
      })
      expect(given.outcome, JSON.stringify(given)).toBe('ok')
      const pm = given.agent as string

      const pmTools = agentToolsFor(host, pm)
      const task = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: workerProfile,
        title: 'Task 001',
        brief: 'task 001',
      })
      expect(task.outcome, JSON.stringify(task)).toBe('ok')
      const worker = task.agent as string

      // ⛔ **Step 8** — the worker asks, and the question is routed to the PM.
      const raised = latestHandle().simulateUserInput('which branch?', ['main'], false)
      await waitFor(
        () =>
          ledger(worker).some(
            (event) => event.type === 'request_routed' && event.requestId === raised.id,
          ),
        'the question to be routed',
      )
      // ⚠️ **The PM is mid-turn on the project it was given**, so the question is HELD rather than
      // sent — which is the ordinary case and exactly why §7 exists. ⚑ Letting its turns end is
      // what flushes the mailbox.
      await unblockUntil(
        pm,
        () => turnsIn(pm).some((turn) => turn.text.includes(raised.id)),
        'the routed question to reach the PM as a turn',
      )

      // ⛔ **Step 9** — the worker replies, and the reply reaches the PM as words.
      const row = store.piecesOwnedBy(worker).at(-1)
      if (row === undefined) throw new Error('no piece was recorded on the worker')
      const replied = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: row.piece,
        outcome: 'done',
        summary: 'it is done',
        needs_user_action: true,
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')

      // ⚠️ **A positive control on the count** (standing rule 4): three app-delivered turns reached
      // this ledger, so a zero below is a fact about attribution and not about an empty ledger.
      await unblockUntil(
        pm,
        () => turnsIn(pm).some((turn) => turn.text.includes('it is done')),
        'the reply to reach the project manager',
      )
      expect(turnsIn(pm).length).toBeGreaterThanOrEqual(3)
      expect(
        unattributedIn(pm).map((turn) => turn.text),
        'turns on the project manager that would draw as the PERSON’s own bubble',
      ).toEqual([])
    })

    it('⛔ a person’s typed turn one fact over is still `You`, on the same ledger', async () => {
      // 🔴 **The paired negative the brief asks for by name.** A run that drove the count to zero
      // by marking EVERYTHING would pass the test above and destroy the thing it protects.
      const { pm } = await workWasGiven('work given by an agent')
      await host.send(pm, 'and this one the person actually typed', window)
      const typed = turnsIn(pm).find((turn) => turn.text.includes('the person actually typed'))
      expect(typed?.attribution).toBeUndefined()
      expect(typed?.relayedFrom).toBeUndefined()
      expect(typed?.work).toBeUndefined()
      expect(foldOf([typed as TranscriptEvent]).items[0]?.kind).toBe('user')
      expect(unattributedIn(pm).map((turn) => turn.text)).toEqual([
        'and this one the person actually typed',
      ])
    })

    it('⛔ …and it survives a RESTART, which is where a derivation could quietly change it', async () => {
      // ⚑ **`413` §4: *"A person's own typed turn is untouched, including across a restart."***
      // ⚠️ The ledger is the only thing a second launch has, so this is where an authorship that
      // was re-derived rather than recorded would show up.
      const pm = await personOpens('restart-1')
      await host.send(pm, 'the person typed this before the app died', window)
      await waitFor(() => turnsIn(pm).length > 0, 'the turn to be recorded')
      await host.closeAll()
      // ⛔ **A second launch over the same ledger, with its own store** — `404`'s relaunch shape.
      // ⚑ The ledger is all a restart has, so an authorship that was re-derived at construction
      // rather than recorded at the door would show up here and nowhere else.
      const next = createSessionStore(db, tick)
      buildHost(next)
      const replayed = next
        .events(pm)
        .map((entry) => entry.event)
        .filter((event) => event.type === 'user_turn')
      expect(replayed.length).toBe(1)
      expect(replayed[0]?.type === 'user_turn' ? replayed[0].attribution : 'set').toBeUndefined()
      expect(replayed[0]?.type === 'user_turn' ? replayed[0].relayedFrom : 'set').toBeUndefined()
      expect(foldOf(replayed).items[0]?.kind).toBe('user')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · the row a person reads
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the entry, and the two it must not be', () => {
    it('🔴 a relayed turn is its own row and NEVER the person’s bubble', () => {
      const state = foldOf([
        { type: 'user_turn', text: 'a person typed this' },
        {
          type: 'user_turn',
          text: 'task 001',
          attribution: 'app_authored',
          relayedFrom: 'sess_pm',
        },
      ])
      expect(state.items.map((item) => item.kind)).toEqual(['user', 'relayed'])
    })

    it('⛔ it is not the GO-AHEAD’s row either, and that is why `406` left it unmarked', () => {
      // ⚠️ **The falsehood `406` refused to ship**: *"Marking it without building its entry would
      // render a child's question under the go-ahead's authorship line (`sent for you`)."*
      const state = foldOf([
        { type: 'user_turn', text: 'Go ahead with this plan.', attribution: 'app_authored' },
        { type: 'user_turn', text: 'which branch?', attribution: 'app_authored', relayedFrom: 'c' },
      ])
      expect(state.items.map((item) => item.kind)).toEqual(['continuation', 'relayed'])
    })

    it('⛔ a work REPORT still wins, because it is the more specific subject', () => {
      // ⚑ `deliverReply` calls as the app and passes a report; nothing relays it, so the two
      // subjects never collide today. ⚠️ Asserted anyway, because the fold reads them in order and
      // a later producer that carried both would otherwise pick an entry by accident.
      const state = foldOf([
        {
          type: 'user_turn',
          text: 'the child answered',
          attribution: 'app_authored',
          work: { piece: 'work_1', label: 'W1.3', state: 'answered', outcome: 'done' },
          relayedFrom: 'sess_child',
        },
      ])
      expect(state.items[0]?.kind).toBe('workReport')
    })

    it('⛔ `relayedFrom` is read as a non-empty STRING, and a replayed row cannot forge one', () => {
      // ⚠️ **Replay is a trust boundary** — the stored payload is broadly cast after `JSON.parse`
      // and `boundStoredEvent` has no arm for this key. ⛔ **The hazard is put on the path the code
      // walks** rather than asserted of the predicate: a truthiness check would make `{}` decide
      // which entry a person reads.
      for (const forged of [{}, 0, '', true, [], null]) {
        const state = foldOf([{ type: 'user_turn', text: 'mine', relayedFrom: forged as never }])
        expect(state.items[0]?.kind, JSON.stringify(forged)).toBe('user')
      }
      // ⚑ And the positive control, so the loop above is not passing because nothing renders.
      expect(
        foldOf([{ type: 'user_turn', text: 'theirs', relayedFrom: 'sess_x' }]).items[0]?.kind,
      ).toBe('relayed')
    })

    it('⚠️ the row never prints the CONVERSATION, and names the identity instead — §4', () => {
      // ⛔ **`413` §4: "No invented actor."** ⚑ **That clause survives `HO-054` §3 word for word**,
      // and this is the half of it that did not move: a `sess_…` handle printed as a sender is an
      // actor invented out of an id. The id stays navigation metadata; the profile names the sender.
      //
      // 🔴 **545 · what DID move is the reason `413` stopped there** — *"the only thing the
      // renderer could print is a `sess_…` handle"* — because `449` made a conversation resolvable
      // and the row now carries the identity beside the handle. ⚠️ **So this test was re-aimed
      // rather than stripped** (standing rule 26): it read code, the FACT moved, and what it pins
      // now is *the handle still goes nowhere a person reads, and the identity does*.
      const state = foldOf([
        {
          type: 'user_turn',
          text: 'task 001',
          attribution: 'app_authored',
          relayedFrom: 'sess_pm',
          relayedFromProfile: 'project-manager',
        },
      ])
      expect(state.items[0]).toMatchObject({
        relayedFrom: 'sess_pm',
        relayedFromProfile: 'project-manager',
      })
      expect(state.items[0]).not.toHaveProperty('sender', 'sess_pm')
      expect(JSON.stringify(state.items[0])).toContain('project-manager')
      expect(RELAYED_MARK).toBe('from another conversation')
      // ⛔ **It must CONTRADICT *sent for you*, not merely differ from it.**
      expect(RELAYED_MARK).not.toContain('for you')
    })

    it('🔴 545 · the heading is no longer BroBot, and the two that ARE BroBot are unmoved', () => {
      // ⛔ **The old pin said `RELAYED_SENDER === GO_AHEAD_SENDER`**, on `331`'s reasoning that
      // *"the three app-delivered entries must not come to disagree about who put the words
      // there."* ⚠️ **They were equal by COINCIDENCE and the coincidence is exactly what `537` F3
      // found**: the go-ahead and the work report are BroBot's OWN sentences, so naming BroBot on
      // them is a report; a relayed row is somebody else's words, so naming BroBot on it is an
      // attribution — and `HO-054` §3 ruled it *"a lie about a project manager"*.
      //
      // 🔴 **So the equality is re-aimed into an inequality with its reason**, which is what stops
      // a later dispatch "restoring consistency" by putting the defect back.
      expect(GO_AHEAD_SENDER).toBe('This app')
      expect(WORK_REPORT_MARK.startsWith(`${GO_AHEAD_SENDER} ·`)).toBe(true)
      expect(AN_UNNAMED_RELAYER).not.toBe(GO_AHEAD_SENDER)
      // ⛔ **And it is not a NAME at all**, which is `413` §4's surviving clause read on the one
      // row this app cannot resolve: it may say a category, never an actor.
      expect(AN_UNNAMED_RELAYER).not.toContain('BroCrew')
    })

    it('⛔ it is shown in BOTH transcript modes, and hiding it would be worse than the defect', () => {
      // ⛔ **The ITEM the fold really produced, and the mode SECOND — found by `M20` SURVIVING.**
      // ⚠️ The first version of this called `isVisibleIn('relayed', 'normal')`: the signature is
      // `(mode, item)`, so `'normal'` arrived where an item belongs, `item.kind` read `undefined`,
      // and the switch fell to its `default: return true`. ⛔ **Both assertions were satisfied by
      // the default arm of a switch the row under test had just been mutated out of**, and the
      // test file had never been typechecked — `assert-in-the-gap`, and `243`'s *a typecheck that
      // comes back almost clean is a warning* from the other end.
      const item = foldOf([
        { type: 'user_turn', text: 'task', attribution: 'app_authored', relayedFrom: 'c' },
      ]).items[0]
      expect(item?.kind).toBe('relayed')
      for (const mode of ['normal', 'debug'] as const) {
        expect(isVisibleIn(mode, item as TranscriptItem), `hidden in ${mode}`).toBe(true)
      }
    })

    it('🔴 it counts as a TURN for the Changes pane’s scope axis', () => {
      // ⚠️ A task is the turn every file the child touches is written under; a scope axis that did
      // not count it would file that work under the previous prompt.
      const before = foldOf([{ type: 'user_turn', text: 'first' }]).changes.turn
      const after = foldOf([
        { type: 'user_turn', text: 'first' },
        { type: 'user_turn', text: 'task', attribution: 'app_authored', relayedFrom: 'c' },
      ]).changes.turn
      expect(after).toBe(before + 1)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the HELD row — the one a busy child meets, with two buttons on it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · work held for a child that is mid-turn', () => {
    it('🔴 the held row carries the relay, and so does the turn it becomes', async () => {
      const { pmTools, worker, profile } = await workWasGiven('the first task')
      // ⛔ **The worker is mid-turn on the piece it was just given**, which is the ORDINARY state
      // for a second one: `give_work`'s own description is *"held until that agent is free"*.
      // ⚑ **D-016** — a second give from the same giver reaches the SAME conversation, and the
      // one-open-task rail that made `415` finish the first piece here first is gone.
      const second = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: 'Task two',
        brief: 'task two',
      })
      expect(second.agent).toBe(worker)
      // ⚑ **D-022 · R3** — `give_work` says `held` where it said `queued`: one word with the verbs
      // that tell a piece's holder.
      expect(second.delivery, JSON.stringify(second)).toBe('held')
      const held = ledger(worker)
        .filter((event) => event.type === 'message_queued')
        .at(-1)
      expect(held?.type === 'message_queued' ? held.relayedFrom : 'missing').toBeDefined()
      // 🔴 **687 · the held row carries the AUTHORSHIP too** (R22). ⛔ This pinned the opposite —
      // *"nothing has been SENT, so there is no authorship on this row"* — and was re-aimed
      // (standing rule 26) at what replaced it: who wrote the words is a fact about the words.
      expect(held?.type === 'message_queued' ? held.attribution : 'missing').toBe('app_authored')
      await unblockUntil(
        worker,
        () => turnsIn(worker).some((turn) => turn.text === 'task two'),
        'the held task to flush',
      )
      const flushed = turnsIn(worker).find((turn) => turn.text === 'task two')
      expect(flushed?.attribution).toBe('app_authored')
      expect(flushed?.relayedFrom).toBe(held?.type === 'message_queued' ? held.relayedFrom : null)
      // ⚑ **687 · and the two rows agree about EVERY key of the authorship** — the held row
      // carries it whole since R22, so a key dropped on the way to it (`545`'s `relayedFromProfile`
      // above all, which no other host-driven assertion reads off a held row) is caught here.
      // ⚑ **D-016** — a brief declares no kind: it says what it is by the piece it names.
      expect(flushed).not.toHaveProperty('says')
      expect(flushed?.piece).toBe(second.piece)
      expect(flushed?.relayedFromProfile).toBeDefined()
      const authorshipOf = (row: object | undefined): Record<string, unknown> =>
        Object.fromEntries(
          TURN_AUTHORSHIP_KEYS.flatMap((key) =>
            row !== undefined && key in row ? [[key, (row as Record<string, unknown>)[key]]] : [],
          ),
        )
      expect(authorshipOf(held)).toEqual(authorshipOf(flushed))
    })

    it('⛔ the app going away holding a task keeps the held row OPEN, and it still knows whose it was', async () => {
      const { pmTools, worker, profile } = await workWasGiven('the first task')
      // ⚑ **D-016** — the second give is held behind the first brief's turn, as above.
      const second = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile,
        title: 'Task two',
        brief: 'task two',
      })
      expect(second.delivery, JSON.stringify(second)).toBe('held')
      const held = ledger(worker)
        .filter((event) => event.type === 'message_queued')
        .at(-1)
      const heldId = held?.type === 'message_queued' ? held.messageId : undefined
      expect(heldId).toBeDefined()
      await host.closeAll()
      // 🔴 **D-017 · R3 — a quit ends nothing.** ⛔ This read an `abandoned` ending carrying the
      // relay; the held message now waits for the conversation's next start, which sends it first.
      // Re-aimed at what replaced it: no ending was written, and the row that start rebuilds the
      // message from still says whose words they are.
      expect(
        ledger(worker).some(
          (event) => event.type === 'message_unqueued' && event.messageId === heldId,
        ),
        'a quit wrote an ending for a held message',
      ).toBe(false)
      const waiting = store.messagesWaitingIn(worker).find((one) => one.messageId === heldId)
      expect(waiting?.text).toBe('task two')
      expect(waiting?.authorship.attribution).toBe('app_authored')
      expect(waiting?.authorship.relayedFrom).toBeDefined()
      expect(waiting?.authorship.relayedFrom).toBe(
        held?.type === 'message_queued' ? held.relayedFrom : 'missing',
      )
    })

    it('⛔ a message a PERSON queued carries NEITHER key, on both rows', async () => {
      const { pm } = await workWasGiven('work given by an agent')
      await host.send(pm, 'keep the parent busy', window)
      const outcome = await host.queueMessage(pm, 'the person typed this', window)
      expect(outcome.outcome).toBe('queued')
      const held = ledger(pm)
        .filter((event) => event.type === 'message_queued')
        .at(-1)
      expect(held?.type === 'message_queued' ? held.relayedFrom : 'missing').toBeUndefined()
      expect(held?.type === 'message_queued' ? held.work : 'missing').toBeUndefined()
      // ⚑ **687 · and no authorship** — the control for R22's `app_authored` on a held row.
      expect(held?.type === 'message_queued' ? held.attribution : 'missing').toBeUndefined()
      await unblockUntil(
        pm,
        () => turnsIn(pm).some((turn) => turn.text === 'the person typed this'),
        'the queued message to flush',
      )
      const flushed = turnsIn(pm).find((turn) => turn.text === 'the person typed this')
      expect(flushed?.attribution).toBeUndefined()
      expect(flushed?.relayedFrom).toBeUndefined()
    })

    it('🔴 the held ROW is drawn as a relay, and the rebuild from the ending alone is too', () => {
      // ⚠️ **`054` pages the transcript**, so a window can hold the ending without the beginning —
      // and that branch rebuilds the row from the ending alone. ⛔ Without the key on BOTH rows a
      // task one agent gave another comes back as the person's own bubble, offering their words
      // back to the composer.
      const queued = foldOf([
        { type: 'message_queued', messageId: 'm1', kind: 'work', text: 'task', relayedFrom: 'p' },
      ])
      expect(queued.items[0]?.kind === 'queued' ? queued.items[0].relayed : null).toBe(true)
      const rebuilt = foldOf([
        {
          type: 'message_unqueued',
          messageId: 'm2',
          reason: 'abandoned',
          text: 'task',
          relayedFrom: 'p',
        },
      ])
      expect(rebuilt.items[0]?.kind === 'queued' ? rebuilt.items[0].relayed : null).toBe(true)
      // ⛔ And the forged-value guard, on this path too.
      const forged = foldOf([
        { type: 'message_queued', messageId: 'm3', text: 'mine', relayedFrom: {} as never },
      ])
      expect(forged.items[0]?.kind === 'queued' ? forged.items[0].relayed : 'set').toBeUndefined()
    })

    it('🔴 an ending settles the row it NAMES — `406` reported this and here it is measured', async () => {
      // ⛔ **A session can hold TWO since `394`** — a work message and a question — and
      // `openQueuedItem` answered *the last unresolved one* on a premise that stopped being true:
      // *"the host allows only one queued message per session at a time."*
      //
      // 🔴 **Measured before it was fixed**: sending `m_work` spliced out the QUESTION's row and
      // left the work's on screen with no ending it could ever receive. ⚑ Both halves are damage —
      // a child's question vanishes from the surface a person reads it on, and a message that HAS
      // gone says *not sent · waiting for the turn to end* for ever.
      const state = foldOf([
        { type: 'message_queued', messageId: 'm_work', kind: 'work', text: 'the work' },
        {
          type: 'message_queued',
          messageId: 'm_q',
          kind: 'question',
          text: 'the question',
          relayedFrom: 'sess_child',
        },
        { type: 'message_unqueued', messageId: 'm_work', reason: 'sent', text: 'the work' },
      ])
      expect(state.items.map((item) => (item as { text?: string }).text)).toEqual(['the question'])
      expect(state.items[0]?.kind === 'queued' ? state.items[0].relayed : null).toBe(true)
    })

    it('⛔ an ending whose beginning is not on screen still rebuilds — the fallback is not lost', () => {
      // ⚠️ **The paired negative for the fix above.** Matching by name must not turn *"this window
      // never saw the queueing"* (`054` pages the transcript) into *"settle nothing and draw
      // nothing"* — the message would vanish entirely, which is strictly worse than the defect.
      const rebuilt = foldOf([
        { type: 'message_queued', messageId: 'm_other', kind: 'work', text: 'a different one' },
        {
          type: 'message_unqueued',
          messageId: 'm_gone',
          reason: 'abandoned',
          text: 'the one this window never saw queued',
        },
      ])
      expect(rebuilt.items.map((item) => (item as { text?: string }).text)).toEqual([
        'a different one',
        'the one this window never saw queued',
      ])
      // ⚑ **And a ledger with NO ids at all still settles by position**, which is every ledger
      // written before `354` — the fallback this fix keeps rather than removes.
      const old = foldOf([
        { type: 'message_queued', text: 'queued before messages had names' },
        { type: 'message_unqueued', reason: 'cancelled', text: 'queued before messages had names' },
      ])
      expect(old.items).toHaveLength(1)
      expect(old.items[0]?.kind === 'queued' ? old.items[0].outcome : null).toBe('cancelled')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §8 · half 2 — what the MODEL is told, measured rather than read off HO-020's sentence
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§8 · the provider-bound framing', () => {
    /**
     * ⚑ **D-016 · commit 7 · R3 — the direction line that answers a PM**, which addresses it by the
     * piece it owns where it spelled the PM's id — composed from the product's own parts, never
     * typed.
     */
    const answering = (pm: string): string => {
      const named = store.workThatNames(pm)
      const profile = store.identityOf(pm)?.profileSlug
      if (named === null || profile === undefined) {
        throw new Error(`${pm} holds no piece or has no identity, so nothing addresses it`)
      }
      // ⚑ W4.178 · every turn this answers hands over a piece: a brief says nothing of a note.
      return theDirectionLine(
        `${agentName(profile, store.agentIdentities())}, ${theOwnerOf(named)}`,
        'caller',
        true,
      )
    }

    it('🔴 a relayed TASK reaches the provider SAYING who wrote it — 414 closed this', async () => {
      // ⛔ **This is `413` §2's half 2, measured.** The brief calls it *"a reading of HO-020's
      // sentence, not a measurement"*, and it is right to: the answer is not *"the framing may
      // lose the attribution"*. ⚠️ **There is no framing.** `message_agent` hands the calling
      // model's string through unchanged, `messageWithHandedPaths` adds nothing when nothing is
      // attached, and `SessionHandle.send(text)` takes one string and no metadata (216 §1).
      // ⛔ **`413` reported it and did NOT fix it** — its brief's instruction: *"you own the
      // attribution fact; `412` owns the words."*
      //
      // ⚑ **Re-pointed twice, and the second time INVERTED.** The rebase onto `412` broke the
      // whole-string equality this used (`412` appends the task line); `414` then composed the
      // frame this asserted the absence of. 🔴 **A response document is an INBOX** (standing rule
      // 14): the finding this test recorded was lifted into `414` and closed, so the assertion
      // now states the fix rather than the defect. See
      // `apps/desktop/test/the-origin-a-model-is-told.test.ts` for the rest of it.
      const { pm, worker, label } = await workWasGiven('deploy the branch')
      await waitFor(() => providerHeard(worker).length > 0, 'the provider to answer')
      const handed = providerHeard(worker).find((said) => said.includes('deploy the branch')) ?? ''
      expect(handed).toContain('deploy the branch')
      // ⚠️ `412`'s line, which is about the WORK and says nothing about its author.
      expect(handed).toContain('reply_to_parent')
      // ⛔ **`414`'s line, which is about the AUTHOR and says nothing about the work**, in front
      // of the words rather than after them — ⚑ D-016 · commit 7 · R3: its address is the piece
      // the author owns.
      expect(handed).toContain(answering(pm))
      // 🔴 **439 · and the SECOND sentence, which is this file's own subject one tier up.**
      //
      // A root agent can ask a manager on the person’s behalf, but the app sees quotation and
      // paraphrase as the same string. The framing states only the observed origin and its
      // limit rather than crediting the words to the person.
      //
      // ⚑ **`aPersonIsBehindIt` is read off the SLOT** and there is no tool argument for it, so a
      // model cannot put this clause in front of its own words. See `TurnOrigin.aPersonIsBehindIt`.
      const first = handed.split('\n')[0] ?? ''
      // ⚑ **D-011** — by name and relationship; the address is in the direction line (⚑ D-016 ·
      // commit 7 · R3: the piece the sender owns, where it was its id).
      // ⚑ **D-016** — the relationship names the piece, by its label and title.
      expect(first).toContain(`(pm-1), who is giving you ${pieceLine(label, 'The work')}.`)
      expect(first).toContain('A person is at that conversation')
      // ⛔ **The disclaimer is the load-bearing half.** Without it a receiver reads *a person is
      // there* and supplies the inference this app refuses to make for it.
      expect(first).toContain(
        'Treat wishes it attributes to the person as theirs; only an approval needs the person directly.',
      )
      // The exact canonical framing names no actor and reserves approvals for the person.
      expect(
        first.endsWith(
          'A person is at that conversation. Treat wishes it attributes to the person as theirs; only an approval needs the person directly.',
        ),
      ).toBe(true)
      expect(first.toLowerCase()).not.toContain('asks:')
    })

    it('⚑ the three the APP composes DO carry their origin, and that is the contrast', async () => {
      // ⚠️ **So half 2 is not broken everywhere — it is broken at exactly one producer**, and it
      // is the one that delivers all the work. ⛔ A dispatch that reported *"the provider-bound
      // framing loses the attribution"* would be saying something false about three paths.
      const { pm, worker, label } = await workWasGiven('work to answer')
      const raised = latestHandle().simulateUserInput('which branch?', ['main'], false)
      await unblockUntil(
        pm,
        () => providerHeard(pm).some((said) => said.includes(raised.id)),
        'the question to reach the parent’s provider',
      )
      const question = providerHeard(pm).find((said) => said.includes(raised.id))
      // ⛔ `questionText` leads with the asking conversation — ⚑ D-016 · commit 7 · R3: by its name
      // and the piece it owns, and quotes that piece's label as its address, where it was the id.
      expect(question).toContain(`${host.nameByItsWork(worker)} is waiting on an answer`)
      expect(question).toContain(`with asked_by ${host.addressOf(worker)}.`)

      const replied = await callOn(agentToolsFor(host, worker), 'reply_to_parent', {
        piece: label,
        outcome: 'done',
        summary: 'finished it',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      // ⚠️ **The parent is mid-turn on the question that just reached it**, so the reply is held;
      // letting that turn end is what flushes it onto the provider.
      await unblockUntil(
        pm,
        () => providerHeard(pm).some((said) => said.includes('finished it')),
        'the reply to reach the parent’s provider',
      )
      const answer = providerHeard(pm).find((said) => said.includes('finished it'))
      // ⛔ `replyText` names the answering conversation outright — ⚑ D-016 · commit 7 · R3: *"W1.1 ·
      // The work was answered by Ada: done."*, the piece and its holder's name, where it was the
      // holder's id — so a model reading it cannot take the words for the person's. ⚑ The
      // sentence is read off the product's own composer, handed the holder the way the delivery
      // hands it: `whatToCallTheConversation` of the piece's owner.
      expect(answer).toContain(
        replyText(
          { label, title: 'The work' },
          host.whatToCallTheConversation(worker),
          { outcome: 'done', summary: 'finished it', needsUserAction: false },
          [],
          // ⚑ The PM gave no new brief of the piece, so none was held for the worker as it answered.
          false,
        ),
      )
      // 🔴 **The contrast `413` opened §8 with is GONE, and its absence is the assertion now**:
      // the task the PM gave the worker travels with its author named, exactly as the app's own
      // sentences always did. ⚑ Three producers named their origin and one did not; now all four
      // do, by two different mechanisms that answer the same question.
      const given = providerHeard(worker).find((said) => said.includes('work to answer')) ?? ''
      expect(given).toContain('work to answer')
      expect(given).toContain(answering(pm))
    })

    it('⚠️ one string of words, and beside it ONLY who wrote them — the bound since 662', () => {
      // 🔴 **Which is why fixing half 2 meant changing the TEXT, and therefore `412`'s lane.**
      // ⚠️ **662 changed the bound, and this test is re-aimed rather than deleted** (standing
      // rule 26). `413` read *"there is no metadata channel to a provider"* off
      // `send(text: string)`, and it was true. `662` added ONE: a `TurnProvenance` beside the
      // words, for the provider's own trust gates. ⛔ **What it did NOT add is a second way to
      // hand a model text**: the words are still one string, and the new channel's arms carry
      // a kind, an id and a display name, nothing a model is asked to read as instructions.
      // ⚑ Derived from the contract, so a third field or a free-form arm reddens here.
      const contract = codeOnly(
        readFileSync(join(here, '../../../packages/runtime/src/runtime.ts'), 'utf8'),
      )
      expect(contract).toContain('send(text: string, origin?: TurnProvenance): Promise<void>')
      const declared = contract.slice(contract.indexOf('export type TurnProvenance'))
      const shape = declared.slice(0, declared.indexOf('\n\n'))
      expect(shape.match(/readonly (\w+)\??:/g)).toStrictEqual([
        'readonly kind:',
        'readonly kind:',
        'readonly from:',
        'readonly name?:',
      ])
    })
  })
})
