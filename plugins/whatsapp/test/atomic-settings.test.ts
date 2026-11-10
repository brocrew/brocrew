import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createSettingsStore } from '../src/settings.js'

const homes: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true })
})
it('flushes settings and retains the last saved choice if publication fails', () => {
  const home = fs.mkdtempSync(join(tmpdir(), 'fictional-whatsapp-settings-'))
  homes.push(home)
  const store = createSettingsStore(home)
  const write = vi.spyOn(fs, 'writeFileSync')
  store.setRead(true)
  expect(write.mock.calls[0]?.[2]).toMatchObject({ flag: 'wx', flush: true })
  const previous = fs.readFileSync(join(home, 'settings.json'), 'utf8')
  vi.spyOn(fs, 'renameSync').mockImplementation(() => {
    throw Object.assign(new Error('full'), { code: 'ENOSPC' })
  })
  expect(() => store.setRead(false)).toThrow('full')
  expect(store.get().read).toBe(true)
  expect(createSettingsStore(home).get().read).toBe(true)
  expect(fs.readFileSync(join(home, 'settings.json'), 'utf8')).toBe(previous)
  expect(fs.readdirSync(home)).toEqual(['settings.json'])
})
