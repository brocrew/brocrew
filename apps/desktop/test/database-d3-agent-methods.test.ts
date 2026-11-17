import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentMethods, MethodChangeIntent } from '../src/main/database'
import { createSqliteAgentMethods } from '../src/main/database/sqlite/agents/methods'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
const person = { who: 'a-person' } as const
const intent: MethodChangeIntent = {
  operation: 'delete',
  sourceId: null,
  target: 'review.md',
  files: [{ name: 'review.md', before: { base64: 'YQ0K', mode: 0o600 }, afterBase64: null }],
}

describe('saved-method changes through the async database interface', () => {
  let database: AppDatabase
  let store: SessionStore
  let methods: AgentMethods

  beforeEach(() => {
    database = openDatabase(':memory:')
    applyMigrations(database, migrations)
    let clock = 100
    store = createSessionStore(database, () => clock)
    store.create({
      id: 'methods-session',
      profileId: 'methods-agent',
      provider: 'codex',
      cwd: '/fictional/methods',
      approvalMode: 'ask',
    })
    clock = 200
    methods = createSqliteAgentMethods(store)
  })

  afterEach(() => {
    if (database.open) database.close()
  })

  it('acknowledges one pending intent on the shared writer and refuses another until settlement', async () => {
    const other = createSqliteAgentMethods(store)
    const [first, duplicate] = await Promise.all([
      methods.beginMethodChange('METHODS-AGENT', intent, person, 100),
      other.beginMethodChange('methods-agent', intent, person, 101),
    ])
    expect(first).toMatchObject({ sequence: 1, outcome: 'pending', files: intent.files })
    expect(duplicate).toBeNull()
    if (first === null) throw new Error('missing method intent')
    expect(store.methodChange('methods-agent', first.id)).toEqual(first)
    expect(await other.hasPendingMethodChange('methods-agent')).toBe(true)

    expect(
      await methods.settleMethodChange(
        'methods-agent',
        first.id,
        'done',
        [{ name: 'review.md', base64: null, mode: null }],
        person,
      ),
    ).toBe(true)
    expect(await other.methodChange('methods-agent', first.id)).toMatchObject({
      outcome: 'done',
      settlement: { by: person, at: 200 },
    })
    expect(await other.hasPendingMethodChange('methods-agent')).toBe(false)
    const second = await other.beginMethodChange('methods-agent', intent, person, 102)
    expect(second?.sequence).toBe(2)
    expect((await methods.methodChanges('methods-agent')).map((row) => row.id)).toEqual([
      second?.id,
      first.id,
    ])
    expect(database.open).toBe(true)
  })

  it('keeps a rejected settlement pending without publishing a successful outcome', async () => {
    const started = await methods.beginMethodChange('methods-agent', intent, person, 100)
    if (started === null) throw new Error('missing method intent')
    expect(
      await methods.settleMethodChange(
        'methods-agent',
        started.id,
        'done',
        [{ name: 'review.md', base64: 'YQ0K', mode: 0o600 }],
        person,
      ),
    ).toBe(false)
    expect(await methods.methodChange('methods-agent', started.id)).toEqual(started)
    expect(await methods.hasPendingMethodChange('methods-agent')).toBe(true)
  })

  it('keeps an unknown profile absent and propagates closed-database failures as rejections', async () => {
    expect(await methods.beginMethodChange('missing', intent, person, 100)).toBeNull()
    expect(await methods.methodChanges('missing')).toEqual([])
    database.close()
    await expect(methods.methodChanges('methods-agent')).rejects.toThrow()
    await expect(methods.beginMethodChange('methods-agent', intent, person, 101)).rejects.toThrow()
  })
})
