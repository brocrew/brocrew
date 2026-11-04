import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import * as schema from '../src/main/plugins/package-schema'
import * as verifier from '../src/main/plugins/package-verifier'
import { pluginContributions, createContributionRegistry } from '../src/main/plugins/contributions'
import { pluginNodePolicy } from '../src/main/plugins/node-policy'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import {
  fictionalPublicKey,
  manifestFor,
  packageFixture,
  signed,
  tar,
  verified,
} from './plugin-package-fixtures'

const target = { os: 'linux', cpu: 'x64' } as const
const binding = { tool: 'bakery.choose_oven', arguments: { action: 'warm-oven' } }
const files = new Map([
  ['main.cjs', Buffer.from('// Inert fictional runtime.')],
  ['tools.json', Buffer.from(JSON.stringify({ tools: [] }))],
  ['configure.html', Buffer.from('<!doctype html><title>Fictional ovens</title>')],
  ['helper.sh', Buffer.from('# Inert fictional helper.')],
])
function genericManifest() {
  return {
    format: 3,
    id: 'fictional-oven',
    version: '1.0.0',
    name: 'Fictional oven',
    description: 'Choose a fictional oven.',
    authors: ['Fictional Baker'],
    platforms: [target],
    minAppVersion: '1.0.0',
    files: [...files].map(([path, bytes]) => ({
      path,
      bytes: bytes.length,
      sha256: pluginSha256(bytes),
    })),
    permissions: { description: 'Operate fictional ovens.', dataUses: ['Oven settings'] },
    runtime: { kind: 'node', entry: 'main.cjs', args: ['--fictional'] },
    mcp: { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    settings: {
      page: { entry: 'configure.html', assets: ['configure.html'] },
      fields: { type: 'object', properties: { oven: { type: 'string' } } },
    },
    ui: [
      {
        id: 'choose-oven',
        slot: 'composer.accessory',
        view: { label: 'Choose oven' },
        invoke: binding,
      },
    ],
    hooks: [{ id: 'future-hook', kind: 'fictional.future', api: 9, invoke: binding }],
    lifecycle: {
      stop: { signal: 'SIGTERM', graceMs: 500 },
      beforeRemove: binding,
      dataOnRemove: 'keep',
    },
    data: { schema: 4, compatibility: { minSchema: 1, maxSchema: 9 }, migrateOnStart: true },
  }
}
function fixture(manifest: unknown = genericManifest()) {
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  const archive = tar([
    { path: 'plugin.json', body: manifestBytes },
    ...[...files].map(([path, body]) => ({ path, body })),
  ])
  return {
    manifestBytes,
    archive,
    ref: { sha256: pluginSha256(archive), bytes: archive.length, compression: 'tar' as const },
  }
}
function check(manifest: unknown = genericManifest()) {
  const f = fixture(manifest)
  return verifier.verifyPluginPackage(f.archive, f.ref, { target, appVersion: '1.2.0' })
}

describe('generic package declarations', () => {
  it('parses a new plugin, tool and settings action without an app adapter', () => {
    const raw = genericManifest()
    expect(schema.parsePluginManifest(Buffer.from(JSON.stringify(raw)))).toEqual(raw)
    const checked = check(raw)
    const contributions = pluginContributions(checked)
    expect(contributions.runtime).toEqual(raw.runtime)
    expect(contributions.mcp).toEqual(raw.mcp)
    expect(contributions.settings).toEqual(raw.settings)
    expect(contributions.declarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'choose-oven',
          kind: 'ui.button',
          definition: expect.objectContaining({ invoke: binding }),
        }),
        expect.objectContaining({ id: 'future-hook', kind: 'fictional.future', supported: false }),
      ]),
    )
    const entry = createContributionRegistry().register(
      checked,
      {
        pluginId: raw.id,
        releaseDigest: verifier.verifiedPluginDigest(checked)!,
        installId: randomUUID(),
        incarnation: randomUUID(),
        runId: randomUUID(),
        workspaceId: randomUUID(),
        switchRevision: 0,
      },
      () => true,
    )
    expect(entry.current()).toBe(true)
    expect(entry.contributions.settings).toEqual(raw.settings)
  })
  it.each([
    { runtime: { kind: 'node', entry: 'main.cjs' }, mcp: { transport: 'stdio' } },
    {
      runtime: { kind: 'process', command: 'helper.sh', args: ['--fixture'] },
      mcp: { transport: 'streamable-http', bootstrap: 'ready-message' },
    },
  ])('preserves a declared runtime and MCP transport: %j', (transport) => {
    const raw = { ...genericManifest(), ...transport }
    const policy = pluginNodePolicy(check(raw))
    expect(policy.runtime).toEqual(raw.runtime)
    expect(policy.mcp).toEqual(raw.mcp)
    expect(policy).not.toHaveProperty('probe')
  })
  it('allows ordinary tools without a settings page, buttons or hooks', () => {
    const { settings: _settings, ui: _ui, hooks: _hooks, ...raw } = genericManifest()
    expect(pluginContributions(check(raw)).declarations).toEqual([])
  })
  it('treats packaged inventory as documentation rather than a tool allowlist', () => {
    // tools.json intentionally has no tools; runtime tools/list remains authoritative.
    expect(pluginContributions(check()).tools).toEqual(genericManifest().tools)
  })
  it('retains exact selected bytes and returns independent copies', () => {
    const f = fixture()
    const pkg = check()
    expect(pkg.readFile('plugin.json')).toEqual(Uint8Array.from(f.manifestBytes))
    const body = pkg.readFile('main.cjs')!
    body.fill(0)
    expect(pkg.readFile('main.cjs')).toEqual(Uint8Array.from(files.get('main.cjs')!))
    f.archive[512] = f.archive[512]! ^ 1
    expect(() =>
      verifier.verifyPluginPackage(f.archive, f.ref, { target, appVersion: '1.2.0' }),
    ).toThrow(expect.objectContaining({ code: 'digest' }))
  })
  it('checks platform and minimum application version for direct packages', () => {
    const f = fixture()
    for (const options of [
      { target: { os: 'darwin', cpu: 'x64' }, appVersion: '1.2.0' },
      { target, appVersion: '0.9.0' },
    ] as const)
      expect(() => verifier.verifyPluginPackage(f.archive, f.ref, options)).toThrow(
        expect.objectContaining({ code: 'target' }),
      )
  })
  it('checks the same minimum application version through direct and catalogue routes', () => {
    const raw = { ...genericManifest(), minAppVersion: '99.0.0' }
    const f = fixture(raw)
    const catalogue = signed({
      format: 2,
      entries: [
        {
          id: raw.id,
          version: raw.version,
          authors: ['fictional-baker'],
          sourceCommit: 'a'.repeat(40),
          platforms: raw.platforms,
          archive: {
            url: 'https://plugins.example.invalid/oven.tar',
            sha256: f.ref.sha256,
            size: f.ref.bytes,
            compression: 'tar',
          },
          manifestSha256: pluginSha256(f.manifestBytes),
        },
      ],
    })
    const fromCatalogue = (appVersion?: string) =>
      verifier
        .createPluginVerifier({
          pinnedPublicKey: fictionalPublicKey,
          target,
          appVersion,
        })
        .verifyCatalogue(catalogue.bytes, catalogue.signature)
        .verifyPackage(raw.id, raw.version, f.archive)
    for (const appVersion of ['98.9.9', undefined, 'unknown']) {
      expect(() =>
        verifier.verifyPluginPackage(f.archive, f.ref, {
          target,
          appVersion: appVersion as string,
        }),
      ).toThrow(expect.objectContaining({ code: 'target' }))
      expect(() => fromCatalogue(appVersion)).toThrow(expect.objectContaining({ code: 'target' }))
    }
    for (const appVersion of ['99.0.0', '100.0.0']) {
      expect(
        verifier
          .verifyPluginPackage(f.archive, f.ref, { target, appVersion })
          .readFile('plugin.json'),
      ).toEqual(Uint8Array.from(f.manifestBytes))
      expect(fromCatalogue(appVersion).readFile('plugin.json')).toEqual(
        Uint8Array.from(f.manifestBytes),
      )
    }
  })
  it.each([
    { runtime: { kind: 'node', entry: 'missing.cjs' } },
    { runtime: { kind: 'process', command: '/usr/bin/fictional-helper' } },
    { tools: { source: 'mcp', inventory: 'missing.json' } },
    { settings: { page: { entry: 'missing.html', assets: ['missing.html'] } } },
  ])('keeps declarations whose missing resources are later operation errors: %j', (change) => {
    expect(() => check({ ...genericManifest(), ...change })).not.toThrow()
  })
  it('preserves extension metadata, unknown contributions and plugin-owned data compatibility', () => {
    const raw = {
      ...genericManifest(),
      extension: { fictional: true },
      runtime: { kind: 'node', entry: 'main.cjs', vendorOption: true },
      data: { schema: 4, compatibility: { minSchema: 9, maxSchema: 1 } },
      ui: [genericManifest().ui[0], genericManifest().ui[0]],
    }
    expect(schema.parsePluginManifest(Buffer.from(JSON.stringify(raw)))).toEqual(raw)
    expect(pluginContributions(check(raw)).tools).toEqual(raw.tools)
  })
  it.each([1, 2])(
    'normalizes installed format %i without changing its manifest or payload bytes',
    (format) => {
      const raw = {
        ...manifestFor(),
        ...(format === 2
          ? {
              format: 2,
              authors: ['fictional-baker'],
              executor: { kind: 'node', entry: 'dist/recipe.mjs' },
              hooks: [],
            }
          : {}),
      }
      const f = packageFixture({ manifest: raw as ReturnType<typeof manifestFor> })
      const pkg = verified(f)
      const parsed = schema.parsePluginManifest(f.manifestBytes)
      expect(parsed).toEqual(raw)
      const normalized = schema.normalizePluginManifest(parsed)
      expect(normalized.runtime).toEqual({ kind: 'node', entry: 'dist/recipe.mjs' })
      expect(normalized.data.schema).toBe(raw.dataSchema)
      expect(pkg.readFile('plugin.json')).toEqual(Uint8Array.from(f.manifestBytes))
      for (const [path, bytes] of f.files)
        expect(pkg.readFile(path)).toEqual(Uint8Array.from(bytes))
    },
  )
})
