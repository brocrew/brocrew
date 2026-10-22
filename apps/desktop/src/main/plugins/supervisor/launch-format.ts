import { isAbsolute } from 'node:path'
import { z } from 'zod'

const path = z.string().min(1).max(4096).refine(isAbsolute)
const hex = z.string().regex(/^[a-f0-9]{64}$/)
/** Supplied by the trusted app/controller, never by a plugin or workspace lease packet. */
export const StartupPlan = z.strictObject({
  publicKey: z.string().min(1).max(1024), // One app-pinned Ed25519 SPKI public key, base64 DER.
  catalogue: path,
  signature: path,
  packages: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        version: z.string().min(1).max(80),
        archive: path,
      }),
    )
    .max(64),
})
export type PluginStartupPlan = z.infer<typeof StartupPlan>
/** Legacy signed fixture plan. Downloads is never a production source. */
const SignedLifecyclePlan = z.strictObject({
  publicKey: z.string().min(1).max(1024),
  catalogue: path,
  signature: path,
  personKey: hex,
  /** Reviewed app-owned local release adapter; never accepted over person/agent IPC. */
  localSource: path.optional(),
  downloads: z
    .array(
      z.strictObject({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
        version: z.string().min(1).max(80),
        archive: path,
      }),
    )
    .max(64)
    .optional(),
})
export const LifecyclePlan = z.union([
  SignedLifecyclePlan,
  z.strictObject({
    source: z.literal('repo-list'),
    appVersion: z.string().min(1).max(80).optional(),
    catalogue: path,
    catalogueSha256: hex,
    /** App-verified raw source; never supplied over the person or agent channel. */
    repoList: z.strictObject({ path, sha256: hex }).optional(),
    personKey: hex,
    names: z.record(z.string(), z.string().min(1).max(128)),
    /** Explicit scratch proof only; the production app never supplies this. */
    fixtureSource: path.optional(),
    /** Guarded unpackaged app input; never supplied by a workspace or IPC caller. */
    devSource: path.optional(),
  }),
])
export type PluginLifecyclePlan = z.infer<typeof LifecyclePlan>
export const LaunchConfig = z
  .strictObject({
    format: z.literal(1),
    root: path,
    workspaceRoots: z.array(path).max(64),
    runtime: z.strictObject({ directory: path, id: hex }),
    browserExecutable: path.optional(),
    startup: StartupPlan.optional(),
    lifecycle: LifecyclePlan.optional(),
  })
  .refine((value) => !(value.startup && value.lifecycle))
export type PluginLaunchConfig = z.infer<typeof LaunchConfig>
