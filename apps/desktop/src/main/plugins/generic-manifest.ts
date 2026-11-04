import { z } from 'zod'
import type { PluginManifest, PluginTarget } from './package-schema'
import type { PluginJsonSchema, ToolBinding } from '../../shared/plugin-contract'

const name = z.string().min(1)
const integer = z.number().int().nonnegative().safe()
const jsonSchema = z.union([z.boolean(), z.record(z.string(), z.json())])
export const PluginToolBinding = z.looseObject({
  tool: name,
  arguments: z.record(z.string(), z.json()).optional(),
  inputField: name.optional(),
})
const runtime = z.discriminatedUnion('kind', [
  z.looseObject({ kind: z.literal('node'), entry: name, args: z.array(z.string()).optional() }),
  z.looseObject({
    kind: z.literal('process'),
    command: name,
    args: z.array(z.string()).optional(),
  }),
])
const mcp = z.discriminatedUnion('transport', [
  z.looseObject({ transport: z.literal('stdio') }),
  z.looseObject({ transport: z.literal('streamable-http'), bootstrap: z.literal('ready-message') }),
])
const compatibility = z.looseObject({ minSchema: integer, maxSchema: integer })
const speech = z.looseObject({
  id: name,
  label: name,
  execution: z.enum(['local', 'cloud']),
  languages: z.array(name),
  bindings: z.looseObject({
    start: PluginToolBinding,
    frame: PluginToolBinding,
    finish: PluginToolBinding,
    cancel: PluginToolBinding,
  }),
})
export const GenericPluginManifestSchema = z.looseObject({
  format: z.literal(3),
  id: name,
  version: name,
  name,
  description: z.string(),
  authors: z.array(name).min(1),
  platforms: z
    .array(
      z.looseObject({ os: z.enum(['darwin', 'win32', 'linux']), cpu: z.enum(['arm64', 'x64']) }),
    )
    .min(1),
  minAppVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  sourceCommit: z.string().optional(),
  permissions: z.looseObject({ description: z.string(), dataUses: z.array(z.string()).optional() }),
  files: z.array(
    z.looseObject({ path: name, bytes: integer, sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  ),
  runtime,
  mcp,
  tools: z.looseObject({ source: z.literal('mcp'), inventory: name }),
  settings: z
    .looseObject({
      page: z.looseObject({ entry: name, assets: z.array(name) }),
      fields: jsonSchema.optional(),
    })
    .optional(),
  ui: z
    .array(
      z.looseObject({
        id: name,
        slot: name,
        view: z.looseObject({
          label: name,
          icon: z.string().optional(),
          tooltip: z.string().optional(),
          disabled: z.boolean().optional(),
        }),
        invoke: PluginToolBinding,
      }),
    )
    .optional(),
  hooks: z
    .array(z.looseObject({ id: name, kind: name, api: integer.min(1), invoke: PluginToolBinding }))
    .optional(),
  speech: z.array(speech).optional(),
  cleanup: z
    .array(
      z.looseObject({
        id: name,
        label: name,
        execution: z.enum(['local', 'cloud']),
        invoke: PluginToolBinding,
      }),
    )
    .optional(),
  lifecycle: z.looseObject({
    stop: z.looseObject({ signal: name, graceMs: integer.optional() }),
    beforeRemove: PluginToolBinding.optional(),
    dataOnRemove: z.enum(['keep', 'remove']),
  }),
  data: z.looseObject({
    schema: integer,
    compatibility: compatibility.optional(),
    migrateOnStart: z.literal(true).optional(),
  }),
})
export type GenericPluginManifest = z.infer<typeof GenericPluginManifestSchema>
export type AnyPluginManifest = PluginManifest | GenericPluginManifest

/** In-memory view only. The original installed manifest and data directories are never rewritten. */
export function normalizePluginManifest(manifest: AnyPluginManifest) {
  if (manifest.format === 3) return manifest
  return {
    format: manifest.format,
    id: manifest.id,
    version: manifest.version,
    name: manifest.id,
    description: manifest.permissions.description,
    authors: manifest.authors ?? [],
    platforms: manifest.platforms as PluginTarget[],
    permissions: { description: manifest.permissions.description },
    files: manifest.files.map(({ path, size, sha256 }) => ({ path, bytes: size, sha256 })),
    runtime:
      manifest.format === 2 && manifest.executor?.kind === 'node'
        ? { kind: 'node' as const, entry: manifest.executor.entry }
        : manifest.server
          ? { kind: 'node' as const, entry: manifest.server.entry }
          : null,
    // Formats 1/2 supplied loopback endpoints, not the new ready-message transport.
    mcp: manifest.server
      ? {
          transport: 'legacy-http' as const,
          mcpPath: manifest.server.mcpPath,
          adminPath: manifest.server.adminPath,
        }
      : null,
    tools: manifest.server ? { source: 'mcp' as const } : null,
    settings: manifest.ui
      ? {
          page: { entry: manifest.ui.entry, assets: manifest.ui.assets.map((asset) => asset.path) },
          fields: undefined as PluginJsonSchema | undefined,
        }
      : undefined,
    ui: [],
    hooks: (manifest.hooks ?? []).map((hook) => ({
      ...hook,
      invoke: undefined as ToolBinding | undefined,
    })),
    speech: [],
    cleanup: [],
    lifecycle: { stop: { signal: 'SIGTERM' }, dataOnRemove: 'keep' as const },
    data: { schema: manifest.dataSchema, compatibility: { ...manifest.dataCompatibility } },
  }
}
export type NormalizedPluginManifest = ReturnType<typeof normalizePluginManifest>
