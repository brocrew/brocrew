import type { PathLike } from 'node:fs'
import { lstat, mkdir, readdir, readFile, rename, utimes, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { THEME_READ_FILES, type ThemeReadFiles } from '../../src/main/themes/files'
import { ACTIVE_THEME_FILE, writeActiveTheme } from '../../src/main/themes/state'
import { themeProblem } from '../../src/main/themes/words'
import { DEFINED } from './fixtures'
import {
  childTheme,
  createHostFixture,
  putTheme,
  RED_PNG,
  RED_SAMPLES,
  type HostFixture,
} from './host-fixtures'

/**
 * On Windows, antivirus and indexers open a file for a moment right after it is written, and a
 * rename of it, or of the folder it sits in, fails with EPERM, EBUSY or EACCES until they let go.
 * Saving a theme and choosing one are renames, so each tries again, and a lock that never clears
 * still leaves the person's theme and choice as they were.
 */

let fixture: HostFixture
beforeEach(async () => {
  fixture = await createHostFixture()
})
afterEach(async () => {
  await fixture.cleanup()
})

const held = (code: string): Error =>
  Object.assign(new Error(`fictional ${code}: held by another program`), { code })

type Matches = (from: string, to: string) => boolean

/** A rename that fails with `code` the first `times` times it matches, then renames for real. */
function heldFor(times: number, code: string, matches: Matches) {
  let left = times
  return {
    /** Whether this hold would refuse the rename now, counting the refusal if so. */
    refuses(from: string, to: string): boolean {
      if (!matches(from, to) || left <= 0) return false
      left -= 1
      return true
    },
    async rename(from: PathLike, to: PathLike): Promise<void> {
      if (this.refuses(String(from), String(to))) throw held(code)
      await rename(from, to)
    },
    refusalsLeft: () => left,
  }
}

const intoLibrary = (id: string) => (from: string, to: string) =>
  to === join(fixture.library, id) && basename(from).startsWith(`.theme-${id}-`)
const outOfLibrary = (id: string) => (from: string, to: string) =>
  from === join(fixture.library, id) && basename(to).startsWith(`.theme-${id}.`)
const theRollback = (id: string) => (from: string, to: string) =>
  to === join(fixture.library, id) && basename(from).endsWith('.previous')
const theChoice = (_from: string, to: string) => to === join(fixture.userData, ACTIVE_THEME_FILE)

/** Saves "mine" with a picture and makes it the workspace's theme, then answers what is on disk. */
async function anOriginal() {
  const store = fixture.store({ problem: themeProblem })
  await store.start()
  expect(
    await store.save({
      theme: childTheme('mine', 'Original'),
      assets: [{ name: 'red.png', base64: RED_PNG.toString('base64') }],
      activate: true,
    }),
  ).toMatchObject({ outcome: 'ok', active: 'mine' })
  return {
    theme: await readFile(join(fixture.library, 'mine', 'theme.json')),
    active: await readFile(join(fixture.userData, ACTIVE_THEME_FILE)),
  }
}

async function noLeftovers(): Promise<void> {
  expect((await readdir(fixture.library)).filter((name) => name.startsWith('.theme-'))).toEqual([])
}

describe('saving a theme while a file is held for a moment', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])(
    'a new theme moved into the library through one %s is saved',
    async (code) => {
      const into = heldFor(1, code, intoLibrary('fresh'))
      const store = fixture.store({
        problem: themeProblem,
        files: { rename: (from, to) => into.rename(from, to) },
      })
      await store.start()
      expect(await store.save({ theme: childTheme('fresh', 'Fresh') })).toMatchObject({
        outcome: 'ok',
        id: 'fresh',
      })
      expect(into.refusalsLeft()).toBe(0)
      expect(store.raw('fresh')?.name).toBe('Fresh')
      await noLeftovers()
    },
  )

  it('a replacement whose old folder is held once while it is set aside is saved', async () => {
    await anOriginal()
    const aside = heldFor(1, 'EBUSY', outOfLibrary('mine'))
    const store = fixture.store({
      problem: themeProblem,
      files: { rename: (from, to) => aside.rename(from, to) },
    })
    await store.start()
    expect(
      await store.save({ theme: childTheme('mine', 'Replacement'), replace: true }),
    ).toMatchObject({ outcome: 'ok' })
    expect(aside.refusalsLeft()).toBe(0)
    expect(store.raw('mine')?.name).toBe('Replacement')
    await noLeftovers()
  })

  it('a replacement held once on its way into the library is saved', async () => {
    await anOriginal()
    const into = heldFor(1, 'EPERM', intoLibrary('mine'))
    const store = fixture.store({
      problem: themeProblem,
      files: { rename: (from, to) => into.rename(from, to) },
    })
    await store.start()
    expect(
      await store.save({ theme: childTheme('mine', 'Replacement'), replace: true }),
    ).toMatchObject({ outcome: 'ok' })
    expect(into.refusalsLeft()).toBe(0)
    expect(store.raw('mine')?.name).toBe('Replacement')
    await noLeftovers()
  })

  it('a replacement that is never let into the library is refused, and the original stays whole', async () => {
    const original = await anOriginal()
    const never = heldFor(Number.POSITIVE_INFINITY, 'EPERM', intoLibrary('mine'))
    const store = fixture.store({
      problem: themeProblem,
      files: { rename: (from, to) => never.rename(from, to) },
    })
    await store.start()
    expect(await store.save({ theme: childTheme('mine', 'Replacement'), replace: true })).toEqual({
      outcome: 'refused',
      rail: 'theme-invalid',
      problems: [{ at: 'theme.json', says: 'The theme could not be saved.' }],
    })
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
    expect(await readFile(join(fixture.library, 'mine', 'assets/red.png'))).toEqual(RED_PNG)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
    expect((await store.refresh()).active).toBe('mine')
    await noLeftovers()
  })

  it('when the put-back is held too, it waits and the original comes back whole', async () => {
    const original = await anOriginal()
    const never = heldFor(Number.POSITIVE_INFINITY, 'EPERM', intoLibrary('mine'))
    const back = heldFor(2, 'EBUSY', theRollback('mine'))
    const store = fixture.store({
      problem: themeProblem,
      files: {
        rename: async (from, to) => {
          if (never.refuses(String(from), String(to))) throw held('EPERM')
          if (back.refuses(String(from), String(to))) throw held('EBUSY')
          await rename(from, to)
        },
      },
    })
    await store.start()
    expect(
      await store.save({ theme: childTheme('mine', 'Replacement'), replace: true }),
    ).toMatchObject({ outcome: 'refused', rail: 'theme-invalid' })
    expect(back.refusalsLeft()).toBe(0)
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
    expect(store.raw('mine')?.name).toBe('Original')
    await noLeftovers()
  })
})

describe('choosing a theme while its file is held for a moment', () => {
  it('a choice held once is written', async () => {
    await writeActiveTheme(fixture.userData, 'classic')
    const once = heldFor(1, 'EPERM', theChoice)
    await writeActiveTheme(fixture.userData, 'defined', {
      rename: (from, to) => once.rename(from, to),
    })
    expect(once.refusalsLeft()).toBe(0)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
      '{"theme":"defined"}\n',
    )
  })

  it('a choice never let through is refused, and the earlier choice stays', async () => {
    await anOriginal()
    const never = heldFor(Number.POSITIVE_INFINITY, 'EBUSY', theChoice)
    const store = fixture.store({
      problem: themeProblem,
      files: { rename: (from, to) => never.rename(from, to) },
    })
    await store.start()
    expect(await store.set('classic')).toEqual({
      outcome: 'refused',
      rail: 'theme-invalid',
      problems: [{ at: ACTIVE_THEME_FILE, says: 'The theme choice could not be saved.' }],
    })
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
      '{"theme":"mine"}\n',
    )
    expect(store.snapshot().active).toBe('mine')
    const entries = await readdir(fixture.userData)
    expect(entries.filter((name) => name.startsWith(`${ACTIVE_THEME_FILE}.`))).toEqual([])
  })

  it('a store choice held once goes through', async () => {
    await anOriginal()
    const once = heldFor(1, 'EACCES', theChoice)
    const store = fixture.store({
      problem: themeProblem,
      files: { rename: (from, to) => once.rename(from, to) },
    })
    await store.start()
    expect(await store.set('classic')).toMatchObject({ outcome: 'ok', active: 'classic' })
    expect(once.refusalsLeft()).toBe(0)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
      '{"theme":"classic"}\n',
    )
  })
})

describe('a theme a save set aside and could not put back', () => {
  const setAside = async (): Promise<string[]> =>
    (await readdir(fixture.library)).filter((name) => /^\.theme-mine\..*\.previous$/.test(name))

  /** A save where both the move in and the move back are refused every time they are tried. */
  async function bothRefused() {
    const original = await anOriginal()
    const into = heldFor(Number.POSITIVE_INFINITY, 'EPERM', intoLibrary('mine'))
    const back = heldFor(Number.POSITIVE_INFINITY, 'EBUSY', theRollback('mine'))
    const store = fixture.store({
      problem: themeProblem,
      files: {
        rename: async (from, to) => {
          if (into.refuses(String(from), String(to))) throw held('EPERM')
          if (back.refuses(String(from), String(to))) throw held('EBUSY')
          await rename(from, to)
        },
      },
    })
    await store.start()
    const saved = await store.save({ theme: childTheme('mine', 'Replacement'), replace: true })
    await store.close()
    return { original, saved }
  }

  it('when both moves are refused to the end, the save fails and the copy is kept', async () => {
    const { original, saved } = await bothRefused()
    expect(saved).toEqual({
      outcome: 'refused',
      rail: 'theme-invalid',
      problems: [{ at: 'theme.json', says: 'The theme could not be saved.' }],
    })
    const kept = await setAside()
    expect(kept).toHaveLength(1)
    expect(await readFile(join(fixture.library, kept[0]!, 'theme.json'))).toEqual(original.theme)
    expect(await readFile(join(fixture.library, kept[0]!, 'assets/red.png'))).toEqual(RED_PNG)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
  })

  it('at the next start it is put back, listed, and still the workspace’s theme', async () => {
    const { original } = await bothRefused()
    const store = fixture.store({ problem: themeProblem })
    await store.start()
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
    expect(store.snapshot().themes).toContainEqual(
      expect.objectContaining({ id: 'mine', name: 'Original', status: 'ok' }),
    )
    expect(store.snapshot().active).toBe('mine')
    expect(await setAside()).toEqual([])
  })

  it('while it still can’t be put back, it is listed as unavailable, never missing', async () => {
    const { original } = await bothRefused()
    const stuck = heldFor(Number.POSITIVE_INFINITY, 'EPERM', theRollback('mine'))
    const store = fixture.store({
      problem: themeProblem,
      files: { rename: (from, to) => stuck.rename(from, to) },
    })
    await store.start()
    expect(store.snapshot().themes).toContainEqual({
      id: 'mine',
      name: 'mine',
      source: 'mine',
      status: 'refused',
      problems: [{ at: 'theme.json', says: 'The file could not be read.' }],
      reason: 'The file could not be read.',
    })
    expect(store.snapshot().active).not.toBe('mine')
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
    expect(await setAside()).toHaveLength(1)
    await store.close()
    const later = fixture.store({ problem: themeProblem })
    await later.start()
    expect(later.snapshot().active).toBe('mine')
  })

  it('a copy left beside a theme folder that exists leaves that folder alone, and is kept', async () => {
    await anOriginal()
    const stale = join(fixture.library, '.theme-mine.00000000-0000-4000-8000-000000000000.previous')
    await mkdir(stale)
    await writeFile(join(stale, 'theme.json'), JSON.stringify(childTheme('mine', 'Stale')))
    const store = fixture.store({ problem: themeProblem })
    await store.start()
    expect(store.raw('mine')?.name).toBe('Original')
    expect(await readFile(join(stale, 'theme.json'), 'utf8')).toContain('"Stale"')
  })

  it('a broken copy is left on disk as it is: not shown, not applied, not removed', async () => {
    await writeActiveTheme(fixture.userData, 'mine')
    const broken = join(
      fixture.library,
      '.theme-mine.00000000-0000-4000-8000-000000000001.previous',
    )
    await mkdir(broken, { recursive: true })
    await writeFile(join(broken, 'theme.json'), '{ not json')
    const store = fixture.store({ problem: themeProblem })
    await store.start()
    expect(store.snapshot().themes.map((row) => row.id)).not.toContain('mine')
    expect(store.snapshot().active).not.toBe('mine')
    expect(await readFile(join(broken, 'theme.json'), 'utf8')).toBe('{ not json')
    expect((await readdir(fixture.library)).includes('mine')).toBe(false)
  })

  it('a partial copy beside a complete older one: the complete one is put back', async () => {
    const { original } = await bothRefused()
    const partial = join(
      fixture.library,
      '.theme-mine.00000000-0000-4000-8000-000000000002.previous',
    )
    await mkdir(partial)
    const store = fixture.store({ problem: themeProblem })
    await store.start()
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
    expect(store.snapshot().active).toBe('mine')
    expect((await readdir(partial)).length).toBe(0)
  })
})

describe('a set-aside copy the system won’t let the app read or look beside', () => {
  const setAside = async (): Promise<string[]> =>
    (await readdir(fixture.library)).filter((name) => /^\.theme-mine\..*\.previous$/.test(name))

  /** Leaves "mine" set aside only, as a save whose moves were both refused to the end does. */
  async function onlyTheCopy() {
    const original = await anOriginal()
    const copy = join(fixture.library, '.theme-mine.00000000-0000-4000-8000-000000000003.previous')
    await rename(join(fixture.library, 'mine'), copy)
    return { original, copy }
  }

  /** Reads that the system refuses with `code` whenever the path matches. */
  const refusedReads = (code: string, matches: (path: string) => boolean): ThemeReadFiles => ({
    ...THEME_READ_FILES,
    open: async (path, flags) => {
      if (matches(path)) throw held(code)
      return THEME_READ_FILES.open(path, flags)
    },
  })

  const unavailable = {
    id: 'mine',
    name: 'mine',
    source: 'mine',
    status: 'refused',
    problems: [{ at: 'theme.json', says: 'The file could not be read.' }],
    reason: 'The file could not be read.',
  }

  it.each([
    [
      'its theme.json',
      (path: string) => path.endsWith('/theme.json') && path.includes('.previous'),
    ],
    ['a picture in it', (path: string) => path.endsWith('/red.png') && path.includes('.previous')],
  ])(
    'a complete copy whose %s stays unreadable is listed as unavailable, then put back once it reads',
    async (_, matches) => {
      const { original, copy } = await onlyTheCopy()
      const store = fixture.store({
        problem: themeProblem,
        loader: { sample: () => RED_SAMPLES, readFiles: refusedReads('EPERM', matches) },
      })
      await store.start()
      expect(store.snapshot().themes).toContainEqual(unavailable)
      expect(store.snapshot().active).not.toBe('mine')
      expect((await readdir(fixture.library)).includes('mine')).toBe(false)
      expect(await readFile(join(copy, 'theme.json'))).toEqual(original.theme)
      expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
      await store.close()

      const later = fixture.store({ problem: themeProblem })
      await later.start()
      expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
      expect(later.snapshot().active).toBe('mine')
      expect(await setAside()).toEqual([])
    },
  )

  it('a copy whose read is refused once is put back', async () => {
    const { original } = await onlyTheCopy()
    let refusals = 1
    const store = fixture.store({
      problem: themeProblem,
      loader: {
        sample: () => RED_SAMPLES,
        readFiles: refusedReads(
          'EBUSY',
          (path) => path.endsWith('/theme.json') && path.includes('.previous') && refusals-- > 0,
        ),
      },
    })
    await store.start()
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
    expect(store.snapshot().active).toBe('mine')
  })

  it.each(['EACCES', 'EBUSY'])(
    'when looking at the theme’s folder is refused with %s, nothing is moved and both stay',
    async (code) => {
      const { copy, original } = await onlyTheCopy()
      const moves: string[] = []
      const store = fixture.store({
        problem: themeProblem,
        files: {
          rename: async (from, to) => {
            moves.push(`${String(from)} -> ${String(to)}`)
            await rename(from, to)
          },
          lstat: async (path) => {
            if (path === join(fixture.library, 'mine')) throw held(code)
            return lstat(path)
          },
        },
      })
      await store.start()
      expect(moves.filter((move) => move.includes('.previous'))).toEqual([])
      expect((await readdir(fixture.library)).includes('mine')).toBe(false)
      expect(await readFile(join(copy, 'theme.json'))).toEqual(original.theme)
      expect(await readFile(join(copy, 'assets/red.png'))).toEqual(RED_PNG)
      expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
      expect(store.snapshot().themes).toContainEqual(unavailable)
    },
  )

  it('a look at the theme’s folder refused once is tried again, and the copy is put back', async () => {
    const { original } = await onlyTheCopy()
    let refusals = 1
    const store = fixture.store({
      problem: themeProblem,
      files: {
        rename,
        lstat: async (path) => {
          if (path === join(fixture.library, 'mine') && refusals-- > 0) throw held('EBUSY')
          return lstat(path)
        },
      },
    })
    await store.start()
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
    expect(store.snapshot().active).toBe('mine')
  })

  it('an unreadable newest copy holds its place: an older complete one is not put back past it', async () => {
    const { original, copy } = await onlyTheCopy()
    const older = join(fixture.library, '.theme-mine.00000000-0000-4000-8000-000000000005.previous')
    await mkdir(older)
    await writeFile(join(older, 'theme.json'), JSON.stringify(childTheme('mine', 'Older')))
    const past = new Date(Date.now() - 60_000)
    await utimes(older, past, past)
    const store = fixture.store({
      problem: themeProblem,
      loader: {
        sample: () => RED_SAMPLES,
        readFiles: refusedReads(
          'EPERM',
          (path) => path.startsWith(copy) || path.includes('000000000003'),
        ),
      },
    })
    await store.start()
    expect(store.snapshot().themes).toContainEqual(unavailable)
    expect((await readdir(fixture.library)).includes('mine')).toBe(false)
    expect(await readFile(join(older, 'theme.json'), 'utf8')).toContain('"Older"')
    expect(await readFile(join(copy, 'theme.json'))).toEqual(original.theme)
  })

  it('when looking at a folder that is there is refused, the folder and the copy both stay', async () => {
    await anOriginal()
    const copy = join(fixture.library, '.theme-mine.00000000-0000-4000-8000-000000000004.previous')
    await mkdir(copy)
    await writeFile(join(copy, 'theme.json'), JSON.stringify(childTheme('mine', 'Stale')))
    const store = fixture.store({
      problem: themeProblem,
      files: {
        rename,
        lstat: async (path) => {
          if (path === join(fixture.library, 'mine')) throw held('EACCES')
          return lstat(path)
        },
      },
    })
    await store.start()
    expect(store.raw('mine')?.name).toBe('Original')
    expect(await readFile(join(copy, 'theme.json'), 'utf8')).toContain('"Stale"')
  })
})

describe('a set-aside copy the system won’t let the app look at', () => {
  const COPY = '.theme-mine.00000000-0000-4000-8000-000000000006.previous'
  const unavailable = {
    id: 'mine',
    name: 'mine',
    source: 'mine',
    status: 'refused',
    problems: [{ at: 'theme.json', says: 'The file could not be read.' }],
    reason: 'The file could not be read.',
  }

  /** A store whose look at a path ending in `name` is refused with `code` every time. */
  const lookRefused = (name: string, code: string) =>
    fixture.store({
      problem: themeProblem,
      files: {
        rename: async (from, to) => {
          if (String(from).endsWith(name))
            throw new Error('a copy that was never looked at was moved')
          await rename(from, to)
        },
        lstat: async (path) => {
          if (path.endsWith(name)) throw held(code)
          return lstat(path)
        },
      },
    })

  it('a copy that can’t be looked at keeps its theme listed, moves nothing, and is put back later', async () => {
    const original = await anOriginal()
    const copy = join(fixture.library, COPY)
    await rename(join(fixture.library, 'mine'), copy)
    const store = lookRefused(COPY, 'EPERM')
    await store.start()
    expect(store.snapshot().themes).toContainEqual(unavailable)
    expect(store.snapshot().active).not.toBe('mine')
    expect((await readdir(fixture.library)).includes('mine')).toBe(false)
    expect(await readFile(join(copy, 'theme.json'))).toEqual(original.theme)
    expect(await readFile(join(copy, 'assets/red.png'))).toEqual(RED_PNG)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
    await store.close()

    const later = fixture.store({ problem: themeProblem })
    await later.start()
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
    expect(later.snapshot().active).toBe('mine')
  })

  it('an older complete copy is not put back past a newer one that can’t be looked at', async () => {
    const original = await anOriginal()
    const newer = join(fixture.library, COPY)
    await rename(join(fixture.library, 'mine'), newer)
    const older = join(fixture.library, '.theme-mine.00000000-0000-4000-8000-000000000007.previous')
    await mkdir(older)
    await writeFile(join(older, 'theme.json'), JSON.stringify(childTheme('mine', 'Older')))
    const past = new Date(Date.now() - 60_000)
    await utimes(older, past, past)
    const store = lookRefused(COPY, 'EBUSY')
    await store.start()
    expect(store.snapshot().themes).toContainEqual(unavailable)
    expect((await readdir(fixture.library)).includes('mine')).toBe(false)
    expect(await readFile(join(older, 'theme.json'), 'utf8')).toContain('"Older"')
    expect(await readFile(join(newer, 'theme.json'))).toEqual(original.theme)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
  })
})

describe('every look and listing on the way to the list waits out a hold, and an unknown stays listed', () => {
  const unavailable = (id: string, source: 'mine' | 'built-in') => ({
    id,
    name: id,
    source,
    status: 'refused',
    problems: [{ at: 'theme.json', says: 'The file could not be read.' }],
    reason: 'The file could not be read.',
  })

  /** A store whose look at `path` and listing of `listed` are refused while `refusing()` holds. */
  function holding(options: {
    look?: string
    listed?: string
    readFiles?: ThemeReadFiles
    refusing?: () => boolean
  }) {
    const refusing = options.refusing ?? (() => true)
    return fixture.store({
      problem: themeProblem,
      loader: {
        sample: () => RED_SAMPLES,
        ...(options.readFiles ? { readFiles: options.readFiles } : {}),
      },
      files: {
        rename,
        lstat: async (path) => {
          if (path === options.look && refusing()) throw held('EPERM')
          return lstat(path)
        },
        readdir: async (path) => {
          if (path === options.listed && refusing()) throw held('EBUSY')
          return readdir(path)
        },
      },
    })
  }

  it('a library folder that can’t be looked at keeps the chosen theme listed, and it comes back later', async () => {
    const original = await anOriginal()
    const store = holding({ look: fixture.library })
    await store.start()
    expect(store.snapshot().themes).toContainEqual(unavailable('mine', 'mine'))
    expect(store.snapshot().active).not.toBe('mine')
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
    await store.close()
    const later = fixture.store({ problem: themeProblem })
    await later.start()
    expect(later.snapshot().active).toBe('mine')
  })

  it('a library that can’t be listed keeps every theme known from the last load listed', async () => {
    const original = await anOriginal()
    await fixture.store({ problem: themeProblem }).save({ theme: childTheme('other', 'Other') })
    let refusing = false
    const store = holding({ listed: fixture.library, refusing: () => refusing })
    await store.start()
    expect(store.snapshot().active).toBe('mine')
    refusing = true
    const listed = await store.refresh()
    expect(listed.themes).toContainEqual(unavailable('mine', 'mine'))
    expect(listed.themes).toContainEqual(unavailable('other', 'mine'))
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
    refusing = false
    const back = await store.refresh()
    expect(back.active).toBe('mine')
    expect(back.themes).toContainEqual(expect.objectContaining({ id: 'other', status: 'ok' }))
  })

  it.each([
    ['looked at', { look: 'builtIns' }],
    ['listed', { listed: 'builtIns' }],
  ] as const)(
    'a built-in folder that can’t be %s keeps the chosen built-in listed',
    async (_, which) => {
      await writeActiveTheme(fixture.userData, 'defined')
      const where = fixture.builtIns
      const store = holding('look' in which ? { look: where } : { listed: where })
      await store.start()
      expect(store.snapshot().themes).toContainEqual(unavailable('defined', 'built-in'))
      expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
        '{"theme":"defined"}\n',
      )
    },
  )

  it('a choice that can’t be read shows the default with the fallback words, and is kept for later', async () => {
    const original = await anOriginal()
    const choice = refusedReadsAt(join(fixture.userData, ACTIVE_THEME_FILE))
    const store = holding({ readFiles: choice })
    await store.start()
    expect(store.snapshot().active).not.toBe('mine')
    expect(store.snapshot().reason).toBe(
      "This theme is missing or can't be used, so the default look is shown.",
    )
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
    await store.close()
    const later = fixture.store({ problem: themeProblem })
    await later.start()
    expect(later.snapshot().active).toBe('mine')
  })

  it('a choice that can’t be read after it was read keeps the one read before', async () => {
    await anOriginal()
    let refusing = false
    const store = holding({
      readFiles: {
        ...THEME_READ_FILES,
        open: async (path, flags) => {
          if (refusing && path.endsWith(ACTIVE_THEME_FILE)) throw held('EACCES')
          return THEME_READ_FILES.open(path, flags)
        },
      },
    })
    await store.start()
    refusing = true
    expect((await store.refresh()).active).toBe('mine')
  })

  it('a theme whose read is refused once is listed as it is', async () => {
    await anOriginal()
    let refusals = 1
    const store = holding({
      readFiles: {
        ...THEME_READ_FILES,
        open: async (path, flags) => {
          if (path.endsWith('/mine/theme.json') && refusals-- > 0) throw held('EBUSY')
          return THEME_READ_FILES.open(path, flags)
        },
      },
    })
    await store.start()
    expect(store.snapshot().themes).toContainEqual(
      expect.objectContaining({ id: 'mine', status: 'ok' }),
    )
    expect(store.snapshot().active).toBe('mine')
  })

  it('a save whose old history can’t be listed fails and leaves the theme and its history whole', async () => {
    const original = await anOriginal()
    const first = fixture.store({ problem: themeProblem })
    await first.start()
    expect(await first.save({ theme: childTheme('mine', 'Second'), replace: true })).toMatchObject({
      outcome: 'ok',
    })
    const second = await readFile(join(fixture.library, 'mine', 'theme.json'))
    const history = await readdir(join(fixture.library, 'mine', '.history'))
    const store = holding({ listed: join(fixture.library, 'mine', '.history') })
    await store.start()
    expect(await store.save({ theme: childTheme('mine', 'Third'), replace: true })).toEqual({
      outcome: 'refused',
      rail: 'theme-invalid',
      problems: [{ at: 'theme.json', says: 'The theme could not be saved.' }],
    })
    expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(second)
    expect(await readdir(join(fixture.library, 'mine', '.history'))).toEqual(history)
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)
  })
})

describe('a theme built on a built-in the app can’t read right now', () => {
  const COPY = '.theme-mine.00000000-0000-4000-8000-000000000008.previous'
  const OLDER = '.theme-mine.00000000-0000-4000-8000-000000000009.previous'
  const unreadable = 'The file could not be read.'
  const unavailable = (id: string, source: 'mine' | 'built-in', at = 'theme.json') => ({
    id,
    name: id,
    source,
    status: 'refused',
    problems: [{ at, says: unreadable }],
    reason: unreadable,
  })
  /** A theme of its own that extends nothing, so no built-in decides whether it can be used. */
  const standalone = (name: string) => ({ ...DEFINED, id: 'mine', name })

  type Refusal = 'looked at' | 'listed' | 'read'
  const REFUSALS: readonly Refusal[] = ['looked at', 'listed', 'read']

  /**
   * A store whose look at the built-in folder, listing of it, or read of the built-in "defined"
   * is refused while `refusing()` holds. Every move it makes is written to `moves`.
   */
  function refusingBuiltIn(
    refusal: Refusal,
    refusing: () => boolean,
    moves: string[] = [],
    builtInIds: readonly string[] = ['defined'],
  ) {
    return fixture.store({
      problem: themeProblem,
      builtInIds,
      loader: {
        sample: () => RED_SAMPLES,
        readFiles: {
          ...THEME_READ_FILES,
          open: async (path, flags) => {
            if (
              refusal === 'read' &&
              path.startsWith(join(fixture.builtIns, 'defined')) &&
              refusing()
            )
              throw held('EPERM')
            return THEME_READ_FILES.open(path, flags)
          },
        },
      },
      files: {
        rename: async (from, to) => {
          moves.push(`${String(from)} -> ${String(to)}`)
          await rename(from, to)
        },
        lstat: async (path) => {
          if (refusal === 'looked at' && path === fixture.builtIns && refusing())
            throw held('EACCES')
          return lstat(path)
        },
        readdir: async (path) => {
          if (refusal === 'listed' && path === fixture.builtIns && refusing()) throw held('EBUSY')
          return readdir(path)
        },
      },
    })
  }

  /** An older complete copy of "mine" that extends nothing, a minute older than the newest. */
  async function anOlderStandaloneCopy(): Promise<string> {
    const older = join(fixture.library, OLDER)
    await mkdir(older)
    await writeFile(join(older, 'theme.json'), JSON.stringify(standalone('Older')))
    const past = new Date(Date.now() - 60_000)
    await utimes(older, past, past)
    return older
  }

  const cases = REFUSALS.flatMap((refusal) =>
    (['a fresh', 'a previously good'] as const).map((when) => [refusal, when] as const),
  )

  it.each(cases)(
    'a newest copy on a built-in that can’t be %s (%s store) is listed, holds its place, and is put back later',
    async (refusal, when) => {
      const original = await anOriginal()
      let refusing = false
      const moves: string[] = []
      const store = refusingBuiltIn(refusal, () => refusing, moves)
      if (when === 'a previously good') {
        expect((await store.start()).active).toBe('mine')
        expect(store.raw('defined')?.name).toBe('Defined')
      }
      const newer = join(fixture.library, COPY)
      await rename(join(fixture.library, 'mine'), newer)
      const older = await anOlderStandaloneCopy()
      refusing = true
      const seen = when === 'a fresh' ? await store.start() : await store.refresh()
      expect(seen.themes).toContainEqual(unavailable('mine', 'mine'))
      expect(seen.themes).toContainEqual(unavailable('defined', 'built-in'))
      expect(seen.active).not.toBe('mine')
      expect(store.raw('mine')).toBeNull()
      expect(moves.filter((move) => move.includes('.previous'))).toEqual([])
      expect((await readdir(fixture.library)).includes('mine')).toBe(false)
      expect(await readFile(join(newer, 'theme.json'))).toEqual(original.theme)
      expect(await readFile(join(newer, 'assets/red.png'))).toEqual(RED_PNG)
      expect(await readFile(join(older, 'theme.json'), 'utf8')).toContain('"Older"')
      expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)

      refusing = false
      const back = await store.refresh()
      expect(back.active).toBe('mine')
      expect(store.raw('mine')?.name).toBe('Original')
      expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
      expect(await readFile(join(older, 'theme.json'), 'utf8')).toContain('"Older"')
    },
  )

  it.each(REFUSALS)(
    'a newest copy that extends no built-in is put back and used while the built-in can’t be %s',
    async (refusal) => {
      await anOriginal()
      const copy = join(fixture.library, COPY)
      await rename(join(fixture.library, 'mine'), copy)
      await writeFile(join(copy, 'theme.json'), JSON.stringify(standalone('Standalone')))
      const store = refusingBuiltIn(refusal, () => true)
      const seen = await store.start()
      expect(seen.active).toBe('mine')
      expect(store.raw('mine')?.name).toBe('Standalone')
      expect(await readFile(join(fixture.library, 'mine', 'theme.json'), 'utf8')).toContain(
        '"Standalone"',
      )
    },
  )

  it.each(REFUSALS)(
    'a newest copy whose base is no built-in at all is still broken while the built-ins can’t be %s: the older one is put back',
    async (refusal) => {
      await anOriginal()
      const newer = join(fixture.library, COPY)
      await rename(join(fixture.library, 'mine'), newer)
      await writeFile(
        join(newer, 'theme.json'),
        JSON.stringify({ ...childTheme('mine', 'Nowhere'), extends: 'nowhere' }),
      )
      await anOlderStandaloneCopy()
      const store = refusingBuiltIn(refusal, () => true)
      const seen = await store.start()
      expect(seen.active).toBe('mine')
      expect(store.raw('mine')?.name).toBe('Older')
      expect(await readFile(join(newer, 'theme.json'), 'utf8')).toContain('"Nowhere"')
    },
  )

  it.each(cases)(
    'a person’s theme on a built-in that can’t be %s (%s store) stays listed, unused and whole, and comes back',
    async (refusal, when) => {
      const original = await anOriginal()
      await putTheme(fixture.library, 'solo', { ...standalone('Solo'), id: 'solo' })
      let refusing = when === 'a fresh'
      const store = refusingBuiltIn(refusal, () => refusing)
      if (when === 'a previously good') {
        expect((await store.start()).active).toBe('mine')
        refusing = true
      }
      const seen = when === 'a fresh' ? await store.start() : await store.refresh()
      expect(seen.themes).toContainEqual(unavailable('mine', 'mine', 'extends'))
      expect(seen.themes).toContainEqual(unavailable('defined', 'built-in'))
      expect(seen.themes).toContainEqual(expect.objectContaining({ id: 'solo', status: 'ok' }))
      expect(seen.active).not.toBe('mine')
      expect(store.raw('mine')).toBeNull()
      expect(await readFile(join(fixture.library, 'mine', 'theme.json'))).toEqual(original.theme)
      expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)

      refusing = false
      const back = await store.refresh()
      expect(back.active).toBe('mine')
      expect(store.raw('mine')?.name).toBe('Original')
    },
  )

  it('a built-in on a built-in that can’t be read is listed as unreadable, and loads later', async () => {
    await putTheme(fixture.builtIns, 'kid', childTheme('kid', 'Kid'))
    let refusing = true
    const store = refusingBuiltIn('read', () => refusing, [], ['defined', 'kid'])
    const seen = await store.start()
    expect(seen.themes).toContainEqual(unavailable('kid', 'built-in', 'extends'))
    expect(seen.themes).toContainEqual(unavailable('defined', 'built-in'))
    refusing = false
    await store.refresh()
    expect(store.raw('kid')?.name).toBe('Kid')
  })

  it('a theme saved on a built-in that can’t be read is refused as unreadable, and nothing is written', async () => {
    const store = refusingBuiltIn('read', () => true)
    await store.start()
    expect(await store.save({ theme: childTheme('fresh', 'Fresh') })).toEqual({
      outcome: 'refused',
      rail: 'theme-invalid',
      problems: [{ at: 'extends', says: unreadable }],
    })
    expect((await readdir(fixture.library)).filter((name) => name.includes('fresh'))).toEqual([])
  })

  describe('a base named with spaces around it, as validation reads it', () => {
    /** A person's theme on " defined ", which validation reads as "defined". */
    const padded = (name: string) => ({ ...childTheme('mine', name), extends: ' defined ' })

    it('loads on its base when the base reads', async () => {
      await putTheme(fixture.library, 'mine', padded('Padded'))
      const store = refusingBuiltIn('read', () => false)
      const seen = await store.start()
      expect(seen.themes).toContainEqual(expect.objectContaining({ id: 'mine', status: 'ok' }))
      expect(store.raw('mine')?.name).toBe('Padded')
    })

    it.each(REFUSALS)(
      'is unresolved while its base can’t be %s, and loads once it reads',
      async (refusal) => {
        await putTheme(fixture.library, 'mine', padded('Padded'))
        await writeActiveTheme(fixture.userData, 'mine')
        let refusing = true
        const store = refusingBuiltIn(refusal, () => refusing)
        const seen = await store.start()
        expect(seen.themes).toContainEqual(unavailable('mine', 'mine', 'extends'))
        expect(seen.active).not.toBe('mine')
        expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
          '{"theme":"mine"}\n',
        )
        refusing = false
        expect((await store.refresh()).active).toBe('mine')
        expect(store.raw('mine')?.name).toBe('Padded')
      },
    )

    it.each(REFUSALS)(
      'as the newest copy, holds its place while its base can’t be %s, and is put back later',
      async (refusal) => {
        const original = await anOriginal()
        const newer = join(fixture.library, COPY)
        await rename(join(fixture.library, 'mine'), newer)
        await writeFile(join(newer, 'theme.json'), JSON.stringify(padded('Padded')))
        const older = await anOlderStandaloneCopy()
        let refusing = true
        const moves: string[] = []
        const store = refusingBuiltIn(refusal, () => refusing, moves)
        const seen = await store.start()
        expect(seen.themes).toContainEqual(unavailable('mine', 'mine'))
        expect(store.raw('mine')).toBeNull()
        expect(moves.filter((move) => move.includes('.previous'))).toEqual([])
        expect(await readFile(join(newer, 'theme.json'), 'utf8')).toContain('"Padded"')
        expect(await readFile(join(older, 'theme.json'), 'utf8')).toContain('"Older"')
        expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(original.active)

        refusing = false
        const back = await store.refresh()
        expect(back.active).toBe('mine')
        expect(store.raw('mine')?.name).toBe('Padded')
        expect(await readFile(join(older, 'theme.json'), 'utf8')).toContain('"Older"')
      },
    )

    it.each([
      ['an invisible control character', ' defined\u0007'],
      ['nothing but spaces', '   '],
      ['an unknown name', ' nowhere '],
    ])(
      'a base with %s is still broken while the base can’t be read: the older copy is put back',
      async (_, base) => {
        await anOriginal()
        const newer = join(fixture.library, COPY)
        await rename(join(fixture.library, 'mine'), newer)
        await writeFile(
          join(newer, 'theme.json'),
          JSON.stringify({ ...childTheme('mine', 'Malformed'), extends: base }),
        )
        await anOlderStandaloneCopy()
        const store = refusingBuiltIn('read', () => true)
        const seen = await store.start()
        expect(seen.active).toBe('mine')
        expect(store.raw('mine')?.name).toBe('Older')
        expect(await readFile(join(newer, 'theme.json'), 'utf8')).toContain('"Malformed"')
      },
    )
  })
})

describe('a saved theme the readability check now notes, read while the system refuses it', () => {
  /** A theme of a person's own whose only fault is text too faint for today's check. */
  const faint = (name: string) => ({
    ...DEFINED,
    id: 'mine',
    name,
    content: { ...DEFINED.content, ink: '#c8c8c8' },
  })
  const COPY = '.theme-mine.00000000-0000-4000-8000-00000000000a.previous'
  const OLDER = '.theme-mine.00000000-0000-4000-8000-00000000000b.previous'
  const unavailable = {
    id: 'mine',
    name: 'mine',
    source: 'mine',
    status: 'refused',
    problems: [{ at: 'theme.json', says: 'The file could not be read.' }],
    reason: 'The file could not be read.',
  }

  /** A store whose reads of `mine`'s theme.json, or of its copies', are refused while `refusing()`. */
  const refusingMine = (refusing: () => boolean) =>
    fixture.store({
      problem: themeProblem,
      loader: {
        sample: () => RED_SAMPLES,
        readFiles: {
          ...THEME_READ_FILES,
          open: async (path, flags) => {
            if (/\/(mine|\.theme-mine\.[^/]*\.previous)\/theme\.json$/.test(path) && refusing())
              throw held('EPERM')
            return THEME_READ_FILES.open(path, flags)
          },
        },
      },
      files: {
        rename: async (from, to) => {
          if (refusing() && String(from).includes('.previous'))
            throw new Error('a copy was moved while its read was refused')
          await rename(from, to)
        },
      },
    })

  const noted = (snapshot: { themes: readonly { id: string; problems?: readonly unknown[] }[] }) =>
    snapshot.themes.find((theme) => theme.id === 'mine')

  it('is unavailable while its read is refused, and loads with notes once it reads', async () => {
    await putTheme(fixture.library, 'mine', faint('Faint'))
    await writeActiveTheme(fixture.userData, 'mine')
    const choice = await readFile(join(fixture.userData, ACTIVE_THEME_FILE))
    let refusing = true
    const store = refusingMine(() => refusing)
    const seen = await store.start()
    expect(seen.themes).toContainEqual(unavailable)
    expect(seen.active).not.toBe('mine')
    expect(await readFile(join(fixture.userData, ACTIVE_THEME_FILE))).toEqual(choice)

    refusing = false
    const back = await store.refresh()
    expect(back.active).toBe('mine')
    const mine = noted(back)
    expect(mine).toMatchObject({ status: 'ok', name: 'Faint' })
    expect(mine?.problems?.length).toBeGreaterThan(0)
    for (const note of mine!.problems as { says: string }[])
      expect(note.says).toMatch(/ would be too faint: /)
  })

  it('a read refused once loads with notes, not as unavailable', async () => {
    await putTheme(fixture.library, 'mine', faint('Faint'))
    let refusals = 1
    const store = refusingMine(() => refusals-- > 0)
    const seen = await store.start()
    expect(noted(seen)).toMatchObject({ status: 'ok', name: 'Faint' })
    expect(noted(seen)?.problems?.length).toBeGreaterThan(0)
  })

  it('a set-aside copy that fails only the readability check is put back, not passed over', async () => {
    const newer = join(fixture.library, COPY)
    await putTheme(fixture.library, COPY, faint('Faint'))
    const older = join(fixture.library, OLDER)
    await putTheme(fixture.library, OLDER, { ...DEFINED, id: 'mine', name: 'Older' })
    const past = new Date(Date.now() - 60_000)
    await utimes(older, past, past)
    let refusing = true
    const store = refusingMine(() => refusing)
    const seen = await store.start()
    expect(seen.themes).toContainEqual(unavailable)
    expect((await readdir(fixture.library)).includes('mine')).toBe(false)
    expect(await readFile(join(newer, 'theme.json'), 'utf8')).toContain('"Faint"')

    refusing = false
    const back = await store.refresh()
    expect(noted(back)).toMatchObject({ status: 'ok', name: 'Faint' })
    expect(noted(back)?.problems?.length).toBeGreaterThan(0)
    expect(await readFile(join(older, 'theme.json'), 'utf8')).toContain('"Older"')
  })
})

/** Reads of exactly `at` refused with EPERM every time. */
function refusedReadsAt(at: string): ThemeReadFiles {
  return {
    ...THEME_READ_FILES,
    open: async (path, flags) => {
      if (path === at) throw held('EPERM')
      return THEME_READ_FILES.open(path, flags)
    },
  }
}
