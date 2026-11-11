import type { ChosenAttachment, DroppedPathVerdict } from './runtime-ipc'
import type { VoiceBridge } from './voice'

/** Mounted composer operations; file resolution must remain synchronous during a gesture. */
export interface ClientComposerApi {
  chooseAttachment(input?: { cwd?: string }): Promise<ChosenAttachment>
  pathForDroppedFile(file: File): string
  handDroppedPaths(input: { paths: string[]; cwd?: string }): Promise<DroppedPathVerdict[]>
  pasteImage(input?: { cwd?: string }): Promise<DroppedPathVerdict>
  readonly voice?: VoiceBridge
}
