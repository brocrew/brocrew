import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import {
  PLUGIN_HOST_SCRIPTS,
  preparePluginNodeRuntime,
  runtimeFiles,
} from '../src/main/plugins/node-runtime'

it('prepares runtime bytes once the caller creates the ordinary parent directory', async () => {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'fictional-runtime-parent-')))
  try {
    const resources = join(parent, 'bundle')
    const binary = await readFile(process.execPath)
    const name = process.platform === 'win32' ? 'node.exe' : 'node'
    await mkdir(join(resources, 'plugin-node'), { recursive: true })
    await writeFile(join(resources, 'plugin-node', name), binary)
    await writeFile(join(resources, 'plugin-node/LICENSE'), 'fictional runtime fixture licence')
    await writeFile(
      join(resources, 'plugin-node/runtime.json'),
      JSON.stringify({
        format: 1,
        platform: process.platform,
        arch: process.arch,
        version: process.versions.node,
        sha256: createHash('sha256').update(binary).digest('hex'),
      }),
    )
    await mkdir(join(resources, 'plugin-host'))
    for (const script of PLUGIN_HOST_SCRIPTS)
      await copyFile(
        resolve(__dirname, '../resources/plugin-host', script),
        join(resources, 'plugin-host', script),
      )
    const durableRoot = join(parent, 'plugins', 'runtimes')
    await expect(realpath(dirname(durableRoot))).rejects.toMatchObject({
      code: 'ENOENT',
      syscall: 'realpath',
    })
    await expect(
      preparePluginNodeRuntime({ resourcesRoot: resources, durableRoot }),
    ).rejects.toThrow('plugin-host-runtime')
    await mkdir(dirname(durableRoot))
    const runtime = await preparePluginNodeRuntime({ resourcesRoot: resources, durableRoot })
    const kept = await readFile((await runtimeFiles(runtime)).node)
    expect(kept.equals(binary)).toBe(true)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
