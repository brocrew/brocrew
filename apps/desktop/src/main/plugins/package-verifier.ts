import type { KeyObject } from 'node:crypto'
import { SkillRelease } from '../../shared/skills-catalogue'
import {
  PLUGIN_LIMITS,
  pluginCatalogueSignatures,
  verifyPluginDigest,
  pluginSha256,
} from './package-digests'
import { readPluginArchive } from './package-archive'
import {
  parsePluginCatalogue,
  parsePluginManifest,
  PluginTarget,
  type PluginApiRange,
  type AnyPluginManifest,
  normalizePluginManifest,
  type NormalizedPluginManifest,
  type PluginRelease,
} from './package-schema'
import { PLUGIN_FRAMEWORK_FEATURES } from './hooks/definitions'
import { strictPluginJson } from './strict-json'
import { refusePlugin } from './verification-error'

export interface PluginReleasePin {
  readonly id: string
  readonly version: string
  readonly archiveSha256: string
  readonly manifestSha256: string
}
export interface PluginApiSupport {
  readonly major: number
  readonly minor: number
  readonly features: readonly string[]
}
export interface PluginVerifierOptions {
  readonly pinnedPublicKey: KeyObject
  readonly target: PluginTarget
  readonly appVersion?: string
  /** Persist these pins in the later installer; this pure verifier never writes them. */
  readonly knownReleases?: readonly PluginReleasePin[]
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
export interface VerifiedPluginPackage<M extends AnyPluginManifest = AnyPluginManifest> {
  readonly manifest: Readonly<M>
  readonly contract: Readonly<NormalizedPluginManifest>
  readonly compatibility: Readonly<{ host: boolean; tools: boolean; ui: boolean }>
  readonly filePaths: readonly string[]
  /** Copies keep callers from changing the bytes retained behind a verified result. */
  readFile(path: string): Uint8Array | undefined
}
export interface VerifiedPluginCatalogue {
  readonly format: 1 | 2
  readonly entries: readonly Readonly<PluginRelease>[]
  readonly pins: readonly PluginReleasePin[]
  verifyPackage(id: string, version: string, downloaded: Uint8Array): VerifiedPluginPackage
}

export interface PluginPackageIntegrity {
  sha256: string
  bytes: number
  compression?: 'tar' | 'tar.gz'
}
export interface DirectPluginVerifierOptions {
  target: PluginTarget
  appVersion: string
  apiSupport?: PluginVerifierOptions['apiSupport']
}

/** A selected package's digest checks intact bytes, not its author's trust or identity. */
export function verifyPluginPackage(
  input: Uint8Array,
  expected: PluginPackageIntegrity,
  options: DirectPluginVerifierOptions,
): VerifiedPluginPackage {
  const target = PluginTarget.safeParse(options.target)
  if (!target.success) refusePlugin('target')
  const archive = Buffer.from(input)
  verifyPluginDigest(
    archive,
    { size: expected.bytes, sha256: expected.sha256 },
    PLUGIN_LIMITS.archiveBytes,
  )
  const files = readPluginArchive(archive, expected.compression ?? 'tar')
  const manifestBytes = files.get('plugin.json')
  if (!manifestBytes) refusePlugin('invalid')
  const manifest = parsePluginManifest(manifestBytes)

  return verifiedContents(
    files,
    manifest,
    target.data,
    options.apiSupport ?? defaultSupport(),
    expected.sha256,
    options.appVersion,
  )
}

function checkAppVersion(manifest: AnyPluginManifest, appVersion: string | undefined): void {
  if (manifest.format === 3 && manifest.minAppVersion) {
    const actual = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(appVersion ?? '')
    if (!actual) refusePlugin('target')
    const current = actual.slice(1).map(Number)
    const minimum = manifest.minAppVersion.split('.').map(Number)
    let meets = true
    for (let i = 0; i < 3; i++) {
      if (current[i] === minimum[i]) continue
      meets = current[i]! > minimum[i]!
      break
    }
    if (!meets) refusePlugin('target')
  }
}

function defaultSupport() {
  const api = { major: 1, minor: 0, features: [] as string[] }
  return { host: { ...api, features: [...PLUGIN_FRAMEWORK_FEATURES] }, tools: api, ui: api }
}

function verifiedContents(
  files: ReadonlyMap<string, Buffer>,
  manifest: AnyPluginManifest,
  target: PluginTarget,
  support: NonNullable<PluginVerifierOptions['apiSupport']>,
  digest: string,
  appVersion?: string,
): VerifiedPluginPackage {
  if (!manifest.platforms.some((value) => value.os === target.os && value.cpu === target.cpu))
    refusePlugin('target')
  checkAppVersion(manifest, appVersion)
  if (files.size !== manifest.files.length + 1) refusePlugin('digest')
  for (const entry of manifest.files) {
    const body = files.get(entry.path)
    if (!body) refusePlugin('digest')
    const size = 'bytes' in entry ? entry.bytes : entry.size
    verifyPluginDigest(body, { size, sha256: entry.sha256 }, PLUGIN_LIMITS.expandedBytes)
  }
  if (manifest.format !== 3)
    for (const skill of manifest.skills) {
      const body = files.get(skill.path)
      if (!body) refusePlugin('invalid')
      const parsed = SkillRelease.safeParse({
        ...skill,
        body: decoded(body),
        bytes: body.length,
        sha256: manifest.files.find((value) => value.path === skill.path)?.sha256,
      })
      if (
        !parsed.success ||
        [parsed.data.body, parsed.data.description, parsed.data.reminder].some((text) =>
          text.includes('\0'),
        )
      )
        refusePlugin('invalid')
      const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/
        .exec(parsed.data.body)?.[1]
        ?.split(/\r?\n/)
        .filter((line) => line !== '')
      if (
        front?.length !== 2 ||
        !front.includes(`name: ${skill.name}`) ||
        !front.includes(`description: ${skill.description}`)
      )
        refusePlugin('invalid')
    }
  const host = manifest.format === 3 || compatible(manifest.hostApi, support.host)
  const result: VerifiedPluginPackage = Object.freeze({
    manifest: freeze(manifest),
    contract: freeze(normalizePluginManifest(manifest)),
    compatibility: Object.freeze({
      host,
      tools: host && (manifest.format === 3 || compatible(manifest.toolApi, support.tools)),
      ui: host && (manifest.format === 3 || compatible(manifest.uiApi, support.ui)),
    }),
    filePaths: Object.freeze([...files.keys()]),
    readFile(path: string) {
      const body = files.get(path)
      return body === undefined ? undefined : Uint8Array.from(body)
    },
  })
  packages.set(result, digest)
  return result
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
function decoded(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return refusePlugin('invalid')
  }
}
/** All authority comes from one app-supplied public key and its exact signed descriptors. */
export function createPluginVerifier(options: PluginVerifierOptions) {
  const signatures = pluginCatalogueSignatures(options.pinnedPublicKey)
  return catalogueVerifier(options, (bytes, signature) => {
    if (signature.byteLength !== 64) refusePlugin('signature')
    signatures(bytes, Buffer.from(signature))
  })
}
/** Trusted app-admitted repository list only. Its expected digest comes from the fixed HTTPS source, never
 * from workspace, agent or person-control packets. The legacy signed verifier stays strict.
 */
export function createRepoAwarePluginVerifier(
  options: Omit<PluginVerifierOptions, 'pinnedPublicKey'> & {
    pinnedPublicKey: KeyObject | null
    repoCatalogueSha256?: string
  },
) {
  if (options.pinnedPublicKey && options.repoCatalogueSha256 === undefined)
    return createPluginVerifier({ ...options, pinnedPublicKey: options.pinnedPublicKey })
  if (options.pinnedPublicKey !== null || !/^[a-f0-9]{64}$/.test(options.repoCatalogueSha256 ?? ''))
    return refusePlugin('invalid')
  const expected = options.repoCatalogueSha256
  return catalogueVerifier(options, (bytes, signature) => {
    if (signature.byteLength !== 0 || pluginSha256(bytes) !== expected) refusePlugin('digest')
  })
}
function catalogueVerifier(
  options: Omit<PluginVerifierOptions, 'pinnedPublicKey'>,
  authenticate: (bytes: Buffer, signature: Uint8Array) => void,
) {
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
  const pins = new Map<string, PluginReleasePin>()
  const remember = (pin: PluginReleasePin, into: Map<string, PluginReleasePin>) => {
    if (
      !/^[a-z][a-z0-9-]{0,63}$/.test(pin.id) ||
      !/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/.test(pin.version) ||
      !/^[a-f0-9]{64}$/.test(pin.archiveSha256) ||
      !/^[a-f0-9]{64}$/.test(pin.manifestSha256)
    )
      refusePlugin('invalid')
    const key = `${pin.id}/${pin.version}`
    const before = into.get(key)
    if (
      before &&
      (before.archiveSha256 !== pin.archiveSha256 || before.manifestSha256 !== pin.manifestSha256)
    )
      refusePlugin('immutable-release')
    into.set(key, freeze({ ...pin }))
  }
  for (const pin of options.knownReleases ?? []) remember(pin, pins)

  return Object.freeze({
    verifyCatalogue(input: Uint8Array, signature: Uint8Array): VerifiedPluginCatalogue {
      if (input.byteLength > PLUGIN_LIMITS.catalogueBytes) refusePlugin('limit')
      const bytes = Buffer.from(input)
      authenticate(bytes, signature)
      const entries = freeze(parsePluginCatalogue(bytes))
      const format = (strictPluginJson(bytes, PLUGIN_LIMITS.catalogueBytes) as { format: 1 | 2 })
        .format
      const nextPins = new Map(pins)
      for (const entry of entries)
        remember(
          {
            id: entry.id,
            version: entry.version,
            archiveSha256: entry.archive.sha256,
            manifestSha256: entry.manifestSha256,
          },
          nextPins,
        )
      for (const [key, pin] of nextPins) pins.set(key, pin)
      return Object.freeze({
        format,
        entries,
        pins: Object.freeze([...pins.values()]),
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
              : manifest.format === 1 && release.authors !== undefined) ||
            manifest.version !== release.version ||
            (manifest.format !== 3 && manifest.sourceCommit !== release.sourceCommit) ||
            JSON.stringify(manifest.platforms) !== JSON.stringify(release.platforms)
          )
            refusePlugin('invalid')
          const result = verifiedContents(
            files,
            manifest,
            target.data,
            support,
            release.archive.sha256,
            options.appVersion,
          )
          packages.set(result, release.archive.sha256)
          return result
        },
      })
    },
  })
}
