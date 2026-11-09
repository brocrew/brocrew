import type { ProfileExecutionRead } from '../profile-execution-file'
import type { GraphNode, KindQuality } from '../../shared/team-profile-graph'

/** How profiles run, as the graph read them in its own snapshot, and when. */
export type GraphKindFile = { reading: ProfileExecutionRead; readAt: number }
export type GraphKindEvidence = {
  complete: boolean
  serviceBirths: readonly string[]
  workerBirths: number
  earlierBirths: boolean
  serviceBindsCurrent: boolean
}
export function graphKindOf(
  identity: { id: string; createdAt: number },
  file: GraphKindFile,
  evidence: GraphKindEvidence,
): Pick<GraphNode, 'kind' | 'kindQuality' | 'kindReadAt'> {
  const unknown = (
    kindQuality: KindQuality,
  ): Pick<GraphNode, 'kind' | 'kindQuality' | 'kindReadAt'> => ({
    kind: 'unknown',
    kindQuality,
    kindReadAt: file.readAt,
  })
  if (!file.reading.readable || file.reading.absent === true) return unknown('unknown-file')
  const entry = file.reading.kept.profiles[identity.id]
  if ((entry && entry.identityCreatedAt !== identity.createdAt) || evidence.earlierBirths)
    return unknown('unknown-incarnation')
  if (!evidence.complete) return unknown('unknown-lineage')
  if (
    entry?.retired ||
    entry?.reserved ||
    entry?.removing ||
    entry?.workerPools?.length ||
    evidence.workerBirths
  )
    return unknown('unknown-lineage')
  if (!entry)
    return evidence.serviceBirths.length
      ? unknown('unknown-conflict')
      : { kind: 'normal', kindQuality: 'legacy-normal', kindReadAt: file.readAt }
  if (entry.kind === 'normal')
    return evidence.serviceBirths.length
      ? unknown('unknown-conflict')
      : { kind: 'normal', kindQuality: 'stable-record', kindReadAt: file.readAt }
  if (entry.serviceConversation === undefined)
    return evidence.serviceBirths.length
      ? unknown('unknown-conflict')
      : { kind: 'service', kindQuality: 'stable-record', kindReadAt: file.readAt }
  if (
    !evidence.serviceBindsCurrent ||
    evidence.serviceBirths.length !== 1 ||
    evidence.serviceBirths[0] !== entry.serviceConversation
  )
    return unknown('unknown-conflict')
  return { kind: 'service', kindQuality: 'stable-record', kindReadAt: file.readAt }
}
