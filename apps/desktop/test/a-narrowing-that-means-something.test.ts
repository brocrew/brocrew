import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { brobotWorkspace } from '../src/main/runtime/workspace'
import {
  SPAWN_RAILS,
  describeRail,
  giveRequestSchema,
  permanenceOf,
} from '../src/main/runtime/spawn-rails'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
// ⚠️ **The sink INTERFACE is the host's, not the wire's** — the wire declares the message.
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'

/**
 * 🔴 **371 · a narrowing that means something.**
 *
 * ⛔ **The ruling this file was written to demonstrate was HO-010 ruling 4** (withdrawn by R92,
 * below). *"The project-relative reading makes a parent's narrowing a suggestion rather than a
 * boundary: **a child deep in a subtree climbing back to the root means the narrowing never
 * happened.** Monotone is the only reading where narrowing means anything, and it matches how every
 * other constraint in this system inherits — each level may be tighter than its parent and never
 * looser, exactly like `approvalMode`."*
 *
 * ⚑ **§1 was written at the state where the two readings DISAGREED** — a child already deep in a
 * subtree asking for the project root — because `341`'s own review found three rows surviving for
 * the opposite reason: *"a comparison tested where both readings agree measures nothing."* A test
 * whose parent is already standing at the root passes under both readings and measures neither.
 *
 * ⚑ **Real host, real SQLite ledger, real migrations, real `resolveSessionCwd`, real directories,
 * real symlinks.** The only double is the provider — and `node:fs` is wrapped so §2 can assert what
 * the spawn door asks of the disk rather than only that the answer came out right.
 *
 * A spawn has no parent-folder boundary. It defaults to the parent’s folder, preserves the
 * spelling supplied, and refuses an unusable folder with `folder-unusable`. Sections
 * concerning folder bounds are absent; `where-brobots-own-conversation-runs.test.ts` §3
 * checks that BroBot can place a child outside its own folder.
 *
 * ⚑ **D-016 · projects went, and with them `spawn_agent`'s `project` argument, `not-your-project`
 * and `project.cwd`.** §4's cases about that argument and §5's about a project's folder at launch
 * went too; §5 keeps what a launch that names no folder, or names one, still does.
 *
 * ⚑ **D-016 · `spawn_agent` went too.** A child is started by `give_work` when the giver has no
 * conversation with that agent, and its `folder` is the old `cwd` — used only for a start. Every
 * section below gives to an agent the giver has none with yet, so each give starts one; §4 reads
 * the give's arguments against `giveRequestSchema`, which the tool hands its arguments to verbatim.
 */

/**
 * ⛔ **Every `node:fs` call the folder rule can make, RECORDED — and forwarded untouched** (371).
 *
 * ⚠️ **`vi.spyOn(fs, 'statSync')` is not available**: measured on this tree, it fails with *"Module
 * namespace is not configurable in ESM"*, which is why this is a `vi.mock` factory that delegates.
 * Everything the suite does — migrations, `mkdtemp`, the workspace writer — runs through the real
 * implementations; the wrapper adds a line to a list and nothing else.
 *
 * ⚑ **`realpathSync` is rebuilt rather than replaced**, because `.native` is a property of the
 * function and a bare arrow would drop it — which would break every `realpathSync.native` caller for
 * the whole file and look like a product failure.
 */
const fsWatch = vi.hoisted(() => ({ calls: [] as string[], recording: false }))

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  const record = (name: string, path: unknown): void => {
    if (fsWatch.recording) fsWatch.calls.push(`${name} ${String(path)}`)
  }
  type Any = (...args: never[]) => unknown
  const realpathSync = Object.assign(
    (...args: never[]) => {
      record('realpathSync', args[0])
      return (real.realpathSync as Any)(...args)
    },
    {
      native: (...args: never[]) => {
        record('realpathSync.native', args[0])
        return (real.realpathSync.native as Any)(...args)
      },
    },
  )
  const patched = {
    ...real,
    statSync: (...args: never[]) => {
      record('statSync', args[0])
      return (real.statSync as Any)(...args)
    },
    accessSync: (...args: never[]) => {
      record('accessSync', args[0])
      return (real.accessSync as Any)(...args)
    },
    lstatSync: (...args: never[]) => {
      record('lstatSync', args[0])
      return (real.lstatSync as Any)(...args)
    },
    realpathSync,
  }
  return { ...patched, default: patched }
})

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const repoRoot = join(here, '../../..')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
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

describe('371 · a narrowing that means something', () => {
  let userData: string
  /** The folder the whole tree hangs off — stands in for a project root. */
  let root: string
  /** A directory that is genuinely somewhere else. */
  let elsewhere: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-narrow-'))
    root = mkdtempSync(join(tmpdir(), 'brobot2-narrow-root-'))
    elsewhere = mkdtempSync(join(tmpdir(), 'brobot2-narrow-else-'))
    mkdirSync(join(root, 'pkg', 'sub'), { recursive: true })
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 3_000_000
    store = createSessionStore(db, tick)
    counter = 0
    fsWatch.calls = []
    fsWatch.recording = false
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
      // ⚑ **339's own rule, wired in rather than faked** — the folder refusals below are
      // `checkSessionCwd`'s own sentences, reached through the seam a launch uses.
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
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    fsWatch.recording = false
    await host.closeAll()
    db.close()
    for (const dir of [userData, root, elsewhere]) rmSync(dir, { recursive: true, force: true })
  })

  /** A conversation a PERSON opened, in a window. Depth 0 by construction. */
  const personOpens = async (profileId: string, cwd?: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, approvalMode: 'ask', ...(cwd === undefined ? {} : { cwd }) },
      window,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId, root)
    await host.close(id, window)
  }

  /** The toolset one session is offered, called the way a provider would call it. */
  const toolsOf = (sessionId: string) => {
    const set = agentToolsFor(host, sessionId)
    const call = async (
      name: ToolName,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      const tool = set.tools.find((one) => one.name === name)
      if (tool === undefined) throw new Error(`no such tool: ${name}`)
      return (await tool.call(args)).structured as Record<string, unknown>
    }
    return { set, call }
  }

  const cwdOf = (sessionId: string): string => {
    const row = store.find(sessionId)
    if (row === null) throw new Error(`no such session row: ${sessionId}`)
    return row.cwd
  }

  /**
   * ⛔ **The chain the divergence needs: a person at the ROOT, and a child already deep in it.**
   *
   * ⚑ The `mid` conversation is standing at `<root>/pkg`, which is the only position from which
   * *"asking for the project root"* and *"asking for something outside my parent"* are the same act.
   * (`726` · R92: the two readings it separated were readings of a bound that no longer exists; the
   * chain stays as the fixture every section below spawns from.)
   */
  const aChildDeepInTheSubtree = async (): Promise<{ pm: string; mid: string }> => {
    for (const name of ['mid', 'deep']) await bringIdentityIntoBeing(name)
    const pm = await personOpens('pm', root)
    const spawned = await toolsOf(pm).call('give_work', {
      definition_of_done: 'The requested result and its checks are recorded.',
      profile: 'mid',
      title: 'work in one package',
      brief: 'work in one package',
      folder: join(root, 'pkg'),
    })
    expect(spawned.outcome).toBe('ok')
    const mid = spawned.agent as string
    expect(cwdOf(mid)).toBe(join(root, 'pkg'))
    return { pm, mid }
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · where a child deep in a subtree starts (`726` · R92: no bound, only a default)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · where a child deep in a subtree starts', () => {
    it('⚑ the child asking for its OWN descendant is placed there', async () => {
      const { mid } = await aChildDeepInTheSubtree()
      const allowed = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'narrow further',
        brief: 'narrow further',
        folder: join(root, 'pkg', 'sub'),
      })
      expect(allowed.outcome).toBe('ok')
      expect(cwdOf(allowed.agent as string)).toBe(join(root, 'pkg', 'sub'))
    })

    it('🔴 726 · a RELATIVE folder is read from the parent`s own, never from this process`s', async () => {
      // ⛔ **`726`'s review.** Nothing past rail 12 makes a spelling absolute — `checkSessionCwd`
      // resolves against the MAIN process's directory, `/` for the packaged app — and until `726`
      // `narrowsInto` refused such a path, so the question never came up. Without the rail, `'sub'`
      // would have been `<process cwd>/sub`: refused as a folder only a person can fix, or, for `'.'`,
      // a child started in `/`. `reply_to_parent.resource_path` reads a relative path the same way.
      const { mid } = await aChildDeepInTheSubtree()
      // ⚑ The control first (a refusal starts nothing): a relative name that is not there is
      // refused in the PARENT's terms.
      const missing = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'a folder that is not there',
        brief: 'a folder that is not there',
        folder: 'not-there',
      })
      expect(missing.outcome, JSON.stringify(missing)).toBe('refused')
      expect((missing.detail as { folderReason?: string }).folderReason).toBe(
        `cwd does not exist: ${join(root, 'pkg', 'not-there')}`,
      )
      const relative = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'a folder named from where I stand',
        brief: 'a folder named from where I stand',
        folder: 'sub',
      })
      expect(relative.outcome, JSON.stringify(relative)).toBe('ok')
      expect(cwdOf(relative.agent as string)).toBe(join(root, 'pkg', 'sub'))
    })

    it('⚑ a spawn that names NO folder inherits its parent`s, which is the ordinary case', async () => {
      const { mid } = await aChildDeepInTheSubtree()
      const allowed = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'stay where you are',
        brief: 'stay where you are',
      })
      expect(allowed.outcome).toBe('ok')
      expect(cwdOf(allowed.agent as string)).toBe(join(root, 'pkg'))
    })

    it('🔴 a BLANK folder is an absent one — before this it silently became the BroCrew workspace', async () => {
      const { mid } = await aChildDeepInTheSubtree()
      const allowed = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'blank is not the workspace',
        brief: 'blank is not the workspace',
        folder: '',
      })
      expect(allowed.outcome).toBe('ok')
      // ⛔ The parent's folder, and specifically NOT the workspace `checkCwd('')` used to send it to.
      expect(cwdOf(allowed.agent as string)).toBe(join(root, 'pkg'))
      expect(cwdOf(allowed.agent as string)).not.toBe(brobotWorkspace(userData))
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the folder a spawn names is asked of the disk (`726` · R92: no lexical arm before it)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the folder a spawn names is asked of the disk, and a refusal creates nothing', () => {
    /** Every recorded `node:fs` call whose path is at or under `path`. */
    const asked = (path: string): string[] =>
      fsWatch.calls.filter((line) => {
        const named = line.slice(line.indexOf(' ') + 1)
        return named === path || named.startsWith(`${path}/`)
      })

    const spawnWatching = async (mid: string, cwd: string): Promise<Record<string, unknown>> => {
      fsWatch.calls = []
      fsWatch.recording = true
      try {
        return await toolsOf(mid).call('give_work', {
          definition_of_done: 'The requested result and its checks are recorded.',
          profile: 'deep',
          title: 'watched',
          brief: 'watched',
          folder: cwd,
        })
      } finally {
        fsWatch.recording = false
      }
    }

    it('⚑ an allowed folder IS statted and accessed, by the same call through the same seam', async () => {
      const { mid } = await aChildDeepInTheSubtree()
      const inside = join(root, 'pkg', 'sub')
      const allowed = await spawnWatching(mid, inside)
      expect(allowed.outcome).toBe('ok')
      // ⚑ `folder-unusable` is a disk rule — it exists, it is a directory, it can be entered — so
      // the spawn door asks the disk about the folder it names.
      expect(asked(inside)).toContain(`statSync ${inside}`)
      expect(asked(inside)).toContain(`accessSync ${inside}`)
    })

    it('🔴 nothing is created on the refused path — no session, no provider home', async () => {
      const { mid } = await aChildDeepInTheSubtree()
      const homesBefore = host.profiles()
      // ⚑ `726` · R92: refused by `folder-unusable` — a folder that does not exist — since a folder
      // outside the parent's (`cwd-outside-parent`, the rail this used) is no longer refused.
      const refused = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'nothing is created',
        brief: 'nothing is created',
        folder: join(elsewhere, 'not-here'),
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('folder-unusable')
      expect(host.sessionIds).toHaveLength(2)
      expect(host.profiles()).toEqual(homesBefore)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · a folder named through a symlink (`726` · R92: its escape arm went with the bound)
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a folder named through a symlink', () => {
    it('⚑ a folder reached through a symlink is placed, and recorded as TYPED', async () => {
      const { mid } = await aChildDeepInTheSubtree()
      const inward = join(root, 'pkg', 'inward')
      symlinkSync(join(root, 'pkg', 'sub'), inward)
      const allowed = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'in through a link',
        brief: 'in through a link',
        folder: inward,
      })
      expect(allowed.outcome).toBe('ok')
      // ⚠️ **The spelling the person typed is what gets recorded**, not its `realpath` — 187's rule
      // and `checkSessionCwd`'s own contract. (Until `726` a containment question was asked on the
      // real spelling; the stored one was always the lexical path.)
      expect(cwdOf(allowed.agent as string)).toBe(inward)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · HO-010 §2.1 — the advertised arguments and the door's keys are ONE set
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the tool advertises exactly what the door accepts', () => {
    const giveTool = () => {
      const tool = agentToolsFor(host, 'sess_x').tools.find((one) => one.name === 'give_work')
      if (tool === undefined) throw new Error('give_work is not published')
      return tool
    }
    const doorKeys = (): string[] => Object.keys(giveRequestSchema.shape).sort()

    it('🔴 every ADVERTISED argument is a field the door accepts (the direction `project` failed)', () => {
      // ⚑ **D-016 · one spelling on both sides** — `spawn_agent` translated its advertised names
      // into the door's; `give_work` hands its arguments to the door verbatim, so the names ARE the
      // door's keys and there is no table between them.
      const advertised = Object.keys(giveTool().input).sort()
      expect(advertised.length).toBeGreaterThan(0)
      for (const name of advertised) expect(doorKeys()).toContain(name)
    })

    it('⚑ …and every field the door accepts is advertised — the tool fills none in', () => {
      // ⚑ **D-016** — the spawn door took a `parentSessionId` the tool filled in from its session;
      // the give's giver is the CALLER, so no door field is left for the tool to supply.
      expect(Object.keys(giveTool().input).sort()).toEqual(doorKeys())
    })

    it('⛔ naming a conversation to give FROM is refused rather than silently used', async () => {
      // ⚑ **D-016** — the field the spawn tool filled in is gone, and a caller that names it anyway
      // still believes something about this door that is not true: it is refused BY NAME.
      const { pm, mid } = await aChildDeepInTheSubtree()
      const refused = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'give from somebody else',
        brief: 'give from somebody else',
        parentSessionId: pm,
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('malformed-request')
      expect(JSON.stringify(refused.detail)).toContain('parentSessionId')
      expect(host.sessionIds).toHaveLength(2)
    })

    it('⚠️ an argument NEITHER name knows still reaches the door and is named there (criterion 10)', async () => {
      const { mid } = await aChildDeepInTheSubtree()
      const refused = await toolsOf(mid).call('give_work', {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'deep',
        title: 'x',
        brief: 'x',
        priority: 'urgent',
      })
      expect(refused.outcome).toBe('refused')
      expect(refused.rail).toBe('malformed-request')
      expect(JSON.stringify(refused.detail)).toContain('priority')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · what a launch that names no folder gets — ⚑ D-016: `project.cwd` went with projects
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · what a launch that names no folder gets', () => {
    it('⚑ a launch that names no folder starts in the durable BroBot workspace', async () => {
      // ⚑ **D-016** — this read *"…and with no project folder"*: a project's folder was the default
      // before the workspace, and it went with projects. The workspace is the one default left.
      const id = await personOpens('pm')
      expect(cwdOf(id)).toBe(brobotWorkspace(userData))
    })

    it('a person-selected folder is untouched, while an omitted folder creates the durable workspace', async () => {
      // ⚑ **D-016 · re-aimed at the folder that is left.** This set a PROJECT's folder and launched
      // with none; that folder went with projects, and the external folder a launch can carry now is
      // the one a person names.
      const withFolder = await personOpens('pm', root)
      expect(cwdOf(withFolder)).toBe(root)
      expect(() => statSync(join(root, 'CLAUDE.md'))).toThrow()
      expect(() => statSync(join(root, 'AGENTS.md'))).toThrow()
      expect(() => statSync(brobotWorkspace(userData))).toThrow()
      const withNone = await personOpens('pm')
      expect(cwdOf(withNone)).toBe(brobotWorkspace(userData))
      expect(lstatSync(brobotWorkspace(userData)).isDirectory()).toBe(true)
      expect(() => statSync(join(brobotWorkspace(userData), 'CLAUDE.md'))).toThrow()
      expect(() => statSync(join(brobotWorkspace(userData), 'AGENTS.md'))).toThrow()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §7 · the vocabulary, and the sentences carried into this file
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§7 · the closed vocabulary, and the carried items land', () => {
    it('⛔ the one folder rail is `folder-unusable`, and every rail has its own sentence', () => {
      // ⚑ `726` · R92 removed `cwd-outside-parent` from this vocabulary (it was `permanent`, with a
      // sentence of its own); `folder-unusable` is the one question a spawn's folder is asked now.
      expect(SPAWN_RAILS).not.toContain('cwd-outside-parent')
      expect(SPAWN_RAILS).toContain('folder-unusable')
      expect(permanenceOf('folder-unusable')).toBe('until-a-person-changes-it')
      const sentences = SPAWN_RAILS.map((rail) => describeRail(rail))
      expect(new Set(sentences).size).toBe(SPAWN_RAILS.length)
    })

    it('🔴 the approval rail sits among the rails of a START — 499`s position, and why it moved', () => {
      // 🔴 **`366`'s `spawn-must-prompt` was THIRD and this asserted `indexOf(...) === 2`.**
      // ⛔ That position was an artefact of the rule: an absolute *never `auto`* is decidable from
      // the request alone. ⚑ HO-036 withdrew the absolute and `wider-than-its-parent` compares two
      // conversations, so it needs the giver's mode AND the new conversation's provider.
      //
      // ⚑ **D-016 · R2** — a give names no provider: the conversation runs on the agent's own
      // (`providerOf`), else the giver's, so an unknown name no longer has to be refused before the
      // comparison can be made. The rail is asked only when the give would START a conversation —
      // after the switch and `may-not-create-agents`, which decide whether a start happens at all —
      // and before the profile rule (R3) and the folder.
      //
      // ⚠️ **Asserted as an ORDER and not as an index**, which is the stronger claim and the one
      // that survives a rail being inserted anywhere else.
      expect(SPAWN_RAILS).not.toContain('spawn-must-prompt')
      // ⛔ **Every anchor is present first**: `indexOf` of an absent rail is −1, which is "above"
      // everything and would pass an order it never measured.
      for (const rail of [
        'wider-than-its-parent',
        'spawning-disabled',
        'may-not-create-agents',
        'no-such-profile',
        'folder-unusable',
      ] as const) {
        expect(SPAWN_RAILS).toContain(rail)
      }
      expect(SPAWN_RAILS.indexOf('wider-than-its-parent')).toBeGreaterThan(
        SPAWN_RAILS.indexOf('spawning-disabled'),
      )
      expect(SPAWN_RAILS.indexOf('wider-than-its-parent')).toBeGreaterThan(
        SPAWN_RAILS.indexOf('may-not-create-agents'),
      )
      expect(SPAWN_RAILS.indexOf('wider-than-its-parent')).toBeLessThan(
        SPAWN_RAILS.indexOf('no-such-profile'),
      )
      // ⚑ The folder rail comes last: it is the one clause that asks the disk anything.
      expect(SPAWN_RAILS.indexOf('folder-unusable')).toBe(SPAWN_RAILS.length - 1)
    })

    it('🔴 497 · the development guide still carries `364`’s reachability, which SURVIVED the withdrawal', () => {
      const guide = readFileSync(join(repoRoot, 'docs/development.md'), 'utf8')
      // ⛔ **HO-035 withdrew *"never merge"* and *"PROD is read-only"* as product invariants, and
      // `364`'s measurement lived in the same paragraph.** ⚠️ The rule and the finding are different
      // things: the finding was never about merging — it is about where an agent can be POINTED,
      // it is still true, and it is what the unattended-autonomy question rests on. ⛔ **A sweep
      // that removed both would have deleted the only written record of a real reachability**, so
      // the clauses are asserted BY NAME here (standing rule 5) rather than left to survive a
      // rewrite nobody is holding to anything.
      expect(guide).toContain('`checkSessionCwd` admits any existing searchable directory')
      expect(guide).toContain("a spawned session takes its parent's")
      expect(guide).toContain('a conversation can be pointed at a real repository today')
      // ⚑ **And the withdrawal itself is written down**, so the next reader finds the ruling rather
      // than an unexplained gap — in plain words, without ruling numbers.
      expect(guide).toContain('"Never merge" and "never mutate PROD" are not rules of this product')
      // ⚠️ **The pair that makes these findings rather than a grep that matches anything**: neither
      // withdrawn RULE is listed as a table row, where it would be promised a mechanism.
      expect(guide).not.toContain('| Agents never merge |')
      expect(guide).not.toContain('| PROD read-only |')
    })

    it('🔴 the development guide carries HO-013 §2, by its load-bearing clauses rather than by its heading', () => {
      const guide = readFileSync(join(repoRoot, 'docs/development.md'), 'utf8')
      // ⛔ **Asserted BY NAME** — HO-013 §5: a safety sentence with no test is a comment. Each of
      // these is a step of the argument, and dropping any one of them makes the rest look optional.
      expect(guide).toContain('The third mode is not a path to spawned autonomy')
      // 🔴 **499 · this clause read *"what that buys"*, and *that* was HO-011 §3.1** — the
      // absolute HO-036 withdrew. ⚑ The argument is unchanged and its premise moved one ruling
      // over: what a spawned session gets is its PARENT's mode, and the step this line carries is
      // that the mode buys the card and nothing else.
      expect(guide).toContain('may never be wider than it')
      expect(guide).toContain('consent at the command level — the card — and nothing else')
      expect(guide).toContain('the third mode removes the card')
      // ⛔ **And the withdrawn premise is asserted ABSENT**, so a later edit cannot quietly put the
      // absolute back underneath an argument that no longer rests on it.
      expect(guide).not.toContain('HO-011 §3.1 forbids a spawned session from being `auto`')
      expect(guide).not.toContain('Spawned sessions stay in `ask`')
      expect(guide).toContain(
        'reads are unconfined under every Codex sandbox profile, `read-only` included',
      )
    })
  })
})
