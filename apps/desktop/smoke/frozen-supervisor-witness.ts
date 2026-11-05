// App-side SOURCE driver. The owner is only the separately spawned production entry.cjs.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { tar } from '../test/plugin-package-fixtures'
import { verifyPluginPackage } from '../src/main/plugins/package-verifier'
import { createPluginSupervisorLauncher } from '../src/main/plugins/supervisor/launcher'
import {
  PluginWorkspaceLease,
  pluginWorkspaceIdentity,
} from '../src/main/plugins/supervisor/client'
import { connectPluginSettings } from '../src/main/plugins/lifecycle/settings-client'
import { registerPluginSettings } from '../src/main/plugins/settings'
import { PluginPageTools } from '../src/main/plugins/ui/tool-rpc'
import { pluginStartupDiagnostic } from '../src/main/plugins/startup-failure'
import type { PluginSettingsReply } from '../src/shared/plugin-settings'
import { PLUGIN_PAGE_CHANNEL } from '../src/shared/plugin-page'
import { liveGroupMembers } from '../resources/plugin-host/process-groups.mjs'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const id = 'fictional-lantern'
const target = { os: 'darwin' as const, cpu: 'arm64' as const }
const runtimeReply = z.object({
  version: z.string(),
  pid: z.number().int().positive(),
  runId: z.uuid(),
  bootstrap: z.object({
    dataSchema: z.number(),
    previousVersion: z.string().optional(),
    previousDataSchema: z.number().optional(),
  }),
})
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function bounded<T>(work: Promise<T>, label: string, limit = 35_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`frozen-witness-deadline: ${label}; captured processes retained`)),
          limit,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
async function wait<T>(read: () => Promise<T>, limit = 30_000): Promise<T> {
  const until = performance.now() + limit
  let last: unknown
  do {
    try {
      return await read()
    } catch (error) {
      last = error
    }
    await pause(30)
  } while (performance.now() < until)
  throw new Error('frozen-witness-timeout', { cause: last })
}

/** Both independent archives use this one builder and the real package verifier. */
export async function packages(directory: string, sourceCommit: string) {
  await mkdir(directory)
  const refs = []
  for (const major of [1, 2]) {
    const version = `${major}.0.0`,
      tool = `lantern.v${major}`
    const inputSchema = {
      type: 'object',
      properties: {
        value: { type: major === 1 ? 'string' : 'integer' },
        write: { type: 'boolean' },
        error: { type: 'boolean' },
      },
      additionalProperties: false,
    }
    const tools = [{ name: tool, description: `Fictional lantern ${major}`, inputSchema }]
    const main = String.raw`
import fs from 'node:fs'; import path from 'node:path'; import readline from 'node:readline';
const home = process.env.BROCREW_PLUGIN_DATA;
const boot = JSON.parse(process.env.BROCREW_PLUGIN_BOOTSTRAP);
const version = VERSION, tool = TOOL, tools = TOOLS;
const lives = path.join(home,'lives.jsonl');
const old = fs.existsSync(lives) ? fs.readFileSync(lives,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
for (const prior of old.filter(x=>x.event==='start')) {
  try { process.kill(prior.pid,0); throw new Error('fictional-overlapping-runtime'); }
  catch(e) { if(e.code!=='ESRCH') throw e; }
}
const entry = {event:'start',pid:process.pid,runId:process.env.BROCREW_PLUGIN_RUN_ID,version,bootstrap:boot};
fs.appendFileSync(lives,JSON.stringify(entry)+'\n');
process.on('SIGTERM',()=>{fs.appendFileSync(lives,JSON.stringify({event:'stop',pid:process.pid})+'\n');process.exit(0)});
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const p=JSON.parse(line); if(p.id===undefined || !p.method) return;
 const reply = result=>send({jsonrpc:'2.0',id:p.id,result});
 if(p.method==='initialize') {
  if(version==='2.0.0' && fs.existsSync(path.join(home,'hold-v2'))) {
   fs.writeFileSync(path.join(home,'initializing-v2.json'),JSON.stringify(entry));
   while(fs.existsSync(path.join(home,'hold-v2'))) await new Promise(r=>setTimeout(r,20));
  }
  return reply({protocolVersion:p.params.protocolVersion,serverInfo:{name:'fictional-lantern',version},capabilities:{tools:{}}});
 }
 if(p.method==='tools/list') return reply({tools});
 if(p.method==='tools/call') {
  if(p.params.name!==tool) return send({jsonrpc:'2.0',id:p.id,error:{code:-32601,message:'Retired fictional action'}});
  const args=p.params.arguments??{};
  if(args.error) return send({jsonrpc:'2.0',id:p.id,error:{code:-32000,message:'Fictional lantern rejected',data:{version}}});
  if(args.write) {fs.writeFileSync(path.join(home,'opaque.bin'),Buffer.from([0,255,3,4]));fs.appendFileSync(path.join(home,'actions.jsonl'),JSON.stringify({version,args})+'\n')}
  return reply({content:[],structuredContent:{version,pid:process.pid,runId:entry.runId,bootstrap:boot,arguments:args}});
 }
 return send({jsonrpc:'2.0',id:p.id,error:{code:-32601,message:'Unknown fictional method'}});
});
`
      .replace('VERSION', JSON.stringify(version))
      .replace('TOOL', JSON.stringify(tool))
      .replace('TOOLS', JSON.stringify(tools))
    const files = new Map([
      ['main.mjs', Buffer.from(main)],
      ['tools.json', Buffer.from(JSON.stringify({ tools }))],
      [
        'ui/index.html',
        Buffer.from(
          `<!doctype html><title>Fictional lantern ${major}</title><p>Version ${major} settings</p>`,
        ),
      ],
    ])
    const manifest = {
      format: 3,
      id,
      version,
      sourceCommit,
      name: 'Fictional lantern',
      description: 'Offline component witness',
      authors: ['Fictional Keeper'],
      platforms: [target],
      permissions: { description: 'Write fictional scratch data' },
      files: [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha(bytes) })),
      runtime: { kind: 'node', entry: 'main.mjs' },
      mcp: { transport: 'stdio' },
      tools: { source: 'mcp', inventory: 'tools.json' },
      settings: {
        page: { entry: 'ui/index.html', assets: ['ui/index.html'] },
        fields: inputSchema,
      },
      ui: [
        {
          id: 'action',
          slot: 'composer.accessory',
          view: { label: `Fictional action ${major}` },
          invoke: { tool, arguments: { value: major === 1 ? 'one' : 2 } },
        },
      ],
      lifecycle: { stop: { signal: 'SIGTERM', graceMs: 300 }, dataOnRemove: 'keep' },
      data: { schema: major, migrateOnStart: true },
    }
    const archive = tar([
      { path: 'plugin.json', body: Buffer.from(JSON.stringify(manifest)) },
      ...[...files].map(([path, body]) => ({ path, body })),
    ])
    const ref = {
      source: join(directory, `${id}-${version}.tar`),
      sha256: sha(archive),
      bytes: archive.length,
    }
    verifyPluginPackage(
      archive,
      { sha256: ref.sha256, bytes: ref.bytes, compression: 'tar' },
      { target, appVersion: '1.0.0' },
    )
    await writeFile(ref.source, archive, { flag: 'wx', mode: 0o600 })
    refs.push(ref)
  }
  return refs
}

export interface SpawnRecord {
  command: string
  argv: string[]
  child: ChildProcess
  exited: Promise<{ code: number | null; signal: string | null }>
}
export async function witness(options: {
  root: string
  resources: string
  refs: Awaited<ReturnType<typeof packages>>
  spawns: SpawnRecord[]
  entryHash: string
}) {
  const global = join(options.root, 'p'),
    workspace = join(options.root, 'w'),
    home = join(global, 'host/data', id)
  await mkdir(workspace, { mode: 0o700 })
  const catalogue = { bytes: Buffer.from('{"format":3,"entries":[]}'), signature: Buffer.alloc(0) }
  const cataloguePath = join(options.root, 'catalogue.json')
  await writeFile(cataloguePath, catalogue.bytes, { flag: 'wx', mode: 0o600 })
  const personKey = 'a'.repeat(64)
  const launch = createPluginSupervisorLauncher({
    root: global,
    workspaceRoots: [workspace],
    resourcesRoot: options.resources,
    lifecycle: {
      source: 'repo-list',
      appVersion: '1.0.0',
      catalogue: cataloguePath,
      catalogueSha256: sha(catalogue.bytes),
      personKey,
      names: { [id]: 'Fictional lantern' },
    },
  })
  let lease: PluginWorkspaceLease | undefined
  let settings: Awaited<ReturnType<typeof connectPluginSettings>> | undefined
  const projection = {
    workspaceId: pluginWorkspaceIdentity(workspace),
    applied: async () => {},
    revoke: async () => true,
    reconcile: async () => {},
  }
  const attach = async () => {
    lease = await PluginWorkspaceLease.attach({
      root: global,
      workspaceRoot: workspace,
      generation: randomUUID(),
      build: 'frozen-witness',
      launch,
    })
    settings = await wait(() =>
      connectPluginSettings({
        path: join(global, 'person-control/person.sock'),
        personKey,
        root: global,
        pinnedPublicKey: null,
        repoCatalogueSha256: sha(catalogue.bytes),
        target,
        appVersion: '1.0.0',
        catalogue,
        projection,
        download: async () => {
          throw new Error('Network forbidden')
        },
      }),
    )
    assert.ok(settings.host)
  }
  // The real settings.ts handler validates every card. Only its Electron window boundary is inert.
  const validatedCards = async () => {
    let handler: Parameters<IpcMain['handle']>[1] = () => {
      throw new Error('No Settings handler')
    }
    const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false })
    const owner = Object.assign(new EventEmitter(), {
      webContents: sender,
      isDestroyed: () => false,
    })
    registerPluginSettings(
      {
        handle: (_channel, fn) => {
          handler = fn
        },
      },
      () => owner as unknown as BrowserWindow,
      settings,
    )
    const result = (await handler(
      { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent,
      { kind: 'status' },
    )) as PluginSettingsReply
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(result.ok && result.cards)
    return result.cards
  }
  const screen = async () => {
    const value = await settings!.screen(id)
    assert.ok(value.tools)
    return { value, page: new PluginPageTools(value.tools) }
  }
  const call = (page: PluginPageTools, tool: string, args: Record<string, unknown> = {}) =>
    page.invoke({
      channel: PLUGIN_PAGE_CHANNEL,
      requestId: randomUUID(),
      method: 'callTool',
      params: { tool, arguments: args },
    })
  const result = async (
    page: PluginPageTools,
    tool: string,
    args: Record<string, unknown> = {},
  ) => {
    const packet = await call(page, tool, args)
    assert.equal(packet.status, 'result', JSON.stringify(packet))
    assert.ok(packet.status === 'result')
    return runtimeReply.parse(packet.result.structuredContent)
  }
  const ownerSpawn = () => {
    const record = options.spawns.at(-1)!
    assert.equal(record.argv[0], join(global, 'supervisor-entries', options.entryHash, 'entry.cjs'))
    assert.notEqual(record.child.pid, process.pid)
    return record
  }
  const gone = async (pid: number) =>
    wait(async () => {
      assert.deepEqual(await liveGroupMembers(pid), [])
      return true
    })
  const exactExit = async (runId: string, digest: string) =>
    wait(async () => {
      const receipt = JSON.parse(
        await readFile(join(global, 'host/runs', runId, 'exit.json'), 'utf8'),
      )
      assert.equal(receipt.runId, runId)
      assert.equal(receipt.pluginId, id)
      assert.equal(receipt.releaseDigest, digest)
      assert.equal(receipt.exited, true)
      return receipt
    })
  try {
    await attach()
    const firstOwner = ownerSpawn()
    assert.equal(sha(await readFile(firstOwner.argv[0]!)), options.entryHash)
    // A second production launcher executes the same frozen artifact and loses the owner fence.
    await assert.rejects(launch())
    assert.match(String(pluginStartupDiagnostic(launch.diagnostic())?.stderr), /Plugin busy/)
    const contender = ownerSpawn()
    assert.equal((await bounded(contender.exited, 'busy contender exit')).code, 1)
    const beforeInstall = await validatedCards()
    assert.equal(beforeInstall.length, 0)
    await settings!.inspectPackage!({ source: options.refs[0]!.source })
    await settings!.applyPackage!(options.refs[0]!, 'install')
    assert.equal((await validatedCards())[0]?.installedVersion, '1.0.0')
    const old = await screen()
    const first = await result(old.page, 'lantern.v1', { value: 'one', write: true })
    assert.equal(first.version, '1.0.0')
    const installId = old.value.binding.installId
    const opaque = await readFile(join(home, 'opaque.bin')),
      actions = await readFile(join(home, 'actions.jsonl'))
    assert.deepEqual(opaque, Buffer.from([0, 255, 3, 4]))
    const error = await call(old.page, 'lantern.v1', { error: true })
    assert.equal(error.status, 'protocol-error')
    assert.ok(error.status === 'protocol-error')
    assert.equal(error.error.code, -32000)
    const oldAction = (await settings!.host!.snapshot()).contributions.find(
      (one) => one.kind === 'ui.button',
    )!
    assert.ok(oldAction)
    // Hold the new package during real MCP initialize, then kill only the captured owner child.
    await writeFile(join(home, 'hold-v2'), 'fictional gate', { flag: 'wx', mode: 0o600 })
    await settings!.inspectPackage!({ source: options.refs[1]!.source })
    const updating = settings!.applyPackage!(options.refs[1]!, 'update').then(
      () => ({ succeeded: true }),
      () => ({ succeeded: false }),
    )
    const interrupted = await wait(async () =>
      JSON.parse(await readFile(join(home, 'initializing-v2.json'), 'utf8')),
    )
    const effects = await Promise.all(
      (await readdir(join(global, 'lifecycle-effects')))
        .filter((name) => name.endsWith('.json'))
        .map(async (name) =>
          JSON.parse(await readFile(join(global, 'lifecycle-effects', name), 'utf8')),
        ),
    )
    const pendingUpdate = effects.find(
      (effect) => effect.action === 'update' && effect.phase === 'prepared',
    )
    assert.ok(pendingUpdate, 'Crash must interrupt a durably prepared update')
    assert.equal(pendingUpdate.installId, installId)
    assert.equal(interrupted.bootstrap.previousVersion, '1.0.0')
    assert.equal(interrupted.bootstrap.previousDataSchema, 1)
    assert.notEqual(interrupted.runId, first.runId)
    await exactExit(first.runId, options.refs[0]!.sha256)
    await gone(first.pid)
    lease!.abandon()
    lease = undefined
    assert.equal(firstOwner.child.kill('SIGKILL'), true)
    assert.equal((await bounded(firstOwner.exited, 'crashed owner exit')).signal, 'SIGKILL')
    assert.equal((await updating).succeeded, false)
    await gone(interrupted.pid)
    // The killed owner cannot write an exit receipt. Physical group absence is a separate check.
    await settings!.close().catch(() => {})
    settings = undefined
    await rm(join(home, 'hold-v2'))
    await attach()
    const recoveredOwner = ownerSpawn()
    const cards = await wait(async () => {
      const cards = await validatedCards()
      assert.equal(cards[0]?.installedVersion, '2.0.0')
      assert.equal(cards[0]?.state, 'Running')
      return cards
    })
    const current = await screen()
    assert.equal(current.value.binding.installId, installId)
    assert.notEqual(current.value.binding.releaseDigest, old.value.binding.releaseDigest)
    assert.match(
      Buffer.from(current.value.verified.readFile('ui/index.html')!).toString(),
      /Version 2 settings/,
    )
    const second = await result(current.page, 'lantern.v2', { value: 2 })
    assert.equal(second.version, '2.0.0')
    assert.equal(second.bootstrap.dataSchema, 2)
    assert.equal(second.bootstrap.previousVersion, '1.0.0')
    assert.equal(second.bootstrap.previousDataSchema, 1)
    const recoveredEffect = JSON.parse(
      await readFile(
        join(global, 'lifecycle-effects', pendingUpdate.operationId + '.json'),
        'utf8',
      ),
    )
    assert.equal(recoveredEffect.phase, 'committed')
    assert.equal(recoveredEffect.operationId, pendingUpdate.operationId)
    assert.equal(current.value.verified.manifest.format, 3)
    assert.deepEqual(
      (current.value.verified.manifest as { settings?: { fields?: unknown } }).settings?.fields,
      {
        type: 'object',
        properties: {
          value: { type: 'integer' },
          write: { type: 'boolean' },
          error: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    )
    assert.notEqual(second.runId, interrupted.runId)
    const retired = await settings!.host!.request({ kind: 'activate', handle: oldAction.handle })
    assert.ok('error' in retired)
    await assert.rejects(call(old.page, 'lantern.v1'))
    assert.notEqual((await call(current.page, 'lantern.v1')).status, 'result')
    assert.deepEqual(await readFile(join(home, 'opaque.bin')), opaque)
    assert.deepEqual(await readFile(join(home, 'actions.jsonl')), actions)
    current.page.close()
    old.page.close()
    await settings!.close()
    settings = undefined
    assert.equal(await lease!.close(), true)
    lease = undefined
    assert.equal((await bounded(recoveredOwner.exited, 'drained owner exit')).code, 0)
    await exactExit(second.runId, options.refs[1]!.sha256)
    await gone(second.pid)
    const stopped = JSON.parse(await readFile(join(global, 'supervisor/owner.json'), 'utf8'))
    assert.equal(stopped.phase, 'stopped')
    // Clean drain and another launch recover the committed package without replaying actions.
    await attach()
    const finalOwner = ownerSpawn()
    const final = await screen()
    assert.equal(final.value.binding.installId, installId)
    const third = await result(final.page, 'lantern.v2', { value: 3 })
    assert.notEqual(third.runId, second.runId)
    assert.deepEqual(await readFile(join(home, 'actions.jsonl')), actions)
    final.page.close()
    assert.deepEqual(await settings!.uninstall(id), { data: 'kept', cleanup: 'not-requested' })
    assert.deepEqual(await readFile(join(home, 'opaque.bin')), opaque)
    assert.deepEqual(await readFile(join(home, 'actions.jsonl')), actions)
    await exactExit(third.runId, options.refs[1]!.sha256)
    await gone(third.pid)
    assert.equal(
      (await validatedCards()).some((card) => card.installed),
      false,
    )
    await settings!.close()
    settings = undefined
    assert.equal(await lease!.close(), true)
    lease = undefined
    assert.equal((await bounded(finalOwner.exited, 'final owner exit')).code, 0)
    assert.equal((await readdir(join(global, 'supervisor-entries'))).length, 1)
    return {
      passed: true,
      scope: 'Frozen supervisor component witness on macOS arm64',
      cards,
      installId,
      recoveredOperation: pendingUpdate.operationId,
      runs: [first, interrupted, second, third],
      exactExitReceipts: [first.runId, second.runId, third.runId],
      crashGroupGone: interrupted.pid,
      noActionReplay: true,
      guardianSigkill: 'UNRUN',
    }
  } finally {
    if (settings) await bounded(settings.close(), 'failure person close').catch(() => {})
    if (lease) await bounded(lease.close(), 'failure lease close').catch(() => {})
    // No rm or speculative process signaling: failed proofs retain the complete fictional root.
  }
}
