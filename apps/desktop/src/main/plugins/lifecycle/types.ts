import type { KeyObject } from 'node:crypto'
import type { PluginCard } from '../../../shared/plugin-settings'
import type { PluginReleasePin } from '../package-verifier'
import type { PluginRelease, PluginTarget } from '../package-schema'
import type { GlobalPluginState } from '../state/store'
import type { ProjectionReceipt, Installation } from '../state/format'
import type { PluginNodeReady, PluginNodeStart } from '../node-host'

export interface LifecycleRun {
  readonly runId: string
  ready(): Promise<PluginNodeReady>
  readonly exited: Promise<void>
  /** Resolves only after positive exit proof for this exact run; unknown rejects. */
  stop(): Promise<void>
}
export interface LifecycleRuntime {
  start(spec: PluginNodeStart): Promise<LifecycleRun>
  removeCode(pluginId: string, releaseDigest: string): Promise<void>
  /** Deletes one plugin's private data folder, for a plugin whose adapter clears it on uninstall. */
  removeData?(pluginId: string): Promise<void>
  /** Only a newly fenced supervisor with a proven clean predecessor may return true. */
  previousOwnerClean(): Promise<boolean>
}
export interface WorkspaceProjection {
  readonly workspaceId: string
  /** Revoke running consumers/UI; false or rejection is not proof of quiescence. */
  revoke(pluginId: string, installId: string): Promise<boolean>
}
/** The app's side of a workspace: it still answers an older owner's applied/reconcile notices. */
export interface PersonProjection extends WorkspaceProjection {
  applied(pluginId: string, receipt: ProjectionReceipt | null): Promise<void>
  reconcile(change: {
    pluginId: string
    before: ProjectionReceipt | null
    receipt: ProjectionReceipt | null
  }): Promise<void>
}
export interface LifecycleOptions {
  root: string
  state: GlobalPluginState
  pinnedPublicKey: KeyObject | null
  /** App-admitted repo-list digest authority only; exclusive with the dormant signing key. */
  repoCatalogueSha256?: string
  /** Raw list bound by trusted app launch input, used to derive older minimum-version views. */
  repoList?: { bytes: Uint8Array; sha256: string; appVersion: string }
  legacyRepoList?: { bytes: Uint8Array; sha256: string; appVersion: string }
  target: PluginTarget
  catalogue: { bytes: Uint8Array; signature: Uint8Array }
  /** Reviewed host-owned display names, never remote unreviewed text. */
  names: Readonly<Record<string, string>>
  /** Re-read only the source fixed by trusted app launch code. */
  refreshCatalogue?: () => Promise<{
    catalogue: { bytes: Uint8Array; signature: Uint8Array }
    repoCatalogueSha256?: string
    repoList?: { bytes: Uint8Array; sha256: string; appVersion: string }
    legacyRepoList?: { bytes: Uint8Array; sha256: string; appVersion: string }
    names: Readonly<Record<string, string>>
  }>
  runtime: LifecycleRuntime
  /** Synchronous central broker/consumer admission revocation, before any await. */
  deny(pluginId: string): void
  /** Owner-only wakeup. Receivers must still await the retained run's positive exit proof. */
  onChromeHostExit?(runId: string): void
  download?: (release: Readonly<PluginRelease>, signal: AbortSignal) => Promise<Uint8Array>
  now?: () => number
  /** Live host-broker reachability, separate from the plugin process lifecycle. */
  toolsUnavailable?: (pluginId: string) => boolean
  /** Fixed-vocabulary `stage: cause` behind unavailable tools, when known. */
  toolsCause?: (pluginId: string) => string | undefined
  /** Inert fault controls only; never a production launch option. */
  fault?: (point: 'prepared' | 'staged' | 'ready' | 'activated' | 'update-fenced') => void
}
declare const workspaceBrand: unique symbol
export interface LifecycleWorkspace {
  readonly [workspaceBrand]: true
}
export interface LifecycleStatus {
  readonly cards: readonly PluginCard[]
  readonly cleanupPending: readonly string[]
}
export type { Installation, PluginReleasePin, PluginRelease }
