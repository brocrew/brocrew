import type { SessionRef } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { providerDefinitions } from '../providers/definitions'
export { readProviderDatabase, readLines, freeBytesOn, type LineChunk } from './native-io'
export {
  newestStateDatabase,
  newestReplyModel,
  CLAUDE_JSONL,
  CODEX_ROLLOUT_JSONL,
} from '../providers/definitions'

export function nativeTranscriptPath(
  provider: Provider,
  home: string,
  ref: SessionRef,
): string | null {
  return providerDefinitions[provider].transcripts.nativePath(home, ref)
}
export function isTheProvidersRecord(provider: Provider, home: string, file: string): boolean {
  return providerDefinitions[provider].transcripts.ownsRecord(home, file)
}
