import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { FakeRuntime, type ModelChoice, type ProviderRuntimeContext } from '@brobot2/runtime'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import type { ModelList, SessionSettingChanged } from '../src/shared/runtime-ipc'

/**
 * # A person's pick in a conversation, while the provider's list could not be read
 *
 * The host's model door (`setSessionSetting`) answers what a person's pick became beyond the
 * conversation (`thePick`): the agent's default and the last pick, or the conversation's alone and
 * why. While the provider's rows could not be read, the list holds only the models a person added
 * by hand, and the answer is "the list could not be read" — the reason the window puts in words.
 *
 * - ⛔ **The list could not be read**: a pick of a model the person added by hand is the
 *   conversation's alone, the answer says the list could not be read, and neither the agent's
 *   default nor the last pick moves.
 * - ⚑ **Control, the list was read**: the same pick of the same hand-added model becomes the
 *   agent's default and the last pick.
 *
 * The existing tests reach `thePick` only through the window's words for an answer
 * (`whatAPickBecameSays`), never through the host door, so no test sees which reason the host
 * gives. While the list cannot be read, a hand-added model's row offers no effort, so without
 * its own rule the pick would still be kept from the default, but answered as "the list does not
 * hold it", which tells the person something false.
 */
const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/** The model a person added to Claude's list by hand. */
const MINE = 'claude-mine-1'

function levels(...ids: string[]): { id: string; label: string }[] {
  return ids.map((id) => ({ id, label: id }))
}

/** Claude's rows when its list is read: every effort a conversation can start at is offered. */
const CLAUDE_ROWS: ModelChoice[] = [
  {
    id: 'default',
    label: 'Default (recommended)',
    efforts: levels('low', 'medium', 'high'),
    isDefault: true,
    defaultEffort: 'medium',
  },
  {
    id: 'opus',
    label: 'Opus',
    efforts: levels('low', 'medium', 'high', 'max'),
    defaultEffort: 'high',
  },
]

/** A provider whose model list is the rows above, or a refusal while `refusing` says so. */
class CatalogueDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly rows: () => ModelChoice[] | Error,
  ) {
    super(provider)
  }
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    const answer = this.rows()
    if (answer instanceof Error) throw answer
    return answer
  }
}

describe('a person’s pick in a conversation, said against the list it was judged by', () => {
  let userData: string
  let root: string
  let db: AppDatabase
  let sessions: SessionStore
  let host: RuntimeHost
  let refusing: boolean
  let counter: number
  const window: RuntimeEventSink = {
    ownerId: 'webContents:1',
    aPersonIsBehindIt: true,
    alive: true,
    send: () => {},
    sendLiveness: () => {},
  }
  const run = async <T>(kind: string, input: Record<string, unknown> = {}): Promise<T> =>
    (await executeRuntimeCommand(host, window, { kind, ...input } as Parameters<
      typeof executeRuntimeCommand
    >[2])) as T

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-pick-unread-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-pick-unread-root-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    sessions = createSessionStore(db)
    refusing = false
    counter = 0
    host = new RuntimeHost({
      store: sessions,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) =>
        new CatalogueDouble(provider, () =>
          refusing ? new Error('not signed in') : provider === 'claude' ? CLAUDE_ROWS : [],
        ),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'brobot', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      listProfiles: () => ['brobot', 'worker'],
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, root]) rmSync(dir, { recursive: true, force: true })
  })

  /**
   * An agent on Claude, a model its person added by hand, and a conversation the person started as
   * that agent, running on what a start names when nothing else does.
   */
  const aConversationOfTheAgent = async (): Promise<string> => {
    expect(
      sessions.createAgentIdentity(
        { slug: 'worker', displayName: null, provider: 'claude' },
        { by: 'a-person' },
      ),
    ).not.toBeNull()
    await run('addHandAddedModel', { provider: 'claude', model: MINE })
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'worker', cwd: root },
      window,
    )
    return sessionId
  }

  /** The person picks the hand-added model in that conversation, at the window's door. */
  const pickMine = (sessionId: string): Promise<SessionSettingChanged> =>
    run<SessionSettingChanged>('setSessionSetting', {
      sessionId,
      body: { kind: 'model', value: MINE },
    })

  it('⛔ the list could not be read: the pick is the conversation’s alone, and the answer says the list could not be read', async () => {
    refusing = true
    const sessionId = await aConversationOfTheAgent()
    // The premise: the provider's rows were not read, and the list still holds the hand-added model.
    const list = await run<ModelList>('modelList', { provider: 'claude', profileId: 'worker' })
    expect(list.notAsked).not.toBeNull()
    expect(list.models.map((row) => row.id)).toEqual([MINE])

    const changed = await pickMine(sessionId)

    // The conversation took the model, from its next message.
    expect(changed.settings.pendingModel).toEqual({ value: MINE })
    expect(changed.thePick).toEqual({
      itsAgentsDefault: false,
      theLastPick: false,
      because: 'the-list-could-not-be-read',
    })
    // Neither the agent's default nor the provider's last pick moved.
    expect(sessions.modelChoiceOf('worker')).toBeNull()
    expect(sessions.lastPicked('claude')).toBeNull()
  })

  it('⚑ CONTROL · the list was read: the same pick becomes the agent’s default and the last pick', async () => {
    const sessionId = await aConversationOfTheAgent()
    const list = await run<ModelList>('modelList', { provider: 'claude', profileId: 'worker' })
    expect(list.notAsked).toBeNull()
    expect(list.models.find((row) => row.id === MINE)?.addedBy).toBe('a-person')

    const changed = await pickMine(sessionId)

    expect(changed.settings.pendingModel).toEqual({ value: MINE })
    expect(changed.thePick).toEqual({ itsAgentsDefault: true, theLastPick: true })
    // The pick keeps the effort the conversation runs at, which the hand-added row offers.
    const effort = changed.settings.reasoningEffort
    expect(effort).toEqual(expect.any(String))
    expect(sessions.modelChoiceOf('worker')).toEqual({ provider: 'claude', model: MINE, effort })
    expect(sessions.lastPicked('claude')).toEqual({ model: MINE, effort })
  })
})
