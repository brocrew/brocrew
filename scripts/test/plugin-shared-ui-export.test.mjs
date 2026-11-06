import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { exportChromePlugin } from '../export-chrome-plugin.mjs'
import { exportWhatsAppPlugin } from '../export-whatsapp-plugin.mjs'
import { verifyPluginSource } from '../plugin-source.mjs'
import { assemblePluginRelease } from '../build-plugin-release.mjs'
import { inventory, tar } from '../../apps/desktop/test/plugin-package-fixtures'
import { readPluginArchive } from '../../apps/desktop/src/main/plugins/package-archive'

const repository = fileURLToPath(new URL('../..', import.meta.url))
const commonFiles = ['settings-load-state.css', 'settings-load-state.js']
const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
function canonicalSource(base, sourceCommit) {
  const root = path.join(base, 'canonical')
  fs.mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'remote', 'add', 'origin', 'https://github.com/brocrew/brocrew.git')
  const objects = path.resolve(repository, git(repository, 'rev-parse', '--git-path', 'objects'))
  fs.writeFileSync(path.join(root, '.git/objects/info/alternates'), objects + '\n')
  git(
    root,
    '-c',
    'core.autocrlf=true',
    'checkout',
    sourceCommit,
    '--',
    'plugins/chrome',
    'plugins/whatsapp',
    'plugins/shared/ui',
  )
  git(root, 'update-ref', 'HEAD', sourceCommit)
  return root
}

// This fixture builds only the UI source seam, never an installable plugin or its server.
function uiArchive(source, id) {
  return async (destination, sourceCommit, target) => {
    const template = JSON.parse(
      fs.readFileSync(path.join(source, `plugins/${id}/manifest-template.json`), 'utf8'),
    )
    const files = new Map()
    for (const asset of template.ui.assets) {
      const common = commonFiles.includes(path.posix.basename(asset.path))
      const from = common
        ? path.join(source, 'plugins/shared/ui', path.posix.basename(asset.path))
        : path.join(source, 'plugins', id, asset.path)
      files.set(asset.path, fs.readFileSync(from))
    }
    const html = files.get(template.ui.entry).toString('utf8')
    const references = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(
      (match) => match[1],
    )
    for (const relative of references) {
      expect(relative).not.toMatch(/^(?:\/|[a-z][a-z0-9+.-]*:)/i)
      expect(files.has(path.posix.join(path.posix.dirname(template.ui.entry), relative))).toBe(true)
    }
    for (const name of commonFiles) expect(references).toContain(name)
    const manifest = {
      uiSourceSeamProof: true,
      id,
      version: template.version,
      sourceCommit,
      platforms: [target],
      ui: template.ui,
      files: inventory(files),
    }
    const bytes = Buffer.from(JSON.stringify(manifest))
    fs.mkdirSync(path.join(destination, 'package'), { recursive: true })
    fs.writeFileSync(path.join(destination, 'package/plugin.json'), bytes)
    fs.writeFileSync(
      path.join(destination, `${id}.tar`),
      tar([
        ...[...files]
          .sort(([a], [b]) => a.localeCompare(b, 'en'))
          .map(([path, body]) => ({ path, body })),
        { path: 'plugin.json', body: bytes },
      ]),
    )
    return { version: template.version, authors: template.authors, manifestSha256: hash(bytes) }
  }
}
function record(root, remote) {
  git(root, 'init', '-q')
  git(root, 'remote', 'add', 'origin', remote)
  git(root, 'add', '.')
  git(
    root,
    '-c',
    'user.name=Fictional Builder',
    '-c',
    'user.email=builder@fictional.invalid',
    'commit',
    '-qm',
    'Record fictional source snapshot',
  )
  return git(root, 'rev-parse', 'HEAD')
}

for (const [id, exportPlugin] of [
  ['chrome', exportChromePlugin],
  ['whatsapp', exportWhatsAppPlugin],
]) {
  it(`${id} real export preserves UI archive parity and rejects dirty common workflow inputs`, async () => {
    const base = fs.mkdtempSync(path.join(tmpdir(), 'fictional-common-export-'))
    folders.push(base)
    const root = path.join(base, 'export')
    exportPlugin(root)
    const common = path.join(root, 'plugins/shared/ui')
    expect(fs.readdirSync(common).sort()).toEqual(commonFiles)
    expect(fs.readdirSync(path.join(root, 'plugins/shared'))).toEqual(['ui'])
    expect(fs.existsSync(path.join(root, 'plugins', id === 'chrome' ? 'whatsapp' : 'chrome'))).toBe(
      false,
    )
    for (const name of commonFiles) {
      const original = path.join(repository, 'plugins/shared/ui', name)
      const exported = path.join(common, name)
      expect(fs.readFileSync(exported)).toEqual(fs.readFileSync(original))
      if (process.platform !== 'win32')
        expect(fs.statSync(exported).mode & 0o111).toBe(fs.statSync(original).mode & 0o111)
    }
    const sourceCommit = git(repository, 'rev-parse', 'HEAD')
    const canonicalRoot = canonicalSource(base, sourceCommit)
    record(root, `https://github.com/brocrew/brocrew-plugin-${id}.git`)
    const options = { root, canonicalRoot, id, sourceCommit }
    const proof = verifyPluginSource(options)
    expect(proof.sharedUiTree).toBe(git(repository, 'rev-parse', 'HEAD:plugins/shared/ui'))
    expect(proof.sourceTree).toBe(git(repository, 'rev-parse', `HEAD:plugins/${id}`))
    expect(proof.exportCommit).toBe(git(root, 'rev-parse', 'HEAD'))
    expect(proof.sourceCommit).toBe(sourceCommit)

    const target = { os: 'darwin', cpu: 'arm64' }
    const name = `${id}-${target.os}-${target.cpu}`
    for (const [label, source] of [
      ['canonical-output', canonicalRoot],
      ['export-output', root],
    ]) {
      const checked = verifyPluginSource({ ...options, root: source })
      const out = path.join(base, label)
      await assemblePluginRelease({
        id,
        out,
        proof: checked,
        targets: [target],
        buildPackage: uiArchive(source, id),
      })
      verifyPluginSource({ ...options, root: source })
      const archive = readPluginArchive(fs.readFileSync(path.join(out, name + '.tar.gz')), 'tar.gz')
      const manifest = JSON.parse(archive.get('plugin.json').toString('utf8'))
      expect([...archive.keys()].sort()).toEqual(
        [...manifest.files.map((file) => file.path), 'plugin.json'].sort(),
      )
      for (const file of manifest.files) {
        expect(archive.get(file.path).length).toBe(file.size)
        expect(hash(archive.get(file.path))).toBe(file.sha256)
      }
      for (const asset of manifest.ui.assets) expect(archive.has(asset.path)).toBe(true)
      const receipt = JSON.parse(fs.readFileSync(path.join(out, 'source-receipt.json'), 'utf8'))
      expect(receipt.sourceCommit).toBe(sourceCommit)
      expect(receipt.sourceTree).toBe(proof.sourceTree)
      expect(receipt.sharedUiTree).toBe(proof.sharedUiTree)
      expect(receipt.exportCommit).toBe(source === canonicalRoot ? null : proof.exportCommit)
      expect(receipt.buildCommit).toBe(source === canonicalRoot ? sourceCommit : proof.exportCommit)
    }
    for (const file of [name + '.tar.gz', 'plugin-list-entry.json', `${name}/package/plugin.json`])
      expect(fs.readFileSync(path.join(base, 'canonical-output', file))).toEqual(
        fs.readFileSync(path.join(base, 'export-output', file)),
      )

    const workflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
    const guards = workflow.split('\n').filter((line) => line.includes('git status --porcelain'))
    expect(guards).toHaveLength(2)
    fs.writeFileSync(path.join(common, 'generated.log'), 'fictional ignored source')
    for (const guard of guards) {
      const paths = guard.match(/--ignored=matching -- (.*?)\)"/)[1].split(/\s+/)
      expect(
        git(
          root,
          'status',
          '--porcelain',
          '--untracked-files=all',
          '--ignored=matching',
          '--',
          ...paths,
        ),
      ).toContain('plugins/shared/ui/generated.log')
    }
    expect(() => verifyPluginSource(options)).toThrow(/differs? from the canonical tree/)
  }, 30_000)
}
