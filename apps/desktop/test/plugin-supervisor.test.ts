import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConnection, createServer } from 'node:net'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { ownedProcessGroup } from './fixtures/owned-process-group'
import {
  PluginSupervisorAttachment,
  PluginWorkspaceLease,
  pluginSupervisorRoot,
  supervisorRequest,
} from '../src/main/plugins/supervisor/client'
import {
  OWNER_LIMITS,
  OWNER_WIRE,
  pack,
  RENEW_RETRY,
  secret,
  unpack,
  type Command,
} from '../src/main/plugins/supervisor/protocol'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { bundleAWorker } from './helpers/bundle-a-worker'
import * as Earlier from './helpers/supervisor-protocol-before-renew-retry'

const roots: string[] = [],
  owners: PluginSupervisor[] = [],
  clients: PluginWorkspaceLease[] = [],
  children: ChildProcess[] = []
let bundle = '',
  output = ''
beforeAll(async () => {
  if (process.platform === 'win32') return
  output = mkdtempSync(join(realpathSync(tmpdir()), 'fictional-owner-bundle-'))
  bundle = await bundleAWorker('test/fixtures/owned-process-group.ts', output, 'owner.cjs')
})
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close()
  for (const owner of owners.splice(0)) await owner.shutdown()
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exit = once(child, 'exit')
    child.kill('SIGKILL')
    await exit
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
afterAll(() => {
  if (output) rmSync(output, { recursive: true, force: true })
})
function fixture() {
  // Unix sockets have a native path limit. Still a fresh private fictional root, never app data.
  const parent = realpathSync(mkdtempSync('/tmp/fictional-owner-'))
  roots.push(parent)
  const root = join(parent, 'plugins')
  const workspaces = Array.from({ length: 4 }, (_, index) => join(parent, `workspace-${index}`))
  for (const workspace of workspaces) mkdirSync(workspace, { mode: 0o700 })
  return { parent, root, workspaces }
}
async function attach(
  root: string,
  workspaceRoot: string,
  extra: Partial<Parameters<typeof PluginWorkspaceLease.attach>[0]> = {},
) {
  const client = await PluginWorkspaceLease.attach({
    root,
    workspaceRoot,
    generation: randomUUID(),
    build: 'fictional-build',
    ...extra,
  })
  clients.push(client)
  return client
}
const program = `
const { PluginSupervisor, ownedProcessGroup } = require(process.argv[1]);
const { spawn } = require('node:child_process');
(async () => {
  const owner = await PluginSupervisor.start({ root: process.argv[2], workspaceRoots: [], tickEvery: 20 });
  owner.closed.then(() => process.exit(0));
  let evidence = {};
  process.on('message', async (message) => {
    if (['fail-exit','fail-desc-sync','fail-desc-async'].includes(message)) {
      evidence = {aStop:false,aExit:false,aDesc:false,bStop:false,bExit:false,bDesc:false};
      owner.adopt({
        stop(){evidence.aStop=true;throw Object.assign(new Error('fictional failed signal'),{code:'ESRCH'})},
        get exited(){evidence.aExit=true;return message==='fail-exit'?Promise.reject(new Error('fictional unproved exit')):Promise.resolve()},
        descendantsGone(){evidence.aDesc=true;if(message==='fail-desc-sync')throw new Error('fictional unproved descendants');if(message==='fail-desc-async')return Promise.reject(new Error('fictional unproved descendants'));return Promise.resolve(true)}
      });
      let exitB;
      const exitedB = new Promise(resolve=>{exitB=resolve});
      owner.adopt({stop(){evidence.bStop=true;exitB()},get exited(){evidence.bExit=true;return exitedB},async descendantsGone(){evidence.bDesc=true;return true}});
      process.send({kind:'adopted'});
    }
    if (message==='inspect') process.send({kind:'evidence',...evidence});
    if (message === 'adopt') {
      const code = "const{spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); process.on('SIGTERM',()=>{if(child.exitCode!==null||child.signalCode!==null)process.exit(0);child.once('exit',()=>process.exit(0));child.kill('SIGTERM')}); setInterval(()=>{},1000); process.send('ready');";
      const child = spawn(process.execPath, ['-e', code], { detached: true, stdio: ['ignore','ignore','ignore','ipc'], env: {...process.env, NODE_OPTIONS:''} });
      owner.adopt(ownedProcessGroup(child));
      child.once('message', () => process.send({ kind: 'adopted', pid: child.pid }));
    }
    if (message === 'block') {
      owner.adopt({stop(){},exited:new Promise(()=>{}),async descendantsGone(){return false}});
      process.send({kind:'blocked-child'});
    }
  });
  process.send({kind:'ready'});
})().catch(()=>process.exit(1));
`
function message(child: ChildProcess): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('fictional owner did not answer')), 10_000)
    const received = (value: Record<string, unknown>) => finish(undefined, value)
    const exited = () => finish(new Error('fictional owner exited before answering'))
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      clearTimeout(timeout)
      child.off('message', received)
      child.off('exit', exited)
      if (error) reject(error)
      else resolve(value!)
    }
    child.once('message', received)
    child.once('exit', exited)
  })
}
async function launch(root: string) {
  const child = spawn(process.execPath, ['-e', program, bundle, root], {
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  children.push(child)
  expect(await message(child)).toEqual({ kind: 'ready' })
  return child
}

/**
 * Moves the owner's socket aside and listens in its place. Bytes pass both ways, except that a
 * reply can be lost (the client's socket closes) or held (the client's own deadline ends it).
 * Either way the owner has already acted on the request. Requests and replies are kept.
 */
async function interpose(root: string) {
  const path = join(root, 'supervisor/owner.sock'),
    aside = join(root, 'supervisor/owner-aside.sock')
  renameSync(path, aside)
  const requests: string[] = [],
    replies: string[] = [],
    plan = { lose: 0, hold: 0 },
    count = { settled: 0 }
  const server = createServer((client) => {
    const owner = createConnection(aside)
    let challenged = false,
      replied = false
    client.on('error', () => owner.destroy())
    // The client closes only after it has acted on the reply it read.
    client.on('close', () => {
      owner.destroy()
      if (replied) count.settled++
    })
    owner.on('error', () => client.destroy())
    client.on('data', (chunk: Buffer) => {
      requests.push(chunk.toString())
      owner.write(chunk)
    })
    owner.on('data', (chunk: Buffer) => {
      if (!challenged) {
        challenged = true
        client.write(chunk)
        return
      }
      if (plan.lose > 0) {
        plan.lose--
        client.destroy()
      } else if (plan.hold > 0) plan.hold--
      else {
        replies.push(chunk.toString())
        replied = true
        client.end(chunk)
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(path, resolve))
  return {
    aside,
    requests,
    replies,
    plan,
    count,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      renameSync(aside, path)
    },
  }
}
const renewal = (key: string, packet: string) =>
  (unpack(key, 'request', packet.trim()) as { command: Extract<Command, { kind: 'renew' }> })
    .command
function ownerKey(root: string) {
  const storage = new SupervisorStorage(root, [], false)
  try {
    return storage.read()!.key
  } finally {
    storage.close()
  }
}
function stopReason(root: string) {
  const { phase, epoch } = JSON.parse(
    readFileSync(join(root, 'supervisor/owner.json'), 'utf8'),
  ) as {
    phase: string
    epoch: string
  }
  const path = join(root, 'supervisor/owner-stop.json')
  const stop = existsSync(path)
    ? (JSON.parse(readFileSync(path, 'utf8')) as { epoch: string; reason: string })
    : undefined
  return { phase, reason: stop?.epoch === epoch ? stop.reason : undefined }
}

describe.skipIf(process.platform === 'win32')(
  'one global plugin supervisor, fictional roots only',
  () => {
    it('reuses one incumbent for four workspaces, negotiates minor/features, and retains others when one quits', async () => {
      const { root, workspaces } = fixture()
      const child = await launch(root)
      const launchAgain = vi.fn(async () => {
        throw new Error('must reuse')
      })
      const first = await attach(root, workspaces[0]!, {
        launch: launchAgain,
        wire: { major: 1, minMinor: 0, maxMinor: 3, features: ['fictional-preview'] },
      })
      const rest = await Promise.all(
        workspaces.slice(1).map((workspace) => attach(root, workspace, { launch: launchAgain })),
      )
      expect(launchAgain).not.toHaveBeenCalled()
      expect(first.minor).toBe(0)
      expect(first.features).toEqual([])
      expect(new Set([first, ...rest].map((lease) => lease.lease)).size).toBe(4)
      expect(await first.close()).toBe(true)
      for (const client of rest) await client.renew()
      expect(child.exitCode).toBeNull()
      await expect(
        attach(root, workspaces[0]!, { wire: { ...OWNER_WIRE, major: 2 } }),
      ).rejects.toMatchObject({ code: 'incompatible' })
      await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
        code: 'busy',
      })
      const exited = once(child, 'exit')
      for (const client of rest) expect(await client.close()).toBe(true)
      await exited
      expect(child.exitCode).toBe(0)
    })
    it('last lease proves the actual child and its descendant group exited before a new owner starts', async () => {
      const { root, workspaces } = fixture(),
        child = await launch(root)
      const client = await attach(root, workspaces[0]!)
      const adopted = message(child)
      child.send('adopt')
      const reply = await adopted
      expect(reply.kind).toBe('adopted')
      const pid = reply.pid as number
      expect(() => process.kill(-pid, 0)).not.toThrow()
      const exited = once(child, 'exit')
      expect(await client.close()).toBe(true)
      await exited
      expect(() => process.kill(-pid, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }))
      const next = await PluginSupervisor.start({ root, workspaceRoots: [] })
      owners.push(next)
      expect(await next.shutdown()).toBe(true)
    })
    it.each(['sync ESRCH', 'async rejection'] as const)(
      '%s from gone A still stops live B and checks both exit/descendant witnesses',
      async (failure) => {
        const { root, workspaces } = fixture()
        const owner = await PluginSupervisor.start({ root, workspaceRoots: [] })
        owners.push(owner)
        const client = await attach(root, workspaces[0]!)
        const exitA = vi.fn(),
          descendantsA = vi.fn(async () => true)
        const stopA = vi.fn(() => {
          if (failure === 'sync ESRCH')
            throw Object.assign(new Error('fictional gone A'), { code: 'ESRCH' })
          return Promise.reject(new Error('fictional stop rejection'))
        })
        owner.adopt({
          stop: stopA,
          get exited() {
            exitA()
            return Promise.resolve()
          },
          descendantsGone: descendantsA,
        })
        const child = spawn(
          process.execPath,
          ['-e', "setInterval(()=>{},1000);process.send({kind:'ready'})"],
          {
            detached: true,
            env: { ...process.env, NODE_OPTIONS: '' },
            stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          },
        )
        children.push(child)
        expect(await message(child)).toEqual({ kind: 'ready' })
        expect(child.exitCode).toBeNull()
        expect(child.signalCode).toBeNull()
        const group = ownedProcessGroup(child)
        const stopB = vi.fn(() => group.stop()),
          exitB = vi.fn(),
          descendantsB = vi.fn(() => group.descendantsGone())
        owner.adopt({
          stop: stopB,
          get exited() {
            exitB()
            return group.exited
          },
          descendantsGone: descendantsB,
        })
        expect(await client.close()).toBe(true)
        await owner.closed
        for (const witness of [stopA, exitA, descendantsA, stopB, exitB, descendantsB])
          expect(witness).toHaveBeenCalledTimes(1)
        expect(child.signalCode).toBe('SIGTERM')
        expect(() => process.kill(-child.pid!, 0)).toThrow(
          expect.objectContaining({ code: 'ESRCH' }),
        )
      },
    )
    it.each(['fail-exit', 'fail-desc-sync', 'fail-desc-async'])(
      "%s keeps ownership, but never skips B or either child's witnesses",
      async (mode) => {
        const { root, workspaces } = fixture(),
          child = await launch(root)
        const client = await attach(root, workspaces[0]!)
        const adopted = message(child)
        child.send(mode)
        expect(await adopted).toEqual({ kind: 'adopted' })
        expect(await client.close()).toBe(false)
        const inspected = message(child)
        child.send('inspect')
        expect(await inspected).toEqual({
          kind: 'evidence',
          aStop: true,
          aExit: true,
          aDesc: true,
          bStop: true,
          bExit: true,
          bDesc: true,
        })
        expect(JSON.parse(readFileSync(join(root, 'supervisor/owner.json'), 'utf8')).phase).toBe(
          'blocked',
        )
        await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
          code: 'busy',
        })
      },
    )
    it('ESRCH in the OS-gone/Node-event gap never resolves the real exit witness', async () => {
      const child = Object.assign(new EventEmitter(), {
        pid: 404941,
        exitCode: null,
        signalCode: null,
      }) as ChildProcess
      const gone = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('fictional gone process group'), { code: 'ESRCH' })
      })
      try {
        const group = ownedProcessGroup(child),
          witnessed = vi.fn()
        const exited = group.exited.then(witnessed)
        expect(() => group.stop()).not.toThrow()
        expect(await group.descendantsGone()).toBe(true)
        expect(witnessed).not.toHaveBeenCalled()
        child.emit('exit', 0, null)
        await exited
        expect(witnessed).toHaveBeenCalledTimes(1)
      } finally {
        gone.mockRestore()
      }
    })
    it('a timeout is not exit evidence: no takeover after unproved cleanup or a killed owner', async () => {
      const { root, workspaces } = fixture(),
        child = await launch(root)
      const client = await attach(root, workspaces[0]!)
      const blocked = message(child)
      child.send('block')
      await blocked
      expect(await client.close()).toBe(false)
      expect(JSON.parse(readFileSync(join(root, 'supervisor/owner.json'), 'utf8')).phase).toBe(
        'blocked',
      )
      await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
        code: 'busy',
      })
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
      await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
        code: 'cleanup-pending',
      })
      unlinkSync(join(root, 'supervisor/owner.json'))
      await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
        code: 'cleanup-pending',
      })
    })
    it('revokes an expired lease on the monotonic clock; stale counters/hosts cannot renew it or reopen a draining owner', async () => {
      const { root, workspaces } = fixture()
      let now = 0
      const revoke = vi.fn(async () => {})
      const owner = await PluginSupervisor.start({
        root,
        workspaceRoots: [],
        now: () => now,
        revoke,
        tickEvery: 60_000,
      })
      owners.push(owner)
      const generation = randomUUID()
      const first = await attach(root, workspaces[0]!),
        second = await attach(root, workspaces[1]!, { generation })
      now = 30_000
      await second.renew()
      now = OWNER_LIMITS.expires
      await owner.tick()
      await expect(first.renew()).rejects.toMatchObject({ code: 'unavailable' })
      expect(revoke).toHaveBeenCalledTimes(1)
      await second.renew()
      const storage = new SupervisorStorage(root, [], false),
        record = storage.read()!
      try {
        await expect(
          supervisorRequest(storage, record, {
            kind: 'renew',
            workspace: createHash('sha256').update(workspaces[1]!).digest('hex'),
            generation,
            lease: second.lease,
            counter: 2,
            renewal: secret(),
          }),
        ).rejects.toMatchObject({ code: 'unavailable' })
        await expect(
          supervisorRequest(storage, record, {
            kind: 'renew',
            workspace: secret(),
            generation: randomUUID(),
            lease: second.lease,
            counter: 2,
            renewal: secret(),
          }),
        ).rejects.toMatchObject({ code: 'unavailable' })
        await expect(
          supervisorRequest(storage, record, {
            kind: 'renew',
            workspace: secret(),
            generation: randomUUID(),
            lease: first.lease,
            counter: 1,
            renewal: secret(),
          }),
        ).rejects.toMatchObject({ code: 'unavailable' })
      } finally {
        storage.close()
      }
      expect(await second.close()).toBe(true)
      await expect(attach(root, workspaces[2]!)).rejects.toMatchObject({ code: 'unavailable' })
    })
    it('a renewal whose reply was lost is tried again, the owner accepts it, and the lease stands', async () => {
      const { root, workspaces } = fixture()
      owners.push(await PluginSupervisor.start({ root, workspaceRoots: [], tickEvery: 60_000 }))
      const lost = vi.fn()
      const client = await attach(root, workspaces[0]!, { onLost: lost })
      expect(client.features).toContain(RENEW_RETRY)
      const key = ownerKey(root)
      const proxy = await interpose(root)
      try {
        proxy.plan.lose = 1
        await expect(client.renew()).rejects.toMatchObject({ code: 'unavailable' })
        await client.renew()
        await client.renew()
        const sent = proxy.requests.map((packet) => renewal(key, packet))
        expect(sent.map((command) => command.counter)).toEqual([1, 1, 2])
        expect(sent[0]!.renewal).toMatch(/^[a-f0-9]{64}$/)
        expect(sent[1]!.renewal).toBe(sent[0]!.renewal)
        expect(sent[2]!.renewal).not.toBe(sent[0]!.renewal)
        expect(lost).not.toHaveBeenCalled()
      } finally {
        await proxy.close()
      }
      expect(await client.close()).toBe(true)
      expect(stopReason(root)).toMatchObject({ phase: 'stopped', reason: 'released' })
    })
    it('a renewal that timed out is tried again by itself within the expiry, and the lease stands', async () => {
      const { root, workspaces } = fixture()
      owners.push(await PluginSupervisor.start({ root, workspaceRoots: [], tickEvery: 60_000 }))
      const lost = vi.fn()
      const client = await attach(root, workspaces[0]!, { onLost: lost })
      const key = ownerKey(root)
      const proxy = await interpose(root)
      try {
        proxy.plan.hold = 1
        const started = performance.now()
        await expect(client.renew()).rejects.toMatchObject({ code: 'unavailable' })
        expect(performance.now() - started).toBeGreaterThanOrEqual(OWNER_LIMITS.request - 50)
        // Nobody calls renew here: the retry comes before the next heartbeat would.
        await vi.waitFor(() => expect(proxy.count.settled).toBe(1), { timeout: 10_000 })
        await client.renew()
        const sent = proxy.requests.map((packet) => renewal(key, packet))
        expect(sent.map((command) => command.counter)).toEqual([1, 1, 2])
        expect(sent[1]!.renewal).toBe(sent[0]!.renewal)
        expect(lost).not.toHaveBeenCalled()
      } finally {
        await proxy.close()
      }
      expect(await client.close()).toBe(true)
    })
    it('refuses a replayed packet, an older renewal and another renewal under the last counter', async () => {
      const { root, workspaces } = fixture()
      owners.push(await PluginSupervisor.start({ root, workspaceRoots: [], tickEvery: 60_000 }))
      const lost = vi.fn()
      const client = await attach(root, workspaces[0]!, { onLost: lost })
      const storage = new SupervisorStorage(root, [], false),
        record = storage.read()!
      const proxy = await interpose(root)
      try {
        proxy.plan.lose = 1
        await expect(client.renew()).rejects.toMatchObject({ code: 'unavailable' })
        await client.renew()
        await client.renew()
        const [first, , last] = proxy.requests
        // A captured packet sent again answers another connection's challenge: no reply at all.
        const replay = createConnection(proxy.aside)
        replay.on('error', () => undefined)
        const answered: Buffer[] = []
        await once(replay, 'data')
        replay.on('data', (chunk: Buffer) => answered.push(chunk))
        const closed = once(replay, 'close')
        replay.end(last!)
        await closed
        expect(answered).toEqual([])
        // Sent afresh, the renewal whose retry was accepted is now older than the last one.
        const refusals = proxy.replies.length
        await expect(
          supervisorRequest(storage, record, renewal(record.key, first!)),
        ).rejects.toMatchObject({ code: 'unavailable' })
        // The last counter again, but not the renewal that set it.
        await expect(
          supervisorRequest(
            storage,
            record,
            Object.assign(renewal(record.key, last!), { renewal: secret() }),
          ),
        ).rejects.toMatchObject({ code: 'unavailable' })
        expect(
          proxy.replies
            .slice(refusals)
            .map((packet) => unpack(record.key, 'response', packet.trim())),
        ).toEqual([
          expect.objectContaining({ ok: false, code: 'unavailable' }),
          expect.objectContaining({ ok: false, code: 'unavailable' }),
        ])
        await client.renew()
        expect(lost).not.toHaveBeenCalled()
      } finally {
        await proxy.close()
        storage.close()
      }
      expect(await client.close()).toBe(true)
    })
    it("a build from before renew retries reads this owner's record and renews as it always did", async () => {
      const { root } = fixture()
      owners.push(await PluginSupervisor.start({ root, workspaceRoots: [], tickEvery: 60_000 }))
      const storage = new SupervisorStorage(root, [], false)
      // The earlier build reads owner.json with this same strict schema, here and before it
      // starts an owner of its own.
      const earlierRead = () =>
        Earlier.OwnerRecord.parse(JSON.parse(readFileSync(storage.record, 'utf8')))
      try {
        const record = earlierRead()
        expect(record).toMatchObject({
          phase: 'accepting',
          wire: { features: expect.arrayContaining([RENEW_RETRY]) },
        })
        const workspace = secret(),
          generation = randomUUID()
        // Only commands the earlier build's own strict schema accepts.
        const send = (command: Earlier.Command) =>
          supervisorRequest(storage, record, Earlier.Command.parse(command))
        const hello = (await send({
          kind: 'hello',
          workspace,
          generation,
          build: 'fictional-earlier-build',
          wire: Earlier.OWNER_WIRE,
        })) as { lease: string; features: string[] }
        expect(hello.features).toEqual([])
        const lease = hello.lease
        const renew = (counter: number) =>
          send({ kind: 'renew', workspace, generation, lease, counter })
        expect(await renew(1)).toEqual({ counter: 1 })
        expect(await renew(2)).toEqual({ counter: 2 })
        // With no renewal value there is no retry: the last counter again is refused, as before.
        await expect(renew(2)).rejects.toMatchObject({ code: 'unavailable' })
        expect(await renew(3)).toEqual({ counter: 3 })
        expect(await send({ kind: 'release', workspace, generation, lease })).toEqual({
          remaining: false,
        })
        await vi.waitFor(() => expect(earlierRead().phase).toBe('stopped'))
        expect(stopReason(root)).toEqual({ phase: 'stopped', reason: 'released' })
      } finally {
        storage.close()
      }
    })
    it('a client of this build renews against an owner from before renew retries', async () => {
      const { root, workspaces } = fixture()
      const storage = new SupervisorStorage(root, [], true)
      const record: Earlier.OwnerRecord = {
        version: 1,
        epoch: randomUUID(),
        key: secret(),
        phase: 'accepting',
        wire: Earlier.OWNER_WIRE,
      }
      storage.write(record)
      // Stands in for the earlier owner: its strict schema, its counter rule, and a dropped
      // socket for any request that schema refuses.
      const counters = new Map<string, number>(),
        received: Earlier.Command[] = [],
        plan = { lose: 0 }
      let dropped = 0
      const server = createServer((socket) => {
        const challenge = secret()
        socket.write(`${JSON.stringify({ challenge })}\n`)
        socket.once('data', (packet) => {
          let request: Earlier.Request
          try {
            request = Earlier.Request.parse(unpack(record.key, 'request', packet.toString().trim()))
            if (request.epoch !== record.epoch || request.challenge !== challenge) throw new Error()
          } catch {
            dropped++
            socket.destroy()
            return
          }
          const command = request.command
          received.push(command)
          const reply = (body: object) =>
            socket.end(
              pack(record.key, 'response', { nonce: request.nonce, epoch: record.epoch, ...body }),
            )
          if (command.kind === 'hello') {
            const lease = secret()
            counters.set(lease, 0)
            reply({
              ok: true,
              value: { lease, minor: 0, features: [], heartbeat: 15_000, expires: 60_000 },
            })
          } else if (command.kind === 'renew') {
            if (counters.get(command.lease) !== command.counter - 1)
              return reply({ ok: false, code: 'unavailable' })
            counters.set(command.lease, command.counter)
            if (plan.lose > 0) {
              plan.lose--
              socket.destroy()
              return
            }
            reply({ ok: true, value: { counter: command.counter } })
          } else if (command.kind === 'release') {
            counters.delete(command.lease)
            storage.write({ ...record, phase: 'stopped' })
            reply({ ok: true, value: { remaining: false } })
          } else reply({ ok: false, code: 'unavailable' })
        })
      })
      await new Promise<void>((resolve) => server.listen(storage.socket, resolve))
      try {
        const lost = vi.fn()
        const client = await attach(root, workspaces[0]!)
        expect(client.features).toEqual([])
        await client.renew()
        await client.renew()
        expect(await client.close()).toBe(true)
        expect(dropped).toBe(0)
        expect(received.map((command) => command.kind)).toEqual([
          'hello',
          'renew',
          'renew',
          'release',
        ])
        expect(received[0]).toMatchObject({ wire: OWNER_WIRE })
        expect(received.filter((command) => command.kind === 'renew')).toEqual([
          expect.objectContaining({ counter: 1 }),
          expect.objectContaining({ counter: 2 }),
        ])

        // A lost reply that the earlier owner did apply: its retry is refused at once, as the
        // earlier client would have ended there too, and the lease ends without waiting 60 s.
        storage.write(record)
        const second = await attach(root, workspaces[1]!, { onLost: lost })
        plan.lose = 1
        await expect(second.renew()).rejects.toMatchObject({ code: 'unavailable' })
        expect(lost).not.toHaveBeenCalled()
        await expect(second.renew()).rejects.toMatchObject({ code: 'unavailable' })
        expect(lost).toHaveBeenCalledTimes(1)
        expect(dropped).toBe(0)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
        storage.close()
      }
    })
    it("the owner's public record says why it began to drain", async () => {
      let now = 0
      const expired = fixture()
      const owner = await PluginSupervisor.start({
        root: expired.root,
        workspaceRoots: [],
        now: () => now,
        tickEvery: 60_000,
      })
      owners.push(owner)
      await attach(expired.root, expired.workspaces[0]!)
      now = OWNER_LIMITS.expires
      await owner.tick()
      expect(stopReason(expired.root)).toMatchObject({ phase: 'stopped', reason: 'lease-expired' })

      const idle = fixture()
      let later = 0
      const unused = await PluginSupervisor.start({
        root: idle.root,
        workspaceRoots: [],
        now: () => later,
        tickEvery: 60_000,
      })
      owners.push(unused)
      expect(stopReason(idle.root).reason).toBeUndefined()
      later = OWNER_LIMITS.expires
      await unused.tick()
      expect(stopReason(idle.root)).toMatchObject({ phase: 'stopped', reason: 'drain' })

      const shut = fixture()
      const stopping = await PluginSupervisor.start({ root: shut.root, workspaceRoots: [] })
      owners.push(stopping)
      await attach(shut.root, shut.workspaces[0]!)
      expect(await stopping.shutdown()).toBe(true)
      expect(stopReason(shut.root)).toMatchObject({ phase: 'stopped', reason: 'shutdown' })
    })
    it('requires the private capability, rejects replay/reflection/tampering, and bounds socket input', async () => {
      const { root } = fixture()
      const owner = await PluginSupervisor.start({ root, workspaceRoots: [] })
      owners.push(owner)
      const storage = new SupervisorStorage(root, [], false),
        record = storage.read()!
      try {
        expect(lstatSync(storage.socket).mode & 0o077).toBe(0)
        const value = {
          epoch: record.epoch,
          nonce: secret(),
          challenge: secret(),
          command: {
            kind: 'hello',
            workspace: secret(),
            generation: randomUUID(),
            build: 'fictional',
            wire: OWNER_WIRE,
          },
        }
        const packet = pack(record.key, 'request', value)
        expect(unpack(record.key, 'request', packet.trim())).toEqual(value)
        expect(() => unpack(secret(), 'request', packet.trim())).toThrow()
        expect(() => unpack(record.key, 'response', packet.trim())).toThrow()
        const socket = createConnection(storage.socket)
        await once(socket, 'data')
        const closed = once(socket, 'close')
        socket.end(packet) // MAC is valid, but this is not the connection's challenge.
        await closed
        const overflow = createConnection(storage.socket)
        await once(overflow, 'data')
        const overflowClosed = once(overflow, 'close')
        overflow.end(Buffer.alloc(OWNER_LIMITS.packet + 1, 120))
        await overflowClosed
      } finally {
        storage.close()
      }
    })
    it('fails closed on shared roots, workspace aliases, symlinks, unknown ownership and absent launchers', async () => {
      const { parent, root, workspaces } = fixture()
      const launch = vi.fn(async () => {})
      await expect(attach(root, workspaces[0]!)).rejects.toMatchObject({ code: 'unavailable' })
      expect(existsSync(root)).toBe(false)
      const alias = join(parent, 'alias')
      symlinkSync(workspaces[0]!, alias)
      expect(() => new SupervisorStorage(join(workspaces[0]!, 'plugins'), [alias], true)).toThrow()
      expect(existsSync(join(workspaces[0]!, 'plugins'))).toBe(false)
      chmodSync(parent, 0o777)
      await expect(attach(root, workspaces[0]!, { launch })).rejects.toMatchObject({
        code: 'unavailable',
      })
      expect(launch).not.toHaveBeenCalled()
      chmodSync(parent, 0o700)
      symlinkSync(workspaces[1]!, root)
      await expect(PluginSupervisor.start({ root, workspaceRoots: [] })).rejects.toMatchObject({
        code: 'unavailable',
      })
    })
    it('starts once through an injected launcher and drops an attachment that completes during quit', async () => {
      const { root, workspaces } = fixture()
      const lifetime = new PluginSupervisorAttachment()
      let continueLaunch!: () => void
      const held = new Promise<void>((resolve) => {
        continueLaunch = resolve
      })
      const launch = vi.fn(async () => {
        await held
        const owner = await PluginSupervisor.start({ root, workspaceRoots: [] })
        owners.push(owner)
      })
      lifetime.start({ root, workspaceRoot: workspaces[0]!, build: 'fictional', launch })
      lifetime.start({ root, workspaceRoot: workspaces[0]!, build: 'fictional', launch })
      const quit = lifetime.quit()
      continueLaunch()
      await quit
      expect(launch).toHaveBeenCalledTimes(1)
      expect(JSON.parse(readFileSync(join(root, 'supervisor/owner.json'), 'utf8')).phase).toBe(
        'stopped',
      )
    })
    it('closes admission before awaiting a pending child start; a late lease cannot reopen that owner', async () => {
      const { root, workspaces } = fixture()
      const owner = await PluginSupervisor.start({ root, workspaceRoots: [] })
      owners.push(owner)
      const client = await attach(root, workspaces[0]!)
      let finish!: () => void
      const pending = new Promise<void>((resolve) => {
        finish = resolve
      })
      const stop = vi.fn()
      const starting = owner.startChild(async () => {
        await pending
        return {
          stop,
          exited: Promise.resolve(),
          async descendantsGone() {
            return true
          },
        }
      })
      const closing = client.close()
      const record = join(root, 'supervisor/owner.json')
      await vi.waitFor(() =>
        expect(JSON.parse(readFileSync(record, 'utf8')).phase).toBe('draining'),
      )
      const launch = vi.fn(async () => {})
      await expect(attach(root, workspaces[1]!, { launch })).rejects.toMatchObject({ code: 'busy' })
      expect(launch).not.toHaveBeenCalled()
      finish()
      await starting
      expect(await closing).toBe(true)
      expect(stop).toHaveBeenCalledTimes(1)
    })
    it('negotiates the highest shared minor and feature intersection, without replacing an incompatible incumbent', async () => {
      const { root, workspaces } = fixture()
      const owner = await PluginSupervisor.start({
        root,
        workspaceRoots: [],
        wire: { major: 1, minMinor: 1, maxMinor: 3, features: ['fictional-a', 'fictional-b'] },
      })
      owners.push(owner)
      const lease = await attach(root, workspaces[0]!, {
        wire: { major: 1, minMinor: 2, maxMinor: 4, features: ['fictional-b', 'fictional-c'] },
      })
      expect(lease.minor).toBe(3)
      expect(lease.features).toEqual(['fictional-b'])
      const launch = vi.fn(async () => {})
      await expect(
        attach(root, workspaces[1]!, { wire: OWNER_WIRE, launch }),
      ).rejects.toMatchObject({ code: 'incompatible' })
      expect(launch).not.toHaveBeenCalled()
    })
    it('four simultaneous starters converge on the single fenced incumbent', async () => {
      const { root, workspaces } = fixture()
      const launch = async () => {
        const owner = await PluginSupervisor.start({ root, workspaceRoots: [] })
        owners.push(owner)
      }
      const attached = await Promise.all(
        workspaces.map((workspace) => attach(root, workspace, { launch })),
      )
      expect(owners).toHaveLength(1)
      expect(new Set(attached.map((client) => client.lease)).size).toBe(4)
      for (const client of attached) expect(await client.close()).toBe(true)
    })
    it('rejects an authenticated old reply even when a peer replays its old server challenge', async () => {
      const { root, workspaces } = fixture()
      const storage = new SupervisorStorage(root, [], true)
      const record = {
        version: 1 as const,
        epoch: randomUUID(),
        key: secret(),
        phase: 'accepting' as const,
        wire: OWNER_WIRE,
      }
      storage.write(record)
      const oldNonce = secret(),
        oldChallenge = secret()
      let freshNonce = ''
      const server = createServer((socket) => {
        socket.write(`${JSON.stringify({ challenge: oldChallenge })}\n`)
        socket.once('data', (packet) => {
          freshNonce = (
            unpack(record.key, 'request', packet.toString().trim()) as { nonce: string }
          ).nonce
          socket.end(
            pack(record.key, 'response', {
              ok: true,
              epoch: record.epoch,
              nonce: oldNonce,
              value: {
                lease: secret(),
                minor: 0,
                features: [],
                heartbeat: 15_000,
                expires: 60_000,
              },
            }),
          )
        })
      })
      try {
        await new Promise<void>((resolve) => server.listen(storage.socket, resolve))
        await expect(attach(root, workspaces[0]!)).rejects.toMatchObject({ code: 'unavailable' })
        expect(freshNonce).not.toBe(oldNonce)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
        storage.close()
      }
    })
    it('creates a private root under the ordinary owner-controlled 0755 app parent without changing that parent', async () => {
      const { parent, root, workspaces } = fixture()
      chmodSync(parent, 0o755)
      const lease = await attach(root, workspaces[0]!, {
        launch: async () => {
          owners.push(await PluginSupervisor.start({ root, workspaceRoots: [] }))
        },
      })
      expect(lstatSync(parent).mode & 0o777).toBe(0o755)
      expect(lstatSync(root).mode & 0o777).toBe(0o700)
      expect(lstatSync(join(root, 'supervisor/owner.json')).mode & 0o777).toBe(0o600)
      expect(await lease.close()).toBe(true)
    })
    it('hidden starts never choose the live global root by default', () => {
      const { parent, root, workspaces } = fixture()
      const appData = join(parent, 'fictional-app-data')
      mkdirSync(appData, { mode: 0o700 })
      expect(pluginSupervisorRoot({ appData, hidden: true })).toBeNull()
      expect(pluginSupervisorRoot({ appData, hidden: true, scratchRoot: root })).toBe(root)
      expect(() =>
        pluginSupervisorRoot({
          appData,
          hidden: true,
          scratchRoot: join(appData, '@brobot2/plugins'),
        }),
      ).toThrow()
      expect(pluginSupervisorRoot({ appData, hidden: false, workspaceRoot: workspaces[0]! })).toBe(
        join(appData, '@brobot2/plugins'),
      )
    })
  },
)
