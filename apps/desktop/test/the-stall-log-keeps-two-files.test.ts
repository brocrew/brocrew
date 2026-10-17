import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { STALL_LOG_MOST_BYTES, aStallLog } from '../src/main/stall-log'

/** The stall log is appended line by line, and moved aside once it passes its size. */

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

describe('the stall log', () => {
  it('⚑ makes its folder and appends one line per call', () => {
    const logs = join(mkdtempSync(join(tmpdir(), 'brobot2-stall-log-')), 'logs')
    folders.push(join(logs, '..'))
    const log = aStallLog(logs)
    log('one')
    log('two')
    expect(readFileSync(join(logs, 'stalls.log'), 'utf8')).toBe('one\ntwo\n')
  })

  it('⚑ once past its size it is moved aside to stalls.1.log, and the next line starts a new one', () => {
    const logs = mkdtempSync(join(tmpdir(), 'brobot2-stall-log-'))
    folders.push(logs)
    const log = aStallLog(logs)
    const long = 'x'.repeat(Math.ceil(STALL_LOG_MOST_BYTES / 199))
    for (let line = 0; line < 200; line++) log(long)
    expect(readdirSync(logs).sort()).toEqual(['stalls.1.log'])
    expect(statSync(join(logs, 'stalls.1.log')).size).toBeGreaterThan(STALL_LOG_MOST_BYTES)
    log('after')
    expect(readFileSync(join(logs, 'stalls.log'), 'utf8')).toBe('after\n')
  })
})
