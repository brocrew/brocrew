import { downloadPluginBytes, PluginDownloadError } from './download'
import { readLocalRelease } from './local'
import type { PluginRelease } from '../package-schema'
import { createPublicKey } from 'node:crypto'
import { join } from 'node:path'
import { lstat, rename, unlink, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createPluginVerifier } from '../package-verifier'
import type { PluginTarget } from '../package-schema'
import { PLUGIN_LIMITS } from '../package-digests'
import {
  digest,
  immutableFile,
  privateChild,
  publishPrivateDirectory,
  sourceBytes,
  verifyImmutableFile,
} from '../node-host-files'
import { PluginSupervisorError } from '../supervisor/protocol'
import { pinDirectory } from '../private-files'

/** Discriminated source list; a future local source belongs here, never in plugin-controlled IPC. */
export type CatalogueSource =
  | { readonly kind: 'https'; readonly baseUrl: string }
  | { readonly kind: 'local'; readonly directory: string }
export interface LoadedPluginCatalogue {
  readonly source: CatalogueSource
  readonly publicKey: string
  readonly catalogue: string
  readonly signature: string
  readonly bytes: Buffer
  readonly signatureBytes: Buffer
  readonly entries: ReturnType<
    ReturnType<typeof createPluginVerifier>['verifyCatalogue']
  >['entries']
}
const unavailable = (): never => {
  throw new PluginSupervisorError('unavailable')
}
export function cataloguePublicKey(value: string) {
  if (!value || value.length > 1024 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return unavailable()
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) return unavailable()
  const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' })
  if (
    key.asymmetricKeyType !== 'ed25519' ||
    !key.export({ format: 'der', type: 'spki' }).equals(bytes)
  )
    return unavailable()
  return key
}
async function readPrivate(path: string, maximum: number) {
  const bytes = await sourceBytes(path, maximum)
  if (bytes.byteLength > maximum) return unavailable()
  await verifyImmutableFile(path, bytes)
  return bytes
}
/** Exact verified pair publication; current.json only points to complete immutable digest trees.
 * Failed authenticity never falls back silently. Unreachable sources may use a reverified cache.
 */
export async function loadPluginCatalogue(options: {
  root: string
  publicKey: string
  sources: readonly CatalogueSource[]
  target: PluginTarget
  fetch?: typeof fetch
  signal?: AbortSignal
  localEnabled?: boolean
}): Promise<LoadedPluginCatalogue | null> {
  // First check: no-key launches have no filesystem, network or capability side effects.
  if (!options.publicKey) return null
  try {
    const key = cataloguePublicKey(options.publicKey)
    if (options.sources.length > 4) return unavailable()
    const local = options.sources.filter((source) => source.kind === 'local')
    if (local.length && (!options.localEnabled || options.sources.length !== 1))
      return unavailable()
    const folder = await privateChild(options.root, 'catalogue-cache')
    const pins = await privateChild(folder, 'pins')
    const keepPins = async (releases: readonly PluginRelease[]) => {
      const existing = new Set(await readdir(pins))
      const additions = releases.filter(
        (release) => !existing.has(digest(Buffer.from(release.id + '\0' + release.version))),
      ).length
      if (existing.size + additions > 10000) return unavailable()
      for (const release of releases) {
        const bytes = Buffer.from(
          JSON.stringify({
            id: release.id,
            version: release.version,
            archiveSha256: release.archive.sha256,
            manifestSha256: release.manifestSha256,
          }),
        )
        await publishPrivateDirectory(
          pins,
          digest(Buffer.from(release.id + '\0' + release.version)),
          async (stage) => {
            await immutableFile(join(stage, 'pin.json'), bytes)
          },
          async (directory) => {
            await verifyImmutableFile(join(directory, 'pin.json'), bytes)
          },
        )
      }
    }
    if ((await readdir(folder)).length > 512) return unavailable()
    const pointer = join(folder, 'current.json')
    const checked = async (name: string) => {
      if (!/^[a-f0-9]{64}$/.test(name)) return unavailable()
      const directory = await privateChild(folder, name, false)
      const bytes = await readPrivate(
        join(directory, 'catalogue.json'),
        PLUGIN_LIMITS.catalogueBytes,
      )
      const signatureBytes = await readPrivate(join(directory, 'catalogue.sig'), 64)
      if (digest(Buffer.concat([bytes, signatureBytes])) !== name) return unavailable()
      const signed = createPluginVerifier({
        pinnedPublicKey: key,
        target: options.target,
      }).verifyCatalogue(bytes, signatureBytes)
      if (!signed.entries.length) return unavailable()
      return {
        source: options.sources[0] ?? {
          kind: 'https',
          baseUrl: 'https://github.com/brocrew/brocrew/releases/download/',
        },
        publicKey: options.publicKey,
        catalogue: join(directory, 'catalogue.json'),
        signature: join(directory, 'catalogue.sig'),
        bytes,
        signatureBytes,
        entries: signed.entries,
      }
    }
    let cached: LoadedPluginCatalogue | undefined
    try {
      const text = (await readPrivate(pointer, 256)).toString('utf8')
      const value = JSON.parse(text)
      if (!value || Object.keys(value).join(',') !== 'digest') return unavailable()
      cached = await checked(value.digest)
    } catch (error) {
      // Corrupt/linked caches are refused, never quietly reset or replaced.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (
        await lstat(pointer).then(
          () => true,
          (e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') return false
            throw e
          },
        )
      )
        throw error
    }
    for (const source of options.sources) {
      if (options.signal?.aborted) return unavailable()
      let pair: [Buffer, Buffer]
      if (source.kind === 'local') {
        // Local mode is explicit and exclusive: missing/invalid input never uses network/cache fallback.
        pair = [
          await readLocalRelease(
            source.directory,
            ['catalogue.json'],
            PLUGIN_LIMITS.catalogueBytes,
          ),
          await readLocalRelease(source.directory, ['catalogue.sig'], 64),
        ]
      } else {
        const base = new URL(source.baseUrl)
        if (base.search || base.hash || !base.pathname.endsWith('/')) return unavailable()
        const result = await Promise.allSettled([
          downloadPluginBytes({
            url: new URL('catalogue.json', base).href,
            maximum: PLUGIN_LIMITS.catalogueBytes,
            milliseconds: 5000,
            signal: options.signal,
            fetch: options.fetch,
          }),
          downloadPluginBytes({
            url: new URL('catalogue.sig', base).href,
            maximum: 64,
            size: 64,
            milliseconds: 5000,
            signal: options.signal,
            fetch: options.fetch,
          }),
        ])
        if (
          result.some(
            (one) =>
              one.status === 'rejected' &&
              one.reason instanceof PluginDownloadError &&
              one.reason.kind === 'integrity',
          )
        )
          return unavailable()
        if (result.some((one) => one.status !== 'fulfilled')) continue
        pair = result.map((one) => (one.status === 'fulfilled' ? one.value : Buffer.alloc(0))) as [
          Buffer,
          Buffer,
        ]
      }
      const [bytes, signature] = pair
      const knownReleases =
        cached?.entries.map((one) => ({
          id: one.id,
          version: one.version,
          archiveSha256: one.archive.sha256,
          manifestSha256: one.manifestSha256,
        })) ?? []
      const signed = createPluginVerifier({
        pinnedPublicKey: key,
        target: options.target,
        knownReleases,
      }).verifyCatalogue(bytes, signature)
      if (!signed.entries.length) return unavailable()
      await keepPins(signed.entries)
      const name = digest(Buffer.concat(pair))
      const keptNames = await readdir(folder)
      if (!keptNames.includes(name) && keptNames.length >= 512) return unavailable()
      await publishPrivateDirectory(
        folder,
        name,
        async (stage) => {
          await immutableFile(join(stage, 'catalogue.json'), bytes)
          await immutableFile(join(stage, 'catalogue.sig'), signature)
        },
        async (directory) => {
          await verifyImmutableFile(join(directory, 'catalogue.json'), bytes)
          await verifyImmutableFile(join(directory, 'catalogue.sig'), signature)
        },
      )
      const pin = pinDirectory(folder)
      const before = pin.held(),
        temporary = join(folder, '.current-' + randomUUID())
      try {
        await immutableFile(temporary, Buffer.from(JSON.stringify({ digest: name })))
        const now = await lstat(folder, { bigint: true })
        if (now.dev !== before.dev || now.ino !== before.ino || now.isSymbolicLink())
          return unavailable()
        await rename(temporary, pointer)
        pin.sync()
      } finally {
        await unlink(temporary).catch(() => undefined)
        pin.close()
      }
      return { ...(await checked(name)), source }
    }
    if (options.signal?.aborted) return unavailable()
    if (cached) await keepPins(cached.entries)
    return cached ?? unavailable()
  } catch {
    return unavailable()
  }
}
