import test from 'node:test'
import assert from 'node:assert/strict'
import { verifySource } from './source-binding.mjs'
import { verifyOperation } from './verify-operation.mjs'

test('tested source SHA must match the checkout exactly', () => {
  const sha = 'a'.repeat(40)
  assert.equal(verifySource(sha, sha), sha)
  assert.throws(() => verifySource('b'.repeat(40), sha), /Source SHA mismatch/)
  for (const invalid of [undefined, '', 'a'.repeat(39), 'g'.repeat(40)])
    assert.throws(() => verifySource(sha, invalid), /Expected source SHA/)
})

test('catalogue result refuses the wrong source SHA before accepting product checks', () => {
  const sha = 'a'.repeat(40)
  const summary = { observedIdentity: { routeCommit: sha }, passed: true }
  assert.throws(
    () => verifyOperation('b'.repeat(40), Buffer.from(JSON.stringify(summary))),
    /Source SHA mismatch/,
  )
  assert.throws(() => verifyOperation(sha, Buffer.from(JSON.stringify(summary))))
})
