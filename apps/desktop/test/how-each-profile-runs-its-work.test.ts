import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  kindOf,
  NO_PROFILE_EXECUTION,
  PROFILE_EXECUTION_VERSION,
  profileExecutionFile,
  readProfileExecution,
  readAgainstTheDatabase,
  reconcileProfileExecution,
  writeProfileExecution,
  type KeptProfileExecution,
  type ProfileExecution,
  type ServiceBorn,
  type WhatTheDatabaseHolds,
} from '../src/main/profile-execution-file'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'

/**
 * How each profile runs its work: `profile-execution.json`, which says which profiles are services
 * and which conversation is each service's one. Read, written, and settled against the database as
 * the host starts. Nothing here can make a service yet; these are its foundations.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = join(here, '../src/main/db/migrations')

/** 2026-10-11 02:00 UTC. */
const NOW = 1_791_684_000_000

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'brobot2-profile-execution-'))
})
afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

const fileIn = (): string => profileExecutionFile(folder)
const holding = (body: unknown): string => {
  writeFileSync(fileIn(), typeof body === 'string' ? body : JSON.stringify(body))
  return fileIn()
}

describe('reading and writing the file', () => {
  it('a missing file holds nothing, and says it was missing', () => {
    expect(readProfileExecution(fileIn())).toEqual({
      readable: true,
      kept: NO_PROFILE_EXECUTION,
      absent: true,
    })
  })

  it('what is written is read back, and no temporary file is left beside it', () => {
    const kept: KeptProfileExecution = {
      profiles: {
        'aid:browser-driver': {
          kind: 'service',
          identityCreatedAt: NOW,
          serviceConversation: 'sess_browser',
        },
        'aid:writer': { kind: 'normal', identityCreatedAt: NOW + 1 },
        'aid:reserving': { kind: 'service', identityCreatedAt: NOW + 2, reserved: 'sess_next' },
      },
    }
    writeProfileExecution(fileIn(), kept)
    expect(readProfileExecution(fileIn())).toEqual({ readable: true, kept })
    expect(JSON.parse(readFileSync(fileIn(), 'utf8'))).toMatchObject({
      version: PROFILE_EXECUTION_VERSION,
    })
    expect(readdirSync(folder)).toEqual(['profile-execution.json'])
  })

  it('a write replaces what the file held', () => {
    writeProfileExecution(fileIn(), {
      profiles: { 'aid:a': { kind: 'service', identityCreatedAt: NOW } },
    })
    writeProfileExecution(fileIn(), NO_PROFILE_EXECUTION)
    expect(readProfileExecution(fileIn())).toEqual({ readable: true, kept: NO_PROFILE_EXECUTION })
  })

  it.each([
    ['not JSON', '{"version": 1, "profiles": {', 'it is not JSON'],
    ['not an object', '[]', 'it holds no object'],
    ['another version', { version: 3, profiles: {} }, 'it is not version 2'],
    ['no profiles', { version: 1 }, 'it holds no profiles'],
    [
      'a kind this build does not know',
      { version: 1, profiles: { 'aid:a': { kind: 'worker', identityCreatedAt: NOW } } },
      'its entry for aid:a is not one this app writes',
    ],
    [
      'an entry with no creation time',
      { version: 1, profiles: { 'aid:a': { kind: 'service' } } },
      'its entry for aid:a is not one this app writes',
    ],
    [
      'a normal profile with a conversation of its own',
      {
        version: 1,
        profiles: {
          'aid:a': { kind: 'normal', identityCreatedAt: NOW, serviceConversation: 'sess_a' },
        },
      },
      'its entry for aid:a is not one this app writes',
    ],
    [
      'a normal profile with a reservation',
      {
        version: 1,
        profiles: { 'aid:a': { kind: 'normal', identityCreatedAt: NOW, reserved: 'sess_a' } },
      },
      'its entry for aid:a is not one this app writes',
    ],
    [
      'a delete of a conversation that is not the service’s',
      {
        version: 1,
        profiles: {
          'aid:a': {
            kind: 'service',
            identityCreatedAt: NOW,
            serviceConversation: 'sess_a',
            removing: 'sess_b',
          },
        },
      },
      'its entry for aid:a is not one this app writes',
    ],
    [
      'a delete with no conversation to delete',
      {
        version: 1,
        profiles: { 'aid:a': { kind: 'service', identityCreatedAt: NOW, removing: 'sess_a' } },
      },
      'its entry for aid:a is not one this app writes',
    ],
    [
      'an empty conversation id',
      {
        version: 1,
        profiles: { 'aid:a': { kind: 'service', identityCreatedAt: NOW, serviceConversation: '' } },
      },
      'its entry for aid:a is not one this app writes',
    ],
  ])('a file holding %s cannot be read, and says why', (_what, body, why) => {
    expect(readProfileExecution(holding(body))).toEqual({ readable: false, why })
  })

  it('a file that cannot be opened cannot be read: it is never taken as empty', () => {
    mkdirSync(fileIn())
    const read = readProfileExecution(fileIn())
    expect(read.readable).toBe(false)
    expect(read.readable ? '' : read.why).toMatch(/^it could not be read \(/)
  })
})

/**
 * A database holding these identities, by id and creation time, these conversations, and these
 * that only a service's start makes.
 */
const aDatabase = (
  identities: Readonly<Record<string, number>>,
  conversations: readonly string[] = [],
  servicesBorn: readonly ServiceBorn[] = [],
): WhatTheDatabaseHolds => ({
  identityCreatedAt: (identity) => identities[identity] ?? null,
  hasConversation: (conversation) => conversations.includes(conversation),
  servicesBorn,
})

describe('settling the file against the database', () => {
  it('an entry the database agrees with is kept as it is', () => {
    const kept: KeptProfileExecution = {
      profiles: {
        'aid:svc': { kind: 'service', identityCreatedAt: NOW, serviceConversation: 'sess_svc' },
        'aid:plain': { kind: 'normal', identityCreatedAt: NOW },
        'aid:unmade': { kind: 'service', identityCreatedAt: NOW },
      },
    }
    const db = aDatabase({ 'aid:svc': NOW, 'aid:plain': NOW, 'aid:unmade': NOW }, ['sess_svc'])
    expect(reconcileProfileExecution(kept, db)).toEqual({
      kept,
      changed: false,
      moved: [],
      conflicts: [],
    })
  })

  it('an entry whose identity is gone is dropped', () => {
    const settled = reconcileProfileExecution(
      { profiles: { 'aid:gone': { kind: 'service', identityCreatedAt: NOW } } },
      aDatabase({}),
    )
    expect(settled).toEqual({
      kept: NO_PROFILE_EXECUTION,
      changed: true,
      moved: ['aid:gone'],
      conflicts: [],
    })
  })

  it('an entry for a name deleted and made again belongs to the old identity: it is dropped', () => {
    const settled = reconcileProfileExecution(
      {
        profiles: {
          'aid:svc': { kind: 'service', identityCreatedAt: NOW, serviceConversation: 'sess_svc' },
        },
      },
      aDatabase({ 'aid:svc': NOW + 60_000 }, ['sess_svc']),
    )
    expect(settled).toEqual({
      kept: NO_PROFILE_EXECUTION,
      changed: true,
      moved: ['aid:svc'],
      conflicts: [],
    })
  })

  it('a reservation whose conversation was made is completed', () => {
    const settled = reconcileProfileExecution(
      {
        profiles: { 'aid:svc': { kind: 'service', identityCreatedAt: NOW, reserved: 'sess_svc' } },
      },
      aDatabase({ 'aid:svc': NOW }, ['sess_svc']),
    )
    expect(settled).toEqual({
      kept: {
        profiles: {
          'aid:svc': { kind: 'service', identityCreatedAt: NOW, serviceConversation: 'sess_svc' },
        },
      },
      changed: true,
      moved: ['aid:svc'],
      conflicts: [],
    })
  })

  it('a reservation whose conversation was never made is dropped, and none is made', () => {
    const db = aDatabase({ 'aid:svc': NOW })
    const asked = vi.spyOn(db, 'hasConversation')
    const settled = reconcileProfileExecution(
      {
        profiles: { 'aid:svc': { kind: 'service', identityCreatedAt: NOW, reserved: 'sess_svc' } },
      },
      db,
    )
    expect(settled).toEqual({
      kept: { profiles: { 'aid:svc': { kind: 'service', identityCreatedAt: NOW } } },
      changed: true,
      moved: ['aid:svc'],
      conflicts: [],
    })
    expect(asked).toHaveBeenCalledWith('sess_svc')
  })

  it('a made conversation that is not recorded cannot be settled: it is a conflict, kept as read', () => {
    const entry = {
      kind: 'service',
      identityCreatedAt: NOW,
      serviceConversation: 'sess_lost',
    } as const
    const settled = reconcileProfileExecution(
      { profiles: { 'aid:svc': entry } },
      aDatabase({ 'aid:svc': NOW }),
    )
    expect(settled).toEqual({
      kept: { profiles: { 'aid:svc': entry } },
      changed: false,
      moved: [],
      conflicts: ['aid:svc'],
    })
  })

  it('a reservation of the conversation already made completes nothing new', () => {
    const settled = reconcileProfileExecution(
      {
        profiles: {
          'aid:svc': {
            kind: 'service',
            identityCreatedAt: NOW,
            serviceConversation: 'sess_svc',
            reserved: 'sess_svc',
          },
        },
      },
      aDatabase({ 'aid:svc': NOW }, ['sess_svc']),
    )
    expect(settled).toEqual({
      kept: {
        profiles: {
          'aid:svc': { kind: 'service', identityCreatedAt: NOW, serviceConversation: 'sess_svc' },
        },
      },
      changed: true,
      moved: ['aid:svc'],
      conflicts: [],
    })
  })

  it('a reservation beside a made conversation, never made itself, is dropped', () => {
    const settled = reconcileProfileExecution(
      {
        profiles: {
          'aid:svc': {
            kind: 'service',
            identityCreatedAt: NOW,
            serviceConversation: 'sess_one',
            reserved: 'sess_two',
          },
        },
      },
      aDatabase({ 'aid:svc': NOW }, ['sess_one']),
    )
    expect(settled).toEqual({
      kept: {
        profiles: {
          'aid:svc': { kind: 'service', identityCreatedAt: NOW, serviceConversation: 'sess_one' },
        },
      },
      changed: true,
      moved: ['aid:svc'],
      conflicts: [],
    })
  })

  it('a conflict is written back as it was read when another entry is settled', () => {
    const lost = {
      kind: 'service',
      identityCreatedAt: NOW,
      serviceConversation: 'sess_lost',
    } as const
    const settled = reconcileProfileExecution(
      {
        profiles: {
          'aid:lost': lost,
          'aid:gone': { kind: 'normal', identityCreatedAt: NOW },
        },
      },
      aDatabase({ 'aid:lost': NOW }),
    )
    expect(settled).toEqual({
      kept: { profiles: { 'aid:lost': lost } },
      changed: true,
      moved: ['aid:gone'],
      conflicts: ['aid:lost'],
    })
  })

  it('a delete noted before the conversation went, which then did not go, is dropped', () => {
    const settled = reconcileProfileExecution(
      {
        profiles: {
          'aid:svc': {
            kind: 'service',
            identityCreatedAt: NOW,
            serviceConversation: 'sess_svc',
            removing: 'sess_svc',
          },
        },
      },
      aDatabase({ 'aid:svc': NOW }, ['sess_svc']),
    )
    expect(settled).toEqual({
      kept: {
        profiles: {
          'aid:svc': { kind: 'service', identityCreatedAt: NOW, serviceConversation: 'sess_svc' },
        },
      },
      changed: true,
      moved: ['aid:svc'],
      conflicts: [],
    })
  })

  it('a delete noted before the conversation went, which went, leaves the service with none', () => {
    const settled = reconcileProfileExecution(
      {
        profiles: {
          'aid:svc': {
            kind: 'service',
            identityCreatedAt: NOW,
            serviceConversation: 'sess_svc',
            removing: 'sess_svc',
          },
        },
      },
      aDatabase({ 'aid:svc': NOW }),
    )
    expect(settled).toEqual({
      kept: { profiles: { 'aid:svc': { kind: 'service', identityCreatedAt: NOW } } },
      changed: true,
      moved: ['aid:svc'],
      conflicts: [],
    })
  })

  it('a made conversation and a different reservation, both recorded, cannot be settled', () => {
    const entry = {
      kind: 'service',
      identityCreatedAt: NOW,
      serviceConversation: 'sess_one',
      reserved: 'sess_two',
    } as const
    const settled = reconcileProfileExecution(
      { profiles: { 'aid:svc': entry } },
      aDatabase({ 'aid:svc': NOW }, ['sess_one', 'sess_two']),
    )
    expect(settled).toEqual({
      kept: { profiles: { 'aid:svc': entry } },
      changed: false,
      moved: [],
      conflicts: ['aid:svc'],
    })
  })
})

describe('an identity removed, and evidence the file was lost', () => {
  const retired = {
    kind: 'service',
    identityCreatedAt: NOW,
    retired: true,
  } as const

  it('a retired entry whose identity is gone is dropped', () => {
    const settled = reconcileProfileExecution({ profiles: { 'aid:svc': retired } }, aDatabase({}))
    expect(settled).toEqual({
      kept: NO_PROFILE_EXECUTION,
      changed: true,
      moved: ['aid:svc'],
      conflicts: [],
    })
  })

  it('a retired entry whose name was made again at another moment is dropped: the new one is normal', () => {
    const settled = reconcileProfileExecution(
      { profiles: { 'aid:svc': retired } },
      aDatabase({ 'aid:svc': NOW + 1 }),
    )
    expect(settled.kept).toEqual(NO_PROFILE_EXECUTION)
    expect(
      kindOf({ readable: true, kept: settled.kept }, settled.conflicts, 'aid:svc', NOW + 1),
    ).toBe('normal')
  })

  it('a retired entry whose name was made again at the same moment is never inherited: its kind is unknown', () => {
    const settled = reconcileProfileExecution(
      { profiles: { 'aid:svc': retired } },
      aDatabase({ 'aid:svc': NOW }),
    )
    expect(settled).toEqual({
      kept: { profiles: { 'aid:svc': retired } },
      changed: false,
      moved: [],
      conflicts: ['aid:svc'],
    })
    expect(kindOf({ readable: true, kept: settled.kept }, settled.conflicts, 'aid:svc', NOW)).toBe(
      'unknown',
    )
    // …and read without a settle, a retired entry is never its identity's kind either.
    expect(kindOf({ readable: true, kept: settled.kept }, [], 'aid:svc', NOW)).toBe('unknown')
  })

  it('a service’s conversation in the database that its identity’s entry does not name is a conflict', () => {
    const born = [{ conversation: 'sess_born', identity: 'aid:svc' }]
    const unnamed = reconcileProfileExecution(
      { profiles: { 'aid:svc': { kind: 'service', identityCreatedAt: NOW } } },
      aDatabase({ 'aid:svc': NOW }, ['sess_born'], born),
    )
    expect(unnamed.conflicts).toEqual(['aid:svc'])
    const noEntry = reconcileProfileExecution(
      NO_PROFILE_EXECUTION,
      aDatabase({ 'aid:svc': NOW }, ['sess_born'], born),
    )
    expect(noEntry.conflicts).toEqual(['aid:svc'])
    // The control: named as the service's, it is settled.
    const named = reconcileProfileExecution(
      {
        profiles: {
          'aid:svc': { kind: 'service', identityCreatedAt: NOW, serviceConversation: 'sess_born' },
        },
      },
      aDatabase({ 'aid:svc': NOW }, ['sess_born'], born),
    )
    expect(named.conflicts).toEqual([])
  })

  it('a missing file means nothing kept only while the database holds no service’s conversation', () => {
    const absent = { readable: true, kept: NO_PROFILE_EXECUTION, absent: true } as const
    expect(readAgainstTheDatabase(absent, [])).toBe(absent)
    expect(
      readAgainstTheDatabase(absent, [{ conversation: 'sess_born', identity: 'aid:svc' }]),
    ).toEqual({
      readable: false,
      why: 'it is missing, and the database holds a service’s conversation',
    })
    // A file that is there is read as it is: its entries are settled against the evidence.
    const present = { readable: true, kept: NO_PROFILE_EXECUTION } as const
    expect(
      readAgainstTheDatabase(present, [{ conversation: 'sess_born', identity: 'aid:svc' }]),
    ).toBe(present)
  })
})

describe('a profile’s kind', () => {
  const read = {
    readable: true,
    kept: {
      profiles: {
        'aid:svc': { kind: 'service', identityCreatedAt: NOW, serviceConversation: 'sess_svc' },
      },
    },
  } as const

  it('is what is kept for that identity', () => {
    expect(kindOf(read, [], 'aid:svc', NOW)).toBe('service')
  })

  it('is normal where nothing is kept, or what is kept was another identity of that name', () => {
    expect(kindOf(read, [], 'aid:plain', NOW)).toBe('normal')
    expect(kindOf(read, [], 'aid:svc', NOW + 1)).toBe('normal')
  })

  it('is unknown where the file cannot be read, or its entry is in conflict', () => {
    expect(kindOf({ readable: false, why: 'it is not JSON' }, [], 'aid:plain', NOW)).toBe('unknown')
    expect(kindOf(read, ['aid:svc'], 'aid:svc', NOW)).toBe('unknown')
  })
})

describe('the host takes the file as it starts', () => {
  let db: AppDatabase
  let store: SessionStore
  let clock: number
  let hosts: RuntimeHost[]
  const tick = (): number => clock++

  beforeEach(() => {
    db = openDatabase(join(folder, 'brobot2.sqlite'))
    applyMigrations(db, migrationsDir)
    clock = NOW
    store = createSessionStore(db, tick)
    hosts = []
  })

  afterEach(async () => {
    for (const host of hosts) await host.closeAll()
    db.close()
  })

  /** How many times a host wrote the file. */
  let writes = 0

  /** A host over this data folder, with or without the file, and with writes that may fail. */
  const aHost = (
    opts: {
      withTheFile?: boolean
      writesFail?: boolean | ((kept: KeptProfileExecution) => boolean)
      store?: SessionStore
      owned?: boolean
    } = {},
  ): RuntimeHost => {
    const host = new RuntimeHost({
      store: opts.store ?? store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(folder, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(folder, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(folder, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(folder, sessionId, requested),
      newSessionId: () => `sess_profile_execution_${String(tick())}`,
      now: tick,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      ...(opts.withTheFile === false
        ? {}
        : {
            profileExecution: {
              read: () => readProfileExecution(fileIn()),
              write: (kept: KeptProfileExecution) => {
                const fails =
                  typeof opts.writesFail === 'function' ? opts.writesFail(kept) : opts.writesFail
                if (fails === true) throw new Error('the disk is full')
                writes += 1
                writeProfileExecution(fileIn(), kept)
              },
              owned: opts.owned ?? true,
            },
          }),
    })
    hosts.push(host)
    return host
  }

  /** An identity made now, and its creation time. */
  const anIdentity = (slug: string): { id: string; createdAt: number } => {
    const made = store.createAgentIdentity(
      { slug, displayName: null, provider: 'claude' },
      { by: 'a-person' },
    )
    if (made === null) throw new Error(`${slug} already exists`)
    return { id: made.id, createdAt: made.createdAt }
  }

  const aConversation = (id: string, profileId: string): string => {
    store.create({ id, provider: 'claude', cwd: folder, approvalMode: 'ask', profileId })
    return id
  }

  const conversationsRecorded = (): number =>
    (db.prepare('SELECT COUNT(*) AS n FROM provider_session').get() as { n: number }).n

  /** A conversation only a service's start makes: no parent and no root. */
  const aServiceBornConversation = (id: string, profileId: string): string => {
    store.create({
      id,
      provider: 'claude',
      cwd: folder,
      approvalMode: 'ask',
      profileId,
      service: true,
    })
    return id
  }

  const kept = (identity: string): ProfileExecution | undefined => {
    const read = readProfileExecution(fileIn())
    if (!read.readable) throw new Error(read.why)
    return read.kept.profiles[identity]
  }

  describe('only the one app running on this data changes the file', () => {
    it('a settle that would change it is not written, and the entries it would change are unknown', () => {
      const svc = anIdentity('browser-driver')
      const settledService = anIdentity('settled-service')
      anIdentity('writer')
      aServiceBornConversation('sess_browser', 'browser-driver')
      aServiceBornConversation('sess_settled', 'settled-service')
      writeProfileExecution(fileIn(), {
        profiles: {
          [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt, reserved: 'sess_browser' },
          [settledService.id]: {
            kind: 'service',
            identityCreatedAt: settledService.createdAt,
            serviceConversation: 'sess_settled',
          },
        },
      })
      const before = readFileSync(fileIn(), 'utf8')
      writes = 0
      const host = aHost({ owned: false })
      expect(writes).toBe(0)
      expect(readFileSync(fileIn(), 'utf8')).toBe(before)
      expect(host.profileKindOf('browser-driver')).toBe('unknown')
      expect(host.profileKindOf('settled-service')).toBe('service')
      expect(host.profileKindOf('writer')).toBe('normal')

      // The control: the one app on this data settles it.
      const owner = aHost()
      expect(writes).toBe(1)
      expect(kept(svc.id)?.serviceConversation).toBe('sess_browser')
      expect(owner.profileKindOf('browser-driver')).toBe('service')
    })

    it('an agent with a kept entry is not removed, and one without is', () => {
      const svc = anIdentity('browser-driver')
      anIdentity('writer')
      writeProfileExecution(fileIn(), {
        profiles: { [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt } },
      })
      const host = aHost({ owned: false })
      expect(() => host.removeAgent('browser-driver')).toThrow(
        /^Not removed: the app may be open twice\.$/,
      )
      expect(store.agentIdentities().some((one) => one.slug === 'browser-driver')).toBe(true)
      expect(host.removeAgent('writer')).toEqual({ ok: true, slug: 'writer' })
    })
  })

  describe('an identity removed and made again', () => {
    it('at the same moment, through the door that removes it, is not the service it was', () => {
      const svc = anIdentity('browser-driver')
      writeProfileExecution(fileIn(), {
        profiles: { [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt } },
      })
      const host = aHost()
      expect(host.removeAgent('browser-driver')).toEqual({ ok: true, slug: 'browser-driver' })
      expect(kept(svc.id)).toBeUndefined()

      clock = svc.createdAt
      const again = anIdentity('browser-driver')
      expect(again).toEqual(svc)
      expect(host.profileKindOf('browser-driver')).toBe('normal')
      expect(aHost().profileKindOf('browser-driver')).toBe('normal')
    })

    it('…and when its entry could not be dropped, the next start reads it unknown, never a service', () => {
      const svc = anIdentity('browser-driver')
      writeProfileExecution(fileIn(), {
        profiles: { [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt } },
      })
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const host = aHost({ writesFail: (written) => written.profiles[svc.id] === undefined })
      expect(host.removeAgent('browser-driver')).toEqual({ ok: true, slug: 'browser-driver' })
      expect(kept(svc.id)).toEqual({
        kind: 'service',
        identityCreatedAt: svc.createdAt,
        retired: true,
      })
      warned.mockRestore()

      clock = svc.createdAt
      expect(anIdentity('browser-driver')).toEqual(svc)
      expect(host.profileKindOf('browser-driver')).toBe('normal')
      expect(aHost().profileKindOf('browser-driver')).toBe('unknown')
    })

    it('a removal the database does not make leaves the entry as it was', () => {
      const svc = anIdentity('browser-driver')
      const entry = { kind: 'service', identityCreatedAt: svc.createdAt } as const
      writeProfileExecution(fileIn(), { profiles: { [svc.id]: entry } })
      const refusing = new Proxy(store, {
        get(target, key, receiver) {
          if (key === 'removeAgentIdentity') return () => false
          const value: unknown = Reflect.get(target, key, receiver)
          return typeof value === 'function'
            ? (value as (...args: unknown[]) => unknown).bind(target)
            : value
        },
      })
      const host = aHost({ store: refusing })
      expect(host.removeAgent('browser-driver')).toEqual({ ok: false, rail: 'no-such-agent' })
      expect(kept(svc.id)).toEqual(entry)
      expect(host.profileKindOf('browser-driver')).toBe('service')
    })

    it('is not removed while which agents are services can’t be read', () => {
      anIdentity('writer')
      writeFileSync(fileIn(), 'not json')
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const host = aHost()
      warned.mockClear()
      expect(() => host.removeAgent('writer')).toThrow(/^Not removed: services list unreadable\.$/)
      // Why is the log's, never the window's.
      expect(warned).toHaveBeenCalledWith(
        'runtime host did not remove aid:writer, since the services list can’t be read (it is not JSON)',
      )
      expect(store.agentIdentities().some((one) => one.slug === 'writer')).toBe(true)
      warned.mockRestore()
    })

    it('is not removed when its entry can’t be marked first, and the disk’s error goes to the log', () => {
      const svc = anIdentity('browser-driver')
      const entry = { kind: 'service', identityCreatedAt: svc.createdAt } as const
      writeProfileExecution(fileIn(), { profiles: { [svc.id]: entry } })
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const host = aHost({ writesFail: true })
      expect(() => host.removeAgent('browser-driver')).toThrow(
        /^Not removed: services list not saved\.$/,
      )
      expect(warned).toHaveBeenCalledWith(
        'runtime host did not remove aid:browser-driver: the disk is full',
      )
      expect(store.agentIdentities().some((one) => one.slug === 'browser-driver')).toBe(true)
      expect(kept(svc.id)).toEqual(entry)
      expect(host.profileKindOf('browser-driver')).toBe('service')
      warned.mockRestore()
    })

    it('only goes through that door: the host’s removal is the one place that removes an identity', () => {
      const sources: string[] = []
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) walk(path)
          else if (entry.name.endsWith('.ts')) sources.push(path)
        }
      }
      walk(join(here, '../src'))
      const callers = sources.flatMap((path) =>
        [...readFileSync(path, 'utf8').matchAll(/\.removeAgentIdentity\(/g)].map(() => path),
      )
      expect(
        callers
          .map((path) => path.replaceAll('\\', '/').split('/src/')[1])
          .map((tail) => `src/${tail}`),
      ).toEqual(['src/main/runtime/runtime-host.ts'])
    })
  })

  describe('a missing file', () => {
    it('with a service’s conversation in the database was lost: every kind is unknown, and it is not written', () => {
      anIdentity('browser-driver')
      anIdentity('writer')
      aServiceBornConversation('sess_browser', 'browser-driver')
      // It holds a caller's piece: work it owns that is not a root of its own.
      aConversation('sess_caller', 'writer')
      const root = store.rootOf('sess_caller')
      if (root === null) throw new Error('the caller owns no root')
      store.recordGive(
        {
          piece: 'work_for_the_service',
          parent: root.piece,
          number: 1,
          owner: 'sess_browser',
          givenBy: 'sess_caller',
          title: 'book the room',
          brief: 'book the meeting room for Tuesday',
          folder: null,
          inputs: [],
        },
        store.nextOrdinal('sess_browser'),
        {
          type: 'work_given',
          piece: 'work_for_the_service',
          label: `${root.label}.1`,
          parent: root.piece,
          givenBy: 'sess_caller',
          title: 'book the room',
          brief: 'book the meeting room for Tuesday',
          messageId: 'msg_for_the_service',
        },
        tick(),
      )
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
      writes = 0
      const host = aHost()
      expect(host.profileKindOf('browser-driver')).toBe('unknown')
      expect(host.profileKindOf('writer')).toBe('unknown')
      expect(writes).toBe(0)
      expect(existsSync(fileIn())).toBe(false)
      expect(warned).toHaveBeenCalledWith(
        'runtime host could not read how its profiles run their work: it is missing, and the database holds a service’s conversation',
      )
      warned.mockRestore()
    })

    it('with only conversations people and agents started is a workspace with no services', () => {
      anIdentity('writer')
      anIdentity('helper')
      aConversation('sess_person', 'writer')
      // An agent's helper owns no root either, but a conversation started it.
      store.create({
        id: 'sess_helper',
        provider: 'claude',
        cwd: folder,
        approvalMode: 'ask',
        profileId: 'helper',
        parentSessionId: 'sess_person',
      })
      expect(store.rootOf('sess_helper')).toBeNull()
      writes = 0
      const host = aHost()
      expect(host.profileKindOf('writer')).toBe('normal')
      expect(host.profileKindOf('helper')).toBe('normal')
      expect(writes).toBe(0)
    })
  })

  it('a service’s conversation its identity’s entry does not name leaves that kind unknown', () => {
    const svc = anIdentity('browser-driver')
    aServiceBornConversation('sess_browser', 'browser-driver')
    writeProfileExecution(fileIn(), {
      profiles: { [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt } },
    })
    expect(aHost().profileKindOf('browser-driver')).toBe('unknown')
  })

  it('with no file, every profile is normal, and nothing is written', () => {
    anIdentity('writer')
    const host = aHost()
    expect(host.profileKindOf('writer')).toBe('normal')
    expect(host.profileKindOf('nobody-by-this-name')).toBe('normal')
    expect(existsSync(fileIn())).toBe(false)
  })

  it('a service kept for an identity is a service, by any spelling of its name', () => {
    const svc = anIdentity('browser-driver')
    aConversation('sess_browser', 'browser-driver')
    writeProfileExecution(fileIn(), {
      profiles: {
        [svc.id]: {
          kind: 'service',
          identityCreatedAt: svc.createdAt,
          serviceConversation: 'sess_browser',
        },
      },
    })
    const host = aHost()
    expect(host.profileKindOf('browser-driver')).toBe('service')
    expect(host.profileKindOf('Browser-Driver')).toBe('service')
  })

  it('a name deleted and made again does not inherit the service it had, and the file is settled', () => {
    const old = anIdentity('browser-driver')
    writeProfileExecution(fileIn(), {
      profiles: { [old.id]: { kind: 'service', identityCreatedAt: old.createdAt } },
    })
    expect(store.removeAgentIdentity('browser-driver')).toBe(true)
    clock += 60_000
    const remade = anIdentity('browser-driver')
    expect(remade.id).toBe(old.id)
    expect(remade.createdAt).not.toBe(old.createdAt)

    const host = aHost()
    expect(host.profileKindOf('browser-driver')).toBe('normal')
    expect(readProfileExecution(fileIn())).toEqual({ readable: true, kept: NO_PROFILE_EXECUTION })
  })

  it('a reservation cut off before its conversation was made is dropped, and no conversation is made', () => {
    const svc = anIdentity('browser-driver')
    writeProfileExecution(fileIn(), {
      profiles: {
        [svc.id]: {
          kind: 'service',
          identityCreatedAt: svc.createdAt,
          reserved: 'sess_never_made',
        },
      },
    })
    const before = conversationsRecorded()
    const host = aHost()
    expect(host.profileKindOf('browser-driver')).toBe('service')
    expect(readProfileExecution(fileIn())).toEqual({
      readable: true,
      kept: { profiles: { [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt } } },
    })
    expect(conversationsRecorded()).toBe(before)
    expect(store.recordedOne('sess_never_made')).toBeNull()
  })

  it('a reservation cut off after its conversation was made is completed with that conversation', () => {
    const svc = anIdentity('browser-driver')
    aConversation('sess_browser', 'browser-driver')
    writeProfileExecution(fileIn(), {
      profiles: {
        [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt, reserved: 'sess_browser' },
      },
    })
    const before = conversationsRecorded()
    aHost()
    expect(readProfileExecution(fileIn())).toEqual({
      readable: true,
      kept: {
        profiles: {
          [svc.id]: {
            kind: 'service',
            identityCreatedAt: svc.createdAt,
            serviceConversation: 'sess_browser',
          },
        },
      },
    })
    expect(conversationsRecorded()).toBe(before)
  })

  it('a service whose conversation is not recorded is unknown, and no other conversation is made', () => {
    const svc = anIdentity('browser-driver')
    const entry = {
      kind: 'service',
      identityCreatedAt: svc.createdAt,
      serviceConversation: 'sess_lost',
    } as const
    writeProfileExecution(fileIn(), { profiles: { [svc.id]: entry } })
    const before = conversationsRecorded()
    const host = aHost()
    expect(host.profileKindOf('browser-driver')).toBe('unknown')
    expect(readProfileExecution(fileIn())).toEqual({
      readable: true,
      kept: { profiles: { [svc.id]: entry } },
    })
    expect(conversationsRecorded()).toBe(before)
  })

  it('a file that cannot be read leaves every kind unknown, and is left as it was', () => {
    anIdentity('writer')
    const torn = '{"version": 1, "profiles": {"aid:browser-dri'
    writeFileSync(fileIn(), torn)
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = aHost()
    expect(host.profileKindOf('writer')).toBe('unknown')
    expect(host.profileKindOf('nobody-by-this-name')).toBe('unknown')
    expect(readFileSync(fileIn(), 'utf8')).toBe(torn)
    expect(warned).toHaveBeenCalledWith(
      'runtime host could not read how its profiles run their work: it is not JSON',
    )
    warned.mockRestore()
  })

  it('a settled file that cannot be written still settles this run, and says so', () => {
    const svc = anIdentity('browser-driver')
    aConversation('sess_browser', 'browser-driver')
    writeProfileExecution(fileIn(), {
      profiles: {
        [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt, reserved: 'sess_browser' },
      },
    })
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = aHost({ writesFail: true })
    expect(host.profileKindOf('browser-driver')).toBe('service')
    expect(warned).toHaveBeenCalledWith(
      'runtime host could not keep how its profiles run their work: the disk is full',
    )
    warned.mockRestore()
  })

  it('a database that fails while the file is settled leaves every kind unknown, and the file as it was', () => {
    const svc = anIdentity('browser-driver')
    anIdentity('writer')
    writeProfileExecution(fileIn(), {
      profiles: {
        [svc.id]: { kind: 'service', identityCreatedAt: svc.createdAt, reserved: 'sess_torn' },
      },
    })
    const before = readFileSync(fileIn(), 'utf8')
    const failing = new Proxy(store, {
      get(target, key, receiver) {
        if (key === 'recordedOne') {
          return (id: string) => {
            if (id === 'sess_torn') throw new Error('database disk image is malformed')
            return target.recordedOne(id)
          }
        }
        const value: unknown = Reflect.get(target, key, receiver)
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value
      },
    })
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = aHost({ store: failing })
    expect(host.profileKindOf('browser-driver')).toBe('unknown')
    expect(host.profileKindOf('writer')).toBe('unknown')
    expect(readFileSync(fileIn(), 'utf8')).toBe(before)
    expect(warned).toHaveBeenCalledWith(
      'runtime host could not settle how its profiles run their work: database disk image is malformed',
    )
    warned.mockRestore()
  })

  it('a host given no file reads every profile as normal', () => {
    anIdentity('writer')
    writeFileSync(fileIn(), 'not json')
    expect(aHost({ withTheFile: false }).profileKindOf('writer')).toBe('normal')
  })
})
