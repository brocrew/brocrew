import type { AgentModelChoice } from '../src/shared/model-choice-contracts'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type ModelChoice, type ProviderRuntimeContext } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import {
  whatAProviderPressWouldClear,
  whatTheProviderPressCleared,
} from '../src/renderer/src/lib/agent-model-choice'
import { createAgentStore, type AgentStore } from '../src/renderer/src/lib/agent-store'
import {
  instructionAskedSentence,
  type InstructionAsked,
} from '../src/renderer/src/lib/instruction-asked'
import { readableError } from '../src/renderer/src/lib/session-record'
import { HOLDING_SAYS, type AgentRemoved } from '../src/shared/agent-roster'
import { aChoiceInWords } from '../src/shared/model-choice'
import {
  DEFAULT_PROFILE_ID,
  PROVIDER_NAME,
  type AgentIdentities,
  type AgentIdentity,
  type RuntimeBridge,
  type RuntimeEventMessage,
} from '../src/shared/runtime-ipc'
import { everythingOverTheWire } from './lib/the-wire'
import { fixtureProviderConfig, neutralHostDeps } from './lib/host-fixture'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class Seat implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

const CATALOGUE: Record<Provider, ModelChoice[]> = {
  claude: [
    {
      id: 'opus',
      label: 'Opus',
      efforts: ['low', 'high'].map((id) => ({ id, label: id })),
    },
  ],
  codex: [
    {
      id: 'gpt-5.6-luna',
      label: 'luna',
      efforts: ['low', 'high'].map((id) => ({ id, label: id })),
    },
  ],
}

const HELD_ON: Record<Provider, AgentModelChoice> = {
  claude: { provider: 'claude', model: 'opus', effort: 'high' },
  codex: { provider: 'codex', model: 'gpt-5.6-luna', effort: 'high' },
}

const PROVIDERS = Object.keys(PROVIDER_NAME) as Provider[]

class CatalogueOnly extends FakeRuntime {
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    return CATALOGUE[this.provider]
  }
}

function catalogueHost(
  userData: string,
  store: SessionStore,
  listProfiles: () => string[],
): RuntimeHost {
  return new RuntimeHost({
    store,
    ...neutralHostDeps(() => userData),
    createRuntime: (provider: Provider) => new CatalogueOnly(provider),
    prepareProviderHome: (provider: Provider, profileId?: string) => {
      const home = join(userData, 'provider-homes', profileId ?? DEFAULT_PROFILE_ID, provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
    listProfiles,
    newSessionId: () => `sess_${Math.random().toString(36).slice(2)}`,
    readProviderConfig: fixtureProviderConfig,
  })
}

/** The preload's spellings: each call goes through the real IPC command path. */
function runOn(host: RuntimeHost) {
  const seat = new Seat('webContents:1')
  return async <T>(kind: string, input: Record<string, unknown> = {}): Promise<T> =>
    (await executeRuntimeCommand(host, seat, { kind, ...input } as Parameters<
      typeof executeRuntimeCommand
    >[2])) as T
}

const WOULD_CLEAR =
  /^Moving it to a provider other than (.+?) clears the model and effort chosen for it — (.+): a choice is always for its own provider\. Leaving no provider saved keeps it\.$/

/** Whether this sentence says a press on `pick` clears the held choice. */
function theSentenceSaysItClears(sentence: string | null, pick: Provider | null): boolean {
  if (sentence === null) return false
  const said = WOULD_CLEAR.exec(sentence)
  if (said === null) throw new Error(`not the would-clear sentence: ${sentence}`)
  if (pick === null) return false
  return PROVIDER_NAME[pick] !== said[1]
}

describe('the provider control says what its press will clear, before it', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let agents: AgentStore
  let folders: Set<string>

  beforeEach(async () => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-712-r56-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    const sessions = createSessionStore(db)
    folders = new Set([DEFAULT_PROFILE_ID])
    host = catalogueHost(userData, sessions, () => [...folders])
    const run = runOn(host)
    const bridge: Partial<RuntimeBridge> = {
      agentIdentities: () => run('agentIdentities'),
      profiles: () => run('profiles'),
      agentModelAndEffort: (input) => run('agentModelAndEffort', { ...input }),
      setAgentModelAndEffort: (input) => run('setAgentModelAndEffort', { ...input }),
      setAgentProvider: (input) => run('setAgentProvider', { ...input }),
    }
    agents = createAgentStore(everythingOverTheWire(bridge) as RuntimeBridge)
    expect(
      sessions.createAgentIdentity(
        { slug: 'archivist', displayName: null, provider: null },
        { by: 'a-person' },
      ),
    ).not.toBeNull()
    folders.add('archivist')
    await agents.load()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  it('for every held provider, both ways of holding it and every pick, the words said before the press name exactly what the real `setAgentProvider` then clears', async () => {
    const SLUG = 'archivist'
    const table: {
      held: Provider
      its: Provider | null
      pick: Provider | null
      predicted: boolean
      door: boolean
    }[] = []
    for (const heldOn of PROVIDERS) {
      for (const its of [heldOn, null]) {
        for (const pick of [...PROVIDERS, null]) {
          const cell = `held on ${heldOn}, its provider ${its ?? 'none'}, pick ${pick ?? 'none'}`
          // Reset through the doors: no provider (keeps any choice), the choice, then its own provider.
          expect((await agents.chooseProviderFor(SLUG, null)).ok, cell).toBe(true)
          expect(await agents.chooseModelFor(SLUG, HELD_ON[heldOn]), cell).toMatchObject({
            ok: true,
          })
          if (its !== null) expect((await agents.chooseProviderFor(SLUG, its)).ok, cell).toBe(true)
          const read = await agents.modelChoiceFor(SLUG)
          expect(read?.held, cell).toEqual(HELD_ON[heldOn])
          expect(
            agents.identities.value?.identities.find((one) => one.slug === SLUG)?.provider,
            cell,
          ).toBe(its)
          const held = read?.held ?? null

          const before = whatAProviderPressWouldClear(held)
          expect(before, cell).not.toBeNull()
          expect(WOULD_CLEAR.exec(before ?? '')?.[2], cell).toBe(aChoiceInWords(HELD_ON[heldOn]))
          const predicted = theSentenceSaysItClears(before, pick)

          const pressed = await agents.chooseProviderFor(SLUG, pick)
          if (!pressed.ok) throw new Error(`${cell}: ${pressed.reason}`)
          const door = pressed.cleared !== null
          expect((await agents.modelChoiceFor(SLUG))?.held === null, cell).toBe(door)
          if (pressed.cleared !== null && pick !== null) {
            expect(pressed.cleared, cell).toEqual(HELD_ON[heldOn])
            expect(whatTheProviderPressCleared(pressed.cleared, pick), cell).toContain(
              aChoiceInWords(HELD_ON[heldOn]),
            )
          }
          table.push({ held: heldOn, its, pick, predicted, door })
        }
      }
    }

    expect(table).toHaveLength(PROVIDERS.length * 2 * (PROVIDERS.length + 1))
    expect(new Set(table.map((row) => row.door))).toEqual(new Set([true, false]))
    expect(table.filter((row) => row.predicted !== row.door)).toEqual([])
    expect(
      table.filter((row) => row.door !== (row.pick !== null && row.pick !== row.held)),
    ).toEqual([])
  })
})

const named = (slug: string, displayName: string | null): AgentIdentity =>
  ({ slug, displayName }) as unknown as AgentIdentity

/** Names that are not their slugs and do not start with the slug's letter. */
const ROSTER: readonly AgentIdentity[] = [
  named('project-manager', 'Ada'),
  named('bookkeeper', 'Pam'),
  named('archivist', 'Iris'),
]

describe('every identity a person reads is named, never by slug', () => {
  it('roster-less, a relayed ask by BroBot’s slug reads *BroBot*', () => {
    const facts: InstructionAsked = {
      proposedBy: DEFAULT_PROFILE_ID,
      about: 'bookkeeper',
      ask: 'relay',
      characters: 19,
    }
    expect(instructionAskedSentence(facts, null)).toBe(
      'BroBot set rules for bookkeeper — 19 characters. It said you had given it this rule, so it was written.',
    )
  })

  describe('`agent-store`’s removal sentences', () => {
    const REREAD_FAILED = 'the ledger is locked by another process'

    const rosterOf = (identities: readonly AgentIdentity[]): AgentIdentities =>
      ({
        identities,
        foldersWithoutARow: [],
        use: [],
        spawningEnabled: true,
      }) as unknown as AgentIdentities

    /** A store over a double bridge: the first read answers the roster; later reads may fail. */
    const storeOver = async (said: {
      roster: readonly AgentIdentity[]
      removed?: AgentRemoved
      rereadFails: boolean
    }): Promise<AgentStore> => {
      let reads = 0
      const bridge: Partial<RuntimeBridge> = {
        agentIdentities: () => {
          reads += 1
          return reads > 1 && said.rereadFails
            ? Promise.reject(new Error(REREAD_FAILED))
            : Promise.resolve(rosterOf(said.roster))
        },
        removeAgent: () => Promise.resolve(said.removed ?? { ok: true, slug: 'archivist' }),
      }
      const store = createAgentStore(everythingOverTheWire(bridge) as RuntimeBridge)
      await store.load()
      expect(store.loadError.value).toBeNull()
      return store
    }

    const couldNotReread = readableError(new Error(REREAD_FAILED))

    it('a refusal names the agent it held back; an unnamed agent reads as its slug', async () => {
      const held: AgentRemoved = { ok: false, rail: 'it-is-still-held', held: ['conversations'] }
      const refusal = await (
        await storeOver({ roster: ROSTER, removed: held, rereadFails: false })
      ).remove('archivist')
      expect(refusal).toBe(`Iris cannot be removed yet: ${HOLDING_SAYS.conversations}.`)
      const unnamed = await (
        await storeOver({ roster: [named('archivist', null)], removed: held, rereadFails: false })
      ).remove('archivist')
      expect(unnamed).toBe(`archivist cannot be removed yet: ${HOLDING_SAYS.conversations}.`)
    })

    it('a removal whose re-read failed names the agent it removed', async () => {
      const said = await (
        await storeOver({ roster: ROSTER, rereadFails: true })
      ).remove('archivist')
      expect(said).toBe(
        `Iris was removed, but this window could not re-read the list: ${couldNotReread}`,
      )
      expect(
        await (await storeOver({ roster: ROSTER, rereadFails: false })).remove('archivist'),
      ).toBeNull()
    })

    it('*no such agent* keeps the slug, even when a roster names one: there is no row to name', async () => {
      const said = await (
        await storeOver({
          roster: ROSTER,
          removed: { ok: false, rail: 'no-such-agent' },
          rereadFails: false,
        })
      ).remove('archivist')
      expect(said).toBe(
        'There is no agent identity called archivist, so there is nothing to remove.',
      )
      expect(said).not.toContain('Iris')
    })
  })

  describe('a creation through the real door names the agent main named', () => {
    let userData: string
    let db: AppDatabase
    let host: RuntimeHost
    const LOCKED = 'the ledger is locked by another process'
    const rereadFailedSays = readableError(new Error(LOCKED))

    beforeEach(() => {
      userData = mkdtempSync(join(tmpdir(), 'brobot2-712-create-'))
      db = openDatabase(join(userData, 'brobot2.sqlite'))
      applyMigrations(db, migrationsFolder)
      host = catalogueHost(userData, createSessionStore(db), () => [DEFAULT_PROFILE_ID])
    })

    afterEach(async () => {
      await host.closeAll()
      db.close()
      rmSync(userData, { recursive: true, force: true })
    })

    /** The roster's re-read fails after the first read. */
    const storeOverTheHost = async (): Promise<AgentStore> => {
      const run = runOn(host)
      let reads = 0
      const bridge: Partial<RuntimeBridge> = {
        agentIdentities: () => {
          reads += 1
          return reads > 1 ? Promise.reject(new Error(LOCKED)) : run('agentIdentities')
        },
        createAgent: (input) => run('createAgent', { ...input }),
      }
      const store = createAgentStore(everythingOverTheWire(bridge) as RuntimeBridge)
      await store.load()
      expect(store.loadError.value).toBeNull()
      return store
    }

    it('a blank name box: the sentence says the name main gave it, never the slug', async () => {
      const said = await (
        await storeOverTheHost()
      ).create({ slug: 'scribe', displayName: null, provider: null })
      const row = host.agentIdentities().identities.find((one) => one.slug === 'scribe')
      expect(row?.displayName).toBeTruthy()
      expect(row?.displayName).not.toBe('scribe')
      expect(said).toBe(
        `${row?.displayName ?? '?'} was created, but this window could not re-read the list: ${rereadFailedSays}`,
      )
    })

    it('a name typed in the box is the name main kept, and the sentence says it', async () => {
      const said = await (
        await storeOverTheHost()
      ).create({ slug: 'scribe', displayName: 'Quill', provider: null })
      expect(
        host.agentIdentities().identities.find((one) => one.slug === 'scribe')?.displayName,
      ).toBe('Quill')
      expect(said).toBe(
        `Quill was created, but this window could not re-read the list: ${rereadFailedSays}`,
      )
    })
  })
})
