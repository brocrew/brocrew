import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parsePluginManifest } from '../src/main/plugins/package-schema'
import { loadRepoPluginList, parseRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { PLUGIN_LIST_URL, downloadPluginBytes } from '../src/main/plugins/catalogue/download'
import { manifestFor, packageFixture, verified } from './plugin-package-fixtures'
import { repoListFor } from './plugin-repo-list-fixtures'

const target = { os: 'linux', cpu: 'x64' } as const
const frameworkModule = new URL('../src/main/plugins/contributions.ts', import.meta.url).href
const v2Url = PLUGIN_LIST_URL.replace('catalogue.json', 'catalogue-v2.json')
const folders: string[] = []
const modernManifest = () => ({
  ...manifestFor(),
  format: 2,
  authors: ['brocrew'],
  toolApi: null,
  uiApi: null,
  server: null,
  ui: null,
  skills: [],
  serviceTemplates: [],
  executor: { kind: 'node', entry: 'dist/recipe.mjs' },
  hooks: [
    {
      id: 'related-titles',
      kind: 'turn.context.titles',
      api: 1,
      optional: true,
      inputs: ['resource-titles'],
    },
  ],
})
async function framework() {
  return (await import(frameworkModule)) as {
    pluginContributions(pkg: unknown): {
      executor: { kind: string; entry: string }
      tools: unknown
      configuration: unknown
      hooks: readonly { kind: string; supported: boolean }[]
    }
    createContributionRegistry(): {
      register(
        pkg: unknown,
        identity: Record<string, unknown>,
        current: () => boolean,
      ): { current(): boolean }
      revoke(pluginId: string): void
    }
  }
}
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true })
})

describe('versioned contribution metadata', () => {
  it('reads a hook-only Node manifest without inventing tools or configuration', async () => {
    const manifest = parsePluginManifest(Buffer.from(JSON.stringify(modernManifest())))
    const pkg = packageFixture({ manifest })
    const contributions = (await framework()).pluginContributions(verified(pkg))
    expect(contributions.executor).toEqual({ kind: 'node', entry: 'dist/recipe.mjs' })
    expect(contributions.tools).toBeNull()
    expect(contributions.configuration).toBeNull()
  })
  it.each(['speech.transcribe', 'transcript.cleanup'])(
    'keeps reserved %s visibly unsupported',
    async (kind) => {
      const raw = modernManifest()
      raw.hooks = [
        {
          id: 'fictional-engine',
          kind,
          api: 1,
          optional: true,
          inputs:
            kind === 'speech.transcribe' ? ['audio', 'vocabulary'] : ['transcript', 'vocabulary'],
        },
      ]
      const manifest = parsePluginManifest(Buffer.from(JSON.stringify(raw)))
      const entries = (await framework()).pluginContributions(
        verified(packageFixture({ manifest })),
      )
      expect(entries.hooks).toMatchObject([{ kind, supported: false }])
      expect(entries.tools).toBeNull()
      expect(entries.configuration).toBeNull()
    },
  )
  it('refuses undeclared executable paths and required unknown hooks', () => {
    const raw = modernManifest()
    raw.executor.entry = 'not-in-the-inventory.mjs'
    expect(() => parsePluginManifest(Buffer.from(JSON.stringify(raw)))).toThrow()
    const required = modernManifest()
    Object.assign(required.hooks[0]!, { optional: false })
    expect(() => parsePluginManifest(Buffer.from(JSON.stringify(required)))).toThrow()
  })
  it('keeps exact installed legacy manifests readable', () => {
    const raw = manifestFor()
    expect(parsePluginManifest(Buffer.from(JSON.stringify(raw)))).toEqual(raw)
  })
  it('binds registrations to verified bytes and invalidates stale run authority', async () => {
    const api = await framework()
    const pkg = packageFixture({
      manifest: parsePluginManifest(Buffer.from(JSON.stringify(modernManifest()))),
    })
    const checked = verified(pkg)
    const registry = api.createContributionRegistry()
    const identity = {
      pluginId: pkg.manifest.id,
      releaseDigest: pkg.release.archive.sha256,
      installId: randomUUID(),
      incarnation: randomUUID(),
      runId: randomUUID(),
      workspaceId: randomUUID(),
      switchRevision: 0,
    }
    expect(() => registry.register({ ...checked }, identity, () => true)).toThrow()
    let live = true
    const entry = registry.register(checked, identity, () => live)
    expect(entry.current()).toBe(true)
    live = false
    expect(entry.current()).toBe(false)
    live = true
    registry.revoke(pkg.manifest.id)
    expect(entry.current()).toBe(false)
  })
  it('uses the fixed versioned URL only when explicitly selected, retaining the frozen source', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'fictional-catalogue-')))
    folders.push(root)
    const pkg = packageFixture()
    const legacy = repoListFor(pkg.release)
    const expanded = {
      format: 2,
      entries: [
        ...legacy.entries.map((one) => ({ ...one, authors: ['brocrew'] })),
        { ...legacy.entries[0]!, id: 'fictional-new', authors: ['brocrew'] },
      ],
    }
    const fetch = vi.fn(
      async (url: Parameters<typeof globalThis.fetch>[0]) =>
        new Response(JSON.stringify(String(url) === v2Url ? expanded : legacy)),
    )
    vi.stubGlobal('fetch', fetch)
    const old = await loadRepoPluginList({ root, target, appVersion: '1.0.0' })
    expect(old.entries.map((one) => one.id)).toEqual([pkg.release.id])
    const modern = await loadRepoPluginList({
      root,
      target,
      appVersion: '1.0.0',
      sourceVersion: 2,
    } as Parameters<typeof loadRepoPluginList>[0])
    expect(modern.entries.map((one) => one.id)).toEqual([pkg.release.id, 'fictional-new'])
    expect(fetch.mock.calls.map(([url]) => String(url))).toContain(v2Url)
    const wrong = vi.fn(async () => new Response(JSON.stringify(expanded)))
    await downloadPluginBytes({ url: v2Url, maximum: 1024 * 1024, fetch: wrong })
    expect(wrong).toHaveBeenCalledOnce()
    expect(parseRepoPluginList(Buffer.from(JSON.stringify(legacy)), target, '1.0.0').bytes).toEqual(
      old.bytes,
    )
  })
})
