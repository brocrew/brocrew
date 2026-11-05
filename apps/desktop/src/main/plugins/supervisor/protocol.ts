import { PLUGIN_FRAMEWORK_FEATURES } from '../hooks/definitions'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

export const OWNER_LIMITS = {
  /** Legacy lifecycle transport compatibility. The supervisor imposes no packet quota. */
  packet: Infinity,
  leases: Infinity,
  heartbeat: 15_000,
  expires: 60_000,
  request: 2_000,
  drain: 5_000,
  cleanup: 60_000,
} as const
/** Cold runtime verification, copying and child readiness share this bounded launch wait. */
export const OWNER_LAUNCH_MS = process.platform === 'win32' ? 60_000 : 30_000
/** Legacy name for an opaque request/registration ID, never an admission secret. */
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
/** Agent routes may be asked for as one reply naming each plugin: served, starting and off. */
export const AGENT_ROUTES_FORMAT_2 = 'agent-routes-format-2'
export const OWNER_WIRE: WireVersion = {
  major: 1,
  minMinor: 0,
  maxMinor: 0,
  features: [
    RENEW_RETRY,
    LOST_CHANNEL_ENDS,
    CONFIGURATION_LEDGER_V2,
    OWNER_RECOVERY,
    ...PLUGIN_FRAMEWORK_FEATURES,
  ],
}
/** Discovery metadata only. The SQLite writer transaction determines the current owner. */
export const OwnerRecord = z.strictObject({
  version: z.literal(1),
  epoch: Uuid,
  /** Legacy pipe routing token; possession grants no authority. */
  key: Hex,
  phase: z.enum(['accepting', 'draining', 'blocked', 'stopped']),
  wire: Wire,
})
export type OwnerRecord = z.infer<typeof OwnerRecord>
/**
 * Why the owner began to drain: the last lease expired, the last lease was released, the owner
 * was shut down, or no lease came within the expiry.
 */
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
    /**
     * Names one renewal; every retry of it after a lost reply carries the same value. Sent only
     * when the hello negotiated RENEW_RETRY; without it a renew is the next counter and nothing else.
     */
    renewal: Hex.optional(),
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
    /** Sent only to an owner that negotiated {@link AGENT_ROUTES_FORMAT_2}. */
    format: z.literal(2).optional(),
  }),
])
export type Command = z.infer<typeof Command>
export const Request = z.strictObject({ epoch: Uuid, nonce: Hex, command: Command })
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
export const OwnerDiagnostic = z.strictObject({
  phase: z.enum(['accepting', 'draining', 'blocked', 'stopped', 'missing', 'unreadable']),
  stage: z.enum(['attach-record', 'hello', 'detach', 'lease-lost', 'recovery']),
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
  /** Process-local current-instance identity for existing diagnostic callers. */
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
/** Legacy call shape retained for lifecycle callers; transport is ordinary JSON lines. */
export function pack(_key: string, _direction: 'request' | 'response', value: unknown): string {
  return JSON.stringify(value) + '\n'
}
export function unpack(_key: string, _direction: 'request' | 'response', bytes: string): unknown {
  return JSON.parse(bytes)
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
