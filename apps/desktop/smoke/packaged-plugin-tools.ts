// Real offline plugin packages, installed and called through the shipped supervisor.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadRepoPluginList } from '../src/main/plugins/catalogue/repo-list'
import { connectPersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import type { PersonChannel } from '../src/main/plugins/lifecycle/transport'
import type { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import type { PluginRelease } from '../src/main/plugins/package-schema'
import type { PluginLifecyclePlan } from '../src/main/plugins/supervisor/launch-format'

export async function preparePluginTools(root: string, scratch: string, packages: string) {
  const source = join(scratch, 'source')
  await mkdir(join(source, 'archives'), { recursive: true, mode: 0o700 })
  const entries = []
  for (const id of ['chrome', 'whatsapp']) {
    const release: PluginRelease = JSON.parse(
      await readFile(join(packages, id, 'fixture-release.json'), 'utf8'),
    )
    assert.equal(release.id, id)
    const extension = release.archive.compression === 'tar.gz' ? '.tar.gz' : '.tar'
    await writeFile(
      join(source, 'archives', release.archive.sha256 + extension),
      await readFile(join(packages, id, id + extension)),
      { mode: 0o600 },
    )
    entries.push({
      id,
      authors: release.authors,
      name: id,
      description: `Offline ${id} smoke`,
      version: release.version,
      minAppVersion: '0.0.0',
      sourceCommit: release.sourceCommit,
      targets: release.platforms.map((target) => ({
        ...target,
        url: `https://github.com/brocrew/brocrew-plugin-${id}/releases/download/v${release.version}/${id}${extension}`,
        sha256: release.archive.sha256,
        bytes: release.archive.size,
        compression: release.archive.compression,
        manifestSha256: release.manifestSha256,
      })),
    })
  }
  await writeFile(join(source, 'catalogue.json'), JSON.stringify({ format: 1, entries: [] }), {
    mode: 0o600,
  })
  await writeFile(join(source, 'catalogue-v2.json'), JSON.stringify({ format: 2, entries }), {
    mode: 0o600,
  })
  const target = {
    os: process.platform as 'darwin' | 'win32',
    cpu: process.arch as 'arm64' | 'x64',
  }
  const legacy = await loadRepoPluginList({
    root,
    target,
    appVersion: '0.2.9',
    fixtureSource: source,
  })
  const catalogue = await loadRepoPluginList({
    root,
    target,
    appVersion: '0.2.9',
    fixtureSource: source,
    sourceVersion: 2,
  })
  return {
    source: 'repo-list' as const,
    sourceVersion: 2 as const,
    legacyRepoList: legacy.repoList,
    appVersion: '0.2.9',
    catalogue: catalogue.catalogue,
    catalogueSha256: catalogue.sha256,
    repoList: catalogue.repoList,
    personKey: randomBytes(32).toString('hex'),
    names: { chrome: 'Chrome', whatsapp: 'WhatsApp' },
    fixtureSource: source,
  }
}

export async function callPluginTools(
  root: string,
  directory: string,
  plan: PluginLifecyclePlan,
  lease: PluginWorkspaceLease,
  workspaceId: string,
) {
  let person: PersonChannel | undefined
  const incarnation = randomUUID()
  try {
    const until = performance.now() + 30_000
    for (;;) {
      try {
        assert.equal(
          JSON.parse(await readFile(join(directory, 'lifecycle.json'), 'utf8')).ready,
          true,
        )
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || performance.now() >= until)
          throw error
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    person = await connectPersonPluginControl({
      path: join(root, 'person-control/person.sock'),
      key: plan.personKey,
      handle: async () => true,
    })
    await person.call({ kind: 'attach', workspaceId })
    await person.call({ kind: 'mutation-policy', catalogueDigest: plan.catalogueSha256 })
    const catalogue = JSON.parse(await readFile(plan.catalogue, 'utf8')) as {
      entries: PluginRelease[]
    }
    for (const pluginId of ['chrome', 'whatsapp']) {
      const release = catalogue.entries.find((one) => one.id === pluginId)!
      const releaseDigest = release.archive.sha256
      const { preparation } = (await person.call({
        kind: 'prepare-mutation',
        action: 'install',
        pluginId,
        releaseDigest,
      })) as { preparation: string }
      assert.equal(
        await person.call({
          kind: 'install-prepared',
          pluginId,
          operationId: randomUUID(),
          preparation,
          releaseDigest,
        }),
        true,
      )
    }
    type Server = { pluginId: string; url: string; capability: string }
    let servers: Server[] = []
    const routesUntil = performance.now() + 30_000
    for (;;) {
      const routes = await lease.agentRoutes({ workspaceId, incarnation, occupied: [] })
      assert.equal(routes.format, 2)
      const answer = routes.value as { servers: Server[]; pending: string[] }
      servers = answer.servers
      const missing = ['chrome', 'whatsapp'].filter(
        (id) => !servers.some((one) => one.pluginId === id),
      )
      if (!missing.length) break
      assert.ok(
        missing.every((id) => answer.pending.includes(id)),
        'plugin route failed',
      )
      assert.ok(performance.now() < routesUntil, 'plugin routes stayed pending')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    for (const id of ['chrome', 'whatsapp']) {
      const server = servers.find((one) => one.pluginId === id)
      assert.ok(server, `${id} has no packaged service route`)
      const client = new Client({ name: 'packaged-plugin-smoke', version: '1' })
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(server.url), {
            requestInit: {
              headers: { Authorization: `Bearer ${server.capability}` },
              redirect: 'error',
            },
          }),
          { timeout: 15_000 },
        )
        const inventory = await client.listTools(undefined, { timeout: 15_000 })
        console.log(`[plugin-service-check] ${id} inventory: ${JSON.stringify(inventory)}`)
        assert.ok(
          inventory.tools.some(
            (tool) => tool.name === (id === 'chrome' ? 'list_browser_profiles' : 'list_chats'),
          ),
        )
        if (id === 'chrome') {
          const reply = await client.callTool(
            { name: 'list_browser_profiles', arguments: {} },
            undefined,
            { timeout: 15_000 },
          )
          console.log(`[plugin-service-check] chrome reply: ${JSON.stringify(reply)}`)
          assert.notEqual(reply.isError, true, 'Chrome list_browser_profiles failed')
          const content = reply.content as { type: string; text?: string }[]
          assert.deepEqual(JSON.parse(content.find((one) => one.type === 'text')!.text!), [])
        }
        console.log(
          `[plugin-service-check] ${id}: ${id === 'chrome' ? 'tools/call list_browser_profiles' : 'tools/list (no linked account)'} passed`,
        )
      } finally {
        await client.close()
      }
    }
  } finally {
    try {
      await lease.agentRoutes({ workspaceId, incarnation, occupied: [], release: true })
    } finally {
      if (person) {
        try {
          await person.call({ kind: 'detach' })
        } finally {
          person.close()
        }
      }
    }
  }
}
