import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BEYOND_ITS_RAILS, FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { BeyondItsRails } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  MESSAGE_RAILS,
  messagePermanenceOf,
  messageRetryableOf,
} from '../src/main/runtime/message-rails'
import { SPAWN_RAILS, permanenceOf, retryableOf } from '../src/main/runtime/spawn-rails'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const toolsSource = join(here, '../src/main/runtime/agent-tools.ts')

/**
 * 🔴 **486 · the doors our own verbs do not need** (HO-031 §2.4 and §2.5).
 *
 * ## ⛔ §2.4 · a project manager had to ask a human for permission to answer its own parent
 *
 * ⚑ **BroBot's own session report, §2.9**: *"The PM then needed human approval for `ls`, for
 * `Write`, and even for `mcp__brobot__reply_to_parent` — it had to ask permission to answer me."*
 *
 * > ⛔ **"The brobot tools are gated by RAILS. Permissions are for acts that reach outside this
 * > app."** ⚠️ *"Double-gating them means every task needs a human click to close, which breaks the
 * > loop the tools exist to make."* ⚑ *"The rails already answer* may you *for each of these verbs,
 * > and they answer it better than a permission card can."*
 *
 * 🔴 **The split is DECLARED on each verb and rendered from there, never written as prose** —
 * standing rule 8. `BEYOND_ITS_RAILS` is required on every `AgentToolDefinition`, so a verb added
 * later cannot arrive un-classified, and §1 below reads the table off the real toolset rather than
 * off a list somebody typed twice.
 *
 * ## ⛔ §2.5 · a policy wall arrived dressed as a typo
 *
 * ⚑ **The same report, §7.2**: *"Argument validation runs before the permission check, so the first
 * attempt returned `malformed-request` with `permanence: "permanent"` — when the truth was
 * `may-not-create-agents`."* 🔴 *"The only reason the real rail was discovered is that the PM
 * disobeyed"* this app's own instruction to read a permanent refusal rather than retry it.
 *
 * ⚠️ **Two halves, and §3 and §4 below are one each**: the wall answers first, and answering first
 * discloses nothing — `341`'s *entitlement before existence* has to survive the reordering that
 * happens around it.
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
 * ⛔ **The split, as this dispatch shipped it** — asserted by NAME and not by count
 * (`a-title-that-names-a-count-the-assertion-never-checks`).
 *
 * ⚠️ **This literal is the one place the decision is written down twice**, and that is deliberate:
 * the declarations are the source, and a test that read them into a variable and compared it with
 * itself would measure nothing. ⚑ The PO rules on this table; a verb that moves between rows moves
 * here too, in the same commit.
 */
const THE_SPLIT: Readonly<Record<ToolName, BeyondItsRails>> = {
  list_themes: 'nothing-its-rails-do-not-cover',
  save_theme: 'nothing-its-rails-do-not-cover',
  set_theme: 'nothing-its-rails-do-not-cover',
  list_agents: 'nothing-its-rails-do-not-cover',
  get_agent_status: 'nothing-its-rails-do-not-cover',
  list_tasks: 'nothing-its-rails-do-not-cover',
  list_questions: 'nothing-its-rails-do-not-cover',
  // ⚑ **D-016** — `list_projects` and `create_project` are gone with projects; both read
  // `nothing-its-rails-do-not-cover`.
  // ⛔ **488 · a reader whose whole gate is the fold** — `list_agents`' standing, one population
  // over. ⚡ It reads one of this app's own tables and answers; there is nothing here to ask a
  // person about.
  list_profiles: 'nothing-its-rails-do-not-cover',
  read_document: 'nothing-its-rails-do-not-cover',
  // ⚑ **D-016** — `549`'s `list_documents` row is gone with the document registry.
  // Known agents can propose; direct writes are limited to a person-started BroBot conversation.
  // The host checks caller, target and exact baseline, and keeps attribution and person-only Undo.
  propose_agent_rules: 'nothing-its-rails-do-not-cover',
  read_agent_rules: 'nothing-its-rails-do-not-cover',
  read_own_notes: 'nothing-its-rails-do-not-cover',
  write_own_notes: 'nothing-its-rails-do-not-cover',
  write_agent_rules: 'nothing-its-rails-do-not-cover',
  reply_to_parent: 'nothing-its-rails-do-not-cover',
  ask_question: 'nothing-its-rails-do-not-cover',
  // 🔴 **611 · a question carried one hop further** (HO-088 §3.2). ⛔ It starts nothing outside
  // this app and destroys nothing: the row it writes is a QUESTION, which opens no task, and the
  // question it carries stays open and stays the caller's. ⚑ Its entitlement is the LOOKUP — the
  // requests routed to this caller — so a question raised inside a family it did not start is an
  // id that finds nothing rather than a rail it can trip.
  pass_question_up: 'nothing-its-rails-do-not-cover',
  answer_question: 'nothing-its-rails-do-not-cover',
  message_agent: 'nothing-its-rails-do-not-cover',
  withdraw_task: 'nothing-its-rails-do-not-cover',
  create_agent: 'nothing-its-rails-do-not-cover',
  // ⚑ **D-016 · `give_work` took `spawn_agent`'s row** — it can start a conversation, as the spawn did.
  give_work: 'it-starts-something-outside-this-app',
  // ⚑ **D-016** — it names a piece or sets its status line in the owner's ledger; nothing outside.
  update_work: 'nothing-its-rails-do-not-cover',
  // ⚑ **D-016 · commit 6** — it writes a piece into the caller's own ledger, under its own root;
  // nothing is sent, nobody is woken and nothing starts, so the rails are the whole gate.
  take_on_work: 'nothing-its-rails-do-not-cover',
  // ⚑ **D-037** — it reads this app's own rows and the files it keeps under its own root; nothing
  // is sent, nobody is woken and nothing starts.
  find_files: 'nothing-its-rails-do-not-cover',
  search_work: 'nothing-its-rails-do-not-cover',
  search_past_work: 'nothing-its-rails-do-not-cover',
  // It brings an archived conversation back to the lists, as a person's Restore does, and sends
  // nothing of its own: what starts is what the app starts for words and jobs the conversation
  // already held, as `message_agent`'s words start a stopped one.
  restore_agent: 'nothing-its-rails-do-not-cover',
  // It writes a request in the caller's own ledger and contacts nothing; only a person's press
  // registers a server.
  request_mcp_server: 'nothing-its-rails-do-not-cover',
  request_action: 'nothing-its-rails-do-not-cover',
  // ⛔ **663's `resume_agent` row (R13b) is gone with the verb** — D-017 commit 3: nothing ends a
  // conversation, so nothing wakes one; a message starts a stopped one itself.
  // ⚑ **D-009** — it closes the caller's own question in the caller's own ledger; nothing outside.
  withdraw_question: 'nothing-its-rails-do-not-cover',
  // ⚑ **D-012** — it reads a conversation's ledger for the caller; nothing outside this app.
  read_transcript: 'nothing-its-rails-do-not-cover',
  // ⛔ **`end_agent`'s row is gone with the verb** (D-017 commit 3: nothing ends a conversation).
  interrupt_agent: 'it-destroys-work-in-flight',
}

describe('486 · the doors our own verbs do not need', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-486-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-486-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2031, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => join(userData, 'resources'),
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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
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
    const call = async (
      name: ToolName,
      args: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      const answered = await tool.call(args)
      return (answered.structured ?? {}) as Record<string, unknown>
    }
    return { set, call }
  }

  /**
   * ⛔ **An agent's own conversation, started by a parent's give** — so `sessionSpeakingAs` decodes
   * an `agent:<id>` caller and the grants below are actually read. ⚠️ A person's session would be
   * turned away from every question in this file by HO-007's *the human unrestricted*, which would
   * make every assertion vacuous. ⚑ **D-016** — `give_work` starts it, and its brief is its first
   * turn.
   */
  const anAgentRunning = async (profileId: string): Promise<string> => {
    await bringIdentityIntoBeing(profileId)
    const parent = await personOpens('pm')
    const given = await toolsOf(parent).call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: profileId,
      title: 'work',
      brief: 'work',
    })
    const child = given['agent']
    if (typeof child !== 'string') throw new Error(`give refused: ${String(given['rail'])}`)
    return child
  }

  describe('§1 · the split, read off the declarations', () => {
    it('🔴 every verb says what it does beyond its rails, and the verbs that keep a card are named', () => {
      // ⛔ **The real toolset, not a fixture.** `agentToolsFor` is what both adapters are handed, so
      // a verb added to the app arrives here; the explicit eligible role enumerates its full vocabulary.
      const declared = agentToolsFor(host, 'sess_nobody', {}, true).tools
      const said = Object.fromEntries(declared.map((one) => [one.name, one.beyondItsRails]))
      expect(said).toEqual(THE_SPLIT)
      // ⚑ **Named, so a verb cannot change rows in silence** — and the negative is the same list
      // read the other way, which is the half a count would have passed over.
      const keepsACard = declared
        .filter((one) => one.beyondItsRails !== 'nothing-its-rails-do-not-cover')
        .map((one) => one.name)
        .sort()
      // ⚑ **663 · `resume_agent` joined `spawn_agent`'s row** — R13b, provisional on the PO.
      // ⛔ **D-017 commit 3 · `end_agent` and `resume_agent` are gone** (nothing ends a
      // conversation, so nothing wakes one), and each word is still reached by the verb left in it.
      // ⚑ **D-016** — `give_work` holds `spawn_agent`'s row.
      expect(keepsACard).toEqual(['give_work', 'interrupt_agent'])
      // ⛔ **`reply_to_parent` is HO-031 §2.9's own example**, asserted by name so the ruling this
      // dispatch acted on is pinned to the verb it was made about.
      expect(said['reply_to_parent']).toBe('nothing-its-rails-do-not-cover')
    })

    it('⚑ every word in the vocabulary is REACHED by a verb, and none of them is a card decision', () => {
      // ⛔ **A closed vocabulary guards what a member SAYS** — a word no verb uses is a word nothing
      // measures. All three are reached, which is what makes the split a partition rather than a
      // list with a dead entry.
      const declared = agentToolsFor(host, 'sess_nobody', {}, true).tools
      const reached = new Set(declared.map((one) => one.beyondItsRails))
      expect([...reached].sort()).toEqual([...BEYOND_ITS_RAILS].sort())
      // ⚠️ **And every word describes the VERB, never what an app should ask.** The policy lives in
      // the adapters; a member spelled as an instruction would be the policy arriving in a costume.
      for (const word of BEYOND_ITS_RAILS) {
        expect(word, word).not.toMatch(/ask|card|permission|prompt/)
      }
    })

    it('⛔ the declarations are the ONLY place the split is written, so no adapter holds a name list', () => {
      // ⚑ **The search shape**: what would have refuted this is a set literal naming our verbs in a
      // provider adapter — the shape `TOOLS_THAT_ONLY_ASK_A_PERSON` has for a different question.
      // Both adapters are read, and both are asserted to reach the DECLARATION instead.
      // ⚠️ **Comments stripped first.** Both adapters' docblocks quote HO-031 §2.9, which names
      // `reply_to_parent` in the very sentence that explains why it no longer raises a card — and a
      // census that read prose would report the exemption it documents as the list it forbids
      // (`a-source-census-must-strip-prose-before-it-asserts`).
      const codeOnly = (text: string): string =>
        text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      const claude = codeOnly(
        readFileSync(join(here, '../../../packages/runtime/src/claude/claude-runtime.ts'), 'utf8'),
      )
      const codex = codeOnly(
        readFileSync(join(here, '../../../packages/runtime/src/codex/codex-runtime.ts'), 'utf8'),
      )
      for (const [name, source] of [
        ['claude', claude],
        ['codex', codex],
      ] as const) {
        expect(source, `${name} reads the declaration`).toContain(
          "'nothing-its-rails-do-not-cover'",
        )
        // ⛔ The verbs this dispatch exempted must not be SPELLED in either adapter.
        for (const verb of [
          'reply_to_parent',
          'ask_question',
          'withdraw_task',
          'answer_question',
        ]) {
          expect(source, `${name} must not name ${verb}`).not.toContain(verb)
        }
      }
      // ⚑ **Two controls, because a stripped file that came back empty would pass every negative
      // above.** ⛔ The strip did not eat the code: both files still contain a line only their code
      // has. ⚠️ And the reader can still FIND one of our verb names — planted here as the string a
      // name list would have been written with.
      expect(claude).toContain('permissionDecision')
      expect(codex).toContain('handleAgentToolCall')
      const planted = `${claude}\n const list = ['reply_to_parent']`
      expect(planted).toContain('reply_to_parent')
    })
  })

  describe('§2 · entitlement before argument shape', () => {
    it('🔴 create_agent · a caller with no grant is told the WALL, not that its arguments are malformed', async () => {
      // ⛔ **HO-031 §7.2's call, re-aimed** (D-014): `role` is no longer an argument, so the call is
      // malformed by a `provider` that is not a provider. The old order answered
      // `malformed-request · permanent`, and the app's own advice — *read a permanent refusal
      // rather than retrying one* — then pointed at the false conclusion.
      const worker = await anAgentRunning('worker')
      // ⚠️ **D-014 · the ruled default is `any`**, so *a caller with no grant* is one a person set to
      // `none` — the wall is kept for exactly that caller.
      grant('worker', { canCreateAgents: 'none' })
      const refused = await toolsOf(worker).call('create_agent', {
        profile_slug: 'helper',
        provider: 'DEV-75297',
      })
      expect(refused['rail']).toBe('may-not-create-agents')
      expect(refused['permanence']).toBe('until-a-person-changes-it')
      // ⚠️ **And the sentence a model reads is about the wall**, not about the argument.
      expect(refused['reason']).not.toContain('provider')

      // ⚑ **The paired positive, one fact over** (standing rule 3): the SAME malformed call from a
      // caller a person HAS granted still meets the shape check, so the wall did not eat it.
      grant('worker', { canCreateAgents: 'any' })
      const shaped = await toolsOf(worker).call('create_agent', {
        profile_slug: 'helper',
        provider: 'DEV-75297',
      })
      expect(shaped['rail']).toBe('malformed-request')
      expect(JSON.stringify(shaped['detail'])).toContain('provider')
    })

    // ⚑ **D-016** — `list_projects`, the second door on the same reach, is gone with projects.
    it('⛔ message_agent · the same order, on the reach a person granted', async () => {
      const worker = await anAgentRunning('worker')
      grant('worker', { canMessage: 'none' })
      const tools = toolsOf(worker)
      expect((await tools.call('message_agent', { kind: 'follow-up' }))['rail']).toBe(
        'may-not-message',
      )
      grant('worker', { canMessage: 'any' })
      const widened = toolsOf(worker)
      expect((await widened.call('message_agent', { kind: 'follow-up' }))['rail']).toBe(
        'malformed-request',
      )
    })

    // ⚑ **D-016** — `spawn_agent`'s case (*the kill switch answers before the shape*) went with the
    // tool: `give_work` asks the shape FIRST by ruling (R2 step 1), and the switch only of a give
    // that would start a conversation (step 7), so there is no switch-before-shape order to pin.

    it('⚑ the doors that ask a wall ask it FIRST, and the ones with no wall do not ask at all', () => {
      // ⛔ **A structural census, because the behaviour tests above cannot see ORDER** — each of
      // them observes one answer, and an answer is consistent with the wall being asked second for
      // a call that the shape check happens to admit.
      //
      // ⚠️ **Comments are stripped first**: this file's prose names every one of these calls, and a
      // census that read prose would find `host.mayReachAtAll` in a docblock
      // (`a-source-census-must-strip-prose-before-it-asserts`).
      const code = [toolsSource, join(here, '../src/main/themes/agent-tools.ts')]
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
      const bodies = new Map<string, string>()
      for (const match of code.matchAll(/name: '(\w+)'(?: as const)?,/g)) {
        // ⚠️ **From inside the closure, not from `call:`** — the parameter is literally spelled
        // `args`, so a body sliced from the declaration reads its own signature as an argument use
        // and every door would look inverted.
        const declared = code.indexOf('call:', match.index)
        if (declared === -1) continue
        const opens = code.indexOf('=> {', declared)
        if (opens === -1) continue
        bodies.set(match[1] as string, code.slice(opens + 4, opens + 700))
      }
      const WALL = /host\.may(CreateAgents|ReachAtAll)\(/
      // ⛔ **D-014 · `create_project`, `end_agent` and `interrupt_agent` lost their walls**, so they
      // are asserted by the complement below — no standing wall at all — and not here.
      const ASKS: Readonly<Record<string, RegExp>> = {
        // ⚑ **D-016** — `mayCreateAgents(me)`: the caller's own grant, with no `by` to ask.
        create_agent: /host\.mayCreateAgents\(me\)/,
        message_agent: /host\.mayReachAtAll\('message', by\)/,
        // ⛔ **663's `resume_agent` row is gone with the verb** (D-017 commit 3), and D-016 took
        // `list_projects`' (`mayReachAtAll('read', by)`) with projects.
      }
      for (const [verb, wanted] of Object.entries(ASKS)) {
        const body = bodies.get(verb) ?? ''
        expect(body, `${verb} asks its wall`).toMatch(wanted)
        // ⛔ **FIRST**: nothing that reads an argument may appear before the wall.
        const wall = body.search(WALL)
        const argument = body.search(/\bargs\b/)
        expect(
          argument === -1 || wall < argument,
          `${verb} asks its wall before it reads args`,
        ).toBe(true)
      }
      // ⚑ **The complement, and it is the finding rather than a formality**: every other door has no
      // standing wall to hoist — its entitlement is folded into the answer about the subject — so a
      // wall call there would be a question nothing can answer without an argument.
      for (const [verb, body] of bodies) {
        if (verb in ASKS) continue
        expect(body, `${verb} has no standing wall`).not.toMatch(WALL)
      }
      // ⚠️ **The control**: the reader really did find bodies, and really can see a wall call.
      expect(bodies.size).toBe(Object.keys(THE_SPLIT).length)
      expect(bodies.get('create_agent')).toMatch(WALL)
    })
  })

  describe('§3 · nothing leaks', () => {
    it('🔴 an unentitled caller is told the SAME thing about a name that exists and one that does not', async () => {
      // ⛔ **This is the property the reorder had to preserve.** `341`'s ruling is that an
      // unentitled caller must not learn which identities exist from the shape of its refusal —
      // and moving the grant IN FRONT of the argument check is exactly the change that could have
      // turned the refusal into an oracle.
      await bringIdentityIntoBeing('taken')
      const worker = await anAgentRunning('worker')
      // ⚠️ **D-014 · the default is `any`**, so the unentitled caller is one a person set to `none`.
      grant('worker', { canCreateAgents: 'none' })
      const tools = toolsOf(worker)
      const existing = await tools.call('create_agent', { profile_slug: 'taken' })
      const absent = await tools.call('create_agent', { profile_slug: 'nobody-has-this-name' })
      // ⚑ **Byte for byte**, so a difference in any field — rail, sentence, detail — is red.
      expect(JSON.stringify(existing)).toEqual(JSON.stringify(absent))
      expect(existing['rail']).toBe('may-not-create-agents')
      // ⛔ …and the same for a malformed one, which is the arm this dispatch moved.
      const malformed = await tools.call('create_agent', { profile_slug: 42 })
      expect(JSON.stringify(malformed)).toEqual(JSON.stringify(absent))

      // 🔴 **The control, and without it every line above passes over an app that answers nothing.**
      // ⚠️ An ENTITLED caller can tell the two names apart — so the fold above is a fold and not an
      // absence of information.
      grant('worker', { canCreateAgents: 'any' })
      const entitled = toolsOf(worker)
      expect((await entitled.call('create_agent', { profile_slug: 'taken' }))['rail']).toBe(
        'agent-name-taken',
      )
      expect(
        (await entitled.call('create_agent', { profile_slug: 'nobody-has-this-name' }))['outcome'],
      ).toBe('ok')
    })

    it('🔴 …and the HOST door folds them too — the tool’s wall is not the only thing standing there', async () => {
      // ⛔ **A mutation swapping the grant and the name inside `createAgentFor` SURVIVED the test
      // above**, and it survived honestly: the tool asks its own wall first, so the host door's
      // internal order never showed through the door a model meets. ⚠️ **A census that asserts a
      // BOUNDARY and not its callers proves nothing** (HO-029 §3's test half) — this is the same
      // shape from the other side, so the property is asserted at BOTH layers.
      //
      // ⚑ **Why the host door has to hold it on its own**: it is the only thing in this app that
      // writes an identity, and a caller that reaches it without going through the tool — a future
      // verb, a window path, a second tool — would meet whatever order is written there.
      await bringIdentityIntoBeing('taken')
      const worker = await anAgentRunning('worker')
      // ⚠️ **D-014 · the default is `any`**, so the unentitled caller is one a person set to `none`.
      grant('worker', { canCreateAgents: 'none' })
      const by = { ownerId: agentCallerId(worker) }
      const said = (slug: string) => ({
        slug,
        displayName: null,
        provider: null,
      })
      // ⚑ **D-042 · R2** — the 5th argument is the default model `create_agent` named: none here,
      // so the two calls differ in the name they ask for and in nothing else.
      const existing = host.createAgentFor(worker, said('taken'), by, null, null)
      const absent = host.createAgentFor(worker, said('nobody-has-this-name'), by, null, null)
      expect(JSON.stringify(existing)).toEqual(JSON.stringify(absent))
      expect(existing).toMatchObject({ ok: false, rail: 'may-not-create-agents' })
      // ⛔ **…and nothing was written on the way**, which is the half a refusal alone would not say:
      // a door that minted the row and then refused would satisfy every line above.
      expect(store.agentIdentities().map((one) => one.slug)).not.toContain('nobody-has-this-name')

      // 🔴 **The control**: entitled, the same door tells the two names apart.
      grant('worker', { canCreateAgents: 'any' })
      expect(host.createAgentFor(worker, said('taken'), by, null, null)).toMatchObject({
        ok: false,
        rail: 'agent-name-taken',
      })
      expect(host.createAgentFor(worker, said('nobody-has-this-name'), by, null, null).ok).toBe(
        true,
      )
    })

    it('⛔ …and the wall names only the CALLER, never the thing it asked about', async () => {
      const worker = await anAgentRunning('worker')
      grant('worker', { canCreateAgents: 'none' })
      const refused = await toolsOf(worker).call('create_agent', { profile_slug: 'somebody' })
      const detail = JSON.stringify(refused['detail'])
      expect(detail).not.toContain('somebody')
      // ⚑ The positive beside it: it does carry who was asking, which is what the sheet needs.
      expect(detail).toContain('worker')
    })
  })

  describe('§4 · the permanence that describes the wall it came from', () => {
    it('🔴 every messaging rail is one a column decides, and each is `until-a-person-changes-it`', () => {
      // ⛔ **HO-031 §2.5:** *a permanence that describes the wrong thing is a promise about the world
      // that is false.* ⚠️ The `-outside-your-project` rails read `permanent`, and
      // `admitMessaging` reached one only while that column resolved to `same-project` — by the
      // ruled default or an explicit choice — so widening it to `any` made the IDENTICAL call
      // succeed, which is what `permanent` denies. ⚑ D-016 deleted them with `same-project`.
      // ⚑ **D-016 · the one rail no column decided is gone**: D-014's
      // `assign-work-to-one-you-did-not-start` — no person could change who started a conversation,
      // so it was `permanent` — went with work sent as a message; a give reaches only the giver's own
      // conversation with that agent, by the shape of the act.
      for (const rail of MESSAGE_RAILS) {
        expect(messagePermanenceOf(rail), rail).toBe('until-a-person-changes-it')
        // ⚑ `retryable` is DERIVED, and the repricing must not have moved it: neither word is one a
        // caller should spin on.
        expect(messageRetryableOf(rail), rail).toBe(false)
      }
      expect([...MESSAGE_RAILS].sort()).toEqual(['may-not-assign-work', 'may-not-message'])
      // ⚑ **D-016** — the sibling pair (`may-not-assign-work` beside
      // `assign-work-outside-your-project`, one value of the same column narrower) went with
      // `same-project`; the column has one value that refuses now, and one rail for it.
    })

    it('⛔ `too-deep` is a capability a person sets, and the piece rail beside it is still `permanent`', () => {
      // ⚑ `max_depth` is a count on the grant sheet, and the caller cannot choose a shallower
      // parent — ⚑ D-016: the depth is fixed by the piece the caller holds.
      expect(permanenceOf('too-deep')).toBe('until-a-person-changes-it')
      expect(retryableOf('too-deep')).toBe(false)
      // 🔴 **The paired negative, and it is what makes this a repricing rather than a sweep.**
      // `not-your-parent` is not a column on anybody's sheet — who may command a conversation is
      // `mayCommand`'s, which no switch, capability or card changes — so no person-facing control
      // clears it, and it keeps the word this dispatch took off its neighbours.
      // ⚑ `726` · R92 removed `cwd-outside-parent`, the folder rail this line used to pin, and D-016
      // removed `not-your-project`, the placement rail that pinned it after; the parent rail one row
      // over carries the same argument.
      // ⚑ **D-016** — `not-your-parent` went with `spawn_agent`; the give's own parent rail is the
      // PIECE it is given under, and which pieces a caller holds is on nobody's sheet either.
      expect(permanenceOf('no-piece-you-hold-by-that-name')).toBe('permanent')
      // 🔴 **`499` · this line read `spawn-must-prompt` → `permanent`, and BOTH halves moved.**
      // ⛔ `366` priced it `permanent` because *"there is no switch, capability, card or setting
      // anywhere in this app that makes a spawned `auto` legal"* — and HO-036 is that switch: the
      // parent's own approvals button makes the identical call succeed. ⚑ So the successor rail
      // takes the word this test's own subject (`too-deep`) carries, for the same reason.
      expect(permanenceOf('wider-than-its-parent')).toBe('until-a-person-changes-it')
      expect(retryableOf('wider-than-its-parent')).toBe(false)
      // ⚠️ …and the vocabulary is still partitioned rather than collapsed: the spawn table uses
      // every word it has reasons for — ⚑ D-016 · the stall rule's `while-this-holds` among them.
      const words = new Set(SPAWN_RAILS.map((rail) => permanenceOf(rail)))
      expect([...words].sort()).toEqual([
        'permanent',
        'until-a-person-changes-it',
        'while-this-holds',
      ])
    })
  })
})
