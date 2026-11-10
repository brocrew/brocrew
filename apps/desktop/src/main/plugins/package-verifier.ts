import { PLUGIN_LIMITS, verifyPluginDigest } from './package-digests'
import { readPluginArchive } from './package-archive'
import {
  parsePluginCatalogue,
  parsePluginManifest,
  PluginTarget,
  type PluginApiRange,
  type PluginManifest,
  type PluginRelease,
} from './package-schema'
import { PLUGIN_FRAMEWORK_FEATURES } from './hooks/definitions'
import { strictPluginJson } from './strict-json'
import { refusePlugin } from './verification-error'

export interface PluginApiSupport {
  readonly major: number
  readonly minor: number
  readonly features: readonly string[]
}
export interface PluginVerifierOptions {
  readonly target: PluginTarget
  readonly apiSupport?: {
    readonly host: PluginApiSupport
    readonly tools: PluginApiSupport
    readonly ui: PluginApiSupport
  }
}
const packages = new WeakMap<object, string>()
export function verifiedPluginDigest(value: unknown): string | undefined {
  return value !== null && typeof value === 'object' ? packages.get(value) : undefined
}
export interface VerifiedPluginPackage {
  readonly manifest: Readonly<PluginManifest>
  readonly compatibility: Readonly<{ host: boolean; tools: boolean; ui: boolean }>
  readonly filePaths: readonly string[]
  /** Copies keep callers from changing the bytes retained behind a verified result. */
  readFile(path: string): Uint8Array | undefined
}
export interface VerifiedPluginCatalogue {
  readonly format: 1 | 2
  readonly entries: readonly Readonly<PluginRelease>[]
  verifyPackage(id: string, version: string, downloaded: Uint8Array): VerifiedPluginPackage
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
function compatible(range: PluginApiRange | null, support: PluginApiSupport): boolean {
  return (
    range !== null &&
    range.major === support.major &&
    range.minMinor <= support.minor &&
    range.maxMinor >= support.minor &&
    range.requiredFeatures.every((feature) => support.features.includes(feature))
  )
}
/** Verify catalogue structure and each selected package's bytes. */
export function createRepoAwarePluginVerifier(options: PluginVerifierOptions) {
  const target = PluginTarget.safeParse(options.target)
  if (!target.success) refusePlugin('target')
  const defaultApi = { major: 1, minor: 0, features: [] as string[] }
  const support = structuredClone(
    options.apiSupport ?? {
      host: { ...defaultApi, features: [...PLUGIN_FRAMEWORK_FEATURES] },
      tools: defaultApi,
      ui: defaultApi,
    },
  )
  return Object.freeze({
    verifyCatalogue(input: Uint8Array): VerifiedPluginCatalogue {
      if (input.byteLength > PLUGIN_LIMITS.catalogueBytes) refusePlugin('limit')
      const bytes = Buffer.from(input)
      const entries = freeze(parsePluginCatalogue(bytes))
      const format = (strictPluginJson(bytes, PLUGIN_LIMITS.catalogueBytes) as { format: 1 | 2 })
        .format
      return Object.freeze({
        format,
        entries,
        verifyPackage(id: string, version: string, input: Uint8Array): VerifiedPluginPackage {
          const release = entries.find((value) => value.id === id && value.version === version)
          if (!release) refusePlugin('invalid')
          if (
            !release.platforms.some(
              (value) => value.os === target.data.os && value.cpu === target.data.cpu,
            )
          )
            refusePlugin('target')
          if (input.byteLength > PLUGIN_LIMITS.archiveBytes) refusePlugin('limit')
          const archive = Buffer.from(input)
          verifyPluginDigest(archive, release.archive, PLUGIN_LIMITS.archiveBytes)
          const files = readPluginArchive(archive, release.archive.compression)
          const manifestBytes = files.get('plugin.json')
          if (!manifestBytes) refusePlugin('invalid')
          verifyPluginDigest(
            manifestBytes,
            { size: manifestBytes.length, sha256: release.manifestSha256 },
            PLUGIN_LIMITS.manifestBytes,
          )
          const manifest = parsePluginManifest(manifestBytes)
          if (
            manifest.id !== release.id ||
            (manifest.format === 2
              ? !release.authors ||
                JSON.stringify(manifest.authors) !== JSON.stringify(release.authors)
              : release.authors !== undefined) ||
            manifest.version !== release.version ||
            manifest.sourceCommit !== release.sourceCommit ||
            JSON.stringify(manifest.platforms) !== JSON.stringify(release.platforms)
          )
            refusePlugin('invalid')
          if (files.size !== manifest.files.length + 1) refusePlugin('digest')
          for (const entry of manifest.files) {
            const body = files.get(entry.path)
            if (!body) refusePlugin('digest')
            verifyPluginDigest(body, entry, PLUGIN_LIMITS.expandedBytes)
          }
          const host = compatible(manifest.hostApi, support.host)
          const result = Object.freeze({
            manifest: freeze(manifest),
            compatibility: Object.freeze({
              host,
              tools: host && compatible(manifest.toolApi, support.tools),
              ui: host && compatible(manifest.uiApi, support.ui),
            }),
            filePaths: Object.freeze([...files.keys()]),
            readFile(path: string) {
              const body = files.get(path)
              return body === undefined ? undefined : Uint8Array.from(body)
            },
          })
          packages.set(result, release.archive.sha256)
          return result
        },
      })
    },
  })
}
