import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { gzipSync } from 'node:zlib'
import {
  inspectPluginPackage,
  releasePackageRef,
  selectPluginPackage,
} from '../src/main/plugins/package-source'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { createRepoAwarePluginVerifier } from '../src/main/plugins/package-verifier'
import { settingsPeer } from './plugin-disclosure-fixtures'
import { PluginPackageVault } from '../src/main/plugins/lifecycle/vault'
import { parseRepoPluginList, loadRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { releaseDisclosure } from '../src/main/plugins/mutation-disclosure'
import { pluginSha256 } from '../src/main/plugins/package-digests'
import {
  cleanupLifecycleFixtures,
  fixture as lifecycleFixture,
  projection,
} from './plugin-lifecycle-fixtures'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { tar } from './plugin-package-fixtures'

vi.mock('../src/main/plugins/ui/host', () => ({ openPluginConfigurationView: vi.fn() }))
const target = { os: 'linux', cpu: 'x64' } as const
const roots: string[] = []
async function folder() {
  const root = await mkdtemp(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-source-'),
  )
  roots.push(root)
  return root
}
afterEach(async () => {
  vi.unstubAllGlobals()
  await cleanupLifecycleFixtures()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
function fixture(
  version = '1.0.0',
  id = 'fictional-oven',
  schema = 3,
  platform: { os: 'darwin' | 'win32' | 'linux'; cpu: 'arm64' | 'x64' } = target,
  name = 'Fictional oven',
  minAppVersion = '1.0.0',
) {
  const files = new Map([
    ['.config/oven settings.json', Buffer.from('{"oven":"fictional"}')],
    ['dist/café.cjs', Buffer.from('x'.repeat(200000))],
  ])
  const manifest = {
    format: 3,
    id,
    name,
    version,
    description: 'Fictional appliance',
    authors: ['Fictional Baker & Partners'],
    platforms: [platform],
    minAppVersion,
    permissions: { description: 'Use fictional ovens.', dataUses: ['Oven preferences'] },
    files: [...files].map(([path, body]) => ({
      path,
      bytes: body.length,
      sha256: pluginSha256(body),
    })),
    runtime: { kind: 'node', entry: 'dist/café.cjs' },
    mcp: { transport: 'stdio' },
    tools: { source: 'mcp', inventory: 'tools.json' },
    lifecycle: { stop: { signal: 'SIGTERM' }, dataOnRemove: 'keep' },
    data: { schema },
  }
  const archive = gzipSync(
    tar([
      { path: 'plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
      ...[...files].map(([path, body]) => ({ path, body })),
    ]),
  )
  return { archive, manifest, files }
}
const options = { target, appVersion: '1.2.0' }
describe('ordinary selected package sources', () => {
  it('inspects third-party HTTPS bytes, including ordinary names and high compression, without publisher proof', async () => {
    const f = fixture()
    const result = await inspectPluginPackage(
      {
        source: 'https://fictional.example:8443/oven?release=chosen',
        sha256: pluginSha256(f.archive),
        bytes: f.archive.length,
      },
      {
        ...options,
        fetch: async () => new Response(f.archive),
      },
    )
    expect(result.package.manifest).toEqual(f.manifest)
    expect(result.ref).toMatchObject({
      sha256: pluginSha256(f.archive),
      bytes: f.archive.length,
    })
    expect(releaseDisclosure(result.package)).toMatchObject({
      authors: f.manifest.authors,
      permissions: f.manifest.permissions,
    })
  })
  it('requires the actual app version for every declared generic minimum, including zero', async () => {
    const f = fixture('1.0.0', 'fictional-oven', 3, target, 'Fictional oven', '0.0.0')
    const inspected = await inspectPluginPackage(
      {
        source: 'http://localhost/fictional',
        sha256: pluginSha256(f.archive),
        bytes: f.archive.length,
      },
      { target, appVersion: '0.0.0', fetch: async () => new Response(f.archive) },
    )
    const catalogue = Buffer.from(JSON.stringify({ format: 3, entries: [inspected.release] }))
    for (const appVersion of [undefined, 'fictional-invalid']) {
      const verifier = createRepoAwarePluginVerifier({ pinnedPublicKey: null, target, appVersion })
      expect(() =>
        verifier
          .verifyCatalogue(catalogue, Buffer.alloc(0))
          .verifyPackage(inspected.release.id, inspected.release.version, f.archive),
      ).toThrow(expect.objectContaining({ code: 'target' }))
    }
  })
  function cataloguePackage(f: ReturnType<typeof fixture>, rowMinimum: string) {
    const row = {
      id: f.manifest.id,
      name: f.manifest.name,
      version: f.manifest.version,
      description: f.manifest.description,
      authors: f.manifest.authors,
      minAppVersion: rowMinimum,
      targets: [
        {
          ...target,
          url: 'http://localhost/fictional-selected',
          sha256: pluginSha256(f.archive),
          bytes: f.archive.length,
          compression: 'tar.gz',
          manifestSha256: pluginSha256(Buffer.from(JSON.stringify(f.manifest))),
        },
      ],
    }
    const parsed = parseRepoPluginList(
      Buffer.from(JSON.stringify({ format: 3, entries: [row] })),
      target,
      options.appVersion,
    )
    expect(parsed.releases).toHaveLength(1)
    const verifier = createRepoAwarePluginVerifier({ pinnedPublicKey: null, ...options })
    const catalogue = verifier.verifyCatalogue(parsed.bytes, Buffer.alloc(0))
    return { parsed, catalogue, row }
  }
  it('verifies and discloses a compatible manifest despite a stale high catalogue minimum', async () => {
    const f = fixture()
    const { parsed, catalogue } = cataloguePackage(f, '99.0.0')
    const release = parsed.releases[0]!
    const pkg = catalogue.verifyPackage(release.id, release.version, f.archive)
    expect(pkg.manifest).toEqual(f.manifest)
    expect(releaseDisclosure(pkg)).toMatchObject({
      authors: f.manifest.authors,
      permissions: f.manifest.permissions,
    })
    const fetch = vi.fn(async () => new Response(f.archive))
    const selected = await inspectPluginPackage(releasePackageRef(release), { ...options, fetch })
    expect(selected.ref).toEqual({
      source: 'http://localhost/fictional-selected',
      sha256: pluginSha256(f.archive),
      bytes: f.archive.length,
    })
    expect(selected.package.manifest).toEqual(f.manifest)
    expect(fetch).toHaveBeenCalledOnce()
  })
  it.each([
    { minimum: '99.0.0', platform: target, reason: 'manifest app version' },
    {
      minimum: '1.0.0',
      platform: { os: 'darwin', cpu: 'arm64' } as const,
      reason: 'manifest platform',
    },
  ])(
    'refuses an incompatible $reason despite permissive catalogue metadata',
    async ({ minimum, platform }) => {
      const f = fixture('1.0.0', 'fictional-oven', 3, platform, 'Fictional oven', minimum)
      const { parsed, catalogue } = cataloguePackage(f, '0.0.0')
      const release = parsed.releases[0]!
      expect(() => catalogue.verifyPackage(release.id, release.version, f.archive)).toThrow(
        expect.objectContaining({ code: 'target' }),
      )
      await expect(
        inspectPluginPackage(releasePackageRef(release), {
          ...options,
          fetch: async () => new Response(f.archive),
        }),
      ).rejects.toMatchObject({
        message: 'This plugin does not support this computer or version of BroCrew.',
        cause: expect.objectContaining({ code: 'target' }),
      })
    },
  )
  it('keeps archive, manifest and file digests authoritative despite permissive row metadata', () => {
    const f = fixture()
    const { parsed, catalogue, row } = cataloguePackage(f, '0.0.0')
    const release = parsed.releases[0]!
    const tampered = Buffer.from(f.archive)
    tampered[0] = tampered[0]! ^ 1
    expect(() => catalogue.verifyPackage(release.id, release.version, tampered)).toThrow(
      expect.objectContaining({ code: 'digest' }),
    )
    const wrongManifest = {
      ...row,
      targets: [{ ...row.targets[0]!, manifestSha256: '0'.repeat(64) }],
    }
    const changed = parseRepoPluginList(
      Buffer.from(JSON.stringify({ format: 3, entries: [wrongManifest] })),
      target,
      options.appVersion,
    )
    const verifier = createRepoAwarePluginVerifier({ pinnedPublicKey: null, ...options })
    expect(() =>
      verifier
        .verifyCatalogue(changed.bytes, Buffer.alloc(0))
        .verifyPackage(release.id, release.version, f.archive),
    ).toThrow(expect.objectContaining({ code: 'digest' }))
    const fileTampered = {
      ...f,
      archive: gzipSync(
        tar([
          { path: 'plugin.json', body: Buffer.from(JSON.stringify(f.manifest)) },
          ...[...f.files].map(([path, body]) => ({
            path,
            body: path === 'dist/café.cjs' ? Buffer.from('y'.repeat(body.length)) : body,
          })),
        ]),
      ),
    }
    const next = cataloguePackage(fileTampered, '0.0.0')
    expect(() =>
      next.catalogue.verifyPackage(release.id, release.version, fileTampered.archive),
    ).toThrow(expect.objectContaining({ code: 'digest' }))
  })
  it.each(['id', 'version'] as const)(
    'keeps selected catalogue %s bound to the verified manifest',
    (field) => {
      const f = fixture()
      const { row } = cataloguePackage(f, '0.0.0')
      const selected = { ...row, [field]: field === 'id' ? 'fictional-teapot' : '2.0.0' }
      const parsed = parseRepoPluginList(
        Buffer.from(JSON.stringify({ format: 3, entries: [selected] })),
        target,
        options.appVersion,
      )
      const verifier = createRepoAwarePluginVerifier({ pinnedPublicKey: null, ...options })
      expect(() =>
        verifier
          .verifyCatalogue(parsed.bytes, Buffer.alloc(0))
          .verifyPackage(selected.id, selected.version, f.archive),
      ).toThrow(expect.objectContaining({ code: 'digest' }))
    },
  )
  it('reads ordinary PAX long names and dot-prefixed tar entries without the curated path vocabulary', async () => {
    const path = `.settings/${'fictional ovens '.repeat(12)}recipe.json`,
      body = Buffer.from('fictional recipe')
    const raw = fixture().manifest
    const manifest = {
      ...raw,
      files: [{ path: `./${path}`, bytes: body.length, sha256: pluginSha256(body) }],
      runtime: { kind: 'node', entry: path },
    }
    const record = `path=${path}\n`
    let length = Buffer.byteLength(record) + 2
    while (length !== Buffer.byteLength(record) + String(length).length + 1)
      length = Buffer.byteLength(record) + String(length).length + 1
    const archive = tar([
      { path: './', type: '5' },
      { path: './plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
      { path: 'PaxHeader', type: 'x', body: Buffer.from(`${length} ${record}`) },
      { path: 'short-name', body },
    ])
    const result = await inspectPluginPackage(
      { source: 'http://127.0.0.1/fixture', sha256: pluginSha256(archive), bytes: archive.length },
      { ...options, fetch: async () => new Response(archive) },
    )
    expect(result.package.readFile(path)).toEqual(Uint8Array.from(body))
    expect(result.package.readFile(`./${path}`)).toEqual(Uint8Array.from(body))
  })
  it('accepts selected local files without a dev build, private root, or source catalogue', async () => {
    const f = fixture(),
      path = join(await folder(), 'selected package.tar.gz')
    await writeFile(path, f.archive)
    const result = await inspectPluginPackage(
      { source: path, sha256: pluginSha256(f.archive), bytes: f.archive.length },
      options,
    )
    expect(result.package.readFile('.config/oven settings.json')).toEqual(
      Uint8Array.from(Buffer.from('{"oven":"fictional"}')),
    )
    expect(await readFile(path)).toEqual(f.archive)
    await writeFile(path, Buffer.from('changed'))
    await expect(inspectPluginPackage(result.ref, options)).rejects.toThrow()
  })
  it('retains descriptor and exact archive for offline use independent of source list and version history', async () => {
    const root = await folder(),
      path = join(root, 'package.tar.gz'),
      f = fixture('0.5.0')
    await writeFile(path, f.archive)
    const inspected = await inspectPluginPackage(
      { source: path, sha256: pluginSha256(f.archive), bytes: f.archive.length },
      options,
    )
    const vault = new PluginPackageVault(root, null, target, undefined, '1.2.0')
    await vault.stage(
      inspected.release,
      inspected.archive,
      { bytes: Buffer.alloc(0), signature: Buffer.alloc(0) },
      [],
    )
    await rm(path)
    const loaded = await new PluginPackageVault(root, null, target, 'b'.repeat(64), '1.2.0').load(
      inspected.release,
      [],
    )
    expect(loaded.manifest).toEqual(f.manifest)
    expect(releasePackageRef(inspected.release).sha256).toBe(inspected.ref.sha256)
  })
  it('uses ordinary loopback HTTP, redirects, and file URLs without source admission', async () => {
    const f = fixture(),
      path = join(await folder(), 'oven.tar.gz')
    await writeFile(path, f.archive)
    const server = createServer((request, response) => {
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/package' })
        response.end()
        return
      }
      response.end(f.archive)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const address = server.address() as { port: number }
      for (const source of [
        `http://127.0.0.1:${address.port}/redirect`,
        pathToFileURL(path).href,
      ]) {
        const result = await inspectPluginPackage(
          { source, sha256: pluginSha256(f.archive), bytes: f.archive.length },
          options,
        )
        expect(result.package.manifest).toEqual(f.manifest)
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  })
  it('reads unrelated generic lists with ordinary author names and no source commit or release history', () => {
    const f = fixture()
    const entry = {
      id: f.manifest.id,
      name: f.manifest.name,
      version: 'chosen-release',
      description: f.manifest.description,
      authors: f.manifest.authors,
      targets: [
        {
          ...target,
          url: 'http://127.0.0.1:43210/selected',
          sha256: pluginSha256(f.archive),
          bytes: f.archive.length,
          compression: 'tar.gz',
          manifestSha256: 'a'.repeat(64),
        },
      ],
    }
    const first = parseRepoPluginList(
      Buffer.from(JSON.stringify({ format: 3, entries: [entry] })),
      target,
      '1.2.0',
    )
    const second = parseRepoPluginList(
      Buffer.from(
        JSON.stringify({
          format: 3,
          entries: [{ ...entry, id: 'fictional-teapot', authors: ['Fictional Potters'] }],
        }),
      ),
      target,
      '1.2.0',
    )
    expect(first.releases[0]?.authors).toEqual(f.manifest.authors)
    expect(second.releases[0]?.id).toBe('fictional-teapot')
  })
  it('reads a generic discovery list beyond the former byte cap through the normal production downloader', async () => {
    const f = fixture()
    const entry = {
      id: f.manifest.id,
      name: f.manifest.name,
      version: f.manifest.version,
      description: 'Fictional catalogued description '.repeat(40000),
      authors: f.manifest.authors,
      targets: [
        {
          ...target,
          url: 'http://localhost/fictional-package',
          sha256: pluginSha256(f.archive),
          bytes: f.archive.length,
          compression: 'tar.gz',
          manifestSha256: 'a'.repeat(64),
        },
      ],
    }
    const bytes = Buffer.from(JSON.stringify({ format: 3, entries: [entry] }))
    expect(bytes.length).toBeGreaterThan(1024 * 1024)
    vi.stubGlobal('fetch', async () => new Response(bytes))
    const loaded = await loadRepoPluginList({ root: await folder(), target, appVersion: '1.2.0' })
    expect(loaded.entries[0]?.description).toBe(entry.description)
    expect(loaded.rawBytes).toEqual(bytes)
    const later = parseRepoPluginList(
      Buffer.from(
        JSON.stringify({ format: 3, entries: [{ ...entry, minAppVersion: '1000000.0.0' }] }),
      ),
      target,
      '1.2.0',
    )
    expect(later.releases).toEqual(loaded.releases)
    expect(later.bytes).toEqual(loaded.bytes)
    expect(later.sha256).toBe(loaded.sha256)
  })
  it('turns a selected source into an exact byte reference without executing code', async () => {
    const f = fixture(),
      path = join(await folder(), 'selected.tar.gz')
    await writeFile(path, f.archive)
    const inspected = await selectPluginPackage(path, options)
    expect(inspected.ref).toEqual({
      source: path,
      sha256: pluginSha256(f.archive),
      bytes: f.archive.length,
    })
    expect(inspected.package.manifest).toEqual(f.manifest)
  })
  it('installs from unrelated window selections and replaces same or older versions without changing plugin data', async () => {
    const f = await lifecycleFixture({ appVersion: '1.2.0' }, false, 'fictional-catalogue')
    const controller = sharedLifecycleWorkspaces(f.controller)
    const handle = await controller.attach(projection().sink)
    const other = await controller.attach(projection().sink)
    const data = join(f.root, 'data', 'fictional-oven')
    await mkdir(data, { recursive: true })
    const opaque = Buffer.from('opaque fictional account preferences')
    await writeFile(join(data, 'preferences.bin'), opaque)
    const starts: unknown[] = []
    const start = f.opts.runtime.start
    f.opts.runtime.start = async (spec) => {
      starts.push(spec)
      return start(spec)
    }
    const install = async (
      version: string,
      schema: number,
      id = 'fictional-oven',
      action: 'install' | 'update' = 'update',
    ) => {
      const pkg = fixture(version, id, schema, f.opts.target)
      const path = join(f.parent, `${id}-${version}-${schema}.tar.gz`)
      await writeFile(path, pkg.archive)
      const ref = { source: path, sha256: pluginSha256(pkg.archive), bytes: pkg.archive.length }
      await controller.installPackage(id === 'fictional-teapot' ? other : handle, ref, action)
    }
    await install('2.0.0', 3, 'fictional-oven', 'install')
    await install('1.0.0', 1, 'fictional-teapot', 'install')
    await install('2.0.0', 8)
    await install('0.5.0', 4)
    expect(f.state.exportActivation().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: 'fictional-oven',
          release: expect.objectContaining({ version: '0.5.0', dataSchema: 4 }),
        }),
        expect.objectContaining({ pluginId: 'fictional-teapot' }),
      ]),
    )
    expect(starts[2]).toEqual(
      expect.objectContaining({ previousVersion: '2.0.0', previousDataSchema: 3 }),
    )
    expect(starts[3]).toEqual(
      expect.objectContaining({ previousVersion: '2.0.0', previousDataSchema: 8 }),
    )
    expect(await readFile(join(data, 'preferences.bin'))).toEqual(opaque)
    await controller.detach(handle)
    await controller.detach(other)
  })
  it('normal Settings installs, updates, lists and removes packages with ordinary Unicode and long metadata', async () => {
    const f = await lifecycleFixture({ appVersion: '1.2.0' }, false, 'fictional-catalogue')
    const personKey = 'd'.repeat(64)
    const server = await servePersonPluginControl({
      root: f.root,
      key: personKey,
      controller: sharedLifecycleWorkspaces(f.controller),
    })
    const client = await connectPluginSettings({
      root: f.root,
      path: server.path,
      personKey,
      pinnedPublicKey: null,
      target: f.opts.target,
      appVersion: '1.2.0',
      catalogue: { bytes: Buffer.from('{"format":3,"entries":[]}'), signature: Buffer.alloc(0) },
      projection: projection().sink,
      propose() {},
    })
    try {
      const id = '.fictional café ' + 'a'.repeat(100),
        name = 'Fictional café ' + 'n'.repeat(300)
      const peer = settingsPeer(client)
      for (const [action, schema] of [
        ['install', 2],
        ['update', 5],
      ] as const) {
        const version = '.fictional version café ' + 'v'.repeat(120) + schema
        const pkg = fixture(version, id, schema, f.opts.target, name)
        const source = join(f.parent, `metadata-${schema}.tar.gz`)
        await writeFile(source, pkg.archive)
        const shown = await peer.call({ kind: 'inspect', source })
        expect(shown).toMatchObject({ ok: true, inspection: { id, name, details: { version } } })
        expect(await peer.call({ kind: action, id, package: shown.inspection.ref })).toMatchObject({
          ok: true,
          cards: [{ id, name, installed: true, installedVersion: version }],
        })
        expect(await peer.call({ kind: 'list' })).toMatchObject({
          ok: true,
          cards: [{ id, name, installedVersion: version }],
        })
      }
      expect(await peer.call({ kind: 'uninstall', id })).toMatchObject({ ok: true })
      expect(f.state.exportActivation().entries).toEqual([])
    } finally {
      await client.close()
      await server.close()
    }
  })
  it('lets two real Settings clients inspect and install unrelated lists through one inert owner', async () => {
    const f = await lifecycleFixture({ appVersion: '1.2.0' }, false, 'fictional-catalogue')
    const owner = sharedLifecycleWorkspaces(f.controller),
      personKey = 'c'.repeat(64)
    const server = await servePersonPluginControl({
      root: f.root,
      key: personKey,
      controller: owner,
    })
    const clients: Awaited<ReturnType<typeof connectPluginSettings>>[] = []
    try {
      for (const id of ['fictional-oven', 'fictional-teapot']) {
        const pkg = fixture('1.0.0', id, 1, f.opts.target),
          path = join(f.parent, `${id}.tar.gz`)
        await writeFile(path, pkg.archive)
        const ref = { source: path, sha256: pluginSha256(pkg.archive), bytes: pkg.archive.length }
        const inspected = await inspectPluginPackage(ref, {
          target: f.opts.target,
          appVersion: '1.2.0',
        })
        const client = await connectPluginSettings({
          root: f.root,
          path: server.path,
          personKey,
          pinnedPublicKey: null,
          target: f.opts.target,
          appVersion: '1.2.0',
          catalogue: {
            bytes: Buffer.from(JSON.stringify({ format: 3, entries: [inspected.release] })),
            signature: Buffer.alloc(0),
          },
          projection: projection().sink,
          propose() {},
        })
        clients.push(client)
        expect(client.mutationStatus?.()).toBeNull()
        expect((await client.inspectPackage!(ref)).details.authors).toEqual(pkg.manifest.authors)
        await client.install(id)
      }
      for (const client of clients)
        expect(
          (await client.catalogue())
            .filter((card) => card.installed)
            .map((card) => card.id)
            .sort(),
        ).toEqual(['fictional-oven', 'fictional-teapot'])
      expect(f.starts()).toBe(2)
    } finally {
      await Promise.all(clients.map((client) => client.close()))
      await server.close()
    }
  })
  it('reports real transport errors and refuses broken bytes and actual incompatible targets', async () => {
    const f = fixture()
    const ref = {
      source: 'https://fictional.example/package',
      sha256: pluginSha256(f.archive),
      bytes: f.archive.length,
    }
    await expect(
      inspectPluginPackage(ref, {
        ...options,
        fetch: async () => new Response('', { status: 503 }),
      }),
    ).rejects.toThrow()
    await expect(
      inspectPluginPackage(ref, { ...options, fetch: async () => new Response('broken') }),
    ).rejects.toThrow()
    await expect(
      inspectPluginPackage(ref, {
        ...options,
        appVersion: '0.9.0',
        fetch: async () => new Response(fixture().archive),
      }),
    ).rejects.toThrow()
  })
})
