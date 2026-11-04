import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  preparePluginNodeRuntime,
  resumePluginNodeRuntime,
  runtimeFiles,
} from '../src/main/plugins/node-runtime'

const run = promisify(execFile)
const roots: string[] = []
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node'
async function fixture(metadata: unknown = { version: '18.3.0' }) {
  const root = await mkdtemp(join(tmpdir(), 'fictional-runtime-preparation-'))
  roots.push(root)
  const resourcesRoot = join(root, 'resources')
  const durableRoot = join(root, 'runtimes')
  await mkdir(join(resourcesRoot, 'plugin-node'), { recursive: true })
  await mkdir(join(resourcesRoot, 'plugin-host/nested'), { recursive: true })
  // Preparation copies an executable; the OS decides whether it can run on this machine.
  await writeFile(join(resourcesRoot, 'plugin-node', nodeName), 'fictional available executable')
  if (metadata !== undefined)
    await writeFile(join(resourcesRoot, 'plugin-node/runtime.json'), JSON.stringify(metadata))
  await writeFile(join(resourcesRoot, 'plugin-host/guardian.mjs'), "console.log('fictional ready')")
  await writeFile(join(resourcesRoot, 'plugin-host/nested/extra.mjs'), 'export const fictional = 1')
  return { root, resourcesRoot, durableRoot }
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ordinary bundled runtime preparation', () => {
  it.each([
    { version: '18.3.0' },
    {
      format: 99,
      platform: 'fictional-os',
      arch: 'fictional-cpu',
      version: 'next',
      sha256: 'stale',
      extra: true,
    },
    null,
  ])('copies available resources without metadata/version/pin admission: %j', async (metadata) => {
    const options = await fixture(metadata)
    const runtime = await preparePluginNodeRuntime(options)
    const paths = await runtimeFiles(runtime)
    expect(await readFile(paths.node, 'utf8')).toBe('fictional available executable')
    expect(await readFile(join(dirname(paths.node), 'nested/extra.mjs'), 'utf8')).toContain(
      'fictional',
    )
    expect((await run(process.execPath, [paths.guardian])).stdout.trim()).toBe('fictional ready')
  })

  it('does not require a metadata file, licence file or fixed helper inventory', async () => {
    const options = await fixture()
    await rm(join(options.resourcesRoot, 'plugin-node/runtime.json'))
    const runtime = await preparePluginNodeRuntime(options)
    expect((await runtimeFiles(runtime)).node).toContain(runtime.id)
  })

  it('treats undecodable optional metadata as unavailable version information', async () => {
    const options = await fixture()
    await writeFile(join(options.resourcesRoot, 'plugin-node/runtime.json'), 'fictional not-json')
    const runtime = await preparePluginNodeRuntime(options)
    expect(runtime.version).toBe('unknown')
  })

  it('uses discovered bytes only for cache selection, and copies an additional helper', async () => {
    const options = await fixture()
    const first = await preparePluginNodeRuntime(options)
    expect((await preparePluginNodeRuntime(options)).id).toBe(first.id)
    await writeFile(
      join(options.resourcesRoot, 'plugin-host/new-fictional-helper.mjs'),
      'export default 2',
    )
    const next = await preparePluginNodeRuntime(options)
    expect(next.id).not.toBe(first.id)
    expect(
      await readFile(
        join(dirname((await runtimeFiles(next)).node), 'new-fictional-helper.mjs'),
        'utf8',
      ),
    ).toBe('export default 2')
  })

  it('copies resources beyond the old metadata and helper admission caps', async () => {
    const options = await fixture({ version: '18.3.0', notes: 'fictional'.repeat(1024) })
    const extra = Buffer.alloc(70 * 1024, 'f')
    await writeFile(join(options.resourcesRoot, 'plugin-host/guardian.mjs'), extra)
    const paths = await runtimeFiles(await preparePluginNodeRuntime(options))
    expect(await readFile(paths.guardian)).toEqual(extra)
  })

  it('runs the copied available Node and helper after original resources disappear', async () => {
    const options = await fixture({ version: '18.3.0', sha256: 'fictional stale pin' })
    await copyFile(process.execPath, join(options.resourcesRoot, 'plugin-node', nodeName))
    const runtime = await preparePluginNodeRuntime(options)
    const paths = await runtimeFiles(runtime)
    await rm(options.resourcesRoot, { recursive: true })
    const resumed = await resumePluginNodeRuntime({
      directory: dirname(paths.node),
      id: runtime.id,
    })
    expect(await runtimeFiles(resumed)).toEqual(paths)
    expect((await run(paths.node, [paths.guardian])).stdout.trim()).toBe('fictional ready')
  })

  it('locates changed cached resources and resumes without an identity/hash admission check', async () => {
    const options = await fixture()
    const runtime = await preparePluginNodeRuntime(options)
    const paths = await runtimeFiles(runtime)
    await writeFile(paths.node, 'fictional replacement executable')
    await writeFile(paths.guardian, "console.log('fictional replacement ready')")
    await writeFile(
      join(dirname(paths.node), 'runtime.json'),
      JSON.stringify({ version: '16.0.0', extra: true }),
    )
    expect(await runtimeFiles(runtime)).toEqual(paths)
    expect(await runtimeFiles(await preparePluginNodeRuntime(options))).toEqual(paths)
    const resumed = await resumePluginNodeRuntime({
      directory: dirname(paths.node),
      id: 'fictional-cache-label',
    })
    expect(resumed.version).toBe('16.0.0')
    expect(await runtimeFiles(resumed)).toEqual(paths)
    await rm(options.resourcesRoot, { recursive: true })
    expect((await run(process.execPath, [paths.guardian])).stdout.trim()).toBe(
      'fictional replacement ready',
    )
  })

  it('reports a real missing executable during preparation', async () => {
    const options = await fixture()
    await rm(join(options.resourcesRoot, 'plugin-node', nodeName))
    await expect(preparePluginNodeRuntime(options)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports a real missing resources directory during preparation', async () => {
    const options = await fixture()
    await rm(join(options.resourcesRoot, 'plugin-host'), { recursive: true })
    await expect(preparePluginNodeRuntime(options)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves missing helper failure to the operation that uses it', async () => {
    const options = await fixture()
    await rm(join(options.resourcesRoot, 'plugin-host/guardian.mjs'))
    const paths = await runtimeFiles(await preparePluginNodeRuntime(options))
    await expect(run(process.execPath, [paths.guardian])).rejects.toMatchObject({ code: 1 })
  })

  it('reports a real destination write failure', async () => {
    const options = await fixture()
    await writeFile(options.durableRoot, 'fictional occupied path')
    await expect(preparePluginNodeRuntime(options)).rejects.toMatchObject({ code: 'EEXIST' })
  })
})
