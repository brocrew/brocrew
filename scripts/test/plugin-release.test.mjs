import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { assemblePluginRelease } from '../build-plugin-release.mjs'

const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})
function fixture() {
  const base = fs.mkdtempSync(path.join(tmpdir(), 'fictional-plugin-release-'))
  folders.push(base)
  return { base, sourceCommit: 'a'.repeat(40) }
}

it('keeps legacy release metadata without authors while binding the current app', async () => {
  const options = fixture()
  await assemblePluginRelease({
    id: 'chrome',
    out: path.join(options.base, 'legacy'),
    sourceCommit: options.sourceCommit,
    targets: [{ os: 'darwin', cpu: 'arm64' }],
    buildPackage: async (destination) => {
      fs.mkdirSync(destination)
      fs.writeFileSync(path.join(destination, 'chrome.tar'), 'fictional legacy archive')
      return { version: '0.1.2', manifestSha256: 'a'.repeat(64) }
    },
  })
  const entry = JSON.parse(
    fs.readFileSync(path.join(options.base, 'legacy/plugin-list-entry.json'), 'utf8'),
  )
  expect(entry.version).toBe('0.1.2')
  expect(entry.minAppVersion).toBe('0.2.20')
  expect(entry).not.toHaveProperty('authors')
})

it.each([
  ['chrome', '0.2.20'],
  ['whatsapp', '0.2.20'],
])('binds %s sharedData archives to paired host %s', async (id, minimum) => {
  for (const sharedData of [true, false]) {
    const options = fixture()
    const out = path.join(options.base, 'shared-' + sharedData)
    const entry = await assemblePluginRelease({
      id,
      out,
      sourceCommit: options.sourceCommit,
      targets: [{ os: 'darwin', cpu: 'arm64' }],
      buildPackage: async (destination) => {
        fs.mkdirSync(path.join(destination, 'package'), { recursive: true })
        fs.writeFileSync(
          path.join(destination, 'package', 'plugin.json'),
          JSON.stringify({ sharedData }),
        )
        fs.writeFileSync(path.join(destination, `${id}.tar`), 'fictional shared archive')
        return { version: '0.2.0', authors: ['fictional'], manifestSha256: 'a'.repeat(64) }
      },
    })
    expect(entry.minAppVersion).toBe(minimum)
    expect(
      JSON.parse(fs.readFileSync(path.join(out, 'plugin-list-entry.json'), 'utf8')).minAppVersion,
    ).toBe(minimum)
  }
})
