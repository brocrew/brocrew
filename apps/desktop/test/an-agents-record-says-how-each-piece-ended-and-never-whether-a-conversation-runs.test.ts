import { HandleKeepingRuntime as ProviderDouble } from './helpers/handle-keeping-runtime'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { waitFor } from './lib/f093-host'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { resourcesRoot } from '../src/main/resources/resources'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

import { FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, ApprovalMode, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

interface Answer {
  readonly structured: Record<string, unknown>
  readonly text: string
}

interface ConversationPayload {
  readonly agent: string
  readonly label: string | null
  readonly started_by: { readonly kind: string; readonly agent?: string }
  readonly started_at: number
  readonly last_changed_at: number
  readonly replaced_by?: string
}

interface PiecePayload {
  readonly label: string
  readonly title: string
  readonly agent: string
  readonly given_by: { readonly kind: string; readonly agent?: string }
  readonly given_at: number
  readonly stands: string
  readonly outcome?: string
  readonly ended_at?: number
}
const RULES = 'You are a careful tester of web pages.\nReport what fails.'
const NOT_TOLD =
  'How its standing rules begin is told only to a caller that can reach its conversations.'

describe('an agent’s record — the cases beyond what-an-agent-has-done', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let handles: FakeSessionHandle[]
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => (clock += 1_000)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-record-gaps-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-record-gaps-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_790_000_000_000
    store = createSessionStore(db, tick)
    counter = 0
    handles = []
    issued = new FakeProviderSessions()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new ProviderDouble(provider, handles, issued),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      interruptWaitMs: 40,
      announce: () => {},
      readProviderConfig: fixtureProviderConfig,
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (
    profileId: string,
    approvalMode: ApprovalMode = 'auto',
  ): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode, cwd: root },
      window,
    )
    return sessionId
  }

  const fullCall = async (
    toolset: AgentToolset,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Answer> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    const answer = await tool.call(args)
    return { structured: answer.structured as Record<string, unknown>, text: answer.text }
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const gives = async (
    tools: AgentToolset,
    title: string,
    brief: string = title,
  ): Promise<{ label: string; holder: string }> => {
    const given = await fullCall(tools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'tester',
      title,
      brief,
    })
    expect(given.structured, given.text).toMatchObject({ outcome: 'ok' })
    const holder = given.structured.agent as string
    const label = given.structured.label as string
    await waitFor(
      () =>
        ledger(holder).some(
          (event) => event.type === 'assistant_message' && event.text.includes(brief),
        ) && store.piecesOwnedBy(holder).some((one) => one.label === label),
      `${label}'s brief to reach its holder`,
    )
    await waitFor(
      () => turnsIn(holder) >= ledger(holder).filter((event) => event.type === 'user_turn').length,
      'its turn to end',
    )
    return { label, holder }
  }

  const theAppStops = async (conversation: string): Promise<void> => {
    await host.close(conversation, THE_APP_ITSELF)
    await waitFor(() => isNotRunning(conversation), `${conversation} to stop`)
  }

  const runningOf = (conversation: string): string | undefined =>
    host.resumableSessions().find((row) => row.sessionId === conversation)?.running

  const isNotRunning = (conversation: string): boolean => {
    const running = runningOf(conversation)
    return running === undefined || running === 'not-running'
  }

  const theRecordOf = (tools: AgentToolset, profile: string): Promise<Answer> =>
    fullCall(tools, 'list_profiles', { profile })

  const conversationLines = (text: string): string[] => {
    const block = text
      .split('\n\n')
      .find((one) => one.startsWith('Its conversations you can reach'))
    if (block === undefined) throw new Error(`no conversations block: ${text}`)
    return block.split('\n').filter((line) => line.startsWith('  - '))
  }

  describe('1 · the record never says whether a conversation runs', () => {
    it('read while one conversation is mid-turn and another was stopped, "running" is nowhere in it — and the two read alike', async () => {
      const parkedGiver = await personOpens(DEFAULT_PROFILE_ID, 'ask')
      const parkedTools = agentToolsFor(host, parkedGiver)
      const first = await fullCall(parkedTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'tester',
        new: true,
        title: 'Check the forms',
        brief: 'check the forms',
      })
      expect(first.structured, first.text).toMatchObject({ outcome: 'ok', label: 'W1.1' })
      const parked = first.structured.agent as string
      await waitFor(
        () => ledger(parked).some((event) => event.type === 'permission_request'),
        'the parked helper’s card',
      )

      const reader = await personOpens(DEFAULT_PROFILE_ID)
      const readerTools = agentToolsFor(host, reader)
      const second = await gives(readerTools, 'Check the links')
      expect(second.holder).not.toBe(parked)
      await theAppStops(second.holder)

      expect(runningOf(parked), 'the parked helper runs').toBeDefined()
      expect(runningOf(parked), 'the parked helper runs').not.toBe('not-running')
      expect(isNotRunning(second.holder), 'the stopped helper does not').toBe(true)

      const record = await theRecordOf(readerTools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok', profile: 'tester' })
      const conversations = record.structured.conversations as ConversationPayload[]
      expect(conversations.map((one) => one.agent).sort()).toEqual([parked, second.holder].sort())

      expect(record.text).not.toMatch(/running/i)
      expect(record.text).not.toMatch(/a message starts it again/i)
      expect(JSON.stringify(record.structured)).not.toMatch(/running/i)
      for (const one of conversations) {
        expect(Object.keys(one).sort(), one.agent).toEqual(
          ['agent', 'label', 'last_changed_at', 'started_at', 'started_by'].sort(),
        )
      }
      const lines = conversationLines(record.text)
      expect(lines).toHaveLength(2)
      for (const line of lines) {
        expect(line).toMatch(
          /^ {2}- .+ · (?:you started it|started by .+|a person started it) at [^·]+ · last changed at [^·]+$/,
        )
      }
      expect(record.text).toContain('get_agent_status says what any of them is doing now.')
    })
  })

  describe('2 · replaced conversations name the one standing now', () => {
    it('a conversation replaced twice, and its stand-in, each name the end of the chain', async () => {
      const giver = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, giver)
      const made = await fullCall(tools, 'create_agent', { profile_slug: 'tester', rules: RULES })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      const { label, holder } = await gives(tools, 'Ship the clock page')

      const replaceWhatStandsFor = async (conversation: string): Promise<string> => {
        await theAppStops(conversation)
        issued.forgetAll()
        const woken = await fullCall(tools, 'message_agent', {
          agent: holder,
          kind: 'follow-up',
          piece: label,
          text: 'carry on',
        })
        expect(woken.structured, woken.text).toMatchObject({ outcome: 'ok' })
        const standIn = woken.structured.went_to as string
        expect(typeof standIn).toBe('string')
        expect(standIn).not.toBe(conversation)
        await waitFor(() => turnsIn(standIn) > 0, `${standIn} to take the follow-up`)
        return standIn
      }
      const firstStandIn = await replaceWhatStandsFor(holder)
      const secondStandIn = await replaceWhatStandsFor(firstStandIn)
      expect(secondStandIn).not.toBe(holder)

      const record = await theRecordOf(tools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok' })
      const byId = new Map(
        (record.structured.conversations as ConversationPayload[]).map((one) => [one.agent, one]),
      )
      expect([...byId.keys()].sort()).toEqual([holder, firstStandIn, secondStandIn].sort())
      expect(byId.get(holder)?.replaced_by).toBe(secondStandIn)
      expect(byId.get(firstStandIn)?.replaced_by).toBe(secondStandIn)
      expect(byId.get(secondStandIn)).not.toHaveProperty('replaced_by')
      expect(record.text).toMatch(
        new RegExp(
          ` {2}- the owner of ${label.replace('.', '\\.')} · Ship the clock page · you started it at .* · it could not be reopened, so conversation ${secondStandIn} \\(it holds no work\\) took its place\\n`,
        ),
      )
      expect(record.text).toContain(
        `  - conversation ${firstStandIn} (it holds no work) · you started it at `,
      )
      expect(record.text).not.toContain(`so conversation ${firstStandIn} (it holds no work) took`)
      expect(record.text).not.toMatch(/running/i)
    })
  })

  describe('3 · each piece’s ending, with every outcome an answer has', () => {
    it('answered blocked, failed and done each say their outcome and when; an open piece carries neither', async () => {
      const giver = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, giver)
      const made = await fullCall(tools, 'create_agent', { profile_slug: 'tester' })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      let holder: string | null = null
      const answers = [
        ['Alpha page', 'blocked'],
        ['Beta page', 'failed'],
        ['Gamma page', 'done'],
      ] as const
      for (const [n, [title, outcome]] of answers.entries()) {
        const given = await gives(tools, title, `zebra brief ${String(n)}`)
        holder ??= given.holder
        expect(given.holder).toBe(holder)
        const replied = await fullCall(agentToolsFor(host, given.holder), 'reply_to_parent', {
          piece: given.label,
          outcome,
          summary: `quokka summary ${String(n)}`,
        })
        expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
      }
      const open = await gives(tools, 'Delta page', 'zebra brief open')
      expect(open.holder).toBe(holder)

      const record = await theRecordOf(tools, 'tester')
      expect(record.structured, record.text).toMatchObject({ outcome: 'ok', pieces_not_listed: 0 })
      const pieces = record.structured.pieces as PiecePayload[]
      expect(pieces.map((one) => [one.title, one.stands, one.outcome ?? null])).toEqual([
        ['Delta page', 'open', null],
        ['Gamma page', 'answered', 'done'],
        ['Beta page', 'answered', 'failed'],
        ['Alpha page', 'answered', 'blocked'],
      ])
      const [delta, ...ended] = pieces
      expect(delta).not.toHaveProperty('ended_at')
      expect(delta).not.toHaveProperty('outcome')
      for (const one of ended) {
        expect(typeof one.ended_at, one.title).toBe('number')
        expect(one.ended_at ?? 0, one.title).toBeGreaterThanOrEqual(one.given_at)
      }
      expect(record.text).toMatch(
        / {2}- W1\.4 · Delta page · given by you at [^·\n]+ · still open\n/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.3 · Gamma page · given by you at [^·\n]+ · answered \(done\) at [^·\n]+\n/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.2 · Beta page · given by you at [^·\n]+ · answered \(failed\) at [^·\n]+\n/,
      )
      expect(record.text).toMatch(
        / {2}- W1\.1 · Alpha page · given by you at [^·\n]+ · answered \(blocked\) at [^·\n]+\n/,
      )
      for (const said of ['zebra', 'quokka']) {
        expect(record.text).not.toContain(said)
        expect(JSON.stringify(record.structured)).not.toContain(said)
      }
    })
  })

  describe('5 · how its rules begin', () => {
    it('both its starter and another caller see its conversations and how its rules begin', async () => {
      const starter = await personOpens(DEFAULT_PROFILE_ID)
      const outsider = await personOpens(DEFAULT_PROFILE_ID)
      const starterTools = agentToolsFor(host, starter)
      const outsiderTools = agentToolsFor(host, outsider)
      const made = await fullCall(starterTools, 'create_agent', {
        profile_slug: 'tester',
        rules: RULES,
      })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })
      const { holder, label: first } = await gives(starterTools, 'Build the clock page')
      const replied = await fullCall(agentToolsFor(host, holder), 'reply_to_parent', {
        piece: first,
        outcome: 'done',
        summary: 'built',
      })
      expect(replied.structured, replied.text).toMatchObject({ outcome: 'ok' })
      await gives(starterTools, 'Test the clock page')

      const before = await theRecordOf(outsiderTools, 'tester')
      expect(before.structured, before.text).toMatchObject({
        outcome: 'ok',
        rules_told: true,
        rules_begin: 'You are a careful tester of web pages.',
      })

      const told = await theRecordOf(starterTools, 'tester')
      expect(told.structured, told.text).toMatchObject({
        outcome: 'ok',
        rules_told: true,
        rules_begin: 'You are a careful tester of web pages.',
        conversations_not_listed: 0,
        pieces_not_listed: 0,
      })
      expect(
        (told.structured.conversations as ConversationPayload[]).map((one) => one.agent),
      ).toEqual([holder])
      expect((told.structured.pieces as PiecePayload[]).length).toBe(2)
      expect(told.text).toContain(
        'Its standing rules begin: “You are a careful tester of web pages.”',
      )
      expect(told.text).not.toContain(NOT_TOLD)

      const outsiderRecord = await theRecordOf(outsiderTools, 'tester')
      expect(outsiderRecord.structured).toMatchObject({
        outcome: 'ok',
        rules_told: true,
        rules_begin: 'You are a careful tester of web pages.',
        conversations_not_listed: 0,
      })
      expect(
        (outsiderRecord.structured.conversations as ConversationPayload[]).map((one) => one.agent),
      ).toEqual([holder])
      expect((outsiderRecord.structured.pieces as PiecePayload[]).length).toBe(2)
    })
  })

  describe('6 · the profile is read as the roster names it', () => {
    it('TESTER and “  Tester  ” open tester’s record', async () => {
      const giver = await personOpens(DEFAULT_PROFILE_ID)
      const tools = agentToolsFor(host, giver)
      const made = await fullCall(tools, 'create_agent', { profile_slug: 'tester', rules: RULES })
      expect(made.structured, made.text).toMatchObject({ outcome: 'ok' })

      for (const spelled of ['TESTER', '  Tester  ']) {
        const record = await theRecordOf(tools, spelled)
        expect(record.structured, `${spelled}: ${record.text}`).toMatchObject({
          outcome: 'ok',
          profile: 'tester',
          rules_begin: 'You are a careful tester of web pages.',
        })
      }
    })
  })
})
