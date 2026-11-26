import { newConversationGive } from './lib/give-fixture'
import { personOpener } from './helpers/person-opens-session'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { seedHistoricalSuccessor } from './lib/historical-replacement'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, THE_APP_ITSELF } from './helpers/giver-notice-host'
import { type ToolName } from '../src/main/runtime/agent-tools'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
import { callAs } from './helpers/call-tool'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('3d1eb064 · a replacement after a give names its starter alone', () => {
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
  let seen: { profileSlug: string | null; context: InstructionContext }[]
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost => {
    const built = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
      readInstructions: (provider, cwd, providerHome, context) => {
        seen.push({ profileSlug: context.profileSlug, context })
        const bundle = publishProfileBundle(provider, providerHome, composeProfileBundle(context))
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          thisConversation: thisConversationSpans(context),
        })
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: null,
        }
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-started-from-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-started-from-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 7_200_000
    store = createSessionStore(db, tick)
    counter = 0
    hosts = []
    seen = []
    issued = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const built of hosts) await built.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  const ledger = (sessionId: string): TranscriptEvent[] =>
    store.events(sessionId).map((entry) => entry.event)

  const waitFor = async (predicate: () => boolean, what: string): Promise<void> => {
    for (let attempt = 0; attempt < 400; attempt++) {
      if (predicate()) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`timed out waiting for ${what}`)
  }

  const personOpens = personOpener(() => ({ host, root, window }), 'auto')

  const callOn = (caller: string, name: ToolName, args: Record<string, unknown> = {}) =>
    callAs(host, caller, name, args)

  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const launchesOf = (profileSlug: string): InstructionContext[] =>
    seen.filter((one) => one.profileSlug === profileSlug).map((one) => one.context)

  it('names the helper’s starter by conversation through give, reopen and replacement', async () => {
    await host.close(await personOpens('worker'), window)
    await host.close(await personOpens('helper'), window)
    const pm = await personOpens('pm')
    const first = await callOn(
      pm,
      'give_work',
      newConversationGive('worker', 'Build the pages', 'build the pages'),
    )
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const worker = first.agent as string
    const second = await callOn(worker, 'give_work', {
      ...newConversationGive('helper', 'Check the pages', 'check the pages'),
      under: first.label,
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    const helper = second.agent as string
    await waitFor(() => turnsIn(helper) > 0, 'the turn the brief opened to end')

    const starter = `${host.whatToCallTheConversation(worker)}, ${host.nameByItsWork(worker)}`
    expect(starter).toContain(`conversation ${first.label as string} · Build the pages`)
    expect(launchesOf('helper').at(-1)?.startedBy).toBe(starter)

    await host.close(helper, THE_APP_ITSELF)
    await waitFor(
      () =>
        ![...host.resumableSessions()].some(
          (row) => row.sessionId === helper && row.running !== 'not-running',
        ),
      'the helper to be over',
    )
    await host.resumeSession(helper, window)
    expect(launchesOf('helper').at(-1)?.startedBy).toBe(starter)
    await host.closeAll()
    const next = seedHistoricalSuccessor(store, helper, `sess_${++counter}`, tick(), {
      sessions: issued,
      home: syntheticProviderHome(() => userData)('claude', 'helper'),
    })
    host = buildHost()
    await host.resumeSession(worker, window)
    const launchesBefore = launchesOf('helper').length
    const sent = await callOn(worker, 'message_agent', {
      agent: helper,
      text: 'carry on',
      kind: 'follow-up',
      piece: second.label,
    })
    expect(sent, JSON.stringify(sent)).toMatchObject({ outcome: 'ok', went_to: next })
    expect(ledger(helper)).toContainEqual({ type: 'replaced_by', sessionId: next })

    expect(
      launchesOf('helper')
        .slice(launchesBefore)
        .map((launch) => launch.startedBy),
    ).toEqual([starter])
  })
})
