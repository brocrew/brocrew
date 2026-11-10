import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { WORKSPACE_DIRNAME } from '../src/main/runtime/workspace'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

/** A name somebody creates: a fresh install ships `brobot` and no other identity. */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/**
 * Where a conversation runs when it is opened: a launch that names no folder runs in the
 * workspace, BroBot's or not; a folder a person typed wins; a case variant of BroBot's name is
 * refused before it reaches anything; and a child of BroBot may start in a folder outside BroBot's
 * own. Real host, real SQLite ledger, real migrations, real IPC boundary; the only double is the
 * provider.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('424 §A · where BroBot’s own conversation runs', () => {
  let userData: string
  let planted: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let issued: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-brobot-cwd-'))
    // ⛔ **Outside `userData`** (`420`), because a project's folder is somebody's repository, not the
    // app's own data. (Until `726` a folder under `userData` was also REFUSED by the save, which
    // made this a rule rather than tidiness; R92 removed that refusal.)
    planted = mkdtempSync(join(tmpdir(), 'brobot2-brobot-planted-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    issued = new FakeProviderSessions()
    window = new RecordingSink('webContents:1')
    host = new RuntimeHost({
      store,
      ...neutralHostDeps(() => userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions: issued }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      // ⚑ **The real resolver, not a stub.** The whole question is which branch of
      // `resolveSessionCwd` a launch takes, and a double would answer it by fiat.
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    })
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, planted]) rmSync(dir, { recursive: true, force: true })
  })

  /** ⛔ Through the real boundary, so nothing here reaches a host method a window cannot. */
  const ask = (command: Parameters<typeof executeRuntimeCommand>[2]): Promise<unknown> =>
    executeRuntimeCommand(host, window, command)

  const workspace = (): string => join(userData, WORKSPACE_DIRNAME)

  /**
   * **A person opens a conversation**, with no `cwd`, because the folder field is the thing this
   * ruling is about. ⚑ D-016 — and no `projectSlug`, which the launch no longer takes.
   */
  const personOpens = async (profileId: string): Promise<{ sessionId: string; cwd: string }> =>
    (await ask({
      kind: 'createSession',
      provider: 'codex',
      profileId,
      approvalMode: 'ask',
    })) as { sessionId: string; cwd: string }

  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    return async (name: ToolName, args: Record<string, unknown> = {}) => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §0 · a folder a person names (⚑ D-016: the two readings no longer differ — no project folder)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§0 · a folder a person names', () => {
    // ⚑ **D-016** — the three cases that planted a folder on the pinned project (BroBot in the
    // workspace beside it, the cwd the caller is handed, and the binding) went with project folders.
    it('⛔ a folder the person TYPED still wins, for BroBot too', async () => {
      // ⚠️ **The ruling is about INHERITING a folder, and nothing else.** `input.cwd` is read
      // first, so a person who typed a directory has said where their conversation runs.
      const asked = (await ask({
        kind: 'createSession',
        provider: 'codex',
        profileId: DEFAULT_PROFILE_ID,
        cwd: planted,
        approvalMode: 'ask',
      })) as { sessionId: string; cwd: string }
      expect(asked.cwd).toBe(planted)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · with no folder named, every launch runs in the workspace
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · with no folder named', () => {
    it('⚑ both identities run in the workspace', async () => {
      // ⚑ **D-016** — the premise read that the pinned project had no folder, and the control that
      // cleared one, went with project folders: a launch that names no folder has none to inherit.
      expect((await personOpens(DEFAULT_PROFILE_ID)).cwd).toBe(workspace())
      expect((await personOpens('worker')).cwd).toBe(workspace())
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the identity is compared exactly, and a case variant cannot dodge it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · what names BroBot', () => {
    it('⛔ `Default` never reaches the comparison — the launch is refused before it', async () => {
      // 🔴 **The hole an exact string comparison would have.** `projectFolderFor` asked
      // `profileId === DEFAULT_PROFILE_ID`, so a launch spelled `Default` would be *"not BroBot"*
      // and would take the project's folder. ⚑ It cannot happen: `startSession` runs
      // `assertProfileMayBeCreated` first, `listProfileIds` always contains the default one on disk
      // or not, and a spelling that is an existing profile in another case is refused BY NAME.
      // ⚑ D-016 — the folder and its comparison went; the refusal by name is what stays.
      // ⚑ **592 · derived rather than typed** (`HO-078` §2): a literal case variant stops being
      // one the moment the slug it varies is renamed.
      await expect(personOpens(DEFAULT_PROFILE_ID.toUpperCase())).rejects.toThrow(
        /spelled differently/,
      )
      // ⚑ **The pair: the same launch in the spelling that exists is admitted**, and lands where
      // BroBot lands. A blanket refusal of every capitalised name would satisfy the negative alone.
      expect((await personOpens(DEFAULT_PROFILE_ID)).cwd).toBe(workspace())
    })

    // ⚑ **D-016** — *every other identity inherits the folder of the project it is PLACED in* went
    // with projects: there is no project to be placed in, and no folder to inherit.
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the consequence, measured rather than argued
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · what BroBot’s children can reach', () => {
    it('🔴 726 · R92 — a child of BroBot IS spawned into the project folder, outside BroBot’s own', async () => {
      // ⚑ **D-016** — there is no project folder now; `planted` stands for any folder outside
      // BroBot's own, which is all this case ever needed of it.
      // ⛔ On `main` this was refused (`cwd-outside-parent`, 371 / HO-010 ruling 4): a spawn was
      // bounded by its PARENT's folder, monotone, and BroBot stands in the workspace — so a BroBot
      // could not put a child in a repository, and only a conversation placed in that project could.
      // ⚑ R92: BroBot adds no folder bound *"on where an agent may start a child"*; a folder that
      // exists and can be entered is where the child starts.
      //
      // ⚠️ **584 · `project-manager` is still the target, and the grant that reaches it MOVED**
      // (`HO-078` §1, standing rule 26). ⛔ This read *BroBot's seeded grant names it and nothing
      // else* (`SEEDED_GRANTS`); that list is gone, because `mintIdentity` writes a row for every
      // slug a seeded grant names and a fresh install now seeds `brobot` and no other identity.
      // ⛔ **584 · and the identity is CREATED, because this app no longer ships one.** ⚠️ Without
      // it the spawns are refused `unknown-profile` — the EXISTENCE rail, one line past the grant
      // and several before the folder — so neither arm below would be about the folder.
      host.createAgent({
        slug: PROJECT_MANAGER_PROFILE_ID,
        displayName: null,
        provider: null,
      })
      // 🔴 **598 · and a PERSON names it in BroBot's own list** (`HO-084` §1). ⛔ The seeded reach is
      // `created-by-me` now, and this identity was created by a PERSON — so it is not BroBot's to
      // start by reach. ⚑ **`canSpawn` is the grant that exists for exactly this**: a list of names
      // somebody wrote down, set by a person rather than passed by a model, which is standing rule
      // 32's carrier. ⚠️ Nothing in this file's subject is about either grant; without the line the
      // spawns below are refused `not-in-can-spawn` and every arm would agree on a rail none is about.
      const brobot = await personOpens(DEFAULT_PROFILE_ID)
      // ⚑ **The premise, asserted**: BroBot's own folder is the workspace, not `planted`.
      expect(brobot.cwd).toBe(workspace())
      // ⚑ **The CONTROL: a folder that does not exist is still refused**, by `folder-unusable`, in
      // `checkSessionCwd`'s own words — the rule that is not about WHERE. Refused first, so the
      // identity is not live when the real spawn below asks for it.
      const missing = join(planted, 'not-here')
      const refused = await toolsOf(brobot.sessionId)('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'Work in a folder that is not there',
        brief: 'work in a folder that is not there',
        folder: missing,
      })
      expect(refused.outcome, JSON.stringify(refused)).toBe('refused')
      expect(refused.rail).toBe('folder-unusable')
      expect(String(refused.reason)).toContain(missing)

      // 🔴 **R92**: the same give, into the project's folder, is admitted and placed there.
      // ⚑ **D-016** — `give_work` starts the conversation its giver does not have yet, in `folder`.
      const admitted = await toolsOf(brobot.sessionId)('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: PROJECT_MANAGER_PROFILE_ID,
        title: 'Work in the repository',
        brief: 'work in the repository',
        folder: planted,
      })
      expect(admitted.outcome, JSON.stringify(admitted)).toBe('ok')
      expect(store.find(admitted.agent as string)?.cwd).toBe(planted)
    })
  })
})
