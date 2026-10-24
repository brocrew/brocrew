import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FakeRuntime,
  FakeProviderSessions,
  type StartOptions,
  type ResumeOptions,
  type SessionRef,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import {
  RuntimeHost,
  type RuntimeHostDeps,
  type RuntimeEventSink,
} from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  profileBundleSpans,
  thisConversationSpans,
  type InstructionContext,
  type ToolsToldInText,
} from '../src/main/runtime/factory-text'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { prepareBuiltInSkills, readBuiltInSkills } from '../src/main/skills/prepare-built-in-skills'

// The explicit provider argument is the new composition seam; keep the RED compilable.
const leadFor = thisConversationSpans as (
  context: InstructionContext,
  tools: ToolsToldInText | undefined,
  provider: Provider,
) => ReturnType<typeof thisConversationSpans>
const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly ownerId = 'webContents:1'
  readonly alive = true
  send(): void {}
  sendLiveness(): void {}
}

// The real host, repository, publisher and instruction reader. Only the external providers are
// faked; captures are the start/resume options handed to their runtime boundary.
describe('own notes reach starts and cold resumes from one recorded launch snapshot', () => {
  let root: string
  let cwd: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let buildHost: () => RuntimeHost
  let window: Window
  let counter: number
  let sequence: number
  let sessions: FakeProviderSessions
  let skillPreparation: RuntimeHostDeps['prepareBuiltInSkills']
  let atLaunch: (() => void) | undefined
  let options: (StartOptions | ResumeOptions)[]
  let reads: {
    provider: Provider
    context: InstructionContext
    bundle: ReturnType<typeof profileBundleSpans>
    lead: ReturnType<typeof thisConversationSpans>
    read: ReturnType<typeof readSessionInstructions>
  }[]

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'notes-launch-'))
    cwd = join(root, 'project')
    mkdirSync(cwd)
    db = openDatabase(join(root, 'app.sqlite'))
    applyMigrations(db, migrations)
    counter = 1000
    sequence = 0
    sessions = new FakeProviderSessions()
    store = createSessionStore(db, () => counter++)
    options = []
    reads = []
    atLaunch = undefined
    skillPreparation = undefined
    class Runtime extends FakeRuntime {
      override async start(opts: StartOptions): ReturnType<FakeRuntime['start']> {
        options.push(opts)
        atLaunch?.()
        return super.start(opts)
      }
      override async resume(
        ref: SessionRef,
        opts: ResumeOptions,
      ): ReturnType<FakeRuntime['resume']> {
        options.push(opts)
        atLaunch?.()
        return super.resume(ref, opts)
      }
    }
    const home = (provider: Provider, profile?: string | null) =>
      join(root, 'homes', profile ?? 'brobot', provider)
    buildHost = () =>
      new RuntimeHost({
        store,
        prepareBuiltInSkills: skillPreparation,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(root, 'exports'),
        createRuntime: (provider) => new Runtime(provider, { sessions }),
        prepareProviderHome: (provider, profile) => {
          const value = home(provider, profile)
          mkdirSync(value, { recursive: true })
          return value
        },
        providerHomePath: home,
        resolveCwd: (id, requested) => resolveSessionCwd(root, id, requested),
        newSessionId: () => `launch-${++sequence}`,
        now: () => counter++,
        readProviderConfig: (_provider, path) => ({
          home: path,
          homeEnv: 'CODEX_HOME',
          model: 'm',
          authNote: null,
          files: [],
        }),
        readInstructions: (provider, cwd, providerHome, context) => {
          const bundle = profileBundleSpans(context, provider)
          const lead = leadFor(context, toolsToldInTextFor(provider), provider)
          const published = publishProfileBundle(provider, providerHome, bundle.text)
          const read = readSessionInstructions({
            provider,
            cwd,
            providerHome,
            home: root,
            bundle: published,
            bundleComposed: bundle,
            thisConversation: lead,
          })
          reads.push({ provider, context, bundle, lead, read })
          return {
            instructions: read.instructions,
            systemHint: read.systemHint ?? undefined,
            ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
            memoryLoaded: read.memoryLoaded,
            profileFile: read.profileFile,
            context,
          }
        },
      })
    host = buildHost()
    window = new Window()
  })
  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  // Finish the fake turn without a permission card; these cases test loading and lead retention.
  const start = async (provider: Provider, profileId = 'lark') =>
    (await host.createSession({ provider, profileId, cwd, approvalMode: 'auto' }, window)).sessionId
  const save = (profile: string, text: string, expectedVersion = 0, currentText = '') => {
    const result = host.saveOwnNotes(
      profile,
      { text, expectedVersion, currentText, why: 'Keep this standing wish.' },
      window,
    )
    expect(result).not.toBeNull()
    return result
  }
  const launches = (id: string) =>
    store.events(id).flatMap(({ event }) => (event.type === 'launched' ? [event] : []))
  const turns = (id: string) =>
    store.events(id).flatMap(({ event }) => (event.type === 'user_turn' ? [event] : []))

  it.each(['claude', 'codex'] as const)(
    'the production Skills launch callback obeys the stored grant at %s start and resume',
    async (provider) => {
      // Execute the exact main callback, without importing Electron's app entry point.
      const source = readFileSync(resolve(import.meta.dirname, '../src/main/index.ts'), 'utf8')
      const callback = /prepareBuiltInSkills:\s*([\s\S]*?),\n\s*\/\/ A text pack,/.exec(source)?.[1]
      expect(callback, 'the production preparation callback must remain explicit').toBeDefined()
      const production = new Function(
        'prepareBuiltInSkills',
        'providerHomesRoot',
        'userData',
        'shippedSkills',
        `return (${callback})`,
      )(
        prepareBuiltInSkills,
        () => join(root, 'homes'),
        root,
        () => readBuiltInSkills(resolve(import.meta.dirname, '../resources/built-in-skills')),
      ) as NonNullable<RuntimeHostDeps['prepareBuiltInSkills']>
      const seed = await start(provider)
      await host.close(seed, window)
      const names: string[][] = []
      skillPreparation = async (input) => {
        const prepared = await production(input)
        names.push(prepared.context.skills.map((one) => one.name.replace(/^brobot:/, '')))
        return prepared
      }
      await host.closeAll()
      host = buildHost()
      expect(store.setCapabilities('lark', { canCreateAgents: 'none' })).toBe(true)
      const me = await start(provider)
      expect(names).toHaveLength(1)
      expect(names.at(-1)).not.toContain('build-a-team')
      expect(names.at(-1)).not.toContain('add-a-capability')
      await host.close(me, window)
      expect(store.setCapabilities('lark', { canCreateAgents: 'any' })).toBe(true)
      await host.resumeSession(me, window)
      expect(names.at(-1)).toContain('build-a-team')
      expect(names.at(-1)).toContain('add-a-capability')
    },
  )

  it('reads a legacy launch without a notes version and keeps an explicit version zero', async () => {
    const me = await start('claude')
    await host.close(me, window)
    const given = launches(me).at(-1)?.given
    expect(given).toBeDefined()
    if (given === undefined) throw new Error('Missing fixture launch')
    expect(given.ownNotesVersion).toBe(0)
    expect((await host.whatThisAgentWasGiven(me)).ownNotesVersion).toBe(0)
    const legacy = { ...given }
    delete legacy.ownNotesVersion
    store.append(me, store.nextOrdinal(me), { type: 'launched', given: legacy }, counter++)
    expect(await host.whatThisAgentWasGiven(me)).not.toHaveProperty('ownNotesVersion')
  })

  it.each(['claude', 'codex'] as const)(
    'reads current notes once at start and reloads edits and clears at resume on %s',
    async (provider) => {
      const seed = await start(provider)
      await host.close(seed, window)
      expect(
        host.instructAgent('lark', 'Standing wishes stay first.', undefined, window),
      ).not.toBeNull()
      save('lark', 'First page.')
      const me = await start(provider)
      const first = reads.at(-1)!
      expect(first.context).toMatchObject({ ownNotes: { version: 1, text: 'First page.' } })
      expect(launches(me).at(-1)?.given).toMatchObject({ ownNotesVersion: 1 })
      const initiallySent =
        provider === 'claude' ? options.at(-1)?.systemHint : first.read.firstTurnLead
      expect(initiallySent).toContain('> First page.')
      expect(provider === 'claude' ? first.lead.text : first.bundle.text).not.toContain(
        '## Your own notes',
      )
      if (provider === 'claude')
        expect(initiallySent!.indexOf('Standing wishes stay first.')).toBeLessThan(
          initiallySent!.indexOf('## Your own notes'),
        )
      else expect(options.at(-1)?.systemHint).toBeUndefined()
      save('lark', 'Second page.', 1, 'First page.')
      expect(first.context).toMatchObject({ ownNotes: { version: 1, text: 'First page.' } })
      await host.send(me, 'Read your standing context.', window)
      await vi.waitFor(() => expect(turns(me)).toHaveLength(1))
      await vi.waitFor(() =>
        expect(store.events(me).some(({ event }) => event.type === 'turn')).toBe(true),
      )
      if (provider === 'codex') {
        expect(turns(me)[0]?.sent).toContain('> First page.')
        expect(turns(me)[0]?.sent).not.toContain('> Second page.')
      }
      await host.close(me, window)
      await host.resumeSession(me, window)
      const resumed = reads.at(-1)!
      expect(resumed.context).toMatchObject({ ownNotes: { version: 2, text: 'Second page.' } })
      expect(launches(me).at(-1)?.given).toMatchObject({ ownNotesVersion: 2 })
      expect(
        provider === 'claude' ? options.at(-1)?.systemHint : resumed.read.firstTurnLead,
      ).toContain('> Second page.')
      await host.send(me, 'Continue with the current notes.', window)
      await vi.waitFor(() => expect(turns(me)).toHaveLength(2))
      if (provider === 'codex') {
        expect(turns(me)[1]?.lead?.is).toBe('what-changed')
        expect(turns(me)[1]?.sent).toContain('> Second page.')
        expect(turns(me)[1]?.sent).not.toContain('## The brobot tools')
      }
      await vi.waitFor(() =>
        expect(store.events(me).filter(({ event }) => event.type === 'turn')).toHaveLength(2),
      )
      save('lark', '', 2, 'Second page.')
      await host.close(me, window)
      await host.resumeSession(me, window)
      const clear = reads.at(-1)!
      expect(clear.context).toMatchObject({ ownNotes: { version: 3, text: '' } })
      expect(launches(me).at(-1)?.given).toMatchObject({ ownNotesVersion: 3 })
      if (provider === 'claude') expect(clear.read.systemHint).not.toContain('## Your own notes')
      else expect(clear.read.firstTurnLead).toContain('Your own notes are empty.')
      await host.send(me, 'Continue after clearing the page.', window)
      await vi.waitFor(() => expect(turns(me)).toHaveLength(3))
      if (provider === 'codex') {
        expect(turns(me)[2]?.lead?.is).toBe('what-changed')
        expect(turns(me)[2]?.sent).toContain('Your own notes are empty.')
        expect(turns(me)[2]?.sent).not.toContain('> Second page.')
        expect(turns(me)[2]?.sent).not.toContain('## The brobot tools')
      }
    },
  )

  it.each(['claude', 'codex'] as const)(
    'records the version actually read when another conversation writes during %s start',
    async (provider) => {
      const seed = await start(provider)
      await host.close(seed, window)
      save('lark', 'Read before the race.')
      atLaunch = () => {
        atLaunch = undefined
        save('lark', 'Written during launch.', 1, 'Read before the race.')
      }
      const me = await start(provider)
      expect(store.currentOwnNotesOf('lark')?.current?.version).toBe(2)
      expect(reads.at(-1)?.context).toMatchObject({
        ownNotes: { version: 1, text: 'Read before the race.' },
      })
      expect(launches(me).at(-1)?.given).toMatchObject({ ownNotesVersion: 1 })
      expect(
        provider === 'claude' ? options.at(-1)?.systemHint : reads.at(-1)?.read.firstTurnLead,
      ).toContain('> Read before the race.')
    },
  )

  it.each(['claude', 'codex'] as const)(
    'does not compose another profile page into %s instructions',
    async (provider) => {
      const other = await start(provider, 'wren')
      await host.close(other, window)
      save('wren', 'Other role only.')
      const me = await start(provider, 'lark')
      const read = reads.at(-1)!
      expect(read.context).toMatchObject({ ownNotes: { version: 0, text: '' } })
      expect(JSON.stringify(read)).not.toContain('Other role only.')
      expect(launches(me).at(-1)?.given).toMatchObject({ ownNotesVersion: 0 })
    },
  )
})
