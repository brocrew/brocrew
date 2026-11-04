import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { vi } from 'vitest'
import { fixture, projection } from './plugin-lifecycle-fixtures'
import { packageFixture } from './plugin-package-fixtures'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { servePersonPluginControl } from '../src/main/plugins/lifecycle/person-control'
import { sharedLifecycleWorkspaces } from '../src/main/plugins/lifecycle/workspaces'
import { releasePackageRef } from '../src/main/plugins/package-source'

export async function selectedSourceFixture(installed = false) {
  const f = await fixture({}, false, 'fictional-bakery')
  if (installed) await f.controller.install(f.handle, f.pkg.release.id)
  const next = packageFixture({
    manifest: {
      ...f.pkg.manifest,
      format: 2,
      authors: ['fictional-makers'],
      version: '1.0.2',
      executor: { kind: 'node', entry: f.pkg.manifest.server!.entry },
      hooks: [],
    },
  })
  const path = join(f.parent, 'selected-package.tar')
  await writeFile(path, next.archive)
  const ref = { ...releasePackageRef(next.release), source: path }
  const key = randomBytes(32).toString('hex')
  const controller = sharedLifecycleWorkspaces(f.controller)
  const bridge = await servePersonPluginControl({
    root: f.root,
    key,
    controller,
    read: async () => null,
  })
  const clients: Awaited<ReturnType<typeof connectPluginSettings>>[] = []
  const download = vi.fn(async () => next.archive)
  async function connect(catalogue = { bytes: next.bytes, signature: next.signature }) {
    const client = await connectPluginSettings({
      path: bridge.path,
      personKey: key,
      root: f.root,
      pinnedPublicKey: null,
      target: f.opts.target,
      catalogue,
      projection: projection().sink,
      download,
      propose() {},
    })
    const originalClose = client.close.bind(client)
    let closed = false
    client.close = async () => {
      if (closed) return
      closed = true
      await originalClose()
    }
    clients.push(client)
    return client
  }
  return {
    f,
    next,
    ref,
    key,
    bridge,
    controller,
    connect,
    download,
    async close() {
      for (const c of clients.reverse()) await c.close()
      await bridge.close()
    },
  }
}
