import type { UsageWindowDetails } from '../../shared/usage-window'
import type { ProviderConfigLayout } from '@brobot2/runtime'
import type {
  TranscriptPolicy as PortableTranscript,
  DiscoveryPolicy as PortableDiscovery,
  ProviderChildWorkRequest as PortableChildRequest,
  RetentionScan as PortableRetention,
} from '@brobot2/runtime/provider-module'
import type { DesktopProviderValues } from './desktop-values'

export type TranscriptPolicy = PortableTranscript<DesktopProviderValues>
type DiscoveryPolicy = PortableDiscovery<DesktopProviderValues>
export type ProviderChildWorkRequest = PortableChildRequest<DesktopProviderValues>
export type RetentionScan = PortableRetention<DesktopProviderValues>

export interface ProviderDefinition {
  usageWindow(window: string): UsageWindowDetails
  signInKey(profileId: string): string
  signInConflict(holder: string, asked: string): Error
  readonly config: ProviderConfigLayout
  readonly deletionWords: readonly (readonly [string, string])[]
  readonly launch: { readonly freshTimeoutMs: number; readonly resumeTimeoutMs: number }
  readonly workspaceInstructionFile: string
  readonly transcripts: TranscriptPolicy
  readonly discovery: DiscoveryPolicy
}
