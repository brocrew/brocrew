import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { FakeRuntime } from '../src/fake-runtime'
import type {
  ProviderModule,
  ProviderConnectionOperations,
  ProviderHostValues,
  ProviderDisplayEvent,
  ListedSkills,
  ResolveImageClaim,
} from '@brobot2/runtime/provider-module'
import type { RuntimeEvent } from '../src/events'

interface FernValues extends ProviderHostValues {
  readonly event: { type: 'fern-note'; text: string }
  readonly retentionCandidate: { file: string }
  readonly session: { id: string }
  readonly file: { path: string }
  readonly memoryNote: { note: string }
  readonly childPart: 'notes'
  readonly childResult: { text: string }
  readonly turnAsked: { prompt: string }
  readonly turnAnswer: { sent: string }
  readonly discovery: { homes: string[] }
  readonly protectedPlaceKind: 'fern-state'
  readonly instructionInputs: { cwd: string }
  readonly launchRead: { text: string }
  readonly instruction: { kind: 'fern-memory'; text: string }
  readonly origin: 'fern'
  readonly memoryStore: { entries: string[] }
  readonly memoryPage: { entries: string[]; next: number | null }
  readonly givenSkills: { commands: string[] }
  readonly deferral: { deferred: boolean }
  readonly partSize: { bytes: number }
  readonly snapshot: { format: 'fern' }
}

/** A fictional package supplies its own host protocol in a currently registered provider slot. */
function fernModule(): ProviderModule<FernValues> {
  return {
    createRuntime: () => new FakeRuntime('claude'),
    async prepareLaunch(profileId) {
      return { home: `/fictional/${profileId}`, runtime: this.createRuntime() }
    },
    home: { prepare: async (profile) => `/fictional/${profile}` },
    auth: {
      credentialHome: (profile) => `/fictional/${profile}`,
      check: async () => ({ state: 'usable', login: 'account', expiresAt: null }),
      reprovision: () => 'unchanged',
      signIn: async () => ({
        authUrl: '',
        completed: Promise.resolve({
          success: true,
          state: { state: 'usable', login: 'account', expiresAt: null },
        }),
        cancel: async () => {},
      }),
      bringTheKeyToItsHomes: async () => null,
      replaceARefusedCopy: async () => 'not-tried',
    },
    authPolicy: {
      launchRefusal: () => null,
      refusalWords: { 'sign-in': null, settings: null, 'no-sign-in-to-copy': null },
      setup: () => null,
      renewedNotice: null,
      key: {
        check: async () => ({ ok: false, reason: 'Fictional harness has no key' }),
        loginRunsWithoutAKey: () => true,
      },
      identity: { waitsForAccount: false, launch: () => null, limit: () => null },
      copy: { carriesAcceptedAfterAccountChange: false, same: () => false, refused: () => null },
      protocol: { refusedGive: () => false, reopenedGive: () => false },
    },
    transcripts: {
      eventForDisplay: (event) => event,
      keepEarlierReportedEffort: () => true,
      whatDeletionLeaves: () => [],
      async *scanRetention(input) {
        const candidate = await input.add('/fictional/record', 'fern-session', null)
        yield { path: '/fictional/record', candidate }
      },
      filesOf: (_home, sessions) => sessions.map(({ id }) => ({ path: `/fictional/${id}` })),
      memoryNotesOf: () => [],
      readChild: (request) => ({ text: request.part }),
      readTurn: (asked) => ({ line: () => 'done', answer: () => ({ sent: asked.prompt }) }),
      imageResolver: (thread, home, resolveAsset) => (claim: ResolveImageClaim) =>
        resolveAsset(claim.savedPath ?? `${home()}/${thread}/${claim.imageId}`),
      parse: (frames, at) => ({
        entries: frames.map((text) => ({ at, event: { type: 'fern-note', text } })),
        unreadable: 0,
        lastAt: at,
        edits: undefined,
      }),
      nativePath: () => null,
      ownsRecord: () => false,
      exportPath: (home) => `${home}/fern`,
      exportSupport: () => ({ format: 'fern', resumable: false, note: 'Fictional record' }),
    },
    discovery: {
      discover: (home) => ({ homes: [home] }),
      userHome: (_env, fallback) => fallback(),
      configHomes: (home) => [home],
      protectedPlaceKind: 'fern-state',
    },
    instructions: {
      bundleLeaf: 'fern.md',
      read: ({ cwd }) => ({ text: cwd }),
      given: {
        nativeFiles: () => [],
        repositoryOrigin: 'fern',
        deferral: () => ({ deferred: false }),
        externalDeferral: () => ({ deferred: false }),
        otherServers: () => ({ size: null, why: null }),
        namespaceText: () => null,
        planningKey: 'approval',
      },
    },
    memory: {
      entryOrigin: () => 'fern',
      readStore: () => ({ entries: [] }),
      layout: {
        fixedFiles: () => [],
        notesFolder: (home) => home,
        listNotes: () => ({ names: [] }),
        acceptsNote: () => false,
      },
      counts: () => ({ total: 0, listed: 0 }),
      readPage: () => ({ entries: [], next: null }),
      select: () => undefined,
      noteDirectory: () => null,
    },
    skills: {
      asGiven: (listed: ListedSkills | null) => ({
        commands: listed?.commands.map((command) => command.name) ?? [],
      }),
      needsReminders: () => false,
      builtInScope: null,
      discoveryRoot: 'fern',
      initialFiles: () => new Map(),
      fileFor: (name) => name,
      launchedEntry: (root, skill) => ({ ...skill, path: `${root}/${skill.name}` }),
      legacyReminder: { field: 'fern', schema: z.string(), canonical: (_name, text) => text },
    },
    snapshot: { fileFor: () => ({ format: 'fern' }) },
    keptRules: { projectFolders: () => [], files: () => [], remove: () => {} },
  }
}

describe('the portable module consumer', () => {
  it('binds connection operations with an external handle without interpreting its native protocol', async () => {
    interface FernConnection {
      readonly id: string
      readonly workspace: string
    }
    const first: FernConnection = { id: 'fern-grove', workspace: '/fictional/grove' }
    const second: FernConnection = { id: 'fern-meadow', workspace: '/fictional/meadow' }
    const rows = [second, first] as const
    const unavailable = new Error('Fictional connection is unavailable')
    const calls: unknown[] = []
    const connections: ProviderConnectionOperations<FernConnection> & {
      readonly rows: typeof rows
    } = {
      rows,
      list() {
        calls.push('list')
        return this.rows
      },
      resolve(id) {
        calls.push(id)
        const selected = id == null ? this.rows[0] : this.rows.find((row) => row.id === id)
        if (selected === undefined) throw unavailable
        return selected
      },
    }
    const module: ProviderModule<FernValues, FernConnection> = {
      ...fernModule(),
      connections,
      async prepareLaunch(profile, connection) {
        calls.push(['prepare', profile, connection])
        return {
          home: connection?.workspace ?? '/fictional/default',
          runtime: this.createRuntime(),
        }
      },
    }
    expect(calls).toEqual([])
    expect(module.connections).toBe(connections)
    expect(module.connections?.list()).toBe(rows)
    expect(module.connections?.resolve()).toBe(second)
    expect(module.connections?.resolve(null)).toBe(second)
    expect(module.connections?.resolve(first.id)).toBe(first)
    expect(() => module.connections?.resolve('missing')).toThrow(unavailable)
    expect(calls).toEqual(['list', undefined, null, first.id, 'missing'])
    const launch = await module.prepareLaunch('willow', first)
    expect(launch.home).toBe(first.workspace)
    expect(calls.at(-1)).toEqual(['prepare', 'willow', first])
    expectTypeOf(module.prepareLaunch).parameter(1).toEqualTypeOf<FernConnection | undefined>()
  })

  it('implements real operations with its own host protocol and no program service', async () => {
    const module = fernModule()
    expect(module.program).toBeUndefined()
    expect(module.connections).toBeUndefined()
    expect(module.instructions.read({ cwd: '/fictional/work' })).toEqual({
      text: '/fictional/work',
    })
    expect(module.transcripts.readTurn({ prompt: 'Fern task' }, {}).answer()).toEqual({
      sent: 'Fern task',
    })
    const resolveImage = module.transcripts.imageResolver?.(
      'fern-thread',
      () => '/fictional',
      (path) => path,
    )
    expect(resolveImage?.({ imageId: 'fern-image', savedPath: '/fictional/image' })).toBe(
      '/fictional/image',
    )
    expect(resolveImage?.({ imageId: 'fern-image' })).toBe('/fictional/fern-thread/fern-image')
    expect(
      module.skills.asGiven({ commands: [{ name: 'fern-skill' }], at: 12, dropped: 0 }, false),
    ).toEqual({ commands: ['fern-skill'] })
    expect(module.transcripts.parse(['Fern record'], 12).entries).toEqual([
      { at: 12, event: { type: 'fern-note', text: 'Fern record' } },
    ])
    const launch = await module.prepareLaunch('willow')
    const session = await launch.runtime.start({
      providerHome: launch.home,
      cwd: '/fictional/work',
    })
    try {
      expect(session.ref?.provider).toBe('claude')
      expect(session.awaitProcessExit?.()).toBeUndefined()
    } finally {
      await session.close()
    }
  })

  it('keeps canonical runtime events and exact host inputs and outputs', () => {
    const module = fernModule()
    const event: RuntimeEvent = { type: 'error', message: 'Fictional diagnostic', fatal: false }
    expect(module.transcripts.eventForDisplay?.(event)).toBe(event)
    expectTypeOf(module.instructions.read).parameter(0).toEqualTypeOf<{ cwd: string }>()
    expectTypeOf(module.transcripts.readTurn({ prompt: 'Fern' }, {}).answer()).toEqualTypeOf<{
      sent: string
    }>()
    const portableEvent: ProviderDisplayEvent<FernValues> = event
    expect(module.transcripts.eventForDisplay?.(portableEvent)).toBe(event)
  })
})
