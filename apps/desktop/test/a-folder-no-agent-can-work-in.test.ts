import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
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
  type CallerIdentity,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentCallerId } from '../src/main/runtime/agent-tools'
import {
  DEFAULT_PROFILE_ID,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * 🔴 **590 · a folder approved that no agent can work in.**
 *
 * ## ⛔ What BroBot found, in its own words
 *
 * ⚑ It wrote a report on its own instructions after setting up a real project, and put this at the
 * top of it:
 *
 * > ⛔ ***"`create_project.folder` — any absolute path, no stated relationship to my own directory.
 * > `spawn_agent.cwd` — may only ever be your own folder or one inside it. So a project can be
 * > approved by a human with a folder that no agent I spawn can ever work in. The failure surfaces
 * > one step later, AFTER the human has already said yes. This was avoided here only because the
 * > chosen path happened to sit inside the workspace."***
 *
 * ⚠️ **And the closing line of the whole report:** *"If one thing gets fixed: A3. A grant-shaped
 * mismatch that only fails after a human approves is the one that will waste the most time."*
 *
 * ## 🔴 The ruling that already answered it, and the half the code did not have
 *
 * ⛔ **HO-010 ruling 4, verbatim:** *"Narrow-only is parent-relative monotone… **`project.cwd` is
 * the initial bound at the first spawn into a project, and monotone from the parent thereafter.**"*
 *
 * A parent can start a child in a newly created project where the parent itself is not
 * standing. The first child’s folder therefore cannot be assumed to equal the parent’s
 * folder.
 *
 * ## ⚑ `726` · R92 — the project's folder is a DEFAULT now, never a bound
 *
 * Folder location does not cause refusal. A spawn crossing into a project without naming a
 * folder defaults to that project’s folder; a named folder is checked only for existence and
 * enterability (`folder-unusable`). The default and folder-usability assertions remain
 * distinct.
 *
 * ## ⚑ D-016 · projects are gone, and so is the crossing
 *
 * ⛔ `create_project`, its folder, a person approving it and `spawn_agent`'s `project` argument were
 * deleted with projects, so the mismatch this file was written for can no longer be built, and
 * every case that crossed into a project — the project's folder as a default, a project with no
 * folder, `not-your-project`, naming the project a parent stands in — went with it. ⚑ **What stays
 * is the spawn's folder as it is now**: a spawn that names no folder starts where its parent
 * stands, at every depth, and a folder it names is asked only whether it can be used — and the
 * sweep of the prose this ruling made false, for the sentences that still exist.
 *
 * ⛔ **Real host, real SQLite ledger, real migrations.** The only double is the provider.
 */
describe('590 · a folder approved that no agent can work in', () => {
  class PersonSink implements RuntimeEventSink {
    readonly aPersonIsBehindIt = true
    readonly messages: RuntimeEventMessage[] = []
    alive = true
    constructor(readonly ownerId: string) {}
    send(message: RuntimeEventMessage): void {
      this.messages.push(message)
    }
    sendLiveness(): void {}
    events(): TranscriptEvent[] {
      return this.messages.map((message) => message.event)
    }
  }

  let userData: string
  /** ⚑ Where BroBot stands. Its OWN folder, and the one every spawn was bounded by until `590`. */
  let workspace: string
  /** 🔴 **A repository OUTSIDE the workspace** — the whole subject of this file. */
  let repo: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let window: PersonSink
  let counter: number
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-590-'))
    workspace = mkdtempSync(join(tmpdir(), 'brobot2-590-ws-'))
    repo = mkdtempSync(join(tmpdir(), 'brobot2-590-repo-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 4_000_000
    store = createSessionStore(db, tick)
    counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider),
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
    })
    window = new PersonSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(workspace, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: workspace, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const speakingAs = (sessionId: string): CallerIdentity => ({ ownerId: agentCallerId(sessionId) })

  /**
   * ⚑ BroBot, standing in its own workspace, with a `pm` agent in existence. ⛔ No grant is set:
   * every agent may start any agent this app holds (D-014).
   */
  const aBroBotThatCanStaff = async (): Promise<string> => {
    await bringIdentityIntoBeing('pm')
    return personOpens(DEFAULT_PROFILE_ID)
  }

  const cwdOf = (sessionId: string): string | undefined => store.find(sessionId)?.cwd

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the default — a spawn that names no folder stands where its parent stands
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('⚑ §1 · a spawn that names no folder starts in its parent’s', () => {
    /**
     * 🔴 **The DEFAULT, as it is after D-016.** ⛔ This was the planted control beside a spawn into a
     * project, which started in that project's folder; the crossing went with projects, and what the
     * control protected is the whole rule now — the parent's folder is every such spawn's default.
     */
    it('⛔ the child of a parent that names no folder lands in the parent’s OWN folder', async () => {
      const brobot = await aBroBotThatCanStaff()
      // ⚑ **D-016** — a child is started by a give that finds no conversation with that agent.
      const staffed = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'no folder named',
          brief: 'no folder named',
        },
        speakingAs(brobot),
      )
      if (!staffed.ok) throw new Error(`the give was refused: ${staffed.refusal.rail}`)
      // ⚑ **D-042 moved where a start is said** — `started` (null for a conversation that existed)
      // became `runsOn.how`.
      expect(staffed.runsOn.how).toBe('started')
      expect(cwdOf(staffed.owner)).toBe(workspace)
      expect(cwdOf(staffed.owner)).not.toBe(repo)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a named folder is still asked — `726` · R92: no bound
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('⛔ §2 · a folder is asked only whether it can be used', () => {
    /**
     * Admit a named folder outside the parent’s folder. This is paired with §1’s call,
     * differing only in whether a folder is named.
     */
    it('🔴 726 · R92 — a cwd outside the parent’s folder is admitted: the child starts where it asked', async () => {
      // ⛔ On `main` before `726` this was refused (`cwd-outside-parent`).
      const brobot = await aBroBotThatCanStaff()
      const elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-590-elsewhere-'))
      try {
        // ⚑ **CONTROL · a folder that is not there is still said missing**, naming it — asked FIRST,
        // because a refusal opens no conversation and rail 11 would otherwise answer the second call.
        const missing = join(elsewhere, 'not-here')
        const refused = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'pm',
            title: 'a folder nobody made',
            brief: 'a folder nobody made',
            folder: missing,
          },
          speakingAs(brobot),
        )
        if (refused.ok) throw new Error(`the give was allowed: ${refused.owner}`)
        expect(refused.refusal.rail).toBe('folder-unusable')
        expect((refused.refusal.detail as { folderReason?: string }).folderReason).toContain(
          missing,
        )

        const placed = await host.giveWork(
          {
            definition_of_done: 'The requested result and its checks are recorded.',
            profile: 'pm',
            title: 'somewhere else entirely',
            brief: 'somewhere else entirely',
            folder: elsewhere,
          },
          speakingAs(brobot),
        )
        if (!placed.ok) throw new Error(`the give was refused: ${placed.refusal.rail}`)
        expect(cwdOf(placed.owner)).toBe(elsewhere)
        expect(cwdOf(placed.owner)).not.toBe(workspace)
      } finally {
        rmSync(elsewhere, { recursive: true, force: true })
      }
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · one level down — the default is where the child stands
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('⚑ §3 · one level down, the default is where the child stands', () => {
    /**
     * 🔴 **Re-aimed at the DEFAULT** (standing rule 26), and again at D-016. ⛔ Until `726` the
     * child's own children were refused `cwd-outside-parent` when they asked for a folder above
     * their parent; R92 removed the refusal. ⚑ What did not move is that the default is the DIRECT
     * parent's folder: a grandchild that names no folder starts where the CHILD stands, not where
     * the child's parent does and not at the root of the repository the child was sent into.
     */
    it('🔴 the child’s own children start where the child stands — not where its parent does', async () => {
      const brobot = await aBroBotThatCanStaff()
      const inside = join(repo, 'docs')
      mkdirSync(inside)
      const child = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'the docs PM',
          brief: 'the docs PM',
          folder: inside,
        },
        speakingAs(brobot),
      )
      if (!child.ok) throw new Error(`the give was refused: ${child.refusal.rail}`)
      expect(cwdOf(child.owner)).toBe(inside)

      // ⛔ **No folder named** — so the default, and the default is the child's. ⚑ D-016: the child
      // gives from the one piece it holds, and has no conversation with `pm` of its own, so it starts
      // one.
      const grandchild = await host.giveWork(
        {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'pm',
          title: 'one level down',
          brief: 'one level down',
        },
        speakingAs(child.owner),
      )
      if (!grandchild.ok) throw new Error(`the give was refused: ${grandchild.refusal.rail}`)
      // ⚑ **D-042** — `started` became `runsOn.how` (see §1).
      expect(grandchild.runsOn.how).toBe('started')
      expect(cwdOf(grandchild.owner)).toBe(inside)
      expect(cwdOf(grandchild.owner)).not.toBe(repo)
      expect(cwdOf(grandchild.owner)).not.toBe(workspace)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the prose this ruling made false
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('⛔ §7 · the sweep, asserted rather than promised', () => {
    const sourceOf = (relative: string): string => readFileSync(join(srcRoot, relative), 'utf8')

    /**
     * 🔴 **Standing rule 8.1** — a ruling that changes behaviour owes a sweep for prose describing
     * the old one, and the sentence a MODEL reads is the one that cost BroBot its afternoon.
     * ⚑ **D-016** — the first sentence this swept, on `spawn_agent`'s `project` argument, went with
     * the argument.
     *
     * ⛔ **`cwd`'s own description said the bound was always the caller's own folder.**
     * ⚑ A caller that believed that would never try the call §2 admits.
     *
     * ⚑ **`726` · R92 — re-aimed, world moved.** `590`'s replacement still said *"It may only ever be
     * that folder or one inside it"*; R92 removed the bound it described, and the description now
     * says any folder that exists. ⚑ **D-016** — `spawn_agent.cwd` became `give_work.folder`.
     */
    it('⛔ `give_work.folder` does not say the bound is only ever your own folder', () => {
      const tools = sourceOf('main/runtime/agent-tools.ts')
      expect(tools).not.toContain('Defaults to your own, and may only ever be your own folder')
      expect(tools).not.toContain('It may only ever be that folder or one inside it')
      // ⚑ W4.189 · the folder serves a first conversation and a grant on one that exists alike.
      expect(tools).toContain("A conversation this starts works in the piece's folder")
    })

    /**
     * 🔴 **`726` · R92 — and `reply_to_parent.resource_path` said the long form had to be INSIDE the
     * caller's own working directory**, the rule `resource-outside-workspace` enforced. Ingest now
     * reads a file from anywhere (`resolveResource`), so a description still saying *"inside your own
     * working directory"* would keep a model from offering a file the app would take.
     */
    it('⛔ `reply_to_parent.resource_paths` does not tell a caller a file must be inside its folder', () => {
      const tools = sourceOf('main/runtime/agent-tools.ts')
      expect(tools).not.toContain('A Markdown file inside your own working directory')
      // ⚑ 736 · `733` F-4 — and it names the kinds the store holds, rendered from its own list (the
      // behaviour is `finder-on-an-ended-conversation-and-the-kinds-held.test.ts` §2's). ⚑ D-016:
      // `resource_path` became `resource_paths`, the files a reply hands back as resources.
      expect(tools).toContain('— ${HELD_FORMS_WITH_EXTENSIONS_SAID} — anywhere;')
    })

    /**
     * 🔴 **Two docblocks asserted the OLD rule as a decision** (standing rule 19), and a repair that
     * changes behaviour a docblock describes must correct it in the same commit.
     *
     * ⚑ **`726` · R92 — re-aimed, world moved.** The positive half read *"the first spawn into a
     * project"*, HO-010 ruling 4's bound; R92 made that folder a DEFAULT, and D-016 took the project
     * out of it — rail 12's comment now says the parent's folder is the default, in those words.
     */
    it('🔴 the two docblocks that asserted the old bound no longer assert it', () => {
      const cwd = sourceOf('main/runtime/scratch-cwd.ts')
      expect(cwd).not.toContain(
        'nothing it spawns can climb into a repository its parent is not in.',
      )
      const rails = sourceOf('main/runtime/spawn-rails.ts')
      expect(rails).not.toContain('So the bound is the\n   * PARENT’s cwd, every time')
      // ⚑ **D-016 · the folder clause's comment names the one default left** — it named the crossing
      // into a project, which went with projects, and it is a GIVE's folder now.
      expect(rails).toContain("A give that names no folder starts its conversation in the giver's")
      expect(rails).toContain('never a bound')
    })
  })
})
