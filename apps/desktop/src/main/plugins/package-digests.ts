import { createHash } from 'node:crypto'
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
