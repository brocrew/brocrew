import { z } from 'zod'
import { SkillName, SkillDigest } from '../../../shared/skills-catalogue'
import { pluginSha256 } from '../package-digests'
import { strictPluginJson } from '../strict-json'

export const STATE_LIMITS = {
  recordBytes: 128 * 1024,
  records: 4096,
  journalBytes: 32 * 1024 * 1024,
  plugins: 200,
  projections: 4096,
} as const
const integer = z.number().int().nonnegative().safe()
const uuid = z.uuid()
export const ReleaseState = z.strictObject({
  version: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.+_-]{0,79}$/),
  archiveSha256: SkillDigest,
  manifestSha256: SkillDigest,
  dataSchema: integer,
})
export const Installation = z.strictObject({
  pluginId: SkillName,
  installId: uuid,
  incarnation: uuid,
  lifecycleSequence: integer.min(1),
  releaseRevision: integer.min(1),
  configRevision: integer,
  release: ReleaseState,
  phase: z.enum(['prepared', 'active', 'removed']),
})
export type Installation = z.infer<typeof Installation>
export const ActivationSnapshot = z.strictObject({
  format: z.literal(1),
  rootId: uuid,
  epoch: uuid,
  entries: z.array(Installation).max(STATE_LIMITS.plugins),
})
export type ActivationSnapshot = z.infer<typeof ActivationSnapshot>
export const Consent = z.strictObject({
  action: z.enum(['install', 'update', 'uninstall', 'global-restore']),
  pluginId: SkillName.nullable(),
  at: integer,
  expectedSequence: integer,
  expectedInstallId: uuid.nullable(),
  release: ReleaseState.nullable(),
})
export type Consent = z.infer<typeof Consent>
export const OperationRequest = z.strictObject({
  operationId: uuid,
  consent: Consent,
  snapshot: ActivationSnapshot.nullable(),
  /** Optional format-1 extension: empty workspace receipts resolve atomically with this operation. */
  workspaces: z.array(uuid).max(64).optional(),
})
export type OperationRequest = z.infer<typeof OperationRequest>
export const Operation = z.strictObject({
  request: OperationRequest,
  allocated: z.strictObject({ installId: uuid, incarnation: uuid, epoch: uuid }),
  next: Installation.nullable(),
})
export type Operation = z.infer<typeof Operation>
export const ActivationRef = z.strictObject({
  name: z.string().regex(/^\d{8}-[a-f0-9]{64}\.json$/),
  sha256: SkillDigest,
})
export type ActivationRef = z.infer<typeof ActivationRef>
export const ResolutionReservation = z.strictObject({
  id: uuid,
  complete: ActivationRef,
  abort: ActivationRef,
  recordBytes: integer.max(STATE_LIMITS.recordBytes),
  records: z.literal(1),
  guardNames: z.literal(2),
  activationNames: z.literal(0),
})
export type ResolutionReservation = z.infer<typeof ResolutionReservation>
export const ProjectionReceipt = z.strictObject({
  format: z.literal(1),
  rootId: uuid,
  workspaceId: uuid,
  epoch: uuid,
  pluginId: SkillName,
  installId: uuid,
  incarnation: uuid,
  lifecycleSequence: integer.min(1),
  releaseRevision: integer.min(1),
  configRevision: integer,
  skills: z.array(z.never()).max(0),
  bindings: z.array(z.never()).max(0),
})
export type ProjectionReceipt = z.infer<typeof ProjectionReceipt>

/** Receipt data only: pending preview never grants authority. */
export function installationProjection(
  rootId: string,
  epoch: string,
  workspaceId: string,
  current: Installation,
): ProjectionReceipt {
  return {
    format: 1,
    rootId,
    workspaceId,
    epoch,
    pluginId: current.pluginId,
    installId: current.installId,
    incarnation: current.incarnation,
    lifecycleSequence: current.lifecycleSequence,
    releaseRevision: current.releaseRevision,
    configRevision: current.configRevision,
    skills: [],
    bindings: [],
  }
}

export const Event = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('projected'),
    workspaceId: uuid,
    pluginId: SkillName,
    receipt: ProjectionReceipt.nullable(),
  }),
  z.strictObject({ kind: z.literal('created'), rootId: uuid, epoch: uuid }),
  z.strictObject({ kind: z.literal('reader-floor'), version: z.literal(2) }),
  z.strictObject({
    kind: z.literal('prepared'),
    operation: Operation,
    reservation: ResolutionReservation.optional(),
  }),
  z.strictObject({ kind: z.literal('completed'), operationId: uuid, activation: ActivationRef }),
  z.strictObject({ kind: z.literal('aborted'), operationId: uuid, activation: ActivationRef }),
])
export type Event = z.infer<typeof Event>
export const JournalRecord = z.strictObject({
  sequence: integer,
  previous: SkillDigest.nullable(),
  publicationId: uuid,
  event: Event,
})
export type JournalRecord = z.infer<typeof JournalRecord>

export class PluginStateError extends Error {
  constructor(
    readonly code:
      'corrupt' | 'conflict' | 'busy' | 'unsafe-path' | 'limit' | 'missing-guard' | 'unsupported',
  ) {
    super(
      code === 'busy'
        ? 'Plugin busy. Try again.'
        : code === 'conflict' || code === 'unsupported'
          ? 'Plugin unavailable. Try again.'
          : 'Plugin recovery is required. Open Plugins.',
    )
    this.name = 'PluginStateError'
  }
}
export function refuseState(code: PluginStateError['code']): never {
  throw new PluginStateError(code)
}
const envelope = z.strictObject({ payload: z.string(), sha256: SkillDigest })
export function encodeState(value: unknown): Buffer {
  const payload = JSON.stringify(value)
  const bytes = Buffer.from(JSON.stringify({ payload, sha256: pluginSha256(Buffer.from(payload)) }))
  if (bytes.length > STATE_LIMITS.recordBytes) refuseState('limit')
  return bytes
}
export function decodeState<T>(bytes: Uint8Array, schema: z.ZodType<T>): T {
  try {
    const outer = envelope.safeParse(strictPluginJson(bytes, STATE_LIMITS.recordBytes))
    if (!outer.success || pluginSha256(Buffer.from(outer.data.payload)) !== outer.data.sha256)
      refuseState('corrupt')
    const parsed = schema.safeParse(
      strictPluginJson(Buffer.from(outer.data.payload), STATE_LIMITS.recordBytes),
    )
    if (!parsed.success) refuseState('corrupt')
    return parsed.data
  } catch {
    return refuseState('corrupt')
  }
}
export function stateInput<T>(input: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) refuseState('conflict')
  return parsed.data
}
export const equalState = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right)
export function frozen<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child)
    Object.freeze(value)
  }
  return value
}
