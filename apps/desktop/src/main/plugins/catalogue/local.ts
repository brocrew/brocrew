import { constants } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { PluginSupervisorError } from '../supervisor/protocol'
import { verifyPluginDigest, PLUGIN_LIMITS } from '../package-digests'
import type { PluginRelease } from '../package-schema'
import {
  isOwnerOnlyDirectory,
  isPrivateEntry,
  openFileNotThroughALink,
  pinDirectory,
  type DirectoryPin,
} from '../private-files'
/** Same-user build input. Check no-follow snapshots and parent identities; callers must verify
 * every returned byte by pinned signature/digest. This is not an openat ancestry guarantee.
 */
export async function readLocalRelease(
  root: string,
  parts: readonly string[],
  maximum: number,
  privateRoot = false,
): Promise<Buffer> {
  const refuse = (): never => {
    throw new PluginSupervisorError('unavailable')
  }
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > PLUGIN_LIMITS.archiveBytes ||
    !parts.length ||
    !isAbsolute(root) ||
    parts.some(
      (one) => !one || one === '.' || one === '..' || one.includes('/') || one.includes('\\'),
    )
  )
    return refuse()
  // Canonical parent check also refuses aliases in ancestors. Root itself must not be a link.
  if ((await realpath(root)) !== root) return refuse()
  let parent = root
  const pins: {
    handle: DirectoryPin
    path: string
    dev: bigint
    ino: bigint
  }[] = []
  const checkParents = async () => {
    for (const pin of pins) {
      const held = pin.handle.held(),
        now = await lstat(pin.path, { bigint: true })
      if (
        !held.isDirectory() ||
        !now.isDirectory() ||
        now.isSymbolicLink() ||
        held.dev !== pin.dev ||
        held.ino !== pin.ino ||
        now.dev !== pin.dev ||
        now.ino !== pin.ino ||
        !isPrivateEntry(held, 0o022) ||
        now.uid !== held.uid ||
        !isPrivateEntry(now, 0o022) ||
        (privateRoot &&
          pin.path === root &&
          (!isOwnerOnlyDirectory(held) || !isOwnerOnlyDirectory(now)))
      )
        return refuse()
    }
  }
  try {
    for (const part of ['', ...parts.slice(0, -1)]) {
      if (part) parent = join(parent, part)
      const before = await lstat(parent, { bigint: true })
      if (
        !before.isDirectory() ||
        before.isSymbolicLink() ||
        !isPrivateEntry(before, 0o022) ||
        (privateRoot && parent === root && !isOwnerOnlyDirectory(before))
      )
        return refuse()
      const handle = pinDirectory(parent)
      const held = handle.held()
      if (held.dev !== before.dev || held.ino !== before.ino) {
        handle.close()
        return refuse()
      }
      pins.push({ handle, path: parent, dev: held.dev, ino: held.ino })
    }
    await checkParents()
    const path = join(parent, parts.at(-1)!),
      named = await lstat(path, { bigint: true })
    if (!named.isFile() || named.isSymbolicLink()) return refuse()
    const handle = await openFileNotThroughALink(path, constants.O_RDONLY | constants.O_NONBLOCK)
    try {
      await checkParents()
      const before = await handle.stat({ bigint: true })
      if (
        !before.isFile() ||
        before.dev !== named.dev ||
        before.ino !== named.ino ||
        before.nlink !== 1n ||
        !isPrivateEntry(before, 0o022) ||
        before.size < 1n ||
        before.size > BigInt(maximum)
      )
        return refuse()
      // One extra byte detects growth without following an unbounded EOF. The admission
      // size is already <= maximum, so neither allocation nor consumption can exceed max+1.
      const buffer = Buffer.alloc(Number(before.size) + 1)
      let length = 0
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, null)
        if (!result.bytesRead) break
        length += result.bytesRead
      }
      if (length > Number(before.size)) return refuse()
      const bytes = buffer.subarray(0, length),
        after = await handle.stat({ bigint: true })
      if (
        bytes.length !== Number(before.size) ||
        bytes.length > maximum ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
      )
        return refuse()
      await checkParents()
      const final = await lstat(path, { bigint: true })
      if (
        !final.isFile() ||
        final.isSymbolicLink() ||
        final.dev !== before.dev ||
        final.ino !== before.ino
      )
        return refuse()
      return bytes
    } finally {
      await handle.close()
    }
  } finally {
    for (const pin of pins.reverse()) pin.handle.close()
  }
}
export async function localPluginArchive(
  root: string,
  release: Readonly<PluginRelease>,
): Promise<Buffer> {
  const suffix = release.archive.compression === 'tar.gz' ? '.tar.gz' : '.tar'
  const bytes = await readLocalRelease(
    root,
    ['archives', release.archive.sha256 + suffix],
    Math.min(release.archive.size, PLUGIN_LIMITS.archiveBytes),
  )
  verifyPluginDigest(bytes, release.archive, PLUGIN_LIMITS.archiveBytes)
  return bytes
}
/** Allows only explicit appData-relative build inputs, never cwd/workspace/env selections. */
export function localReleaseRoot(appData: string): string {
  return join(appData, '@brobot2', 'plugin-release-input', 'v1')
}
