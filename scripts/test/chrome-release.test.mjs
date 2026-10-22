import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRelease, chromeDescription, releaseCatalogue } from '../chrome-release.mjs'

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const commit = 'ab'.repeat(20)
const archive = Buffer.from('fictional archive')
const manifest = Buffer.from('{"id":"chrome"}')
const fixture = () => ({
  id: 'chrome',
  version: '0.1.0',
  sourceCommit: commit,
  platforms: [{ os: 'darwin', cpu: 'arm64' }],
  archive: {
    url: 'https://example.invalid/fixture.tar',
    size: archive.length,
    sha256: sha256(archive),
    compression: 'tar',
  },
  manifestSha256: sha256(manifest),
})
const url = 'https://releases.example.invalid/chrome/0.1.0/chrome.tar'
const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

describe('Chrome release builder', () => {
  it('keeps every build pin and adds only the approved description and supplied URL', () => {
    const original = fixture()
    const result = releaseCatalogue(original, archive, manifest, commit, url)
    expect(result).toEqual({
      format: 1,
      entries: [
        { ...original, description: chromeDescription, archive: { ...original.archive, url } },
      ],
    })
    expect(original.archive.url).toBe('https://example.invalid/fixture.tar')
  })
  it.each(['size', 'sha256'])('refuses a changed archive %s', (field) => {
    const changed = fixture()
    changed.archive[field] = field === 'size' ? archive.length + 1 : '00'.repeat(32)
    expect(() => releaseCatalogue(changed, archive, manifest, commit, url)).toThrow('metadata')
  })
  it('refuses a changed manifest, source commit or target', () => {
    expect(() =>
      releaseCatalogue(fixture(), archive, Buffer.from('changed'), commit, url),
    ).toThrow()
    expect(() => releaseCatalogue(fixture(), archive, manifest, 'cd'.repeat(20), url)).toThrow()
    const changed = fixture()
    changed.platforms = [{ os: 'linux', cpu: 'arm64' }]
    expect(() => releaseCatalogue(changed, archive, manifest, commit, url)).toThrow()
  })
  it.each([
    'http://releases.example.invalid/chrome.tar',
    'https://person:fictional@releases.example.invalid/chrome.tar',
    url + '#other',
  ])('refuses an unsuitable archive URL', (bad) => {
    expect(() => releaseCatalogue(fixture(), archive, manifest, commit, bad)).toThrow()
  })
  it('refuses a moving ref and leaves a nonempty destination untouched', async () => {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-chrome-release-'))
    folders.push(output)
    await expect(
      buildRelease({ commit: 'main', output, node: process.execPath, archiveUrl: url }),
    ).rejects.toThrow('full reviewed')
    fs.writeFileSync(path.join(output, 'keep.txt'), 'keep')
    await expect(
      buildRelease({ commit, output, node: process.execPath, archiveUrl: url }),
    ).rejects.toThrow('empty output')
    expect(fs.readFileSync(path.join(output, 'keep.txt'), 'utf8')).toBe('keep')
  })
  // The release signer requires a POSIX tty and owner/mode checks; it does not run on Windows.
  it.skipIf(process.platform === 'win32')(
    'signs only with scratch keys and refuses hash, passphrase and verification failures',
    () => {
      const result = spawnSync('python3', ['scripts/test/sign-plugin-catalogue.test.py'], {
        encoding: 'utf8',
        timeout: 30_000,
      })
      expect(result.stderr).toContain('OK')
      expect(result.status).toBe(0)
    },
  )
})
