import { PLUGIN_FRAMEWORK_FEATURES } from '../hooks/definitions'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

export const OWNER_LIMITS = {
  packet: 16 * 1024,
  leases: 64,
  heartbeat: 15_000,
  expires: 60_000,
  request: 2_000,
  drain: 5_000,
  cleanup: 60_000,
} as const
/** Cold runtime verification, copying and child readiness share this bounded launch wait. */
export const OWNER_LAUNCH_MS = process.platform === 'win32' ? 60_000 : 30_000
export const secret = () => randomBytes(32).toString('hex')
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
/** Both sides know a renew may carry `renewal`, and a renewal whose reply was lost may come again. */
export const RENEW_RETRY = 'renew-retry'
/** The owner takes a closed person channel as the end of its consumer, so the app may reconnect. */
export const LOST_CHANNEL_ENDS = 'lost-channel-ends'
/** Person configuration can explicitly negotiate checkpoint ledgers and safe-integer revisions. */
export const CONFIGURATION_LEDGER_V2 = 'configuration-ledger-v2'
export const OWNER_RECOVERY = 'owner-recovery'
/** Per-lease negotiation for served, pending, off and unknown route facts. */
export const AGENT_ROUTES_FORMAT_2 = 'agent-routes-format-2'
export const APP_HELD_CONNECTION = 'app-held-connection'
export const OWNER_WIRE: WireVersion = {
  major: 2,
  minMinor: 0,
  maxMinor: 0,
  features: [
    RENEW_RETRY,
    LOST_CHANNEL_ENDS,
    CONFIGURATION_LEDGER_V2,
    OWNER_RECOVERY,
    AGENT_ROUTES_FORMAT_2,
    APP_HELD_CONNECTION,
    ...PLUGIN_FRAMEWORK_FEATURES,
  ],
}
/** Ignore retired fields when reading an older owner record. */
export const OwnerRecord = z.object({
  version: z.literal(1),
  epoch: Uuid,
  phase: z.enum(['accepting', 'draining', 'blocked', 'stopped']),
  wire: Wire,
})
export type OwnerRecord = z.infer<typeof OwnerRecord>
export const StopReason = z.enum(['lease-expired', 'released', 'shutdown', 'drain'])
export type StopReason = z.infer<typeof StopReason>
/** Kept beside the owner record, never in it; a reader ignores fields it does not know. */
export const StopRecord = z.object({ epoch: Uuid, reason: StopReason })
export type StopRecord = z.infer<typeof StopRecord>
const Identity = { workspace: Hex, generation: Uuid }
export const Command = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('probe') }),
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
    renewal: Hex.optional(),
  }),
  z.strictObject({ kind: z.literal('release'), ...Identity, lease: Hex }),
  z.strictObject({ kind: z.literal('hold'), ...Identity, lease: Hex }),
  z.strictObject({
    kind: z.literal('agent-routes'),
    ...Identity,
    lease: Hex,
    workspaceId: Uuid,
    incarnation: Uuid,
    occupied: z.array(z.string().min(1).max(128)).max(128),
    release: z.boolean(),
    format: z.literal(2).optional(),
  }),
])
export type Command = z.infer<typeof Command>
export const Request = z.strictObject({ epoch: Uuid, nonce: Hex, challenge: Hex, command: Command })
export type Request = z.infer<typeof Request>
export type Refusal =
  | 'unavailable'
  | 'busy'
  | 'incompatible'
  | 'cleanup-pending'
  | 'unsupported'
  | 'policy-refused'
  | 'source-mismatch'
  | 'network'
  | 'download-stalled'
  | 'package-invalid'
export const OwnerDiagnostic = z.strictObject({
  phase: z.enum(['accepting', 'draining', 'blocked', 'stopped', 'missing', 'unreadable']),
  stage: z.enum(['attach-record', 'hello', 'hold', 'detach', 'lease-lost', 'recovery']),
  probe: z.enum(['live', 'no-answer', 'unknown']),
  reason: z.enum([
    'duplicate-workspace',
    'capacity',
    'drain-timeout',
    'proof-pending',
    'restart-required',
    'released-owner-stalled',
    'io',
    'unknown',
  ]),
})
export type OwnerDiagnostic = z.infer<typeof OwnerDiagnostic>
export function ownerDiagnosticLine(diagnostic: OwnerDiagnostic): string {
  const checked = OwnerDiagnostic.parse(diagnostic)
  return `phase=${checked.phase} stage=${checked.stage} probe=${checked.probe} reason=${checked.reason}`
}
export class PluginSupervisorError extends Error {
  readonly diagnostic?: OwnerDiagnostic
  /** Local owner continuity; never serialized or logged. */
  readonly ownerIdentity?: string
  readonly ownerEpoch?: string
  constructor(
    readonly code: Refusal,
    options?: ErrorOptions & {
      diagnostic?: OwnerDiagnostic
      ownerIdentity?: string
      ownerEpoch?: string
    },
  ) {
    super(
      code === 'busy'
        ? 'Plugin busy. Try again.'
        : code === 'incompatible'
          ? 'Update this copy of BroCrew to use this plugin.'
          : code === 'download-stalled'
            ? 'The plugin download stalled. Try again.'
            : code === 'network'
              ? "Couldn't download this plugin. Check your connection and try again."
              : code === 'package-invalid'
                ? "Couldn't verify this plugin package. Download it again or contact its publisher."
                : 'Plugin unavailable. Try again.',
      options,
    )
    this.name = 'PluginSupervisorError'
    if (options?.diagnostic) this.diagnostic = OwnerDiagnostic.parse(options.diagnostic)
    if (options?.ownerIdentity) this.ownerIdentity = Hex.parse(options.ownerIdentity)
    if (options?.ownerEpoch) this.ownerEpoch = Uuid.parse(options.ownerEpoch)
  }
}
export function refuse(code: Refusal = 'unavailable', diagnostic?: OwnerDiagnostic): never {
  throw new PluginSupervisorError(code, { diagnostic })
}
export function pack(value: unknown): string {
  const packet = JSON.stringify(value) + '\n'
  if (Buffer.byteLength(packet) > OWNER_LIMITS.packet) refuse()
  return packet
}
export function unpack(bytes: string): unknown {
  const packet = JSON.parse(bytes)
  // Older peers wrap the JSON in a signed envelope; only its data is still needed.
  return packet && typeof packet.data === 'string' && 'mac' in packet
    ? JSON.parse(packet.data)
    : packet
}
export function compatible(
  left: WireVersion,
  right: WireVersion,
): { minor: number; features: string[] } | null {
  if (
    left.major !== right.major ||
    Math.max(left.minMinor, right.minMinor) > Math.min(left.maxMinor, right.maxMinor)
  )
    return null
  return {
    minor: Math.min(left.maxMinor, right.maxMinor),
    features: left.features.filter((feature) => right.features.includes(feature)),
  }
}
