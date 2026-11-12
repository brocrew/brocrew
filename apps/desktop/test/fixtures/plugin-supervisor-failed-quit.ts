import { fork } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runPluginSupervisor } from '../../src/main/plugins/supervisor/entry'
import {
  PLUGIN_HOST_SCRIPTS,
  preparePluginNodeRuntime,
  runtimeFiles,
} from '../../src/main/plugins/node-runtime'

async function main() {
  const [root, workspace, scripts] = process.argv.slice(2) as [string, string, string]
  const resources = join(root, 'resources')
  await mkdir(join(resources, 'plugin-node'), { recursive: true })
  await mkdir(join(resources, 'plugin-host'))
  const binary = await readFile(process.execPath)
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  await writeFile(join(resources, 'plugin-node/node'), binary)
  await writeFile(join(resources, 'plugin-node/LICENSE'), 'Fictional test runtime')
  await writeFile(
    join(resources, 'plugin-node/runtime.json'),
    JSON.stringify({
      format: 1,
      platform: process.platform,
      arch: process.arch,
      version: process.versions.node,
      sha256: hash(binary),
    }),
  )
  for (const name of PLUGIN_HOST_SCRIPTS)
    await copyFile(join(scripts, name), join(resources, 'plugin-host', name))
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: resources,
    durableRoot: join(root, 'runtimes'),
  })
  const files = await runtimeFiles(runtime)
  const config = Buffer.from(
    JSON.stringify({
      format: 1,
      root,
      workspaceRoots: [workspace],
      runtime: { directory: dirname(files.node), id: runtime.id },
    }),
  )
  const configPath = join(root, 'launch.json')
  await writeFile(configPath, config)
  const { owner } = await runPluginSupervisor(configPath, hash(config))
  if (process.argv.includes('shutdown-reject'))
    owner.shutdown = async () => {
      throw Object.assign(new Error('Fictional owner record write failure'), { code: 'EIO' })
    }
  process.on('message', (message) => {
    if (message === 'ping') process.send?.({ event: 'pong' })
    if (message !== 'adopt') return
    void (async () => {
      const runId = randomUUID()
      const run = join(root, 'host/runs', runId)
      await mkdir(run, { recursive: true })
      const entry = join(run, 'plugin.mjs')
      await writeFile(
        entry,
        `
import {spawn} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
process.on('SIGTERM',()=>{});
child.once('message',()=>{
writeFileSync(${JSON.stringify(join(run, 'pids.json'))},JSON.stringify({server:process.pid,child:child.pid}));
process.send({channel:'brocrew-plugin-node:v1',runId:process.env.BROCREW_PLUGIN_RUN_ID,type:'listening',port:1});
});
setInterval(()=>{},1000);
`,
      )
      const launch = join(run, 'launch.json')
      await writeFile(
        launch,
        JSON.stringify({
          entry,
          home: run,
          runId,
          pluginId: 'fictional',
          releaseDigest: 'f'.repeat(64),
        }),
      )
      const guardian = fork(files.guardian, [launch], {
        execPath: files.node,
        execArgv: [],
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        env: { ...process.env, BROCREW_PLUGIN_RUN_ID: runId },
      })
      guardian.on('message', (value: { type?: string; pid?: number; birth?: string }) => {
        if (value.type === 'group')
          guardian.send({
            channel: 'brocrew-plugin-node:v1',
            runId,
            type: 'admit',
            pid: value.pid,
            birth: value.birth,
          })
        if (value.type !== 'listening') return
        // The physical guardian is real; only the host's lost proof is planted.
        const exited = Promise.reject(new Error('Fictional lost host exit proof'))
        void exited.catch(() => undefined)
        owner.adopt({ stop() {}, exited, descendantsGone: async () => false })
        process.send?.({ event: 'adopted', runId, guardian: guardian.pid })
      })
    })().catch((error) => {
      console.error(error)
      process.exit(2)
    })
  })
  process.send?.({ event: 'ready' })
}
void main().catch((error) => {
  console.error(error)
  process.exit(2)
})
