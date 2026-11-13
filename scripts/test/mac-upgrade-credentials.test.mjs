import { test } from 'vitest'
import assert from 'node:assert/strict'
import { credentialPreserved, legacyCredentialsPreserved } from '../mac-upgrade-credentials.mjs'

test('the released plain-file credential needs a positive baseline and exact bytes', () => {
  const file = {
    version: 1,
    keys: { codex: { key: 'sk-update-rehearsal-not-a-real-key', setAt: 12 } },
  }
  const before = JSON.stringify(file)
  const status = { provider: 'codex', set: true, inUse: true, setAt: 12 }
  assert.deepEqual(credentialPreserved(before, before, status), {
    store: 'api-keys.json',
    setAt: 12,
    unchanged: true,
  })
  credentialPreserved(before, before)
  for (const missing of [undefined, null, [], '', '{}', '{'])
    assert.throws(() => credentialPreserved(missing, missing, status))
  for (const edit of [
    (one) => delete one.keys.codex,
    (one) => (one.version = 2),
    (one) => (one.keys.codex.key = 'different-fictional-key'),
    (one) => (one.keys.codex.setAt = null),
    (one) => (one.cantRead = ['codex']),
  ]) {
    const changed = structuredClone(file)
    edit(changed)
    const text = JSON.stringify(changed)
    assert.throws(() => credentialPreserved(text, text, status))
    assert.throws(() => credentialPreserved(before, text, status))
  }
  assert.throws(() => credentialPreserved(before, undefined, status))
  assert.throws(() => credentialPreserved(before, `${before}\n`, status))
})

test('a preserved file must agree with the live API before it is called usable', () => {
  const before = JSON.stringify({
    version: 1,
    keys: { codex: { key: 'sk-update-rehearsal-not-a-real-key', setAt: 12 } },
  })
  const status = { provider: 'codex', set: true, inUse: true, setAt: 12 }
  for (const change of [
    { provider: 'claude' },
    { set: false },
    { inUse: false },
    { setAt: 13 },
    { setAt: undefined },
    { readState: 'unreadable' },
    { refusedForBilling: 'fictional refusal' },
  ])
    assert.throws(() => credentialPreserved(before, before, { ...status, ...change }))
  assert.throws(() => credentialPreserved(before, before, null))
  assert.throws(() => credentialPreserved(before, before, undefined))
})

test('legacy database rows stay exact even when the actual credential is in the plain file', () => {
  const rows = [{ provider: 'claude', sealed: 'fictional-legacy-row', updated_at: 11 }]
  legacyCredentialsPreserved([], [])
  legacyCredentialsPreserved(rows, structuredClone(rows))
  for (const after of [undefined, [], [{ ...rows[0], sealed: 'changed' }]])
    assert.throws(() => legacyCredentialsPreserved(rows, after))
  assert.throws(() => legacyCredentialsPreserved([], rows))
  assert.throws(() => credentialPreserved([], []))
})
