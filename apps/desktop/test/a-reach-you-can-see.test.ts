import { callOn } from './helpers/call-agent-tool'
import { personOpenerOverIpc } from './helpers/person-opens-session'
import { ToolWatchingRuntime } from './lib/provider-double'
import {
  neutralHostDeps,
  RecordingSink,
  latestToolset,
  syntheticProviderHome,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import type { CallerIdentity } from '../src/main/runtime/runtime-host'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { agentStateWords } from '../src/shared/agent-state'

/** Any agent sees, reads and messages a conversation it did not start. */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** Keeps the toolsets the HOST handed out, so an agent's calls go through the real one. */
describe('433 §B · the agents a reach can see', () => {
  let userData: string
  let root: string
  let elsewhere: string
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
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new ToolWatchingRuntime(provider, handed, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-seeing-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-seeing-root-'))
    elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-seeing-elsewhere-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
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
    for (const dir of [userData, root, elsewhere]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = personOpenerOverIpc(() => ({ host, root, window }))
  const theToolsetJustHandedOut = (): AgentToolset => latestToolset(handed)

  /** What an agent's own calls look like from outside the toolset — `agent:<its session>`. */
  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  const idsListedBy = async (toolset: AgentToolset): Promise<string[]> => {
    const listed = (await callOn(toolset, 'list_agents', {})) as { agents: { agent: string }[] }
    return listed.agents.map((one) => one.agent).sort()
  }

  /** Two callers, neither of which started the target. */
  const twoCallersAndOneTarget = async (): Promise<{
    brobot: string
    brobotTools: AgentToolset
    explorer: string
    explorerTools: AgentToolset
    manager: string
  }> => {
    const manager = await personOpens('pm')
    const brobot = await personOpens(DEFAULT_PROFILE_ID)
    const brobotTools = theToolsetJustHandedOut()
    const explorer = await personOpens('explorer')
    const explorerTools = theToolsetJustHandedOut()
    expect(store.parentOf(manager)).toBeNull()
    return { brobot, brobotTools, explorer, explorerTools, manager }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · reading and messaging answer different questions
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the ruling, as two callers over one target', () => {
    /** Both readers answer for the same known conversation. */
    it('both callers read a conversation they did not start, and both may message it', async () => {
      const { brobot, brobotTools, explorer, explorerTools, manager } =
        await twoCallersAndOneTarget()

      // ⚑ **All three, and the third one is the measurement's own control**: a global reach reaches
      // everything, so `explorer` — a conversation BroBot did not start, in BroBot's own project —
      // is named too. ⛔ A list of exactly *the caller plus the foreign one* would have been a list
      // about projects, which is not what this grant says.
      expect(await idsListedBy(brobotTools)).toEqual([brobot, explorer, manager].sort())
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { agent: manager },
      })

      expect(await idsListedBy(explorerTools)).toEqual([brobot, explorer, manager].sort())
      expect(await callOn(explorerTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
        agent: { agent: manager },
      })
      expect(
        await callOn(explorerTools, 'message_agent', {
          agent: manager,
          text: 'hello',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok', agent: manager })
    })

    /** Reads report existence: a real conversation is read, a ghost is no-such-agent. */
    it('a caller reads a real conversation and is told a ghost does not exist', async () => {
      const { brobot, explorer, explorerTools, manager } = await twoCallersAndOneTarget()
      const aboutTheReal = await callOn(explorerTools, 'get_agent_status', { agent: manager })
      const aboutAGhost = await callOn(explorerTools, 'get_agent_status', {
        agent: 'sess_nobody_ever_opened',
      })
      expect(aboutTheReal).toMatchObject({ outcome: 'ok', agent: { agent: manager } })
      expect(aboutAGhost).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
      const listed = await idsListedBy(explorerTools)
      expect(listed).toEqual([brobot, explorer, manager].sort())
      expect(listed).not.toContain('sess_nobody_ever_opened')
    })

    /** The card reader answers for every known conversation, and no-such-agent for a ghost. */
    it('the card reader answers every known conversation for both callers', async () => {
      const { brobot, brobotTools, explorer, explorerTools, manager } =
        await twoCallersAndOneTarget()
      const ghost = 'sess_nobody_ever_opened'
      const targets = [brobot, explorer, manager, ghost]
      for (const [who, tools] of [
        ['brobot', brobotTools],
        ['explorer', explorerTools],
      ] as const) {
        for (const target of targets) {
          const seen = await callOn(tools, 'get_agent_status', { agent: target })
          const pair = `${who} → ${target}: ${JSON.stringify(seen)}`
          if (target === ghost)
            expect(seen, pair).toMatchObject({ outcome: 'refused', rail: 'no-such-agent' })
          else expect(seen, pair).toMatchObject({ outcome: 'ok', agent: { agent: target } })
        }
      }
    })

    /** Reader descriptions promise discovery without promising a send. */
    it('⛔ each reader promises NAMING, and `list_agents` says that seeing is not sending', async () => {
      const { brobotTools } = await twoCallersAndOneTarget()
      const saidBy = (name: string): string => {
        const tool = brobotTools.tools.find((one) => one.name === name)
        if (tool === undefined) throw new Error(`no such tool: ${name}`)
        return tool.description
      }
      // ⛔ **The warning, by name** — without it the sentence over-promises for every caller.
      // ⚑ **D-017 · R13 — rewritten true, and the warning kept**: *listed* is not *admitted*.
      expect(saidBy('list_agents')).toContain(
        "Being listed doesn't promise that a message will be taken: message_agent's answer says what happened.",
      )
      expect(saidBy('list_agents')).toContain('message_agent')
      expect(saidBy('get_agent_status')).toContain('by any of its labels or its id')
      expect(saidBy('get_agent_status')).toContain('conversation <address> · <title>')
      // ⚑ **Non-vacuity**: the reader really reads a description, and a tool that promises neither
      // is what the assertions above would otherwise be satisfied by. ⚑ **D-017** — `end_agent`
      // stood here and is gone; `interrupt_agent` is the verb that took its place below a caller.
      expect(saidBy('interrupt_agent')).not.toContain('Being listed is not a promise')
    })

    it('a listed conversation can send a note to itself and to its manager', async () => {
      const { brobot, brobotTools } = await twoCallersAndOneTarget()
      expect(await idsListedBy(brobotTools)).toContain(brobot)
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: brobot,
          text: 'hello me',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok', agent: brobot })
      const { manager } = {
        manager: (await idsListedBy(brobotTools)).filter((id) => id !== brobot)[0] as string,
      }
      expect(
        await callOn(brobotTools, 'message_agent', {
          agent: manager,
          text: 'hello you',
          kind: 'note',
        }),
      ).toMatchObject({ outcome: 'ok' })
    })

    /**
     * ⚑ **Enumerating and inspecting answer the SAME card** (§B.2's *"answer both, and say if they
     * differ"* — they do not).
     *
     * ⛔ **Byte-for-byte, in one sample**, because two readers that agreed today and were built on
     * two questions would drift the first time either moved.
     */
    it('⚑ the card `get_agent_status` answers is the card `list_agents` names', async () => {
      const { brobotTools, manager } = await twoCallersAndOneTarget()
      const listed = (await callOn(brobotTools, 'list_agents', {})) as {
        agents: { agent: string }[]
      }
      const inTheList = listed.agents.find((one) => one.agent === manager)
      const oneByOne = (await callOn(brobotTools, 'get_agent_status', { agent: manager })) as {
        agent: unknown
      }
      expect(inTheList).toBeDefined()
      expect(oneByOne.agent).toEqual(inTheList)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a card says to a caller that did not start it — 433 §B.3
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the card, whole', () => {
    /**
     * 🔴 **The judgement: nothing is redacted.**
     *
     * ⛔ **Reason 1, measured here**: the card a granted caller that did not start the conversation
     * gets is the same card the conversation's own caller gets. ⚠️ A second shape — the same row
     * with a field hollowed out — would mean two things, and the caller entitled to act on the
     * difference is the only one who could not tell them apart. ⚑ **D-016** — the card's `project`
     * field went with projects, so this no longer asserts it.
     */
    it('🔴 a card asked from across is the card its own side sees', async () => {
      const { brobotTools, manager } = await twoCallersAndOneTarget()
      const fromAcross = (await callOn(brobotTools, 'get_agent_status', { agent: manager })) as {
        agent: { whose: { profile?: string } }
      }
      expect(fromAcross.agent.whose.profile).toBe('pm')
      // ⛔ **The same card, asked by a caller nobody disputes is entitled**: the conversation
      // itself, through the `me` clause. ⚑ **D-017 · R11** — a tool's payload carries the card's one
      // state in its words (`agentStateWords`), so the host's card is compared in those words.
      const itsOwn = host.agentCard(manager, speakingAs(manager), manager)
      expect(itsOwn).not.toBeNull()
      if (itsOwn === null) throw new Error('unreachable')
      expect({ ...itsOwn, state: agentStateWords(itsOwn.state) }).toEqual(fromAcross.agent)
    })

    // ⚑ **D-016 · Reason 2 went with the field it measured** — `list_agents`' `project` filter and
    // the card's `project` are gone, so there is nothing a redaction could have emptied.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · what did NOT widen with the readers
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the verbs, and the predicate they still ask', () => {
    /** Reading a conversation does not confer ownership of its work. */
    it('⛔ `withdraw_task` names a piece, and a caller that can see the conversation still cannot take its work back', async () => {
      const { brobotTools, explorerTools, manager } = await twoCallersAndOneTarget()
      // ⚠️ **The premises, asserted**: the manager owns a root nobody gave, and BroBot sees it.
      const itsRoot = store.rootOf(manager)
      expect(itsRoot, 'a conversation a person opened owns a root').not.toBeNull()
      expect(itsRoot?.givenBy).toBeNull()
      expect(await callOn(brobotTools, 'get_agent_status', { agent: manager })).toMatchObject({
        outcome: 'ok',
      })
      const refused = await callOn(brobotTools, 'withdraw_task', { piece: itsRoot?.label })
      expect(refused, JSON.stringify(refused)).toMatchObject({
        outcome: 'refused',
        rail: 'not-a-piece-you-gave',
      })
      // ⚑ **The same call, one caller over** — the other identity meets the same word. ⛔ **The fixture's own return, never `handed.at(-1)`**
      // — a later launch would silently point this pair at a different caller and the refusal
      // would go on passing.
      expect(await callOn(explorerTools, 'withdraw_task', { piece: itsRoot?.label })).toMatchObject(
        { outcome: 'refused', rail: 'not-a-piece-you-gave' },
      )
    })
  })
})
