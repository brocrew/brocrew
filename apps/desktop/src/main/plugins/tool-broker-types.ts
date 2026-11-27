import type { RequestMeta } from '@modelcontextprotocol/sdk/types.js'
import type { PluginToolFailureReason, PluginCallDiagnostic } from './tool-diagnostics'
export type BrokerValue =
  | null
  | boolean
  | number
  | string
  | readonly BrokerValue[]
  | { readonly [key: string]: BrokerValue }
export type BrokerInput = Readonly<Record<string, BrokerValue>>
interface BrokerBinding {
  readonly pluginId: string
  readonly installId: string
  readonly epoch: string
}
export interface BrokerIdentity extends BrokerBinding {
  readonly workspaceId: string
  readonly incarnation: string
}
export interface BrokerTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: BrokerInput
  readonly [field: string]: unknown
}
export interface PublishedBrokerTool extends BrokerTool {
  readonly namespace: string
  readonly qualifiedName: string
}
export interface BrokerRequest {
  readonly identity: BrokerIdentity
  readonly name: string
  readonly input: BrokerInput
  readonly _meta?: RequestMeta
}
export type BrokerReply =
  | { readonly ok: true; readonly value: BrokerValue }
  | { readonly ok: false; readonly cause?: BrokerCallCause; readonly error?: unknown }
export type BrokerCallCause = 'stalled' | 'cancelled' | 'connection-failed' | 'downstream'
export interface BrokerProgress {
  readonly progress: number
  readonly total?: number
  readonly message?: string
}
export interface PluginExecution {
  readonly result: Promise<BrokerReply>
  /** Only the trusted transport may resolve this, after execution and its streams have stopped. */
  readonly quiescent: Promise<void>
  /** Requests cancellation; a return or resolution is not a quiescence receipt. */
  cancel(): void | Promise<void>
}
export interface BrokerServer {
  /** The transport owns idle timeouts; a failed call stays counted until its quiescence is proven. */
  tool(
    request: BrokerRequest,
    signal: AbortSignal,
    onprogress?: (progress: BrokerProgress) => void,
  ): PluginExecution
}
export type BrokerFailure =
  'invalid' | 'unauthorized' | 'unavailable' | 'denied' | 'busy' | 'cancelled' | 'downstream'
export interface BrokerAudit {
  readonly event: 'started' | 'finished' | 'refused' | 'unavailable' | 'call'
  readonly code?: BrokerFailure
  readonly reason?: PluginToolFailureReason
  readonly call?: PluginCallDiagnostic
}
export interface BrokerOptions {
  readonly binding: BrokerBinding
  /** Host-owned inventories; never accepted from an agent or copied from a server reply. */
  readonly reservedNamespace: string
  readonly hostToolNames: readonly string[]
  readonly occupiedNamespaces: readonly string[]
  readonly occupiedQualifiedNames: readonly string[]
  readonly tools: readonly BrokerTool[]
  readonly server: BrokerServer
  /** Trusted owner proof for the exact retained host and its descendants, never plugin input. */
  readonly hostExited?: Promise<void>
  readonly audit?: (event: BrokerAudit) => void
}
declare const workspaceBrand: unique symbol
declare const agentBrand: unique symbol
export interface BrokerWorkspace {
  readonly [workspaceBrand]: true
}
export interface BrokerAgent {
  readonly [agentBrand]: true
}
export interface PluginToolBroker {
  readonly agent: {
    discover(capability: BrokerAgent): readonly PublishedBrokerTool[]
    call(
      capability: BrokerAgent,
      qualifiedName: string,
      input: BrokerInput,
      signal?: AbortSignal,
      onprogress?: (progress: BrokerProgress) => void,
      _meta?: RequestMeta,
    ): Promise<BrokerValue>
  }
  /** Retained by the authenticated owner; never handed to agents or a plugin. */
  readonly owner: {
    attach(workspaceId: string): BrokerWorkspace
    grantAgent(workspace: BrokerWorkspace, incarnation: string): BrokerAgent
    revoke(capability: BrokerAgent): void
    detach(workspace: BrokerWorkspace): void
    invalidate(): void
    /** Positive completion of every dispatched call; a failed/absent proof never grants this. */
    hasCompletionProof(): boolean
  }
  status(): Readonly<{
    available: boolean
    executing: boolean
    awaitingQuiescence: boolean
    unknownCalls: readonly PluginCallDiagnostic[]
  }>
}
