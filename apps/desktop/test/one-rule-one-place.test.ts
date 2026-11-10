import {
  fixtureProviderConfig,
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
} from './lib/host-fixture'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  MOST_BYTES_OF_ANY_FORM,
  RESOURCE_RAILS,
  refuseResource,
  resourcesRoot,
} from '../src/main/resources/resources'
import type { ResourceReading } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

describe('one placement rule for kept resources, at both doors', () => {
  let userData: string
  let work: string
  let outside: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++
  const kept = (): string => resourcesRoot(userData)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-517-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-517-work-'))
    outside = mkdtempSync(join(tmpdir(), 'brobot2-517-outside-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost(deps())
    window = new RecordingSink('webContents:1')
  })

  const deps = (): ConstructorParameters<typeof RuntimeHost>[0] =>
    ({
      store,
      ...neutralHostDeps(() => userData),
      resourcesRoot: () => resourcesRoot(userData),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
      prepareProviderHome: syntheticProviderHome(() => userData),
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: fixtureProviderConfig,
    }) satisfies ConstructorParameters<typeof RuntimeHost>[0]

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work, outside]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (cwd = work): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'default', cwd, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  const aResource = async (
    text = 'the whole answer\n',
    name = 'r.md',
  ): Promise<{ resource: string; session: string }> => {
    const giver = await personOpens()
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'default',
        title: 'Write the answer',
        brief: 'write the answer',
      },
      { ownerId: agentCallerId(giver) },
    )
    if (!given.ok) throw new Error(`expected a give, got ${given.refusal.rail}`)
    const folder = store.recordedOne(given.owner)?.cwd
    if (folder === undefined) throw new Error('the conversation the give reached has no folder')
    writeFileSync(join(folder, name), text)
    const replied = await host.replyToParent(
      {
        piece: given.label,
        outcome: 'done',
        summary: 'done it',
        resourcePaths: [name],
        needsUserAction: false,
      },
      { ownerId: agentCallerId(given.owner) },
    )
    if (!replied.ok) throw new Error(`expected a reply, got ${replied.refusal.rail}`)
    const [resource] = replied.resources
    if (resource === undefined) throw new Error('the reply kept no resource')
    return { resource, session: given.owner }
  }

  const agentReads = (resource: string): string => {
    const seen = host.readResource(resource)
    return seen.ok ? 'ok' : seen.refusal.rail
  }

  /** The PERSON's door, as a word: its reason, or `ok`. */
  const personReads = (resource: string): string => {
    const seen: ResourceReading = host.readResourceForAPerson(resource)
    return seen.ok ? 'ok' : seen.reason
  }

  /** Where a kept resource's bytes actually are — `<root>/<sha256>/<name>`, off its own row. */
  const keptFile = (resource: string): string => {
    const row = store.resource(resource)
    if (row === null) throw new Error(`no row for ${resource}`)
    return join(kept(), row.sha256, row.name)
  }

  /** Point a kept resource's row at `target`, exactly as a bad writer would. */
  const pointRowAt = (resource: string, target: string): string => {
    const row = store.resource(resource)
    if (row === null) throw new Error(`no row for ${resource}`)
    const spelling = relative(join(kept(), row.sha256), target)
    db.prepare('UPDATE work_resource SET name = ? WHERE id = ?').run(spelling, resource)
    return spelling
  }

  describe('a row that spells its way out of the tree', () => {
    it('BOTH doors refuse it, and a legitimate resource goes through both in the same sample', async () => {
      const escaping = await aResource('the real one\n')
      const fine = await aResource('the untouched one\n', 'second.md')
      const stranger = join(outside, 'secrets.md')
      writeFileSync(stranger, 'not a resource at all\n')
      const spelled = pointRowAt(escaping.resource, stranger)

      expect(spelled).toContain('..')
      expect(readFileSync(stranger, 'utf8')).toBe('not a resource at all\n')

      expect(agentReads(escaping.resource)).toBe('resource-bytes-unreadable')
      expect(personReads(escaping.resource)).toBe('unreadable')

      expect(agentReads(fine.resource)).toBe('ok')
      expect(personReads(fine.resource)).toBe('ok')

      expect(JSON.stringify(host.readResource(escaping.resource))).not.toContain(
        'not a resource at all',
      )
      expect(JSON.stringify(host.readResourceForAPerson(escaping.resource))).not.toContain(
        'not a resource at all',
      )
    })

    it('…and a SYMLINK at the kept name is refused by the same rail, at both doors', async () => {
      const linked = await aResource('the real one\n')
      const fine = await aResource('the untouched one\n', 'second.md')
      const stranger = join(outside, 'secrets.md')
      writeFileSync(stranger, 'not a resource at all\n')
      const at = keptFile(linked.resource)
      rmSync(at)
      symlinkSync(stranger, at)

      expect(store.resource(linked.resource)?.name).not.toContain('..')

      expect(agentReads(linked.resource)).toBe('resource-bytes-unreadable')
      expect(personReads(linked.resource)).toBe('unreadable')
      expect(agentReads(fine.resource)).toBe('ok')
      expect(personReads(fine.resource)).toBe('ok')
    })

    it('the refusal a MODEL receives carries the rail, the permanence and no path', async () => {
      const escaping = await aResource('the real one\n')
      const stranger = join(outside, 'secrets.md')
      writeFileSync(stranger, 'not a resource at all\n')
      const spelled = pointRowAt(escaping.resource, stranger)

      const set = agentToolsFor(host, escaping.session)
      const tool = set.tools.find((one) => one.name === 'read_document')
      if (tool === undefined) throw new Error('no read_document tool')
      const answered = (await tool.call({ resource: escaping.resource })).structured as Record<
        string,
        unknown
      >

      expect(answered.outcome).toBe('refused')
      expect(answered.rail).toBe('resource-bytes-unreadable')
      expect(answered.permanence).toBe('until-a-person-changes-it')
      expect(answered.retryable).toBe(false)
      expect(answered.remedy).toBe(null)
      expect(answered.detail).toEqual({ resource: escaping.resource })

      const whole = JSON.stringify(answered)
      expect(whole).not.toContain(spelled)
      expect(whole).not.toContain(outside)
      expect(whole).not.toContain(userData)
    })
  })

  describe('a tampered row and an absent id get different words', () => {
    it('a conversation that kept nothing gets the containment word, and an absent id does not', async () => {
      const escaping = await aResource('the real one\n')
      const stranger = await personOpens()
      expect(stranger).not.toBe(escaping.session)
      const target = join(outside, 'secrets.md')
      writeFileSync(target, 'not a resource at all\n')
      pointRowAt(escaping.resource, target)

      const foreign = host.readResource(escaping.resource)
      const absent = host.readResource('res_nothing-kept-this')
      if (foreign.ok || absent.ok) throw new Error('expected two refusals')
      expect(foreign.refusal.rail).toBe('resource-bytes-unreadable')
      expect(absent.refusal.rail).toBe('no-such-resource')
      expect(foreign.refusal.reason).not.toBe(absent.refusal.reason)

      expect(agentReads(escaping.resource)).toBe('resource-bytes-unreadable')
      expect(JSON.stringify(foreign.refusal)).not.toContain(outside)
    })

    it('a host this app gave no resources tree is its OWN word, and not `no-such-resource`', async () => {
      const real = await aResource('bytes that exist\n')
      const rootless = new RuntimeHost({ ...deps(), resourcesRoot: undefined })
      const answered = rootless.readResource(real.resource)
      if (answered.ok) throw new Error('expected a refusal with no resources root')
      expect(answered.refusal.rail).toBe('resource-store-unavailable')
      expect(agentReads(real.resource)).toBe('ok')
      await rootless.closeAll()
    })
  })

  describe('absent, and present-but-unreadable, are two answers', () => {
    it('a file that is GONE is `resource-bytes-missing`, and its sentence is true of it', async () => {
      const gone = await aResource('vanishing\n')
      const fine = await aResource('the untouched one\n', 'second.md')
      rmSync(keptFile(gone.resource))

      expect(agentReads(gone.resource)).toBe('resource-bytes-missing')
      expect(agentReads(fine.resource)).toBe('ok')
      expect(personReads(gone.resource)).toBe('unreadable')
      expect(personReads(fine.resource)).toBe('ok')
    })

    it('a file that is TOO LARGE is not told it is gone', async () => {
      const fat = await aResource('small enough\n')
      const fine = await aResource('the untouched one\n', 'second.md')
      writeFileSync(keptFile(fat.resource), Buffer.alloc(MOST_BYTES_OF_ANY_FORM + 1, 'x'))

      expect(agentReads(fat.resource)).toBe('resource-bytes-unreadable')
      const seen = host.readResource(fat.resource)
      if (seen.ok) throw new Error('expected a refusal')
      expect(seen.refusal.reason).toContain('what stands where this app keeps it')
      expect(seen.refusal.reason).not.toContain('no longer where this app keeps it')
      expect(seen.refusal.permanence).toBe('until-a-person-changes-it')
      expect(seen.refusal.retryable).toBe(false)
      expect(agentReads(fine.resource)).toBe('ok')
      expect(personReads(fat.resource)).toBe('unreadable')
    })

    it('a DIRECTORY and an inside-pointing symlink take the same word, and that is the grouping', async () => {
      const shaped = await aResource('replaced by a directory\n')
      const linked = await aResource('replaced by a link\n', 'second.md')
      const fine = await aResource('the untouched one\n', 'third.md')

      const at = keptFile(shaped.resource)
      rmSync(at)
      mkdirSync(at)
      expect(agentReads(shaped.resource)).toBe('resource-bytes-unreadable')

      const inside = keptFile(linked.resource)
      const neighbour = join(kept(), 'neighbour.md')
      writeFileSync(neighbour, 'a file inside the tree\n')
      rmSync(inside)
      symlinkSync(neighbour, inside)
      expect(agentReads(linked.resource)).toBe('resource-bytes-unreadable')

      expect(agentReads(fine.resource)).toBe('ok')
      expect(personReads(fine.resource)).toBe('ok')
    })
  })

  describe('the refusal words', () => {
    it('both are members, both are silent, and neither promises a retry', () => {
      for (const rail of ['resource-bytes-missing', 'resource-bytes-unreadable'] as const) {
        expect(RESOURCE_RAILS, rail).toContain(rail)
        const built = refuseResource(rail, { resource: 'res_1' })
        expect(built.remedy, rail).toBe(null)
        expect(built.retryable, rail).toBe(false)
        expect(built.permanence, rail).not.toBe('while-this-holds')
      }
      expect(refuseResource('resource-bytes-missing').permanence).toBe('permanent')
      expect(refuseResource('resource-bytes-unreadable').permanence).toBe(
        'until-a-person-changes-it',
      )
      expect(refuseResource('resource-empty').retryable).toBe(true)
    })
  })
})
