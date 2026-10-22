import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { copyPluginSource, verifyPluginSource } from '../plugin-source.mjs'
import { assemblePluginRelease } from '../build-plugin-release.mjs'

const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
function commit(root, repository) {
  git(root, 'init', '-q')
  git(root, 'remote', 'add', 'origin', repository)
  git(root, 'add', '.')
  git(
    root,
    '-c',
    'user.name=Fictional Builder',
    '-c',
    'user.email=builder@fictional.invalid',
    'commit',
    '-qm',
    'Record fictional source',
  )
  return git(root, 'rev-parse', 'HEAD')
}
function fixture() {
  const base = fs.mkdtempSync(path.join(tmpdir(), 'fictional-source-pin-'))
  folders.push(base)
  const canonicalRoot = path.join(base, 'canonical')
  const root = path.join(base, 'export')
  for (const leaf of ['src/tool.js', 'ui/index.html', 'test/old.test.ts', 'build.mjs']) {
    const file = path.join(canonicalRoot, 'plugins/chrome', leaf)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'fictional source: ' + leaf)
  }
  const sourceCommit = commit(canonicalRoot, 'https://github.com/brocrew/brocrew.git')
  copyPluginSource(canonicalRoot, root, 'chrome')
  fs.writeFileSync(
    path.join(root, 'README.md'),
    'Fictional export tooling outside the plugin subtree',
  )
  commit(root, 'https://github.com/brocrew/brocrew-plugin-chrome.git')
  return { base, root, canonicalRoot, sourceCommit, id: 'chrome' }
}

it.each([undefined, '', 'main', 'a'.repeat(39)])(
  'refuses a missing or malformed explicit pin: %s',
  (sourceCommit) => {
    const options = fixture()
    expect(() => verifyPluginSource({ ...options, sourceCommit })).toThrow('explicit full monorepo')
  },
)
it('refuses a well-formed pin that is not the checked canonical revision', () => {
  const options = fixture()
  expect(() => verifyPluginSource({ ...options, sourceCommit: 'f'.repeat(40) })).toThrow(
    'does not match',
  )
})
it.each(['changed', 'missing', 'extra ignored'])(
  'refuses a %s exported plugin tree before building',
  (change) => {
    const options = fixture()
    const file = path.join(options.root, 'plugins/chrome/ui/index.html')
    if (change === 'changed') fs.writeFileSync(file, 'fictional changed bytes')
    else if (change === 'missing') fs.unlinkSync(file)
    else
      fs.writeFileSync(
        path.join(options.root, 'plugins/chrome/ui/.DS_Store'),
        'fictional ignored bytes',
      )
    expect(() => verifyPluginSource(options)).toThrow(/differs? from the canonical tree/)
  },
)
it('retains the canonical source pin and records the export revision separately', () => {
  const options = fixture()
  const proof = verifyPluginSource(options)
  expect(proof.sourceCommit).toBe(options.sourceCommit)
  expect(proof.exportCommit).toBe(git(options.root, 'rev-parse', 'HEAD'))
  expect(proof.exportCommit).not.toBe(proof.sourceCommit)
  expect(proof.sourceTree).toBe(git(options.canonicalRoot, 'rev-parse', 'HEAD:plugins/chrome'))
  expect(fs.readFileSync(path.join(options.root, 'plugins/chrome/test/old.test.ts'), 'utf8')).toBe(
    'fictional source: test/old.test.ts',
  )
})
it('makes identical archive and catalogue bytes for canonical and exported builds', async () => {
  const options = fixture()
  const exported = verifyPluginSource(options)
  const canonical = verifyPluginSource({ ...options, root: options.canonicalRoot })
  const fakeBuild = async (destination, sourceCommit, target) => {
    fs.mkdirSync(destination)
    const manifest = Buffer.from(JSON.stringify({ sourceCommit, target, authors: ['brocrew'] }))
    fs.writeFileSync(path.join(destination, 'chrome.tar'), manifest)
    return {
      version: '0.1.3',
      authors: ['brocrew'],
      manifestSha256: createHash('sha256').update(manifest).digest('hex'),
    }
  }
  for (const [name, proof] of [
    ['one', canonical],
    ['two', exported],
  ])
    await assemblePluginRelease({
      id: 'chrome',
      out: path.join(options.base, name),
      proof,
      targets: [{ os: 'darwin', cpu: 'arm64' }],
      buildPackage: fakeBuild,
    })
  for (const file of ['chrome-darwin-arm64.tar.gz', 'plugin-list-entry.json'])
    expect(fs.readFileSync(path.join(options.base, 'one', file))).toEqual(
      fs.readFileSync(path.join(options.base, 'two', file)),
    )
  const readReceipt = (name) =>
    JSON.parse(fs.readFileSync(path.join(options.base, name, 'source-receipt.json'), 'utf8'))
  expect(readReceipt('one').exportCommit).toBeNull()
  expect(readReceipt('two').exportCommit).toBe(exported.exportCommit)
})

it('keeps legacy release metadata unchanged without requiring author-bearing package sources', async () => {
  const options = fixture()
  const proof = verifyPluginSource(options)
  await assemblePluginRelease({
    id: 'chrome',
    out: path.join(options.base, 'legacy'),
    proof,
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
  expect(entry.minAppVersion).toBe('0.0.0')
  expect(entry).not.toHaveProperty('authors')
})
