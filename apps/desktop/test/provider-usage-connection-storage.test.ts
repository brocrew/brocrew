import { afterEach, beforeEach, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { usageKeptIn } from '../src/main/provider-usage-file'

let db: AppDatabase
beforeEach(() => {
  db = openDatabase(':memory:')
  applyMigrations(db, join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations'))
})
afterEach(() => db.close())
for (const provider of ['claude', 'codex'] as const) {
  it(`${provider}: durable readings and read-on tags distinguish routes, legacy NULL and the opaque unknown ID`, () => {
    const kept = usageKeptIn(db)
    const before = kept.read()
    const legacyTag = 'd4'.repeat(16)
    const scopes = [
      { provider, connectionId: `${provider}:sign-in`, tag: 'a1'.repeat(16) },
      { provider, connectionId: `${provider}:api-key`, tag: 'b2'.repeat(16) },
      { provider, connectionId: 'unknown', tag: 'c3'.repeat(16) },
    ]
    const readings = [
      {
        window: 'seven_day',
        usedPercent: 30,
        resetsAt: 4000,
        at: 1000,
        connectionId: `${provider}:sign-in`,
      },
      {
        window: 'seven_day',
        usedPercent: 3,
        resetsAt: 8000,
        at: 1000,
        connectionId: `${provider}:api-key`,
      },
      { window: 'seven_day', usedPercent: 9, resetsAt: null, at: 1000 },
      { window: 'seven_day', usedPercent: 7, resetsAt: null, at: 1000, connectionId: 'unknown' },
    ]
    const seeded = {
      ...before,
      readings: { ...before.readings, [provider]: readings },
      readOn: { [provider]: legacyTag },
      readOnConnections: scopes,
    }
    kept.write(seeded)
    const restored = usageKeptIn(db).read()
    expect(restored.readings[provider]).toEqual(readings)
    expect(restored.readOn).toEqual({ [provider]: legacyTag })
    expect(restored).toMatchObject({ readOnConnections: expect.arrayContaining(scopes) })
    expect(db.prepare('SELECT COUNT(*) AS n FROM provider_usage_read_on').get()).toEqual({ n: 4 })
    const duplicateReading = db.prepare(
      'INSERT INTO provider_usage_reading (provider,connection_id,"window",position,used_percent,resets_at,at,account) VALUES (?,NULL,?,9,1,NULL,1000,NULL)',
    )
    expect(() => duplicateReading.run(provider, 'seven_day')).toThrow(/UNIQUE constraint/)
    const duplicateTag = db.prepare(
      'INSERT INTO provider_usage_read_on (provider,connection_id,tag) VALUES (?,NULL,?)',
    )
    expect(() => duplicateTag.run(provider, 'e5'.repeat(16))).toThrow(/UNIQUE constraint/)
    kept.write(seeded)
    expect(usageKeptIn(db).read()).toEqual(restored)
  })
}
