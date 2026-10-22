import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export const OWNER_LIMITS = {
  packet: 16 * 1024,
  leases: 64,
  heartbeat: 15_000,
  expires: 60_000,
  request: 2_000,
  drain: 5_000,
} as const
/**
 * How long a first supervisor start may take before it is given up. On Windows it copies and
 * hashes the pinned node.exe, which the system scans as a new program, and checks the plugin root's
 * access list through Windows' own programs: seconds on a cold machine, where macOS takes well under
 * one.
 */
export const OWNER_LAUNCH_MS = process.platform === 'win32' ? 60_000 : OWNER_LIMITS.request
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
export const OWNER_WIRE: WireVersion = {
  major: 1,
  minMinor: 0,
  maxMinor: 0,
  features: [RENEW_RETRY, LOST_CHANNEL_ENDS, CONFIGURATION_LEDGER_V2],
}
/** Every copy of the app sharing the plugin root reads this strictly: it never gains a field. */
export const OwnerRecord = z.strictObject({
  version: z.literal(1),
  epoch: Uuid,
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
  }),
])
export type Command = z.infer<typeof Command>
export const Request = z.strictObject({ epoch: Uuid, nonce: Hex, challenge: Hex, command: Command })
export type Request = z.infer<typeof Request>
export const Envelope = z.strictObject({ data: z.string().max(OWNER_LIMITS.packet), mac: Hex })
export type Refusal = 'unavailable' | 'busy' | 'incompatible' | 'cleanup-pending' | 'unsupported'
export class PluginSupervisorError extends Error {
  constructor(readonly code: Refusal) {
    super(
      code === 'busy'
        ? 'Plugin busy. Try again.'
        : code === 'incompatible'
          ? 'Update this copy of BroCrew to use this plugin.'
          : 'Plugin unavailable. Try again.',
    )
    this.name = 'PluginSupervisorError'
  }
}
export function refuse(code: Refusal = 'unavailable'): never {
  throw new PluginSupervisorError(code)
}
const mac = (key: string, direction: string, data: string) =>
  createHmac('sha256', Buffer.from(key, 'hex')).update(`${direction}\n${data}`).digest('hex')
export function pack(key: string, direction: 'request' | 'response', value: unknown): string {
  const data = JSON.stringify(value)
  const packet = JSON.stringify({ data, mac: mac(key, direction, data) }) + '\n'
  if (Buffer.byteLength(packet) > OWNER_LIMITS.packet) refuse()
  return packet
}
export function unpack(key: string, direction: 'request' | 'response', bytes: string): unknown {
  const packet = Envelope.parse(JSON.parse(bytes))
  if (
    !timingSafeEqual(
      Buffer.from(packet.mac, 'hex'),
      Buffer.from(mac(key, direction, packet.data), 'hex'),
    )
  )
    refuse()
  return JSON.parse(packet.data)
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
