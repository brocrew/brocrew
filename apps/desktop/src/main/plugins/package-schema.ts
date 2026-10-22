import { z } from 'zod'
import { SkillName, SkillDigest, SkillRelease, SKILL_LIMITS } from '../../shared/skills-catalogue'
import { PLUGIN_LIMITS } from './package-digests'
import { pluginPackagePath, PluginPackagePaths } from './package-path'
import { strictPluginJson } from './strict-json'
import { HookDeclaration } from './hooks/definitions'
import { refusePlugin } from './verification-error'

const integer = z.number().int().nonnegative().safe()
const version = SkillRelease.shape.version
const commit = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
const text = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}\p{Cs}]+$/u)
const path = z.string().min(1).max(1024)
export const PluginTarget = z.strictObject({
  os: z.enum(['darwin', 'win32', 'linux']),
  cpu: z.enum(['arm64', 'x64']),
})
export type PluginTarget = z.infer<typeof PluginTarget>
/** The target this process runs on; the verifier refuses any it does not list. */
export const thisMachine = (): PluginTarget => ({
  os: process.platform as PluginTarget['os'],
  cpu: process.arch as PluginTarget['cpu'],
})
const platforms = z.array(PluginTarget).min(1).max(6)
const api = z
  .strictObject({
    major: integer.min(1),
    minMinor: integer,
    maxMinor: integer,
    requiredFeatures: z.array(SkillName).max(64),
  })
  .refine((value) => value.minMinor <= value.maxMinor)
export type PluginApiRange = z.infer<typeof api>
const https = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (
        url.protocol === 'https:' && url.username === '' && url.password === '' && url.hash === ''
      )
    } catch {
      return false
    }
  })
const release = z.strictObject({
  id: SkillName,
  version,
  sourceCommit: commit,
  platforms,
  archive: z.strictObject({
    url: https,
    size: integer.min(1).max(PLUGIN_LIMITS.archiveBytes),
    sha256: SkillDigest,
    compression: z.enum(['tar', 'tar.gz']),
  }),
  manifestSha256: SkillDigest,
  description: text(240)
    .refine((value) => value.trim().length > 0)
    .regex(/^[^\r\n\u2028\u2029]+$/u)
    .optional(),
})
const catalogue = z.strictObject({
  format: z.literal(1),
  entries: z.array(release).max(PLUGIN_LIMITS.catalogueEntries),
})
export const PluginAuthors = z
  .array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/))
  .min(1)
  .max(8)
  .refine(
    (authors) =>
      new Set(authors).size === authors.length &&
      authors.join(',') === [...authors].sort().join(','),
  )
const versionedRelease = release
  .extend({ authors: PluginAuthors.optional(), legacy: z.literal(true).optional() })
  .refine((entry) => !(entry.legacy && entry.authors))
const versionedCatalogue = z.strictObject({
  format: z.literal(2),
  entries: z.array(versionedRelease).max(PLUGIN_LIMITS.catalogueEntries),
})
export type PluginRelease = z.infer<typeof release> & { authors?: string[]; legacy?: true }

const file = z.strictObject({
  path,
  size: integer.max(PLUGIN_LIMITS.expandedBytes),
  sha256: SkillDigest,
  type: z.literal('file'),
})
const endpoint = z
  .string()
  .max(200)
  .regex(/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/)
const skill = SkillRelease.omit({ body: true, bytes: true, sha256: true })
const asset = z.strictObject({
  path,
  mime: z.enum([
    'text/html',
    'text/css',
    'text/javascript',
    'application/json',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'font/woff',
    'font/woff2',
  ]),
})

// A bounded, local JSON Schema subset; references and executable validators are absent.
export interface PluginValueSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, PluginValueSchema>
  required?: string[]
  additionalProperties?: false
  items?: PluginValueSchema
  enum?: (string | number | boolean | null)[]
  maxLength?: number
  maxItems?: number
  minimum?: number
  maximum?: number
}
const valueSchema: z.ZodType<PluginValueSchema> = z.lazy(() =>
  z.strictObject({
    type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']),
    properties: z.record(z.string().max(128), valueSchema).optional(),
    required: z.array(z.string().max(128)).max(64).optional(),
    additionalProperties: z.literal(false).optional(),
    items: valueSchema.optional(),
    enum: z
      .array(z.union([z.string().max(1024), z.number().finite(), z.boolean(), z.null()]))
      .min(1)
      .max(64)
      .optional(),
    maxLength: integer.max(65_536).optional(),
    maxItems: integer.max(1024).optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
  }),
)
const manifest = z.strictObject({
  format: z.literal(1),
  id: SkillName,
  version,
  sourceCommit: commit,
  platforms,
  hostApi: api,
  toolApi: api.nullable(),
  uiApi: api.nullable(),
  dataSchema: integer,
  files: z.array(file).max(PLUGIN_LIMITS.files - 1),
  server: z.strictObject({ entry: path, mcpPath: endpoint, adminPath: endpoint }).nullable(),
  skills: z.array(skill).max(SKILL_LIMITS.skills),
  serviceTemplates: z
    .array(
      z.strictObject({
        id: SkillName,
        rules: path,
        provider: z.enum(['claude', 'codex']),
        model: text(128),
        effort: text(32).nullable(),
        requiredTools: z.array(text(128)).max(64),
      }),
    )
    .max(32),
  ui: z
    .strictObject({
      entry: path,
      assets: z.array(asset).min(1).max(1024),
      methodSchemas: z.strictObject({
        read: valueSchema,
        subscribe: valueSchema,
        unsubscribe: valueSchema,
        proposeConfig: valueSchema,
      }),
      texts: z.array(z.strictObject({ id: SkillName, text: text(2000) })).max(512),
    })
    .nullable(),
  permissions: z.strictObject({
    description: text(2000),
    resources: z
      .array(
        z.strictObject({ id: SkillName, label: text(160), read: z.boolean(), write: z.boolean() }),
      )
      .max(128),
  }),
  dataCompatibility: z.strictObject({ minSchema: integer, maxSchema: integer }),
})
const executor = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('node'), entry: path }),
  z.strictObject({ kind: z.literal('remote') }),
  z.strictObject({ kind: z.literal('none') }),
])
const versionedManifest = manifest.extend({
  format: z.literal(2),
  authors: PluginAuthors.optional(),
  executor,
  hooks: z.array(HookDeclaration).max(32),
})
export type PluginManifest = Omit<z.infer<typeof manifest>, 'format'> & {
  format: 1 | 2
  authors?: string[]
  executor?: z.infer<typeof executor>
  hooks?: HookDeclaration[]
}

function unique(values: readonly string[]): void {
  if (new Set(values).size !== values.length) refusePlugin('invalid')
}
function targets(values: readonly PluginTarget[]): void {
  unique(values.map((value) => `${value.os}/${value.cpu}`))
}
function range(value: PluginApiRange | null): void {
  if (value !== null) unique(value.requiredFeatures)
}
function schemaRules(root: PluginValueSchema): void {
  let nodes = 0
  function visit(value: PluginValueSchema, depth: number): void {
    if (++nodes > 1024 || depth > 16) refusePlugin('limit')
    if (value.minimum !== undefined && value.maximum !== undefined && value.minimum > value.maximum)
      refusePlugin('invalid')
    if (value.type === 'object') {
      const props = Object.entries(value.properties ?? {})
      if (props.length > 64 || value.additionalProperties !== false || value.items !== undefined)
        refusePlugin('invalid')
      unique(value.required ?? [])
      if ((value.required ?? []).some((key) => !Object.hasOwn(value.properties ?? {}, key)))
        refusePlugin('invalid')
      for (const [, child] of props) visit(child, depth + 1)
    } else if (
      value.properties !== undefined ||
      value.required !== undefined ||
      value.additionalProperties !== undefined
    )
      refusePlugin('invalid')
    if (value.type === 'array') {
      if (value.items === undefined || value.maxItems === undefined) refusePlugin('invalid')
      visit(value.items, depth + 1)
    } else if (value.items !== undefined || value.maxItems !== undefined) refusePlugin('invalid')
    if (value.type !== 'string' && value.maxLength !== undefined) refusePlugin('invalid')
    if (value.type === 'string' && value.maxLength === undefined) refusePlugin('invalid')
    if (
      value.type !== 'number' &&
      value.type !== 'integer' &&
      (value.minimum !== undefined || value.maximum !== undefined)
    )
      refusePlugin('invalid')
    if (
      value.enum?.some((item) =>
        item === null
          ? value.type !== 'null'
          : value.type === 'integer'
            ? typeof item !== 'number' || !Number.isSafeInteger(item)
            : typeof item !== value.type,
      )
    )
      refusePlugin('invalid')
  }
  visit(root, 0)
}

export function parsePluginCatalogue(bytes: Uint8Array): PluginRelease[] {
  const parsed = z
    .union([catalogue, versionedCatalogue])
    .safeParse(strictPluginJson(bytes, PLUGIN_LIMITS.catalogueBytes))
  if (!parsed.success) refusePlugin('invalid')
  const entries = parsed.data.entries
  unique(entries.map((value) => `${value.id}/${value.version}`))
  for (const entry of entries) targets(entry.platforms)
  return entries
}

export function parsePluginManifest(bytes: Uint8Array): PluginManifest {
  const parsed = z
    .union([manifest, versionedManifest])
    .safeParse(strictPluginJson(bytes, PLUGIN_LIMITS.manifestBytes))
  if (!parsed.success) refusePlugin('invalid')
  const result = parsed.data
  targets(result.platforms)
  for (const value of [result.hostApi, result.toolApi, result.uiApi]) range(value)
  if (
    (result.server === null) !== (result.toolApi === null) ||
    (result.ui === null) !== (result.uiApi === null)
  )
    refusePlugin('invalid')
  const { minSchema, maxSchema } = result.dataCompatibility
  if (minSchema > result.dataSchema || maxSchema < result.dataSchema) refusePlugin('invalid')
  const paths = new PluginPackagePaths()
  paths.add('plugin.json', 'file')
  let total = bytes.byteLength
  for (const entry of result.files) {
    paths.add(entry.path, 'file')
    total += entry.size
    if (total > PLUGIN_LIMITS.expandedBytes) refusePlugin('limit')
  }
  const inventory = new Set(result.files.map((entry) => entry.path))
  const reference = (value: string) => {
    pluginPackagePath(value)
    if (!inventory.has(value)) refusePlugin('invalid')
  }
  if (result.server !== null) {
    reference(result.server.entry)
    if (
      !/\.(?:cjs|mjs|js)$/.test(result.server.entry) ||
      result.server.mcpPath === result.server.adminPath
    )
      refusePlugin('invalid')
  }
  if (result.format === 2) {
    unique(result.hooks.map((hook) => hook.id))
    if (result.executor.kind === 'node') {
      reference(result.executor.entry)
      if (
        !/\.(?:cjs|mjs|js)$/.test(result.executor.entry) ||
        (result.server && result.server.entry !== result.executor.entry)
      )
        refusePlugin('invalid')
    } else if (result.server !== null) refusePlugin('invalid')
  }
  unique(result.skills.map((value) => value.name))
  for (const entry of result.skills) {
    reference(entry.path)
    if (entry.path !== `${entry.name}/SKILL.md`) refusePlugin('path')
  }
  unique(result.serviceTemplates.map((value) => value.id))
  for (const entry of result.serviceTemplates) {
    reference(entry.rules)
    unique(entry.requiredTools)
  }
  unique(result.permissions.resources.map((value) => value.id))
  if (result.ui !== null) {
    unique(result.ui.assets.map((value) => value.path))
    unique(result.ui.texts.map((value) => value.id))
    for (const entry of result.ui.assets) reference(entry.path)
    if (
      !result.ui.assets.some(
        (value) => value.path === result.ui?.entry && value.mime === 'text/html',
      )
    )
      refusePlugin('invalid')
    for (const value of Object.values(result.ui.methodSchemas)) schemaRules(value)
  }
  return result
}
