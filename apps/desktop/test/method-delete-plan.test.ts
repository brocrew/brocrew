import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  captureSavedMethodDeletion,
  listSavedMethodLibrary,
} from '../src/main/saved-method-library'
import type { MethodDeleteSelection, MethodLibraryItem } from '../src/shared/saved-method-library'

let root: string
let homesRoot: string
let folder: string
const bytes = Buffer.from([0xff, 0, 0x0d, 0x0a])
const line = '- Review | During review | verified 2026-10-21 | review.md'
const other = '- Check | Before saving | verified 2026-10-20 | other.md'
const inputs = () => ({ folder, homesRoot })
function selection(name = 'review.md'): MethodDeleteSelection {
  const listed = listSavedMethodLibrary(inputs(), 1000)
  const item = listed.items.find((item: MethodLibraryItem) => item.name === name)!
  expect(item).toBeDefined()
  return {
    confirmed: true,
    key: item.key,
  }
}
function capture(said = selection()) {
  return captureSavedMethodDeletion(inputs(), said)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'method-delete-plan-'))
  homesRoot = join(root, 'homes')
  folder = join(homesRoot, 'lark', 'runbooks')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'review.md'), bytes, { mode: 0o640 })
  writeFileSync(join(folder, 'index.md'), `${line}\r\n`)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('a method delete is planned from the confirmed current inventory', () => {
  it('keeps exact method bytes and removes duplicate references while preserving other index bytes', () => {
    const index = `# Saved\r\n\r\n${line}\r\nmalformed | review.md\n${other}\n${line}\nend without newline`
    writeFileSync(join(folder, 'index.md'), index)
    const plan = capture()
    expect(plan.target).toBe('review.md')
    expect(plan.files.map((file) => file.name)).toEqual(['index.md', 'review.md'])
    expect(plan.files[0]?.before?.bytes).toEqual(Buffer.from(index))
    expect(plan.files[0]?.after).toEqual(
      Buffer.from(`# Saved\r\n\r\nmalformed | review.md\n${other}\nend without newline`),
    )
    expect(plan.files[1]?.before?.bytes).toEqual(bytes)
    expect(plan.files[1]?.after).toBeNull()
    plan.check()
    expect(readFileSync(join(folder, 'index.md'), 'utf8')).toBe(index)
    expect(readFileSync(join(folder, 'review.md'))).toEqual(bytes)
  })
  it('plans index deletion without deleting any method', () => {
    const plan = capture(selection('index.md'))
    expect(plan.files.map((file) => file.name)).toEqual(['index.md'])
    expect(plan.files[0]?.after).toBeNull()
    expect(existsSync(join(folder, 'review.md'))).toBe(true)
  })
  it('retains an absent target while removing its dangling references', () => {
    rmSync(join(folder, 'review.md'))
    const plan = capture()
    expect(plan.files[1]).toEqual({ name: 'review.md', before: null, after: null })
    expect(plan.files[0]?.after).toEqual(Buffer.alloc(0))
  })
  it('refuses a caller supplied path instead of a key', () => {
    capture()
    const shown = selection()
    expect(() => capture({ ...shown, key: join(folder, 'review.md') })).toThrow()
  })
  it('refuses invalid index text', () => {
    capture()
    const shown = selection()
    writeFileSync(join(folder, 'index.md'), Buffer.from([0xff]))
    expect(() => capture(shown)).toThrow()
  })
  it('does not reject a hard-linked method or change its other name while planning', () => {
    linkSync(join(folder, 'review.md'), join(root, 'other-name.md'))
    const plan = capture()
    expect(plan.files[1]?.before?.bytes).toEqual(bytes)
    expect(readFileSync(join(root, 'other-name.md'))).toEqual(bytes)
  })
})
