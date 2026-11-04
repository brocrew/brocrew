import { join, dirname, resolve } from 'node:path'
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { digest, PluginHostError } from './node-host-files'

export interface PluginNodeRuntime {
  readonly id: string
  readonly version: string
}
interface RuntimeFiles {
  node: string
  guardian: string
}
const prepared = new WeakMap<PluginNodeRuntime, RuntimeFiles>()
/** Legacy fixture names; preparation discovers the bundled resources rather than requiring these. */
export const PLUGIN_HOST_SCRIPTS = [
  'guardian.mjs',
  'server.mjs',
  'process-groups.mjs',
  'receipts.mjs',
  'boot-witness.mjs',
  'windows-job.mjs',
  'windows-job.ps1',
  'process-guardian.mjs',
  'process-launcher.mjs',
  'runtime-locks.mjs',
] as const
const NODE = process.platform === 'win32' ? 'node.exe' : 'node'

/** Optional build information is descriptive, never a prerequisite for using Node. */
async function runtimeVersion(directory: string): Promise<string> {
  try {
    const metadata = JSON.parse(await readFile(join(directory, 'runtime.json'), 'utf8'))
    return typeof metadata?.version === 'string' ? metadata.version : 'unknown'
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === 'ENOENT')
      return 'unknown'
    throw error
  }
}

async function resourceFiles(directory: string, prefix = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = join(prefix, entry.name)
    if (entry.isDirectory()) {
      for (const [child, bytes] of await resourceFiles(join(directory, entry.name), name))
        files.set(child, bytes)
    } else files.set(name, await readFile(join(directory, entry.name)))
  }
  return files
}

export async function preparePluginNodeRuntime(options: {
  resourcesRoot: string
  durableRoot: string
}): Promise<PluginNodeRuntime> {
  const base = join(options.resourcesRoot, 'plugin-node')
  // Missing executable/resources are ordinary filesystem errors, without a metadata trust gate.
  await access(join(base, NODE))
  const files = await resourceFiles(base)
  for (const [name, bytes] of await resourceFiles(join(options.resourcesRoot, 'plugin-host')))
    files.set(name, bytes)
  // The digest selects a reusable copy only. Existing copies are not rehashed or admitted.
  const id = digest(
    Buffer.from(
      JSON.stringify(
        [...files]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, bytes]) => [name, digest(bytes)]),
      ),
    ),
  )
  const root = resolve(options.durableRoot)
  await mkdir(root, { recursive: true })
  const kept = join(root, id)
  try {
    await access(kept)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const stage = await mkdtemp(join(root, '.stage-'))
    try {
      for (const [name, bytes] of files) {
        const path = join(stage, name)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, bytes, { mode: name === NODE ? 0o755 : 0o644 })
      }
      try {
        await rename(stage, kept)
      } catch (error) {
        // Another preparer may already have published the same cache selection.
        if (!['EEXIST', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? ''))
          throw error
      }
    } finally {
      await rm(stage, { recursive: true, force: true })
    }
  }
  return locateRuntime(kept, id)
}

async function locateRuntime(directory: string, id: string): Promise<PluginNodeRuntime> {
  const runtime = Object.freeze({ id, version: await runtimeVersion(directory) })
  prepared.set(runtime, { node: join(directory, NODE), guardian: join(directory, 'guardian.mjs') })
  return runtime
}

/** Reopen copied resources by their location; the cache label is not an admission credential. */
export async function resumePluginNodeRuntime(options: {
  directory: string
  id: string
}): Promise<PluginNodeRuntime> {
  const directory = resolve(options.directory)
  await access(join(directory, NODE))
  return locateRuntime(directory, options.id)
}

export async function runtimeFiles(runtime: PluginNodeRuntime): Promise<Readonly<RuntimeFiles>> {
  const paths = prepared.get(runtime)
  if (!paths) throw new PluginHostError('runtime')
  return Object.freeze({ ...paths })
}
