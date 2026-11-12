import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { workspaceUpdate, type WorkspaceUpdateRequest } from '../src/main/update-workspaces'
import {
  forgetUpdateWorkspaces,
  rememberUpdateWorkspaces,
  takeUpdateWorkspaces,
  updateWorkspacesToReopen,
} from '../src/main/update-settings'
import { macAppProcessesIn } from '../src/main/other-brobots'

function cluster(held = false) {
  const actors = new Map<string, ReturnType<typeof workspaceUpdate>>()
  const journal: string[] = []
  const saves = new Map<string, () => void>()
  const failures = new Set<string>()
  let remembered: readonly string[] | null = null
  let loseInstallReply = false
  let refuseInstall = false
  for (let i = 0; i < 3; i += 1) {
    const folder = `/workspace-${i}`
    const saved = held
      ? new Promise<void>((resolve) => saves.set(folder, resolve))
      : Promise.resolve()
    const actor: ReturnType<typeof workspaceUpdate> = workspaceUpdate({
      self: { folder, pid: i + 1, startedAt: i, name: folder, executable: '/BroCrew' },
      ready: () => i > 0,
      discover: async () => [...actors.values()].map((peer) => peer.details()),
      request: async (peer, request) => {
        const target = actors.get(peer.folder)
        if (!target) throw new Error('workspace closed before acknowledgement')
        if (request.kind === 'install' && refuseInstall) throw new Error('not delivered')
        await target.receive(request)
        if (request.kind === 'install' && loseInstallReply)
          throw Object.assign(new Error('install reply lost'), { updateRequestSent: true })
      },
      prepare: async () => {
        journal.push(`prepare ${i}`)
        if (failures.has(folder)) throw new Error('disk full')
        await saved
        journal.push(`saved ${i}`)
        journal.push(`closed database ${i}`)
      },
      remember: (_version, folders) => {
        remembered = folders
      },
      report: (error) => journal.push(`reply error ${String(error)}`),
      quit: () => {
        journal.push(`quit ${i}`)
        actor.finishQuit()
      },
      install: () => journal.push(`native install ${i}`),
    })
    actors.set(folder, actor)
  }
  return {
    actors,
    journal,
    saves,
    failures,
    remembered: () => remembered,
    refuseInstall: () => {
      refuseInstall = true
    },
    allowInstall: () => {
      refuseInstall = false
    },
    loseInstallReply: () => {
      loseInstallReply = true
    },
    first: actors.get('/workspace-1')!,
    second: actors.get('/workspace-2')!,
  }
}

it('waits for all three durable preparations, then invokes one installer and quits the leader last', async () => {
  const c = cluster(true)
  const updating = c.first.restart('0.2.24')
  for (let tick = 0; tick < 12; tick += 1) await Promise.resolve()
  expect(c.journal.filter((step) => step.startsWith('prepare'))).toHaveLength(3)
  expect(c.remembered()).toBeNull()
  expect(c.journal.some((step) => step.includes('native'))).toBe(false)
  for (const release of c.saves.values()) release()
  await updating
  expect(c.remembered()).toEqual(['/workspace-1', '/workspace-0', '/workspace-2'])
  expect(c.journal.slice(-4)).toEqual(['quit 1', 'native install 1', 'quit 2', 'quit 0'])
  for (let i = 0; i < 3; i += 1) {
    expect(c.journal.indexOf(`closed database ${i}`)).toBeLessThan(
      c.journal.indexOf('native install 1'),
    )
  }
})

it('joins simultaneous clicks at the same oldest workspace, including one that has no download', async () => {
  const c = cluster()
  await Promise.all([
    c.first.restart('0.2.24'),
    c.second.restart('0.2.24'),
    c.first.restart('0.2.24'),
  ])
  expect(c.journal.filter((step) => step.includes('native install'))).toEqual(['native install 1'])
  expect(c.journal.filter((step) => step.startsWith('prepare'))).toHaveLength(3)
  c.first.finishQuit()
  c.first.finishQuit()
  const repeat: WorkspaceUpdateRequest = { kind: 'quit', owner: { folder: '/workspace-0', pid: 1 } }
  await c.second.receive(repeat)
  await c.second.receive(repeat)
  expect(c.journal.filter((step) => step === 'quit 2')).toHaveLength(1)
  expect(c.journal.filter((step) => step.includes('native install'))).toHaveLength(1)
})

it('a failed final save neither remembers a reopen set nor installs, and an explicit retry can finish', async () => {
  const c = cluster()
  c.failures.add('/workspace-2')
  await expect(c.first.restart('0.2.24')).rejects.toThrow('disk full')
  expect(c.remembered()).toBeNull()
  expect(c.journal.some((step) => step.startsWith('quit'))).toBe(false)
  c.failures.clear()
  await c.first.restart('0.2.24')
  expect(c.journal.filter((step) => step.includes('native install'))).toHaveLength(1)
})

it('does not elect a different installer when the workspace owning an active operation disappears', async () => {
  const c = cluster()
  const owner = { folder: '/workspace-0', pid: 1 }
  await c.first.receive({ kind: 'prepare', owner })
  c.actors.delete(owner.folder)
  await expect(c.first.restart('0.2.24')).rejects.toThrow('no longer reachable')
  expect(c.journal.some((step) => step.includes('native install'))).toBe(false)
})

it('a lost install reply keeps the reopen set and cannot issue a second uncertain install', async () => {
  const c = cluster()
  c.loseInstallReply()
  await c.first.restart('0.2.24')
  await c.second.restart('0.2.24')
  expect(c.journal).toContain('quit 0')
  expect(c.journal).toContain('quit 2')
  expect(c.journal.filter((step) => step.includes('native install'))).toHaveLength(1)
  expect(c.remembered()).not.toBeNull()
})

it('a refused install leaves all workspaces open, removes the quit hold, and keeps no stale reopen set', async () => {
  const c = cluster()
  c.refuseInstall()
  await expect(c.first.restart('0.2.24')).rejects.toThrow('not delivered')
  expect(c.remembered()).toBeNull()
  expect(c.journal.some((step) => step.startsWith('quit'))).toBe(false)
  expect([...c.actors.values()].some((actor) => actor.holdsQuit())).toBe(false)
  c.allowInstall()
  await c.first.restart('0.2.24')
  expect(c.journal.filter((step) => step.includes('native install'))).toHaveLength(1)
})

let folder: string | undefined
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true })
})

it('only the installed target primary consumes the captured reopen set, preserving other settings', () => {
  folder = mkdtempSync(join(tmpdir(), 'update-reopen-'))
  const file = join(folder, 'settings.json')
  const rest = { updates: { channel: 'beta', checkAutomatically: false }, other: { kept: true } }
  writeFileSync(file, JSON.stringify(rest))
  rememberUpdateWorkspaces(file, {
    executable: '/BroCrew',
    version: '0.2.24',
    folders: ['/one', '/two', '/three'],
  })
  expect(updateWorkspacesToReopen(file, '/BroCrew', '0.2.23')).toBeNull()
  expect(takeUpdateWorkspaces(file, '/Other.app', '0.2.24', '/one')).toEqual([])
  expect(takeUpdateWorkspaces(file, '/BroCrew', '0.2.24', '/two')).toEqual([])
  expect(takeUpdateWorkspaces(file, '/BroCrew', '0.2.24', '/one')).toEqual([
    '/one',
    '/two',
    '/three',
  ])
  expect(takeUpdateWorkspaces(file, '/BroCrew', '0.2.24', '/one')).toEqual([])
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(rest)
  rememberUpdateWorkspaces(file, { executable: '/BroCrew', version: '0.2.24', folders: ['/one'] })
  forgetUpdateWorkspaces(file)
  expect(updateWorkspacesToReopen(file, '/BroCrew', '0.2.24')).toBeNull()
})

it('the Mac process probe selects the exact executable, excluding helpers and other app copies', () => {
  expect(
    macAppProcessesIn(
      '1 /Applications/BroCrew.app/Contents/MacOS/BroCrew\n2 /Applications/BroCrew.app/Contents/Frameworks/BroCrew Helper\n3 /Other/BroCrew.app/Contents/MacOS/BroCrew\n4 /Applications/BroCrew.app/Contents/MacOS/BroCrew',
      '/Applications/BroCrew.app/Contents/MacOS/BroCrew',
    ),
  ).toEqual([1, 4])
})
