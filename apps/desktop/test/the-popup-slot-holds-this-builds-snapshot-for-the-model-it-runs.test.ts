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
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { profileBundleSpans, thisConversationSpans } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  ensureWorkspace,
  workspaceOwnFilesIn,
} from '../src/main/runtime/workspace'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { SNAPSHOT_FILES, snapshotFor } from '../src/main/provider-snapshots'
import {
  sizeOf,
  type ProviderSnapshotFile,
  type SnapshotAnswer,
} from '../src/shared/provider-snapshots'
import type { PartSize, WhatThisAgentWasGiven } from '../src/shared/what-this-agent-was-given'
import type { ProviderVersion, RuntimeEventMessage } from '../src/shared/runtime-ipc'

/**
 * # 🔴 F093 · R3 — the popup's provider slot holds this build's snapshot, for the model the
 * conversation runs
 *
 * ⚑ **A real host on the fake runtime**, with `main/index.ts`'s instruction wiring copied, on
 * throwaway folders — as `what-this-agent-was-given.test.ts` builds it. ⚑ The seam
 * (`RuntimeHostDeps.providerSnapshot`) is `snapshotFor` itself, watched: each lookup it is asked is
 * kept, so the ORDER the host asks in is read, not only the answer it shows.
 *
 *  - §1 · the model: the one the provider last reported running, else the one selected, else none —
 *    the provider's default. The first one captured wins; none captured, the first one's why.
 *  - §2 · ⛔ a host that carries no snapshots says so, and counts nothing for the provider.
 *  - §3 · `size.provider` is the snapshot's own total — what stands before the model asks for
 *    anything — and it is what `size.total` gains, exactly.
 *  - §4 · how a snapshot may differ: another provider version than the app runs, or a launch made by
 *    another build — and the first of the two when both are true.
 *  - §5 · `main/index.ts` wires the seam to this build's own files.
 */

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt: boolean = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

type Seam = (provider: Provider, model: string | null) => SnapshotAnswer

/** What a provider's program said for `--version`, as the reader answers it; only the number is read here. */
const saidVersion = (version: string): ProviderVersion => ({
  version,
  program: {
    standing: 'tested',
    from: 'carried',
    path: '/a/program',
    version,
    tested: null,
    said: `It is ${version}.`,
    help: null,
    update: null,
    others: [],
    updatedFrom: null,
  },
})

interface HostShape {
  /** The seam; `null`: a host that carries none. Default: `snapshotFor`, watched. */
  readonly seam?: Seam | null
  readonly commit?: string
  readonly versions?: Readonly<Record<Provider, ProviderVersion>>
}

describe('F093 · R3 · the popup’s provider slot', () => {
  let userData: string
  let project: string
  let db: AppDatabase
  let store: SessionStore
  let hosts: RuntimeHost[]
  let counter: number
  let window: RecordingSink
  /** ⚑ Every lookup the seam was asked, in order. */
  let asked: [Provider, string | null][]

  const homeOf = (provider: Provider, profileId: string): string =>
    join(userData, 'provider-homes', 'default', profileId, provider)

  const watched: Seam = (provider, model) => {
    asked.push([provider, model])
    return snapshotFor(provider, model)
  }

  const buildHost = (shape: HostShape = {}): RuntimeHost => {
    const seam = shape.seam === undefined ? watched : shape.seam
    const commit = shape.commit ?? 'abc1234def'
    const versions = shape.versions
    const runtimes = new Map<Provider, FakeRuntime>()
    const built = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => {
        const known = runtimes.get(provider)
        if (known !== undefined) return known
        const runtime = new FakeRuntime(provider)
        runtimes.set(provider, runtime)
        return runtime
      },
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = homeOf(provider, profileId ?? 'default')
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider, profileId: string) => homeOf(provider, profileId),
      providerHomesRoot: () => join(userData, 'provider-homes'),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${String(++counter)}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      whichBuild: () => ({ id: commit.slice(0, 7), commit, dirty: false, schema: 7 }),
      ...(versions === undefined ? {} : { providerVersions: () => Promise.resolve(versions) }),
      ...(seam === null ? {} : { providerSnapshot: seam }),
      readInstructions: (provider, cwd, providerHome, context) => {
        const composed = profileBundleSpans(context)
        const bundle = publishProfileBundle(provider, providerHome, composed.text)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          bundleComposed: composed,
          thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider)),
          workspaceFile: join(brobotWorkspace(userData), CLAUDE_INSTRUCTIONS_FILE),
          workspaceOwnFiles: workspaceOwnFilesIn(userData),
          home: userData,
        })
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: read.memoryLoaded,
          profileFile: read.profileFile,
        }
      },
    })
    hosts.push(built)
    return built
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-f093-r3-'))
    project = join(userData, 'project')
    mkdirSync(project, { recursive: true })
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    ensureWorkspace(userData)
    hosts = []
    counter = 0
    asked = []
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    for (const host of hosts) await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  const open = async (host: RuntimeHost, provider: Provider, model?: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      {
        provider,
        profileId: 'lead',
        approvalMode: 'auto',
        cwd: project,
        ...(model === undefined ? {} : { model }),
      },
      window,
    )
    return sessionId
  }

  /** ⚑ What a conversation runs, set on its row as the provider's report and a person's choice set it. */
  const runsOn = (sessionId: string, reported: string | null, selected: string | null): void => {
    store.setReportedModel(sessionId, reported, null)
    store.setModel(sessionId, selected)
  }

  /** ⚑ The read, with the seam's lookups for it alone. */
  const read = async (
    host: RuntimeHost,
    sessionId: string,
  ): Promise<{ given: WhatThisAgentWasGiven; lookups: [Provider, string | null][] }> => {
    asked = []
    const given = await host.whatThisAgentWasGiven(sessionId)
    return { given, lookups: asked }
  }

  const totalOf = (snapshot: { chars: number; words: number; approxTokens: number }): PartSize => ({
    characters: snapshot.chars,
    words: snapshot.words,
    tokens: snapshot.approxTokens,
  })

  describe('§1 · the model the snapshot is looked up by', () => {
    it('🔴 the model the provider reported running comes first, and the first one captured ends the lookup', async () => {
      const host = buildHost()
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, 'sonnet', 'opus')
      const { given, lookups } = await read(host, lead)
      expect(lookups).toEqual([['claude', 'sonnet']])
      expect(given.providerParts.model).toBe('sonnet')
      expect(given.providerParts.snapshot?.model).toBe('sonnet')
      expect(given.providerParts.why).toBeNull()

      // ⚑ The control: with no report, the one selected.
      runsOn(lead, null, 'opus')
      const selected = await read(host, lead)
      expect(selected.lookups).toEqual([['claude', 'opus']])
      expect(selected.given.providerParts.snapshot?.model).toBe('opus')
    })

    it('🔴 a reported model this build did not capture: the one selected, asked second', async () => {
      const host = buildHost()
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, 'claude-nonesuch-9', 'opus')
      const { given, lookups } = await read(host, lead)
      expect(lookups).toEqual([
        ['claude', 'claude-nonesuch-9'],
        ['claude', 'opus'],
      ])
      expect(given.providerParts).toMatchObject({ model: 'opus', why: null })
      expect(given.providerParts.snapshot?.model).toBe('opus')
    })

    it('⛔ neither captured: the reported one’s why, no snapshot, and nothing counted for the provider', async () => {
      const host = buildHost()
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, 'claude-nonesuch-9', 'claude-nonesuch-8')
      const { given, lookups } = await read(host, lead)
      expect(lookups.map(([, model]) => model)).toEqual(['claude-nonesuch-9', 'claude-nonesuch-8'])
      expect(given.providerParts).toEqual({
        version: given.providerParts.version,
        model: 'claude-nonesuch-9',
        snapshot: null,
        why: `claude-nonesuch-9 was not captured ${SNAPSHOT_FILES.claude.label}.`,
      })
      expect(given.size.provider).toBeNull()
    })

    it('⚑ the same name reported and selected is asked once; an empty report is no name', async () => {
      const host = buildHost()
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, 'opus', 'opus')
      expect((await read(host, lead)).lookups).toEqual([['claude', 'opus']])
      runsOn(lead, '', 'sonnet')
      expect((await read(host, lead)).lookups).toEqual([['claude', 'sonnet']])
    })

    it('⚑ the id the provider told its model finds the menu’s model; the slot keeps the name it was looked up by', async () => {
      const host = buildHost()
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, 'claude-opus-5-5[1m]', null)
      const { given } = await read(host, lead)
      expect(given.providerParts.model).toBe('claude-opus-5-5[1m]')
      expect(given.providerParts.snapshot?.model).toBe('opus')
    })

    it('⚑ no model named at all: asked once with none, and the provider’s own default answers', async () => {
      const host = buildHost()
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, null, null)
      const { given, lookups } = await read(host, lead)
      expect(lookups).toEqual([['claude', null]])
      expect(given.providerParts.model).toBeNull()
      expect(given.providerParts.snapshot?.model).toBe(SNAPSHOT_FILES.claude.defaultModel)
      expect(given.providerParts.why).toBeNull()
    })

    it('⛔ a Codex conversation is looked up under Codex: a Claude model there is not captured, its own is', async () => {
      const host = buildHost()
      const lead = await open(host, 'codex', 'gpt-5.5')
      runsOn(lead, 'opus', 'gpt-5.5')
      const { given, lookups } = await read(host, lead)
      expect(lookups).toEqual([
        ['codex', 'opus'],
        ['codex', 'gpt-5.5'],
      ])
      expect(given.providerParts.snapshot).toMatchObject({
        provider: 'codex',
        model: 'gpt-5.5',
        shape: 'functions',
      })
      // ⚑ …and alone, the Claude name is said not captured — by Codex's label.
      runsOn(lead, 'opus', null)
      const alone = await read(host, lead)
      expect(alone.given.providerParts).toMatchObject({
        model: 'opus',
        snapshot: null,
        why: `opus was not captured ${SNAPSHOT_FILES.codex.label}.`,
      })
    })

    it('🔴 the slot holds the snapshot exactly as the window’s own channel answers it', async () => {
      const host = buildHost()
      const lead = await open(host, 'codex', 'gpt-6.1-sol')
      runsOn(lead, null, 'gpt-6.1-sol')
      const { given } = await read(host, lead)
      const answer = snapshotFor('codex', 'gpt-6.1-sol')
      if (!answer.found) throw new Error('gpt-6.1-sol is not captured')
      expect(given.providerParts.snapshot).toEqual(answer.snapshot)
    })
  })

  describe('§2 · ⛔ a host that carries no snapshots', () => {
    it('⛔ says so in the provider’s own name, shows no model, and counts nothing for the provider', async () => {
      for (const provider of ['claude', 'codex'] as const) {
        const host = buildHost({ seam: null })
        const lead = await open(host, provider)
        const given = await host.whatThisAgentWasGiven(lead)
        const name = provider === 'claude' ? 'Claude Code' : 'Codex'
        expect(given.providerParts, provider).toEqual({
          version: given.providerParts.version,
          model: null,
          snapshot: null,
          why: `This app carries no snapshot of what ${name} puts in front of its model on its own.`,
        })
        expect(given.size.provider, provider).toBeNull()
      }
    })
  })

  describe('§3 · what the provider’s parts add to the total', () => {
    it('🔴 `size.provider` is the snapshot’s own total — its parts but those loaded on demand', async () => {
      const host = buildHost()
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, null, 'opus')
      const { given } = await read(host, lead)
      const snapshot = given.providerParts.snapshot
      if (snapshot === null) throw new Error('opus is not captured')
      const loaded = snapshot.parts.filter((one) => one.when === 'when-loaded')
      // ⚑ Presence first: there is a part to leave out.
      expect(loaded.length).toBeGreaterThan(0)
      const before = sizeOf(
        snapshot.parts
          .filter((one) => one.when !== 'when-loaded')
          .map((one) => one.text)
          .join('\n'),
      )
      expect(given.size.provider).toEqual({
        characters: before.chars,
        words: before.words,
        tokens: before.approxTokens,
      })
      const everything = sizeOf(snapshot.parts.map((one) => one.text).join('\n'))
      expect(given.size.provider?.characters).toBeLessThan(everything.chars)
    })

    it('🔴 paired on one conversation: found, the total gains the snapshot’s total exactly; not found, nothing', async () => {
      // ⚑ One host, one conversation: the seam answers from files built here, or says not captured.
      const prompt = 'Provider prompt. '.repeat(30)
      const loadedOnDemand = 'Loaded only when asked for. '.repeat(80)
      const file: ProviderSnapshotFile = {
        provider: 'claude',
        version: SNAPSHOT_FILES.claude.version,
        label: SNAPSHOT_FILES.claude.label,
        defaultModel: 'only',
        notes: [],
        models: {
          only: {
            shape: 'messages',
            alsoCalled: [],
            parts: [
              {
                id: 'p',
                title: 'p',
                where: 'system-prompt',
                when: 'every-request',
                text: 'h1',
              },
              {
                id: 'd',
                title: 'd',
                where: 'tools',
                when: 'when-loaded',
                text: '',
                tools: [{ name: 'Later', text: 'h2' }],
              },
            ],
          },
        },
        texts: { h1: prompt, h2: loadedOnDemand },
      }
      let carried = true
      const host = buildHost({
        seam: (provider, model) => {
          asked.push([provider, model])
          return carried
            ? snapshotFor(provider, 'only', { ...SNAPSHOT_FILES, claude: file })
            : { found: false, why: 'not here', models: [] }
        },
      })
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, null, 'opus')

      const withIt = (await read(host, lead)).given
      carried = false
      const without = (await read(host, lead)).given

      expect(withIt.providerParts.snapshot?.model).toBe('only')
      expect(without.providerParts).toMatchObject({ snapshot: null, why: 'not here' })
      const shot = sizeOf(prompt)
      expect(withIt.size.provider).toEqual(totalOf({ ...shot }))
      expect(without.size.provider).toBeNull()
      // ⛔ Exactly the snapshot's total, and never the part loaded on demand.
      expect(withIt.size.total).toEqual({
        characters: without.size.total.characters + shot.chars,
        words: without.size.total.words + shot.words,
        tokens: without.size.total.tokens + shot.approxTokens,
      })
      // ⚑ Every other measure is the same on both reads: only the provider's line moved.
      for (const key of ['brobot', 'otherFiles', 'tools', 'memoryInEveryRequest'] as const) {
        expect(withIt.size[key], key).toEqual(without.size[key])
      }
    })
  })

  describe('§4 · how a snapshot may differ from what this conversation was sent', () => {
    it('🔴 another provider version than the app runs: said, and the snapshot still shown', async () => {
      const host = buildHost({
        versions: {
          claude: saidVersion('0.0.1'),
          codex: saidVersion(SNAPSHOT_FILES.codex.version),
        },
      })
      const claude = await open(host, 'claude', 'opus')
      runsOn(claude, null, 'opus')
      const read1 = (await read(host, claude)).given
      expect(read1.providerParts.version).toBe('0.0.1')
      expect(read1.providerParts.why).toBe(
        `This app runs Claude Code 0.0.1, and the snapshot is ${SNAPSHOT_FILES.claude.label}.`,
      )
      expect(read1.providerParts.snapshot?.model).toBe('opus')
      expect(read1.size.provider).not.toBeNull()

      // ⚑ The control: the version the snapshot is of says nothing more.
      const codex = await open(host, 'codex', 'gpt-5.5')
      runsOn(codex, null, 'gpt-5.5')
      const read2 = (await read(host, codex)).given
      expect(read2.providerParts.version).toBe(SNAPSHOT_FILES.codex.version)
      expect(read2.providerParts.why).toBeNull()
    })

    it('⚑ a version that cannot be read claims no difference', async () => {
      const host = buildHost({
        versions: {
          claude: { version: null, reason: 'unreadable here' },
          codex: { version: null, reason: 'unreadable here' },
        },
      })
      const lead = await open(host, 'claude', 'opus')
      runsOn(lead, null, 'opus')
      const { given } = await read(host, lead)
      expect(given.providerParts.version).toBeNull()
      expect(given.providerParts.snapshot?.model).toBe('opus')
      expect(given.providerParts.why).toBeNull()
    })

    it('🔴 a launch another build made: said, in the provider’s name — and not by the build that made it', async () => {
      for (const provider of ['claude', 'codex'] as const) {
        const model = provider === 'claude' ? 'opus' : 'gpt-5.5'
        const first = buildHost({ commit: 'aaaaaaa1111' })
        const lead = await open(first, provider, model)
        await first.close(lead, window)
        runsOn(lead, null, model)

        // ⚑ The control: the build that made the launch reads it as its own.
        const same = buildHost({ commit: 'aaaaaaa1111' })
        const own = (await read(same, lead)).given
        expect(own.launch, provider).toMatchObject({ recorded: true, thisBuild: true })
        expect(own.providerParts.why, provider).toBeNull()

        const other = buildHost({ commit: 'bbbbbbb2222' })
        const theirs = (await read(other, lead)).given
        expect(theirs.launch, provider).toMatchObject({ recorded: true, thisBuild: false })
        const name = provider === 'claude' ? 'Claude Code' : 'Codex'
        expect(theirs.providerParts.why, provider).toBe(
          `Another build of this app made this conversation’s last launch, and its ${name} may have put other parts in front of the model.`,
        )
        expect(theirs.providerParts.snapshot?.model, provider).toBe(model)
      }
    })

    it('⚑ both true: the version is said, as the first of the two', async () => {
      const first = buildHost({ commit: 'aaaaaaa1111' })
      const lead = await open(first, 'claude', 'opus')
      await first.close(lead, window)
      runsOn(lead, null, 'opus')
      const other = buildHost({
        commit: 'bbbbbbb2222',
        versions: { claude: saidVersion('0.0.1'), codex: saidVersion('0.0.1') },
      })
      const { given } = await read(other, lead)
      expect(given.launch).toMatchObject({ recorded: true, thisBuild: false })
      expect(given.providerParts.why).toBe(
        `This app runs Claude Code 0.0.1, and the snapshot is ${SNAPSHOT_FILES.claude.label}.`,
      )
    })
  })

  describe('§5 · the app’s own wiring', () => {
    it('⚑ `main/index.ts` hands the host this build’s `snapshotFor`, by the model asked', () => {
      const main = readFileSync(join(here, '../src/main/index.ts'), 'utf8')
      // ⚑ Imported from this build's own module, on whichever import line it sits.
      expect(main).toMatch(/import \{[^}]*\bsnapshotFor\b[^}]*\} from '\.\/provider-snapshots'/)
      const wiring = '    providerSnapshot: (provider, model) => snapshotFor(provider, model),\n'
      expect(main).toContain(wiring)
    })
  })
})
