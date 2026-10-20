// Inert owned-process proof: the real Chrome package can only start the supplied fake browser.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import { preparePluginNodeRuntime, runtimeFiles } from '../src/main/plugins/node-runtime'
import { verifyChromeUiArchive } from './chrome-ui-archive'
import { liveGroupMembers, stopGroups } from '../resources/plugin-host/process-groups.mjs'
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
async function wait<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 240; i++) {
    const value = await read()
    if (value !== undefined) return value
    await delay(50)
  }
  throw new Error('fictional-process-proof-timeout')
}
export async function owner(config: {
  root: string
  resources: string
  archive: string
  browser: string
}) {
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: config.resources,
    durableRoot: join(config.root, 'runtimes'),
  })
  const checked = verifyChromeUiArchive(await readFile(config.archive))
  const host = createPluginNodeHost({
    root: join(config.root, 'host'),
    runtime,
    browserExecutable: config.browser,
  })
  const child = await host.start({
    package: checked.verified,
    releaseDigest: checked.release.archive.sha256,
  })
  const ready = await child.ready()
  const headers = { ...ready.admin().headers, 'content-type': 'application/json' }
  const made = await fetch(ready.origin + '/v1/profiles', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'fir' }),
  })
  if (made.status !== 201) throw new Error('fictional-profile-create-failed')
  void fetch(ready.origin + '/v1/profiles/fir/open', {
    method: 'POST',
    headers,
    body: '{}',
    signal: AbortSignal.timeout(20000),
  }).catch(() => {})
  const ids = await wait(async () => {
    try {
      return JSON.parse(
        await readFile(join(config.root, 'host/data/chrome/fake-browser.json'), 'utf8'),
      ) as { pid: number; child: number }
    } catch {
      return undefined
    }
  })
  if (!(await liveGroupMembers(ready.serverPid)).includes(ids.child))
    throw new Error('fictional-descendant-missing')
  return { host, child, ready, ids }
}
export async function proof(config: {
  root: string
  resources: string
  archive: string
  bundle: string
}) {
  await mkdir(config.root, { recursive: true, mode: 0o700 })
  const runtime = await preparePluginNodeRuntime({
    resourcesRoot: config.resources,
    durableRoot: join(config.root, 'runtime'),
  })
  const paths = await runtimeFiles(runtime)
  const browser = join(config.root, 'fake-browser')
  await writeFile(
    browser,
    `#!${paths.node}\nimport fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});\nfs.writeFileSync(path.join(process.env.BROCREW_CHROME_DATA,'fake-browser.json'),JSON.stringify({pid:process.pid,child:child.pid}));\nprocess.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`,
    { mode: 0o700 },
  )
  let assertions = 0
  for (const kind of ['stop', 'crash', 'quit'] as const) {
    const root = join(config.root, kind)
    await mkdir(root, { mode: 0o700 })
    const own = await owner({ root, resources: config.resources, archive: config.archive, browser })
    try {
      if (kind === 'crash') process.kill(own.ready.serverPid, 'SIGKILL')
      const result =
        kind === 'quit'
          ? await own.host.stop()
          : kind === 'crash'
            ? await own.child.exited
            : await own.child.stop()
      if (
        !result.exited ||
        !(await liveGroupMembers(own.ready.serverPid)).every(
          (pid) => pid !== own.ids.pid && pid !== own.ids.child,
        ) ||
        (await liveGroupMembers(own.ready.serverPid)).length
      )
        throw new Error('fictional-group-cleanup-failed')
      const receipt = JSON.parse(await readFile(own.child.receiptPath, 'utf8'))
      if (receipt.exited !== true || receipt.runId !== own.child.runId)
        throw new Error('fictional-receipt-missing')
      if ((await stat(join(root, 'host/data/chrome/downloads'))).mode & 0o077)
        throw new Error('fictional-download-permissions')
      assertions += 4
    } finally {
      await own.host.stop()
    }
  }
  const root = join(config.root, 'parent-crash')
  await mkdir(root, { mode: 0o700 })
  const client = fork(config.bundle, [], {
    execPath: paths.node,
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      BROBOT_PLUGIN_NODE_PROOF_CHILD: JSON.stringify({
        root,
        resources: config.resources,
        archive: config.archive,
        browser,
      }),
    },
  })
  const message = await Promise.race([
    once(client, 'message'),
    once(client, 'exit').then(() => {
      throw new Error('fictional-client-exited')
    }),
  ])
  const facts = message[0] as {
    receiptPath: string
    runId: string
    serverPid: number
    pid: number
    descendant: number
    failed?: boolean
  }
  if (facts.failed || !facts.receiptPath) throw new Error('fictional-client-failed')
  client.kill('SIGKILL')
  await once(client, 'close')
  await wait(async () => {
    try {
      const receipt = JSON.parse(await readFile(facts.receiptPath, 'utf8'))
      return receipt.exited === true && receipt.runId === facts.runId ? true : undefined
    } catch {
      return undefined
    }
  })
  if (
    !(await liveGroupMembers(facts.serverPid)).every(
      (pid) => pid !== facts.pid && pid !== facts.descendant,
    ) ||
    (await liveGroupMembers(facts.serverPid)).length
  ) {
    await stopGroups([facts.serverPid])
    throw new Error('fictional-orphan-cleanup-failed')
  }
  assertions += 3
  return {
    passed: true,
    assertions,
    realPackage: true,
    fakeBrowser: true,
    stop: true,
    serverCrash: true,
    quit: true,
    parentCrash: true,
  }
}
if (process.env.BROBOT_PLUGIN_NODE_PROOF_CHILD) {
  void owner(JSON.parse(process.env.BROBOT_PLUGIN_NODE_PROOF_CHILD))
    .then(({ child, ready, ids }) => {
      process.send?.({
        receiptPath: child.receiptPath,
        runId: child.runId,
        serverPid: ready.serverPid,
        pid: ids.pid,
        descendant: ids.child,
      })
      setInterval(() => {}, 1000)
    })
    .catch(() => {
      process.send?.({ failed: true })
      process.exit(1)
    })
}
