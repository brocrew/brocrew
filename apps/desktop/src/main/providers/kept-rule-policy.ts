import type { Provider } from '@brobot2/shared'
import type { KeptRulesFile } from '../../shared/runtime-ipc'

export interface KeptRulePolicy {
  projectFolders(
    records: readonly { readonly provider: Provider; readonly cwd: string }[],
  ): string[]
  files(homes: readonly string[], projectFiles: readonly string[]): KeptRulesFile[]
  remove(file: string, kept: string, platform: NodeJS.Platform): void
}
