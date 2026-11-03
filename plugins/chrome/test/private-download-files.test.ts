import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PrivateDownloadFiles } from '../src/browser/privateDownloadFiles.js'
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-private-files-'))
  roots.push(home)
  const root = path.join(home, 'private'),
    native = path.join(home, 'Downloads')
  fs.mkdirSync(root)
  fs.mkdirSync(native)
  return { home, root, native, files: new PrivateDownloadFiles(root) }
}
it('uses actual real paths for cleanup and refuses outside files and links', () => {
  const f = fixture(),
    normal = path.join(f.native, 'fictional-normal.txt'),
    owned = path.join(f.root, 'fictional-private.txt')
  fs.writeFileSync(normal, 'fictional native bytes')
  fs.writeFileSync(owned, 'fictional private bytes')
  const inode = fs.statSync(normal).ino
  const link = path.join(f.root, 'fictional-link.txt')
  fs.symlinkSync(normal, link)
  expect(f.files.remove(normal)).toBe(false)
  expect(f.files.remove(link)).toBe(false)
  expect(() => f.files.prepare(f.native)).toThrow('unavailable')
  expect(f.files.remove(owned)).toBe(true)
  expect(fs.existsSync(owned)).toBe(false)
  expect(fs.readFileSync(normal, 'utf8')).toBe('fictional native bytes')
  expect(fs.statSync(normal).ino).toBe(inode)
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
})
it('does not adopt a replacement private folder at the same pathname', () => {
  const f = fixture()
  fs.renameSync(f.root, path.join(f.home, 'saved-original-private'))
  fs.mkdirSync(f.root)
  const file = path.join(f.root, 'fictional-replacement.txt')
  fs.writeFileSync(file, 'fictional untouched bytes')
  expect(f.files.remove(file)).toBe(false)
  expect(() => f.files.prepare(f.root)).toThrow('unavailable')
  expect(fs.readFileSync(file, 'utf8')).toBe('fictional untouched bytes')
})
it('does not follow a replacement private folder into the normal Downloads folder', () => {
  const f = fixture()
  fs.renameSync(f.root, path.join(f.home, 'saved-original-private'))
  fs.symlinkSync(f.native, f.root, process.platform === 'win32' ? 'junction' : 'dir')
  const file = path.join(f.native, 'fictional-normal.txt')
  fs.writeFileSync(file, 'fictional native bytes')
  expect(f.files.remove(path.join(f.root, 'fictional-normal.txt'))).toBe(false)
  expect(() => f.files.prepare(path.join(f.root, 'nested'))).toThrow('unavailable')
  expect(fs.readFileSync(file, 'utf8')).toBe('fictional native bytes')
  expect(fs.existsSync(path.join(f.native, 'nested'))).toBe(false)
})
