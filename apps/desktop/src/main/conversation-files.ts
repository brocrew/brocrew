import type { Provider } from '@brobot2/shared'
import type { ProviderSessionOf } from './db/conversation-tree'
import type { ProviderFile, MemoryNote } from './conversation-file-io'
import { providerDefinitions } from './providers/definitions'
export {
  frontMatterOf,
  removeFromHome,
  type ProviderFile,
  type MemoryNote,
  type FileLeft,
} from './conversation-file-io'
export function providerFilesOf(
  provider: Provider,
  home: string,
  sessions: readonly ProviderSessionOf[],
): ProviderFile[] {
  return providerDefinitions[provider].transcripts.filesOf(home, sessions)
}
export function memoryNotesOf(
  provider: Provider,
  home: string,
  sessions: readonly ProviderSessionOf[],
): MemoryNote[] {
  return providerDefinitions[provider].transcripts.memoryNotesOf(home, sessions)
}
