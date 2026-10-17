import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * **The Claude account this computer was last seen signed in to**, as Claude Code's own documented
 * interface named it (`SessionHandle.account`), with the id this app stamps that account's usage
 * readings with: `<userData>/provider-accounts.json`.
 *
 * ⛔ **The one place the email is kept.** Readings carry the id, minted here and not derived from
 * the email. A recovery copy does not carry this file (`recovery/state-files.ts`), no log line says
 * what it holds, and nothing in it is given to an agent or a window.
 *
 * ⚑ One account at a time: a later conversation on another account replaces it. Codex needs none:
 * its sign-in tag is already of its account.
 */
export interface KnownAccount {
  /** The id its readings are stamped with: 32 hex digits, random. */
  readonly id: string
  readonly email: string
  readonly organization?: string
}

export interface KeptAccounts {
  readonly claude?: KnownAccount
}

/** Where a data folder keeps the account its Claude readings were read on. */
export function providerAccountsFile(userData: string): string {
  return join(userData, 'provider-accounts.json')
}

/** The account a stamp names: 32 hex digits. */
export const AN_ACCOUNT_ID = /^[0-9a-f]{32}$/

/** A field of an account longer than this is not read as one. */
const LONGEST_ACCOUNT_FIELD = 320

/**
 * The account `file` holds, checked as it is read, or none: a file that is missing, is not JSON or
 * holds something else is read as no account, which the next Claude conversation names again.
 */
export function readKeptAccounts(file: string): KeptAccounts {
  let said: unknown
  try {
    said = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
  const claude = aKnownAccount(aRecord(said)['claude'])
  return claude === null ? {} : { claude }
}

/** Write the account, replacing what the file held; beside it first, then renamed. */
export function writeKeptAccounts(file: string, accounts: KeptAccounts): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 })
    renameSync(temporary, file)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

function aKnownAccount(said: unknown): KnownAccount | null {
  const { id, email, organization } = aRecord(said)
  if (typeof id !== 'string' || !AN_ACCOUNT_ID.test(id)) return null
  if (!aField(email)) return null
  if (organization !== undefined && !aField(organization)) return null
  return { id, email, ...(organization === undefined ? {} : { organization }) }
}

function aField(said: unknown): said is string {
  return (
    typeof said === 'string' &&
    said.trim() !== '' &&
    said.length <= LONGEST_ACCOUNT_FIELD &&
    !/[\r\n]/.test(said)
  )
}

function aRecord(said: unknown): Record<string, unknown> {
  return typeof said === 'object' && said !== null && !Array.isArray(said)
    ? (said as Record<string, unknown>)
    : {}
}
