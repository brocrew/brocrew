// Bounded source controls, UNRUN. No native executable, child, app, SDK or network call.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { readDependency, materializeNative, NATIVE_DIGESTS } from './native-dependency.mjs'
import { readFile, hash } from './contract.mjs'
function scratch(work) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-native-copy-')))
  try {
    return work(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
function fakePE() {
  const b = Buffer.alloc(134)
  b.write('MZ')
  b.writeUInt32LE(128, 0x3c)
  b.write('PE\0\0', 128)
  b.writeUInt16LE(0x8664, 132)
  return b
}
test('stable owned hardlink input and linked metadata become verified singlelink copy only', () =>
  scratch((root) => {
    const inputPath = path.join(root, 'native-input'),
      alias = path.join(root, 'input-alias'),
      bytes = fakePE()
    fs.writeFileSync(inputPath, bytes, { flag: 'wx', mode: 0o600 })
    fs.linkSync(inputPath, alias)
    const input = readDependency(inputPath, root, 1024)
    assert.equal(input.identity.nlink, '2')
    assert.throws(() => readFile(inputPath))
    const meta = path.join(root, 'metadata.json')
    fs.writeFileSync(meta, '{"version":"0.28.1"}')
    fs.linkSync(meta, path.join(root, 'metadata-alias'))
    assert.equal(JSON.parse(readDependency(meta, root, 1024).bytes).version, '0.28.1')
    const copy = materializeNative(root, input, hash(bytes), 'win32', 'x64')
    assert.equal(copy.inputIdentity.nlink, '2')
    assert.equal(copy.copyIdentity.nlink, '1')
    assert.equal(fs.lstatSync(copy.program, { bigint: true }).nlink, 1n)
    assert.equal(hash(readFile(copy.program)), hash(bytes))
    assert.equal(copy.recheck(), copy.program)
    assert.throws(() => materializeNative(root, input, '0'.repeat(64), 'win32', 'x64'))
    assert.throws(() => materializeNative(root, input, hash(bytes), 'darwin', 'arm64'))
    assert.throws(() => materializeNative(root, input, hash(bytes), 'win32', 'x64')) // No overwrite/reuse.
    fs.writeFileSync(copy.program, 'changed')
    assert.throws(() => copy.recheck())
    assert.equal(
      NATIVE_DIGESTS['darwin/arm64'],
      'e2dc9a52440a2a34f09434a2f4843cb1e30f84e40dcf238976ec61ef8cd7f36a',
    )
    assert.equal(
      NATIVE_DIGESTS['win32/x64'],
      'ec02ee9b14ab332416fedd10614dfb80eed5304d94f67745067c011934a8c3c3',
    )
  }))
test('linked dependency reader refuses before/after FD, path, parent and nlink mutations', () =>
  scratch((root) => {
    const file = path.join(root, 'input')
    fs.writeFileSync(file, 'short')
    fs.linkSync(file, path.join(root, 'alias'))
    for (const sabotage of ['fd', 'path', 'parent', 'nlink']) {
      let read = false
      const mutated = (s, changes) =>
        Object.assign(Object.create(Object.getPrototypeOf(s)), s, changes)
      const io = {
        ...fs,
        readSync(...args) {
          const n = fs.readSync(...args)
          read = true
          return n
        },
        fstatSync(...args) {
          const s = fs.fstatSync(...args)
          return read && sabotage === 'fd' ? mutated(s, { ctimeNs: s.ctimeNs + 1n }) : s
        },
        lstatSync(p, ...args) {
          const s = fs.lstatSync(p, ...args)
          if (read && sabotage === 'path' && p === file) return mutated(s, { ino: s.ino + 1n })
          if (read && sabotage === 'parent' && p === root) return mutated(s, { ino: s.ino + 1n })
          if (read && sabotage === 'nlink' && p === file) return mutated(s, { nlink: s.nlink + 1n })
          return s
        },
      }
      assert.throws(() => readDependency(file, root, 64, io), sabotage)
    }
    assert.throws(() => readDependency(file, root, 2))
  }))
