import { join, isAbsolute, dirname, basename } from 'node:path'
import {
  privateRoot,
  privateChild,
  immutableFile,
  verifyImmutableFile,
  publishPrivateDirectory,
  sourceBytes,
  digest,
  PluginHostError,
} from './node-host-files'

export interface PluginNodeRuntime {
  readonly id: string
  readonly version: string
}
interface RuntimeFiles {
  node: string
  guardian: string
  digest: string
  scripts: Map<string, Buffer>
}
const prepared = new WeakMap<PluginNodeRuntime, RuntimeFiles>()
/** The host's own scripts beside the pinned Node, all hashed into the runtime's identity. */
export const PLUGIN_HOST_SCRIPTS = [
  'guardian.mjs',
  'server.mjs',
  'process-groups.mjs',
  'receipts.mjs',
  'windows-job.mjs',
  'windows-job.ps1',
] as const
/** The pinned executable's name, as `scripts/prepare-plugin-node.mjs` prepares it. */
const NODE = process.platform === 'win32' ? 'node.exe' : 'node'
const identity = (metadata: unknown, scripts: Map<string, Buffer>) =>
  digest(
    Buffer.from(
      JSON.stringify({
        profile: 2,
        metadata,
        scripts: [...scripts].map(([name, bytes]) => [name, digest(bytes)]),
      }),
    ),
  )
export async function preparePluginNodeRuntime(options: {
  resourcesRoot: string
  durableRoot: string
}): Promise<PluginNodeRuntime> {
  if (!isAbsolute(options.resourcesRoot) || !isAbsolute(options.durableRoot))
    throw new PluginHostError('runtime')
  try {
    const base = join(options.resourcesRoot, 'plugin-node')
    const metadata = JSON.parse(
      (await sourceBytes(join(base, 'runtime.json'), 4096)).toString('utf8'),
    )
    if (
      Object.keys(metadata).sort().join(',') !== 'arch,format,platform,sha256,version' ||
      metadata.format !== 1 ||
      metadata.platform !== process.platform ||
      metadata.arch !== process.arch ||
      !/^\d+\.\d+\.\d+$/.test(metadata.version) ||
      Number(metadata.version.split('.')[0]) < 24 ||
      !/^[a-f0-9]{64}$/.test(metadata.sha256)
    )
      throw new PluginHostError('runtime')
    const node = await sourceBytes(join(base, NODE), 256 * 1024 * 1024)
    if (digest(node) !== metadata.sha256) throw new PluginHostError('runtime')
    const scripts = new Map<string, Buffer>()
    for (const name of PLUGIN_HOST_SCRIPTS)
      scripts.set(
        name,
        await sourceBytes(join(options.resourcesRoot, 'plugin-host', name), 64 * 1024),
      )
    scripts.set('LICENSE', await sourceBytes(join(base, 'LICENSE'), 512 * 1024))
    const id = identity(metadata, scripts)
    const root = await privateRoot(options.durableRoot)
    const kept = await publishPrivateDirectory(
      root,
      id,
      async (stage) => {
        await immutableFile(join(stage, NODE), node, true)
        await immutableFile(join(stage, 'runtime.json'), Buffer.from(JSON.stringify(metadata)))
        for (const [name, bytes] of scripts) await immutableFile(join(stage, name), bytes)
      },
      async (directory) => {
        await verifyImmutableFile(join(directory, NODE), node)
        await verifyImmutableFile(
          join(directory, 'runtime.json'),
          Buffer.from(JSON.stringify(metadata)),
        )
        for (const [name, bytes] of scripts) await verifyImmutableFile(join(directory, name), bytes)
      },
    )
    const runtime = Object.freeze({ id, version: metadata.version })
    prepared.set(runtime, {
      node: join(kept, NODE),
      guardian: join(kept, 'guardian.mjs'),
      digest: metadata.sha256,
      scripts,
    })
    return runtime
  } catch {
    throw new PluginHostError('runtime')
  }
}
/** Re-open the exact content-addressed runtime in a detached supervisor, without app resources. */
export async function resumePluginNodeRuntime(options: {
  directory: string
  id: string
}): Promise<PluginNodeRuntime> {
  try {
    if (!isAbsolute(options.directory) || !/^[a-f0-9]{64}$/.test(options.id))
      throw new PluginHostError('runtime')
    const kept = await privateChild(dirname(options.directory), basename(options.directory), false)
    const metadata = JSON.parse(
      (await sourceBytes(join(kept, 'runtime.json'), 4096)).toString('utf8'),
    )
    if (
      metadata.format !== 1 ||
      metadata.platform !== process.platform ||
      metadata.arch !== process.arch ||
      !/^\d+\.\d+\.\d+$/.test(metadata.version) ||
      Number(metadata.version.split('.')[0]) < 24 ||
      !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
      digest(await sourceBytes(join(kept, NODE), 256 * 1024 * 1024)) !== metadata.sha256
    )
      throw new PluginHostError('runtime')
    const scripts = new Map<string, Buffer>()
    for (const name of [...PLUGIN_HOST_SCRIPTS, 'LICENSE'])
      scripts.set(
        name,
        await sourceBytes(join(kept, name), name === 'LICENSE' ? 512 * 1024 : 64 * 1024),
      )
    if (identity(metadata, scripts) !== options.id) throw new PluginHostError('runtime')
    const runtime = Object.freeze({ id: options.id, version: metadata.version })
    prepared.set(runtime, {
      node: join(kept, NODE),
      guardian: join(kept, 'guardian.mjs'),
      digest: metadata.sha256,
      scripts,
    })
    return runtime
  } catch {
    throw new PluginHostError('runtime')
  }
}
export async function runtimeFiles(
  runtime: PluginNodeRuntime,
): Promise<Readonly<{ node: string; guardian: string }>> {
  const paths = prepared.get(runtime)
  if (!paths) throw new PluginHostError('runtime')
  if (digest(await sourceBytes(paths.node, 256 * 1024 * 1024)) !== paths.digest)
    throw new PluginHostError('runtime')
  for (const [name, bytes] of paths.scripts)
    if (
      !(
        await sourceBytes(
          join(paths.guardian, '..', name),
          name === 'LICENSE' ? 512 * 1024 : 64 * 1024,
        )
      ).equals(bytes)
    )
      throw new PluginHostError('runtime')
  return Object.freeze({ node: paths.node, guardian: paths.guardian })
}
