import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { summonsAttention } from '../src/renderer/src/lib/agent-state'
import { createSessionRecord, lastReportAt } from '../src/renderer/src/lib/session-record'
import { whoAnsweredIt } from '../src/shared/who-did-it'
import { createWindow, type WindowState } from '../src/renderer/src/lib/transcript-window'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const RENDERER = `${HERE}../src/renderer/src`

const read = (path: string): string => readFileSync(path, 'utf8')

function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function everySource(): { name: string; source: string }[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : /\.(vue|ts|css)$/.test(entry.name)
          ? [`${dir}/${entry.name}`]
          : [],
    )
  return walk(RENDERER).map((path) => ({
    name: path.slice(RENDERER.length + 1),
    source: code(read(path)),
  }))
}

function windowOf(times: number[]): WindowState {
  const window = createWindow()
  window.entries = times.map((at, index) => ({
    sessionId: 'sess_1',
    ordinal: index,
    at,
    event: { type: 'status', state: 'idle' } as never,
  }))
  return window
}

describe('the last-report stamp comes from the LIVE window', () => {
  it('a reader paged back does not make the conversation look stale', () => {
    const record = createSessionRecord('sess_1')

    record.window = windowOf([1_000, 2_000, 7_000])
    expect(lastReportAt(record)).toBe(7_000)

    record.tail = windowOf([1_000, 2_000, 7_000])
    record.window = windowOf([1_000, 2_000])
    expect(lastReportAt(record)).toBe(7_000)

    expect(record.window.entries.at(-1)?.at).toBe(2_000)

    const fresh = createSessionRecord('sess_2')
    expect(lastReportAt(fresh)).toBeNull()
  })
})

describe('no actor label exists anywhere', () => {
  it('the renderer carries no missing-actor wording', () => {
    const shape = /actor[^.\n]{0,40}(not reported|unknown|unavailable|missing)/i
    const carriers = everySource().filter(({ source }) => shape.test(source))
    expect(carriers.map(({ name }) => name)).toEqual([])

    expect(
      shape.test('<dd>{{ decision.actor ?? "Actor not reported" }}</dd>'),
      'the search shape cannot find a planted actor label — the negative above is vacuous',
    ).toBe(true)

    expect(shape.test('the actor model is unrelated to this')).toBe(false)
  })

  it('the actor words state what the ledger holds', () => {
    expect(whoAnsweredIt(undefined)).toBe('Nothing in the ledger records who answered it')
    expect(whoAnsweredIt({ who: 'a-person' })).toBe('by a person')
  })
})

describe('the shelf renders words it does not own', () => {
  it('only a question or a permission may summon attention', () => {
    expect(summonsAttention('permission')).toBe(true)
    expect(summonsAttention('question')).toBe(true)
    expect(summonsAttention('plan')).toBe(false)
    expect(summonsAttention(undefined)).toBe(false)
  })
})
