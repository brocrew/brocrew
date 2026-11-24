import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codexCopyIdentityIn } from '@brobot2/runtime/codex'
import {
  DEFAULT_PROFILE_ID,
  createProviderAuthOps,
  deriveProviderHome,
  prepareProviderHome,
} from '../src/main/connections/homes'
import { aFictionalHome } from './lib/a-fictional-home'
import { stopKeepingCodexSignInsInStep } from '../../../packages/runtime/src/codex/shared-sign-in'

interface FictionalSignIn {
  readonly auth_mode: 'chatgpt'
  readonly tokens: { account_id: string; access_token: string; refresh_token: string }
  readonly last_refresh: string
}

const signIn = (account: string, refresh: string, refreshed: string): FictionalSignIn => ({
  auth_mode: 'chatgpt',
  tokens: { account_id: account, access_token: `access-${refresh}`, refresh_token: refresh },
  last_refresh: refreshed,
})

/** A token authority that rotates: each renewal key works once, and a spent one is refused. */
class FictionalTokenAuthority {
  private readonly live = new Map<string, string>()
  readonly refused: string[] = []
  posts = 0
  issue(one: FictionalSignIn): void {
    this.live.set(one.tokens.account_id, one.tokens.refresh_token)
  }
  liveKeyOf(account: string): string | undefined {
    return this.live.get(account)
  }
  renew(account: string, refresh: string): { access: string; refresh: string } {
    this.posts += 1
    if (this.live.get(account) !== refresh) {
      this.refused.push(refresh)
      throw new Error('refresh_token_reused')
    }
    const next = `${refresh}-renewed`
    this.live.set(account, next)
    return { access: `access-${next}`, refresh: next }
  }
}

/**
 * A running Codex app-server's sign-in, renewed the way Codex 0.167.1 renews it: it keeps the
 * sign-in it read at start; before it renews it reads the file again and takes a renewal another
 * process already made on the same account; otherwise it spends its own key and writes the result
 * through any link, by rename beside the target (`login/src/auth/manager.rs`,
 * `storage_file.rs`).
 */
class RunningCodex {
  private held: FictionalSignIn
  constructor(
    private readonly home: string,
    private readonly authority: FictionalTokenAuthority,
  ) {
    this.held = this.onDisk()
  }
  private onDisk(): FictionalSignIn {
    return JSON.parse(readFileSync(join(this.home, 'auth.json'), 'utf8')) as FictionalSignIn
  }
  renews(): 'took-the-renewal-on-disk' | 'renewed' {
    const disk = this.onDisk()
    if (
      disk.tokens.account_id === this.held.tokens.account_id &&
      disk.tokens.refresh_token !== this.held.tokens.refresh_token
    ) {
      this.held = disk
      return 'took-the-renewal-on-disk'
    }
    const fresh = this.authority.renew(this.held.tokens.account_id, this.held.tokens.refresh_token)
    const next: FictionalSignIn = {
      ...disk,
      tokens: { ...disk.tokens, access_token: fresh.access, refresh_token: fresh.refresh },
      last_refresh: new Date().toISOString(),
    }
    const target = realpathSync(join(this.home, 'auth.json'))
    const staged = join(dirname(target), '.auth-fictional')
    writeFileSync(staged, JSON.stringify(next), { mode: 0o600 })
    renameSync(staged, target)
    this.held = next
    return 'renewed'
  }
  holdsTheLiveKey(): boolean {
    return this.authority.liveKeyOf(this.held.tokens.account_id) === this.held.tokens.refresh_token
  }
}

const accountOfFile = (path: string) =>
  (JSON.parse(readFileSync(path, 'utf8')) as FictionalSignIn).tokens.account_id

/** Every regular `auth.json` under a folder, by the renewal key it holds. */
function holdersOf(root: string): Map<string, string[]> {
  const found = new Map<string, string[]>()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const kind = lstatSync(path)
      if (kind.isDirectory()) walk(path)
      else if (kind.isFile() && name === 'auth.json') {
        const key = (JSON.parse(readFileSync(path, 'utf8')) as FictionalSignIn).tokens.refresh_token
        found.set(key, [...(found.get(key) ?? []), path])
      }
    }
  }
  walk(root)
  return found
}

/**
 * # Codex agents on one account share one sign-in
 *
 * A copy of a Codex sign-in shares its renewal key with the file it came from, and whichever
 * renews first spends the other's. So every Codex agent on an account reads and renews one sign-in,
 * and nothing copies one: not this computer's own Codex, not BroBot's own profile, not another agent.
 *
 * ⚑ A scratch data folder, fictional sign-ins and tokens, and a fictional home whose own Codex
 * sign-in is a fictional decoy: no real sign-in is read.
 */
describe('Codex agents on one account share one sign-in', () => {
  const fictional = aFictionalHome()
  let userData: string
  let authority: FictionalTokenAuthority
  const homeOf = (profileId: string) =>
    deriveProviderHome(userData, { profileId, provider: 'codex' })
  const thisComputersOwn = () => join(fictional.home(), '.codex', 'auth.json')
  const prepare = (profileId: string) =>
    prepareProviderHome(userData, { profileId, provider: 'codex' })
  const holding = (profileId: string, one: FictionalSignIn) => {
    mkdirSync(homeOf(profileId), { recursive: true, mode: 0o700 })
    writeFileSync(join(homeOf(profileId), 'auth.json'), JSON.stringify(one), { mode: 0o600 })
  }

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-one-sign-in-'))
    authority = new FictionalTokenAuthority()
  })
  afterEach(() => {
    stopKeepingCodexSignInsInStep()
    rmSync(userData, { recursive: true, force: true })
  })
  const keyIn = (profileId: string) =>
    (JSON.parse(readFileSync(join(homeOf(profileId), 'auth.json'), 'utf8')) as FictionalSignIn)
      .tokens.refresh_token
  /** Whether this computer let BroCrew link homes; without links each holds a file kept in step. */
  const linked = (profileId: string) =>
    lstatSync(join(homeOf(profileId), 'auth.json')).isSymbolicLink()

  it('🔴 two agents on one account both keep working across a renewal', async () => {
    // This computer's own Codex, and BroBot's own copy of it, as an older BroCrew left them.
    const chain = signIn('acct-fictional-one', 'key-one', '2026-11-20T08:00:00Z')
    writeFileSync(thisComputersOwn(), JSON.stringify(chain), { mode: 0o600 })
    holding(DEFAULT_PROFILE_ID, chain)
    authority.issue(chain)

    const farah = new RunningCodex(await prepare('farah'), authority)
    const ilse = new RunningCodex(await prepare('ilse'), authority)

    expect(farah.renews()).toBe('renewed')
    await vi.waitFor(() => expect(keyIn('ilse')).toBe('key-one-renewed'))
    expect(ilse.renews()).toBe('took-the-renewal-on-disk')
    expect(ilse.renews()).toBe('renewed')
    await vi.waitFor(() => expect(keyIn('farah')).toBe('key-one-renewed-renewed'))
    expect(farah.renews()).toBe('took-the-renewal-on-disk')

    expect(authority.refused).toEqual([])
    expect(authority.posts).toBe(2)
    expect(farah.holdsTheLiveKey()).toBe(true)
    expect(ilse.holdsTheLiveKey()).toBe(true)
  })

  it('🔴 no Codex sign-in is ever copied from this computer’s own Codex or from another home', async () => {
    const fromThisComputer = signIn('acct-fictional-one', 'key-computer', '2026-11-24T00:30:00Z')
    writeFileSync(thisComputersOwn(), JSON.stringify(fromThisComputer), { mode: 0o600 })
    const computersBytes = readFileSync(thisComputersOwn())
    holding(DEFAULT_PROFILE_ID, signIn('acct-fictional-one', 'key-own', '2026-11-22T09:00:00Z'))
    holding('farah', signIn('acct-fictional-one', 'key-farah', '2026-11-21T09:00:00Z'))
    holding('kofi', signIn('acct-fictional-two', 'key-kofi', '2026-11-20T09:00:00Z'))
    const ops = createProviderAuthOps(userData, { codexCommand: () => join(userData, 'no-codex') })

    // Every way BroCrew has had of putting a sign-in in a home: a start, the check before each
    // turn, a person's re-copy, and the replacement after a refusal.
    const steps: [string, (profileId: string) => Promise<unknown>][] = [
      ['a start', (profileId) => prepare(profileId)],
      [
        'the check before a turn',
        async (profileId) => {
          if (ops.hasNewerCopy?.('codex', profileId) === true)
            await ops.reprovision('codex', profileId, true, () => true)
        },
      ],
      ['a re-copy', async (profileId) => ops.reprovision('codex', profileId)],
      [
        'a refusal',
        async (profileId) =>
          ops.replaceARefusedCopy(
            'codex',
            profileId,
            codexCopyIdentityIn(homeOf(profileId)),
            () => true,
          ),
      ],
    ]
    for (const [what, step] of steps) {
      for (const profileId of [DEFAULT_PROFILE_ID, 'farah', 'ilse', 'kofi']) {
        await step(profileId).catch(() => undefined)
        const holders = holdersOf(userData)
        expect([...holders.keys()], `${what}, ${profileId}`).not.toContain('key-computer')
        // With links, one file per renewal key; without, every holder is on that key's account.
        for (const [key, files] of holders) {
          if (linked('farah'))
            expect(files, `${what}, ${profileId}: ${key} has one holder`).toHaveLength(1)
          else
            expect(new Set(files.map(accountOfFile)).size, `${what}, ${profileId}: ${key}`).toBe(1)
        }
      }
    }
    expect(readFileSync(thisComputersOwn()).equals(computersBytes)).toBe(true)

    // Each agent reads its own account's one sign-in.
    const signInOf = (profileId: string) =>
      linked(profileId) ? realpathSync(join(homeOf(profileId), 'auth.json')) : keyIn(profileId)
    expect(signInOf('farah')).toBe(signInOf(DEFAULT_PROFILE_ID))
    expect(signInOf('ilse')).toBe(signInOf(DEFAULT_PROFILE_ID))
    expect(signInOf('kofi')).not.toBe(signInOf(DEFAULT_PROFILE_ID))
  })

  it('⚑ a sign-in started in one agent becomes its account’s one sign-in for every agent on it', async () => {
    const dead = signIn('acct-fictional-one', 'key-dead', '2026-11-20T08:00:00Z')
    holding(DEFAULT_PROFILE_ID, dead)
    await prepare('farah')
    await prepare('ilse')
    const fresh = signIn('acct-fictional-one', 'key-fresh', '2026-11-24T01:00:00Z')

    // A sign-in that could not start leaves the agent on its account's sign-in.
    const ops = createProviderAuthOps(userData, { codexCommand: () => join(userData, 'no-codex') })
    await expect(ops.signIn('codex', 'farah')).rejects.toThrow()
    expect(keyIn('farah')).toBe(keyIn(DEFAULT_PROFILE_ID))
    // What Codex's own sign-in leaves in the home BroCrew made room in: a file of its own.
    rmSync(join(homeOf('farah'), 'auth.json'))
    writeFileSync(join(homeOf('farah'), 'auth.json'), JSON.stringify(fresh), { mode: 0o600 })
    await prepare('farah')
    await prepare(DEFAULT_PROFILE_ID)

    for (const profileId of [DEFAULT_PROFILE_ID, 'farah', 'ilse']) {
      await vi.waitFor(() => expect(keyIn(profileId), profileId).toBe('key-fresh'))
    }
    expect([...holdersOf(userData).keys()]).toEqual(['key-fresh'])
  })

  it('🔴 a sign-in that could not start leaves an agent on the account it was on', async () => {
    holding(DEFAULT_PROFILE_ID, signIn('acct-fictional-one', 'key-own', '2026-11-20T08:00:00Z'))
    holding('kofi', signIn('acct-fictional-two', 'key-kofi', '2026-11-21T08:00:00Z'))
    await prepare('kofi')
    const ops = createProviderAuthOps(userData, { codexCommand: () => join(userData, 'no-codex') })
    await expect(ops.signIn('codex', 'kofi')).rejects.toThrow()
    await prepare('kofi')
    const held = JSON.parse(
      readFileSync(join(homeOf('kofi'), 'auth.json'), 'utf8'),
    ) as FictionalSignIn
    expect(held.tokens.account_id).toBe('acct-fictional-two')
    expect(held.tokens.refresh_token).toBe('key-kofi')
  })

  it('⚑ with no sign-in in the workspace, a new agent asks for one', async () => {
    await expect(prepare('farah')).rejects.toThrow(/no Codex sign-in/)
  })
})
