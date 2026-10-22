import { z } from 'zod'
import { join } from 'node:path'
import { strictPluginJson } from '../strict-json'
import { PluginTarget, parsePluginCatalogue } from '../package-schema'
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
  assertPluginArchiveUrl,
  PLUGIN_LIST_URL,
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
        sourceCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
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
export function parseRepoPluginList(input: Uint8Array, target: PluginTarget, appVersion: string) {
  const list = RepoList.parse(strictPluginJson(input, PLUGIN_LIMITS.catalogueBytes))
  if (new Set(list.entries.map((entry) => entry.id)).size !== list.entries.length) return fail()
  for (const entry of list.entries) {
    if (new Set(entry.targets.map((one) => one.os + '/' + one.cpu)).size !== entry.targets.length)
      return fail()
    for (const one of entry.targets) assertPluginArchiveUrl(one.url)
  }
  const view = (version: string) => {
    const releases = list.entries.flatMap((entry) => {
      const selected = entry.targets.find((one) => one.os === target.os && one.cpu === target.cpu)
      if (!selected || !compatible(version, entry.minAppVersion)) return []
      return [
        {
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
    const bytes = Buffer.from(JSON.stringify({ format: 1, entries: releases }))
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
  return { entries: list.entries, ...view(appVersion), legacyCatalogues: [...views.values()] }
}
/** The endpoint is app-owned and fixed. Local inputs come only from trusted app launch code. */
export async function loadRepoPluginList(options: {
  root: string
  target: PluginTarget
  appVersion: string
  signal?: AbortSignal
  fixtureSource?: string
  devSource?: string
}) {
  if (options.devSource && options.fixtureSource) return fail()
  const input = options.devSource
    ? await readLocalRelease(
        options.devSource,
        ['catalogue.json'],
        PLUGIN_LIMITS.catalogueBytes,
        true,
      )
    : options.fixtureSource
      ? await readLocalRelease(
          options.fixtureSource,
          ['catalogue.json'],
          PLUGIN_LIMITS.catalogueBytes,
        )
      : await downloadPluginBytes({
          url: PLUGIN_LIST_URL,
          maximum: PLUGIN_LIMITS.catalogueBytes,
          milliseconds: 5000,
          signal: options.signal,
        }).catch((error: unknown) => {
          throw new PluginListError(
            error instanceof PluginDownloadError && error.status === 404
              ? 'not-published'
              : 'fetch-error',
          )
        })
  const parsed = parseRepoPluginList(input, options.target, options.appVersion)
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
    catalogue: join(kept, 'catalogue.json'),
    repoList: { path: join(raw, 'catalogue.json'), sha256: rawSha256 },
    rawBytes: Buffer.from(input),
  }
}
