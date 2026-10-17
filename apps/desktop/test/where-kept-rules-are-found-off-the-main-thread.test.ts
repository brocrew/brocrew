import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { settingsLocations } from '../src/main/settings-locations'

/**
 * Where each folder's Claude local settings are kept is found off the main thread, since finding one
 * runs git, and kept between reads: a read of the kept rules waits for a refresh without blocking the
 * window, and a removal reads what is kept.
 */

const MAIN = join(dirname(fileURLToPath(import.meta.url)), '../src/main')

describe('the kept locations', () => {
  it('knows nothing before a refresh, and what the refresh found after it', async () => {
    const asked: (readonly string[])[] = []
    const locations = settingsLocations(async (folders) => {
      asked.push(folders)
      return new Map(folders.map((folder) => [folder, `${folder}/.claude/settings.local.json`]))
    })
    expect(locations.known(['/a', '/b'])).toEqual([])
    await locations.refresh(['/a', '/b'])
    expect(asked).toEqual([['/a', '/b']])
    expect(locations.known(['/a', '/b', '/c'])).toEqual([
      '/a/.claude/settings.local.json',
      '/b/.claude/settings.local.json',
    ])
  })

  it('names a file two folders share once', async () => {
    const locations = settingsLocations(
      async (folders) =>
        new Map(folders.map((folder) => [folder, '/repo/.claude/settings.local.json'])),
    )
    await locations.refresh(['/repo/a', '/repo/b'])
    expect(locations.known(['/repo/a', '/repo/b'])).toEqual(['/repo/.claude/settings.local.json'])
  })

  it('runs one refresh at a time: a second call while one runs waits for it', async () => {
    let calls = 0
    let finish: () => void = () => undefined
    const locations = settingsLocations(async (folders) => {
      calls += 1
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return new Map(folders.map((folder) => [folder, `${folder}/x`]))
    })
    const first = locations.refresh(['/a'])
    const second = locations.refresh(['/a'])
    finish()
    await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(locations.known(['/a'])).toEqual(['/a/x'])
  })

  it('keeps what it knew when a refresh fails', async () => {
    let fail = false
    const locations = settingsLocations(async (folders) => {
      if (fail) throw new Error('the locator stopped')
      return new Map(folders.map((folder) => [folder, `${folder}/x`]))
    })
    await locations.refresh(['/a'])
    fail = true
    await expect(locations.refresh(['/a'])).resolves.toBeUndefined()
    expect(locations.known(['/a'])).toEqual(['/a/x'])
  })
})

describe('a refresh for other folders', () => {
  it('waits for the running one, then finds its own: a read never answers for an older set', async () => {
    const asked: (readonly string[])[] = []
    let finishFirst: () => void = () => undefined
    const locations = settingsLocations(async (folders) => {
      asked.push(folders)
      if (asked.length === 1) {
        await new Promise<void>((resolve) => {
          finishFirst = resolve
        })
      }
      return new Map(folders.map((folder) => [folder, `${folder}/x`]))
    })
    const first = locations.refresh(['/a'])
    const wider = locations.refresh(['/a', '/b'])
    finishFirst()
    await Promise.all([first, wider])
    expect(asked).toEqual([['/a'], ['/a', '/b']])
    expect(locations.known(['/a', '/b'])).toEqual(['/a/x', '/b/x'])
    expect(locations.unfound(['/a', '/b', '/c'])).toEqual(['/c'])
  })
})

describe('off the main thread', () => {
  it('no main-process module but the worker finds a location: a launch’s own call is in the runtime', () => {
    const offenders: string[] = []
    const walk = (folder: string): void => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) {
          walk(path)
          continue
        }
        if (!entry.name.endsWith('.ts') || entry.name === 'local-settings-locator.worker.ts')
          continue
        const code = readFileSync(path, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        if (/\b(projectLocalSettingsFile|localSettingsFilesOf)\(/.test(code)) offenders.push(path)
      }
    }
    walk(MAIN)
    expect(offenders).toEqual([])
    const index = readFileSync(join(MAIN, 'index.ts'), 'utf8')
    expect(index).toContain("from './local-settings-locator.worker?nodeWorker'")
    expect(index).toContain('settingsLocations(locateOffTheMainThread)')
    const worker = readFileSync(join(MAIN, 'local-settings-locator.worker.ts'), 'utf8')
    expect(worker).toMatch(/\bprojectLocalSettingsFile\(folder\)/)
  })
})
