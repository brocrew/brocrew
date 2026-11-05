import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import source from './fixtures/plugin-delete-parent/source.json'
import { ChromeProposal as Encoder820Proposal } from './fixtures/plugin-encoder-820/chrome-apply'
import {
  chromeSubject,
  cleanupRetirementSubjects,
  legacyImportSubject,
  personMetadata,
} from './plugin-retirement-subjects'
afterEach(cleanupRetirementSubjects)
const snapshot = fileURLToPath(new URL('./fixtures/plugin-delete-parent/', import.meta.url))
it.each(source.files)(
  'pins frozen old source data $path without executing its controller or domain methods',
  async (file) => {
    const bytes = await readFile(join(snapshot, file.file))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.frozenSha256)
    const imports = new Map<string, string>(Object.entries(file.imports))
    const original = bytes.toString().replace(/from '(\.[^']+)'/g, (_, spec: string) => {
      expect(imports.has(spec)).toBe(true)
      return `from '${imports.get(spec)}'`
    })
    expect(createHash('sha256').update(original).digest('hex')).toBe(file.sourceSha256)
  },
)
it('the genuine 820 encoder schema cannot encode a destructive proposal', () => {
  expect(
    Encoder820Proposal.safeParse({ action: 'delete-profile', profile: 'fern', confirm: 'fern' })
      .success,
  ).toBe(false)
})
it.each(['success', 'lost-reply', 'partial-removal'] as const)(
  'the real package deletion preserves data/name safety and never replays on consumption import: %s',
  async (outcome) => {
    const historical = await legacyImportSubject('chrome'),
      f = await chromeSubject()
    f.store.create('fern', 'panel')
    f.store.create('birch', 'panel')
    f.store.setFlags('fern', { enabled: true })
    const removedDirectory = f.store.dirOf('fern')
    await writeFile(join(removedDirectory, 'Cookies'), 'fictional sign-in bytes')
    await writeFile(join(removedDirectory, 'Login Data'), 'fictional remaining bytes')
    const partial = outcome === 'partial-removal'
    if (partial)
      vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
        fs.unlinkSync(join(removedDirectory, 'Cookies'))
        throw Object.assign(new Error('fictional busy file'), { code: 'EBUSY' })
      })
    const remove = f.browser.removeWhenIdle.bind(f.browser)
    const attempts = vi.spyOn(f.browser, 'removeWhenIdle')
    if (outcome === 'lost-reply')
      attempts.mockImplementationOnce(async (name, action) => {
        await remove(name, action)
        throw new Error('fictional lost reply after actual removal')
      })
    const action = { action: 'delete-profile', profile: 'fern', confirm: 'fern' }
    const result = f.configure.execute(action, personMetadata)
    if (outcome === 'success') await result
    else await expect(result).rejects.toThrow()
    expect(attempts).toHaveBeenCalledTimes(1)
    if (partial) {
      expect(f.store.get('fern')?.enabled).toBe(false)
      expect(fs.existsSync(join(removedDirectory, 'Login Data'))).toBe(true)
      expect(() => f.store.create('fern', 'panel')).toThrow()
    } else {
      expect(f.store.get('fern')).toBeUndefined()
      expect(fs.existsSync(removedDirectory)).toBe(false)
    }
    // Historical commands are consumed metadata only, never re-applied after restart/update.
    await writeFile(join(historical.directory, 'intents', '00000002.json'), JSON.stringify(action))
    const before = await historical.inventory()
    historical.import()
    historical.import()
    expect(await historical.consumed()).toBe(2)
    expect(await historical.inventory()).toEqual(before)
    expect(await readFile(historical.marker, 'utf8')).not.toContain('delete-profile')
    expect(attempts).toHaveBeenCalledTimes(1)
    // Current independent choices still work; the old producer never handles current actions.
    await f.configure.execute(
      { action: 'set-enabled', profile: 'birch', enabled: true },
      personMetadata,
    )
    expect(f.store.get('birch')?.enabled).toBe(true)
    if (partial) {
      await f.configure.execute(action, {
        ...personMetadata,
        requestId: 'new-explicit-person-press',
      })
      expect(attempts).toHaveBeenCalledTimes(2)
      expect(f.store.get('fern')).toBeUndefined()
      expect(fs.existsSync(removedDirectory)).toBe(false)
    }
  },
)
