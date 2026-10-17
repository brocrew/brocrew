import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  type RuntimeEventSink,
  type RuntimeHostDeps,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { createAgentStore } from '../src/renderer/src/lib/agent-store'
import {
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
  capabilityField,
  type CapabilityGrant,
} from '../src/shared/capabilities'
import type {
  AgentIdentities,
  AgentIdentity,
  RuntimeBridge,
  RuntimeEventMessage,
} from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const source = (relative: string): string => readFileSync(join(here, '..', relative), 'utf8')

/**
 * 🔴 **D-020 · a field nobody declared is refused by name, on the two commands a person's settings
 * travel by.**
 *
 * `agentIdentities` (the roster read) and `setCapabilities` (the sheet's one Save) are
 * `z.strictObject` on the runtime wire. Before D-020 both were a plain `z.object`, and zod STRIPS
 * what it was not told about: a mistyped field, or a capability sent beside the grant instead of
 * inside it, was dropped without a word while the rest of the command was written — so a person
 * believed two things had been saved and one had. The `grant` inside `setCapabilities` was already
 * refused so (`capabilityGrantSchema`, row `355 M6b`); what this file pins is the ENVELOPE around
 * it, which that row cannot see.
 *
 * ## ⚑ What is asserted, and the pair that keeps each half honest
 *
 *  - **§1 the roster read** — a stray key is a refusal that names the key; the bare command, on
 *    the same host, is answered with the roster, so the refusal is the stray key's.
 *  - **§2 the sheet's Save** — a stray key beside a WHOLE valid grant refuses the whole command and
 *    writes nothing (raw columns, not the resolver, which answers the default either way); the same
 *    payload without the stray lands.
 *  - **§3 the window sends exactly the declared fields** — the payload the real agent store hands
 *    the bridge, framed the way the preload frames it, is accepted by the wire, and one extra field
 *    is not. ⛔ Strictness is the cost of this change: a declared field the schema forgets, or a
 *    field the window adds, is now a loud refusal of the whole Save, not a silent strip.
 *  - **§4 the preload's framing** — read as text, because the preload needs electron.
 *
 * ⚠️ **Every refusal is read off the wire's own sentence**, `describeIssues`' *"path: message"* —
 * an `unrecognized_keys` issue is raised at the command's ROOT, so its path is `(root)` and the
 * key's name lives only in the message. ⛔ A refusal that said only `(root)` would be *refused*
 * without being *refused by name*.
 */

/** A window: what the app's own sink declares, and the only thing that declares it (349). */
class WindowSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

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
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
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
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: 'm',
      authNote: null,
      files: [],
    }),
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

  /**
   * ⛔ **The only way an identity comes into being** — a person runs a conversation as it, and then
   * closes it so the identity is free (`the-grant-nobody-can-give.test.ts`). `setCapabilities`
   * refuses to create the row, so every Save below needs this first.
   */
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

  /** Every field of a grant, at whatever the identity currently follows — a sheet with nothing set. */
  const nothingChosen = (): Record<string, null> =>
    Object.fromEntries(CAPABILITY_FIELDS.map((field) => [field.key, null]))

  /** The two columns this file reads raw — the resolver answers the default either way. */
  const heldBy = (slug: string): { depth: unknown; message: unknown } =>
    db
      .prepare(
        `SELECT ${capabilityField('maxDepth').column} AS depth, ${capabilityField('canMessage').column} AS message FROM agent_identity WHERE slug = ?`,
      )
      .get(slug) as { depth: unknown; message: unknown }

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
      [
        'a capability sent beside the grant instead of inside it',
        { canMessage: 'none' },
        'canMessage',
      ],
      ['a mistyped second ids list', { externalMcpServerId: [] }, 'externalMcpServerId'],
    ] as const)(
      '🔴 setCapabilities refuses %s beside a whole valid grant, names it and writes nothing',
      async (_what, stray, key) => {
        await bringIdentityIntoBeing('pm')
        // ⚑ The premise: both columns start NULL, so "still NULL" below is a fact about the refusal.
        expect(heldBy('pm')).toEqual({ depth: null, message: null })

        await expect(
          overTheWire({
            kind: 'setCapabilities',
            profileId: 'pm',
            externalMcpServerIds: [],
            grant: { ...nothingChosen(), maxDepth: 4 },
            ...stray,
          }),
        ).rejects.toThrow(`invalid runtime command: (root): Unrecognized key: "${key}"`)

        // ⛔ **The whole command was refused, not applied with the stray stripped** — the valid
        // grant beside it did not land, and neither did the stray capability anywhere.
        expect(heldBy('pm')).toEqual({ depth: null, message: null })
      },
    )

    it('⚑ the same call without the stray field lands, so the refusal above was the stray’s', async () => {
      await bringIdentityIntoBeing('pm')
      expect(heldBy('pm')).toEqual({ depth: null, message: null })

      const saved = (await overTheWire({
        kind: 'setCapabilities',
        profileId: 'pm',
        externalMcpServerIds: [],
        grant: { ...nothingChosen(), maxDepth: 4 },
      })) as AgentIdentity | null

      expect(saved, 'the identity exists, so the write is answered with it').not.toBeNull()
      expect(saved?.capabilities.maxDepth).toBe(4)
      // ⚑ Raw columns: 4 is not the ruled default, so this is the write and not the resolver.
      expect(DEFAULT_CAPABILITIES.maxDepth).not.toBe(4)
      expect(heldBy('pm')).toEqual({ depth: 4, message: null })
    })
  })

  describe('§3 · the window sends exactly the declared fields', () => {
    const PLAIN_GRANT: CapabilityGrant = {
      maxDepth: 4,
      canMessage: 'none',
      canAssignWork: null,
      canCreateAgents: null,
      canWriteRules: null,
    }

    const A_ROW: AgentIdentities = {
      identities: [
        {
          id: 'aid:pm',
          slug: 'pm',
          displayName: null,
          createdAt: 1_700_000_000_000,
          createdBy: null,
          provider: null,
          externalMcpServerIds: [],
          capabilities: DEFAULT_CAPABILITIES,
          chosen: {
            maxDepth: 'default',
            canMessage: 'default',
            canAssignWork: 'default',
            canCreateAgents: 'default',
            canWriteRules: 'default',
          },
        },
      ],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: true,
      defaultApprovalMode: 'ask',
      externalMcpServers: [],
    }

    it('⚑ what the sheet’s save hands the bridge, as the preload frames it, is accepted by the wire, and one stray field makes it not', async () => {
      const seen: unknown[] = []
      const bridge = {
        agentIdentities: async () => A_ROW,
        setCapabilities: async (input: unknown) => {
          seen.push(input)
          return A_ROW.identities[0] ?? null
        },
      } as unknown as RuntimeBridge
      const agents = createAgentStore(bridge)

      expect(await agents.save('pm', PLAIN_GRANT, ['ems:docs'])).toBeNull()
      expect(seen, 'the save reached the bridge once').toHaveLength(1)

      // ⚑ **Framed as the preload frames it** (`command({ kind: 'setCapabilities', ...input })`).
      const carried = { kind: 'setCapabilities', ...(seen[0] as object) }
      expect(Object.keys(carried).sort()).toEqual([
        'externalMcpServerIds',
        'grant',
        'kind',
        'profileId',
      ])
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

  describe('§4 · the preload’s framing', () => {
    /**
     * ⛔ **Read as text, because the preload needs electron and cannot be imported.** What it pins
     * is the framing: a window that put a field beside `kind` in the preload (for example
     * `command({ kind: 'agentIdentities', windowId })`) goes red here as well as at the wire.
     */
    it('⛔ the preload frames both verbs with nothing beside kind and the spread input', () => {
      const preload = source('src/preload/index.ts')

      expect(preload).toContain(`command({ kind: 'agentIdentities' })`)
      expect(preload).toContain(`command({ kind: 'setCapabilities', ...input })`)
      // ⚑ And what the window may hand `setCapabilities` is exactly the three declared fields.
      expect(preload).toMatch(
        /setCapabilities: \(input: \{\s*profileId: string\s*grant: CapabilityGrant\s*externalMcpServerIds: readonly string\[\]\s*\}\)/,
      )
    })
  })
})
