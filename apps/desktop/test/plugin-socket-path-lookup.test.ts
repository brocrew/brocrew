import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const lookup = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFileSync: lookup }))

const root = '/Users/' + 'r'.repeat(120)
const usual = join(root, 'supervisor', 'owner.sock')
const folders: string[] = []
afterEach(async () => {
  vi.unstubAllEnvs()
  lookup.mockReset()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})
async function paths() {
  vi.resetModules()
  const { pluginSocketPath } = await import('../src/main/plugins/socket-path')
  return {
    owner: () => pluginSocketPath(root, 'supervisor', 'owner.sock', 'darwin'),
    person: () => pluginSocketPath(root, 'person-control', 'person.sock', 'darwin'),
  }
}
/** A fictional per-user folder: its temp folder T and its cache folder C, as macOS lays them out. */
async function userFolder(withCache: boolean) {
  const base = await realpath(await mkdtemp('/tmp/fictional-user-'))
  folders.push(base)
  await mkdir(join(base, 'T'))
  if (withCache) await mkdir(join(base, 'C'))
  return base
}

it.runIf(process.platform === 'darwin')(
  'takes the cache folder beside the temp folder macOS gave the process, in either spelling, without asking again',
  async () => {
    const real = await vi.importActual<typeof import('node:child_process')>('node:child_process')
    const ask = (name: string) =>
      real.execFileSync('/usr/bin/getconf', [name], { encoding: 'utf8' }).trim().replace(/\/$/, '')
    for (const temp of [ask('DARWIN_USER_TEMP_DIR'), '/private' + ask('DARWIN_USER_TEMP_DIR')]) {
      vi.stubEnv('TMPDIR', temp)
      const { owner, person } = await paths()
      expect(dirname(dirname(owner()))).toBe(ask('DARWIN_USER_CACHE_DIR'))
      expect(dirname(dirname(person()))).toBe(ask('DARWIN_USER_CACHE_DIR'))
      for (const socket of [owner(), person()])
        expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(100)
    }
    expect(lookup).not.toHaveBeenCalled()
  },
)

it('uses the short /var spelling of the cache folder macOS names, so both sockets fit', async () => {
  vi.stubEnv('TMPDIR', '/tmp/a-custom-temp-folder')
  lookup.mockReturnValue('/private/var/folders/2p/czyp8vyn1_51jx20kdzyp6f80000gn/C/\n')
  const { owner, person } = await paths()
  expect(owner()).toMatch(
    /^\/var\/folders\/2p\/czyp8vyn1_51jx20kdzyp6f80000gn\/C\/brocrew-plugins-[0-9a-f]{16}\/owner\.sock$/,
  )
  for (const socket of [owner(), person()])
    expect(Buffer.byteLength(socket)).toBeLessThanOrEqual(100)
})

it('asks macOS when the temp folder is not macOS’s own, even with a private cache folder beside it', async () => {
  const base = await userFolder(true)
  lookup.mockReturnValue('/var/folders/zz/fictional0000gn/C/\n')
  for (const temp of [join(base, 'T'), '/tmp/a-custom-temp-folder']) {
    vi.stubEnv('TMPDIR', temp)
    const { owner } = await paths()
    expect(owner()).toMatch(
      /^\/var\/folders\/zz\/fictional0000gn\/C\/brocrew-plugins-[0-9a-f]{16}\//,
    )
  }
  expect(lookup).toHaveBeenCalledTimes(2)
  expect(lookup).toHaveBeenCalledWith(
    '/usr/bin/getconf',
    ['DARWIN_USER_CACHE_DIR'],
    expect.objectContaining({ timeout: 1000 }),
  )
})

it('asks at most once per process, and remembers a failed, slow or odd answer too', async () => {
  vi.stubEnv('TMPDIR', '/tmp/a-custom-temp-folder')
  for (const answer of [
    () => {
      throw new Error('fictional timeout')
    },
    () => 'not-absolute\n',
  ]) {
    lookup.mockReset().mockImplementation(answer)
    const { owner, person } = await paths()
    expect(owner()).toBe(usual)
    expect(person()).toBe(join(root, 'person-control', 'person.sock'))
    expect(owner()).toBe(usual)
    expect(lookup).toHaveBeenCalledTimes(1)
  }
  lookup.mockReset().mockReturnValue('/var/folders/zz/fictional0000gn/C/\n')
  const { owner, person } = await paths()
  expect(owner()).toContain('/brocrew-plugins-')
  expect(person()).toContain('/brocrew-plugins-')
  expect(lookup).toHaveBeenCalledTimes(1)
})

it('never looks anything up for a socket that fits', async () => {
  vi.resetModules()
  const { pluginSocketPath } = await import('../src/main/plugins/socket-path')
  expect(pluginSocketPath('/Users/someone/plugins', 'supervisor', 'owner.sock', 'darwin')).toBe(
    '/Users/someone/plugins/supervisor/owner.sock',
  )
  expect(lookup).not.toHaveBeenCalled()
})
