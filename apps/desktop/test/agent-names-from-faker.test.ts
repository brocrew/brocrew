import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import {
  HUMAN_NAMES,
  NAMES_THAT_READ_AS_WORDS,
  aNameForANewAgent,
  aNameKey,
  aNameThatCanBeGiven,
  namesThatCanBeGiven,
} from '../src/shared/human-names'
import FAKER_FIRST_NAMES from '../src/shared/agent-first-names.json'

/**
 * A new agent's name: BroBot's own list first, in its order, then first names copied from Faker's
 * locales, drawn at random; never a name an agent already answers to, and a used name with a number
 * once every name is taken. Agents named before keep their names.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/** A random source that gives the same numbers for the same seed (mulberry32). */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `count` names drawn one after another, each taken before the next is drawn. */
function draws(count: number, random: () => number, taken: string[] = []): string[] {
  const given: string[] = []
  for (let i = 0; i < count; i += 1) {
    const name = aNameForANewAgent([...taken, ...given], random)
    given.push(name)
  }
  return given
}

describe('the names a new agent can be given', () => {
  it('are thousands, from many locales, each once, and BroBot’s own list comes first and whole', () => {
    const names = namesThatCanBeGiven()
    expect(names.length).toBeGreaterThan(5_000)
    expect(new Set(names.map(aNameKey)).size).toBe(names.length)
    expect(names.slice(0, HUMAN_NAMES.length)).toEqual([...HUMAN_NAMES])
    expect(Object.keys(FAKER_FIRST_NAMES.locales).length).toBeGreaterThanOrEqual(30)
    expect(FAKER_FIRST_NAMES.faker).toBe('10.6.0')
  })

  it('are one word of Latin letters, accents allowed, short enough for the window', () => {
    for (const name of namesThatCanBeGiven()) {
      expect(name, name).toMatch(/^\p{Lu}\p{Ll}{1,9}$/u)
      expect(name, name).toMatch(/^[A-Za-zÀ-ſ]+$/)
      expect(name.normalize('NFC'), name).toBe(name)
    }
    expect(namesThatCanBeGiven().some((name) => /[^A-Za-z]/.test(name))).toBe(true)
    expect(aNameThatCanBeGiven('Zoë')).toBe(true)
    for (const left of ['Mary-Jane', "O'Neil", 'Anna Maria', 'Đặng', 'Μαρία', 'Alexandrina', 'A']) {
      expect(aNameThatCanBeGiven(left), left).toBe(false)
    }
  })

  it('leave out the names that read as words, titles or an AI assistant', () => {
    const given = new Set(namesThatCanBeGiven().map(aNameKey))
    for (const word of NAMES_THAT_READ_AS_WORDS) expect(given.has(word), word).toBe(false)
    for (const word of ['Grace', 'Will', 'May', 'Hope', 'Rich', 'Claude', 'Ruby', 'Queen']) {
      expect(aNameThatCanBeGiven(word), word).toBe(false)
    }
    // The filter is the reason: Faker lists these as first names.
    const listed = new Set(Object.values(FAKER_FIRST_NAMES.locales).flat().map(aNameKey))
    for (const word of ['grace', 'ruby', 'claude', 'queen'])
      expect(listed.has(word), word).toBe(true)
    expect(aNameThatCanBeGiven('Grete')).toBe(true)
  })
})

describe('drawing a name', () => {
  it('compares names with every accent set aside, so a slug blocks the accented name', () => {
    expect(aNameKey('Michał')).toBe('michal')
    expect(aNameKey('Søren')).toBe(aNameKey('Sören'))
    expect(aNameKey('Barış')).toBe('baris')
    const every = namesThatCanBeGiven()
    const accented = every.filter((name) => /[øłıđ]/u.test(name))
    expect(accented.length).toBeGreaterThan(0)
    const taken = [...HUMAN_NAMES, ...every.filter((name) => !accented.includes(name))]
    const given = draws(accented.length, seeded(11), [...taken, ...accented.map(aNameKey)])
    for (const name of given) expect(accented, name).not.toContain(name)
  })

  it('gives BroBot’s own list first, in its order, whatever the random source says', () => {
    expect(draws(HUMAN_NAMES.length, seeded(7))).toEqual([...HUMAN_NAMES])
  })

  it('never gives a name twice, nor one already in use, over thousands of draws', () => {
    const inUse = ['Ada', 'zoe', 'Grete', 'Zoë-2', 'pm-webapp']
    const given = draws(4_000, seeded(1), inUse)
    const keys = given.map(aNameKey)
    expect(new Set(keys).size).toBe(given.length)
    for (const used of ['ada', 'zoe', 'grete']) expect(keys).not.toContain(used)
    // Past BroBot's own list, the names come from many locales.
    const fromFaker = given.slice(HUMAN_NAMES.length - 2)
    const locales = Object.entries(FAKER_FIRST_NAMES.locales).filter(([, names]) =>
      fromFaker.some((name) => names.includes(name)),
    )
    expect(locales.length).toBeGreaterThanOrEqual(30)
  })

  it('is the same for the same seed, and differs for another', () => {
    const taken = [...HUMAN_NAMES]
    expect(draws(50, seeded(42), taken)).toEqual(draws(50, seeded(42), taken))
    expect(draws(50, seeded(42), taken)).not.toEqual(draws(50, seeded(43), taken))
  })

  it('gives a used name with a number once every name is taken', () => {
    const every = [...namesThatCanBeGiven()]
    expect(aNameForANewAgent(every, () => 0)).toBe('Ada 2')
    expect(aNameForANewAgent([...every, 'Ada 2'], () => 0)).toBe('Ada 3')
    expect(aNameForANewAgent(every, seeded(3))).toMatch(/^\p{Lu}\p{Ll}+ 2$/u)
  })
})

describe('agents named before keep their names', () => {
  let folder: string
  let db: AppDatabase

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'brobot2-agent-names-'))
    db = openDatabase(join(folder, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
  })

  afterEach(() => {
    db.close()
    rmSync(folder, { recursive: true, force: true })
  })

  const names = (): Record<string, string | null> =>
    Object.fromEntries(
      (
        db.prepare('SELECT slug, display_name AS name FROM agent_identity ORDER BY slug').all() as {
          slug: string
          name: string | null
        }[]
      ).map((row) => [row.slug, row.name]),
    )

  it('an upgrade renames nobody, and the next agent gets a name none of them holds', () => {
    const before = createSessionStore(db)
    // An install that has given 51 of BroBot's own names, and one agent a person named.
    for (const [index, name] of HUMAN_NAMES.slice(0, 51).entries()) {
      before.createAgentIdentity(
        { slug: `agent-${String(index)}`, displayName: null, provider: null },
        { by: 'a-person' },
      )
      expect(names()[`agent-${String(index)}`]).toBe(name)
    }
    before.createAgentIdentity(
      { slug: 'renamed', displayName: 'The Boss', provider: null },
      { by: 'a-person' },
    )
    const kept = names()

    db.close()
    db = openDatabase(join(folder, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    const after = createSessionStore(db, Date.now, undefined, seeded(9))
    expect(names()).toEqual(kept)

    const fresh: string[] = []
    for (let i = 0; i < 30; i += 1) {
      after.createAgentIdentity(
        { slug: `new-${String(i)}`, displayName: null, provider: null },
        { by: 'a-person' },
      )
      fresh.push(names()[`new-${String(i)}`]!)
    }
    const now = names()
    for (const [slug, name] of Object.entries(kept)) expect(now[slug], slug).toBe(name)
    // BroBot's own list carries on where it was, then Faker's names follow.
    expect(fresh.slice(0, 18)).toEqual([...HUMAN_NAMES.slice(51)])
    expect(HUMAN_NAMES.map(aNameKey)).not.toContain(aNameKey(fresh[18]!))
    const all = Object.values(now).filter((name): name is string => name !== null)
    expect(new Set(all.map(aNameKey)).size).toBe(all.length)
  })

  it('the store draws with the random source it was given', () => {
    const named = (random: () => number): string[] => {
      const store = createSessionStore(db, Date.now, undefined, random)
      db.exec('DELETE FROM agent_identity')
      for (let i = 0; i < HUMAN_NAMES.length + 5; i += 1) {
        store.createAgentIdentity(
          { slug: `agent-${String(i)}`, displayName: null, provider: null },
          { by: 'a-person' },
        )
      }
      return Object.values(names()).filter((name): name is string => name !== null)
    }
    const first = named(seeded(5))
    expect(named(seeded(5))).toEqual(first)
    expect(named(seeded(6))).not.toEqual(first)
  })
})
