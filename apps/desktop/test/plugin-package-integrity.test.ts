import { describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { parsePluginCatalogue, parsePluginManifest } from '../src/main/plugins/package-schema'
import { readPluginArchive } from '../src/main/plugins/package-archive'
import { pluginSha256, PLUGIN_LIMITS } from '../src/main/plugins/package-digests'
import { createPluginVerifier } from '../src/main/plugins/package-verifier'
import { PluginVerificationError } from '../src/main/plugins/verification-error'
import {
  fictionalPublicKey,
  inventory,
  manifestFor,
  packageFixture,
  payload,
  signed,
  tar,
  tarChecksum,
  verified,
  verifier,
} from './plugin-package-fixtures'

const json = (value: unknown) => Buffer.from(JSON.stringify(value))
describe('signed catalogue and immutable releases', () => {
  it.each(['tar', 'tar.gz'] as const)(
    'verifies an inert %s package, including the server, skill, service and UI inventory',
    (compression) => {
      const fixture = packageFixture({ compression })
      const result = verified(fixture)
      expect(result.manifest.id).toBe('fictional-bakery')
      expect(result.compatibility).toEqual({ host: true, tools: true, ui: true })
      expect(result.filePaths).toHaveLength(5)
      expect(result.readFile('dist/recipe.mjs')).toEqual(
        Uint8Array.from(fixture.files.get('dist/recipe.mjs')!),
      )
      expect(result.readFile('missing')).toBeUndefined()
    },
  )
  it('accepts an older correctly signed catalogue but refuses different bytes for a pinned release', () => {
    const fixture = packageFixture()
    const verify = verifier()
    const first = verify.verifyCatalogue(fixture.bytes, fixture.signature)
    const empty = signed({ format: 1, entries: [] })
    expect(verify.verifyCatalogue(empty.bytes, empty.signature).entries).toEqual([])
    expect(() => verify.verifyCatalogue(fixture.bytes, fixture.signature)).not.toThrow()
    const changed = signed({
      format: 1,
      entries: [
        { ...fixture.release, archive: { ...fixture.release.archive, sha256: 'b'.repeat(64) } },
      ],
    })
    expect(() => verify.verifyCatalogue(changed.bytes, changed.signature)).toThrow(
      expect.objectContaining({ code: 'immutable-release' }),
    )
    const restarted = createPluginVerifier({
      pinnedPublicKey: fictionalPublicKey,
      target: { os: 'linux', cpu: 'x64' },
      knownReleases: first.pins,
    })
    expect(() => restarted.verifyCatalogue(changed.bytes, changed.signature)).toThrow(
      PluginVerificationError,
    )
  })
  it('rejects a changed manifest digest for the same release and does not poison pins on a refused catalogue', () => {
    const fixture = packageFixture()
    const verify = verifier()
    verify.verifyCatalogue(fixture.bytes, fixture.signature)
    const changed = signed({
      format: 1,
      entries: [{ ...fixture.release, manifestSha256: 'b'.repeat(64) }],
    })
    expect(() => verify.verifyCatalogue(changed.bytes, changed.signature)).toThrow(
      PluginVerificationError,
    )
    expect(() => verify.verifyCatalogue(fixture.bytes, fixture.signature)).not.toThrow()
  })
  it('does not expose mutable trusted descriptors or verified bytes', () => {
    const fixture = packageFixture()
    const catalogue = verifier().verifyCatalogue(fixture.bytes, fixture.signature)
    expect(() => {
      catalogue.entries[0]!.archive.sha256 = 'b'.repeat(64)
    }).toThrow(TypeError)
    const result = catalogue.verifyPackage(
      fixture.release.id,
      fixture.release.version,
      fixture.archive,
    )
    const body = result.readFile('dist/recipe.mjs')!
    body.fill(0)
    expect(result.readFile('dist/recipe.mjs')).not.toEqual(body)
    fixture.archive.fill(0)
    expect(result.readFile('dist/recipe.mjs')).toEqual(
      Uint8Array.from(fixture.files.get('dist/recipe.mjs')!),
    )
  })
  it('verifies the downloaded archive before attempting gzip decode', () => {
    const fixture = packageFixture({ compression: 'tar.gz' })
    fixture.archive[0] = 0
    expect(() => verified(fixture)).toThrow(expect.objectContaining({ code: 'digest' }))
  })
  it('refuses a signed descriptor for another OS/CPU without decoding its archive', () => {
    const fixture = packageFixture()
    const catalogue = createPluginVerifier({
      pinnedPublicKey: fictionalPublicKey,
      target: { os: 'darwin', cpu: 'x64' },
    }).verifyCatalogue(fixture.bytes, fixture.signature)
    expect(() =>
      catalogue.verifyPackage(fixture.release.id, fixture.release.version, fixture.archive),
    ).toThrow(expect.objectContaining({ code: 'target' }))
  })
  it('refuses a package without a signed release descriptor', () => {
    const fixture = packageFixture()
    expect(() =>
      verifier()
        .verifyCatalogue(fixture.bytes, fixture.signature)
        .verifyPackage('different', '1.0', fixture.archive),
    ).toThrow(PluginVerificationError)
  })
  it('checks manifest identity against the signed descriptor', () => {
    const fixture = packageFixture()
    const wrong = signed({ format: 1, entries: [{ ...fixture.release, id: 'different' }] })
    expect(() =>
      verifier()
        .verifyCatalogue(wrong.bytes, wrong.signature)
        .verifyPackage('different', fixture.release.version, fixture.archive),
    ).toThrow(PluginVerificationError)
  })
})

describe('strict catalogue and manifest profiles', () => {
  it.each([
    (value: ReturnType<typeof packageFixture>['catalogue']) => ({ ...value, format: 2 }),
    (value: ReturnType<typeof packageFixture>['catalogue']) => ({ ...value, key: 'untrusted' }),
    (value: ReturnType<typeof packageFixture>['catalogue']) => ({
      ...value,
      entries: [value.entries[0], value.entries[0]],
    }),
    (value: ReturnType<typeof packageFixture>['catalogue']) => ({
      ...value,
      entries: Array(201).fill(value.entries[0]),
    }),
    (value: ReturnType<typeof packageFixture>['catalogue']) => ({
      ...value,
      entries: [
        {
          ...value.entries[0],
          archive: { ...value.entries[0]!.archive, url: 'http://example.invalid/a' },
        },
      ],
    }),
    (value: ReturnType<typeof packageFixture>['catalogue']) => ({
      ...value,
      entries: [
        {
          ...value.entries[0],
          archive: { ...value.entries[0]!.archive, url: 'https://name:secret@example.invalid/a' },
        },
      ],
    }),
    (value: ReturnType<typeof packageFixture>['catalogue']) => ({
      ...value,
      entries: [
        {
          ...value.entries[0],
          archive: { ...value.entries[0]!.archive, size: PLUGIN_LIMITS.archiveBytes + 1 },
        },
      ],
    }),
  ])('rejects malformed catalogue envelope %#', (mutate) => {
    expect(() => parsePluginCatalogue(json(mutate(packageFixture().catalogue)))).toThrow(
      PluginVerificationError,
    )
  })
  it.each([
    (value: ReturnType<typeof manifestFor>) => ({ ...value, id: 'Upper' }),
    (value: ReturnType<typeof manifestFor>) => ({ ...value, version: 'x'.repeat(81) }),
    (value: ReturnType<typeof manifestFor>) => ({ ...value, sourceCommit: 'main' }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      platforms: [{ os: 'linux', cpu: 'mips' }],
    }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      platforms: [value.platforms[0], value.platforms[0]],
    }),
    (value: ReturnType<typeof manifestFor>) => ({ ...value, toolApi: null }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      hostApi: { ...value.hostApi, minMinor: 2, maxMinor: 1 },
    }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      dataCompatibility: { minSchema: 2, maxSchema: 3 },
    }),
    (value: ReturnType<typeof manifestFor>) => ({ ...value, install: 'run shell' }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      server: { ...value.server, command: 'node' },
    }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      server: { ...value.server, mcpPath: 'http://127.0.0.1/mcp' },
    }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      files: [
        ...value.files,
        { path: 'plugin.json', type: 'file', size: 0, sha256: 'a'.repeat(64) },
      ],
    }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      files: [...value.files, { ...value.files[0], path: 'Dist/other.js' }],
    }),
    (value: ReturnType<typeof manifestFor>) => ({ ...value, files: value.files.slice(1) }),
    (value: ReturnType<typeof manifestFor>) => ({
      ...value,
      ui: {
        ...value.ui,
        methodSchemas: {
          ...value.ui!.methodSchemas,
          read: { $ref: 'https://example.invalid/schema' },
        },
      },
    }),
  ])('rejects invalid manifest fields or references %#', (mutate) => {
    expect(() => parsePluginManifest(json(mutate(manifestFor())))).toThrow(PluginVerificationError)
  })
  it('disables only the incompatible API surface, preserving the verified package', () => {
    const manifest = manifestFor()
    manifest.toolApi!.requiredFeatures = ['future-feature']
    expect(verified(packageFixture({ manifest })).compatibility).toEqual({
      host: true,
      tools: false,
      ui: true,
    })
    manifest.toolApi!.requiredFeatures = []
    manifest.uiApi!.major = 2
    expect(verified(packageFixture({ manifest })).compatibility).toEqual({
      host: true,
      tools: true,
      ui: false,
    })
    manifest.hostApi.maxMinor = 0
    manifest.hostApi.major = 2
    expect(verified(packageFixture({ manifest })).compatibility).toEqual({
      host: false,
      tools: false,
      ui: false,
    })
  })
  it('accepts skills-only packages with explicit absent server and UI APIs', () => {
    const manifest = manifestFor()
    manifest.server = null
    manifest.toolApi = null
    manifest.ui = null
    manifest.uiApi = null
    expect(verified(packageFixture({ manifest })).compatibility).toEqual({
      host: true,
      tools: false,
      ui: false,
    })
  })

  it('enforces the exact metadata byte caps before parsing', () => {
    expect(() => parsePluginCatalogue(Buffer.alloc(PLUGIN_LIMITS.catalogueBytes + 1, 32))).toThrow(
      expect.objectContaining({ code: 'limit' }),
    )
    expect(() => parsePluginManifest(Buffer.alloc(PLUGIN_LIMITS.manifestBytes + 1, 32))).toThrow(
      expect.objectContaining({ code: 'limit' }),
    )
  })

  it.each([
    { type: 'object', properties: {}, additionalProperties: false, required: ['absent'] },
    { type: 'object', properties: {}, additionalProperties: true },
    { type: 'array', items: { type: 'boolean' } },
    { type: 'string' },
    { type: 'integer', minimum: 2, maximum: 1 },
    { type: 'integer', enum: [1.5] },
    { type: 'boolean', maxLength: 3 },
    { type: 'string', maxLength: 4, enum: [true] },
  ])('refuses an ambiguous or unbounded RPC value schema %j', (schema) => {
    const manifest = manifestFor()
    const value = {
      ...manifest,
      ui: { ...manifest.ui, methodSchemas: { ...manifest.ui!.methodSchemas, read: schema } },
    }
    expect(() => parsePluginManifest(json(value))).toThrow(PluginVerificationError)
  })

  it('bounds schema depth and accepts a typed bounded method payload', () => {
    const manifest = manifestFor()
    manifest.ui!.methodSchemas.proposeConfig = {
      type: 'object',
      additionalProperties: false,
      required: ['recipe'],
      properties: { recipe: { type: 'string', maxLength: 128 } },
    }
    expect(() => parsePluginManifest(json(manifest))).not.toThrow()
    let schema = manifest.ui!.methodSchemas.read
    for (let index = 0; index < 18; index++) schema = { type: 'array', maxItems: 1, items: schema }
    manifest.ui!.methodSchemas.read = schema
    expect(() => parsePluginManifest(json(manifest))).toThrow(
      expect.objectContaining({ code: 'limit' }),
    )
  })
})

describe('ASCII package namespace in manifest and archive', () => {
  it.each([
    ['dotted-I filenames', ['\u0130.mjs', 'i\u0307.mjs']],
    ['sharp-S filenames', ['\u00df.mjs', '\u1e9e.mjs']],
    ['dotted-I parents', ['\u0130/first.mjs', 'i\u0307/second.mjs']],
    ['sharp-S parents', ['\u00df/first.mjs', '\u1e9e/second.mjs']],
    ['reserved basename', ['dist/CON.mjs', 'dist/allowed.mjs']],
    ['ASCII case filenames', ['dist/recipe.mjs', 'dist/RECIPE.mjs']],
    ['ASCII case parents', ['Store/first.mjs', 'store/second.mjs']],
    ['leading dot', ['dist/.hidden', 'dist/visible']],
    ['plus sign', ['node_modules/fictional+recipe/index.mjs', 'dist/visible']],
  ] as const)('refuses %s in both inventories', (_label, paths) => {
    const files = payload()
    paths.forEach((path, index) => files.set(path, Buffer.from(`distinct inert payload ${index}`)))
    expect(() => parsePluginManifest(Buffer.from(JSON.stringify(manifestFor(files))))).toThrow(
      expect.objectContaining({ code: 'path' }),
    )
    const archive = tar(
      paths.map((path, index) => ({ path, body: Buffer.from(`distinct inert payload ${index}`) })),
    )
    expect(() => readPluginArchive(archive, 'tar')).toThrow(
      expect.objectContaining({ code: 'path' }),
    )
  })

  it.each(['\u0130.mjs', 'i\u0307.mjs', '\u00df.mjs', '\u1e9e.mjs'])(
    'refuses even an isolated non-ASCII component %s',
    (path) => {
      const files = payload()
      files.set(path, Buffer.from('inert'))
      expect(() => parsePluginManifest(Buffer.from(JSON.stringify(manifestFor(files))))).toThrow(
        expect.objectContaining({ code: 'path' }),
      )
      expect(() => readPluginArchive(tar([{ path, body: Buffer.from('inert') }]), 'tar')).toThrow(
        expect.objectContaining({ code: 'path' }),
      )
    },
  )

  it('keeps distinct ASCII names and scoped dependencies distinct with their exact bytes', () => {
    const files = payload()
    files.set('node_modules/@fictional/recipe/index.mjs', Buffer.from('first inert module'))
    files.set('node_modules/@fictional/recipes/index.mjs', Buffer.from('second inert module'))
    const result = verified(packageFixture({ files }))
    for (const [path, body] of files) expect(result.readFile(path)).toEqual(Uint8Array.from(body))
  })
})

describe('bounded archive extraction without filesystem effects', () => {
  it.each(['1', '2', '3', '4', '6', '7', 'x', 'g', 'L', 'K', 'S'])(
    'refuses links and non-USTAR extensions (%s)',
    (type) => {
      expect(() =>
        readPluginArchive(tar([{ path: 'unsafe', type, link: 'outside' }]), 'tar'),
      ).toThrow(PluginVerificationError)
    },
  )
  it.each(['../escape', '/escape', 'C:/escape', 'a:stream', 'NUL', 'a\\escape', 'e\u0301'])(
    'refuses an archive path %s',
    (path) => {
      expect(() => readPluginArchive(tar([{ path }]), 'tar')).toThrow(PluginVerificationError)
    },
  )
  it('checks USTAR prefixes, directories, case aliases and duplicate entries', () => {
    expect([
      ...readPluginArchive(
        tar([
          { path: 'dist/', type: '5' },
          { path: 'recipe.mjs', prefix: 'dist', body: Buffer.from('inert') },
        ]),
        'tar',
      ).keys(),
    ]).toEqual(['dist/recipe.mjs'])
    for (const entries of [
      [{ path: 'escape', prefix: '..' }],
      [{ path: 'dist', type: '5' }, { path: 'Dist/file' }],
      [{ path: 'file' }, { path: 'file' }],
      [{ path: 'parent' }, { path: 'parent/file' }],
      [{ path: 'directory', type: '5', body: Buffer.from('invalid') }],
    ])
      expect(() => readPluginArchive(tar(entries), 'tar')).toThrow(PluginVerificationError)
  })
  it('refuses damaged headers, base-256 sizes, set-id modes and nonzero padding', () => {
    const original = tar([{ path: 'recipe', body: Buffer.from('inert') }])
    for (const change of [
      (bytes: Buffer) => {
        bytes[0] = 33
      },
      (bytes: Buffer) => {
        bytes[124] = 128
        tarChecksum(bytes.subarray(0, 512))
      },
      (bytes: Buffer) => {
        bytes.write('000 0000001\0', 124)
        tarChecksum(bytes.subarray(0, 512))
      },
      (bytes: Buffer) => {
        bytes.write('0004755\0', 100)
        tarChecksum(bytes.subarray(0, 512))
      },
      (bytes: Buffer) => {
        bytes[530] = 1
      },
      (bytes: Buffer) => {
        bytes[500] = 1
        tarChecksum(bytes.subarray(0, 512))
      },
    ]) {
      const bytes = Buffer.from(original)
      change(bytes)
      expect(() => readPluginArchive(bytes, 'tar')).toThrow(PluginVerificationError)
    }
  })
  it('requires two end blocks and refuses an appended archive', () => {
    expect(() => readPluginArchive(tar([]).subarray(512), 'tar')).toThrow(PluginVerificationError)
    expect(() =>
      readPluginArchive(Buffer.concat([tar([]), tar([{ path: 'hidden' }])]), 'tar'),
    ).toThrow(PluginVerificationError)
  })

  it('refuses a filename BOM under the ASCII-only rule', () => {
    expect(() =>
      readPluginArchive(tar([{ path: '\ufeffplugin.json', body: Buffer.from('{}') }]), 'tar'),
    ).toThrow(expect.objectContaining({ code: 'path' }))
  })
  it('bounds header-declared expansion and entry counts before retaining payloads', () => {
    const huge = tar([{ path: 'huge' }])
    huge.write((PLUGIN_LIMITS.expandedBytes + 1).toString(8).padStart(11, '0') + '\0', 124)
    tarChecksum(huge.subarray(0, 512))
    expect(() => readPluginArchive(huge, 'tar')).toThrow(expect.objectContaining({ code: 'limit' }))
    const many = tar(
      Array.from({ length: 10001 }, (_, index) => ({ path: `folder${index}`, type: '5' })),
    )
    expect(() => readPluginArchive(many, 'tar')).toThrow(expect.objectContaining({ code: 'limit' }))
  })
  it('bounds gzip expansion by the 100:1 ratio', () => {
    const compressed = gzipSync(tar([{ path: 'huge', body: Buffer.alloc(1024 * 1024) }]))
    expect(compressed.length * PLUGIN_LIMITS.compressionRatio).toBeLessThan(1024 * 1024)
    expect(() => readPluginArchive(compressed, 'tar.gz')).toThrow(
      expect.objectContaining({ code: 'limit' }),
    )
    expect(() => readPluginArchive(Buffer.from('not gzip'), 'tar.gz')).toThrow(
      PluginVerificationError,
    )
  })
})

describe('payload inventory, install hooks and existing skill rules', () => {
  it('checks the manifest digest even when the archive digest is valid', () => {
    const fixture = packageFixture()
    const catalogue = signed({
      format: 1,
      entries: [{ ...fixture.release, manifestSha256: 'a'.repeat(64) }],
    })
    expect(() =>
      verifier()
        .verifyCatalogue(catalogue.bytes, catalogue.signature)
        .verifyPackage(fixture.release.id, fixture.release.version, fixture.archive),
    ).toThrow(expect.objectContaining({ code: 'digest' }))
  })
  it('rejects missing, unlisted and digest-mismatched payloads', () => {
    const files = payload()
    const manifest = manifestFor(files)
    files.set('dist/recipe.mjs', Buffer.from('different inert bytes'))
    expect(() => verified(packageFixture({ files, manifest }))).toThrow(
      expect.objectContaining({ code: 'digest' }),
    )
    files.delete('dist/recipe.mjs')
    expect(() => verified(packageFixture({ files, manifest }))).toThrow(PluginVerificationError)
    const extraFiles = payload()
    const pristineManifest = manifestFor(extraFiles)
    extraFiles.set('extra', Buffer.from('only an extra file; all original files remain'))
    expect(extraFiles.size).toBe(pristineManifest.files.length + 1)
    expect(pristineManifest.files.every((file) => extraFiles.has(file.path))).toBe(true)
    expect(() =>
      verified(packageFixture({ files: extraFiles, manifest: pristineManifest })),
    ).toThrow(expect.objectContaining({ code: 'digest' }))
  })
  it.each([
    ['node_modules/fictional/package.json', '{"scripts":{"postinstall":"do not run"}}'],
    ['package.json', '{"scripts":{"build":"do not run"}}'],
    ['package.json', '{"hooks":{}}'],
    ['package.json', '{"gypfile":true}'],
    ['binding.gyp', 'inert'],
    ['install.sh', 'inert'],
    ['setup.ps1', 'inert'],
    ['Makefile', 'inert'],
  ])('refuses an inventoried installation recipe %s', (path, content) => {
    const files = payload()
    files.set(path, Buffer.from(content))
    expect(() => verified(packageFixture({ files }))).toThrow(
      expect.objectContaining({ code: 'install-hook' }),
    )
  })
  it('accepts built dependency metadata without scripts, including an empty scripts object', () => {
    const files = payload()
    files.set(
      'node_modules/fictional/package.json',
      Buffer.from('{"name":"fictional","scripts":{}}'),
    )
    expect(() => verified(packageFixture({ files }))).not.toThrow()
  })
  it('refuses a skill whose verified bytes disagree with existing Skills frontmatter or metadata', () => {
    const files = payload()
    files.set(
      'bread/SKILL.md',
      Buffer.from('---\nname: different\ndescription: A fictional bread skill.\n---\nInert.'),
    )
    expect(() => verified(packageFixture({ files }))).toThrow(PluginVerificationError)
    const manifest = manifestFor(payload())
    manifest.skills[0]!.path = 'ui/index.html'
    expect(() => verified(packageFixture({ manifest }))).toThrow(PluginVerificationError)
  })

  it('keeps the Skills NUL, UTF-8 and byte-size checks', () => {
    const manifest = manifestFor()
    manifest.skills[0]!.reminder = 'invalid\0reminder'
    expect(() => verified(packageFixture({ manifest }))).toThrow(PluginVerificationError)
    for (const body of [Buffer.from([0xc0, 0xaf]), Buffer.alloc(65_537, 65)]) {
      const files = payload()
      files.set('bread/SKILL.md', body)
      expect(() => verified(packageFixture({ files }))).toThrow(PluginVerificationError)
    }
  })
  it('checks each file digest independently of an otherwise valid signed package', () => {
    const files = payload()
    const manifest = manifestFor(files)
    manifest.files = inventory(files)
    manifest.files[0]!.sha256 = 'b'.repeat(64)
    expect(() => verified(packageFixture({ files, manifest }))).toThrow(
      expect.objectContaining({ code: 'digest' }),
    )
    expect(pluginSha256(files.get('dist/recipe.mjs')!)).not.toBe('b'.repeat(64))
  })
})

describe('signed one-line catalogue descriptions', () => {
  it('keeps old catalogues valid and authenticates an optional purpose at its 240-character bound', () => {
    const fixture = packageFixture()
    expect(
      verifier().verifyCatalogue(fixture.bytes, fixture.signature).entries[0]?.description,
    ).toBeUndefined()
    const purpose = 'x'.repeat(240)
    const described = signed({ format: 1, entries: [{ ...fixture.release, description: purpose }] })
    expect(
      verifier().verifyCatalogue(described.bytes, described.signature).entries[0]?.description,
    ).toBe(purpose)
    const tampered = json({
      format: 1,
      entries: [{ ...fixture.release, description: 'Different fictional purpose.' }],
    })
    expect(() => verifier().verifyCatalogue(tampered, described.signature)).toThrow(
      PluginVerificationError,
    )
  })
  it.each([
    '',
    ' ',
    'x'.repeat(241),
    'two\nlines',
    'two\rlines',
    'two\u2028lines',
    'two\u2029lines',
    '\u0000',
    '\ud800',
    4,
  ])('refuses an invalid description %#', (description) => {
    const fixture = packageFixture()
    const catalogue = signed({ format: 1, entries: [{ ...fixture.release, description }] })
    expect(() => verifier().verifyCatalogue(catalogue.bytes, catalogue.signature)).toThrow(
      PluginVerificationError,
    )
  })
})
