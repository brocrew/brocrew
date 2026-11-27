import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { supervisorFixtures } from './plugin-supervisor-fixtures'

// Card 586: the owner replaces owner.json by rename. A replacement that lands between read()'s
// lstat and its open must be read as the newer record, not end a healthy lease's close as false.
// An lstat racing that rename can also report the file it replaced, already without a link.
const replace = vi.hoisted(() => ({
  during: null as null | (() => void),
  beforeNext: null as null | (() => void),
  atLstat: null as null | (() => void),
}))
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  const lstatSync = ((...args: Parameters<typeof fs.lstatSync>) => {
    const isRecord = String(args[0]).endsWith(join('supervisor', 'owner.json'))
    const stale = replace.atLstat
    if (stale !== null && isRecord) {
      replace.atLstat = null
      // What an lstat racing the rename can report: the file it replaced, already without a link.
      const outgoing = fs.lstatSync(...args)!
      stale()
      return Object.assign(outgoing, { nlink: typeof outgoing.nlink === 'bigint' ? 0n : 0 })
    }
    const first = replace.beforeNext
    if (first !== null && isRecord && replace.during === null) {
      replace.beforeNext = null
      first()
    }
    const stat = fs.lstatSync(...args)
    const once = replace.during
    if (once !== null && isRecord) {
      replace.during = null
      once()
    }
    return stat
  }) as typeof fs.lstatSync
  return { ...fs, lstatSync, default: { ...fs, lstatSync } }
})

const f = supervisorFixtures()
afterEach(async () => {
  replace.atLstat = null
  replace.during = null
  replace.beforeNext = null
  vi.restoreAllMocks()
  await f.cleanup()
})

it.each([
  ['between its lstat and its open', 'during'],
  ['at its lstat, which reports the replaced file', 'atLstat'],
] as const)(
  'a lease closing while its owner replaces the record %s reads the record that replaced it',
  async (_, hook) => {
    const target = await f.fixture()
    await target.start()
    const lease = await target.attach()
    const record = join(target.root, 'supervisor', 'owner.json')
    const leaseStorage = (lease as unknown as { storage: SupervisorStorage }).storage
    const read = SupervisorStorage.prototype.read
    let replaced = 0
    vi.spyOn(SupervisorStorage.prototype, 'read').mockImplementation(function (
      this: SupervisorStorage,
    ) {
      // Only the lease's own wait for the stopped record, once that record is written.
      if (
        this === leaseStorage &&
        replaced === 0 &&
        readFileSync(record, 'utf8').includes('stopped')
      )
        replace[hook] = () => {
          // What the owner's atomic write does: the same bytes, a new file, renamed over the old.
          writeFileSync(record + '.next', readFileSync(record), { mode: 0o600 })
          renameSync(record + '.next', record)
          replaced += 1
        }
      return read.call(this)
    })
    expect(await lease.close()).toBe(true)
    expect(replaced).toBe(1)
    expect(target.read()?.phase).toBe('stopped')
  },
)

it('a record replaced and then gone before it is read again is unreadable, not absent', async () => {
  const target = await f.fixture()
  await target.start()
  const record = join(target.root, 'supervisor', 'owner.json')
  const bytes = readFileSync(record)
  const storage = new SupervisorStorage(target.root, [], false)
  try {
    replace.during = () => {
      writeFileSync(record + '.next', readFileSync(record), { mode: 0o600 })
      renameSync(record + '.next', record)
      // …and before the read looks again, the record is gone.
      replace.beforeNext = () => unlinkSync(record)
    }
    expect(() => storage.read()).toThrow()
    expect(replace.beforeNext).toBeNull()
  } finally {
    storage.close()
    // The owner still runs: its record comes back the way it writes one.
    writeFileSync(record + '.next', bytes, { mode: 0o600 })
    renameSync(record + '.next', record)
  }
})
