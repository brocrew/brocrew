import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, THE_APP_ITSELF, type RuntimeEventSink } from './helpers/giver-notice-host'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * # ⛔ 3d1eb064 · the piece a give starts a conversation from is lowered after that launch
 *
 * ⚑ `giveWork` raises `reservingAStartFrom` to the giver's own piece for its create's synchronous
 * stretch, so the new conversation's first launch names its starter by that piece, and lowers it
 * after. ⚠️ Every other launch of a conversation an agent started reads the same slot field —
 * a replacement's among them, which names its starter ALONE (`theStarterCalled`: it composes before
 * a delivery brings its first words). ⛔ Left raised, the replacement's launch would name its starter
 * by the last give's piece. The devs' own case (`the-text-a-child-is-actually-told.test.ts` §8) asks
 * `theStarterCalled` directly, so it cannot see a slot that kept the give's piece.
 *
 * ⚑ The pm/worker/wake fixture is `what-a-replacement-carries-and-what-it-leaves-behind.test.ts`'s;
 * the instruction capture is `the-text-a-child-is-actually-told.test.ts` §8's.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

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
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
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

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'auto', cwd: root },
      window,
    )
    return sessionId
  }

  const callOn = async (
    caller: string,
    name: ToolName,
    args: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const turnsIn = (sessionId: string): number =>
    ledger(sessionId).filter((event) => event.type === 'turn').length

  const launchesOf = (profileSlug: string): InstructionContext[] =>
    seen.filter((one) => one.profileSlug === profileSlug).map((one) => one.context)

  it('⛔ the helper a worker gave work to, replaced: its launch names the worker alone — not by the piece the give started it from', async () => {
    await host.close(await personOpens('worker'), window)
    await host.close(await personOpens('helper'), window)
    const pm = await personOpens('pm')
    const first = await callOn(pm, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'worker',
      title: 'Build the pages',
      brief: 'build the pages',
    })
    expect(first.outcome, JSON.stringify(first)).toBe('ok')
    const worker = first.agent as string
    const second = await callOn(worker, 'give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'helper',
      title: 'Check the pages',
      brief: 'check the pages',
      piece: first.label,
    })
    expect(second.outcome, JSON.stringify(second)).toBe('ok')
    const helper = second.agent as string
    await waitFor(() => turnsIn(helper) > 0, 'the turn the brief opened to end')

    const alone = host.whatToCallTheConversation(worker)
    const byTheGivesPiece = host.nameByItsWorkUnder(worker, first.label as string)
    // ⚑ Premise: the two namings differ, so the replacement's line tells them apart.
    expect(byTheGivesPiece).not.toBe(alone)
    // ⚑ The control: the give's own first launch names the worker by that piece.
    expect(launchesOf('helper').at(-1)?.startedBy).toBe(byTheGivesPiece)

    // ⚑ The helper is stopped and its provider forgets it: the worker's follow-up replaces it.
    await host.close(helper, THE_APP_ITSELF)
    await waitFor(
      () =>
        ![...host.resumableSessions()].some(
          (row) => row.sessionId === helper && row.running !== 'not-running',
        ),
      'the helper to be over',
    )
    issued.forgetAll()
    const launchesBefore = launchesOf('helper').length
    const sent = await callOn(worker, 'message_agent', {
      agent: helper,
      text: 'carry on',
      kind: 'follow-up',
      piece: second.label,
    })
    expect(sent.outcome, JSON.stringify(sent)).toBe('ok')
    const next = sent.went_to as string
    expect(next).not.toBe(helper)
    expect(ledger(helper)).toContainEqual({ type: 'replaced_by', sessionId: next })

    // ⚑ Two launches: the old helper's reopen, tried first, which reads its own first words and
    // names the worker by the piece it was started from; then the replacement's, which composes
    // before a delivery brings it any words…
    const [reopen, replacement] = launchesOf('helper').slice(launchesBefore)
    expect(launchesOf('helper').slice(launchesBefore)).toHaveLength(2)
    expect(reopen?.startedBy).toBe(byTheGivesPiece)
    // ⛔ …and names the worker alone — never by the piece the earlier give started the helper from.
    expect(replacement?.startedBy).toBe(alone)
  })
})
