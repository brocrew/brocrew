import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classifyDroppedPaths,
  classifyHandedPath,
  tooManyDropped,
} from '../src/main/runtime/handed-path'
import { MAX_HANDED_PATHS } from '../src/shared/runtime-ipc'

describe('classifying paths that arrived by drop', () => {
  let scratch = ''

  afterEach(() => {
    if (scratch !== '') rmSync(scratch, { recursive: true, force: true })
    scratch = ''
  })

  function tree(): { root: string; file: string; folder: string } {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-drop-')))
    const folder = join(scratch, 'src')
    mkdirSync(folder)
    writeFileSync(join(folder, 'one.ts'), 'a')
    writeFileSync(join(folder, 'two.ts'), 'b')
    const file = join(scratch, 'notes.md')
    writeFileSync(file, 'hello')
    return { root: scratch, file, folder }
  }

  it('a dropped FOLDER is ONE path — not enumerated, not expanded, not counted', async () => {
    const { root, folder } = tree()

    const verdicts = await classifyDroppedPaths([folder], root)

    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toEqual({
      handed: { path: folder, kind: 'directory', outsideCwd: false },
    })
    expect((await classifyDroppedPaths([join(folder, 'one.ts')], root))[0]).toHaveProperty('handed')
  })

  it('several dropped paths get several answers, in the order they were dropped', async () => {
    const { root, file, folder } = tree()

    const verdicts = await classifyDroppedPaths([file, folder], root)

    expect(verdicts.map((each) => ('handed' in each ? each.handed.kind : 'refused'))).toEqual([
      'file',
      'directory',
    ])
  })

  it('one answer PER path, refusals included — so the reply matches the request', async () => {
    const { root, file } = tree()

    const verdicts = await classifyDroppedPaths([file, join(root, 'gone.md')], root)

    expect(verdicts).toHaveLength(2)
    expect(verdicts[0]).toHaveProperty('handed')
    expect(verdicts[1]).toEqual({ refusal: `there is nothing at ${join(root, 'gone.md')}` })
  })

  it('it is the PICKER’s rule, applied to a list — a dangling symlink says the same thing', async () => {
    const { root } = tree()
    const dangling = join(root, 'shortcut')
    symlinkSync(join(root, 'never-existed'), dangling)

    expect(await classifyDroppedPaths([dangling], root)).toEqual([
      { refusal: `that is a shortcut pointing at something that is not there: ${dangling}` },
    ])
  })

  it('a relative path is refused rather than resolved against main’s own cwd', async () => {
    const { root } = tree()

    expect(await classifyDroppedPaths(['.env'], root)).toEqual([
      { refusal: 'that is not a full path, so there is no saying what it points at: .env' },
    ])
  })

  it('nothing that could never be a path reaches the classifier at all', async () => {
    const { root, file } = tree()

    const verdicts = await classifyDroppedPaths(
      ['', null, 42, { path: file }, 'x'.repeat(5000), file],
      root,
    )

    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toHaveProperty('handed')
  })

  it('a drop over the ceiling stats only the ceiling, and says how many it did not look at', async () => {
    const { root, file } = tree()
    const many = Array.from({ length: MAX_HANDED_PATHS + 7 }, () => file)

    const verdicts = await classifyDroppedPaths(many, root)

    expect(verdicts.filter((each) => 'handed' in each)).toHaveLength(MAX_HANDED_PATHS)
    expect(verdicts).toHaveLength(MAX_HANDED_PATHS + 1)
    expect(verdicts.at(-1)).toEqual({ refusal: tooManyDropped(7) })
    expect(await classifyDroppedPaths([file, file], root)).toHaveLength(2)
  })

  it('it says OUTSIDE, and the caption is the message’s, not a permission', async () => {
    const { root, file } = tree()
    const elsewhere = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-elsewhere-')))
    try {
      const verdicts = await classifyDroppedPaths([file], elsewhere)
      expect(verdicts[0]).toEqual({ handed: { path: file, kind: 'file', outsideCwd: true } })
      expect((await classifyDroppedPaths([file], root))[0]).toEqual({
        handed: { path: file, kind: 'file', outsideCwd: false },
      })
    } finally {
      rmSync(elsewhere, { recursive: true, force: true })
    }
  })
})

/** `/tmp` and `/private/tmp` are one directory, so they must classify to one path. */
describe('one directory, however it was spelled', () => {
  let scratch = ''

  afterEach(() => {
    if (scratch !== '') rmSync(scratch, { recursive: true, force: true })
    scratch = ''
  })

  it('an alias and its target classify to the SAME path — so one chip, not two', async () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-alias-')))
    const real = join(scratch, 'folder-drop')
    mkdirSync(real)
    const alias = join(scratch, 'shortcut')
    symlinkSync(real, alias)

    const dropped = (await classifyDroppedPaths([alias], scratch))[0]
    const picked = await classifyHandedPath(real, scratch)

    expect(dropped).toEqual({ handed: { path: real, kind: 'directory', outsideCwd: false } })
    expect(picked).toEqual(dropped)
  })

  it('a symlinked FILE is handed over as what it really is, and the label agrees with it', async () => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), 'brobot2-alias-')))
    const work = join(scratch, 'work')
    const away = join(scratch, 'away')
    mkdirSync(work)
    mkdirSync(away)
    const target = join(away, 'secret.md')
    writeFileSync(target, 'x')
    const inside = join(work, 'looks-local.md')
    symlinkSync(target, inside)

    expect(await classifyHandedPath(inside, work)).toEqual({
      handed: { path: target, kind: 'file', outsideCwd: true },
    })
  })
})
