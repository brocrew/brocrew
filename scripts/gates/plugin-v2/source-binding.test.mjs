import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { BASE, hash } from './contract.mjs'
import { verifyRuntimeSource } from './runtime-source-binding.mjs'

test('actual runtime source reads refuse same-length drift, duplicate and escaping entries', () => {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-source-binding-')),
  )
  try {
    const files = Array.from({ length: 20 }, (_, index) => {
      const name = 'source-' + index + '.txt',
        bytes = Buffer.from('fictional-' + index)
      fs.writeFileSync(path.join(root, name), bytes, { flag: 'wx', mode: 0o600 })
      return { path: name, bytes: bytes.length, sha256: hash(bytes) }
    })
    const pins = { schema: 1, baseline: BASE, files }
    assert.equal(verifyRuntimeSource(root, pins), hash(Buffer.from(JSON.stringify(pins))))
    fs.writeFileSync(path.join(root, files[0].path), 'x'.repeat(files[0].bytes))
    assert.throws(() => verifyRuntimeSource(root, pins))
    fs.writeFileSync(path.join(root, files[0].path), 'fictional-0')
    for (const altered of [
      { ...pins, baseline: 'a'.repeat(40) },
      { ...pins, files: files.slice(1) },
      { ...pins, extra: true },
      { ...pins, files: files.map((entry, i) => (i === 1 ? files[0] : entry)) },
      { ...pins, files: files.map((entry, i) => (i ? entry : { ...entry, path: '../outside' })) },
      {
        ...pins,
        files: files.map((entry, i) => (i ? entry : { ...entry, bytes: entry.bytes - 1 })),
      },
    ])
      assert.throws(() => verifyRuntimeSource(root, altered))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('committed runtime inventory matches the current source and general source plan', () => {
  const repository = fs.realpathSync.native(fileURLToPath(new URL('../../../', import.meta.url)))
  const pins = JSON.parse(fs.readFileSync(new URL('./runtime-source-pins.json', import.meta.url)))
  const plan = JSON.parse(fs.readFileSync(new URL('./source-plan.json', import.meta.url)))
  assert.equal(verifyRuntimeSource(repository, pins), hash(Buffer.from(JSON.stringify(pins))))
  for (const entry of pins.files) {
    const matches = plan.files.filter((file) => file.path === entry.path)
    assert.equal(matches.length, 1, entry.path)
    assert.deepEqual(matches[0], entry, entry.path)
  }
})
