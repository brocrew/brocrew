import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  catchUpCodexSignIn,
  codexSignInIsKeptAsAFile,
  makeRoomForACodexSignIn,
  shareCodexSignIn,
  stopKeepingCodexSignInsInStep,
} from '../src/codex/shared-sign-in'

import {
  type FictionalSignIn,
  codexHomesUnder,
  noLinks,
  signIn,
} from './fixtures/codex-sign-in-homes'

/**
 * A running Codex app-server, renewing as Codex 0.167.1 does: it reads its file again before it
 * renews and takes a renewal on the same account that is already there; otherwise it spends its own
 * key, then writes the result by rename (`login/src/auth/manager.rs`, `storage.rs`).
 */
class RunningCodex {
  private held: FictionalSignIn
  constructor(
    private readonly home: string,
    private readonly live: Map<string, string>,
    private readonly refused: string[],
  ) {
    this.held = this.onDisk()
  }
  private onDisk(): FictionalSignIn {
    return JSON.parse(readFileSync(join(this.home, 'auth.json'), 'utf8')) as FictionalSignIn
  }
  renews(at: string): 'took-the-renewal-on-disk' | 'renewed' {
    const disk = this.onDisk()
    if (disk.tokens.refresh_token !== this.held.tokens.refresh_token) {
      this.held = disk
      return 'took-the-renewal-on-disk'
    }
    const account = this.held.tokens.account_id
    if (this.live.get(account) !== this.held.tokens.refresh_token) {
      this.refused.push(this.held.tokens.refresh_token)
      throw new Error('refresh_token_reused')
    }
    const next = signIn(account, `${this.held.tokens.refresh_token}-renewed`, at)
    this.live.set(account, next.tokens.refresh_token)
    const staged = join(this.home, '.auth-fictional')
    writeFileSync(staged, JSON.stringify(next), { mode: 0o600 })
    renameSync(staged, join(this.home, 'auth.json'))
    this.held = next
    return 'renewed'
  }
}

/**
 * # Codex agents on one account share one sign-in where this computer refuses links
 *
 * Windows makes a link only with Developer Mode or admin rights. Without them, each agent holds its
 * account's sign-in as a file of its own, and a renewal one agent's Codex writes reaches the others
 * before they renew, so they take it instead of spending the key again.
 */
describe('Codex agents on one account share one sign-in where this computer refuses links', () => {
  let root: string
  const { homeOf, keyIn } = codexHomesUnder(() => root)
  const share = (who: string) =>
    shareCodexSignIn(homeOf(who), {
      managedRoot: root,
      ownHome: homeOf('brobot'),
      link: noLinks,
      platform: 'win32',
    })
  const holding = (who: string, one: FictionalSignIn) => {
    mkdirSync(homeOf(who), { recursive: true, mode: 0o700 })
    writeFileSync(join(homeOf(who), 'auth.json'), JSON.stringify(one), { mode: 0o600 })
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-no-links-'))
    for (const who of ['brobot', 'farah', 'ilse']) mkdirSync(homeOf(who), { recursive: true })
  })
  afterEach(() => {
    stopKeepingCodexSignInsInStep()
    rmSync(root, { recursive: true, force: true })
  })

  it('🔴 two agents on one account both keep working across a renewal', async () => {
    const live = new Map<string, string>()
    const refused: string[] = []
    const chain = signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z')
    holding('brobot', chain)
    live.set('acct-fictional-one', 'key-one')
    holding('farah', signIn('acct-fictional-one', 'key-stale', '2026-11-18T08:00:00.000Z'))
    await share('farah')
    await share('ilse')
    expect(lstatSync(join(homeOf('farah'), 'auth.json')).isFile()).toBe(true)
    expect(keyIn('farah')).toBe('key-one')
    expect(keyIn('ilse')).toBe('key-one')

    const farah = new RunningCodex(homeOf('farah'), live, refused)
    const ilse = new RunningCodex(homeOf('ilse'), live, refused)
    expect(farah.renews('2026-11-24T01:00:00.000Z')).toBe('renewed')
    await vi.waitFor(() => expect(keyIn('ilse')).toBe('key-one-renewed'))
    expect(ilse.renews('2026-11-24T01:00:01.000Z')).toBe('took-the-renewal-on-disk')
    expect(ilse.renews('2026-11-24T02:00:00.000Z')).toBe('renewed')
    await vi.waitFor(() => expect(keyIn('farah')).toBe('key-one-renewed-renewed'))
    expect(farah.renews('2026-11-24T02:00:01.000Z')).toBe('took-the-renewal-on-disk')
    expect(refused).toEqual([])
  })

  it('⚑ a home kept as a file says so, for the hint to turn on Developer Mode', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    expect(codexSignInIsKeptAsAFile(homeOf('farah'), root)).toBe(false)
    await share('farah')
    expect(codexSignInIsKeptAsAFile(homeOf('farah'), root)).toBe(true)
    // Where this computer makes links, a linked home is not kept as a file.
    await shareCodexSignIn(homeOf('ilse'), { managedRoot: root, ownHome: homeOf('brobot') })
    const linked = lstatSync(join(homeOf('ilse'), 'auth.json')).isSymbolicLink()
    expect(codexSignInIsKeptAsAFile(homeOf('ilse'), root)).toBe(!linked)
  })

  it('🔴 a new agent joins its account’s sign-in rather than being refused', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    await expect(share('farah')).resolves.toBe('joined')
    expect(keyIn('farah')).toBe('key-one')
  })

  it('⚑ a sign-in started in one agent reaches every agent on its account', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-dead', '2026-11-20T08:00:00.000Z'))
    await share('farah')
    await share('ilse')
    const fresh = signIn('acct-fictional-one', 'key-fresh', '2026-11-24T01:00:00.000Z')
    writeFileSync(join(homeOf('farah'), '.auth-fictional'), JSON.stringify(fresh))
    renameSync(join(homeOf('farah'), '.auth-fictional'), join(homeOf('farah'), 'auth.json'))
    await vi.waitFor(() => expect(keyIn('ilse')).toBe('key-fresh'))
    await share('brobot')
    expect(keyIn('brobot')).toBe('key-fresh')
  })

  it('🔴 a sign-in put in its account’s place at once still reaches the other agents', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-dead', '2026-11-20T08:00:00.000Z'))
    await share('farah')
    await share('ilse')
    stopKeepingCodexSignInsInStep()
    // What a finished sign-in leaves, then shared before any watch has looked at it.
    holding('farah', signIn('acct-fictional-one', 'key-fresh', '2026-11-24T01:00:00.000Z'))
    await share('ilse')
    await share('farah')
    await vi.waitFor(() => expect(keyIn('ilse')).toBe('key-fresh'))
  })

  it('🔴 a renewal no watch passed on is taken before the next turn, and never undone', async () => {
    const live = new Map<string, string>()
    const refused: string[] = []
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    live.set('acct-fictional-one', 'key-one')
    holding('kofi', signIn('acct-fictional-two', 'key-kofi', '2026-11-20T08:00:00.000Z'))
    for (const who of ['farah', 'ilse', 'kofi']) await share(who)
    const farah = new RunningCodex(homeOf('farah'), live, refused)
    const ilse = new RunningCodex(homeOf('ilse'), live, refused)
    // Farah renews; in the same tick, before any watch can look, Ilse starts a turn.
    expect(farah.renews('2026-11-24T01:00:00.000Z')).toBe('renewed')
    catchUpCodexSignIn(homeOf('ilse'))
    expect(keyIn('ilse')).toBe('key-one-renewed')
    expect(ilse.renews('2026-11-24T01:00:01.000Z')).toBe('took-the-renewal-on-disk')
    expect(refused).toEqual([])
    // Another account is never taken, and a catch-up never brings an older one back.
    expect(keyIn('kofi')).toBe('key-kofi')
    catchUpCodexSignIn(homeOf('farah'))
    expect(keyIn('farah')).toBe('key-one-renewed')
  })

  it('⚑ a home that links is left to its link', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    await shareCodexSignIn(homeOf('ilse'), { managedRoot: root, ownHome: homeOf('brobot') })
    if (!lstatSync(join(homeOf('ilse'), 'auth.json')).isSymbolicLink()) return
    catchUpCodexSignIn(homeOf('ilse'))
    expect(lstatSync(join(homeOf('ilse'), 'auth.json')).isSymbolicLink()).toBe(true)
  })

  it('🔴 a renewal a linked agent writes reaches an agent kept as a copy before its next turn', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    await share('farah')
    await shareCodexSignIn(homeOf('ilse'), { managedRoot: root, ownHome: homeOf('brobot') })
    const through = join(homeOf('ilse'), 'auth.json')
    // Where this computer makes no link at all, there is no linked agent to write through.
    if (!lstatSync(through).isSymbolicLink()) return
    const place = realpathSync(through)
    writeFileSync(
      `${place}.next`,
      JSON.stringify(signIn('acct-fictional-one', 'key-two', '2026-11-24T01:00:00.000Z')),
    )
    renameSync(`${place}.next`, place)
    // Farah, kept as a copy, takes it before its next turn.
    catchUpCodexSignIn(homeOf('farah'))
    expect(keyIn('farah')).toBe('key-two')
  })

  it('🔴 a renewal a linked agent writes reaches an agent kept as a copy without waiting for a turn', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    await share('farah')
    await shareCodexSignIn(homeOf('ilse'), { managedRoot: root, ownHome: homeOf('brobot') })
    const through = join(homeOf('ilse'), 'auth.json')
    if (!lstatSync(through).isSymbolicLink()) return
    // Late events from setting the homes up pass by first, so only a watch on the place can act.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const place = realpathSync(through)
    writeFileSync(
      `${place}.next`,
      JSON.stringify(signIn('acct-fictional-one', 'key-two', '2026-11-24T01:00:00.000Z')),
    )
    renameSync(`${place}.next`, place)
    await vi.waitFor(() => expect(keyIn('farah')).toBe('key-two'), { timeout: 2000 })
  })

  it('🔴 the check before a turn never overwrites a newer sign-in a watch failed to pass on', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    await share('farah')
    await share('ilse')
    stopKeepingCodexSignInsInStep()
    await share('farah')
    await share('ilse')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      // Farah's Codex renewed; the watch that would pass it on never ran.
      holding('farah', signIn('acct-fictional-one', 'key-two', '2026-11-24T01:00:00.000Z'))
      catchUpCodexSignIn(homeOf('farah'))
      expect(keyIn('farah')).toBe('key-two')
      expect(keyIn('ilse')).toBe('key-two')
    } finally {
      vi.useRealTimers()
    }
  })

  it('⛔ copies only where Windows refuses link rights: any other failure is said as it came', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    const fails = (code: string) => (): never => {
      throw Object.assign(new Error(code), { code })
    }
    const own = homeOf('brobot')
    await expect(
      shareCodexSignIn(homeOf('farah'), {
        managedRoot: root,
        ownHome: own,
        link: fails('ENOSPC'),
        platform: 'win32',
      }),
    ).rejects.toMatchObject({ code: 'ENOSPC' })
    await expect(
      shareCodexSignIn(homeOf('ilse'), {
        managedRoot: root,
        ownHome: own,
        link: fails('EPERM'),
        platform: 'darwin',
      }),
    ).rejects.toMatchObject({ code: 'EPERM' })
    for (const who of ['farah', 'ilse']) {
      expect(() => lstatSync(join(homeOf(who), 'auth.json'))).toThrow()
    }
  })

  it('⛔ an older sign-in in a home never replaces its account’s newer one', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-new', '2026-11-24T08:00:00.000Z'))
    await share('ilse')
    holding('farah', signIn('acct-fictional-one', 'key-old', '2026-11-01T08:00:00.000Z'))
    await share('farah')
    expect(keyIn('farah')).toBe('key-new')
    expect(keyIn('ilse')).toBe('key-new')
  })

  it('⚑ agents on another account are left alone', async () => {
    holding('brobot', signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00.000Z'))
    holding('farah', signIn('acct-fictional-two', 'key-two', '2026-11-20T08:00:00.000Z'))
    await share('farah')
    await share('ilse')
    const renewed = signIn('acct-fictional-one', 'key-one-renewed', '2026-11-24T01:00:00.000Z')
    writeFileSync(join(homeOf('ilse'), '.auth-fictional'), JSON.stringify(renewed))
    renameSync(join(homeOf('ilse'), '.auth-fictional'), join(homeOf('ilse'), 'auth.json'))
    await share('brobot')
    await vi.waitFor(() => expect(keyIn('brobot')).toBe('key-one-renewed'))
    expect(keyIn('farah')).toBe('key-two')
  })
})

describe('a sign-in that writes nothing leaves a home on the account it was on', () => {
  let root: string
  const { homeOf } = codexHomesUnder(() => root)
  const accountIn = (who: string) =>
    (JSON.parse(readFileSync(join(homeOf(who), 'auth.json'), 'utf8')) as FictionalSignIn).tokens
      .account_id
  const share = (who: string) =>
    shareCodexSignIn(homeOf(who), { managedRoot: root, ownHome: homeOf('brobot') })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-put-back-'))
    for (const who of ['brobot', 'kofi']) mkdirSync(homeOf(who), { recursive: true })
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('🔴 an agent on another account stays on it after a cancelled sign-in', async () => {
    writeFileSync(
      join(homeOf('brobot'), 'auth.json'),
      JSON.stringify(signIn('acct-fictional-one', 'key-own', '2026-11-20T08:00:00.000Z')),
    )
    writeFileSync(
      join(homeOf('kofi'), 'auth.json'),
      JSON.stringify(signIn('acct-fictional-two', 'key-kofi', '2026-11-21T08:00:00.000Z')),
    )
    await share('brobot')
    await share('kofi')
    const putBack = await makeRoomForACodexSignIn(homeOf('kofi'))
    await putBack()
    await share('kofi')
    expect(accountIn('kofi')).toBe('acct-fictional-two')
  })

  it('⚑ a sign-in that wrote a file of its own keeps it, and nothing is put back', async () => {
    writeFileSync(
      join(homeOf('kofi'), 'auth.json'),
      JSON.stringify(signIn('acct-fictional-two', 'key-kofi', '2026-11-21T08:00:00.000Z')),
    )
    await share('kofi')
    const putBack = await makeRoomForACodexSignIn(homeOf('kofi'))
    writeFileSync(
      join(homeOf('kofi'), 'auth.json'),
      JSON.stringify(signIn('acct-fictional-three', 'key-new', '2026-11-24T08:00:00.000Z')),
    )
    await putBack()
    await share('kofi')
    expect(accountIn('kofi')).toBe('acct-fictional-three')
  })
})
