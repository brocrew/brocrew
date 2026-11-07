import { demand } from './contract.mjs'

export function verifySource(commit, expected) {
  demand(
    /^[a-f0-9]{40}$/.test(expected),
    'Expected source SHA must contain 40 lowercase hex digits',
  )
  demand(commit === expected, `Source SHA mismatch: expected ${expected}, got ${commit}`)
  return commit
}
