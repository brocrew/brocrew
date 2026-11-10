/** Historical command schemas used by renewal compatibility tests. */
import { z } from 'zod'

export const Hex = z.string().regex(/^[a-f0-9]{64}$/)
const Uuid = z.uuid()
export const Wire = z
  .strictObject({
    major: z.number().int().min(1).max(100),
    minMinor: z.number().int().min(0).max(100),
    maxMinor: z.number().int().min(0).max(100),
    features: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)).max(32),
  })
  .refine(
    (value) =>
      value.maxMinor >= value.minMinor && new Set(value.features).size === value.features.length,
  )
export type WireVersion = z.infer<typeof Wire>
export const OWNER_WIRE: WireVersion = { major: 1, minMinor: 0, maxMinor: 0, features: [] }
const Identity = { workspace: Hex, generation: Uuid }
export const Command = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('hello'),
    ...Identity,
    build: z.string().regex(/^[A-Za-z0-9._+-]{1,128}$/),
    wire: Wire,
  }),
  z.strictObject({
    kind: z.literal('renew'),
    ...Identity,
    lease: Hex,
    counter: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({ kind: z.literal('release'), ...Identity, lease: Hex }),
  z.strictObject({
    kind: z.literal('agent-routes'),
    ...Identity,
    lease: Hex,
    workspaceId: Uuid,
    incarnation: Uuid,
    occupied: z.array(z.string().min(1).max(128)).max(128),
    release: z.boolean(),
  }),
])
export type Command = z.infer<typeof Command>
export const Request = z.strictObject({ epoch: Uuid, nonce: Hex, challenge: Hex, command: Command })
export type Request = z.infer<typeof Request>
