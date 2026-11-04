import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { PackageRefSchema, type PackageRef } from '../../shared/plugin-package'
import type { PluginRelease } from './package-schema'
import { pluginSha256 } from './package-digests'
import { downloadPluginBytes } from './catalogue/download'
import { verifyPluginPackage, type DirectPluginVerifierOptions } from './package-verifier'

export function releasePackageRef(release: Readonly<PluginRelease>): PackageRef {
  return {
    source: release.archive.url,
    sha256: release.archive.sha256,
    bytes: release.archive.size,
  }
}
export async function readPluginSource(
  source: string,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
) {
  options.signal?.throwIfAborted()
  if (/^https?:/i.test(source))
    return downloadPluginBytes({
      url: source,
      maximum: Number.MAX_SAFE_INTEGER,
      signal: options.signal,
      fetch: options.fetch,
    })
  if (/^file:/i.test(source)) return readFile(fileURLToPath(source), { signal: options.signal })
  // Other URL schemes are left to fetch's normal unsupported-scheme error.
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) && !/^[a-z]:[\\/]/i.test(source))
    return downloadPluginBytes({
      url: source,
      maximum: Number.MAX_SAFE_INTEGER,
      signal: options.signal,
      fetch: options.fetch,
    })
  return readFile(source, { signal: options.signal })
}
export async function readPackageRef(
  input: PackageRef,
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
) {
  const ref = PackageRefSchema.parse(input)
  return { ref, archive: await readPluginSource(ref.source, options) }
}
type Options = DirectPluginVerifierOptions & { signal?: AbortSignal; fetch?: typeof fetch }
function inspectBytes(ref: PackageRef, archive: Buffer, options: Options) {
  const compression = archive[0] === 0x1f && archive[1] === 0x8b ? 'tar.gz' : 'tar'
  let pkg
  try {
    pkg = verifyPluginPackage(
      archive,
      { sha256: ref.sha256, bytes: ref.bytes, compression },
      options,
    )
  } catch (error) {
    const code = (error as { code?: string }).code
    throw new Error(
      code === 'target'
        ? 'This plugin does not support this computer or version of BroCrew.'
        : code === 'digest'
          ? 'The package files do not match the selected bytes.'
          : 'Could not read the selected plugin package.',
      { cause: error },
    )
  }
  const manifest = pkg.manifest
  const release: PluginRelease = {
    id: manifest.id,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit ?? '',
    platforms: manifest.platforms,
    authors: manifest.authors,
    description: pkg.contract.description,
    archive: {
      url:
        /^[a-z][a-z0-9+.-]*:/i.test(ref.source) && !/^[a-z]:[\\/]/i.test(ref.source)
          ? ref.source
          : pathToFileURL(ref.source).href,
      size: ref.bytes,
      sha256: ref.sha256,
      compression,
    },
    manifestSha256: pluginSha256(pkg.readFile('plugin.json')!),
  }
  return { ref, archive, package: pkg, release }
}
export async function inspectPluginPackage(input: PackageRef, options: Options) {
  const { ref, archive } = await readPackageRef(input, options)
  return inspectBytes(ref, archive, options)
}
/** Source selection computes its reference once; later actions use those exact displayed bytes. */
export async function selectPluginPackage(source: string, options: Options) {
  const archive = await readPluginSource(source, options)
  return inspectBytes(
    { source, sha256: pluginSha256(archive), bytes: archive.length },
    archive,
    options,
  )
}
