import { readPluginSource } from '../package-source'
import { z } from 'zod'
import { join } from 'node:path'
import { strictPluginJson } from '../strict-json'
import { PluginTarget, PluginAuthors, parsePluginCatalogue } from '../package-schema'
import { PLUGIN_LIMITS, pluginSha256 } from '../package-digests'
import {
  immutableFile,
  privateChild,
  publishPrivateDirectory,
  verifyImmutableFile,
} from '../node-host-files'
import { PluginSupervisorError } from '../supervisor/protocol'
import { readLocalRelease } from './local'
import {
  downloadPluginBytes,
  PLUGIN_LIST_URL,
  PLUGIN_LIST_V2_URL,
  PluginDownloadError,
} from './download'
import { PluginListError } from './list-error'

const text = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .regex(/^[^\p{Cc}\p{Cs}\u2028\u2029]+$/u)
const sha = z.string().regex(/^[a-f0-9]{64}$/)
const coreVersion = z.string().regex(/^\d{1,6}\.\d{1,6}\.\d{1,6}$/)
const RepoList = z.strictObject({
  format: z.literal(1),
  entries: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        name: text(128),
        description: text(240),
        version: text(80),
        minAppVersion: coreVersion,
        sourceCommit: z.string().optional(),
        targets: z
          .array(
            PluginTarget.extend({
              url: z.string().max(2048),
              sha256: sha,
              bytes: z.number().int().min(1).max(PLUGIN_LIMITS.archiveBytes),
              compression: z.enum(['tar', 'tar.gz']),
              manifestSha256: sha,
            }),
          )
          .min(1)
          .max(6),
      }),
    )
    .max(PLUGIN_LIMITS.catalogueEntries),
})
const RepoListV2 = RepoList.extend({
  format: z.literal(2),
  entries: z
    .array(
      RepoList.shape.entries.element
        .extend({ authors: PluginAuthors.optional(), legacy: z.literal(true).optional() })
        .refine((entry) =>
          entry.legacy ? entry.authors === undefined : entry.authors !== undefined,
        ),
    )
    .max(PLUGIN_LIMITS.catalogueEntries),
})
const GenericRepoList = z.object({
  format: z.literal(3),
  entries: z.array(
    z.looseObject({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string(),
      version: z.string().min(1),
      minAppVersion: z
        .string()
        .regex(/^\d+\.\d+\.\d+$/)
        .default('0.0.0'),
      sourceCommit: z.string().optional(),
      authors: z.array(z.string()).optional(),
      targets: z
        .array(
          PluginTarget.extend({
            url: z.string(),
            sha256: sha,
            bytes: z.number().int().nonnegative().safe(),
            compression: z.enum(['tar', 'tar.gz']),
            manifestSha256: sha,
          }),
        )
        .min(1),
    }),
  ),
})
const fail = (): never => {
  throw new PluginSupervisorError('unavailable')
}
function compatible(actual: string, minimum: string): boolean {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-[0-9A-Za-z.-]+)?$/.exec(actual)
  if (!match) return fail()
  const current = match.slice(1).map(Number),
    required = minimum.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (current[i] !== required[i]) return current[i]! > required[i]!
  return true
}
export function parseRepoPluginList(
  inputBytes: Uint8Array,
  target: PluginTarget,
  appVersion: string,
) {
  let input: unknown
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inputBytes))
  } catch {
    return fail()
  }
  const list =
    (input as { format?: number })?.format === 3
      ? GenericRepoList.parse(input)
      : z
          .union([RepoList, RepoListV2])
          .parse(strictPluginJson(inputBytes, PLUGIN_LIMITS.catalogueBytes))
  if (new Set(list.entries.map((entry) => entry.id)).size !== list.entries.length) return fail()
  for (const entry of list.entries) {
    if (new Set(entry.targets.map((one) => one.os + '/' + one.cpu)).size !== entry.targets.length)
      return fail()
  }
  const view = (version: string) => {
    const releases = list.entries.flatMap((entry) => {
      const selected = entry.targets.find((one) => one.os === target.os && one.cpu === target.cpu)
      if (!selected || !compatible(version, entry.minAppVersion)) return []
      return [
        {
          ...('authors' in entry && entry.authors ? { authors: entry.authors } : {}),
          ...('legacy' in entry && entry.legacy ? { legacy: true as const } : {}),
          id: entry.id,
          version: entry.version,
          sourceCommit: entry.sourceCommit,
          description: entry.description,
          platforms: [{ os: selected.os, cpu: selected.cpu }],
          archive: {
            url: selected.url,
            size: selected.bytes,
            sha256: selected.sha256,
            compression: selected.compression,
          },
          manifestSha256: selected.manifestSha256,
        },
      ]
    })
    const bytes = Buffer.from(JSON.stringify({ format: list.format, entries: releases }))
    return { releases: parsePluginCatalogue(bytes), bytes, sha256: pluginSha256(bytes) }
  }
  // Every older app view changes only at a declared minimum-version threshold.
  const versions = new Set([
    '0.0.0',
    ...list.entries
      .map((entry) => entry.minAppVersion)
      .filter((minimum) => compatible(appVersion, minimum)),
  ])
  const views = new Map(
    [...versions].map((version) => {
      const parsed = view(version)
      return [parsed.sha256, parsed] as const
    }),
  )
  return {
    format: list.format,
    entries: list.entries,
    ...view(appVersion),
    legacyCatalogues: list.format === 1 ? [...views.values()] : [],
  }
}
/** Each app window can select its own list; default discovery is a convenience. */
export async function loadRepoPluginList(options: {
  root: string
  target: PluginTarget
  appVersion: string
  signal?: AbortSignal
  fixtureSource?: string
  devSource?: string
  sourceVersion?: 1 | 2
  source?: string
  offlineEmpty?: boolean
}) {
  if (options.devSource && options.fixtureSource) return fail()
  let discoveryError: PluginListError | undefined
  const name = options.sourceVersion === 2 ? 'catalogue-v2.json' : 'catalogue.json'
  let input = options.source
    ? await readPluginSource(options.source, { signal: options.signal })
    : options.devSource
      ? await readLocalRelease(options.devSource, [name], PLUGIN_LIMITS.catalogueBytes, true)
      : options.fixtureSource
        ? await readLocalRelease(options.fixtureSource, [name], PLUGIN_LIMITS.catalogueBytes)
        : await downloadPluginBytes({
            url: options.sourceVersion === 2 ? PLUGIN_LIST_V2_URL : PLUGIN_LIST_URL,
            maximum: Number.MAX_SAFE_INTEGER,
            milliseconds: 5000,
            signal: options.signal,
          }).catch((error: unknown) => {
            if (options.offlineEmpty) {
              discoveryError = new PluginListError(
                error instanceof PluginDownloadError && error.status === 404
                  ? 'not-published'
                  : 'fetch-error',
              )
              return Buffer.from(
                JSON.stringify({ format: options.sourceVersion ?? 1, entries: [] }),
              )
            }
            throw new PluginListError(
              error instanceof PluginDownloadError && error.status === 404
                ? 'not-published'
                : 'fetch-error',
            )
          })
  let parsed: ReturnType<typeof parseRepoPluginList>
  try {
    parsed = parseRepoPluginList(input, options.target, options.appVersion)
  } catch (error) {
    if (!options.offlineEmpty) throw error
    discoveryError = new PluginListError('fetch-error')
    input = Buffer.from(JSON.stringify({ format: options.sourceVersion ?? 1, entries: [] }))
    parsed = parseRepoPluginList(input, options.target, options.appVersion)
  }
  const parent = await privateChild(options.root, 'repo-catalogues')
  const kept = await publishPrivateDirectory(
    parent,
    parsed.sha256,
    async (stage) => immutableFile(join(stage, 'catalogue.json'), parsed.bytes),
    async (directory) => verifyImmutableFile(join(directory, 'catalogue.json'), parsed.bytes),
  )
  const rawSha256 = pluginSha256(input)
  const rawLists = await privateChild(options.root, 'repo-lists')
  const raw = await publishPrivateDirectory(
    rawLists,
    rawSha256,
    async (stage) => immutableFile(join(stage, 'catalogue.json'), input),
    async (directory) => verifyImmutableFile(join(directory, 'catalogue.json'), input),
  )
  return {
    ...parsed,
    discoveryError,
    catalogue: join(kept, 'catalogue.json'),
    repoList: { path: join(raw, 'catalogue.json'), sha256: rawSha256 },
    rawBytes: Buffer.from(input),
  }
}
