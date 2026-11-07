import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pluginPersonCapability } from '../src/main/plugins/catalogue/capability'
const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const parent = await realpath(await mkdtemp('/tmp/fictional-plugin-capability-'))
  roots.push(parent)
  const root = join(parent, 'global')
  await mkdir(root, { mode: 0o700 })
  return { root }
}
describe.skipIf(process.platform === 'win32')('person capability persistence', () => {
  it('concurrent app copies provision one capability and reject a linked authority file', async () => {
    const f = await fixture()
    const values = await Promise.all(
      Array.from({ length: 4 }, () => pluginPersonCapability(f.root)),
    )
    expect(new Set(values).size).toBe(1)
    expect(values[0]).toMatch(/^[a-f0-9]{64}$/)
    expect(await pluginPersonCapability(f.root)).toBe(values[0])
    const { readdir } = await import('node:fs/promises')
    const kept = (await readdir(join(f.root, 'capabilities'))).find((n) =>
      /^[a-f0-9]{64}$/.test(n),
    )!
    const path = join(f.root, 'capabilities', kept, 'person')
    await rm(path)
    await writeFile(join(f.root, 'decoy'), values[0]!, { mode: 0o400 })
    await symlink(join(f.root, 'decoy'), path)
    await expect(pluginPersonCapability(f.root)).rejects.toThrow()
  })
})
