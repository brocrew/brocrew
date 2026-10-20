import { createHash, verify, type KeyObject } from 'node:crypto'
import { refusePlugin } from './verification-error'

export const PLUGIN_LIMITS = {
  catalogueBytes: 1024 * 1024,
  catalogueEntries: 200,
  manifestBytes: 64 * 1024,
  archiveBytes: 64 * 1024 * 1024,
  expandedBytes: 256 * 1024 * 1024,
  files: 10_000,
  compressionRatio: 100,
} as const

export const pluginSha256 = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

/** The app supplies this one public key; untrusted catalogues never select a key. */
export function pluginCatalogueSignatures(pinnedPublicKey: KeyObject) {
  if (pinnedPublicKey.type !== 'public' || pinnedPublicKey.asymmetricKeyType !== 'ed25519') {
    refusePlugin('signature')
  }
  return (bytes: Uint8Array, signature: Uint8Array): void => {
    if (bytes.byteLength > PLUGIN_LIMITS.catalogueBytes) refusePlugin('limit')
    if (signature.byteLength !== 64) refusePlugin('signature')
    let valid: boolean
    try {
      valid = verify(null, bytes, pinnedPublicKey, signature)
    } catch {
      return refusePlugin('signature')
    }
    if (!valid) refusePlugin('signature')
  }
}

export function verifyPluginDigest(
  bytes: Uint8Array,
  expected: { size: number; sha256: string },
  maximum: number,
): void {
  if (bytes.byteLength > maximum) refusePlugin('limit')
  if (
    !Number.isSafeInteger(expected.size) ||
    expected.size < 0 ||
    expected.size > maximum ||
    !/^[a-f0-9]{64}$/.test(expected.sha256) ||
    bytes.byteLength !== expected.size ||
    pluginSha256(bytes) !== expected.sha256
  )
    refusePlugin('digest')
}
