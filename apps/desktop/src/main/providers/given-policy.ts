import type { LaunchSettingKey, ProviderCommand } from '@brobot2/runtime'
import type { GivenDeferral, PartSize } from '../../shared/what-this-agent-was-given'

export interface ListedSkills {
  readonly commands: readonly ProviderCommand[]
  readonly at: number
  readonly dropped: number
}
export interface GivenPolicy {
  nativeFiles(cwd: string): string[]
  readonly repositoryOrigin: string
  deferral(published: readonly string[] | null): GivenDeferral
  externalDeferral(published: readonly string[] | null): GivenDeferral
  otherServers(
    published: readonly string[] | null,
    brobotsServer: string,
    granted: readonly string[],
  ): { readonly size: PartSize | null; readonly why: string | null }
  namespaceText(declaredWith: string | null, count: number): string | null
  readonly planningKey: LaunchSettingKey
}
