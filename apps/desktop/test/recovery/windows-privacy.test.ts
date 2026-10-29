import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  accessEntries,
  ADMINISTRATORS_SID,
  keepToThisUser,
  machineSidOf,
  othersLetIn,
  SYSTEM_SID,
  windowsAccessLists,
  type AccessLists,
} from '../../src/main/recovery/windows-privacy'

const MACHINE = 'S-1-5-21-1111111111-2222222222-3333333333'
const USER = `${MACHINE}-1001`
/** This computer's built-in Administrator, which SDDL writes as `LA`. */
const BUILT_IN_ADMINISTRATOR = `${MACHINE}-500`
const USERS = 'S-1-5-32-545'
const AUTHENTICATED = 'S-1-5-11'
const CREATOR_OWNER = 'S-1-3-0'

/** A folder in the user's profile: this user, SYSTEM and Administrators, all inherited. */
const IN_THE_PROFILE = `O:${USER}G:${USER}D:(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;${USER})`
/** A folder at the root of another drive: every signed-in user may read, and Users too. */
const ON_ANOTHER_DRIVE =
  'D:AI(A;OICIID;FA;;;BA)(A;OICIID;FA;;;SY)(A;OICIID;0x1301bf;;;AU)(A;OICIID;0x1200a9;;;BU)(A;OICIIOID;GA;;;CO)'
/** What the folder holds once made private. */
const MADE_PRIVATE = `D:PAI(A;OICI;FA;;;${USER})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`

describe('a folder’s access list, read as SDDL', () => {
  it('lets in no one else in the user’s profile', () => {
    expect(othersLetIn(accessEntries(IN_THE_PROFILE), USER)).toEqual([])
  })

  it('names every other account an entry lets in, by SID, whatever the language', () => {
    expect(othersLetIn(accessEntries(ON_ANOTHER_DRIVE), USER)).toEqual([AUTHENTICATED, USERS])
  })

  it('counts rights that apply here, excluding zero masks and inherit-only entries', () => {
    const sandbox = `${MACHINE}-2011`
    const sddl = `D:(A;OICIID;0x1200a9;;;${sandbox})(A;;0x00000000;;;WD)(A;;0;;;AU)(A;;;;;BU)(A;OICIIO;FA;;;CO)`
    expect(othersLetIn(accessEntries(sddl), USER)).toEqual([sandbox])
    expect(othersLetIn(accessEntries(sddl, MACHINE, { includeInheritOnly: true }), USER)).toEqual([
      sandbox,
      CREATOR_OWNER,
    ])
    expect(() => accessEntries('D:(A;;unreadable;;;WD)')).toThrow('unreadable entry')
    expect(() => accessEntries('D:(A;;FA)')).toThrow('unreadable entry')
  })

  it('counts no entry that denies, reads only the DACL, and counts an alias it does not know', () => {
    const sddl = `D:P(D;OICI;FA;;;WD)(A;OICI;FA;;;${USER})(A;;FR;;;ZZ)S:(AU;SAFA;FA;;;WD)`
    expect(othersLetIn(accessEntries(sddl), USER)).toEqual(['alias:ZZ'])
  })

  it('takes a list with no DACL at all as letting everyone in', () => {
    expect(othersLetIn(accessEntries('O:BAD:NO_ACCESS_CONTROL'), USER)).toEqual(['S-1-1-0'])
  })

  it('reads past a condition inside an entry to the entries after it', () => {
    const sddl = `D:(XA;;FA;;;BA;(Member_of {SID(BA)}))(A;OICI;FR;;;BU)(A;OICI;FA;;;${USER})`
    expect(othersLetIn(accessEntries(sddl), USER)).toEqual([USERS])
  })

  it.each([
    ['SY', SYSTEM_SID],
    ['BA', ADMINISTRATORS_SID],
    ['BU', 'S-1-5-32-545'],
    ['BG', 'S-1-5-32-546'],
    ['PU', 'S-1-5-32-547'],
    ['AO', 'S-1-5-32-548'],
    ['SO', 'S-1-5-32-549'],
    ['PO', 'S-1-5-32-550'],
    ['BO', 'S-1-5-32-551'],
    ['RE', 'S-1-5-32-552'],
    ['RU', 'S-1-5-32-554'],
    ['RD', 'S-1-5-32-555'],
    ['NO', 'S-1-5-32-556'],
    ['MU', 'S-1-5-32-558'],
    ['LU', 'S-1-5-32-559'],
    ['IS', 'S-1-5-32-568'],
    ['CY', 'S-1-5-32-569'],
    ['ER', 'S-1-5-32-573'],
    ['CD', 'S-1-5-32-574'],
    ['RA', 'S-1-5-32-575'],
    ['ES', 'S-1-5-32-576'],
    ['MS', 'S-1-5-32-577'],
    ['HA', 'S-1-5-32-578'],
    ['AA', 'S-1-5-32-579'],
    ['RM', 'S-1-5-32-580'],
    ['WD', 'S-1-1-0'],
    ['CO', 'S-1-3-0'],
    ['CG', 'S-1-3-1'],
    ['OW', 'S-1-3-4'],
    ['NU', 'S-1-5-2'],
    ['IU', 'S-1-5-4'],
    ['SU', 'S-1-5-6'],
    ['AN', 'S-1-5-7'],
    ['ED', 'S-1-5-9'],
    ['PS', 'S-1-5-10'],
    ['AU', 'S-1-5-11'],
    ['RC', 'S-1-5-12'],
    ['LS', 'S-1-5-19'],
    ['NS', 'S-1-5-20'],
    ['WR', 'S-1-5-33'],
    ['UD', 'S-1-5-84-0-0-0-0-0'],
    ['AC', 'S-1-15-2-1'],
    ['AS', 'S-1-18-1'],
    ['SS', 'S-1-18-2'],
    ['LA', BUILT_IN_ADMINISTRATOR],
    ['LG', `${MACHINE}-501`],
  ])('reads the alias %s as %s', (alias, sid) => {
    expect(accessEntries(`D:(A;;FA;;;${alias})`, MACHINE)).toEqual([{ allows: true, sid }])
  })

  it('counts this computer’s accounts as someone else when its SID is not known, and a domain’s groups too', () => {
    expect(othersLetIn(accessEntries('D:(A;;FA;;;LA)(A;;FA;;;LG)(A;;FA;;;DU)'), USER)).toEqual([
      'alias:LA',
      'alias:LG',
      'alias:DU',
    ])
  })

  it('knows a user who is this computer’s built-in Administrator, written LA, as that user', () => {
    const sddl = 'D:PAI(A;OICI;FA;;;LA)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)'
    expect(othersLetIn(accessEntries(sddl, MACHINE), BUILT_IN_ADMINISTRATOR)).toEqual([])
    // Anyone else meeting this computer's Administrator there counts it as someone else.
    expect(othersLetIn(accessEntries(sddl, MACHINE), USER)).toEqual([BUILT_IN_ADMINISTRATOR])
  })

  it('finds this computer’s SID only for one of its local accounts', () => {
    const groups = '"Everyone","Well-known group","S-1-1-0","…"\r\n'
    const local = `${groups}"NT AUTHORITY\\Local account","Well-known group","S-1-5-113","…"\r\n`
    expect(machineSidOf(BUILT_IN_ADMINISTRATOR, local, 'runner', 'RUNNER-PC')).toBe(MACHINE)
    // Without that group, by the domain whoami names it in being this computer's own name.
    expect(machineSidOf(USER, groups, 'runner-pc', 'RUNNER-PC')).toBe(MACHINE)
    // A domain account, or one whose SID is not a computer's or a domain's.
    expect(machineSidOf(USER, groups, 'CORP', 'RUNNER-PC')).toBeNull()
    expect(machineSidOf('S-1-12-1-1-2-3-4', local, 'AzureAD', 'RUNNER-PC')).toBeNull()
  })

  it('refuses a list it cannot read to its end', () => {
    expect(() => accessEntries('D:(A;;FA;;;SY')).toThrow('ends inside an entry')
    expect(() => accessEntries('D:(A;;FA;;;SY)junk')).toThrow('does not read')
    expect(() => accessEntries('O:SY')).toThrow('no DACL')
  })
})

/** Access lists that answer from `states`, one read at a time, and record what is asked. */
function fakeLists(
  states: string[],
  fail: Partial<Record<'read' | 'restrict', Error>> = {},
  user = USER,
) {
  const asked: string[] = []
  const lists: AccessLists = {
    userSid: () => Promise.resolve(user),
    machineSid: () => Promise.resolve(MACHINE),
    read: (folder) => {
      asked.push(`read ${folder}`)
      if (fail.read) return Promise.reject(fail.read)
      return Promise.resolve(states.shift() ?? '')
    },
    restrict: (folder, user, others) => {
      asked.push(`restrict ${folder} ${user} ${others.join(',')}`)
      return fail.restrict ? Promise.reject(fail.restrict) : Promise.resolve()
    },
  }
  return { lists, asked }
}

describe('keeping a recovery folder to this user on Windows', () => {
  it('leaves a folder that lets in no one else as it is', async () => {
    const { lists, asked } = fakeLists([IN_THE_PROFILE])
    await keepToThisUser('C:\\data\\backups', lists, 'win32')
    expect(asked).toEqual(['read C:\\data\\backups'])
  })

  it('leaves it as it is for this computer’s built-in Administrator, whose own entry reads LA', async () => {
    const theirs = 'D:(A;OICIID;FA;;;SY)(A;OICIID;FA;;;BA)(A;OICIID;FA;;;LA)'
    const { lists, asked } = fakeLists([theirs], {}, BUILT_IN_ADMINISTRATOR)
    await keepToThisUser('C:\\data\\backups', lists, 'win32')
    expect(asked).toEqual(['read C:\\data\\backups'])
  })

  it('makes a folder others may read private, and checks it again', async () => {
    const { lists, asked } = fakeLists([ON_ANOTHER_DRIVE, MADE_PRIVATE])
    await keepToThisUser('D:\\data\\backups', lists, 'win32')
    expect(asked).toEqual([
      'read D:\\data\\backups',
      `restrict D:\\data\\backups ${USER} ${AUTHENTICATED},${USERS}`,
      'read D:\\data\\backups',
    ])
  })

  it('refuses a folder others may still read after that, saying so', async () => {
    const { lists } = fakeLists([ON_ANOTHER_DRIVE, `D:PAI(A;OICI;FA;;;${USER})(A;OICI;FR;;;BU)`])
    await expect(keepToThisUser('D:\\data\\backups', lists, 'win32')).rejects.toThrow(
      'BroCrew could not make D:\\data\\backups readable by you alone: 1 other account may still read it, so it did not use it.',
    )
  })

  it('refuses a folder whose list cannot be read or changed, saying which', async () => {
    await expect(
      keepToThisUser(
        'D:\\a',
        fakeLists([], { read: new Error('icacls timed out') }).lists,
        'win32',
      ),
    ).rejects.toThrow(
      'BroCrew could not check who may read D:\\a, so it did not use it: icacls timed out',
    )
    await expect(
      keepToThisUser(
        'D:\\b',
        fakeLists([ON_ANOTHER_DRIVE], { restrict: new Error('Access is denied') }).lists,
        'win32',
      ),
    ).rejects.toThrow(
      'BroCrew could not make D:\\b readable by you alone, so it did not use it: Access is denied',
    )
  })

  it('checks a folder every time it is made, and nothing off Windows', async () => {
    const { lists, asked } = fakeLists([IN_THE_PROFILE, IN_THE_PROFILE])
    await keepToThisUser('C:\\data\\recovery', lists, 'win32')
    await keepToThisUser('C:\\data\\recovery', lists, 'win32')
    await keepToThisUser('/data/recovery', lists, 'darwin')
    expect(asked).toEqual(['read C:\\data\\recovery', 'read C:\\data\\recovery'])
  })
})

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe.runIf(process.platform === 'win32')('on a real Windows folder every user may read', () => {
  const icacls = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe')

  it('makes the folder, and what is made in it, readable by this user, SYSTEM and Administrators alone', async () => {
    const root = mkdtempSync(join(tmpdir(), 'brobot2-acl-'))
    roots.push(root)
    // A parent that lets every user read what is made in it.
    execFileSync(icacls, [root, '/grant', `*${USERS}:(OI)(CI)RX`, '/Q'])
    const folder = join(root, 'backups')
    mkdirSync(folder)
    // A copy an earlier build left there, inheriting the parent's list.
    const left = join(folder, 'an-older-copy.sqlite')
    writeFileSync(left, 'bytes')
    const user = await windowsAccessLists.userSid()
    const machine = await windowsAccessLists.machineSid()
    expect(
      othersLetIn(accessEntries(await windowsAccessLists.read(folder), machine), user),
    ).toContain(USERS)

    await keepToThisUser(folder)

    const allowed = (path: string) =>
      windowsAccessLists.read(path).then(
        (sddl) =>
          new Set(
            accessEntries(sddl, machine)
              .filter((e) => e.allows)
              .map((e) => e.sid),
          ),
      )
    expect(await allowed(folder)).toEqual(new Set([user, SYSTEM_SID, ADMINISTRATORS_SID]))
    expect(await allowed(left)).toEqual(new Set([user, SYSTEM_SID, ADMINISTRATORS_SID]))
    const made = join(folder, 'database.sqlite')
    writeFileSync(made, 'bytes')
    expect(await allowed(made)).toEqual(new Set([user, SYSTEM_SID, ADMINISTRATORS_SID]))
  })
})
