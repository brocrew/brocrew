import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { NODE_VERSION, NODE_TARGETS, verifyNodeArchive } from '../prepare-plugin-node.mjs'
it('pins both the release archive and executable per target, and refuses altered bytes before extraction', () => {
  expect(NODE_VERSION).toMatch(/^24\.\d+\.\d+$/)
  expect(Object.keys(NODE_TARGETS).sort()).toEqual(['darwin-arm64', 'win32-x64'])
  for (const [name, target] of Object.entries(NODE_TARGETS)) {
    expect(target.archiveSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(target.binarySha256).toMatch(/^[a-f0-9]{64}$/)
    expect(() => verifyNodeArchive(Buffer.from('fictional substituted archive'), name)).toThrow(
      'plugin-node-archive-digest',
    )
  }
  expect(NODE_TARGETS['win32-x64'].file).toBe('node.exe')
  expect(() => verifyNodeArchive(Buffer.alloc(0), 'linux-x64')).toThrow(
    'plugin-node-unsupported-target',
  )
})
it('packages Node and the guardian on Mac and Windows through explicit build steps, never an install hook', () => {
  const file = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8'))
  for (const name of ['package', 'package:mac-beta', 'package:win'])
    expect(file.scripts[name]).toContain('prepare-plugin-node.mjs &&')
  expect(file.scripts.postinstall).not.toContain('prepare-plugin-node')
  const config = readFileSync('apps/desktop/electron-builder.yml', 'utf8')
  expect(config).toContain('beforePack: ./build/before-pack.cjs')
  expect(config).toContain('from: resources/plugin-node')
  expect(config).toContain('from: resources/plugin-host')
  expect(config).toContain("'plugin-node/node$'")
})

it('the in-app hook delegates to the shared build-time implementation', () => {
  const require = createRequire(import.meta.url)
  expect(require('../../apps/desktop/build/before-pack.cjs')).toBe(
    require('../prepare-plugin-node-before-pack.cjs'),
  )
})
