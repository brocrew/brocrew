import type { InstructionInputs, SessionLaunchRead } from './instruction-types'

export interface InstructionPolicy {
  read(inputs: InstructionInputs): SessionLaunchRead
  readonly bundleLeaf: string
}
