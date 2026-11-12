import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'
import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions } from '@brobot2/runtime'
import { type AgentToolset } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import {
  TOOL_NAMES,
  TOOL_REFUSALS,
  refuseTool,
  type ToolName,
} from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { composeProfileBundle, thisConversationSpans } from '../src/main/runtime/factory-text'
import { messageNamingThePiece } from '../src/main/runtime/reply-rails'
import { SPAWN_RAILS, refuse } from '../src/main/runtime/spawn-rails'

import { REPLY_RAILS, refuseReply } from '../src/main/runtime/reply-rails'
import { QUESTION_RAILS, refuseQuestion } from '../src/main/runtime/question-rails'
import { INTERRUPT_RAILS, refuseInterrupt } from '../src/main/runtime/interrupt-rails'
import { RESOURCE_RAILS, refuseResource } from '../src/main/resources/resources'
import { MODEL_RAILS, refuseModel } from '../src/main/runtime/model-rails'
import {
  WORK_SEARCH_RAILS,
  WORK_SEARCH_REFUSAL_WORDS,
  workSearchRefusal,
} from '../src/shared/work-search-words'
import { DEFAULT_CAPABILITIES, type ProfileCapabilities } from '../src/shared/capabilities'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { withoutWhatThisAppAdds } from './lib/what-this-app-adds'
import { ToolWatchingResumeRuntime as ToolWatchingRuntime } from './lib/provider-double'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** The prefix of the line `messageNamingThePiece` composes; the label after it varies. */
const FINISHING_LINE = 'Finish it by calling reply_to_parent with piece '

/** The shape of a piece's label, as a model reading a turn sees it. */
const A_LABEL = /W[1-9][0-9]*(?:\.[1-9][0-9]*)+/

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

describe('what an agent is told about its work', () => {
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
  let claimed: Set<string>
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
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
      readProviderConfig: fixtureProviderConfig,
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-told-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-told-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_000_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    handed = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
    claimed = new Set<string>()
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
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const theToolsetJustHandedOut = (): AgentToolset => {
    const last = handed.at(-1)
    if (last === undefined) throw new Error('no toolset was handed to that launch')
    return last
  }

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  /** What the provider was handed: the double republishes each send as `echo: <text>`. */
  const saidToProvider = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      // The message, without the block this app adds at its end.
      .map((text) => withoutWhatThisAppAdds(text.slice('echo: '.length)))

  /** What the ledger kept as the turn, which is deliberately the giver's words alone. */
  const turnsOn = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'user_turn')
      .map((event) => (event as { text: string }).text)

  /** A PM in a window that gives work to a worker; the brief is the worker's first turn. */
  const aPmAndItsWorker = async (
    brief = 'the work this dispatch is about',
  ): Promise<{
    pm: string
    worker: string
    pmTools: AgentToolset
    workerTools: AgentToolset
    given: Record<string, unknown>
  }> => {
    await bringIdentityIntoBeing('worker')
    const pm = await personOpens('pm')
    const pmTools = theToolsetJustHandedOut()
    const given = await callOn(pmTools, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'The work',
      brief,
    })
    expect(given.outcome, JSON.stringify(given)).toBe('ok')
    return {
      pm,
      worker: given.agent as string,
      pmTools,
      workerTools: theToolsetJustHandedOut(),
      given,
    }
  }

  const cardOn = async (sessionId: string): Promise<string> => {
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'permission_request'),
      'the card the turn parks on',
    )
    const asked = ledger(sessionId)
      .filter((event) => event.type === 'permission_request')
      .at(-1)
    if (asked === undefined || asked.type !== 'permission_request') {
      throw new Error('no permission request on the ledger')
    }
    return asked.id
  }

  const letTheTurnFinish = async (sessionId: string): Promise<void> => {
    const id = await cardOn(sessionId)
    if (!claimed.has(sessionId)) {
      host.claimSession(sessionId, window)
      claimed.add(sessionId)
    }
    await host.respondPermission(sessionId, id, { outcome: 'allow' }, window)
    await waitFor(
      () => ledger(sessionId).some((event) => event.type === 'turn'),
      'the turn to reach its own terminal',
    )
  }

  describe('the turn a worker’s provider receives', () => {
    it('names the piece, and the ledger keeps the giver’s words alone', async () => {
      const { worker, given } = await aPmAndItsWorker('read the brief and report')
      expect(given.delivery, 'the child was new, so this is the straight-out branch').toBe('sent')

      const [piece] = store.piecesOwnedBy(worker)
      expect(piece, 'no piece was recorded for that give').toBeDefined()
      expect(piece?.label).toBe(given.label)

      const [handedOver] = saidToProvider(worker)
      expect(handedOver).toContain('read the brief and report')
      expect(handedOver).toContain(`${FINISHING_LINE}${String(piece?.label)}`)

      expect(turnsOn(worker)).toEqual(['read the brief and report'])
      expect(turnsOn(worker)[0]).not.toContain('reply_to_parent')
      expect(piece?.brief).toBe('read the brief and report')
    })

    it('the label a model would copy out of that turn is the one the tool accepts', async () => {
      const { worker, workerTools } = await aPmAndItsWorker('do the thing')
      // Read the way a model reads it: out of the provider's own text, by shape alone.
      const copied = A_LABEL.exec(saidToProvider(worker)[0] ?? '')?.[0]
      expect(copied, 'no label of the documented shape was in the turn').toBeDefined()

      const replied = await callOn(workerTools, 'reply_to_parent', {
        piece: copied,
        outcome: 'done',
        summary: 'the thing is done',
      })
      expect(replied.outcome, JSON.stringify(replied)).toBe('ok')
      expect(replied.label).toBe(copied)
      expect(store.piecesOwnedBy(worker)[0]?.state).toBe('answered')
    })

    it('a child that was busy is told at the flush, which is where its turn is composed', async () => {
      const { worker, pmTools } = await aPmAndItsWorker('first')
      await cardOn(worker)
      const held = await callOn(pmTools, 'give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'worker',
        title: 'The second',
        brief: 'second',
      })
      expect(held.agent).toBe(worker)
      expect(held.delivery, JSON.stringify(held)).toBe('held')

      const pieces = store.piecesOwnedBy(worker)
      expect(pieces.map((one) => one.state)).toEqual(['working', 'waiting'])

      await letTheTurnFinish(worker)
      await waitFor(() => saidToProvider(worker).length === 2, 'the held brief to be flushed')

      const [first, second] = saidToProvider(worker)
      expect(first).toContain(`${FINISHING_LINE}${String(pieces[0]?.label)}`)
      expect(second).toContain(`${FINISHING_LINE}${String(pieces[1]?.label)}`)
      expect(pieces[0]?.label).not.toBe(pieces[1]?.label)
    })

    it('a turn that is not a piece grows no finishing line — the app’s own, and a person’s', async () => {
      const { pm, worker, workerTools, given } = await aPmAndItsWorker('go')
      await cardOn(worker)

      // The app's delivery of a reply into the parent names the piece but is not a piece.
      await callOn(workerTools, 'reply_to_parent', {
        piece: given.piece,
        outcome: 'done',
        summary: 'finished it',
      })
      await waitFor(() => saidToProvider(pm).length > 0, 'the reply to reach the parent')
      const intoTheParent = saidToProvider(pm).at(-1) ?? ''
      expect(intoTheParent).toContain(String(given.label))
      expect(intoTheParent).not.toContain(FINISHING_LINE)
      expect(store.piecesOwnedBy(pm)).toEqual([])

      // A person typing into the child once the brief's turn is over.
      await letTheTurnFinish(worker)
      await host.send(worker, 'what are you doing?', window)
      await waitFor(
        () => saidToProvider(worker).length === 2,
        'the person’s message to be handed over',
      )
      expect(saidToProvider(worker)[1]).toBe(
        messageNamingItsSender('what are you doing?', THE_PERSON_AT_A_WINDOW),
      )
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)
    })

    it('the composer: no piece, no line — and an empty message is still a line', () => {
      expect(messageNamingThePiece('words', null)).toBe('words')
      expect(messageNamingThePiece('', null)).toBe('')
      const composed = messageNamingThePiece('', { label: 'W1.2', inputs: [] })
      expect(composed.startsWith('This is piece W1.2.')).toBe(true)
      expect(composed).toContain(`${FINISHING_LINE}W1.2`)
      expect(composed).not.toContain('\n')
      // The label is not the last token, so a model copying it copies no trailing character.
      expect(composed.trimEnd().endsWith('W1.2')).toBe(false)
    })

    it('the finishing line names the piece and carries no address', async () => {
      const { pm, worker } = await aPmAndItsWorker('go')
      const line = (saidToProvider(worker)[0] ?? '').split('\n').at(-1) ?? ''
      expect(line).toContain(FINISHING_LINE)
      expect(A_LABEL.test(line)).toBe(true)
      expect(line).not.toContain(pm)
      expect(line).not.toContain('sess_')
    })
  })

  describe('the tools the composed text names', () => {
    const launchedWith = (capabilities: ProfileCapabilities | null): string =>
      `${composeProfileBundle({ configured: null })}${
        thisConversationSpans({
          profileSlug: 'somebody',
          cwd: '/w',
          startedBy: null,
          depth: 0,
          spawningEnabled: true,
          capabilities,
          root: 'W1',
          others: { shown: [], more: 0 },
        }).text
      }`

    it('every snake_case name in the whole composed bundle is a tool this app publishes', () => {
      const named = [
        ...new Set(
          Array.from(
            launchedWith(DEFAULT_CAPABILITIES).matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g),
            (found) => found[0],
          ),
        ),
      ]
      const published: readonly string[] = TOOL_NAMES
      for (const name of named) {
        expect(published, `the bundle names ${name}, which no tool is called`).toContain(name)
      }
      expect(named.sort()).toEqual(['ask_question', 'request_action', 'update_work'])
    })
  })

  describe('one word, one rule, across every rail vocabulary', () => {
    const VOCABULARIES = [
      {
        name: 'WORK_SEARCH_RAILS',
        rails: WORK_SEARCH_RAILS,
        reason: (rail: string) =>
          workSearchRefusal(
            rail.slice('work-search-'.length) as keyof typeof WORK_SEARCH_REFUSAL_WORDS,
          ).reason,
        permanence: (rail: string) =>
          workSearchRefusal(
            rail.slice('work-search-'.length) as keyof typeof WORK_SEARCH_REFUSAL_WORDS,
          ).permanence,
      },
      {
        name: 'SPAWN_RAILS',
        rails: SPAWN_RAILS as readonly string[],
        reason: (rail: string) => refuse(rail as never).reason,
        permanence: (rail: string) => refuse(rail as never).permanence,
      },
      {
        name: 'TOOL_REFUSALS',
        rails: TOOL_REFUSALS as readonly string[],
        reason: (rail: string) => refuseTool(rail as never).reason,
        permanence: (rail: string) => refuseTool(rail as never).permanence,
      },

      {
        name: 'REPLY_RAILS',
        rails: REPLY_RAILS as readonly string[],
        reason: (rail: string) => refuseReply(rail as never).reason,
        permanence: (rail: string) => refuseReply(rail as never).permanence,
      },
      {
        name: 'QUESTION_RAILS',
        rails: QUESTION_RAILS as readonly string[],
        reason: (rail: string) => refuseQuestion(rail as never).reason,
        permanence: (rail: string) => refuseQuestion(rail as never).permanence,
      },
      {
        name: 'INTERRUPT_RAILS',
        rails: INTERRUPT_RAILS as readonly string[],
        reason: (rail: string) => refuseInterrupt(rail as never).reason,
        permanence: (rail: string) => refuseInterrupt(rail as never).permanence,
      },
      {
        name: 'RESOURCE_RAILS',
        rails: RESOURCE_RAILS as readonly string[],
        reason: (rail: string) => refuseResource(rail as never).reason,
        permanence: (rail: string) => refuseResource(rail as never).permanence,
      },
      {
        name: 'MODEL_RAILS',
        rails: MODEL_RAILS as readonly string[],
        reason: (rail: string) => refuseModel(rail as never).reason,
        permanence: (rail: string) => refuseModel(rail as never).permanence,
      },
    ] as const

    it('a rail name shared across vocabularies means the same permanence everywhere', () => {
      const names = VOCABULARIES.flatMap((one) => one.rails)
      const shared = [...new Set(names.filter((name, at) => names.indexOf(name) !== at))]
      expect(shared.length).toBeGreaterThan(0)
      for (const rail of shared) {
        const permanences = new Set(
          VOCABULARIES.filter((one) => (one.rails as readonly string[]).includes(rail)).map((one) =>
            one.permanence(rail),
          ),
        )
        expect(permanences.size, `${rail} means two things`).toBe(1)
      }
      for (const one of VOCABULARIES) {
        expect(new Set(one.rails).size, one.name).toBe(one.rails.length)
      }
    })

    it('no two rails anywhere share a sentence', () => {
      const sentences = VOCABULARIES.flatMap((one) => one.rails.map((rail) => one.reason(rail)))
      expect(new Set(sentences).size).toBe(sentences.length)
      expect(sentences.every((one) => typeof one === 'string' && one.includes(' '))).toBe(true)
    })
  })
})
