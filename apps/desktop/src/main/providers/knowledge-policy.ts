import type { InstructionInputs, SessionLaunchRead } from './instruction-types'

export interface InstructionPolicy {
  read(inputs: InstructionInputs): SessionLaunchRead
  workspaceFile?(root: string): string
  readonly bundleLeaf: string
}
