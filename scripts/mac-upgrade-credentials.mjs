import { isDeepStrictEqual } from 'node:util'
import { requireEvidence } from './lib/mac-update-test.mjs'

export function credentialPreserved(before, after, status) {
  requireEvidence(
    typeof before === 'string',
    'Fictional plain-file credential baseline is missing.',
  )
  const file = JSON.parse(before)
  const setAt = file?.keys?.codex?.setAt
  requireEvidence(
    file.version === 1 &&
      Number.isSafeInteger(setAt) &&
      setAt > 0 &&
      isDeepStrictEqual(file.keys, {
        codex: { key: 'sk-update-rehearsal-not-a-real-key', setAt },
      }) &&
      file.cantRead === undefined,
    'Fictional plain-file credential baseline is invalid.',
  )
  requireEvidence(before === after, 'Fictional plain-file credential bytes changed during update.')
  if (arguments.length === 3)
    requireEvidence(
      status?.provider === 'codex' &&
        status.set === true &&
        status.inUse === true &&
        status.setAt === setAt &&
        status.readState !== 'unreadable' &&
        status.refusedForBilling === undefined,
      'The preserved fictional credential is not usable through the app API.',
    )
  return { store: 'api-keys.json', setAt, unchanged: true }
}

export function legacyCredentialsPreserved(before, after) {
  requireEvidence(
    Array.isArray(before) && Array.isArray(after) && isDeepStrictEqual(before, after),
    'Legacy credential rows changed during update.',
  )
}
