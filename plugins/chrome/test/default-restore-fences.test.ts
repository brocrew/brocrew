import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { listExtensions } from '../src/extensions.js'

const cleanup: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-default-'))
  cleanup.push(dir)
  return dir
}
const id = 'a'.repeat(32)
function extension(defaultDir: string) {
  const dir = path.join(defaultDir, 'Extensions', id, '1.0')
  fs.mkdirSync(path.join(dir, '_locales', 'en'), { recursive: true })
  fs.writeFileSync(
    path.join(defaultDir, 'Preferences'),
    JSON.stringify({ extensions: { settings: { [id]: { state: 1 } } } }),
  )
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({ name: '__MSG_title__', version: '1.0', default_locale: 'en' }),
  )
  fs.writeFileSync(
    path.join(dir, '_locales', 'en', 'messages.json'),
    JSON.stringify({ title: { message: 'Fictional extension' } }),
  )
  return dir
}
it.each(['outside', 'internal'] as const)(
  'refuses extension reads through linked Default (%s)',
  (kind) => {
    const root = home(),
      profile = path.join(root, 'fern')
    fs.mkdirSync(profile)
    const target = kind === 'outside' ? home() : path.join(root, 'willow', 'Default')
    extension(target)
    fs.symlinkSync(target, path.join(profile, 'Default'), 'junction')
    expect(() => listExtensions(profile)).toThrow('Plugin unavailable')
  },
)
it('refuses extension reads through a linked Extensions folder', () => {
  const root = home(),
    profile = path.join(root, 'fern'),
    target = home()
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true })
  extension(target)
  fs.symlinkSync(
    path.join(target, 'Extensions'),
    path.join(profile, 'Default', 'Extensions'),
    'junction',
  )
  expect(() => listExtensions(profile)).toThrow('Plugin unavailable')
})
it('refuses a linked extension locale folder', () => {
  const profile = home(),
    target = home()
  const dir = extension(path.join(profile, 'Default'))
  fs.rmSync(path.join(dir, '_locales'), { recursive: true })
  fs.mkdirSync(path.join(target, 'en'))
  fs.writeFileSync(
    path.join(target, 'en', 'messages.json'),
    JSON.stringify({ title: { message: 'Other extension' } }),
  )
  fs.symlinkSync(target, path.join(dir, '_locales'), 'junction')
  expect(() => listExtensions(profile)).toThrow('Plugin unavailable')
})
it('still reads an ordinary extension and its localized name', () => {
  const profile = home()
  extension(path.join(profile, 'Default'))
  expect(listExtensions(profile)).toEqual([
    { id, name: 'Fictional extension', version: '1.0', enabled: true, unpacked: false },
  ])
})
