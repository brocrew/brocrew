import { statSync } from 'node:fs'
import {
  readProfileExecution,
  MAX_PROFILE_EXECUTION_BYTES,
  type ProfileExecutionRead,
} from '../profile-execution-file'
import type { GraphNode, KindQuality } from '../../shared/team-profile-graph'

export type GraphKindFile = { reading: ProfileExecutionRead; changing: boolean; readAt: number }
export type GraphKindEvidence = {
  complete: boolean
  serviceBirths: readonly string[]
  workerBirths: number
  earlierBirths: boolean
  serviceBindsCurrent: boolean
}
const fingerprint = (file: string): string => {
  try {
    const s = statSync(file, { bigint: true })
    return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`
  } catch {
    return 'absent'
  }
}
export function readGraphKindFile(
  file: string,
  reserve: (bytes: number) => void,
  now: () => number,
): GraphKindFile {
  const before = fingerprint(file)
  let sourceBytes = 0
  try {
    sourceBytes = statSync(file).size
  } catch {
    /* The bounded reader reports absence or an unreadable file. */
  }
  reserve(sourceBytes > MAX_PROFILE_EXECUTION_BYTES ? 4096 : sourceBytes * 4 + 4096)
  const reading = readProfileExecution(file)
  return { reading, changing: before !== fingerprint(file), readAt: now() }
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
  if (file.changing) return unknown('unknown-changing')
  if (!file.reading.readable) return unknown('unknown-file')
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
