import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { keepTranscriptsForever } from '../src/main/transcript-retention'

const FILE = 'transcript-retention.json'
let data: string

beforeEach(() => {
  data = mkdtempSync(join(tmpdir(), 'fictional-transcripts-kept-'))
})
afterEach(() => {
  rmSync(data, { recursive: true, force: true })
})

const saved = (): unknown => JSON.parse(readFileSync(join(data, FILE), 'utf8'))
const save = (text: string): void => writeFileSync(join(data, FILE), text)

it('a workspace with no saved period is set to keep every transcript', async () => {
  await keepTranscriptsForever(data)
  expect(saved()).toEqual({ period: 'forever', scanAfter: '' })
})

it.each([30, 90, 365])(
  'an earlier %s-day period becomes forever, keeping the rest',
  async (period) => {
    const cleared = [{ at: 10, days: period, conversations: 2, bytes: 40 }]
    save(JSON.stringify({ period, checkedAt: 10, scanAfter: 'default/x/codex/sessions', cleared }))
    await keepTranscriptsForever(data)
    expect(saved()).toEqual({ period: 'forever', checkedAt: 10, scanAfter: '', cleared })
  },
)

it('a file already saying forever is left exactly as it is', async () => {
  const text = '{ "period": "forever", "checkedAt": 7 }'
  save(text)
  await keepTranscriptsForever(data)
  expect(readFileSync(join(data, FILE), 'utf8')).toBe(text)
})

it('an unreadable file is replaced by one that keeps every transcript', async () => {
  save('{')
  await keepTranscriptsForever(data)
  expect(saved()).toEqual({ period: 'forever', scanAfter: '' })
  save('[90]')
  await keepTranscriptsForever(data)
  expect(saved()).toEqual({ period: 'forever', scanAfter: '' })
})
