import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  childTheme,
  cleanLibrary,
  createHostFixture,
  putTheme,
  type HostFixture,
} from './host-fixtures'

let fixture: HostFixture
beforeEach(async () => {
  fixture = await createHostFixture()
})
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await fixture.cleanup()
})

describe('theme copies', () => {
  it('duplicates classic as a standalone minimal document and chooses a free id on repetition', async () => {
    await rm(fixture.builtIns, { recursive: true })
    const store = fixture.store({ defaultTheme: 'classic', builtInIds: [] })
    await store.start()
    expect(await store.duplicate('classic', 'Fictional Copy')).toMatchObject({
      outcome: 'ok',
      id: 'fictional-copy',
      active: 'classic',
      warnings: [],
    })
    const document = JSON.parse(
      await readFile(join(fixture.library, 'fictional-copy', 'theme.json'), 'utf8'),
    )
    expect(document).toEqual({ format: 1, id: 'fictional-copy', name: 'Fictional Copy' })
    expect(document).not.toHaveProperty('extends')
    expect(await readdir(join(fixture.library, 'fictional-copy'))).toEqual(['theme.json'])
    expect(await store.duplicate('classic', 'Fictional Copy')).toMatchObject({
      outcome: 'ok',
      id: 'fictional-copy-2',
    })
    expect(store.raw('fictional-copy-2')).toEqual({
      format: 1,
      id: 'fictional-copy-2',
      name: 'Fictional Copy',
    })
    expect(await readdir(fixture.library)).toEqual(['fictional-copy', 'fictional-copy-2'])
    expect(await readdir(fixture.userData)).toEqual([])
    await cleanLibrary(fixture)
  })

  it('names copies of built-in and saved themes from the same slug and free suffix', async () => {
    await putTheme(fixture.library, 'mine', childTheme('mine'))
    const store = fixture.store()
    await store.start()
    expect(await store.duplicate('defined', 'Defined')).toMatchObject({
      outcome: 'ok',
      id: 'defined-2',
    })
    expect(store.raw('defined-2')).toEqual({
      format: 1,
      id: 'defined-2',
      name: 'Defined',
      extends: 'defined',
    })
    expect(await store.duplicate('mine', 'Mine')).toMatchObject({ outcome: 'ok', id: 'mine-2' })
    expect(store.raw('mine-2')).toEqual({ ...childTheme('mine'), id: 'mine-2', name: 'Mine' })
    expect(await store.duplicate('mine', '  Fictional theme, with the copy name!')).toMatchObject({
      outcome: 'ok',
      id: 'fictional-theme-with-the-copy',
    })
    expect(await store.duplicate('defined', '!!!')).toMatchObject({ outcome: 'ok', id: 'theme' })
    expect(await store.duplicate('mine', '***')).toMatchObject({ outcome: 'ok', id: 'theme-2' })
    expect((await readdir(fixture.library)).sort()).toEqual([
      'defined-2',
      'fictional-theme-with-the-copy',
      'mine',
      'mine-2',
      'theme',
      'theme-2',
    ])
    await cleanLibrary(fixture)
  })
})
