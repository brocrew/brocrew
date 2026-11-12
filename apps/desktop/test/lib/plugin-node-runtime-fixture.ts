import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLUGIN_HOST_SCRIPTS,
  preparePluginNodeRuntime,
  runtimeFiles,
} from '../../src/main/plugins/node-runtime'

export async function pluginNodeRuntimeFixture(root: string) {
  const resources = join(root, 'bundle')
  await mkdir(join(resources, 'plugin-node'), { recursive: true, mode: 0o700 })
  const bundledNode = fileURLToPath(new URL('../../resources/plugin-node/node', import.meta.url))
  const binary = await readFile(
    process.env.BROBOT_PLUGIN_NODE_TEST_BINARY ||
      (process.platform === 'darwin' && existsSync(bundledNode) ? bundledNode : process.execPath),
  )
  await writeFile(join(resources, 'plugin-node/node'), binary)
  await writeFile(join(resources, 'plugin-node/LICENSE'), 'fictional runtime fixture licence')
  await writeFile(
    join(resources, 'plugin-node/runtime.json'),
    JSON.stringify({
      format: 1,
      platform: process.platform,
      arch: process.arch,
      version: process.platform === 'darwin' ? '24.22.0' : process.versions.node,
      sha256: createHash('sha256').update(binary).digest('hex'),
    }),
  )
  await mkdir(join(resources, 'plugin-host'))
  for (const name of PLUGIN_HOST_SCRIPTS)
    await copyFile(
      fileURLToPath(new URL('../../resources/plugin-host/' + name, import.meta.url)),
      join(resources, 'plugin-host', name),
    )
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: resources,
    durableRoot: join(root, 'runtimes'),
  })
  return { resources, runtime, node: (await runtimeFiles(runtime)).node }
}
