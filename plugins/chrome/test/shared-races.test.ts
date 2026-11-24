import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { buildSync } from 'esbuild'
import { afterEach, expect, it, onTestFailed } from 'vitest'
import { createProfileStore } from '../src/profiles/store.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
import { identity, ownerState, withSharedLock } from '../src/profiles/sharedLock.js'
const roots: string[] = []
const children: ReturnType<typeof spawn>[] = []
afterEach(() => {
  for (const c of children.splice(0)) if (c.exitCode === null) c.kill('SIGKILL')
  for (const p of roots.splice(0)) fs.rmSync(p, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-shared-race-'))
  roots.push(root)
  const shared = path.join(root, 'shared')
  const home = path.join(root, 'local')
  fs.mkdirSync(shared)
  fs.mkdirSync(home)
  const worker = path.join(root, 'worker.mjs')
  buildSync({
    entryPoints: [fileURLToPath(new URL('./shared-worker.ts', import.meta.url))],
    outfile: worker,
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  if (process.platform === 'win32') {
    fs.mkdirSync(path.join(root, 'bin'))
    fs.copyFileSync(
      new URL('../src/profiles/bin/chrome-process-birth.exe', import.meta.url),
      path.join(root, 'bin/chrome-process-birth.exe'),
    )
  }
  const open = () =>
    createSharedProfileStore({
      home,
      shared,
      workspaceId: 'alpha',
      workspaceLabel: 'Alpha',
      chromeState: () => 'ended',
    })
  const start = (command: string, id: string, local = path.join(root, id), boundary = '') => {
    const child = spawn(
      process.execPath,
      [worker, command, local, shared, id, path.join(root, 'barrier'), boundary],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    children.push(child)
    let output = ''
    let errors = ''
    child.stdout!.on('data', (b) => {
      output += b
    })
    child.stderr!.on('data', (b) => {
      errors += b
    })
    onTestFailed(() => {
      process.stderr.write(
        JSON.stringify({
          worker,
          command,
          pid: child.pid,
          exit: child.exitCode,
          signal: child.signalCode,
          stdout: output,
          stderr: errors,
        }) + '\n',
      )
    })
    const done = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('close', resolve)
    })
    let ended = false
    child.on('close', () => {
      ended = true
    })
    return { child, done, ended: () => ended, text: () => output, errors: () => errors }
  }
  return {
    root,
    shared,
    home,
    open,
    start,
    go: () => fs.writeFileSync(path.join(root, 'barrier.go'), ''),
    release: () => fs.writeFileSync(path.join(root, 'barrier.release'), ''),
  }
}
async function until(
  check: () => boolean,
  ...workers: ReturnType<ReturnType<typeof fixture>['start']>[]
) {
  const end = Date.now() + 8000
  while (!check()) {
    for (const worker of workers)
      if (worker.ended())
        throw new Error(
          `Shared worker ${worker.child.pid} exited with code ${worker.child.exitCode}, signal ${worker.child.signalCode}: ${worker.errors()}`,
        )
    if (Date.now() > end) throw new Error('child deadline')
    await new Promise((r) => setTimeout(r, 10))
  }
}
it('two separate processes cannot acquire one lease; after owner exit exactly one successor can', async () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const b = f.start('lease', 'beta')
  const c = f.start('lease', 'test')
  await until(
    () =>
      fs.existsSync(path.join(f.root, 'barrier.beta.ready')) &&
      fs.existsSync(path.join(f.root, 'barrier.test.ready')),
    b,
    c,
  )
  f.go()
  await Promise.all([b, c].map((one) => until(() => one.text().length > 0, one)))
  expect([b, c].filter((one) => one.text().startsWith('acquired'))).toHaveLength(1)
  expect([b, c].filter((one) => one.text().startsWith('refused'))).toHaveLength(1)
  const winner = [b, c].find((one) => one.text().startsWith('acquired'))!
  winner.child.kill('SIGKILL')
  await winner.done
  const lease = a.shared.acquire('fern')
  expect(() => a.shared.acquire('fern')).toThrow()
  lease.release()
  f.release()
  await Promise.all([b.done, c.done])
})
it('separate workspace flag writers preserve both scoped intents', async () => {
  const f = fixture()
  f.open().create('fern', 'panel')
  const b = f.start('flags', 'beta')
  const c = f.start('flags', 'test')
  await until(
    () =>
      fs.existsSync(path.join(f.root, 'barrier.beta.ready')) &&
      fs.existsSync(path.join(f.root, 'barrier.test.ready')),
    b,
    c,
  )
  f.go()
  expect(await b.done).toBe(0)
  expect(await c.done).toBe(0)
  expect(b.text()).toBe('updated\n')
  expect(c.text()).toBe('updated\n')
  const r = JSON.parse(fs.readFileSync(path.join(f.shared, 'registry.json'), 'utf8'))
  expect(r.profiles[0].perWorkspace.beta).toMatchObject({ enabled: true })
  expect(r.profiles[0].perWorkspace.test).toMatchObject({ enabled: true })
})
it('two deleters remove the data exactly once without admitting a replacement', async () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const b = f.start('delete', 'beta')
  const c = f.start('delete', 'test')
  await until(
    () =>
      fs.existsSync(path.join(f.root, 'barrier.beta.ready')) &&
      fs.existsSync(path.join(f.root, 'barrier.test.ready')),
    b,
    c,
  )
  f.go()
  await Promise.all([b.done, c.done])
  expect([b, c].filter((one) => one.text() === 'deleted\n')).toHaveLength(1)
  expect(a.get('fern')).toBeUndefined()
})
it('two migration processes reserve one destination and retain the original inode', async () => {
  const f = fixture()
  const local = createProfileStore({ home: f.home })
  local.create('fern', 'panel')
  const inode = fs.statSync(local.dirOf('fern')).ino
  const b = f.start('migrate', 'same', f.home)
  const c = f.start('migrate', 'same', f.home)
  await until(
    () =>
      fs.existsSync(path.join(f.root, `barrier.same.${b.child.pid}.ready`)) &&
      fs.existsSync(path.join(f.root, `barrier.same.${c.child.pid}.ready`)),
    b,
    c,
  )
  f.go()
  await Promise.all([b.done, c.done])
  expect(b.errors() + c.errors()).toBe('')
  const r = JSON.parse(fs.readFileSync(path.join(f.shared, 'registry.json'), 'utf8'))
  expect(r.profiles).toHaveLength(1)
  expect(r.profiles[0].state).toBe('ready')
  expect(fs.statSync(path.join(f.shared, 'profiles', 'fern')).ino).toBe(inode)
})
it('a crash before the lock ticket is written has attributable ownership and is recoverable', async () => {
  const f = fixture()
  const a = f.open()
  const c = f.start('lock-crash', 'crash')
  expect(await c.done).toBe(42)
  await expect(until(() => false, c)).rejects.toThrow(/exited with code 42.*fictional lock crash/)
  a.create('fern', 'panel')
  expect(a.get('fern')).toBeDefined()
})
it('lock waits are bounded and cannot remove a live owner; birth mismatch handles PID reuse conservatively', () => {
  const f = fixture()
  const owner = identity()
  withSharedLock(f.shared, owner, () =>
    expect(() => withSharedLock(f.shared, owner, () => {}, 15)).toThrow(/busy/),
  )
  expect(ownerState(owner)).toBe('alive')
  expect(ownerState({ ...owner, birth: 'different-birth' })).toBe('gone')
})
it('a waiter outlasts a live holder past two seconds and enters once the holder dies inside', async () => {
  const f = fixture()
  const holder = f.start('hold', 'holder')
  await until(() => fs.existsSync(path.join(f.root, 'barrier.holder.ready')), holder)
  // A sibling waits, as plugin processes do: a parent waiting synchronously never reaps its child.
  const waiter = f.start('enter', 'waiter')
  expect(await holder.done).toBe(0)
  expect(await waiter.done).toBe(0)
  expect(waiter.text()).toBe('entered\n')
})
for (const phase of ['reserved', 'renamed', 'moved', 'local-retired', 'retired'])
  it(`recovers actual process death at migration ${phase}`, async () => {
    const f = fixture()
    const local = createProfileStore({ home: f.home })
    local.create('fern', 'panel')
    const inode = fs.statSync(local.dirOf('fern')).ino
    const c = f.start('crash', 'alpha', f.home, phase)
    expect(await c.done).toBe(42)
    const a = createSharedProfileStore({
      home: f.home,
      shared: f.shared,
      workspaceId: 'alpha',
      workspaceLabel: 'Alpha',
      chromeState: () => 'ended',
      migrationApproved: true,
    })
    expect(a.get('fern')).toBeDefined()
    expect(fs.statSync(a.dirOf('fern')).ino).toBe(inode)
  })

it('a separate process cannot launch while Preferences mutation holds the shared reservation', async () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  const b = f.start('lease', 'beta')
  await until(() => fs.existsSync(path.join(f.root, 'barrier.beta.ready')), b)
  a.shared.withDiskAccess('fern', true, () => {
    f.go()
    const result = path.join(f.root, 'barrier.beta.result')
    const deadline = Date.now() + 8000
    while (!fs.existsSync(result)) {
      if (Date.now() > deadline) throw new Error('child deadline')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    }
    expect(fs.readFileSync(result, 'utf8')).toBe('refused')
  })
  f.release()
  expect(await b.done).toBe(0)
  a.shared.acquire('fern').release()
})
