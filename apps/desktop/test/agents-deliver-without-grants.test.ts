import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, FakeProviderSessions } from '@brobot2/runtime'
import type { AgentToolset, FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { readProfileExecution, writeProfileExecution } from '../src/main/profile-execution-file'
import { agentToolsFor, agentCallerId } from '../src/main/runtime/agent-tools'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  RecordingSink,
  syntheticProviderHome,
  neutralHostDeps,
  fixtureProviderConfig,
} from './lib/host-fixture'
import { waitFor } from './lib/f093-host'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

describe.each(['claude', 'codex'] as const)('%s agents deliver without grants', (provider) => {
  let folder: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let account: string
  let issued: FakeProviderSessions
  let counter: number
  let observedAccounts: string[]
  const window = new RecordingSink('webContents:1')

  function buildHost(): RuntimeHost {
    class AccountRuntime extends FakeRuntime {
      private onAccount(handle: FakeSessionHandle): FakeSessionHandle {
        const email = account
        Object.defineProperty(handle, 'account', { value: () => { observedAccounts.push(email); return { email } } })
        Object.defineProperty(handle, 'signInTag', { value: () => { observedAccounts.push(email); return email } })
        return handle
      }
      override async start(...args: Parameters<FakeRuntime['start']>) {
        return this.onAccount(await super.start(...args))
      }
      override async resume(...args: Parameters<FakeRuntime['resume']>) {
        return this.onAccount(await super.resume(...args))
      }
    }
    return new RuntimeHost({
      store,
      ...neutralHostDeps(() => folder),
      createRuntime: (which: Provider) => new AccountRuntime(which, { sessions: issued }),
      prepareProviderHome: syntheticProviderHome(() => folder),
      providerHomePath: (which) => join(folder, 'provider-homes', which),
      resolveCwd: (id, requested) => resolveSessionCwd(folder, id, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: fixtureProviderConfig,
      profileExecution: {
        read: () => readProfileExecution(db),
        write: (kept) => writeProfileExecution(db, kept),
        owned: true,
      },
    })
  }

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brocrew-free-delivery-'))
    db = openDatabase(join(folder, 'test.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    account = 'first@example.test'
    issued = new FakeProviderSessions()
    counter = 0
    observedAccounts = []
    const service = store.createAgentIdentity(
      { slug: 'service', displayName: null, provider },
      { by: 'a-person' },
    )
    if (service === null) throw new Error('service identity missing')
    writeProfileExecution(db, {
      profiles: { [service.id]: { kind: 'service', identityCreatedAt: service.createdAt } },
    })
    host = buildHost()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  async function opens(profileId: string): Promise<string> {
    return (
      await host.createSession({ provider, profileId, cwd: folder, approvalMode: 'auto' }, window)
    ).sessionId
  }

  async function call(from: string, name: string, args: Record<string, unknown>) {
    const tools: AgentToolset = agentToolsFor(host, from)
    const tool = tools.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`missing tool ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  it.each([null, 'none', 'any'])(
    'ignores legacy grants %s across reopen, restart and account reassociation',
    async (legacy) => {
      const other = await opens('reader')
      await opens('helper')
      const serviceGive = await call(other, 'give_work', {
        profile: 'service',
        title: 'Independent service work',
        brief: 'Work for the other caller',
        definition_of_done: 'Record a result.',
      })
      expect(serviceGive).toMatchObject({ outcome: 'ok' })
      const service = serviceGive.agent as string
      await waitFor(
        () => store.events(service).some((entry) => entry.event.type === 'user_turn'),
        'service first turn',
      )
      const lead = await opens('lead')
      db.prepare(
        'UPDATE agent_identity SET can_message = ?, can_assign_work = ? WHERE slug = ?',
      ).run(legacy, legacy, 'lead')
      expect(store.capabilitiesOf('lead')).not.toHaveProperty('canMessage')
      expect(store.capabilitiesOf('lead')).not.toHaveProperty('canAssignWork')
      let helper: unknown

      async function delivers(stage: string) {
        const by = { ownerId: agentCallerId(lead) }
        expect(host.agentCard(other, by, lead)?.agent).toBe(other)
        expect(host.agentsVisibleTo(by, lead).agents.some((one) => one.agent === other)).toBe(true)
        expect(host.agentCard(service, by, lead)?.agent).toBe(service)
        expect(host.agentsVisibleTo(by, lead).agents.some((one) => one.agent === service)).toBe(
          true,
        )
        const serviceNote = `service note after ${stage}`
        expect(
          await call(lead, 'message_agent', { agent: service, kind: 'note', text: serviceNote }),
        ).toMatchObject({ outcome: 'ok' })
        await waitFor(
          () =>
            store
              .events(service)
              .some(
                (entry) =>
                  entry.event.type === 'user_turn' && entry.event.text.includes(serviceNote),
              ),
          serviceNote,
        )
        const queued = await call(lead, 'give_work', {
          profile: 'service',
          title: `Service ${stage}`,
          brief: `Service work after ${stage}`,
          definition_of_done: 'Record the result.',
        })
        expect(queued).toMatchObject({ outcome: 'ok', agent: service })
        expect(store.piecesOwnedBy(service).find((piece) => piece.title === `Service ${stage}`)?.state).toBe('waiting')
        const note = `note after ${stage}`
        expect(
          await call(lead, 'message_agent', { agent: other, kind: 'note', text: note }),
        ).toMatchObject({ outcome: 'ok' })
        await waitFor(
          () =>
            store
              .events(other)
              .some((entry) => entry.event.type === 'user_turn' && entry.event.text.includes(note)),
          note,
        )
        const given = await call(lead, 'give_work', {
          profile: 'helper',
          title: stage,
          brief: `work after ${stage}`,
          definition_of_done: 'The result is recorded.',
        })
        expect(given).toMatchObject({ outcome: 'ok' })
        if (helper !== undefined) expect(given.agent).toBe(helper)
        helper = given.agent
        await waitFor(
          () =>
            store
              .events(given.agent as string)
              .some(
                (entry) =>
                  entry.event.type === 'user_turn' &&
                  entry.event.text.includes(`work after ${stage}`),
              ),
          stage,
        )
      }

      await delivers('first launch')
      expect(observedAccounts).toContain('first@example.test')
      await host.close(lead, window)
      await host.resumeSession(lead, window)
      await delivers('reopen')
      await host.closeAll()
      db.close()
      db = openDatabase(join(folder, 'test.sqlite'))
      store = createSessionStore(db)
      host = buildHost()
      await host.resumeSession(lead, window)
      await delivers('restart')
      await host.closeAll()
      account = 'second@example.test'
      host = buildHost()
      await host.resumeSession(lead, window)
      await delivers('account reassociation')
      expect(observedAccounts).toContain('second@example.test')
      expect(
        db
          .prepare('SELECT can_message, can_assign_work FROM agent_identity WHERE slug = ?')
          .get('lead'),
      ).toEqual({ can_message: legacy, can_assign_work: legacy })
    },
  )
})
