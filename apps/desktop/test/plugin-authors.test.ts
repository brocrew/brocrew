import { describe, expect, it } from 'vitest'
import { parsePluginManifest, parsePluginCatalogue } from '../src/main/plugins/package-schema'
import { parseRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { repoListFor } from './plugin-repo-list-fixtures'
import { manifestFor, packageFixture, signed, verifier } from './plugin-package-fixtures'

function modern() {
  const legacy = manifestFor()
  return {
    ...legacy,
    format: 2 as const,
    authors: ['brocrew'],
    executor: { kind: 'node' as const, entry: legacy.server!.entry },
    hooks: [],
  }
}
function check(authors = ['brocrew']) {
  const pkg = packageFixture({ manifest: modern() })
  const catalogue = signed({ format: 2, entries: [{ ...pkg.release, authors }] })
  return () =>
    verifier()
      .verifyCatalogue(catalogue.bytes, catalogue.signature)
      .verifyPackage(pkg.release.id, pkg.release.version, pkg.archive)
}
describe('declared package authors', () => {
  it('requires authors on every new manifest', () => {
    const { authors, ...manifest } = modern()
    void authors
    expect(() => parsePluginManifest(Buffer.from(JSON.stringify(manifest)))).toThrow()
  })
  it('requires authors on new catalogue releases', () => {
    const pkg = packageFixture({ manifest: modern() })
    const { authors, ...release } = pkg.release
    void authors
    expect(() =>
      parsePluginCatalogue(Buffer.from(JSON.stringify({ format: 2, entries: [release] }))),
    ).toThrow()
  })
  it.each(
    [[], ['brocrew', 'brocrew'], ['zulu', 'alpha'], ['Brocrew']].map((authors) => ({ authors })),
  )('refuses noncanonical authors $authors', ({ authors }) => {
    expect(() =>
      parsePluginManifest(Buffer.from(JSON.stringify({ ...modern(), authors }))),
    ).toThrow()
  })
  it('matches the exact declared authors before admitting archive bytes', () => {
    expect(check(['fictional-publisher'])).toThrow()
    expect(check()().manifest.authors).toEqual(['brocrew'])
  })
  it('rejects authorless v2 rows even when the release is filtered out by app version', () => {
    const list = { ...repoListFor(packageFixture().release), format: 2 }
    const entry = list.entries[0]!
    entry.minAppVersion = '99.0.0'
    expect(() =>
      parseRepoPluginList(Buffer.from(JSON.stringify(list)), { os: 'linux', cpu: 'x64' }, '1.0.0'),
    ).toThrow()
  })
  it('keeps exact legacy installed manifests readable without invented authors', () => {
    const manifest = manifestFor()
    expect(parsePluginManifest(Buffer.from(JSON.stringify(manifest)))).toEqual(manifest)
  })
})
