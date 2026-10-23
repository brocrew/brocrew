import type { InstructionInputs, SessionLaunchRead } from './instruction-types'

export interface InstructionPolicy {
  readonly given: import('./given-policy').GivenPolicy
  read(inputs: InstructionInputs): SessionLaunchRead
  workspaceFile?(root: string): string
  readonly bundleLeaf: string
}
