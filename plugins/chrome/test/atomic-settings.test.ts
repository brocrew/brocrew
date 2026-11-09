import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { writeAtomicallySync } from '../../shared/atomic-file.js'
import { createProfileStore } from '../src/profiles/store.js'
import { readSettings, writeSetting } from '../src/prefs.js'

const homes: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})
function home(): string {
  const folder = fs.mkdtempSync(join(tmpdir(), 'fictional-atomic-settings-'))
  homes.push(folder)
  return folder
}

it('flushes profile and preference writes before publishing them, retrying a held destination', () => {
  const folder = home()
  const store = createProfileStore({ home: folder })
  const write = fs.writeFileSync
  const rename = fs.renameSync
  const events: string[] = []
  vi.spyOn(fs, 'writeFileSync').mockImplementation((file, bytes, options) => {
    expect(options).toMatchObject({ flag: 'wx', flush: true })
    write(file, bytes, options)
    events.push('flushed')
  })
  vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out')
  const publish = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (publish.mock.calls.length === 1) throw Object.assign(new Error('held'), { code: 'EPERM' })
    events.push('published')
    rename(from, to)
  })
  store.create('fern', 'panel')
  writeSetting(store.dirOf('fern'), 'translate.enabled', false)
  expect(events).toEqual(['flushed', 'published', 'flushed', 'published'])
  expect(readSettings(store.dirOf('fern'))['translate.enabled']).toBe(false)
  expect(createProfileStore({ home: folder }).get('fern')?.name).toBe('fern')
  expect(fs.readdirSync(folder).filter((name) => name.endsWith('.tmp'))).toEqual([])
})

it.each(['ENOSPC', 'EBUSY'])('keeps the previous bytes and removes staging after %s', (code) => {
  const folder = home()
  const file = join(folder, 'settings.json')
  fs.writeFileSync(file, 'previous')
  vi.spyOn(Atomics, 'wait').mockReturnValue('timed-out')
  if (code === 'ENOSPC') {
    const write = fs.writeFileSync
    vi.spyOn(fs, 'writeFileSync').mockImplementation((stage, bytes, options) => {
      write(stage, bytes, options)
      throw Object.assign(new Error('full'), { code })
    })
  } else {
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('held'), { code })
    })
  }
  expect(() => writeAtomicallySync(file, 'next')).toThrow()
  expect(fs.readFileSync(file, 'utf8')).toBe('previous')
  expect(fs.readdirSync(folder)).toEqual(['settings.json'])
})

it('preserves executable mode when installing program bytes', () => {
  const file = join(home(), 'program')
  writeAtomicallySync(file, Buffer.from('fictional executable'), 0o700)
  expect(fs.readFileSync(file, 'utf8')).toBe('fictional executable')
  if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o700)
})
