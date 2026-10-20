import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { setPriority, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  immutableMode,
  isImmutableFile,
  isInsideCheckedRoot,
  isLocalDrivePath,
  isPrivateEntry,
  isWithinOrSame,
  keepPluginRootPrivate,
} from '../src/main/plugins/private-files'
import { localEndpoint } from '../src/main/plugins/local-endpoint'
import { windowsSystemEnvironment } from '../src/main/plugins/system-environment'
import { installedChromeOnWindows } from '../src/main/plugins/windows-chrome'
import {
  keepToThisUser,
  windowsAccessLists,
  accessEntries,
  othersLetIn,
} from '../src/main/recovery/windows-privacy'
import { PluginSupervisor } from '../src/main/plugins/supervisor/owner'
import { PluginWorkspaceLease } from '../src/main/plugins/supervisor/client'
import { SupervisorStorage } from '../src/main/plugins/supervisor/storage'
import { createPluginNodeHost } from '../src/main/plugins/node-host'
import {
  PLUGIN_HOST_SCRIPTS,
  preparePluginNodeRuntime,
  type PluginNodeRuntime,
} from '../src/main/plugins/node-runtime'
import { thisMachine } from '../src/main/plugins/package-schema'
import { createPluginVerifier } from '../src/main/plugins/package-verifier'
import { endProcessesByIdentity, endWindowsTree } from '../resources/plugin-host/process-groups.mjs'
import { startJobKeeper } from '../resources/plugin-host/windows-job.mjs'
import { writeReceipt } from '../resources/plugin-host/receipts.mjs'
import { manifestFor, packageFixture, fictionalPublicKey } from './plugin-package-fixtures'

const stat = (mode: number, uid = process.getuid?.() ?? 0) =>
  ({ mode, uid }) as unknown as import('node:fs').Stats

describe('the plugin host on Windows, by its platform seams', () => {
  it('compares Windows folders without case, by their own separator, and never across drives', () => {
    expect(isWithinOrSame('C:\\Users\\Fern\\Data', 'c:\\users\\fern\\data\\plugins', 'win32')).toBe(
      true,
    )
    expect(isWithinOrSame('C:\\Users\\Fern\\Data', 'C:\\Users\\Fern\\Data', 'win32')).toBe(true)
    expect(isWithinOrSame('C:\\Users\\Fern\\Data', 'C:\\Users\\Fern\\Other', 'win32')).toBe(false)
    expect(isWithinOrSame('C:\\Users\\Fern\\Data', 'C:\\Users\\Fern\\Data2', 'win32')).toBe(false)
    expect(isWithinOrSame('C:\\Users\\Fern\\Data', 'D:\\Users\\Fern\\Data', 'win32')).toBe(false)
    expect(isWithinOrSame('/fictional/data', '/fictional/data/plugins', 'darwin')).toBe(true)
    expect(isWithinOrSame('/fictional/data', '/fictional/other', 'darwin')).toBe(false)
    expect(isWithinOrSame('/fictional/data', '/Fictional/data/plugins', 'darwin')).toBe(false)
  })
  it('accepts only drive-letter paths on Windows, never a share or a device path', () => {
    expect(isLocalDrivePath('C:\\Users\\Fern', 'win32')).toBe(true)
    expect(isLocalDrivePath('\\\\server\\share\\plugins', 'win32')).toBe(false)
    expect(isLocalDrivePath('\\\\?\\C:\\Users\\Fern', 'win32')).toBe(false)
    expect(isLocalDrivePath('C:Users', 'win32')).toBe(false)
    expect(isLocalDrivePath('/fictional', 'darwin')).toBe(true)
  })
  it('leaves privacy to the checked access list on Windows and to owner and mode elsewhere', () => {
    expect(isPrivateEntry(stat(0o40777, 0), 0o077, 'win32')).toBe(true)
    // An owner is compared only where this process has one.
    if (process.getuid) {
      expect(isPrivateEntry(stat(0o40700), 0o077, 'darwin')).toBe(true)
      expect(isPrivateEntry(stat(0o40750), 0o077, 'darwin')).toBe(false)
      expect(isPrivateEntry(stat(0o40755), 0o022, 'darwin')).toBe(true)
      expect(isPrivateEntry(stat(0o40700, 404941), 0o077, 'darwin')).toBe(false)
    }
    expect(isImmutableFile(stat(0o100666), 'win32')).toBe(true)
    expect(isImmutableFile(stat(0o100400), 'darwin')).toBe(true)
    expect(isImmutableFile(stat(0o100600), 'darwin')).toBe(false)
    expect(immutableMode(true, 'win32')).toBe(0o600)
    expect(immutableMode(true, 'darwin')).toBe(0o500)
    expect(immutableMode(false, 'linux')).toBe(0o400)
  })
  it('names a pipe from the server key on Windows and keeps the socket file elsewhere', () => {
    const key = 'a'.repeat(64)
    const owner = localEndpoint('/fictional/owner.sock', 'owner', key, 'win32')
    expect(owner).toMatch(/^\\\\\.\\pipe\\brocrew-plugin-owner-[a-f0-9]{32}$/)
    expect(localEndpoint('/fictional/owner.sock', 'owner', key, 'win32')).toBe(owner)
    expect(localEndpoint('/fictional/person.sock', 'person', key, 'win32')).not.toBe(
      owner.replace('owner', 'person'),
    )
    expect(localEndpoint('/fictional/owner.sock', 'owner', 'b'.repeat(64), 'win32')).not.toBe(owner)
    expect(owner).not.toContain(key)
    expect(localEndpoint('/fictional/owner.sock', 'owner', key, 'darwin')).toBe(
      '/fictional/owner.sock',
    )
  })
  it("starts a plugin process with the system folder and the system's own PATH alone", () => {
    expect(
      windowsSystemEnvironment({ SystemRoot: 'C:\\Windows', Path: 'C:\\Fictional\\bin' }),
    ).toEqual({
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      SystemDrive: 'C:',
      PATH: 'C:\\Windows\\System32;C:\\Windows;C:\\Windows\\System32\\WindowsPowerShell\\v1.0',
    })
    for (const root of [undefined, 'Windows', '\\\\server\\Windows', 'C:\\Windows;C:\\Fictional'])
      expect(() => windowsSystemEnvironment({ SystemRoot: root })).toThrow('unsupported')
  })
  it('finds Chrome only where its installers put it, as a plain file at its own long path', () => {
    const files = new Map<string, { link?: boolean; real?: string }>()
    const disk = {
      lstat: ((path: string) => {
        const file = files.get(path)
        if (!file) throw Object.assign(new Error('fictional missing'), { code: 'ENOENT' })
        return { isFile: () => !file.link, isSymbolicLink: () => !!file.link }
      }) as unknown as typeof lstatSync,
      realpath: (path: string) => files.get(path)?.real ?? path,
    }
    const environment = {
      ProgramW6432: 'C:\\Program Files',
      'ProgramFiles(x86)': 'C:\\Program Files (x86)',
      LOCALAPPDATA: 'C:\\Users\\Fern\\AppData\\Local',
    }
    const system = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      older = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      own = 'C:\\Users\\Fern\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
    expect(installedChromeOnWindows(environment, disk)).toBeNull()
    files.set(own, {})
    expect(installedChromeOnWindows(environment, disk)).toBe(own)
    files.set(older, {})
    expect(installedChromeOnWindows(environment, disk)).toBe(older)
    files.set(system, { link: true })
    expect(installedChromeOnWindows(environment, disk)).toBe(older)
    files.set(system, { real: 'D:\\Elsewhere\\chrome.exe' })
    expect(installedChromeOnWindows(environment, disk)).toBe(older)
    files.set(system, {})
    expect(installedChromeOnWindows(environment, disk)).toBe(system)
    expect(
      installedChromeOnWindows(
        { ProgramFiles: '\\\\server\\share' },
        {
          ...disk,
          lstat: (() => ({
            isFile: () => true,
            isSymbolicLink: () => false,
          })) as unknown as typeof lstatSync,
        },
      ),
    ).toBeNull()
  })
  it('refuses a plugin root that is not a drive-letter path on Windows and changes nothing elsewhere', async () => {
    await expect(
      keepPluginRootPrivate('/fictional/plugins', { platform: 'win32' }),
    ).rejects.toThrow('unsafe-path')
    await expect(keepPluginRootPrivate('/fictional/plugins', { platform: 'darwin' })).resolves.toBe(
      undefined,
    )
    expect(isInsideCheckedRoot('/fictional/plugins', 'darwin')).toBe(true)
    expect(isInsideCheckedRoot('C:\\Fictional\\plugins', 'win32')).toBe(false)
  })
})

/** A fresh folder that lets in this user, SYSTEM and Administrators alone, by its long name. */
async function privateParent(): Promise<string> {
  const parent = realpathSync.native(mkdtempSync(join(tmpdir(), 'fictional-plugins-')))
  await keepToThisUser(parent)
  return parent
}
const roots: string[] = []
const children: ChildProcess[] = []
afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill()
})
afterAll(() => {
  // A process just ended can hold its folder a moment longer on Windows.
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
})
const running = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
async function until(check: () => boolean | Promise<boolean>, ms = 10000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return check()
}

describe.runIf(process.platform === 'win32')('the plugin host on Windows', () => {
  it('writes a run receipt, which fsyncs no folder there', () => {
    const folder = mkdtempSync(join(tmpdir(), 'fictional-receipt-'))
    roots.push(folder)
    writeReceipt(folder, 'exit.json', { format: 1, exited: true })
    expect(JSON.parse(readFileSync(join(folder, 'exit.json'), 'utf8'))).toEqual({
      format: 1,
      exited: true,
    })
  })
  it("makes the plugin root this user's alone, inheriting nothing, and counts only it as checked", async () => {
    const parent = await privateParent()
    roots.push(parent)
    const root = join(parent, 'plugins')
    await keepPluginRootPrivate(root)
    const sddl = await windowsAccessLists.read(root)
    expect(sddl).toMatch(/D:[A-Z_]*P/)
    const user = await windowsAccessLists.userSid()
    // The computer's own Administrator is written as LA, resolved from the computer's SID.
    const machine = await windowsAccessLists.machineSid()
    expect(othersLetIn(accessEntries(sddl, machine), user)).toEqual([])
    mkdirSync(join(root, 'state'))
    expect(
      othersLetIn(accessEntries(await windowsAccessLists.read(join(root, 'state')), machine), user),
    ).toEqual([])
    expect(isInsideCheckedRoot(join(root, 'state'))).toBe(true)
    expect(isInsideCheckedRoot(join(root.toUpperCase(), 'state'))).toBe(true)
    expect(isInsideCheckedRoot(join(parent, 'elsewhere'))).toBe(false)
  })
  it('serves the supervisor on a pipe that tells an unauthenticated reader one random challenge and nothing else', async () => {
    const parent = await privateParent()
    roots.push(parent)
    const root = join(parent, 'plugins'),
      workspace = join(parent, 'workspace')
    mkdirSync(workspace)
    await keepPluginRootPrivate(root)
    const owner = await PluginSupervisor.start({ root, workspaceRoots: [] })
    try {
      const storage = new SupervisorStorage(root, [], false)
      const endpoint = storage.endpoint(storage.read()!)
      storage.close()
      expect(endpoint).toMatch(/^\\\\\.\\pipe\\brocrew-plugin-owner-[a-f0-9]{32}$/)
      const heard = await new Promise<string>((resolve) => {
        let text = ''
        const socket = createConnection(endpoint)
        socket.setEncoding('utf8')
        socket.on('data', (chunk: string) => {
          text += chunk
        })
        socket.on('error', () => resolve(text))
        socket.on('close', () => resolve(text))
      })
      expect(heard).toMatch(/^\{"challenge":"[a-f0-9]{64}"\}\n$/)
      const lease = await PluginWorkspaceLease.attach({
        root,
        workspaceRoot: workspace,
        generation: randomUUID(),
        build: 'fictional-build',
      })
      expect(await lease.close()).toBe(true)
    } finally {
      await owner.shutdown()
    }
  }, 30000)
  it('ends a process by its number and creation time, and leaves one whose time differs', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    children.push(child)
    const born = await creationTime(child.pid!)
    expect(
      await endProcessesByIdentity(new Map([[child.pid!, String(BigInt(born) + 1000000n)]])),
    ).toBe(true)
    expect(running(child.pid!)).toBe(true)
    expect(await endProcessesByIdentity(new Map([[child.pid!, born]]))).toBe(true)
    expect(await until(() => !running(child.pid!))).toBe(true)
  }, 30000)

  it('opens a job keeper, holds a child in its job, ends it and counts the job empty', async () => {
    const keeper = startJobKeeper({ openMs: 120_000 })
    const opened = await keeper.opened
    // A failure names its closed reason in the report.
    expect({ opened: opened !== null, reason: keeper.reason }).toEqual({
      opened: true,
      reason: null,
    })
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    children.push(child)
    await until(async () => running(child.pid!))
    expect(await keeper.assign(child.pid!)).toMatch(/^\d+$/)
    expect(await keeper.count()).toBe(1)
    // The fact follows the process's own class, set here both ways rather than inherited.
    setPriority(child.pid!, 0)
    expect(await keeper.priorityClamped()).toBe(false)
    setPriority(child.pid!, 10)
    expect(await keeper.priorityClamped()).toBe(true)
    expect(await keeper.terminate()).toBe(true)
    expect(await until(async () => (await keeper.count()) === 0)).toBe(true)
    expect(await until(() => !running(child.pid!))).toBe(true)
    keeper.close()
  }, 150_000)
  it("refuses to hold a process that is not this process's own child", async () => {
    const keeper = startJobKeeper({ openMs: 120_000 })
    expect(await keeper.opened).not.toBeNull()
    expect(await keeper.assign(process.pid)).toBeNull()
    expect(await keeper.assign(process.ppid)).toBeNull()
    keeper.close()
  }, 150_000)
  it('opens a job keeper in the plugin host environment, compiling once into its cache', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fictional-keeper-'))
    roots.push(home)
    const cache = join(home, 'keeper')
    mkdirSync(cache)
    const env = { ...windowsSystemEnvironment(), USERPROFILE: home, TEMP: home, TMP: home }
    const first = startJobKeeper({ openMs: 120_000, env, cache })
    try {
      const compiled = await first.opened
      expect({ opened: compiled !== null, reason: first.reason, cached: first.cached }).toEqual({
        opened: true,
        reason: null,
        cached: false,
      })
    } finally {
      first.close()
    }
    expect(readdirSync(cache).filter((name) => /^job-[a-f0-9]{32}\.dll$/.test(name))).toHaveLength(
      1,
    )
    // A second open loads the compiled code instead of compiling it again. How long PowerShell
    // itself takes to start varies too much on a hosted runner to bound here; the gate records it.
    const second = startJobKeeper({ openMs: 120_000, env, cache })
    try {
      const opened = await second.opened
      expect({ opened: opened !== null, reason: second.reason, cached: second.cached }).toEqual({
        opened: true,
        reason: null,
        cached: true,
      })
    } finally {
      second.close()
    }
  }, 300_000)

  it('ends a keeper still compiling its code when it is let go, and says so only once it has exited', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fictional-keeper-'))
    roots.push(home)
    const cache = join(home, 'keeper')
    mkdirSync(cache)
    // A fresh cache: the keeper is compiling when it is let go, and does not read its input.
    const keeper = startJobKeeper({ openMs: 120_000, cache })
    const pid = keeper.pid!
    expect(await until(() => running(pid), 5000)).toBe(true)
    expect(await keeper.end(500)).toBe(true)
    expect(running(pid)).toBe(false)
  }, 60_000)
  // Detached, as a plugin's own children are: a child Node starts attached ends with its parent.
  it("ends a lost parent's whole tree by creation time, and says gone only once it has seen it gone", async () => {
    const startedAt = Date.now()
    const leader = spawn(
      process.execPath,
      [
        '-e',
        "const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});const g=spawn(process.execPath,['-e',\"require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});setInterval(()=>{},1000)\"],{stdio:'ignore',detached:true});console.log(c.pid+' '+g.pid);setTimeout(()=>process.exit(0),1500)",
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let said = ''
    leader.stdout!.on('data', (chunk: Buffer) => {
      said += chunk.toString('utf8')
    })
    await new Promise((resolve) => leader.once('exit', resolve))
    const endedAt = Date.now()
    const descendants = said.trim().split(' ').map(Number)
    expect(descendants.every((pid) => Number.isSafeInteger(pid) && running(pid))).toBe(true)
    // One reading that ends them is not yet one that has seen them gone.
    expect(await endWindowsTree(leader.pid!, startedAt, endedAt, 0)).toBe(false)
    expect(await endWindowsTree(leader.pid!, startedAt, endedAt)).toBe(true)
    expect(descendants.some((pid) => running(pid))).toBe(false)
  }, 90_000)

  it.each([
    [
      'a reading that raised an error',
      "& { Write-Error 'fictional unreadable table' -ErrorAction Continue; @() }",
    ],
    [
      'a reading without the reader itself',
      'Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.ProcessId -ne $PID }',
    ],
    ['an empty reading', '@()'],
  ])(
    'never takes %s as proof that a lost tree is gone',
    async (_kind, readCommand) => {
      const startedAt = Date.now()
      const leader = spawn(
        process.execPath,
        [
          '-e',
          "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});console.log(String(c.pid));setTimeout(()=>process.exit(0),1000)",
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      )
      let said = ''
      leader.stdout!.on('data', (chunk: Buffer) => {
        said += chunk.toString('utf8')
      })
      await new Promise((resolve) => leader.once('exit', resolve))
      const endedAt = Date.now()
      const child = Number(said.trim())
      expect(running(child)).toBe(true)
      try {
        expect(await endWindowsTree(leader.pid!, startedAt, endedAt, 3000, { readCommand })).toBe(
          false,
        )
        expect(running(child)).toBe(true)
      } finally {
        expect(await endWindowsTree(leader.pid!, startedAt, endedAt)).toBe(true)
      }
    },
    90_000,
  )

  let runtime: PluginNodeRuntime, parent: string
  beforeAll(async () => {
    if (process.platform !== 'win32') return
    // Children of a below-normal process are below normal too; these start from normal.
    setPriority(0)
    parent = await privateParent()
    roots.push(parent)
    await keepPluginRootPrivate(join(parent, 'plugins'))
    const resources = join(parent, 'bundle')
    await mkdir(join(resources, 'plugin-node'), { recursive: true })
    const binary = await readFile(process.execPath)
    await writeFile(join(resources, 'plugin-node/node.exe'), binary)
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
    for (const name of PLUGIN_HOST_SCRIPTS)
      await copyFile(
        resolve(__dirname, '../resources/plugin-host', name),
        join(resources, 'plugin-host', name),
      )
    runtime = await preparePluginNodeRuntime({
      resourcesRoot: resources,
      durableRoot: join(parent, 'plugins', 'runtimes'),
    })
  }, 60000)

  it('stops a run whose keeper is still compiling, and calls it clean only once the keeper has gone', async () => {
    // A fresh host root: its keeper cache is empty, so the keeper is compiling when the stop comes.
    const host = createPluginNodeHost({
      root: join(parent, 'plugins', 'host-cold-stop'),
      runtime,
      readyMs: 25000,
    })
    const handle = await host.start(fixture(serverSource(join(parent, 'no-browser.mjs'))))
    void handle.ready().catch(() => undefined)
    const proof = await handle.stop()
    const receipt = JSON.parse(await readFile(handle.receiptPath, 'utf8')) as {
      exited: boolean
      keeperPid?: number
    }
    expect(Number.isSafeInteger(receipt.keeperPid)).toBe(true)
    // The stop is clean, and the keeper it let go has exited by then, not compiling on.
    expect({
      proof: proof.exited,
      receipt: receipt.exited,
      keeperRunning: running(receipt.keeperPid!),
    }).toEqual({ proof: true, receipt: true, keeperRunning: false })
    await host.stop()
  }, 120_000)
  it.each(['stop', 'crash'] as const)(
    'holds the server and every browser process in a job and ends them all after a %s, leaving a bystander',
    async (kind) => {
      const folder = join(parent, 'plugins', `host-${kind}`)
      const pidFile = join(parent, `browser-${kind}.json`)
      const browser = join(parent, `browser-${kind}.mjs`)
      writeFileSync(
        browser,
        `import fs from 'node:fs'; import {spawn} from 'node:child_process';\n` +
          `const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',detached:true});\n` +
          `fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:process.pid, child:child.pid}));\n` +
          `setInterval(()=>{},1000);\n`,
      )
      const bystander = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
        stdio: 'ignore',
      })
      children.push(bystander)
      const host = createPluginNodeHost({ root: folder, runtime, readyMs: 25000 })
      const handle = await host.start(fixture(serverSource(browser)))
      const ready = await readyOrWhy(handle)
      expect([true, false, null]).toContain(ready.priorityClamped)
      await fetch(ready.origin + '/v1/launch', { headers: ready.admin().headers })
      const ids = await browserStarted(pidFile)
      expect(running(ids.pid) && running(ids.child)).toBe(true)
      if (kind === 'crash') {
        const owner = (await (
          await fetch(ready.origin + '/v1/owner', { headers: ready.admin().headers })
        ).json()) as { pid: number }
        process.kill(owner.pid, 'SIGKILL')
      }
      const proof = kind === 'stop' ? await handle.stop() : await handle.exited
      expect(proof).toEqual({ exited: true })
      // Proof is only given once nothing of the run is left: looked at once, at once.
      expect([ready.serverPid, ids.pid, ids.child].filter((pid) => running(pid))).toEqual([])
      expect(running(bystander.pid!)).toBe(true)
      if (kind === 'stop') {
        const receipt = JSON.parse(
          await readFile(join(resolve(handle.receiptPath, '..'), 'process.json'), 'utf8'),
        )
        expect(receipt.openedMs).toBeGreaterThan(0)
      }
      await host.stop()
    },
    90000,
  )
  it("ends Playwright's taskkill of its own browser through that child alone and refuses any other", async () => {
    const folder = join(parent, 'plugins', 'host-taskkill')
    const pidFile = join(parent, 'browser-taskkill.json')
    const browser = join(parent, 'browser-taskkill.mjs')
    writeFileSync(
      browser,
      `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({pid:process.pid, child:0})); setInterval(()=>{},1000);\n`,
    )
    const host = createPluginNodeHost({ root: folder, runtime, readyMs: 25000 })
    const handle = await host.start(fixture(serverSource(browser)))
    const ready = await readyOrWhy(handle)
    await fetch(ready.origin + '/v1/launch', { headers: ready.admin().headers })
    const ids = await browserStarted(pidFile)
    const answer = (await (
      await fetch(ready.origin + '/v1/taskkill', {
        headers: { ...ready.admin().headers, 'x-pid': String(ids.pid) },
      })
    ).json()) as { own: string; foreign: string }
    expect(answer).toEqual({ own: 'ended', foreign: 'plugin-host-foreign-kill' })
    expect(await until(() => !running(ids.pid))).toBe(true)
    expect(await handle.stop()).toEqual({ exited: true })
    await host.stop()
  }, 90000)
})

/** Readiness, or a failure that names the guardian's closed cause from the run's exit receipt. */
async function readyOrWhy(
  handle: Awaited<ReturnType<ReturnType<typeof createPluginNodeHost>['start']>>,
) {
  try {
    return await handle.ready()
  } catch (error) {
    await handle.exited.catch(() => undefined)
    let receipt: { cause?: unknown; keeperFailure?: unknown } = {}
    try {
      receipt = JSON.parse(await readFile(handle.receiptPath, 'utf8'))
    } catch {
      /* No receipt is itself the answer. */
    }
    throw new Error(
      `not ready: ${String((error as Error).message)}; guardian cause ${String(receipt.cause)}, keeper ${String(receipt.keeperFailure)}`,
      { cause: error },
    )
  }
}
/** A process's creation time as a FILETIME, by PowerShell, as the host's own identity uses it. */
function creationTime(pid: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[System.Diagnostics.Process]::GetProcessById(${pid}).StartTime.ToFileTimeUtc()`,
      ],
      { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
    )
    let text = ''
    reader.stdout.on('data', (chunk: Buffer) => {
      text += chunk.toString('utf8')
    })
    reader.once('exit', () =>
      /^\d+$/.test(text.trim()) ? resolve(text.trim()) : reject(new Error(text)),
    )
  })
}
function serverSource(browser: string): string {
  return String.raw`
import http from 'node:http'; import fs from 'node:fs'; import {spawn, spawnSync} from 'node:child_process';
const auth = JSON.parse(fs.readFileSync(process.env.BROCREW_CHROME_AUTH, 'utf8'));
const server = http.createServer((req, res) => {
 const token = req.url === '/mcp' ? auth.mcpToken : auth.adminToken;
 if (req.headers.authorization !== 'Bearer '+token) { res.writeHead(401).end(); return }
 res.setHeader('content-type','application/json');
 if (req.url === '/mcp') {
  if(req.method !== 'POST') return res.writeHead(405).end();
  let body=''; req.on('data',chunk=>body+=chunk); req.on('end',()=>{
   const packet=JSON.parse(body);
   if(packet.id===undefined)return res.writeHead(202).end();
   res.end(JSON.stringify({jsonrpc:'2.0',id:packet.id,result:{protocolVersion:packet.params.protocolVersion,serverInfo:{name:'fictional-host',version:'1.0.0'},capabilities:{}}}));
  }); return;
 }
 if (req.url === '/healthz') return res.end(JSON.stringify({ok:true, version:'1.0.0'}));
 if (req.url === '/v1/profiles') return res.end(JSON.stringify({profiles:[]}));
 if (req.url === '/v1/launch') {
  const child = spawn(process.execPath, [${JSON.stringify(browser)}], {detached:true, stdio:'ignore'});
  res.end(JSON.stringify({pid:child.pid})); return;
 }
 if (req.url === '/v1/taskkill') {
  const own = spawnSync('taskkill /pid ' + req.headers['x-pid'] + ' /T /F', {shell:true});
  let foreign = 'ran';
  try { spawnSync('taskkill /pid ' + process.ppid + ' /T /F', {shell:true}) } catch (error) { foreign = error.message }
  return res.end(JSON.stringify({own: own.status === 0 ? 'ended' : 'failed', foreign}));
 }
 if (req.url === '/v1/owner') return res.end(JSON.stringify({pid:process.ppid}));
 res.writeHead(404).end();
});
server.listen(0,'127.0.0.1',()=>process.send({channel:'brocrew-plugin-node:v1',runId:process.env.BROCREW_PLUGIN_RUN_ID,type:'listening',port:server.address().port}));
process.on('SIGTERM',()=>{ server.close(); process.exit(0) });
`
}
function fixture(body: string) {
  const files = new Map([['server.mjs', Buffer.from(body)]])
  const manifest = manifestFor(files)
  manifest.id = 'chrome'
  manifest.platforms = [thisMachine()]
  manifest.server = { entry: 'server.mjs', mcpPath: '/mcp', adminPath: '/v1' }
  manifest.skills = []
  manifest.serviceTemplates = []
  manifest.ui = null
  manifest.uiApi = null
  const value = packageFixture({ files, manifest })
  const catalogue = createPluginVerifier({
    pinnedPublicKey: fictionalPublicKey,
    target: manifest.platforms[0]!,
  }).verifyCatalogue(value.bytes, value.signature)
  return {
    package: catalogue.verifyPackage('chrome', manifest.version, value.archive),
    releaseDigest: value.release.archive.sha256,
  }
}
async function browserStarted(path: string): Promise<{ pid: number; child: number }> {
  for (let i = 0; i < 400; i++) {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch {
      await new Promise((r) => setTimeout(r, 25))
    }
  }
  throw new Error('fake browser did not start')
}
