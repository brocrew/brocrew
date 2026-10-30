import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  keepNoMoreOpenThanTheData,
  sayWhoMayRead,
  whatSettingsSays,
  whoMayRead,
  type WhoMayRead,
} from '../src/main/data-folder-privacy'
import {
  accessEntries,
  ADMINISTRATORS_SID,
  SYSTEM_SID,
  windowsAccessLists,
  type AccessLists,
} from '../src/main/recovery/windows-privacy'
import { makeWorkspaceFolder } from '../src/main/workspaces'

const USER = 'S-1-5-21-1111111111-2222222222-3333333333-1001'
/** A folder in the user's profile. */
const PRIVATE = `D:(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${USER})`
/** A folder at the root of another NTFS drive: every signed-in user may read it. */
const OPEN = 'D:AI(A;OICIID;FA;;;BA)(A;OICIID;FA;;;SY)(A;OICIID;0x1301bf;;;AU)'
/** A folder on a drive that keeps no access lists. */
const NO_LIST = 'D:NO_ACCESS_CONTROL'

/** Access lists that answer each folder's list from `lists`, and fail to limit any of `stuck`. */
function windowsWith(lists: Record<string, string>, stuck: readonly string[] = []) {
  const restricted: string[] = []
  const fake: AccessLists = {
    userSid: () => Promise.resolve(USER),
    machineSid: () => Promise.resolve(null),
    read: (folder) =>
      folder in lists
        ? Promise.resolve(lists[folder] ?? '')
        : Promise.reject(new Error('icacls could not read it')),
    restrict: (folder) => {
      restricted.push(folder)
      if (stuck.includes(folder)) return Promise.reject(new Error('Access is denied'))
      lists[folder] = PRIVATE
      return Promise.resolve()
    },
  }
  return { fake, restricted }
}

describe('who may read a folder', () => {
  it.each([
    ['a folder in the profile', PRIVATE, 'this-user'],
    ['a folder on another NTFS drive', OPEN, 'others'],
    ['a folder on a FAT or exFAT drive', NO_LIST, 'anyone'],
  ] as const)('on Windows, %s', async (_what, sddl, kind) => {
    const { fake, restricted } = windowsWith({ 'D:\\data': sddl })
    expect(await whoMayRead('D:\\data', { platform: 'win32', lists: fake })).toEqual({ kind })
    // A folder already there is only looked at, never changed.
    expect(restricted).toEqual([])
  })

  it('on Windows, unknown when its list cannot be read, with why', async () => {
    const { fake } = windowsWith({})
    expect(await whoMayRead('D:\\data', { platform: 'win32', lists: fake })).toEqual({
      kind: 'unknown',
      why: 'icacls could not read it',
    })
  })

  const modesAre =
    (modes: Record<string, number>) =>
    (path: string): Promise<number> =>
      path in modes
        ? Promise.resolve(modes[path] ?? 0)
        : Promise.reject(new Error(`no mode for ${path}`))
  const asIs = (path: string): Promise<string> => Promise.resolve(path)

  it.each([
    ['its own mode lets no one else through', { '/a/b/data': 0o40700 }, 'this-user'],
    [
      'a folder above it lets no one else through, as ~/Library does',
      { '/a/b/data': 0o40755, '/a/b': 0o40700 },
      'this-user',
    ],
    [
      'it and every folder above it let others through',
      { '/a/b/data': 0o40755, '/a/b': 0o40755, '/a': 0o40755, '/': 0o40755 },
      'others',
    ],
  ] as const)('elsewhere, when %s', async (_what, modes, kind) => {
    const options = { platform: 'darwin' as const, modeOf: modesAre(modes), realOf: asIs }
    expect(await whoMayRead('/a/b/data', options)).toEqual({ kind })
  })

  it('on macOS a folder above it that lets its group through lets others in, as every account shares one', async () => {
    // A home at 0750: on macOS its group is everyone's; on Linux usually the user's own.
    const modes = { '/Users/x/work': 0o40755, '/Users/x': 0o40750, '/Users': 0o40755, '/': 0o40755 }
    const options = { modeOf: modesAre(modes), realOf: asIs }
    expect(await whoMayRead('/Users/x/work', { ...options, platform: 'darwin' })).toEqual({
      kind: 'others',
    })
    expect(await whoMayRead('/Users/x/work', { ...options, platform: 'linux' })).toEqual({
      kind: 'this-user',
    })
  })

  it('walks from where the folder really is', async () => {
    const modes = {
      '/Volumes/shared/data': 0o40755,
      '/Volumes/shared': 0o40777,
      '/Volumes': 0o40755,
      '/': 0o40755,
    }
    const options = {
      platform: 'darwin' as const,
      modeOf: modesAre(modes),
      realOf: () => Promise.resolve('/Volumes/shared/data'),
    }
    expect(await whoMayRead('/Users/x/link', options)).toEqual({ kind: 'others' })
  })
})

describe('what BroBot says about it', () => {
  it.each([
    [{ kind: 'this-user' }, null],
    [
      { kind: 'others' },
      'Other users of this computer can read BroCrew’s data folder (D:\\data). Limit its permissions, or move it to a folder only you can open.',
    ],
    [
      { kind: 'anyone' },
      'BroCrew’s data folder (D:\\data) is on a drive that can’t limit who reads it, so anyone with this drive can read BroCrew’s data and its recovery copies.',
    ],
    [
      { kind: 'unknown', why: 'icacls timed out' },
      'BroCrew could not check who can read its data folder (D:\\data): icacls timed out',
    ],
  ] as [WhoMayRead, string | null][])('%j', (who, said) => {
    expect(sayWhoMayRead('D:\\data', who)).toBe(said)
  })
})

describe('what Settings shows beside the workspace', () => {
  it('the sentence when others may read it, nothing when only this user may or it is not known', async () => {
    expect(await whatSettingsSays('D:\\data', Promise.resolve({ kind: 'others' }))).toContain(
      'Other users of this computer can read',
    )
    expect(await whatSettingsSays('D:\\data', Promise.resolve({ kind: 'this-user' }))).toBeNull()
    expect(
      await whatSettingsSays('D:\\data', Promise.resolve({ kind: 'unknown', why: 'timed out' })),
    ).toBeNull()
  })

  it('nothing yet, rather than wait, when the answer is slow', async () => {
    const never = new Promise<WhoMayRead>(() => undefined)
    expect(await whatSettingsSays('D:\\data', never, 20)).toBeNull()
  })
})

describe('a recovery folder is never more open than the data folder, nor held to more', () => {
  const backups = 'D:\\data\\backups'
  const run = async (data: string | null, backupsStuck: boolean) => {
    const lists: Record<string, string> = { [backups]: OPEN }
    if (data !== null) lists['D:\\data'] = data
    const { fake, restricted } = windowsWith(lists, backupsStuck ? [backups] : [])
    const warned: string[] = []
    const outcome = await keepNoMoreOpenThanTheData(backups, 'D:\\data', {
      platform: 'win32',
      lists: fake,
      warn: (line) => warned.push(line),
    }).then(
      () => 'kept',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    return { outcome, restricted, warned }
  }

  it('makes the copies private when it can, whatever the data folder', async () => {
    for (const data of [PRIVATE, OPEN, NO_LIST]) {
      const { outcome, restricted, warned } = await run(data, false)
      expect(outcome).toBe('kept')
      expect(restricted).toEqual([backups])
      expect(warned).toEqual([])
    }
  })

  it('goes on, saying so, when it cannot and the data folder is private', async () => {
    const { outcome, warned } = await run(PRIVATE, true)
    expect(outcome).toBe('kept')
    expect(warned).toEqual([
      'BroCrew could not make D:\\data\\backups readable by you alone, and used it anyway: Access is denied',
    ])
  })

  it('goes on, saying the drive keeps no access lists, when backups is on one', async () => {
    const lists: Record<string, string> = { [backups]: NO_LIST, 'D:\\data': NO_LIST }
    const { fake, restricted } = windowsWith(lists)
    const warned: string[] = []
    await keepNoMoreOpenThanTheData(backups, 'D:\\data', {
      platform: 'win32',
      lists: fake,
      warn: (line) => warned.push(line),
    })
    expect(restricted).toEqual([])
    expect(warned).toEqual([
      'BroCrew keeps D:\\data\\backups as open as its data folder, since it could not make it more private: its drive keeps no access lists (FAT or exFAT)',
    ])
  })

  it.each([
    ['open to other users', OPEN],
    ['on a drive with no access lists', NO_LIST],
    ['whose list cannot be read', null],
  ])('goes on, saying so, when it cannot and the data folder is %s', async (_what, data) => {
    const { outcome, warned } = await run(data, true)
    expect(outcome).toBe('kept')
    expect(warned).toEqual([
      'BroCrew keeps D:\\data\\backups as open as its data folder, since it could not make it more private: Access is denied',
    ])
  })

  it('does nothing off Windows, where the folder’s mode keeps it', async () => {
    const { outcome, restricted } = await (async () => {
      const { fake, restricted } = windowsWith({})
      const outcome = await keepNoMoreOpenThanTheData('/data/backups', '/data', {
        platform: 'darwin',
        lists: fake,
      }).then(() => 'kept')
      return { outcome, restricted }
    })()
    expect(outcome).toBe('kept')
    expect(restricted).toEqual([])
  })
})

describe('a workspace folder BroBot makes', () => {
  it('is limited to this user on Windows before anything is written in it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-made-'))
    try {
      const folder = join(root, 'Research')
      const lists: Record<string, string> = { [folder]: OPEN }
      const { fake, restricted } = windowsWith(lists)
      const limiting = fake.restrict
      let nameWrittenFirst = false
      fake.restrict = (at, user, others) => {
        nameWrittenFirst = existsSync(join(at, 'workspace.json'))
        return limiting(at, user, others)
      }
      expect(
        await makeWorkspaceFolder(folder, 'Research', { lists: fake, platform: 'win32' }),
      ).toBeNull()
      expect(restricted).toEqual([folder])
      expect(nameWrittenFirst).toBe(false)
      expect(existsSync(join(folder, 'workspace.json'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves a folder that was there already, which a person chose, as it was', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-made-'))
    try {
      const folder = join(root, 'Team')
      mkdirSync(folder)
      const { fake, restricted } = windowsWith({ [folder]: OPEN })
      expect(
        await makeWorkspaceFolder(folder, 'Team', { lists: fake, platform: 'win32' }),
      ).toBeNull()
      expect(restricted).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('is still made, saying why, when its list cannot be limited', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-made-'))
    try {
      const folder = join(root, 'Research')
      const { fake } = windowsWith({ [folder]: OPEN }, [folder])
      expect(
        await makeWorkspaceFolder(folder, 'Research', { lists: fake, platform: 'win32' }),
      ).toBe('Access is denied')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.runIf(process.platform === 'win32')('on real Windows', () => {
  it('a workspace folder made under a folder every user may read is readable by this user alone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-made-'))
    roots.push(root)
    const icacls = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe')
    execFileSync(icacls, [root, '/grant', '*S-1-5-32-545:(OI)(CI)RX', '/Q'])
    const folder = join(root, 'Research')
    expect(await makeWorkspaceFolder(folder, 'Research')).toBeNull()
    const user = await windowsAccessLists.userSid()
    for (const path of [folder, join(folder, 'workspace.json')]) {
      const allowed = accessEntries(
        await windowsAccessLists.read(path),
        await windowsAccessLists.machineSid(),
      )
        .filter((entry) => entry.allows)
        .map((entry) => entry.sid)
      expect(new Set(allowed), path).toEqual(new Set([user, SYSTEM_SID, ADMINISTRATORS_SID]))
    }
    expect(await whoMayRead(folder)).toEqual({ kind: 'this-user' })
    // The folder above it, which a person chose, is only looked at.
    expect(await whoMayRead(root)).toEqual({ kind: 'others' })
  })
})
