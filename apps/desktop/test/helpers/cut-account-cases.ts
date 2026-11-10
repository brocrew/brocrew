import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { FakeSessionHandle } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import type { RuntimeHost, RuntimeEventSink } from './giver-notice-host'
import {
  readKeptAccounts,
  writeKeptAccounts,
  providerAccountsFile,
} from '../../src/main/providers/claude/account-record'
import type { AppDatabase } from '../../src/main/db/connection'
import { usageKeptIn } from '../../src/main/provider-usage-file'
import {
  importTurnsTheAppCutFile,
  NO_CUTS_KEPT,
  TURNS_THE_APP_CUT_FILE,
  turnsTheAppCutIn,
  type CutState,
} from '../../src/main/turns-the-app-cut-file'

export interface Held {
  readonly promise: Promise<void>
  readonly end: () => void
}
export interface Gate {
  readonly promise: Promise<void>
  readonly open: () => void
}
/** How a life's provider behaves. */
export interface Stops {
  provider?: Provider
  savedKeyRevision?: number
  /** Its sign-in check waits for this gate: the last wait before held words are handed over. */
  signInGate?: Gate
  /** The account its provider names: a fictional one, none, or no answer at all. */
  account?: 'ada' | 'bea' | 'none' | 'never'
  organization?: string
  /** A historical credential tag or a confirmed native account tag supplied by the test. */
  tag?: string
  /** Its provider names the account only this long after the life starts, ms; at once if unset. */
  accountAfterMs?: number
  /** Its turns stay running: nothing ends them but a stop, a close or a crash. */
  turnsStayOpen?: boolean
  /** The provider never comes up. */
  beforeTheProviderIsUp?: Held
  /** The provider never takes words handed to it. */
  beforeTheWordsAreTaken?: Held
  /** The cut-turns file cannot be written. */
  cutsCannotBeKept?: boolean
  accountsCannotBeKept?: boolean
  /** No window listens to this life, so its launch continues nothing. */
  nobodyListens?: boolean
  /** Services run in this life, as the services list in its data folder says which agents are. */
  services?: boolean
  /** Every start of this agent's conversations fails. */
  startsFailFor?: string
  /** A usage limit's reset is looked at again this often, ms, and nothing is added after it. */
  limitLookMs?: number
  /** How long after its program stopped a conversation is started again, ms. */
  programWaitMs?: number
  /** Its provider's close waits for this gate: a life's teardown held. */
  closeWaitsFor?: Gate
}

interface CutAccountContext {
  life(): { readonly host: RuntimeHost; readonly db: AppDatabase }
  folder(): string
  root(): string
  handles(): FakeSessionHandle[]
  window(): RuntimeEventSink
  aTurnRunsIn(stops?: Stops): Promise<string>
  starts(moment: number, stops?: Stops): unknown
  stateOf(id: string): CutState | undefined
  continuations(id: string): string[]
  waitFor(predicate: () => boolean, what: string): Promise<void>
  settle(): Promise<void>
  EMAIL: { readonly ada: string; readonly bea: string }
  CUT: number
  SOON: number
}

export function registerPersistedCutIdentityCases({
  life,
  folder,
  aTurnRunsIn,
  EMAIL,
}: CutAccountContext): void {
  it('persists the account record before first usage', async () => {
    const id = await aTurnRunsIn({ account: 'ada', organization: 'Fictional Organisation' })
    const kept = turnsTheAppCutIn(life().db).read()
    const account = readKeptAccounts(providerAccountsFile(folder())).claude!
    expect(account).toMatchObject({ email: EMAIL.ada, organization: 'Fictional Organisation' })
    expect(kept.lives[id]?.identity).toBe(`claude:account:${account.id}`)
  })

  it.each([
    ['account', { provider: 'claude', account: 'ada' }, /^claude:account:[0-9a-f]{32}$/],
    [
      'unknown account with a credential tag',
      { provider: 'claude', account: 'none', tag: 'fictional-key' },
      undefined,
    ],
    [
      'native account',
      { provider: 'codex', tag: 'native-account:fictional-account' },
      'codex:sign-in:native-account:fictional-account',
    ],
  ] as const)('keeps the persisted identity format for an %s', async (_kind, stops, expected) => {
    const id = await aTurnRunsIn(stops)
    const kept = turnsTheAppCutIn(life().db).read()
    const identity = kept.lives[id]?.identity
    if (expected === undefined) expect(identity).toBeUndefined()
    else if (typeof expected === 'string') expect(identity).toBe(expected)
    else expect(identity).toMatch(expected)
    if (identity !== undefined) expect(identity).not.toContain(EMAIL.ada)
  })
}

export function registerLegacyCutIdentityCase({
  life,
  folder,
  aTurnRunsIn,
  starts,
  stateOf,
  continuations,
  waitFor,
  SOON,
}: CutAccountContext): void {
  it('imports a legacy digest as unknown, skips its life, and never uses the latest account', async () => {
    const id = await aTurnRunsIn()
    await life().host.closeAll()
    const kept = turnsTheAppCutIn(life().db).read()
    turnsTheAppCutIn(life().db).write(NO_CUTS_KEPT)
    life().db.prepare('DELETE FROM imported_side_file WHERE name = ?').run(TURNS_THE_APP_CUT_FILE)
    writeFileSync(
      join(folder(), TURNS_THE_APP_CUT_FILE),
      JSON.stringify({
        lives: {
          ...kept.lives,
          [id]: { ...kept.lives[id]!, identity: `claude:${'b'.repeat(32)}` },
        },
        cuts: { ...kept.cuts, [id]: { ...kept.cuts[id]!, expected: `claude:${'a'.repeat(32)}` } },
      }),
    )
    importTurnsTheAppCutFile(life().db, folder())
    const imported = turnsTheAppCutIn(life().db).read()
    expect(imported.cuts[id]!.expected).toBeNull()
    expect(imported.lives[id]).toBeUndefined()
    starts(SOON)
    await waitFor(() => typeof stateOf(id) === 'object', 'the legacy cut to be left unknown')
    expect(continuations(id)).toEqual([])
    expect(stateOf(id)).toEqual({ ended: 'account-not-known' })
  })
}

export function registerFrozenCutAccountCases({
  life,
  folder,
  root,
  handles,
  window,
  aTurnRunsIn,
  starts,
  stateOf,
  continuations,
  waitFor,
  settle,
  EMAIL,
  CUT,
  SOON,
}: CutAccountContext): void {
  it.each([
    { account: 'bea' as const },
    { account: 'ada' as const, organization: 'Another organization' },
  ])('keeps A’s cut identity across an intervening account and restart: %j', async (other) => {
    const id = await aTurnRunsIn({ account: 'ada' })
    await life().host.closeAll()
    const before = readKeptAccounts(providerAccountsFile(folder())).claude!
    starts(CUT + 1000, { ...other, nobodyListens: true })
    await life().host.createSession(
      { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root() },
      window(),
    )
    await settle()
    const intervening = readKeptAccounts(providerAccountsFile(folder())).claude!
    expect(intervening.id).not.toBe(before.id)
    await life().host.closeAll()
    starts(SOON, { account: 'ada' })
    await waitFor(() => stateOf(id) === 'sent', 'A’s cut continuation after switching back')
    expect(readKeptAccounts(providerAccountsFile(folder())).claude!.id).toBe(before.id)
    expect(continuations(id)).toHaveLength(1)
  })

  it('attributes late account usage to the existing history without relabeling an unknown life', async () => {
    const a = { id: 'a'.repeat(32), email: EMAIL.ada }
    const b = { id: 'b'.repeat(32), email: EMAIL.bea }
    writeKeptAccounts(providerAccountsFile(folder()), { claude: b, claudeAccounts: [a, b] })
    const id = await aTurnRunsIn({ account: 'never' })
    const handle = handles().at(-1)!
    await life().host.createSession(
      { provider: 'claude', profileId: 'agent-b', approvalMode: 'auto', cwd: root() },
      window(),
    )
    const otherHandle = handles().at(-1)!
    await settle()
    ;(otherHandle as unknown as { account: () => unknown }).account = () => ({ email: EMAIL.bea })
    otherHandle.simulateProviderUsage([{ window: 'five_hour', usedPercent: 9, resetsAt: null }])
    await waitFor(
      () =>
        life()
          .host.providerUsage()
          .claude.some((one) => one.usedPercent === 9),
      'overlapping B usage',
    )
    expect(usageKeptIn(life().db).read().readings.claude).toEqual([
      expect.objectContaining({ account: b.id, usedPercent: 9 }),
    ])
    ;(handle as unknown as { account: () => unknown }).account = () => ({ email: EMAIL.ada })
    handle.simulateProviderUsage([{ window: 'five_hour', usedPercent: 12, resetsAt: null }])
    await waitFor(
      () =>
        life()
          .host.providerUsage()
          .claude.some((one) => one.usedPercent === 12),
      'late usage',
    )
    await life().host.closeAll()
    const kept = readKeptAccounts(providerAccountsFile(folder()))
    expect(kept.claudeAccounts).toEqual([a, b])
    expect(usageKeptIn(life().db).read().readings.claude).toEqual([
      expect.objectContaining({ window: 'five_hour', account: a.id, usedPercent: 12 }),
    ])
    expect(turnsTheAppCutIn(life().db).read().cuts[id]!.expected).toBeNull()
    starts(SOON, { account: 'ada' })
    await waitFor(() => typeof stateOf(id) === 'object', 'unknown cut decision')
    expect(stateOf(id)).toEqual({ ended: 'account-not-known' })
    expect(continuations(id)).toEqual([])
    await life().host.createSession(
      { provider: 'claude', profileId: 'agent-a', approvalMode: 'auto', cwd: root() },
      window(),
    )
    await settle()
    expect(readKeptAccounts(providerAccountsFile(folder())).claude!.id).toBe(a.id)
    expect(readKeptAccounts(providerAccountsFile(folder())).claudeAccounts).toEqual([a, b])
  })

  it('keeps conflicting ordinary account records unknown instead of choosing or minting another ID', async () => {
    const a = { id: 'a'.repeat(32), email: EMAIL.ada }
    const conflicting = { ...a, id: 'c'.repeat(32) }
    writeKeptAccounts(providerAccountsFile(folder()), {
      claude: a,
      claudeAccounts: [a, conflicting],
    })
    const id = await aTurnRunsIn({ account: 'ada' })
    handles()
      .at(-1)!
      .simulateProviderUsage([{ window: 'five_hour', usedPercent: 12, resetsAt: null }])
    await settle()
    await life().host.closeAll()
    expect(turnsTheAppCutIn(life().db).read().cuts[id]!.expected).toBeNull()
    expect(readKeptAccounts(providerAccountsFile(folder())).claudeAccounts).toEqual([
      a,
      conflicting,
    ])
    expect(
      usageKeptIn(life().db)
        .read()
        .readings.claude.every((one) => one.account === undefined),
    ).toBe(true)
  })

  it('does not claim a durable account identity when its ordinary account file cannot be saved', async () => {
    const id = await aTurnRunsIn({ accountsCannotBeKept: true })
    await life().host.closeAll()
    expect(readKeptAccounts(providerAccountsFile(folder()))).toEqual({})
    expect(turnsTheAppCutIn(life().db).read().cuts[id]!.expected).toBeNull()
    starts(SOON)
    await waitFor(() => typeof stateOf(id) === 'object', 'unknown account cut')
    expect(continuations(id)).toEqual([])
    expect(stateOf(id)).toEqual({ ended: 'account-not-known' })
  })
}
