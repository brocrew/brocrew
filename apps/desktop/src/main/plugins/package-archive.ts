import { gunzipSync } from 'node:zlib'
import { PLUGIN_LIMITS } from './package-digests'
import { PluginPackagePaths } from './package-path'
import { refusePlugin } from './verification-error'

function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return refusePlugin('invalid')
  }
}
function field(header: Buffer, start: number, length: number): string {
  const bytes = header.subarray(start, start + length)
  const zero = bytes.indexOf(0)
  if (zero !== -1 && bytes.subarray(zero).some((value) => value !== 0)) refusePlugin('invalid')
  return utf8(zero === -1 ? bytes : bytes.subarray(0, zero))
}
function octal(header: Buffer, start: number, length: number): number {
  const raw = header.subarray(start, start + length).toString('latin1')
  if (!/^ *[0-7]*[\0 ]*$/.test(raw)) refusePlugin('invalid')
  const value = raw.replace(/[\0 ]+$/g, '').trim()
  const number = value === '' ? 0 : Number.parseInt(value, 8)
  if (!Number.isSafeInteger(number) || number < 0) refusePlugin('limit')
  return number
}

/** Decodes only the admitted USTAR profile. No path is ever opened or written here. */
export function readPluginArchive(
  downloaded: Buffer,
  compression: 'tar' | 'tar.gz',
): ReadonlyMap<string, Buffer> {
  if (downloaded.length > PLUGIN_LIMITS.archiveBytes) refusePlugin('limit')
  let archive: Buffer
  if (compression === 'tar.gz') {
    const maximum = Math.min(
      PLUGIN_LIMITS.expandedBytes,
      downloaded.length * PLUGIN_LIMITS.compressionRatio,
    )
    if (maximum === 0) refusePlugin('invalid')
    try {
      archive = gunzipSync(downloaded, { maxOutputLength: maximum })
    } catch {
      return refusePlugin('limit')
    }
  } else archive = downloaded
  if (archive.length > PLUGIN_LIMITS.expandedBytes || archive.length % 512 !== 0)
    refusePlugin('limit')
  const paths = new PluginPackagePaths()
  const files = new Map<string, Buffer>()
  let offset = 0
  let entries = 0
  let expanded = 0
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    if (header.every((value) => value === 0)) {
      if (offset + 1024 > archive.length || archive.subarray(offset).some((value) => value !== 0))
        refusePlugin('invalid')
      return files
    }
    if (++entries > PLUGIN_LIMITS.files) refusePlugin('limit')
    if (
      header.subarray(257, 263).toString('latin1') !== 'ustar\0' ||
      header.subarray(263, 265).toString('latin1') !== '00'
    )
      refusePlugin('invalid')
    let checksum = 0
    for (let index = 0; index < 512; index++)
      checksum += index >= 148 && index < 156 ? 32 : header[index]!
    if (checksum !== octal(header, 148, 8)) refusePlugin('invalid')
    const type = header[156]
    if (type !== 0 && type !== 48 && type !== 53) refusePlugin('path')
    if (
      field(header, 157, 100) !== '' ||
      octal(header, 329, 8) !== 0 ||
      octal(header, 337, 8) !== 0
    )
      refusePlugin('path')
    if (header.subarray(500).some((value) => value !== 0) || octal(header, 100, 8) > 0o777)
      refusePlugin('invalid')
    // Validate numeric fields even though ownership and timestamps are never applied.
    octal(header, 108, 8)
    octal(header, 116, 8)
    octal(header, 136, 12)
    const size = octal(header, 124, 12)
    expanded += size
    if (expanded > PLUGIN_LIMITS.expandedBytes) refusePlugin('limit')
    const name = field(header, 0, 100)
    const prefix = field(header, 345, 155)
    let path = prefix === '' ? name : `${prefix}/${name}`
    const directory = type === 53
    if (directory && path.endsWith('/')) path = path.slice(0, -1)
    paths.add(path, directory ? 'directory' : 'file')
    if (directory && size !== 0) refusePlugin('invalid')
    const start = offset + 512
    const end = start + size
    offset = start + Math.ceil(size / 512) * 512
    if (offset > archive.length || archive.subarray(end, offset).some((value) => value !== 0))
      refusePlugin('invalid')
    if (!directory) files.set(path, archive.subarray(start, end))
  }
  return refusePlugin('invalid')
}
