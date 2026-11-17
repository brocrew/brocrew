import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

// The approved release title bar hides diagnostics. A mounted title bar alone is still no DB proof.
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
        {
          querySelector: (selector) =>
            selector === '[data-cy=app-titlebar]' && mounted ? {} : null,
        },
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

it('accepts an actual migration count with no diagnostics in the title bar', async () => {
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
it('retains a database failure when no diagnostic footer is present', async () => {
  await expect(proof(7, { failure: 'Database not initialised' }).run()).rejects.toThrow(
    'Database not initialised — the packaged app\'s footer reads "null"',
  )
})
