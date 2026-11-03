import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'
import { afterEach, expect, it } from 'vitest'
import { createProfileStore } from '../src/profiles/store.js'
import { createSharedProfileStore } from '../src/profiles/sharedStore.js'
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-profile-label-'))
  roots.push(root)
  const home = path.join(root, 'alpha')
  const shared = path.join(root, 'shared')
  fs.mkdirSync(home)
  fs.mkdirSync(shared)
  const local = () => createProfileStore({ home })
  const open = (id = 'alpha', over = {}) => {
    const dir = path.join(root, id)
    fs.mkdirSync(dir, { recursive: true })
    return createSharedProfileStore({
      home: dir,
      shared,
      workspaceId: id,
      workspaceLabel: id,
      chromeState: () => 'ended',
      ...over,
    })
  }
  return { root, home, shared, local, open }
}
it('OFF local rename is display only, trimmed, persisted, and preserves folder inode and account bytes', () => {
  const f = fixture()
  const s = f.local()
  const before = s.create('fern', 'panel')
  const dir = s.dirOf('fern')
  fs.writeFileSync(path.join(dir, 'fictional-account'), 'fictional-session')
  const inode = fs.statSync(dir).ino
  const renamed = s.rename('fern', '  Fern account  ')
  expect(renamed).toEqual({ ...before, displayName: 'Fern account' })
  expect(f.local().get('fern')?.displayName).toBe('Fern account')
  expect(s.get('Fern account')).toBeUndefined()
  expect(s.dirOf('fern')).toBe(dir)
  expect(fs.statSync(dir).ino).toBe(inode)
  expect(fs.readFileSync(path.join(dir, 'fictional-account'), 'utf8')).toBe('fictional-session')
})
it.each(['', '   ', 'a'.repeat(61)])('refuses invalid display name %j', (label) => {
  const f = fixture()
  const s = f.local()
  s.create('fern', 'panel')
  expect(() => s.rename('fern', label)).toThrow('Profile name must be 1–60 characters.')
})
it('local duplicate and sequential rename/delete races do not mutate another identity', () => {
  const f = fixture()
  const a = f.local()
  const b = f.local()
  a.create('fern', 'panel')
  a.create('cedar', 'panel')
  a.rename('fern', 'Garden')
  expect(() => b.rename('cedar', ' garden ')).toThrow('Another profile already uses that name.')
  a.remove('fern')
  expect(() => b.rename('fern', 'Other')).toThrow()
  expect(b.get('cedar')?.name).toBe('cedar')
})
it('shared rename is globally visible without changing identity, switches, directory or sign-ins', () => {
  const f = fixture()
  const a = f.open()
  const b = f.open('beta')
  a.create('fern', 'panel')
  b.setFlags('fern', { enabled: true, keepRunning: true })
  const beforeA = a.get('fern')!
  const beforeB = b.get('fern')!
  const id = a.shared!.identity('fern')
  const dir = a.dirOf('fern')
  fs.writeFileSync(path.join(dir, 'fictional-account'), 'fictional-session')
  a.rename('fern', 'Fern shared')
  expect(b.get('fern')).toEqual({ ...beforeB, displayName: 'Fern shared' })
  expect(a.get('fern')).toEqual({ ...beforeA, displayName: 'Fern shared' })
  expect(a.shared!.identity('fern')).toBe(id)
  expect(b.dirOf('fern')).toBe(dir)
  expect(fs.readFileSync(path.join(dir, 'fictional-account'), 'utf8')).toBe('fictional-session')
})
it('shared stale writers cannot claim the same display label', () => {
  const f = fixture()
  const a = f.open()
  const b = f.open('beta')
  a.create('fern', 'panel')
  a.create('cedar', 'panel')
  a.rename('fern', 'Garden')
  expect(() => b.rename('cedar', 'GARDEN')).toThrow('Another profile already uses that name.')
  expect(b.get('cedar')?.displayName).toBeUndefined()
})
it('shared deleting tombstone refuses rename and retains its display reservation', () => {
  const f = fixture()
  const a = f.open()
  a.create('fern', 'panel')
  a.create('cedar', 'panel')
  const file = path.join(f.shared, 'registry.json')
  const r = JSON.parse(fs.readFileSync(file, 'utf8'))
  r.profiles.find((p: { name: string }) => p.name === 'fern').state = 'deleting'
  fs.writeFileSync(file, JSON.stringify(r))
  expect(() => a.rename('fern', 'Other')).toThrow(
    'This profile is being deleted. Try again after deletion finishes.',
  )
  expect(() => a.rename('cedar', 'FERN')).toThrow('Another profile already uses that name.')
})

it('two real processes racing for one shared label publish exactly one winner', async () => {
  const f = fixture()
  const store = f.open()
  store.create('fern', 'panel')
  store.create('cedar', 'panel')
  const worker = path.join(f.root, 'worker.mjs')
  const barrier = path.join(f.root, 'go')
  buildSync({
    entryPoints: [fileURLToPath(new URL('./profile-rename-worker.ts', import.meta.url))],
    outfile: worker,
    bundle: true,
    platform: 'node',
    format: 'esm',
  })
  const children = ['fern', 'cedar'].map((name) => {
    const child = spawn(
      process.execPath,
      [worker, path.join(f.root, name), f.shared, name, barrier],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let text = ''
    let error = ''
    child.stdout.on('data', (b) => {
      text += b
    })
    child.stderr.on('data', (b) => {
      error += b
    })
    const done = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', resolve)
    })
    return { child, done, text: () => text, error: () => error }
  })
  try {
    const deadline = Date.now() + 8000
    while (!children.every((c) => c.text().includes('ready'))) {
      if (Date.now() > deadline) throw new Error('fictional workers not ready')
      await new Promise((r) => setTimeout(r, 10))
    }
    fs.writeFileSync(barrier, '')
    expect(await Promise.all(children.map((c) => c.done))).toEqual([0, 0])
    expect(children.map((c) => c.error())).toEqual(['', ''])
    const output = children.map((c) => c.text()).join('')
    expect(output.match(/^renamed$/gm)).toHaveLength(1)
    expect(output.match(/refused:Another profile already uses that name\./g)).toHaveLength(1)
    expect(store.list().filter((p) => p.displayName === 'Garden')).toHaveLength(1)
  } finally {
    for (const c of children) if (c.child.exitCode === null) c.child.kill('SIGKILL')
    await Promise.allSettled(children.map((c) => c.done))
  }
}, 20000)
it('OFF local delete-in-progress rejects reentrant rename through a second store', () => {
  const f = fixture()
  const a = f.local()
  const b = f.local()
  a.create('fern', 'panel')
  const file = path.join(f.home, 'profiles.json')
  const record = JSON.parse(fs.readFileSync(file, 'utf8'))
  record.profiles[0].deleting = true
  fs.writeFileSync(file, JSON.stringify(record))
  expect(() => b.rename('fern', 'Other')).toThrow(
    'This profile is being deleted. Try again after deletion finishes.',
  )
  expect(a.get('fern')?.displayName).toBeUndefined()
})

it('accepts sixty Unicode characters and a case-only edit of the same display label', () => {
  const f = fixture()
  const s = f.local()
  s.create('fern', 'panel')
  expect(s.rename('fern', '🌿'.repeat(60)).displayName).toBe('🌿'.repeat(60))
  expect(() => s.rename('fern', '🌿'.repeat(61))).toThrow('Profile name must be 1–60 characters.')
  s.rename('fern', 'Garden')
  expect(s.rename('fern', 'GARDEN').displayName).toBe('GARDEN')
})

it('a local deletion tombstone is never migrated back into a ready shared account', () => {
  const f = fixture()
  const local = f.local()
  local.create('fern', 'panel')
  const file = path.join(f.home, 'profiles.json')
  const row = JSON.parse(fs.readFileSync(file, 'utf8'))
  row.profiles[0].deleting = true
  fs.writeFileSync(file, JSON.stringify(row))
  const shared = f.open('alpha', { migrationApproved: true })
  const registry = JSON.parse(fs.readFileSync(path.join(f.shared, 'registry.json'), 'utf8'))
  expect(registry.profiles).toEqual([])
  const retained = shared.list().find((p) => p.deleting)!
  expect(retained).toBeDefined()
  expect(() => shared.rename(retained.name, 'Other')).toThrow(
    'This profile is being deleted. Try again after deletion finishes.',
  )
})
