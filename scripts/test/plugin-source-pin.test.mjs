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
function fixture({ shared = false, id = 'chrome' } = {}) {
  const base = fs.mkdtempSync(path.join(tmpdir(), 'fictional-source-pin-'))
  folders.push(base)
  const canonicalRoot = path.join(base, 'canonical')
  const root = path.join(base, 'export')
  for (const leaf of ['src/tool.js', 'ui/index.html', 'test/old.test.ts', 'build.mjs']) {
    const file = path.join(canonicalRoot, 'plugins', id, leaf)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'fictional source: ' + leaf)
  }
  if (shared) {
    fs.mkdirSync(path.join(canonicalRoot, 'plugins/shared'), { recursive: true })
    if (shared === 'blob')
      fs.writeFileSync(path.join(canonicalRoot, 'plugins/shared/ui'), 'fictional non-tree input')
    else {
      fs.mkdirSync(path.join(canonicalRoot, 'plugins/shared/ui'))
      fs.writeFileSync(path.join(canonicalRoot, 'plugins/shared/ui/load.js'), 'fictional shared UI')
    }
  }
  const sourceCommit = commit(canonicalRoot, 'https://github.com/brocrew/brocrew.git')
  copyPluginSource(canonicalRoot, root, id)
  fs.writeFileSync(
    path.join(root, 'README.md'),
    'Fictional export tooling outside the plugin subtree',
  )
  commit(root, `https://github.com/brocrew/brocrew-plugin-${id}.git`)
  return { base, root, canonicalRoot, sourceCommit, id }
}

it.each(['chrome', 'whatsapp'])('exports and pins shared UI for %s standalone builds', (id) => {
  const options = fixture({ shared: true, id })
  expect(fs.readFileSync(path.join(options.root, 'plugins/shared/ui/load.js'), 'utf8')).toBe(
    'fictional shared UI',
  )
  expect(verifyPluginSource(options).sharedUiTree).toBe(
    git(options.canonicalRoot, 'rev-parse', 'HEAD:plugins/shared/ui'),
  )
})

it.each(['changed', 'missing', 'extra ignored'])(
  'refuses %s shared UI in an exported build',
  (change) => {
    const options = fixture({ shared: true })
    const folder = path.join(options.root, 'plugins/shared/ui')
    // Supply the expected files separately so this also checks verification if copying breaks.
    fs.cpSync(path.join(options.canonicalRoot, 'plugins/shared/ui'), folder, { recursive: true })
    const file = path.join(folder, 'load.js')
    if (change === 'changed') fs.writeFileSync(file, 'fictional changed bytes')
    else if (change === 'missing') fs.unlinkSync(file)
    else fs.writeFileSync(path.join(folder, '.DS_Store'), 'fictional ignored bytes')
    expect(() => verifyPluginSource(options)).toThrow(/differs? from the canonical tree/)
  },
)

it.each(['plugins', 'plugins/shared', 'plugins/shared/ui'])(
  'refuses a linked shared source ancestor at %s',
  (linkedPath) => {
    const options = fixture({ shared: true })
    fs.cpSync(
      path.join(options.canonicalRoot, 'plugins/shared/ui'),
      path.join(options.root, 'plugins/shared/ui'),
      { recursive: true },
    )
    const linked = path.join(options.root, linkedPath)
    const moved = path.join(options.base, 'moved-shared-source')
    fs.renameSync(linked, moved)
    fs.symlinkSync(moved, linked, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => verifyPluginSource(options)).toThrow(/linked/i)
  },
)

it('refuses a linked child and does not exempt dependencies inside shared UI', () => {
  for (const linked of [true, false]) {
    const options = fixture({ shared: true })
    const folder = path.join(options.root, 'plugins/shared/ui')
    fs.cpSync(path.join(options.canonicalRoot, 'plugins/shared/ui'), folder, { recursive: true })
    const dependency = path.join(folder, 'node_modules')
    if (linked) {
      const outside = path.join(options.base, 'outside-shared-ui')
      fs.mkdirSync(outside)
      fs.symlinkSync(outside, dependency, process.platform === 'win32' ? 'junction' : 'dir')
    } else {
      fs.mkdirSync(dependency)
      fs.writeFileSync(path.join(dependency, 'extra.js'), 'fictional extra dependency')
    }
    expect(() => verifyPluginSource(options)).toThrow(
      linked ? /linked/i : /differs? from the canonical tree/,
    )
  }
})

it.each(['plugins/shared', 'plugins/shared/ui'])(
  'does not copy from a linked canonical shared source at %s',
  (linkedPath) => {
    const options = fixture({ shared: true })
    const linked = path.join(options.canonicalRoot, linkedPath)
    const moved = path.join(options.base, 'moved-canonical-shared-source')
    fs.renameSync(linked, moved)
    fs.symlinkSync(moved, linked, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() =>
      copyPluginSource(options.canonicalRoot, path.join(options.base, 'new-export'), options.id),
    ).toThrow(/linked/i)
  },
)

it('keeps legacy pinned sources without a shared UI tree valid', () => {
  const options = fixture()
  expect(verifyPluginSource(options)).not.toHaveProperty('sharedUiTree')
  expect(fs.existsSync(path.join(options.root, 'plugins/shared/ui'))).toBe(false)
})

it('refuses a pinned non-tree common path instead of treating it as legacy absence', () => {
  expect(() => fixture({ shared: 'blob' })).toThrow(/shared.*tree/i)
})

it.each(['canonical', 'export'])(
  'checks missing, changed and ignored common inputs in the %s build root',
  (buildRoot) => {
    for (const change of ['changed', 'missing directory', 'ignored dependency']) {
      const options = fixture({ shared: true })
      fs.cpSync(
        path.join(options.canonicalRoot, 'plugins/shared/ui'),
        path.join(options.root, 'plugins/shared/ui'),
        { recursive: true },
      )
      const root = buildRoot === 'canonical' ? options.canonicalRoot : options.root
      const folder = path.join(root, 'plugins/shared/ui')
      if (change === 'changed') fs.writeFileSync(path.join(folder, 'load.js'), 'changed input')
      else if (change === 'missing directory') fs.rmSync(folder, { recursive: true })
      else {
        fs.mkdirSync(path.join(folder, 'node_modules'))
        fs.writeFileSync(path.join(folder, 'node_modules/extra.js'), 'ignored input')
      }
      expect(() => verifyPluginSource({ ...options, root })).toThrow()
    }
  },
)

it.skipIf(process.platform === 'win32').each(['canonical', 'export'])(
  'refuses executable-mode changes and linked common files in the %s build root',
  (buildRoot) => {
    for (const linked of [true, false]) {
      const options = fixture({ shared: true })
      fs.cpSync(
        path.join(options.canonicalRoot, 'plugins/shared/ui'),
        path.join(options.root, 'plugins/shared/ui'),
        { recursive: true },
      )
      const root = buildRoot === 'canonical' ? options.canonicalRoot : options.root
      const file = path.join(root, 'plugins/shared/ui/load.js')
      if (linked) {
        const moved = path.join(options.base, 'moved-common-file.js')
        fs.renameSync(file, moved)
        fs.symlinkSync(moved, file)
      } else fs.chmodSync(file, 0o755)
      expect(() => verifyPluginSource({ ...options, root })).toThrow(linked ? /linked/i : /mode/i)
    }
  },
)

it('does not inject current local common files into a legacy source pin', () => {
  const options = fixture()
  fs.mkdirSync(path.join(options.root, 'plugins/shared/ui'), { recursive: true })
  fs.writeFileSync(path.join(options.root, 'plugins/shared/ui/extra.js'), 'unverified common input')
  expect(() => verifyPluginSource(options)).toThrow(/differs? from the canonical tree/)
})

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

it.each([
  ['chrome', '0.1.35'],
  ['whatsapp', '0.1.34'],
])('binds %s sharedData archives to paired host %s', async (id, minimum) => {
  for (const sharedData of [true, false]) {
    const options = fixture()
    const out = path.join(options.base, 'shared-' + sharedData)
    const entry = await assemblePluginRelease({
      id,
      out,
      proof: verifyPluginSource(options),
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
