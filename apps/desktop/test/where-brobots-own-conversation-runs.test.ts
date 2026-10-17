import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { WORKSPACE_DIRNAME } from '../src/main/runtime/workspace'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * ⚑ **584 · a LOCAL constant** (`HO-078` §1). ⛔ `PROJECT_MANAGER_PROFILE_ID` named the one other
 * identity this app used to ship, and a fresh install now ships `brobot` and nothing else — so the
 * slug is a name somebody CREATES, which is what this file drives it as.
 */
const PROJECT_MANAGER_PROFILE_ID = 'project-manager'

/**
 * 🔴 **424 §A · HO-023 §3, made true: BroBot's own conversation never runs in a project folder.**
 *
 * ## ⛔ The two sentences that could not both be true
 *
 * **HO-023 §3, the PO's ruling:** *"BroBot's session always runs in BroBot's workspace, never a
 * project folder, because BroBot is in no project."*
 *
 * **`420` §0, measured:** *"A front-door conversation runs in the PINNED PROJECT'S FOLDER. The
 * workspace is the fallback."* `runtime-host.ts` took `input.cwd ?? this.projectCwd(projectSlug)`,
 * and a conversation that named neither got whatever a person had typed into the project sheet.
 * ⚑ The ruling held by accident: `0013` seeds the pinned row before a `cwd` column existed and
 * `0016` adds it nullable with no backfill, so only an install where nobody had filled that field
 * agreed with it.
 *
 * ## ⚑ The discriminant, in one sentence
 *
 * **A conversation WITH BroBot inherits no project's folder; every other identity inherits the
 * folder of the project it is placed in.** ⛔ **"BroBot is in no project" is not representable** —
 * `agent_profile.project_id` is `NOT NULL` (`417` §1.5) — so the ruling is implemented as the
 * narrower thing that is true, and §2 below asserts that the BINDING is exactly as it was.
 *
 * ⛔ **It is not keyed on the REQUEST.** *"Nobody named a project"* would be the other candidate and
 * it changes nothing any caller does: `NewConversation.vue` sends `projectSlug` on every launch and
 * every spawn sends a `cwd`. ⚠️ **And it is not keyed on `role`** — standing rule 10 — but on
 * {@link DEFAULT_PROFILE_ID}, which `SEEDED_GRANTS` already calls *"the only fact in this app today
 * that names BroBot"*.
 *
 * ## ⚠️ Where this file is measured
 *
 * ⛔ **Every assertion is taken where the two readings DIVERGE** (standing rule 3): the pinned
 * project HAS a folder throughout §0, so *"BroBot gets the workspace"* and *"everybody gets the
 * project's folder"* give different answers. §1 is the state where they agree, and it is here as
 * the control that §0's difference is the FOLDER rather than the identity.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real IPC boundary** — the harness `376`
 * established and `420` used for the characterisation this replaces. The only double is the
 * provider.
 *
 * ⚠️ **`420`'s `where-a-front-door-conversation-runs.test.ts` is NOT in this branch.** It lives on
 * `mla/420-launched-without-a-picker`, which is not merged; its §1 keeps passing against this
 * change and its §2 — the characterisation of the defect — goes red, which is what it was written
 * to do. See the response document for the one-line instruction that belongs with the merge.
 *
 * ## ⚑ D-016 · projects went, and their folders with them
 *
 * ⛔ **No project has a folder any more**, so nothing is inherited and the discriminant above is
 * gone: every launch that names no folder runs in the workspace, BroBot's or not. ⚑ What this
 * file still measures is what stayed true without it — the workspace for a launch that names no
 * folder, a folder a person TYPED winning, a case variant of BroBot's slug refused before it
 * reaches anything, and a child of BroBot started in a folder outside BroBot's own. ⚠️ §0's
 * *with a folder on the pinned project*, the binding case, §1's clearing control and §2's
 * *placed in a second project* went: each was about a project's folder.
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
      // ⚑ **The real resolver, not a stub.** The whole question is which branch of
      // `resolveSessionCwd` a launch takes, and a double would answer it by fiat.
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
