import { z } from 'zod'

export const PluginHostUiRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot') }),
  z.object({ kind: z.literal('enabled'), pluginId: z.string(), enabled: z.boolean() }),
  z.object({ kind: z.literal('activate'), handle: z.string() }),
  z.object({ kind: z.literal('notification-action'), handle: z.string(), actionId: z.string() }),
  z.object({ kind: z.literal('notification-dismiss'), handle: z.string() }),
  z.object({ kind: z.literal('titles-enabled'), pluginId: z.string(), enabled: z.boolean() }),
  z.object({ kind: z.literal('settings-open'), handle: z.string() }),
  z.object({ kind: z.literal('settings-close'), viewId: z.string() }),
])
export const PluginTitlesInput = z.object({
  turnId: z.string(),
  pieceId: z.string(),
  candidates: z
    .array(
      z.object({
        resourceId: z.string(),
        version: z.string(),
        title: z.string(),
        pieceId: z.string(),
      }),
    )
    .max(100),
})
export const PluginPageCall = z.object({
  pluginId: z.string(),
  instanceId: z.string(),
  contributionHandle: z.string(),
  viewId: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.json()),
  requestId: z.string(),
})
export const PluginPageCancel = z.object({
  pluginId: z.string(),
  instanceId: z.string(),
  requestId: z.string(),
})
