import { RecordingSink, neutralHostDeps, fixtureProviderConfig } from './lib/host-fixture'
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
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { WORKSPACE_DIRNAME } from '../src/main/runtime/workspace'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'

/**
 * 🔴 **420 §3 · where a conversation opened through the front door actually runs.**
 *
 * ## ⛔ The two sentences that cannot both be true
 *
 * **HO-023 §3, the PO's ruling:** *"BroBot's session always runs in BroBot's workspace, never a
 * project folder, because BroBot is in no project."*
 *
 * **`runtime-host.ts:5071`, the code:**
 * `const cwd = this.deps.resolveCwd(id, input.cwd ?? this.projectCwd(projectSlug))`
 *
 * `417` removed the launcher's folder field, so the front door sends no `cwd` **and** no
 * `projectSlug`. The first absence sends the launch to `projectCwd`; the second resolves the
 * project to `DEFAULT_PROJECT_ID` (`runtime-host.ts:5034`). ⚑ **So the pinned project's folder is
 * what a front-door conversation gets, and the workspace is only the fallback for a project that
 * has not named one.** The ruling holds today by accident — migration `0013` seeds the pinned row
 * before `cwd` existed and `0016` adds the column nullable with no backfill — and stops holding
 * the moment anybody fills the folder field on the project sheet, which is a live surface
 * (`ProjectSheet.vue:314`, reachable from `projects-settings-<slug>` on the board — it was
 * `rail-real-project` until `572` moved the list out of the rail, `EXT-008` §1).
 *
 * ## ⚠️ Why this is a test and not a paragraph in a response
 *
 * ⛔ **420 §3 steers the live instruments to plant their folder on the project sheet** — *"a
 * project is where a conversation is placed… plant it there and let the session inherit it"* —
 * and warns, in the same breath, that doing so may reproduce the very defect the ruling forbids.
 * It does. An instrument that planted a folder on the pinned project would move **every**
 * subsequent front-door conversation into it, which is both the defect and a silent change to
 * every later step's working directory.
 *
 * ⚑ **This file is the measurement, in the gate, both branches.** It is deliberately written as a
 * CHARACTERISATION of what the code does rather than as a demand that it keep doing it: the day
 * the ruling is implemented, `§2` below goes red and the person who implemented it deletes it and
 * keeps `§1`. 🔴 **What must never happen is the third thing** — the behaviour changing with
 * nothing going red, or the ruling being quoted onward as though the code agreed with it.
 *
 * ## ⚑ The payload is DERIVED from the component, not restated here
 *
 * Standing rule 1. A test that hand-wrote *"the three fields the front door sends"* would go on
 * passing after a fourth was added, measuring a launch shape the product had stopped making.
 * {@link FRONT_DOOR_SENDS} reads `NewConversation.vue` and `§0` refuses to run on anything it did
 * not recognise.
 *
 * ⚠️ **Real host, real SQLite ledger, real migrations, real IPC boundary** — the harness
 * `a-second-project-and-the-grant.test.ts` established at `376`. The only double is the provider.
 *
 * ⚑ **D-016 · projects went, and their folders with them**: no project has a folder to plant, so
 * §1's premise read of the pinned project's folder and its *"bound to the pinned project"* case —
 * the channel a project folder travelled down — are gone. §0 and the workspace case stay.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('420 §3 · a conversation opened through the front door', () => {
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
    userData = mkdtempSync(join(tmpdir(), 'brobot2-front-door-cwd-'))
    // ⚑ **Outside `userData`, where a person's folder would be.** (Until `726` · R92
    // `scratch-cwd.ts` refused any folder inside the app's own data directory except the
    // workspace, so a folder planted under `userData` was refused by the save; R92 removed
    // that refusal.)
    planted = mkdtempSync(join(tmpdir(), 'brobot2-front-door-planted-'))
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
      prepareProviderHome: (provider: Provider, profileId?: string) =>
        join(userData, 'provider-homes', profileId ?? 'default', provider),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      // ⚑ **The real resolver, not a stub.** The whole question is which branch of
      // `resolveSessionCwd` a front-door launch takes, and a double would answer it by fiat.
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

  /**
   * **What the front door sends, and nothing else.** ⛔ `cwd` and `projectSlug` are ABSENT rather
   * than blank, and the difference decides the whole file: `undefined ?? x` reaches `projectCwd`,
   * `'' ?? x` does not.
   */
  const openTheFrontDoor = async (): Promise<string> => {
    const opened = (await ask({
      kind: 'createSession',
      provider: 'codex',
      profileId: DEFAULT_PROFILE_ID,
      approvalMode: 'ask',
    })) as { sessionId: string }
    return opened.sessionId
  }

  describe('§1 · with no folder on the pinned project — the ruling holds', () => {
    it('⚑ the conversation runs in BroBot’s own workspace', async () => {
      // ⚑ **D-016** — the premise read that the pinned project had no folder went with project
      // folders: there is no folder for a front-door launch to inherit.
      const sessionId = await openTheFrontDoor()
      expect(store.find(sessionId)?.cwd).toBe(join(userData, WORKSPACE_DIRNAME))
    })
  })

  /*
   * ⛔ **§2 IS GONE, and this is the note it left** (`423` relay 1 §4.2, on the PM's instruction).
   *
   * It measured the defect this file was written for: with a folder on the pinned project, a
   * front-door conversation ran in THAT folder rather than in the workspace — three tests, the
   * second asserting it was the same cwd the provider was started in and the third clearing the
   * folder as a control. ⚑ **The docblock above said what would happen next, and it happened**:
   * *"the day the ruling is implemented, `§2` below goes red and the person who implemented it
   * deletes it and keeps `§1`."*
   *
   * 🔴 **`424` implemented it** — BroBot's conversation runs in `<userData>/brobot-workspace`,
   * keyed on `DEFAULT_PROFILE_ID` — and shipped its successor,
   * `where-brobots-own-conversation-runs.test.ts` (9 tests), so the property is not unmeasured.
   * ⚠️ **`424` could not delete §2 itself**, because this file was on `420`'s branch and not on
   * `main`; its own F1 says so. This is that deletion, made by the branch that carries the file.
   *
   * ⛔ **What is unmeasured until this stack lands on top of `424`, said out loud rather than
   * discovered:** on THIS branch the old behaviour is still live and now has no test. §0 still
   * pins that the front door sends neither `cwd` nor `projectSlug`, and §1 still pins the
   * no-folder branch — so what went with §2 is exactly the *with*-a-folder branch, which `424`'s
   * successor owns and which is red here only because `424` is not here yet.
   */
})
