import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { othersAllowed, whoElseCanOpen } from '../lib/readable-only-by-this-user.mjs'

/**
 * Who besides this user can open a file is read by account, never by name: on Windows two accounts
 * on different machines or domains can share a user name, and only their SIDs tell them apart.
 */

const ME = 'S-1-5-21-1111111111-2222222222-3333333333-1001'
const SAME_NAME_ELSEWHERE = 'S-1-5-21-4444444444-5555555555-6666666666-1105'
const SYSTEM = { sid: 'S-1-5-18', name: 'NT AUTHORITY\\SYSTEM' }
const ADMINISTRATORS = { sid: 'S-1-5-32-544', name: 'BUILTIN\\Administrators' }

describe('the accounts an access list allows, by SID', () => {
  it('🔴 another account with the same user name, on another machine or domain, is someone else', () => {
    const access = {
      me: ME,
      allowed: [
        { sid: ME, name: 'MACHINE\\alex' },
        { sid: SAME_NAME_ELSEWHERE, name: 'DOMAIN\\alex' },
        SYSTEM,
        ADMINISTRATORS,
      ],
    }
    expect(othersAllowed(access)).toEqual([`DOMAIN\\alex (${SAME_NAME_ELSEWHERE})`])
  })

  it('this account, the system and administrators are no one else', () => {
    expect(
      othersAllowed({
        me: ME,
        allowed: [{ sid: ME, name: 'MACHINE\\alex' }, SYSTEM, ADMINISTRATORS],
      }),
    ).toEqual([])
  })

  it('a name alone vouches for nobody: this account’s name under another SID is someone else', () => {
    const access = { me: ME, allowed: [{ sid: SAME_NAME_ELSEWHERE, name: 'MACHINE\\alex' }] }
    expect(othersAllowed(access)).toEqual([`MACHINE\\alex (${SAME_NAME_ELSEWHERE})`])
  })
})

describe('a file on this computer', () => {
  const folders = []
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
  })
  const aFile = () => {
    const folder = mkdtempSync(join(tmpdir(), 'brobot-access-'))
    folders.push(folder)
    const file = join(folder, 'fictional.json')
    writeFileSync(file, '{}', { mode: 0o600 })
    return file
  }

  it('made owner-only, is opened by no one else', () => {
    expect(whoElseCanOpen(aFile(), 0o600)).toEqual([])
  })

  it('🔴 on Windows, a file every user may read names that group by its SID', (ctx) => {
    ctx.skip(process.platform !== 'win32', 'access lists are Windows’ own')
    const file = aFile()
    // BUILTIN\Users, by its well-known SID.
    execFileSync('icacls', [file, '/grant', '*S-1-5-32-545:R'], { windowsHide: true })
    expect(whoElseCanOpen(file, 0o600)).toEqual([expect.stringContaining('(S-1-5-32-545)')])
  })
})
