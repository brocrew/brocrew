import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { dataPreserved } from '../lib/mac-upgrade-preservation.mjs'
import { liveProviderSessions } from '../lib/upgrade-session-preservation.mjs'
import {
  buildLineage,
  CONNECTION_UPGRADE_DEFAULTS,
  recordedLineage,
  rowsPreserved,
} from '../lib/upgrade-path.mjs'

const migrations = new URL('../../apps/desktop/src/main/db/migrations/', import.meta.url)
const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', migrations), 'utf8'))
const lineage = buildLineage(journal, (tag) =>
  readFileSync(new URL(`${tag}.sql`, migrations), 'utf8'),
)
const recorded = lineage.map(({ createdAt, hash }, index) => ({
  id: index + 1, created_at: createdAt, hash,
}))

function fixture() {
  const before = {
    provider_session: [
      { id: 'first', provider: 'codex', status: 'running' },
      { id: 'second', provider: 'claude', status: 'idle' },
    ],
    events: [{ id: 'event', payload: 'fictional' }],
    migrations: recorded.slice(0, 33),
  }
  const after = {
    ...structuredClone(before),
    migrations: structuredClone(recorded),
    provider_session: before.provider_session.map((row) => ({
      ...row,
      status: 'idle',
      source_session_ids: null,
    })),
  }
  return { before, after }
}

function windows(before, after) {
  const comparison = liveProviderSessions(
    { tables: { provider_session: before.provider_session }, lineage: recordedLineage(before.migrations) },
    { tables: { provider_session: after.provider_session }, lineage: recordedLineage(after.migrations) },
    lineage,
    CONNECTION_UPGRADE_DEFAULTS,
  )
  const rows = rowsPreserved(
    { provider_session: before.provider_session },
    { provider_session: after.provider_session },
    undefined, { provider_session: ['id'] }, undefined, comparison.additions,
  )
  return { ...comparison, ...rows }
}

test('ordinary live rows must acquire an explicit NULL while preserving their prior fields', () => {
  const { before, after } = fixture()
  expect(() => dataPreserved(before, after, { candidateLineage: lineage })).not.toThrow()
  const win = structuredClone(after)
  for (const row of win.provider_session) row.connection_id = null
  expect(windows(before, win).lost).toEqual([])
  delete win.provider_session[0].connection_id
  expect(windows(before, win).lost).toHaveLength(1)
})

test.each([
  ['missing key', (rows) => delete rows[0].source_session_ids],
  ['undefined key', (rows) => { rows[0].source_session_ids = undefined }],
  ['non-NULL alias', (rows) => { rows[0].source_session_ids = '[]' }],
  ['legacy change', (rows) => { rows[0].provider = 'other' }],
  ['unrelated addition', (rows) => { rows[0].unrelated = null }],
  ['lost row', (rows) => { rows.pop() }],
])('both live row comparisons reject %s', (_, damage) => {
  const { before, after } = fixture()
  damage(after.provider_session)
  expect(() => dataPreserved(before, after, { candidateLineage: lineage })).toThrow()
  for (const row of after.provider_session) row.connection_id = null
  expect(windows(before, after).lost).toHaveLength(1)
})

test('already migrated rows keep exact aliases and checkpoints keep exact schema', () => {
  const { before, after } = fixture()
  const checkpoint = structuredClone(before)
  expect(() => dataPreserved(before, checkpoint)).not.toThrow()
  checkpoint.provider_session[0].source_session_ids = null
  expect(() => dataPreserved(before, checkpoint)).toThrow(/changed row/)
  for (const row of after.provider_session) row.connection_id = null
  after.provider_session[0].source_session_ids = '["fictional-existing"]'
  const reopened = structuredClone(after)
  expect(() => dataPreserved(after, reopened, { candidateLineage: lineage })).not.toThrow()
  expect(windows(after, reopened).lost).toEqual([])
  reopened.provider_session[0].source_session_ids = '["different"]'
  expect(() => dataPreserved(after, reopened, { candidateLineage: lineage })).toThrow(/changed row/)
  const win = windows(after, reopened)
  expect(win.lost).toHaveLength(1)
  expect(win.receipt.rows[0]).toMatchObject({
    beforeAlias: 'non-null', afterAlias: 'non-null', aliasChanged: true,
  })
})

test.each([0, 33])('wrong migration lineage at index %s never supplies the alias expectation', (i) => {
  const { before, after } = fixture()
  after.migrations[i].hash = 'wrong'
  expect(() => dataPreserved(before, after, { candidateLineage: lineage })).toThrow(/Migration/)
  for (const row of after.provider_session) row.connection_id = null
  const win = windows(before, after)
  expect(win.receipt.matchesLineage).toBe(false)
  expect(win.lost).toHaveLength(2)
})

test('the Mac failure keeps a minimal comparison from the same read before throwing', () => {
  const { before, after } = fixture()
  after.provider_session[0].source_session_ids = undefined
  after.provider_session[0].provider = 'changed'
  const dir = mkdtempSync(join(tmpdir(), 'provider-session-receipt-'))
  const file = join(dir, 'b-first-provider-sessions.json')
  try {
    expect(() => dataPreserved(before, after, {
      candidateLineage: lineage,
      providerSessionEvidence: file,
    })).toThrow(/changed row/)
    const receipt = JSON.parse(readFileSync(file, 'utf8'))
    expect(receipt).toMatchObject({
      matchesLineage: true, introducedAliases: true, rawPrefixMatches: true, rawTimestampsMatch: true,
    })
    expect(receipt.rows).toEqual([
      { id: 'first', beforeAlias: 'absent', afterAlias: 'undefined', aliasChanged: true, changedLegacyFields: ['provider'] },
      { id: 'second', beforeAlias: 'absent', afterAlias: 'null', aliasChanged: true, changedLegacyFields: [] },
    ])
    expect(receipt.extraIds).toEqual([])
    after.migrations[0].id = 999
    expect(() => dataPreserved(before, after, {
      candidateLineage: lineage,
      providerSessionEvidence: file,
    })).toThrow(/Migration/)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      matchesLineage: true, rawPrefixMatches: false, rawTimestampsMatch: true,
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
