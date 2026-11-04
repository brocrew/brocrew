import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ownerDiagnosticLine } from '../src/main/plugins/supervisor/protocol'
import { supervisorFixtures } from './plugin-supervisor-fixtures'
const f = supervisorFixtures()
afterEach(() => f.cleanup())

it.each(['blocked', 'draining', 'accepting'] as const)(
  'retired %s recovery advice neither writes nor gates launch',
  async (phase) => {
    const target = await f.fixture(),
      launch = join(target.root, 'supervisor-launches', randomUUID())
    await mkdir(launch, { recursive: true })
    const sentinel = join(launch, 'recovery-advice.json')
    const bytes = JSON.stringify({ phase, fictional: true })
    await writeFile(sentinel, bytes)
    const owner = await target.start()
    expect(await readdir(launch)).toEqual(['recovery-advice.json'])
    expect(await readFile(sentinel, 'utf8')).toBe(bytes)
    expect(await owner.shutdown()).toBe(true)
  },
)
it('legacy diagnostic values do not prescribe restarting the computer', () => {
  expect(
    ownerDiagnosticLine({
      phase: 'blocked',
      stage: 'recovery',
      probe: 'no-answer',
      reason: 'restart-required',
    }),
  ).not.toContain('Restart')
})
