import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { SharedDataOwner } from '../shared-data'

const path = z.string().min(1).max(4096).refine(isAbsolute)
const hex = z.string().regex(/^[a-f0-9]{64}$/)
/** Supplied by the trusted app/controller. */
export const LifecyclePlan = z
  .strictObject({
    source: z.literal('repo-list'),
    appVersion: z.string().min(1).max(80).optional(),
    catalogue: path,
    catalogueSha256: hex,
    /** App-verified raw source; never supplied over the person or agent channel. */
    repoList: z.strictObject({ path, sha256: hex }).optional(),
    legacyRepoList: z.strictObject({ path, sha256: hex }).optional(),
    sourceVersion: z.union([z.literal(1), z.literal(2)]).optional(),
    personKey: hex,
    names: z.record(z.string(), z.string().min(1).max(128)),
    /** Explicit scratch proof only; the production app never supplies this. */
    fixtureSource: path.optional(),
    /** Guarded unpackaged app input; never supplied by a workspace or IPC caller. */
    devSource: path.optional(),
  })
  .refine(
    (value) =>
      value.sourceVersion !== 2 ||
      Boolean(value.appVersion && value.repoList && value.legacyRepoList),
  )
export type PluginLifecyclePlan = z.infer<typeof LifecyclePlan>
export const LaunchConfig = z
  .strictObject({
    format: z.literal(1),
    root: path,
    workspaceRoots: z.array(path).max(64),
    runtime: z.strictObject({ directory: path, id: hex }),
    browserExecutable: path.optional(),
    lifecycle: LifecyclePlan.optional(),
    sharedDataOwner: SharedDataOwner.optional(),
  })
  .refine(
    (value) =>
      !value.sharedDataOwner ||
      ((!value.sharedDataOwner.workspaceRoot ||
        (value.workspaceRoots.length === 1 &&
          value.workspaceRoots[0] === value.sharedDataOwner.workspaceRoot)) &&
        value.lifecycle &&
        !value.lifecycle.fixtureSource &&
        !value.lifecycle.devSource),
  )
export type PluginLaunchConfig = z.infer<typeof LaunchConfig>
