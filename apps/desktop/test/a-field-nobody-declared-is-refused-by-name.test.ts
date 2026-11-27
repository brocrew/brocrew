import {
  neutralHostDeps,
  fixtureProviderConfig,
  RecordingSink as WindowSink,
} from './lib/host-fixture'
import { agentRosterForWire } from './lib/agent-roster-fixture'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime/testing'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { createAgentStore } from '../src/renderer/src/lib/agent-store'
import type { AgentIdentities, AgentIdentity, RuntimeBridge } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **D-020 · a field nobody declared is refused by name, on the two commands a person's settings
 * travel by.**
 *
 * ⚠️ **Every refusal is read off the wire's own sentence**, `describeIssues`' *"path: message"* —
 * an `unrecognized_keys` issue is raised at the command's ROOT, so its path is `(root)` and the
 * key's name lives only in the message. ⛔ A refusal that said only `(root)` would be *refused*
 * without being *refused by name*.
 */

describe('D-020 · a field nobody declared is refused by name', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let window: WindowSink
  let counter: number
  let clock: number
  const tick = (): number => clock++
  /** The launcher's folders, which are NOT the rows — see `agentIdentities`. */
  let folders: string[]

  const depsOver = (): RuntimeHostDeps => ({
    store,
    ...neutralHostDeps(() => userData),
    createRuntime: (provider: Provider) => new FakeRuntime(provider),
    listProfiles: () => folders,
    prepareProviderHome: (provider, profileId) => {
      const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
      mkdirSync(home, { recursive: true })
      return home
    },
    providerHomePath: (provider) => join(userData, 'provider-homes', provider),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_${++counter}`,
    now: tick,
    readProviderConfig: fixtureProviderConfig,
  })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-strict-ipc-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-strict-ipc-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 1_000_000
    counter = 0
    folders = []
    store = createSessionStore(db, tick)
    host = new RuntimeHost(depsOver())
    window = new WindowSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    await host.close(sessionId, window)
    folders = [...new Set([...folders, profileId])]
  }

  /** A command over the real wire, as the real window sink. */
  const overTheWire = (raw: unknown): Promise<unknown> => executeRuntimeCommand(host, window, raw)

  describe('§1 · the roster read', () => {
    it('🔴 agentIdentities refuses a field nobody declared, naming each one, while the bare command is answered', async () => {
      await bringIdentityIntoBeing('pm')

      // ⚑ The pair first, on the same host: the bare command is answered and the roster is not
      // empty, so every refusal below is the stray key's and not a broken read.
      const bare = (await overTheWire({ kind: 'agentIdentities' })) as AgentIdentities
      expect(bare.identities.map((one) => one.slug)).toEqual(['pm'])

      await expect(overTheWire({ kind: 'agentIdentities', onlyMine: true })).rejects.toThrow(
        'invalid runtime command: (root): Unrecognized key: "onlyMine"',
      )
      // ⚑ Each undeclared key is named, not only the first one met.
      await expect(overTheWire({ kind: 'agentIdentities', first: 1, second: 2 })).rejects.toThrow(
        'Unrecognized keys: "first", "second"',
      )
    })
  })

  describe('§2 · the sheet’s Save', () => {
    it.each([
      ['a grant an older window still sends', { grant: { maxDepth: 4 } }, 'grant'],
      ['a mistyped second ids list', { externalMcpServerId: [] }, 'externalMcpServerId'],
    ] as const)(
      '🔴 setExternalMcpServers refuses %s beside a valid payload, and names it',
      async (_what, stray, key) => {
        await bringIdentityIntoBeing('pm')
        await expect(
          overTheWire({
            kind: 'setExternalMcpServers',
            profileId: 'pm',
            externalMcpServerIds: [],
            ...stray,
          }),
        ).rejects.toThrow(`invalid runtime command: (root): Unrecognized key: "${key}"`)
      },
    )

    it('⚑ the same call without the stray field lands, so the refusal above was the stray’s', async () => {
      await bringIdentityIntoBeing('pm')
      const saved = (await overTheWire({
        kind: 'setExternalMcpServers',
        profileId: 'pm',
        externalMcpServerIds: [],
      })) as AgentIdentity | null
      expect(saved, 'the identity exists, so the write is answered with it').not.toBeNull()
      expect(saved?.slug).toBe('pm')
    })
  })

  describe('§3 · the window sends exactly the declared fields', () => {
    it('⚑ what the sheet’s save hands the bridge, as the preload frames it, is accepted by the wire, and one stray field makes it not', async () => {
      const roster = agentRosterForWire()
      const seen: unknown[] = []
      const bridge = {
        agentIdentities: async () => roster,
        setExternalMcpServers: async (input: unknown) => {
          seen.push(input)
          return roster.identities[0] ?? null
        },
      } as unknown as RuntimeBridge
      const agents = createAgentStore(bridge)

      expect(await agents.saveExternalMcpServers('pm', ['ems:docs'])).toBeNull()
      expect(seen, 'the save reached the bridge once').toHaveLength(1)

      // ⚑ **Framed as the preload frames it** (`command({ kind: 'setExternalMcpServers', ...input })`).
      const carried = { kind: 'setExternalMcpServers', ...(seen[0] as object) }
      expect(Object.keys(carried).sort()).toEqual(['externalMcpServerIds', 'kind', 'profileId'])
      const accepted = runtimeCommandSchema.safeParse(carried)
      expect(accepted.success, accepted.success ? '' : JSON.stringify(accepted.error.issues)).toBe(
        true,
      )
      // ⚑ And the roster read, as the preload frames it: nothing beside `kind`.
      expect(runtimeCommandSchema.safeParse({ kind: 'agentIdentities' }).success).toBe(true)

      // ⛔ The pair on the same two payloads: one extra field, and each is refused alone, for that
      // field. Without it the acceptance above would pass against a schema that accepts anything.
      for (const strayed of [
        { ...carried, savedAt: 0 },
        { kind: 'agentIdentities', savedAt: 0 },
      ]) {
        const refused = runtimeCommandSchema.safeParse(strayed)
        expect(refused.success, `${strayed.kind} with a stray field`).toBe(false)
        if (refused.success) continue
        expect(refused.error.issues).toHaveLength(1)
        expect(refused.error.issues[0]).toMatchObject({
          code: 'unrecognized_keys',
          keys: ['savedAt'],
        })
      }
    })
  })
})
