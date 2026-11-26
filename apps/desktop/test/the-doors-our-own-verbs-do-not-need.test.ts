import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
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
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentCallerId, agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { SPAWN_RAILS, permanenceOf, retryableOf } from '../src/main/runtime/spawn-rails'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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
 */

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
  // Any agent can propose; direct writes are limited to the person and the creating profile.
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
  answer_question: 'nothing-its-rails-do-not-cover',
  message_agent: 'nothing-its-rails-do-not-cover',
  compact_agent: 'nothing-its-rails-do-not-cover',
  withdraw_task: 'nothing-its-rails-do-not-cover',
  create_agent: 'nothing-its-rails-do-not-cover',
  // ⚑ **D-016 · `give_work` took `spawn_agent`'s row** — it can start a conversation, as the spawn did.
  give_work: 'it-starts-something-outside-this-app',
  // ⚑ **D-016** — it names a piece or sets its status line in the owner's ledger; nothing outside.
  update_work: 'nothing-its-rails-do-not-cover',
  rename_conversation: 'nothing-its-rails-do-not-cover',
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
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => join(userData, 'resources'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    window = new RecordingSink('webContents:1', false)
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
   * an `agent:<id>` caller and the agent's own door is the one measured. ⚠️ A person's session would be
   * turned away from every question in this file by HO-007's *the human unrestricted*, which would
   * make every assertion vacuous. ⚑ **D-016** — `give_work` starts it, and its brief is its first
   * turn.
   */
  const anAgentRunning = async (profileId: string): Promise<string> => {
    await bringIdentityIntoBeing(profileId)
    const parent = await personOpens('pm')
    const given = await toolsOf(parent).call('give_work', {
      to: 'new',
      conversation_title: 'work',
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
      const declared = agentToolsFor(host, 'sess_nobody', {}).tools
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
      const declared = agentToolsFor(host, 'sess_nobody', {}).tools
      const reached = new Set(declared.map((one) => one.beyondItsRails))
      expect([...reached].sort()).toEqual([...BEYOND_ITS_RAILS].sort())
      // ⚠️ **And every word describes the VERB, never what an app should ask.** The policy lives in
      // the adapters; a member spelled as an instruction would be the policy arriving in a costume.
      for (const word of BEYOND_ITS_RAILS) {
        expect(word, word).not.toMatch(/ask|card|permission|prompt/)
      }
    })
  })

  describe('§2 · a malformed call is told its shape', () => {
    it('🔴 create_agent · a provider that is not a provider is refused as malformed, naming the field', async () => {
      const worker = await anAgentRunning('worker')
      const shaped = await toolsOf(worker).call('create_agent', {
        profile_slug: 'helper',
        provider: 'DEV-75297',
      })
      expect(shaped['rail']).toBe('malformed-request')
      expect(JSON.stringify(shaped['detail'])).toContain('provider')
    })

    it('⛔ message_agent · a call with no target and no text is refused as malformed', async () => {
      const worker = await anAgentRunning('worker')
      expect((await toolsOf(worker).call('message_agent', { kind: 'follow-up' }))['rail']).toBe(
        'malformed-request',
      )
    })
  })

  describe('§3 · creating an agent', () => {
    it('🔴 the tool tells a taken name from a free one, and a stored can_create_agents stops nothing', async () => {
      await bringIdentityIntoBeing('taken')
      const worker = await anAgentRunning('worker')
      // The retired column is no longer read.
      db.prepare(`UPDATE agent_identity SET can_create_agents = 'none' WHERE slug = 'worker'`).run()
      const tools = toolsOf(worker)
      expect((await tools.call('create_agent', { profile_slug: 'taken' }))['rail']).toBe(
        'agent-name-taken',
      )
      expect(
        (await tools.call('create_agent', { profile_slug: 'nobody-has-this-name' }))['outcome'],
      ).toBe('ok')
      expect(store.agentIdentityOf('nobody-has-this-name')?.createdBy).toEqual({
        by: 'an-agent',
        agent: 'worker',
      })
    })

    it('🔴 …and the HOST door tells them apart too, writing nothing for a taken name', async () => {
      await bringIdentityIntoBeing('taken')
      const worker = await anAgentRunning('worker')
      const by = { ownerId: agentCallerId(worker) }
      const said = (slug: string) => ({
        slug,
        displayName: null,
        provider: null,
      })
      const before = store.agentIdentities().length
      expect(host.createAgentFor(worker, said('taken'), by, null, null)).toMatchObject({
        ok: false,
        rail: 'agent-name-taken',
      })
      expect(store.agentIdentities()).toHaveLength(before)
      expect(host.createAgentFor(worker, said('nobody-has-this-name'), by, null, null).ok).toBe(
        true,
      )
    })
  })

  describe('§4 · the permanence that describes the wall it came from', () => {
    it('⛔ the piece rail is `permanent`, and the rail a person can clear is not', () => {
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
      // parent's own approvals button makes the identical call succeed, so it reads
      // `until-a-person-changes-it`.
      expect(permanenceOf('folder-unusable')).toBe('until-a-person-changes-it')
      expect(retryableOf('folder-unusable')).toBe(false)
      const words = new Set(SPAWN_RAILS.map((rail) => permanenceOf(rail)))
      expect([...words].sort()).toEqual(['permanent', 'until-a-person-changes-it'])
    })
  })
})
