import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { asyncSessionModels } from '../src/main/database/sqlite/agents/model-facet'

const migrations = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')
let db: AppDatabase
let store: SessionStore
let now: ReturnType<typeof vi.fn<() => number>>

beforeEach(() => {
  db = openDatabase(':memory:')
  applyMigrations(db, migrations)
  now = vi.fn(() => 1_800_000_000_000)
  store = createSessionStore(db, now)
  store.create({
    id: 'recorded-model',
    provider: 'claude',
    cwd: '/fictional/work',
    approvalMode: 'ask',
    profileId: 'fictional',
  })
  store.setModel('recorded-model', 'person-selected')
  store.setReasoningEffort('recorded-model', 'medium')
  store.aPersonSetItsModelOrEffort('recorded-model', 42)
  store.setReportedModel('recorded-model', 'provider-reported', 'high')
  now.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  db.close()
})

it('binds both Promise operations to the same store and retains the plain five-field reading and null', async () => {
  const models = asyncSessionModels(store)
  const read = vi.spyOn(store, 'whatItRunsOn')
  const write = vi.spyOn(store, 'setReportedModel')
  const reading = models.whatItRunsOn('recorded-model')
  expect(reading).toBeInstanceOf(Promise)
  expect(await reading).toEqual({
    model: 'person-selected',
    reasoningEffort: 'medium',
    aPersonChoseItAt: 42,
    reportedModel: 'provider-reported',
    reportedEffort: 'high',
  })
  expect(read.mock.calls).toEqual([['recorded-model']])
  expect(await models.whatItRunsOn('missing')).toBeNull()
  const saved = models.setReportedModel('recorded-model', 'next-provider-report', null)
  expect(saved).toBeInstanceOf(Promise)
  expect(await saved).toBeUndefined()
  expect(write.mock.calls).toEqual([['recorded-model', 'next-provider-report', null]])
  expect(store.whatItRunsOn('recorded-model')).toEqual({
    model: 'person-selected',
    reasoningEffort: 'medium',
    aPersonChoseItAt: 42,
    reportedModel: 'next-provider-report',
    reportedEffort: null,
  })
  expect(now).not.toHaveBeenCalled()
})

it('rejects with the original synchronous read cause and performs a fresh next attempt without retry', async () => {
  const models = asyncSessionModels(store)
  const cause = new Error('fictional model read failed')
  const read = vi.spyOn(store, 'whatItRunsOn').mockImplementationOnce(() => {
    throw cause
  })
  let failed!: ReturnType<typeof models.whatItRunsOn>
  expect(() => {
    failed = models.whatItRunsOn('recorded-model')
  }).not.toThrow()
  expect(failed).toBeInstanceOf(Promise)
  await expect(failed).rejects.toBe(cause)
  expect(read).toHaveBeenCalledTimes(1)
  expect(await models.whatItRunsOn('recorded-model')).toEqual({
    model: 'person-selected',
    reasoningEffort: 'medium',
    aPersonChoseItAt: 42,
    reportedModel: 'provider-reported',
    reportedEffort: 'high',
  })
  expect(read.mock.calls).toEqual([['recorded-model'], ['recorded-model']])
  expect(now).not.toHaveBeenCalled()
})

it('rejects with the original synchronous write cause and keeps the next attempt and other model fields', async () => {
  const models = asyncSessionModels(store)
  const cause = new Error('fictional model write failed')
  const write = vi.spyOn(store, 'setReportedModel').mockImplementationOnce(() => {
    throw cause
  })
  let failed!: ReturnType<typeof models.setReportedModel>
  expect(() => {
    failed = models.setReportedModel('recorded-model', 'not-written', 'low')
  }).not.toThrow()
  expect(failed).toBeInstanceOf(Promise)
  await expect(failed).rejects.toBe(cause)
  expect(write).toHaveBeenCalledTimes(1)
  expect(store.whatItRunsOn('recorded-model')).toEqual({
    model: 'person-selected',
    reasoningEffort: 'medium',
    aPersonChoseItAt: 42,
    reportedModel: 'provider-reported',
    reportedEffort: 'high',
  })
  await models.setReportedModel('recorded-model', 'next-provider-report', null)
  expect(write.mock.calls).toEqual([
    ['recorded-model', 'not-written', 'low'],
    ['recorded-model', 'next-provider-report', null],
  ])
  expect(store.whatItRunsOn('recorded-model')).toEqual({
    model: 'person-selected',
    reasoningEffort: 'medium',
    aPersonChoseItAt: 42,
    reportedModel: 'next-provider-report',
    reportedEffort: null,
  })
  expect(now).not.toHaveBeenCalled()
})
