import { neutralHostDeps } from './lib/host-fixture'
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
import ts from 'typescript'

function skillsArrow(source: string): string {
  const checked = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  })
  expect(checked.diagnostics ?? []).toEqual([])
  const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
  const hosts: ts.NewExpression[] = []
  function visit(node: ts.Node): void {
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'RuntimeHost'
    )
      hosts.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  expect(hosts).toHaveLength(1)
  const deps = hosts[0]!.arguments?.[0]
  if (deps === undefined || !ts.isObjectLiteralExpression(deps))
    throw new Error('missing RuntimeHost dependencies')
  const properties = deps.properties.filter(
    (node): node is ts.PropertyAssignment =>
      ts.isPropertyAssignment(node) && node.name.getText(file) === 'prepareBuiltInSkills',
  )
  expect(properties).toHaveLength(1)
  const arrow = properties[0]!.initializer
  if (!ts.isArrowFunction(arrow)) throw new Error('missing production Skills arrow')
  expect(ts.isCallExpression(arrow.body)).toBe(true)
  if (!ts.isCallExpression(arrow.body)) throw new Error('missing Skills preparation call')
  expect(arrow.body.expression.getText(file)).toBe('prepareBuiltInSkills')
  return arrow.getText(file)
}

it('the Skills extractor binds the real RuntimeHost arrow and rejects substitute callbacks', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../src/main/index.ts'), 'utf8')
  const selected = skillsArrow(source)
  expect(skillsArrow(`${source}\nconst decoy = { prepareBuiltInSkills: () => wrong() }`)).toBe(
    selected,
  )
  const removed = source.replace('    prepareBuiltInSkills:', '    missingSkills:')
  expect(removed).not.toBe(source)
  expect(() => skillsArrow(removed)).toThrow()
  expect(() => skillsArrow(`${source}\nnew RuntimeHost({})`)).toThrow()
  expect(() => skillsArrow(source.replace(selected, 'undefined'))).toThrow()
  expect(() => skillsArrow(source.replace(selected, '() => wrong()'))).toThrow()
})

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
        ...neutralHostDeps(() => root),
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
  const start = async (provider: Provider, profileId = 'lark') =>
    (await host.createSession({ provider, profileId, cwd, approvalMode: 'auto' }, window)).sessionId
  const save = (profile: string, text: string, expectedVersion = 0) => {
    const result = host.saveOwnNotes(
      profile,
      { text, expectedVersion, why: 'Keep this standing wish.' },
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
      const source = readFileSync(resolve(import.meta.dirname, '../src/main/index.ts'), 'utf8')
      const callback = skillsArrow(source)
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
      save('lark', 'Second page.', 1)
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
      save('lark', '', 2)
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
        save('lark', 'Written during launch.', 1)
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
