import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { importLegacyConfiguration, LEGACY_MARKER } from '../src/legacyConfiguration.js'

const roots: string[] = []
afterEach(() =>
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })),
)
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-chrome-consumption-'))
  roots.push(root)
  const home = path.join(root, 'selected', 'host', 'data', 'chrome')
  const directory = path.join(root, 'old-state', 'profile-apply', 'fictional-install')
  const floor = path.join(root, 'old-state', 'profile-apply', 'fictional.floor')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(path.join(directory, 'intents'), { recursive: true })
  fs.writeFileSync(path.join(directory, 'birth'), 'fictional-install')
  fs.writeFileSync(path.join(home, 'profiles.json'), 'opaque fictional profile settings')
  const input = { directory, floor }
  const put = (revision: number, format = 2, proposal: unknown = null) => {
    const value = {
      format,
      installId: 'fictional-install',
      revision,
      previous: 'a'.repeat(64),
      proposal,
    }
    fs.writeFileSync(
      path.join(
        directory,
        'intents',
        String(revision).padStart(format === 1 ? 8 : 16, '0') + '.json',
      ),
      JSON.stringify(value),
    )
  }
  const inventory = () => {
    const files = [
      path.join(directory, 'birth'),
      ...fs
        .readdirSync(path.join(directory, 'intents'))
        .map((name) => path.join(directory, 'intents', name)),
      ...[floor, path.join(directory, 'checkpoint.json')].filter(fs.existsSync),
    ]
    return files.map((file) => [
      file,
      createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    ])
  }
  return { root, home, input, put, inventory, marker: path.join(home, LEGACY_MARKER) }
}
it('imports format-1 consumed intents without interpreting commands or changing profile settings', () => {
  const f = fixture()
  f.put(1, 1, { action: 'delete-profile', profile: 'DO-NOT-REPLAY' })
  const before = f.inventory()
  importLegacyConfiguration(f.home, f.input)
  const marker = JSON.parse(fs.readFileSync(f.marker, 'utf8'))
  expect(marker).toMatchObject({ consumed: true, revision: 1, installId: 'fictional-install' })
  expect(fs.readFileSync(f.marker, 'utf8')).not.toContain('DO-NOT-REPLAY')
  expect(f.inventory()).toEqual(before)
  expect(fs.readFileSync(path.join(f.home, 'profiles.json'), 'utf8')).toBe(
    'opaque fictional profile settings',
  )
})
it('keeps high consumed checkpoints, residual prefixes and null commands, without a 4096 ceiling', () => {
  const f = fixture()
  const boundary = {
    format: 2,
    installId: 'fictional-install',
    revision: 9000,
    previous: 'b'.repeat(64),
  }
  fs.writeFileSync(f.input.floor, JSON.stringify(boundary))
  fs.writeFileSync(path.join(f.input.directory, 'checkpoint.json'), JSON.stringify(boundary))
  f.put(3, 1, { action: 'open-window' })
  f.put(8999)
  const before = f.inventory()
  importLegacyConfiguration(f.home, f.input)
  expect(JSON.parse(fs.readFileSync(f.marker, 'utf8'))).toMatchObject({
    revision: 9000,
    previous: 'b'.repeat(64),
  })
  expect(f.inventory()).toEqual(before)
})
it('publishes once atomically, retries an interrupted import and never reopens old commands afterward', () => {
  const f = fixture()
  f.put(1)
  expect(() =>
    importLegacyConfiguration(f.home, f.input, () => {
      throw new Error('fictional interruption')
    }),
  ).toThrow()
  expect(fs.existsSync(f.marker)).toBe(false)
  importLegacyConfiguration(f.home, f.input)
  const before = fs.readFileSync(f.marker)
  fs.writeFileSync(
    path.join(f.input.directory, 'intents', '0000000000000001.json'),
    'corrupt old command after consumption',
  )
  importLegacyConfiguration(f.home, f.input)
  expect(fs.readFileSync(f.marker)).toEqual(before)
})
it('treats absent supplied legacy paths as no input and imports a numeric floor without replay', () => {
  const f = fixture()
  fs.rmSync(f.input.directory, { recursive: true })
  importLegacyConfiguration(f.home, f.input)
  expect(fs.existsSync(f.marker)).toBe(false)
  fs.writeFileSync(f.input.floor, '9876')
  importLegacyConfiguration(f.home, f.input)
  expect(JSON.parse(fs.readFileSync(f.marker, 'utf8'))).toMatchObject({
    consumed: true,
    revision: 9876,
  })
})

it('refuses changed legacy source paths instead of skipping a different installation', () => {
  const f = fixture()
  f.put(1)
  importLegacyConfiguration(f.home, f.input)
  const before = fs.readFileSync(f.marker)
  expect(() =>
    importLegacyConfiguration(f.home, {
      directory: path.join(f.root, 'another-install'),
      floor: f.input.floor,
    }),
  ).toThrow(/source/)
  expect(() =>
    importLegacyConfiguration(f.home, {
      directory: f.input.directory,
      floor: path.join(f.root, 'another.floor'),
    }),
  ).toThrow(/source/)
  expect(fs.readFileSync(f.marker)).toEqual(before)
})

it('refuses a changed install identity at the same old paths without replacing the marker', () => {
  const f = fixture()
  f.put(1)
  importLegacyConfiguration(f.home, f.input)
  const before = fs.readFileSync(f.marker)
  fs.writeFileSync(path.join(f.input.directory, 'birth'), 'another-fictional-install')
  expect(() => importLegacyConfiguration(f.home, f.input)).toThrow(/installation/)
  expect(fs.readFileSync(f.marker)).toEqual(before)
})

it('consumes the exact published filename boundary even when its command body disagrees or is corrupt', () => {
  const f = fixture()
  f.put(1)
  fs.renameSync(
    path.join(f.input.directory, 'intents', '0000000000000001.json'),
    path.join(f.input.directory, 'intents', '0000000000009001.json'),
  )
  fs.writeFileSync(
    path.join(f.input.directory, 'intents', '0000000000009002.json'),
    'opaque corrupt command body that must never be opened',
  )
  const before = f.inventory()
  importLegacyConfiguration(f.home, f.input)
  expect(JSON.parse(fs.readFileSync(f.marker, 'utf8'))).toMatchObject({
    revision: 9002,
    consumed: true,
  })
  expect(f.inventory()).toEqual(before)
})

it('refuses an invalid published intent filename before publishing a marker', () => {
  const f = fixture()
  fs.writeFileSync(path.join(f.input.directory, 'intents', '123456789.json'), 'opaque command')
  expect(() => importLegacyConfiguration(f.home, f.input)).toThrow(/filename/)
  expect(fs.existsSync(f.marker)).toBe(false)
})
