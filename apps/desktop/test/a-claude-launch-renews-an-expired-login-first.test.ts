import { describe, expect, it } from 'vitest'
import {
  AuthUnavailableError,
  claudeLoginNotRenewed,
  type ClaudeLoginRenewal,
} from '@brobot2/runtime'
import { prepareOnTheLogin } from '../src/main/runtime/provider-homes'

/**
 * A Claude start on the person's own login has their Claude Code renew the login first when it
 * needs renewing, then prepares the home, which reads the login. When it could not be renewed, the
 * start says so and how to renew it by hand.
 *
 * The login, the home and the renewal are stand-ins: nothing reads a real login or runs a program.
 */

/** A login that has expired, a prepare that reads it, and a renewal that ends as it is told. */
function anExpiredLogin(ends: ClaudeLoginRenewal) {
  let expired = true
  const order: string[] = []
  return {
    order,
    prepare: () => {
      order.push('prepare')
      if (expired) throw new AuthUnavailableError('claude', 'the expired sentence')
      return '/the/home'
    },
    renew: async (): Promise<ClaudeLoginRenewal> => {
      order.push('renew')
      if (ends === 'renewed') expired = false
      return ends
    },
  }
}

describe('a Claude start on an expired login', () => {
  it('🔴 has it renewed first, then prepares the home on it, and says it was renewed', async () => {
    const login = anExpiredLogin('renewed')
    expect(await prepareOnTheLogin(login.prepare, login.renew)).toEqual({
      home: '/the/home',
      loginRenewed: true,
    })
    expect(login.order).toEqual(['renew', 'prepare'])
  })

  it('🔴 a run that did not renew it: the start says so, and how to renew it by hand', async () => {
    const login = anExpiredLogin('not-renewed')
    const refused = prepareOnTheLogin(login.prepare, login.renew)
    await expect(refused).rejects.toBeInstanceOf(AuthUnavailableError)
    await expect(refused).rejects.toThrow(claudeLoginNotRenewed('not-renewed'))
  })

  it('🔴 the way to renew it by hand names the Claude Code that was found, as the shell runs it', async () => {
    const login = anExpiredLogin('not-renewed')
    const command = "& 'C:\\Users\\Jo Example\\.local\\bin\\claude.exe'"
    await expect(prepareOnTheLogin(login.prepare, login.renew, () => command)).rejects.toThrow(
      `run \`${command}\``,
    )
  })

  it('no Claude Code found to run: the start says where it looked', async () => {
    const login = anExpiredLogin('not-installed')
    await expect(prepareOnTheLogin(login.prepare, login.renew)).rejects.toThrow(
      claudeLoginNotRenewed('not-installed'),
    )
  })

  it('a login that needed no renewal: the home as always, and nothing said', async () => {
    const login = anExpiredLogin('not-needed')
    await expect(prepareOnTheLogin(login.prepare, login.renew)).rejects.toThrow(
      'the expired sentence',
    )
    const fine = anExpiredLogin('renewed')
    await fine.renew()
    expect(await prepareOnTheLogin(fine.prepare, async () => 'not-needed' as const)).toEqual({
      home: '/the/home',
      loginRenewed: false,
    })
  })

  it('a refusal that is not about the login is passed on as it is', async () => {
    const other = new Error('the folder is gone')
    await expect(
      prepareOnTheLogin(
        () => {
          throw other
        },
        async () => 'not-renewed',
      ),
    ).rejects.toBe(other)
  })
})
