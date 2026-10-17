import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { APP_STATE_FILES, NOT_STATE } from '../../src/main/recovery/state-files'
import { ACTIVE_THEME_FILE, writeActiveTheme } from '../../src/main/themes/state'
import { appMenuTemplate } from '../../src/main/app-menu'
import { ACTIVE_THEME_PART, MANIFEST, planCleanBase } from '../../../../scripts/lib/clean-base.mjs'
import { trustedAnchor } from '../../../../scripts/lib/safe-remove.mjs'
import { createHostFixture, type HostFixture } from './host-fixtures'

let fixture: HostFixture
beforeEach(async () => {
  fixture = await createHostFixture()
})
afterEach(async () => {
  await fixture.cleanup()
})

it('keeps the current workspace choice during database recovery and classifies the hidden library', () => {
  expect(APP_STATE_FILES.find((one) => one.name === ACTIVE_THEME_FILE)?.restore).toBe(
    'kept-current',
  )
  expect(NOT_STATE.some((one) => one.name === 'themes')).toBe(true)
  expect(MANIFEST).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: ACTIVE_THEME_FILE, expect: 'file' }),
      expect.objectContaining({ name: 'themes', expect: 'dir' }),
    ]),
  )
})

it('a replaced writer temporary is left alone when the commit fails', async () => {
  await writeActiveTheme(fixture.userData, 'classic')
  let replaced: string | undefined
  await expect(
    writeActiveTheme(fixture.userData, 'defined', {
      rename: async (source) => {
        replaced = source.toString()
        await rename(source, `${replaced}.original`)
        await writeFile(source, 'a different file')
        throw new Error('fictional failed commit')
      },
    }),
  ).rejects.toThrow('fictional failed commit')
  expect(await readFile(replaced!, 'utf8')).toBe('a different file')
  expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
    '{"theme":"classic"}\n',
  )
})

it('the menu escape hatch changes the window even when the choice cannot be saved', async () => {
  await writeActiveTheme(fixture.userData, 'defined')
  const store = fixture.store({
    defaultTheme: 'classic',
    files: {
      rename: async () => {
        throw new Error('fictional read-only choice')
      },
    },
  })
  await store.start()
  expect(store.snapshot().active).toBe('defined')
  let reset: ReturnType<typeof store.showDefault> | undefined
  const menu = appMenuTemplate({
    appName: 'Fictional App',
    devTools: false,
    defaultLook: () => {
      reset = store.showDefault()
    },
  })
  const view = menu.find((one) => one.label === 'View')
  if (!Array.isArray(view?.submenu)) throw new Error('expected menu items')
  const action = view.submenu.find((one) => one.label === 'Default look')
  if (!action?.click) throw new Error('expected default action')
  Reflect.apply(action.click, undefined, [])
  expect(reset).toBeDefined()
  expect(await reset).toMatchObject({
    active: 'classic',
    requested: 'defined',
    reason: 'fictional:choice',
  })
  await store.refresh()
  expect(store.snapshot().active).toBe('classic')
  expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
    '{"theme":"defined"}\n',
  )
  expect(store.reading()).toMatchObject({ theme: null, version: null })
})

it('the active writer temporary is declared and the reset planner names only this fictional workspace', async () => {
  let part: string | undefined
  await writeActiveTheme(fixture.userData, 'classic', {
    rename: async (source, target) => {
      part = source.toString().slice(fixture.userData.length + 1)
      expect(ACTIVE_THEME_PART.test(part)).toBe(true)
      expect(ACTIVE_THEME_PART.test('active-theme.json.arbitrary.tmp')).toBe(false)
      const { rename } = await import('node:fs/promises')
      return rename(source, target)
    },
  })
  expect(part).toBeDefined()
  await writeFile(join(fixture.userData, part!), '{"theme":"classic"}\n')
  const plan = planCleanBase(trustedAnchor(fixture.userData))
  expect(plan.actions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ rel: ACTIVE_THEME_FILE, expect: 'file' }),
      expect.objectContaining({ rel: part, expect: 'file' }),
    ]),
  )
  expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
    '{"theme":"classic"}\n',
  )
})
