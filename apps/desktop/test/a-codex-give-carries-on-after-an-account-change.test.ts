import { addressedGive, newConversationGive } from './lib/give-fixture'
import { StandInCodex, digestOf } from './lib/refused-codex-stand-in'
import type { RuntimeHostDeps } from '../src/main/runtime/host-dependencies'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { UserTurnEvent } from '../src/shared/human-answer-contracts'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  type FakeSessionHandle,
  type RuntimeEvent,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  DEFAULT_PROFILE_ID,
  createProviderAuthOps,
  deriveProviderHome,
  prepareProviderHome,
} from '../src/main/connections/homes'
import { RuntimeHost, type RuntimeEventSink } from './helpers/giver-notice-host'
import type { CodexSignIn } from '../src/main/providers/codex/types'
import {
  applyEvent,
  createTranscript,
  REOPENED_ON_A_RENEWED_SIGN_IN,
} from '../src/renderer/src/lib/transcript'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import { neutralHostDeps } from './lib/host-fixture'

// Fictional sign-ins are compared by digest so failures never print their contents.

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

const signIn = (account: string, token: string, refreshed: string): string =>
  JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { account_id: account, access_token: token, refresh_token: `refresh-${token}` },
    last_refresh: refreshed,
  })
const DEAD = signIn('acct-fictional-a', 'DEAD', '2026-10-08T22:00:00Z')
const BROBOTS_OWN_BEFORE = signIn('acct-fictional-a', 'BROBOT-BEFORE', '2026-10-07T09:00:00Z')
const ANOTHER_ACCOUNT = signIn('acct-fictional-b', 'OTHER', '2026-10-08T22:00:00Z')

class Sink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly ownerId = 'owner:1'
  readonly alive = true
  readonly errors: TranscriptEvent[] = []
  working = 0
  send(message: RuntimeEventMessage): void {
    if (message.event.type === 'error') this.errors.push(message.event)
    if (message.event.type === 'status' && message.event.state === 'working') this.working += 1
  }
  sendLiveness(): void {}
}

const says = (handle: FakeSessionHandle, error: RuntimeEvent): void =>
  (handle as unknown as { push(event: RuntimeEvent): void }).push(error)

class AClaude extends FakeRuntime {
  constructor(private readonly kept: FakeSessionHandle[]) {
    super('claude')
  }
  override async start(options: StartOptions): Promise<FakeSessionHandle> {
    const handle = await super.start(options)
    this.kept.push(handle)
    return handle
  }
}

describe('a Codex give refused after its profile changed account carries on once', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let codex: StandInCodex
  let accepted: Set<string>
  let starts: string[]
  let pluginAttachments: RuntimeHostDeps['pluginAttachments']
  let claudes: FakeSessionHandle[]
  let aSignIn: () => Promise<CodexSignIn>

  const helperHome = () => deriveProviderHome(userData, { profileId: 'farah', provider: 'codex' })
  const ownHome = () =>
    deriveProviderHome(userData, { profileId: DEFAULT_PROFILE_ID, provider: 'codex' })
  const accept = (...signIns: string[]) => signIns.forEach((one) => accepted.add(digestOf(one)))
  const digests = (...signIns: string[]) => signIns.map(digestOf)

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-refused-copy-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrations)
    pluginAttachments = undefined
    accepted = new Set()
    starts = []
    claudes = []
    codex = new StandInCodex(() => accepted, starts)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mkdirSync(ownHome(), { recursive: true, mode: 0o700 })
    writeFileSync(join(ownHome(), 'auth.json'), BROBOTS_OWN_BEFORE, { mode: 0o600 })
    let counter = 0
    const seams = {
      claudeAuthHealth: async () => ({ ok: true }),
    }
    const ops = createProviderAuthOps(userData, {
      codexCommand: () => join(userData, 'no-codex-is-run'),
      ...seams,
    })
    aSignIn = () => Promise.reject(new Error('no sign-in is staged'))
    host = new RuntimeHost({
      store: (store = createSessionStore(db)),
      pluginAttachments: {
        agent(occupied) {
          if (!pluginAttachments) throw new Error('fictional attachments disabled')
          return pluginAttachments.agent(occupied)
        },
      },
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => (provider === 'codex' ? codex : new AClaude(claudes)),
      prepareProviderHome: (provider, profileId) =>
        prepareProviderHome(
          userData,
          { profileId: profileId ?? DEFAULT_PROFILE_ID, provider },
          seams,
        ),
      providerHomePath: (provider, profileId) =>
        deriveProviderHome(userData, { profileId, provider }),
      providerAuth: {
        ...ops,
        signIn: () => aSignIn(),
      },
      resolveCwd: (sessionId) => join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  function aHelperHolding(copy: string): void {
    mkdirSync(helperHome(), { recursive: true, mode: 0o700 })
    const path = join(helperHome(), 'auth.json')
    rmSync(path, { force: true })
    writeFileSync(path, copy, { mode: 0o600 })
    const refreshed = Date.parse((JSON.parse(copy) as { last_refresh: string }).last_refresh) / 1000
    utimesSync(path, refreshed, refreshed)
  }
  let watching: Sink
  const start = () => {
    watching = new Sink()
    return host.createSession({ provider: 'codex', profileId: 'farah' }, watching)
  }
  describe('a turn of words refused before it did anything is carried on once the sign-in is repaired, never sent again', () => {
    const MESSAGE = 'Please summarise the open pull requests.'
    const rowsOf = (id: string): TranscriptEvent[] => store.events(id).map((row) => row.event)
    const turnsOf = (id: string): UserTurnEvent[] =>
      rowsOf(id).filter((row): row is UserTurnEvent => row.type === 'user_turn')
    const endingsOf = (id: string): string[] =>
      rowsOf(id).flatMap((row) => (row.type === 'turn' ? [row.state] : []))

    const settled = () => new Promise((resolve) => setTimeout(resolve, 150))
    describe('a give refused after the profile changes account', () => {
      async function given(): Promise<{ giver: string; helper: string; piece: string }> {
        aHelperHolding(DEAD)
        accept(DEAD, ANOTHER_ACCOUNT)
        const { sessionId: helper } = await start()
        await host.close(helper, watching)
        const { sessionId: giver } = await host.createSession(
          { provider: 'claude', profileId: DEFAULT_PROFILE_ID },
          watching,
        )
        codex.turnModes.push('held-open')
        const result = await host.giveWork(
          newConversationGive('farah', 'The open pull requests', MESSAGE),
          { ownerId: agentCallerId(giver) },
        )
        if (!result.ok) throw new Error(`refused: ${result.refusal.rail}`)
        host.claimSession(result.owner, watching)
        return { giver, helper: result.owner, piece: result.piece }
      }

      function switchAndRefuse(): void {
        aHelperHolding(ANOTHER_ACCOUNT)
        Object.assign(codex.handles.at(-1)!, { checkSignIn: async () => true })
        codex.refuseTheOpenTurn()
      }

      const housekeeping = (
        label: string,
        category: Extract<RuntimeEvent, { type: 'unknown' }>['category'] = 'lifecycle',
      ): Extract<RuntimeEvent, { type: 'unknown' }> => ({
        type: 'unknown',
        provider: 'codex',
        category,
        label,
        raw: { fictional: true },
      })
      const beforeRefusal: readonly RuntimeEvent[] = [
        housekeeping('thread/status/changed'),
        housekeeping('mcpServer/startupStatus/updated'),
        housekeeping('account/rateLimits/read'),
        housekeeping('mcpServer/startupStatus/updated'),
        housekeeping('userMessage', 'echo'),
        housekeeping('userMessage', 'echo'),
        ...Array.from({ length: 10 }, (): RuntimeEvent => ({
          type: 'error',
          message: 'Fictional transient failure.',
          fatal: false,
        })),
        housekeeping('thread/status/changed'),
        { type: 'error', message: 'Fictional refusal.', fatal: false },
      ]
      const emptyTerminals: Extract<RuntimeEvent, { type: 'background_work' }> = {
        type: 'background_work',
        source: 'thread/backgroundTerminals/list',
        running: [],
      }
      const afterReopen: readonly RuntimeEvent[] = [
        housekeeping('remoteControl/status/changed'),
        housekeeping('account/updated'),
        housekeeping('skills/changed'),
        ...Array.from({ length: 5 }, () => housekeeping('mcpServer/startupStatus/updated')),
        housekeeping('thread/status/changed'),
        emptyTerminals,
        housekeeping('thread/goal/cleared'),
        ...Array.from({ length: 4 }, () => housekeeping('mcpServer/startupStatus/updated')),
        housekeeping('account/rateLimits/read'),
        ...Array.from({ length: 5 }, () => housekeeping('mcpServer/startupStatus/updated')),
      ]
      async function heardBeforeRefusal(
        helper: string,
        events: readonly RuntimeEvent[],
      ): Promise<void> {
        const from = store.nextOrdinal(helper)
        for (const event of events) says(codex.handles.at(-1)!, event)
        await vi.waitFor(() =>
          expect(store.eventsFrom(helper, from, 400)).toHaveLength(events.length),
        )
      }
      async function reopenedWithoutCarrying(helper: string): Promise<void> {
        await vi.waitFor(() => expect(starts.at(-1)).toBe(digestOf(ANOTHER_ACCOUNT)))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
        expect(turnsOf(helper).some((turn) => turn.carriesOn === true)).toBe(false)
      }

      it('classified lifecycle and input echoes let an existing conversation carry its give on once', async () => {
        const { helper, giver } = await given()
        codex.answerTheOpenTurn()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['completed']))
        for (let n = 1; n < 28; n++) {
          await host.send(helper, 'Fictional earlier input.', watching)
          await vi.waitFor(() => expect(endingsOf(helper)).toHaveLength(n + 1))
        }
        const brief = 'Check the fictional release with its housekeeping frames.'
        codex.turnModes.push('held-open')
        const result = await host.giveWork(
          {
            ...addressedGive(helper, 'farah', 'The new fictional give', brief),
            definition_of_done: 'The fictional result is kept.',
          },
          { ownerId: agentCallerId(giver) },
        )
        if (!result.ok) throw new Error('fictional give refused')
        expect(result.owner).toBe(helper)
        const piece = result.piece
        await vi.waitFor(() => expect(codex.sent).toHaveLength(29))
        await heardBeforeRefusal(helper, beforeRefusal)
        const opened = store.newestOfType?.(helper, 'user_turn')
        if (opened?.event.type !== 'user_turn') throw new Error('fictional give not retained')
        const original = opened.event
        expect(original.parts).toBeUndefined()
        expect(original.piece).toBe(piece)
        const untilEnd = [
          'status',
          'work_given',
          ...beforeRefusal.map((event) => event.type),
          'error',
          'turn',
        ]
        switchAndRefuse()
        await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
        await vi.waitFor(() => expect(endingsOf(helper).at(-1)).toBe('completed'))
        expect(
          store
            .eventsFrom(helper, opened.ordinal + 1, untilEnd.length)
            .map(({ event }) => event.type),
        ).toEqual(untilEnd)
        expect(codex.sent).toHaveLength(29)
        expect(codex.answeredInputs).toHaveLength(29)
        expect(codex.answeredInputs.at(-1)).toContain(brief)
        expect(codex.sent.filter((text) => text.includes(brief))).toHaveLength(1)
        expect(turnsOf(helper)).toHaveLength(30)
        expect(turnsOf(helper).at(-1)).toMatchObject({
          text: '',
          carriesOn: true,
          carriedOnAfterAccountChange: true,
          drives: piece,
        })
        expect(turnsOf(helper).filter((turn) => turn.carriesOn)).toHaveLength(1)
      })

      it('startup lifecycle and an empty terminal level survive both carry-on rechecks', async () => {
        const { giver, helper, piece } = await given()
        const opened = store.newestOfType?.(helper, 'user_turn')
        if (opened === undefined || opened === null) throw new Error('the first brief is missing')
        expect(
          store
            .events(helper)
            .filter((row) => row.ordinal < opened.ordinal)
            .map((row) => row.event),
        ).toContainEqual({
          type: 'titled',
          title: 'The open pull requests',
          author: { kind: 'agent', conversation: giver },
        })
        let rechecked = 0
        codex.asItResumes = (handle) => {
          for (const event of afterReopen) says(handle, event)
          codex.checksItsSignIn = async () => {
            rechecked++
            const from = store.nextOrdinal(helper)
            says(handle, housekeeping('mcpServer/startupStatus/updated'))
            says(handle, { ...emptyTerminals, dropped: 0 })
            await vi.waitFor(() =>
              expect(store.eventsFrom(helper, from, 400).length).toBeGreaterThanOrEqual(2),
            )
            return false
          }
        }
        switchAndRefuse()
        await vi.waitFor(() => expect(codex.carriedOn).toBe(1))
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed', 'completed']))
        expect(rechecked).toBeGreaterThan(0)
        expect(codex.sent).toHaveLength(1)
        expect(codex.answeredInputs).toHaveLength(1)
        expect(codex.answeredInputs[0]).toContain(MESSAGE)
        expect(turnsOf(helper).at(-1)).toMatchObject({ carriesOn: true, drives: piece, text: '' })
      })

      const notHousekeeping: readonly { name: string; event: RuntimeEvent }[] = [
        { name: 'an unrelated lifecycle label', event: housekeeping('thread/reverted') },
        {
          name: 'tool progress classified as activity',
          event: housekeeping('command/exec/outputDelta', 'activity'),
        },
        { name: 'a non-input echo', event: housekeeping('functionCallOutput', 'echo') },
        {
          name: 'a degraded input echo',
          event: { ...housekeeping('userMessage', 'echo'), degradedFrom: 'tool_call' },
        },
        {
          name: 'an unrecognized frame with a housekeeping label',
          event: housekeeping('thread/status/changed', 'unrecognized'),
        },
        {
          name: 'a degraded tool carrying a housekeeping label',
          event: { ...housekeeping('thread/status/changed'), degradedFrom: 'tool_call' },
        },
        {
          name: 'another provider using the same label',
          event: { ...housekeeping('thread/status/changed'), provider: 'claude' },
        },
        {
          name: 'a new reply fragment',
          event: { type: 'assistant_delta', text: 'Fictional partial output.' },
        },
        {
          name: 'a tool call',
          event: {
            type: 'tool_call',
            id: 'fictional-tool',
            name: 'Read',
            summary: 'Fictional read.',
          },
        },
        {
          name: 'a tool result',
          event: {
            type: 'tool_result',
            id: 'fictional-tool',
            summary: 'Fictional result.',
            ok: true,
          },
        },
        { name: 'an empty terminal level before the refusal', event: emptyTerminals },
      ]
      for (const { name, event } of notHousekeeping) {
        it(`before refusal still rejects ${name}`, async () => {
          const { helper } = await given()
          await heardBeforeRefusal(helper, [event])
          switchAndRefuse()
          await reopenedWithoutCarrying(helper)
        })
      }

      const notStartup: readonly { name: string; event: RuntimeEvent; malformedRunning?: true }[] =
        [
          { name: 'an unrelated lifecycle label', event: housekeeping('thread/reverted') },
          { name: 'a new input echo after the ending', event: housekeeping('userMessage', 'echo') },
          {
            name: 'tool progress classified as activity',
            event: housekeeping('command/exec/outputDelta', 'activity'),
          },
          {
            name: 'a degraded tool carrying a startup label',
            event: { ...housekeeping('skills/changed'), degradedFrom: 'tool_call' },
          },
          {
            name: 'a running terminal',
            event: { ...emptyTerminals, running: [{ id: 'fictional-job' }] },
          },
          { name: 'a malformed terminal level', event: emptyTerminals, malformedRunning: true },
          {
            name: 'an absent terminal level',
            event: { type: 'background_work', source: emptyTerminals.source },
          },
          {
            name: 'an ended terminal job',
            event: { ...emptyTerminals, ended: { id: 'fictional-job', outcome: 'completed' } },
          },
          { name: 'an incomplete empty level', event: { ...emptyTerminals, dropped: 1 } },
          {
            name: 'an empty level from another source',
            event: { ...emptyTerminals, source: 'fictional-other-source' },
          },
          {
            name: 'a new tool result',
            event: {
              type: 'tool_result',
              id: 'fictional-tool',
              summary: 'Fictional result.',
              ok: true,
            },
          },
          { name: 'a provider-started turn', event: { type: 'provider_turn' } },
        ]
      for (const { name, event, malformedRunning } of notStartup) {
        it(`after reopen still rejects ${name}`, async () => {
          const { helper } = await given()
          codex.asItResumes = (handle) => {
            says(handle, event)
            codex.checksItsSignIn = async () => {
              await vi.waitFor(() => expect(rowsOf(helper)).toContainEqual(event))
              if (malformedRunning) {
                const row = store.newestOfType?.(helper, 'background_work')
                if (row === null || row === undefined) throw new Error('fictional level missing')
                db.prepare(
                  `UPDATE events SET payload=json_set(payload, '$.running', json(?))
                  WHERE session_id=? AND generation=0 AND ordinal=?`,
                ).run('{"length":0}', helper, row.ordinal)
              }
              return false
            }
          }
          switchAndRefuse()
          await reopenedWithoutCarrying(helper)
        })
      }

      it('a failed compacting give without loginRefused is not carried on', async () => {
        const { helper } = await given()
        await heardBeforeRefusal(helper, [
          housekeeping('thread/status/changed'),
          { type: 'activity', phase: 'compacting' },
          housekeeping('userMessage', 'echo'),
        ])
        aHelperHolding(ANOTHER_ACCOUNT)
        codex.refuseTheOpenTurn(false)
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed']))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(starts.at(-1)).toBe(digestOf(DEAD))
        expect(rowsOf(helper).some((event) => event.type === 'work_recovery')).toBe(false)
      })

      it('housekeeping without a loginRefused ending is still not carried on', async () => {
        const { helper } = await given()
        await heardBeforeRefusal(helper, beforeRefusal)
        aHelperHolding(ANOTHER_ACCOUNT)
        codex.refuseTheOpenTurn(false)
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed']))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(starts.at(-1)).toBe(digestOf(DEAD))
      })

      it('the first successful turn answers the retained brief once, without another send', async () => {
        const { helper, piece } = await given()
        const newest = store.newestOfType?.bind(store)
        if (newest === undefined) throw new Error('the fixture must support indexed turn reads')
        const original = newest(helper, 'user_turn')
        if (original?.event.type !== 'user_turn') throw new Error('the give has no retained input')
        switchAndRefuse()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed', 'completed']))
        expect(codex.carriedOn).toBe(1)
        expect(codex.sent).toHaveLength(1)
        expect(codex.answeredInputs).toHaveLength(1)
        expect(codex.answeredInputs[0]).toContain(MESSAGE)
        expect(newest(helper, 'work_given')?.event).toMatchObject({ piece })
        expect(turnsOf(helper)).toEqual([
          original.event,
          {
            type: 'user_turn',
            text: '',
            attribution: 'app_authored',
            carriesOn: true,
            carriedOnAfterAccountChange: true,
            drives: piece,
          },
        ])
        expect(rowsOf(helper).filter((row) => row.type === 'reopened')).toEqual([
          { type: 'reopened', because: 'the-sign-in-was-renewed' },
        ])
      })

      it('a second refusal never carries the brief on again', async () => {
        const { helper } = await given()
        codex.carryOnIsRefusedAtOnce = true
        codex.asItCarriesOn = () => {
          aHelperHolding(DEAD)
          Object.assign(codex.handles.at(-1)!, { checkSignIn: async () => true })
        }
        switchAndRefuse()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed', 'failed']))
        await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, DEAD, ANOTHER_ACCOUNT, DEAD)))
        await settled()
        expect(codex.carriedOn).toBe(1)
        expect(codex.sent).toHaveLength(1)
        expect(codex.answeredInputs).toHaveLength(0)
      })

      it('a give held behind an older turn also answers its retained input once', async () => {
        const { giver, helper } = await given()
        codex.turnModes.push('held-open')
        const next = await host.giveWork(
          {
            ...addressedGive(
              helper,
              'farah',
              'The next brief',
              'Read the fictional release notes.',
            ),
            definition_of_done: 'The result is recorded.',
          },
          { ownerId: agentCallerId(giver) },
        )
        if (!next.ok) throw new Error(`refused: ${next.refusal.rail}`)
        expect(next.owner).toBe(helper)
        expect(codex.sent).toHaveLength(1)
        codex.answerTheOpenTurn()
        await vi.waitFor(() => expect(codex.sent).toHaveLength(2))
        switchAndRefuse()
        await vi.waitFor(() =>
          expect(endingsOf(helper)).toEqual(['completed', 'failed', 'completed']),
        )
        expect(codex.carriedOn).toBe(1)
        expect(codex.sent).toHaveLength(2)
        expect(codex.answeredInputs.at(-1)).toContain('Read the fictional release notes.')
        expect(turnsOf(helper).at(-1)).toMatchObject({
          carriesOn: true,
          drives: next.piece,
          text: '',
        })
      })

      it('a same-text rebrief is still not a first give and is never carried on', async () => {
        const { giver, helper, piece } = await given()
        codex.answerTheOpenTurn()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['completed']))
        codex.turnModes.push('held-open')
        const changed = await host.updateWork(
          {
            piece,
            title: null,
            status: null,
            on: null,
            brief: MESSAGE,
            close: false,
            resources: [],
          },
          { ownerId: agentCallerId(giver) },
        )
        expect(changed.ok).toBe(true)
        await settled()
        expect(codex.sent).toHaveLength(1)
        await host.queueMessage(helper, 'Carry on with the brief.', {
          ownerId: agentCallerId(giver),
        })
        await vi.waitFor(() => expect(codex.sent).toHaveLength(2))
        expect(codex.sent[1]).toContain(MESSAGE)
        switchAndRefuse()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['completed', 'failed']))
        await settled()
        expect(codex.carriedOn).toBe(0)
      })

      for (const { author, name } of [
        {
          author: 'person',
          name: 'a queued give with an unreadable person subpart never carries the mixed input on',
        },
        {
          author: 'agent note',
          name: 'a queued give with an unreadable agent note subpart never carries the mixed input on',
        },
      ] as const) {
        it(name, async () => {
          const { giver, helper } = await given()
          const brief = 'Read the fictional release notes.'
          const other = 'Words that must not be carried across accounts.'
          codex.turnModes.push('held-open')
          const next = await host.giveWork(
            {
              ...addressedGive(helper, 'farah', 'The next brief', brief),
              definition_of_done: 'The result is recorded.',
            },
            { ownerId: agentCallerId(giver) },
          )
          if (!next.ok) throw new Error(`refused: ${next.refusal.rail}`)
          expect(next.owner).toBe(helper)
          if (author === 'person') await host.queueMessage(helper, other, watching)
          else
            await host.queueMessage(
              helper,
              other,
              { ownerId: agentCallerId(giver) },
              [],
              'work',
              {},
              'note',
            )
          expect(codex.sent).toHaveLength(1)
          codex.answerTheOpenTurn()
          await vi.waitFor(() => expect(turnsOf(helper).at(-1)?.parts).toHaveLength(2))
          expect(codex.sent).toHaveLength(2)
          expect(codex.sent[1]).toContain(brief)
          expect(codex.sent[1]).toContain(other)
          const newest = store.newestOfType?.bind(store)
          if (newest === undefined) throw new Error('the fixture must support indexed turn reads')
          const opened = newest(helper, 'user_turn')
          if (opened?.event.type !== 'user_turn' || opened.event.parts?.length !== 2) {
            throw new Error('the fixture did not hand over one mixed input')
          }
          expect(opened.event.parts[0]).toMatchObject({ piece: next.piece, text: brief })
          expect(opened.event.parts[1]?.text).toBe(other)
          // The retained input still has both messages. Only the fictional ledger's second part
          // becomes unreadable; its presentation reader drops that part but preserves the key.
          db.prepare('UPDATE events SET payload = ? WHERE session_id = ? AND ordinal = ?').run(
            JSON.stringify({
              ...opened.event,
              parts: opened.event.parts.map((part, at) =>
                at === 1 ? { ...part, text: null } : part,
              ),
            }),
            helper,
            opened.ordinal,
          )
          const sampled = newest(helper, 'user_turn')?.event
          if (sampled?.type !== 'user_turn') throw new Error('the opening row disappeared')
          expect(sampled.parts).toHaveLength(1)
          expect(sampled.text).toContain(other)
          switchAndRefuse()
          await vi.waitFor(() => expect(starts.at(-1)).toBe(digestOf(ANOTHER_ACCOUNT)))
          await settled()
          expect(codex.carriedOn).toBe(0)
          expect(endingsOf(helper)).toEqual(['completed', 'failed'])
          expect(codex.sent).toHaveLength(2)
          expect(turnsOf(helper).some((turn) => turn.carriesOn === true)).toBe(false)
          const transcript = createTranscript()
          for (const event of rowsOf(helper)) applyEvent(transcript, event)
          expect(
            transcript.items.filter((item) => item.kind === 'notice').map((item) => item.text),
          ).toContain(REOPENED_ON_A_RENEWED_SIGN_IN)
        })
      }

      it('a give whose refused turn already answered something is not carried on', async () => {
        const { helper } = await given()
        says(codex.handles.at(-1)!, { type: 'assistant_delta', text: 'A partial answer.' })
        switchAndRefuse()
        await vi.waitFor(() => expect(endingsOf(helper)).toEqual(['failed']))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
      })

      async function waitingToCarryOn(): Promise<{ helper: string; release: () => void }> {
        const { helper } = await given()
        let release: (() => void) | null = null
        codex.asItStarts = () => {
          codex.asItStarts = () => {}
          codex.checksItsSignIn = () =>
            new Promise((resolve) => {
              release = () => resolve(false)
            })
        }
        switchAndRefuse()
        await vi.waitFor(() => expect(release).not.toBeNull())
        return {
          helper,
          release: () => {
            codex.checksItsSignIn = async () => false
            if (release === null) throw new Error('the carry-on check never began')
            release()
          },
        }
      }

      it('a person stops it while the carry-on check waits: nothing is carried on', async () => {
        const { helper, release } = await waitingToCarryOn()
        await host.interrupt(helper, watching)
        release()
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
      })

      it('new personal words during the sign-in check replace the refused give', async () => {
        const { helper, release } = await waitingToCarryOn()
        codex.checksItsSignIn = async () => false
        await host.send(helper, 'A newer message.', watching)
        release()
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(2)
        expect(codex.sent[1]).toContain('A newer message.')
      })

      it('a quit while the carry-on check waits: nothing is carried on', async () => {
        const { release } = await waitingToCarryOn()
        const quit = host.closeAll()
        release()
        await quit
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
      })

      it('an agent note after an account change is not a give and is not carried on', async () => {
        aHelperHolding(DEAD)
        accept(DEAD, ANOTHER_ACCOUNT)
        const { sessionId: helper } = await start()
        const { sessionId: giver } = await host.createSession(
          { provider: 'claude', profileId: DEFAULT_PROFILE_ID },
          watching,
        )
        codex.turnModes.push('held-open')
        await host.queueMessage(
          helper,
          MESSAGE,
          { ownerId: agentCallerId(giver) },
          [],
          'work',
          {},
          'note',
        )
        switchAndRefuse()
        await vi.waitFor(() => expect(starts).toEqual(digests(DEAD, ANOTHER_ACCOUNT)))
        await settled()
        expect(codex.carriedOn).toBe(0)
        expect(codex.sent).toHaveLength(1)
      })
    })
  })
})
