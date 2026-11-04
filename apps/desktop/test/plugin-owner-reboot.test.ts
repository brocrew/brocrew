import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { supervisorFixtures } from './plugin-supervisor-fixtures'
const f = supervisorFixtures()
afterEach(() => f.cleanup())

it.each(['absent', 'torn', 'foreign-volume', 'same-boot', 'new-run'])(
  'historical %s records do not gate a new owner or alter saved data',
  async (history) => {
    const target = await f.fixture()
    const proofs = join(target.root, 'supervisor/reboot-proofs')
    await mkdir(proofs, { recursive: true })
    const sentinel = join(proofs, 'fictional-history.json')
    const bytes = history === 'torn' ? '{torn' : JSON.stringify({ history, pid: 404941 })
    await writeFile(sentinel, bytes)
    const owner = await target.start()
    expect(await readFile(sentinel, 'utf8')).toBe(bytes)
    expect(await readdir(proofs)).toEqual(['fictional-history.json'])
    expect(await owner.shutdown()).toBe(true)
  },
)
it('starts and restarts without creating historical proof files', async () => {
  const target = await f.fixture()
  const first = await target.start()
  expect(await first.shutdown()).toBe(true)
  const next = await target.start()
  const files = await readdir(join(target.root, 'supervisor'))
  expect(files).not.toContain('reboot-proofs')
  expect(files).not.toContain('recovery-advice.json')
  expect(await next.shutdown()).toBe(true)
})
