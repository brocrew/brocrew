import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { readKeptAccounts, writeKeptAccounts } from '../src/main/providers/claude/account-record'
import { legacyAccountRecordFormat } from '../src/main/providers/claude/account-record'
const root = mkdtempSync(join(tmpdir(), 'fictional-accounts-'))
afterEach(() => rmSync(root, { recursive: true, force: true }))
it('seeds the old latest record with its original ID and retains ordinary prior account records', () => {
  const file = join(root, 'accounts.json')
  const a = { id: 'a'.repeat(32), email: 'a@example.test' }
  const b = { id: 'b'.repeat(32), email: 'a@example.test', organization: 'different organization' }
  writeFileSync(file, JSON.stringify({ claude: a }))
  const known = legacyAccountRecordFormat.accountsIn(readKeptAccounts(file))
  expect(known).toEqual([a])
  writeKeptAccounts(file, legacyAccountRecordFormat.forAccount(b, known))
  const restarted = readKeptAccounts(file)
  expect(restarted.claude).toEqual(b)
  expect(legacyAccountRecordFormat.accountsIn(restarted)).toEqual([a, b])
  writeKeptAccounts(
    file,
    legacyAccountRecordFormat.forAccount(a, legacyAccountRecordFormat.accountsIn(restarted)),
  )
  expect(readKeptAccounts(file)).toEqual({ claude: a, claudeAccounts: [a, b] })
})
