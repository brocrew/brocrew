import type { TranscriptEvent } from '../../shared/conversation-events'
import type { TranscriptToClear } from '../transcript-retention-types'
import type { ProviderSessionOf } from '../db/conversation-tree'
import type { ProviderFile, MemoryNote } from '../conversation-file-io'
import type { ChildWorkPart } from '../child-work-file'
import type { ChildWorkResult } from '../../shared/runtime-ipc'
import type { TurnAsked, TurnAsSent } from '../../shared/turn-as-sent'
import type { Discovery } from '../adopt/discovery-types'
import type { ProtectedPlaceKind } from '../../shared/work-folders'
import type {
  InstructionInputs,
  SessionLaunchRead,
  AgentMemoryStoreRead,
  AgentMemoryPage,
} from './instruction-types'
import type { InjectedInstruction } from '../../shared/instruction-contracts'
import type {
  GivenOrigin,
  GivenSkills,
  GivenDeferral,
  PartSize,
} from '../../shared/what-this-agent-was-given'
import type { ProviderSnapshotFile } from '../../shared/provider-snapshots'

/** Desktop value shapes supplied to the portable provider operations. */
export interface DesktopProviderValues {
  readonly event: TranscriptEvent
  readonly retentionCandidate: TranscriptToClear
  readonly session: ProviderSessionOf
  readonly file: ProviderFile
  readonly memoryNote: MemoryNote
  readonly childPart: ChildWorkPart
  readonly childResult: ChildWorkResult
  readonly turnAsked: TurnAsked
  readonly turnAnswer: TurnAsSent
  readonly discovery: Discovery
  readonly protectedPlaceKind: ProtectedPlaceKind
  readonly instructionInputs: InstructionInputs
  readonly launchRead: SessionLaunchRead
  readonly instruction: InjectedInstruction
  readonly origin: GivenOrigin
  readonly memoryStore: AgentMemoryStoreRead
  readonly memoryPage: AgentMemoryPage
  readonly givenSkills: GivenSkills
  readonly deferral: GivenDeferral
  readonly partSize: PartSize
  readonly snapshot: ProviderSnapshotFile
}
