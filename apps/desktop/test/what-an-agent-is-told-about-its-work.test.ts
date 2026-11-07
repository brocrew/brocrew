import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'
import { waitFor } from './lib/f093-host'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
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
import { MESSAGE_RAILS, refuseMessage } from '../src/main/runtime/message-rails'
import { REPLY_RAILS, refuseReply } from '../src/main/runtime/reply-rails'
import { QUESTION_RAILS, refuseQuestion } from '../src/main/runtime/question-rails'
import { INTERRUPT_RAILS, refuseInterrupt } from '../src/main/runtime/interrupt-rails'
import { RESOURCE_RAILS, refuseResource } from '../src/main/resources/resources'
import { MODEL_RAILS, refuseModel } from '../src/main/runtime/model-rails'
import { RAIL_PERMANENCES } from '../src/shared/refusals'
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
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

const FINISHING_LINE = 'Finish it by calling reply_to_parent with piece '

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

describe('412 · what an agent is told about its work', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-412-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-412-root-'))
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

  const saidToProvider = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'assistant_message')
      .map((event) => (event as { text: string }).text)
      .filter((text) => text.startsWith('echo: '))
      .map((text) => withoutWhatThisAppAdds(text.slice('echo: '.length)))

  const turnsOn = (sessionId: string): string[] =>
    ledger(sessionId)
      .filter((event) => event.type === 'user_turn')
      .map((event) => (event as { text: string }).text)

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

  describe('§1 · the turn a worker’s provider receives', () => {
    it('🔴 names the piece, and the LEDGER keeps the giver’s words alone', async () => {
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

    it('⛔ …and the label a model would COPY out of that turn is the one the tool accepts', async () => {
      const { worker, workerTools } = await aPmAndItsWorker('do the thing')

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

    it('⚑ a child that was BUSY is told at the flush, which is where its turn is composed', async () => {
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

    it('⛔ a turn that is NOT a piece grows no FINISHING line — the app’s own, and a person’s', async () => {
      const { pm, worker, workerTools, given } = await aPmAndItsWorker('go')
      await cardOn(worker)

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

      await letTheTurnFinish(worker)
      await host.send(worker, 'what are you doing?', window)
      await waitFor(
        () => saidToProvider(worker).length === 2,
        'the person’s message to be handed over',
      )
      expect(saidToProvider(worker)[1]).toBe(
        messageNamingItsSender('what are you doing?', THE_PERSON_AT_A_WINDOW),
      )
      expect(saidToProvider(worker)[1]).not.toContain(FINISHING_LINE)
      expect(store.piecesOwnedBy(worker)).toHaveLength(1)
    })

    it('⚠️ the composer itself: no piece, no line — and an empty message is still a line', () => {
      expect(messageNamingThePiece('words', null)).toBe('words')
      expect(messageNamingThePiece('', null)).toBe('')
      const composed = messageNamingThePiece('', { label: 'W1.2', inputs: [] })
      expect(composed.startsWith('This is piece W1.2.')).toBe(true)
      expect(composed).toContain(`${FINISHING_LINE}W1.2`)
      expect(composed).not.toContain('\n')
      expect(composed.trimEnd().endsWith('W1.2')).toBe(false)
    })

    it('⛔ the line carries NO address, in any spelling — HO-015 §1.3, asserted by name', async () => {
      const { pm, worker } = await aPmAndItsWorker('go')
      const line = (saidToProvider(worker)[0] ?? '').split('\n').at(-1) ?? ''

      expect(line).toContain(FINISHING_LINE)
      expect(line).not.toContain(pm)
      expect(line).not.toContain('sess_')
      const withoutTheVerbs = line
        .replace(/reply_to_parent/g, '<the verb>')
        .replace(/ask_parent/g, '<the other verb>')
        .toLowerCase()
      for (const addressed of ['parent', 'send it to', 'reply to the', 'conversation that']) {
        expect(withoutTheVerbs, addressed).not.toContain(addressed)
      }
      expect(line).toContain('reply_to_parent')
      expect(line).toContain('ask_question')
      expect(A_LABEL.test(line)).toBe(true)
    })
  })

  describe('§2 · the tools the text names, all published', () => {
    const context = (): string => composeProfileBundle({ configured: null })

    const launchedWith = (capabilities: ProfileCapabilities | null): string =>
      `${context()}${
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

    it('⛔ every snake_case name in the whole composed bundle is a tool this app publishes', () => {
      const named = (said: string): string[] => [
        ...new Set(Array.from(said.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g), (found) => found[0])),
      ]
      const published: readonly string[] = TOOL_NAMES
      const seen = new Set<string>()
      for (const name of named(launchedWith(DEFAULT_CAPABILITIES))) {
        expect(published, `the bundle names ${name}, which no tool is called`).toContain(name)
        seen.add(name)
      }
      expect([...seen].sort()).toEqual(['ask_question', 'request_action', 'update_work'])

      const planted = named('use fake_tool_one and then fake_tool_two, twice: fake_tool_one.')
      expect(planted).toEqual(['fake_tool_one', 'fake_tool_two'])
    })
  })

  describe('§3 · one word, one rule — over a list nobody wrote out', () => {
    const VOCABULARIES = [
      {
        name: 'WORK_SEARCH_RAILS',
        module: 'shared/work-search-words.ts',
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
        module: 'runtime/spawn-rails.ts',
        rails: SPAWN_RAILS as readonly string[],
        reason: (rail: string) => refuse(rail as never).reason,
        permanence: (rail: string) => refuse(rail as never).permanence,
      },
      {
        name: 'TOOL_REFUSALS',
        module: 'runtime/agent-tools.ts',
        rails: TOOL_REFUSALS as readonly string[],
        reason: (rail: string) => refuseTool(rail as never).reason,
        permanence: (rail: string) => refuseTool(rail as never).permanence,
      },
      {
        name: 'MESSAGE_RAILS',
        module: 'runtime/message-rails.ts',
        rails: MESSAGE_RAILS as readonly string[],
        reason: (rail: string) => refuseMessage(rail as never).reason,
        permanence: (rail: string) => refuseMessage(rail as never).permanence,
      },
      {
        name: 'REPLY_RAILS',
        module: 'runtime/reply-rails.ts',
        rails: REPLY_RAILS as readonly string[],
        reason: (rail: string) => refuseReply(rail as never).reason,
        permanence: (rail: string) => refuseReply(rail as never).permanence,
      },
      {
        name: 'QUESTION_RAILS',
        module: 'runtime/question-rails.ts',
        rails: QUESTION_RAILS as readonly string[],
        reason: (rail: string) => refuseQuestion(rail as never).reason,
        permanence: (rail: string) => refuseQuestion(rail as never).permanence,
      },
      {
        name: 'INTERRUPT_RAILS',
        module: 'runtime/interrupt-rails.ts',
        rails: INTERRUPT_RAILS as readonly string[],
        reason: (rail: string) => refuseInterrupt(rail as never).reason,
        permanence: (rail: string) => refuseInterrupt(rail as never).permanence,
      },
      {
        name: 'RESOURCE_RAILS',
        module: 'resources/resources.ts',
        rails: RESOURCE_RAILS as readonly string[],
        reason: (rail: string) => refuseResource(rail as never).reason,
        permanence: (rail: string) => refuseResource(rail as never).permanence,
      },
      {
        name: 'MODEL_RAILS',
        module: 'runtime/model-rails.ts',
        rails: MODEL_RAILS as readonly string[],
        reason: (rail: string) => refuseModel(rail as never).reason,
        permanence: (rail: string) => refuseModel(rail as never).permanence,
      },
    ] as const

    const DELIBERATELY_SHARED = [
      {
        rail: 'malformed-request',
        by: ['SPAWN_RAILS', 'TOOL_REFUSALS'],
      },
      {
        rail: 'spawning-disabled',
        by: ['SPAWN_RAILS', 'TOOL_REFUSALS'],
      },
      {
        rail: 'that-conversation-has-not-started',
        by: ['INTERRUPT_RAILS', 'TOOL_REFUSALS'],
      },
      {
        rail: 'may-not-create-agents',
        by: ['SPAWN_RAILS', 'TOOL_REFUSALS'],
      },
      {
        rail: 'no-piece-by-that-name',
        by: ['TOOL_REFUSALS', 'REPLY_RAILS'],
      },
      {
        rail: 'a-conversation-with-its-questions-is-starting',
        by: ['TOOL_REFUSALS', 'REPLY_RAILS'],
      },
      {
        rail: 'its-questions-could-not-all-be-read',
        by: ['TOOL_REFUSALS', 'REPLY_RAILS'],
      },
    ] as const

    const STILL_RETRYABLE: readonly (readonly [string, string, string])[] = [
      [
        'SPAWN_RAILS',
        'no-free-worker-at-capacity',
        'a worker becomes free and the caller repeats the same give',
      ],
      [
        'TOOL_REFUSALS',
        'work-record-unavailable',
        'The current work read can become available; retry the same call then.',
      ],
      [
        'QUESTION_RAILS',
        'move-offer-is-held',
        'repeat the offer after the current person request has been recorded',
      ],
      [
        'WORK_SEARCH_RAILS',
        'work-search-unavailable',
        'the read or owned worker becomes available and the caller retries the same query',
      ],
      [
        'WORK_SEARCH_RAILS',
        'work-search-busy',
        'a queued search finishes and the caller retries after a waiting slot is released',
      ],
      [
        'TOOL_REFUSALS',
        'theme-invalid',
        'the caller fixes the printed problems and sends the theme again',
      ],
      ['TOOL_REFUSALS', 'theme-exists', 'the caller saves under a new id, or sends replace: true'],
      ['TOOL_REFUSALS', 'theme-unknown', 'the caller lists the themes and uses an id on that list'],
      [
        'TOOL_REFUSALS',
        'theme-too-large',
        'the caller uses fewer or smaller files and sends the theme again',
      ],
      [
        'TOOL_REFUSALS',
        'it-is-being-archived-or-deleted',
        'the archive or the delete lands by itself, and the same restore_agent call then answers',
      ],
      [
        'SPAWN_RAILS',
        'it-would-wait-on-itself',
        'the work the service waits on through the caller ends, and the same give then answers',
      ],
      [
        'SPAWN_RAILS',
        'its-waits-cannot-all-be-checked',
        'enough of the work the service waits on ends to check the rest, and the same give then answers',
      ],
      [
        'INTERRUPT_RAILS',
        'that-service-is-on-another-callers-piece',
        'the piece the service is on ends, and the same stop then reaches the piece it goes on to',
      ],
      [
        'TOOL_REFUSALS',
        'that-piece-is-still-queued',
        'the piece is handed over to the service, and the same message then reaches it',
      ],
      [
        'TOOL_REFUSALS',
        'that-work-is-being-sent',
        'the flush in flight ends at the next turn boundary — nobody decides anything',
      ],
      [
        'TOOL_REFUSALS',
        'a-conversation-with-its-questions-is-starting',
        'the start under way lands or fails within its bound — nobody decides anything',
      ],
      [
        'REPLY_RAILS',
        'a-conversation-with-its-questions-is-starting',
        'the start under way lands or fails within its bound — nobody decides anything',
      ],
      [
        'TOOL_REFUSALS',
        'its-questions-could-not-all-be-read',
        'the caller tries again, and asks a person if the read fails again',
      ],
      [
        'REPLY_RAILS',
        'its-questions-could-not-all-be-read',
        'the caller tries again, and asks a person if the read fails again',
      ],
      [
        'REPLY_RAILS',
        'summary-too-long',
        'the caller sends a shorter summary, with the long form as a workspace artefact',
      ],
      [
        'QUESTION_RAILS',
        'that-answer-cannot-be-sent',
        'the caller answers every part, with a value the request offers',
      ],
      [
        'QUESTION_RAILS',
        'answer-too-long',
        'the caller answers again in fewer words, with the long form in a file it names',
      ],
      [
        'INTERRUPT_RAILS',
        'that-conversation-has-not-started',
        'the launch already in flight settles, either way, without anyone acting',
      ],
      [
        'TOOL_REFUSALS',
        'that-conversation-has-not-started',
        'the launch already in flight settles, either way, without anyone acting',
      ],
      [
        'TOOL_REFUSALS',
        'the-start-it-waited-on-did-not-happen',
        'the start the give waited on settles, either way — nobody decides anything',
      ],
      [
        'TOOL_REFUSALS',
        'that-conversation-is-still-stopping',
        'the previous run is confirmed stopped, or its late provider is closed — nobody decides anything',
      ],
      [
        'TOOL_REFUSALS',
        'that-conversation-could-not-be-woken-just-now',
        'something else on the machine lets go of what it ran short of — nobody decides anything',
      ],
      [
        'TOOL_REFUSALS',
        'agent-could-not-start-just-now',
        'something else on the machine lets go of what it ran short of — nobody decides anything',
      ],
      [
        'RESOURCE_RAILS',
        'resource-unreadable',
        'the worker writes a readable file of a type the store holds and names that path',
      ],
      [
        'RESOURCE_RAILS',
        'resource-too-large',
        'the worker writes a smaller derived file and names that path',
      ],
      [
        'RESOURCE_RAILS',
        'resource-empty',
        'the worker writes a non-empty file and names that path',
      ],
      [
        'RESOURCE_RAILS',
        'resource-not-text',
        'the worker writes a UTF-8 derivative and names that path',
      ],
      [
        'MODEL_RAILS',
        'the-provider-moved-meanwhile',
        'the same give again reads the list of the provider that agent now starts on — nobody decides anything',
      ],
      [
        'MODEL_RAILS',
        'models-not-read-in-time',
        'the same give again asks the provider for its list again — nobody decides anything',
      ],
    ]

    const THE_TWELVE: readonly (readonly [string, string])[] = [
      ['TOOL_REFUSALS', 'no-such-agent'],
      ['TOOL_REFUSALS', 'agent-cannot-take-a-message'],
      ['REPLY_RAILS', 'no-piece-by-that-name'],
      ['QUESTION_RAILS', 'no-question-by-that-name'],
      ['INTERRUPT_RAILS', 'a-person-is-being-asked'],
      ['RESOURCE_RAILS', 'no-such-resource'],
      ['RESOURCE_RAILS', 'resource-store-unavailable'],
    ]

    it('🔴 424 · every rail that promises a retry is in the named roster derived from the vocabularies', () => {
      const retryable = VOCABULARIES.flatMap((one) =>
        one.rails
          .filter((rail) => one.permanence(rail) === 'while-this-holds')
          .map((rail) => `${one.name} · ${rail}`),
      )

      expect(retryable.sort()).toEqual(
        STILL_RETRYABLE.map(([vocabulary, rail]) => `${vocabulary} · ${rail}`).sort(),
      )
      expect(retryable.length).toBe(34)
      for (const [name, rail] of STILL_RETRYABLE.map(([n, r]) => [n, r] as const)) {
        const vocabulary = VOCABULARIES.find((one) => one.name === name)
        expect(vocabulary, name).toBeDefined()
        expect(vocabulary!.permanence(rail), rail).toBe('while-this-holds')
      }
    })

    it('⛔ 424 · and none of the twelve `422` measured says `while-this-holds` any more', () => {
      for (const [name, rail] of THE_TWELVE) {
        const vocabulary = VOCABULARIES.find((one) => one.name === name)
        expect(vocabulary, name).toBeDefined()
        expect(vocabulary!.rails, `${name} no longer has ${rail}`).toContain(rail)
        expect(vocabulary!.permanence(rail), rail).not.toBe('while-this-holds')
      }
      for (const [name, rail] of [
        ['SPAWN_RAILS', 'it-would-wait-on-itself'],
        ['RESOURCE_RAILS', 'resource-empty'],
      ] as const) {
        const vocabulary = VOCABULARIES.find((one) => one.name === name)
        expect(vocabulary!.permanence(rail), rail).toBe('while-this-holds')
      }
    })

    const codeOnly = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

    const everyModule = (): { path: string; source: string }[] => {
      const found: { path: string; source: string }[] = []
      const walk = (dir: string, base: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) walk(full, base)
          else if (entry.name.endsWith('.ts')) {
            found.push({ path: relative(base, full), source: readFileSync(full, 'utf8') })
          }
        }
      }
      walk(mainRoot, mainRoot)
      walk(sharedRoot, join(sharedRoot, '..'))
      return found
    }

    const namesAPermanence = (source: string): boolean =>
      RAIL_PERMANENCES.some((word) => codeOnly(source).includes(`'${word}'`))

    const CONSUMERS: readonly string[] = ['runtime/agent-tool-answer-words.ts']

    it('🔴 the registered vocabularies are ALL of them — nothing in main/ or shared/ prices a rail outside this list', () => {
      const modules = everyModule()
      const pricing = modules
        .filter((file) => namesAPermanence(file.source))
        .map((file) => file.path.split('\\').join('/'))
        .sort()

      const wrapper = codeOnly(readFileSync(join(mainRoot, 'themes/agent-tools.ts'), 'utf8'))
      expect(wrapper).toContain("import { PERMANENCE_SAID } from '../../shared/refusals'")
      const classification = "const permanent = data?.['permanence'] === 'permanent'"
      const repetition = "PERMANENCE_SAID['while-this-holds']"
      expect(wrapper).toContain(classification)
      expect(wrapper).toContain(repetition)
      expect(wrapper).toContain("`This refusal holds ${PERMANENCE_SAID['while-this-holds']}.`")
      expect(wrapper).toContain(
        "return { ...answer, text: [answer.text, ...lines, clause].join(' ') }",
      )
      expect(namesAPermanence(wrapper.replace(classification, '').replace(repetition, ''))).toBe(
        false,
      )
      const expected = [
        ...VOCABULARIES.map((one) => one.module),
        'shared/refusals.ts',
        'themes/agent-tools.ts',
        ...CONSUMERS,
      ].sort()
      expect(pricing).toEqual(expected)
      for (const path of CONSUMERS) {
        const found = modules.find((one) => one.path.split('\\').join('/') === path)
        const code = codeOnly(found?.source ?? '')
        const named = RAIL_PERMANENCES.flatMap((word) => code.split(`'${word}'`).slice(1))
        const compared = RAIL_PERMANENCES.flatMap((word) =>
          code.split(new RegExp(`[!=]==\\s*'${word}'`)).slice(1),
        )
        expect(named.length, `${path} names no permanence`).toBeGreaterThan(0)
        expect(compared.length, `${path} prices a rail`).toBe(named.length)
      }
    })

    it('⚠️ …and the sweep that says so finds TWO planted modules, and no commented one', () => {
      const planted = [
        { path: 'runtime/a-new-door.ts', source: `const P = { a: 'permanent' as const }\n` },
        {
          path: 'runtime/another-door.ts',
          source: `const Q = { b: 'while-this-holds' as const }\n`,
        },
        {
          path: 'runtime/only-a-docblock.ts',
          source: `/** it is 'until-a-person-changes-it'. */\nexport const X = 1\n`,
        },
        {
          path: 'runtime/a-line-comment.ts',
          source: `// 'permanent', said a comment\nexport const Y = 2\n`,
        },
      ]
      expect(
        planted.filter((file) => namesAPermanence(file.source)).map((one) => one.path),
      ).toEqual(['runtime/a-new-door.ts', 'runtime/another-door.ts'])
    })

    it('⛔ every rail NAME shared across vocabularies is one of the named exceptions', () => {
      const names = VOCABULARIES.flatMap((one) => one.rails)
      const duplicated = [...new Set(names.filter((name, at) => names.indexOf(name) !== at))]
      expect(duplicated.sort()).toEqual(DELIBERATELY_SHARED.map((one) => one.rail).sort())
      for (const shared of DELIBERATELY_SHARED) {
        expect(
          VOCABULARIES.filter((one) => (one.rails as readonly string[]).includes(shared.rail))
            .map((one) => one.name)
            .sort(),
          shared.rail,
        ).toEqual([...shared.by].sort())
        const permanences = new Set(
          VOCABULARIES.filter((one) => (one.rails as readonly string[]).includes(shared.rail)).map(
            (one) => one.permanence(shared.rail),
          ),
        )
        expect(permanences.size, `${shared.rail} means two things`).toBe(1)
      }
      for (const one of VOCABULARIES) {
        expect(new Set(one.rails).size, one.name).toBe(one.rails.length)
      }
    })

    it('⛔ no two rails ANYWHERE share a SENTENCE — one model meets every vocabulary through one door', () => {
      const sentences = VOCABULARIES.flatMap((one) => one.rails.map((rail) => one.reason(rail)))
      expect(new Set(sentences).size).toBe(sentences.length)
      expect(sentences.every((one) => typeof one === 'string' && one.includes(' '))).toBe(true)
      expect(sentences).toHaveLength(VOCABULARIES.flatMap((one) => one.rails).length)
    })

    it('⚑ …and the values this walks are the lists the modules export, not a copy', () => {
      for (const one of VOCABULARIES) {
        const source = codeOnly(
          readFileSync(
            join(one.module.startsWith('shared/') ? join(mainRoot, '..') : mainRoot, one.module),
            'utf8',
          ),
        )
        expect(source, `${one.name} is not exported by ${one.module}`).toContain(
          `export const ${one.name} = [`,
        )
        for (const rail of one.rails) {
          expect(source, `${one.name} lists ${rail} nowhere in ${one.module}`).toContain(
            `'${rail}'`,
          )
        }
      }
    })
  })
})
