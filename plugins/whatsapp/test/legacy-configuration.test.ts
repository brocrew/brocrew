import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadConfig } from '../src/config.js'
import { startWhatsApp } from '../src/app.js'
import { FakeBridge } from './fakes.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
function fixture(slot = 'plugins') {
  const root = fs.mkdtempSync(
    path.join(process.platform === 'win32' ? os.tmpdir() : '/tmp', 'fictional-whatsapp-ledger-'),
  )
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, slot, 'host/data/whatsapp')
  const directory = path.join(root, slot, 'profile-apply/fictional-install')
  const floor = path.join(root, slot, 'profile-apply/fictional-install.floor')
  const source = { directory, floor }
  fs.mkdirSync(path.join(directory, 'intents'), { recursive: true })
  fs.mkdirSync(path.join(home, 'bridge'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'birth'), 'fictional-install')
  fs.writeFileSync(
    path.join(home, 'settings.json'),
    JSON.stringify({ read: true, prefix: false, writable: [] }),
  )
  for (const file of ['session.db', 'messages.db', 'messages.db-wal', 'messages.db-shm'])
    fs.writeFileSync(path.join(home, 'bridge', file), 'opaque ' + file)
  const env = {
    BROCREW_PLUGIN_DATA: home,
    BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify({
      dataDirectory: home,
      previousVersion: 'legacy-package',
      previousDataSchema: 1,
      legacyConfiguration: source,
    }),
  }
  const record = (value: number) =>
    JSON.stringify({
      format: 2,
      installId: 'fictional-install',
      revision: value,
      previous: 'opaque old digest',
    })
  const marker = path.join(home, 'legacy-configuration.json')
  const inventory = (dir: string): Record<string, string> =>
    Object.fromEntries(
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry): Array<[string, string]> => {
        const file = path.join(dir, entry.name)
        return entry.isDirectory()
          ? Object.entries(inventory(file))
          : [[file, fs.readFileSync(file).toString('hex')]]
      }),
    )
  return { home, directory, floor, source, env, record, marker, inventory }
}
it.each(['plugins', 'plugins-custom-slot'])(
  'imports only consumed boundaries and preserves opaque files in %s',
  async (slot) => {
    const data = fixture(slot)
    fs.writeFileSync(data.floor, data.record(40))
    fs.writeFileSync(path.join(data.directory, 'checkpoint.json'), data.record(32))
    fs.writeFileSync(
      path.join(data.directory, 'intents/0000000000000041.json'),
      'opaque consumed unlink proposal, never decode or execute',
    )
    fs.writeFileSync(path.join(data.directory, 'intents/.new-fictional'), 'unpublished command')
    const before = {
      ...data.inventory(data.directory),
      [data.floor]: fs.readFileSync(data.floor).toString('hex'),
      ...data.inventory(data.home),
    }
    const config = loadConfig(data.env)
    expect(config.legacyConsumed).toEqual({
      format: 1,
      source: data.source,
      installId: 'fictional-install',
      consumedRevision: 41,
    })
    const [unusedClient, transport] = InMemoryTransport.createLinkedPair()
    const bridge = new FakeBridge()
    const app = await startWhatsApp(config, { bridge, transport })
    await app.close()
    await unusedClient.close()
    expect(bridge.unlinked).toBe(0)
    expect(bridge.requests).toEqual([])
    const after = {
      ...data.inventory(data.directory),
      [data.floor]: fs.readFileSync(data.floor).toString('hex'),
      ...data.inventory(data.home),
    }
    delete after[data.marker]
    expect(after).toEqual(before)
    expect(fs.readFileSync(data.marker, 'utf8')).not.toMatch(/proposal|unlink|previous/)
    expect(loadConfig(data.env).legacyConsumed).toEqual(config.legacyConsumed)
  },
)
it('imports legacy numeric floors and eight-digit published reservations without reading command bytes', () => {
  const data = fixture()
  fs.writeFileSync(data.floor, '17')
  fs.writeFileSync(path.join(data.directory, 'intents/00000018.json'), 'opaque link command')
  expect(loadConfig(data.env).legacyConsumed?.consumedRevision).toBe(18)
})
it('preserves compacted consumption even when no command bodies survive and the floor is ahead', () => {
  const data = fixture()
  fs.writeFileSync(data.floor, data.record(67))
  fs.writeFileSync(path.join(data.directory, 'checkpoint.json'), data.record(64))
  expect(loadConfig(data.env).legacyConsumed?.consumedRevision).toBe(67)
})
it('treats absent legacy paths as no input and publishes no empty checkpoint', () => {
  const data = fixture()
  fs.rmSync(data.directory, { recursive: true })
  expect(loadConfig(data.env).legacyConsumed).toBeUndefined()
  expect(fs.existsSync(data.marker)).toBe(false)
})
it('reopens the one-time marker after old inputs disappear, without re-reading commands', () => {
  const data = fixture()
  fs.writeFileSync(data.floor, '17')
  const first = loadConfig(data.env).legacyConsumed
  expect(first).toMatchObject({ consumedRevision: 17, installId: 'fictional-install' })
  expect(fs.existsSync(data.marker)).toBe(true)
  fs.rmSync(data.directory, { recursive: true })
  fs.rmSync(data.floor)
  expect(loadConfig(data.env).legacyConsumed).toEqual(first)
})
it.each(['before', 'after'])(
  'resumes an interruption %s atomic marker publication without replay',
  (when) => {
    const data = fixture()
    fs.writeFileSync(data.floor, '17')
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(to) !== data.marker) return rename(from, to)
      if (when === 'after') rename(from, to)
      throw new Error('fictional publication interruption')
    })
    expect(() => loadConfig(data.env)).toThrow('fictional publication interruption')
    expect(fs.existsSync(data.marker)).toBe(when === 'after')
    expect(fs.readFileSync(data.floor, 'utf8')).toBe('17')
    vi.restoreAllMocks()
    expect(loadConfig(data.env).legacyConsumed?.consumedRevision).toBe(17)
    expect(
      fs.readdirSync(data.home).filter((name) => name.startsWith('.legacy-configuration-')),
    ).toEqual([])
  },
)
it('does not reset malformed or mismatched boundaries to fresh settings', () => {
  const data = fixture()
  const before = fs.readFileSync(path.join(data.home, 'settings.json'))
  fs.writeFileSync(data.floor, '{broken')
  expect(() => loadConfig(data.env)).toThrow()
  expect(fs.existsSync(data.marker)).toBe(false)
  expect(fs.readFileSync(path.join(data.home, 'settings.json'))).toEqual(before)
  fs.writeFileSync(data.floor, data.record(17).replace('fictional-install', 'another-install'))
  expect(() => loadConfig(data.env)).toThrow()
  expect(fs.existsSync(data.marker)).toBe(false)
})
it('keeps the imported install association instead of replacing it with another source', () => {
  const data = fixture()
  fs.writeFileSync(data.floor, '17')
  loadConfig(data.env)
  const before = fs.readFileSync(data.marker)
  const bootstrap = JSON.parse(data.env.BROCREW_PLUGIN_BOOTSTRAP)
  bootstrap.legacyConfiguration.directory += '-another-install'
  expect(() =>
    loadConfig({ ...data.env, BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify(bootstrap) }),
  ).toThrow()
  expect(fs.readFileSync(data.marker)).toEqual(before)
})
it('reads the previous schema before opening bridge data or publishing a conversion', () => {
  const data = fixture()
  const before = fs.readFileSync(path.join(data.home, 'bridge/session.db'))
  const bootstrap = JSON.parse(data.env.BROCREW_PLUGIN_BOOTSTRAP)
  bootstrap.previousDataSchema = 2
  expect(() =>
    loadConfig({ ...data.env, BROCREW_PLUGIN_BOOTSTRAP: JSON.stringify(bootstrap) }),
  ).toThrow('Unsupported WhatsApp data schema')
  expect(fs.readFileSync(path.join(data.home, 'bridge/session.db'))).toEqual(before)
  expect(fs.existsSync(data.marker)).toBe(false)
})
