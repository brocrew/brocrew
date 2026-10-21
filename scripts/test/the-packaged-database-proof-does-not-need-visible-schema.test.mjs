import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// The approved release title bar hides diagnostics. A mounted footer alone is still no DB proof.
const source = readFileSync(new URL('../packaged-smoke.mjs', import.meta.url), 'utf8')
const start = source.indexOf('async function thePackagedDatabaseOpened(cdp) {')
const end = source.indexOf('\n}\n', start) + 2
expect(start).toBeGreaterThan(0)
const helper = source.slice(start, end)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function proof(count, { mounted = true, failure = null } = {}) {
  let reads = 0
  const cdp = {
    evaluate: (body) =>
      new AsyncFunction('document', 'window', body)(
        { querySelector: () => (mounted ? { innerText: 'Saved locally' } : null) },
        {
          api: {
            getAppInfo: async () => {
              reads++
              if (failure) throw new Error(failure)
              return { db: { migrationsApplied: count } }
            },
          },
        },
      ),
  }
  const waitFor = async (_what, read, timeout) => {
    expect(timeout).toBe(15_000)
    const value = await read()
    if (value === null) throw new Error('timed out waiting for the database')
    return value
  }
  const run = new Function('waitFor', `${helper}; return thePackagedDatabaseOpened`)(waitFor)
  return { run: () => run(cdp), reads: () => reads }
}

it('the packaged smoke step calls the proof exercised here', () => {
  expect(source.slice(source.indexOf("'2b the packaged app opened its database"))).toContain(
    'return await thePackagedDatabaseOpened(cdp)',
  )
})
it('accepts an actual migration count with only Saved locally visible', async () => {
  const state = proof(7)
  await expect(state.run()).resolves.toContain('schema 7')
  expect(state.reads()).toBe(1)
})
it.each([undefined, null, 0, -1, 1.5, '7'])(
  'refuses an invalid or empty count (%s)',
  async (count) => {
    await expect(proof(count).run()).rejects.toThrow('timed out waiting for the database')
  },
)
it('still requires the packaged UI to be mounted', async () => {
  const state = proof(7, { mounted: false })
  await expect(state.run()).rejects.toThrow('timed out')
  expect(state.reads()).toBe(0)
})
it('retains a database failure with the visible footer for diagnosis', async () => {
  await expect(proof(7, { failure: 'Database not initialised' }).run()).rejects.toThrow(
    'Database not initialised — the packaged app\'s footer reads "Saved locally"',
  )
})
