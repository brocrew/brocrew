import type { PluginToolFailureReason } from './tool-diagnostics'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'

/** A client retained for the lifetime of the actual plugin instance. */
export type PluginMcpClient = Pick<Client, 'listTools' | 'callTool'>
export interface PluginToolCall {
  readonly workspaceId: string
  readonly requestId: string | number
  readonly name: string
  readonly arguments?: Record<string, unknown>
  readonly origin: string
  readonly meta?: Record<string, unknown>
  readonly signal?: AbortSignal
}
export interface InstanceToolScope {
  readonly workspaceId: string
  readonly pluginId: string
  readonly instanceId: string
}
export interface PluginToolService {
  listTools(scope: InstanceToolScope, signal?: AbortSignal): Promise<Tool[]>
  callTool(input: InstanceToolScope & Omit<PluginToolCall, 'workspaceId'>): Promise<CallToolResult>
  cancelTool(
    input: InstanceToolScope & { requestId: string | number },
  ): Promise<{ cancelled: boolean; completed: boolean }>
}
export interface GenericBrokerOptions {
  readonly binding: {
    readonly pluginId: string
    readonly installId: string
    readonly instanceId: string
  }
  readonly client: PluginMcpClient
  readonly isEnabled: (workspaceId: string) => boolean
  readonly diagnostic?: (reason: PluginToolFailureReason) => void
}
export interface GenericPluginToolBroker {
  readonly binding: GenericBrokerOptions['binding']
  listTools(workspaceId: string, signal?: AbortSignal): Promise<Tool[]>
  callTool(input: PluginToolCall): Promise<CallToolResult>
  cancelTool(input: { workspaceId: string; requestId: string | number }): {
    cancelled: boolean
    completed: boolean
  }
  /** Invalidates this instance only. It never closes or replaces the retained client. */
  invalidate(): void
}
/** Legacy package adapter types, retained until those adapters migrate to their packages. */
export type BrokerValue =
  | null
  | boolean
  | number
  | string
  | readonly BrokerValue[]
  | { readonly [key: string]: BrokerValue }
export type BrokerInput = Readonly<Record<string, BrokerValue>>
export interface BrokerBinding {
  readonly pluginId: string
  readonly installId: string
  readonly epoch: string
}
export interface BrokerIdentity extends BrokerBinding {
  readonly workspaceId: string
  readonly kind: 'agent' | 'person'
  readonly incarnation: string
}
export interface ResourceUse {
  readonly resource: string
  readonly key: string
  readonly mode: 'read' | 'write'
}
export interface PreparedTool {
  readonly input: BrokerInput
  readonly resources: readonly ResourceUse[]
}
export interface BrokerTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: BrokerInput
  /** The curated binding validates arguments and names every resource the operation can use. */
  readonly prepare: (input: BrokerInput) => PreparedTool
}
export interface BrokerResource {
  readonly id: string
  readonly read: boolean
  readonly write: boolean
}
export interface BrokerRequest {
  readonly identity: BrokerIdentity
  readonly name: string
  readonly input: BrokerInput
  readonly resources: readonly ResourceUse[]
}
export type BrokerReply =
  { readonly ok: true; readonly value: BrokerValue } | { readonly ok: false }
export interface PluginExecution {
  readonly result: Promise<BrokerReply>
  /** Only the trusted transport may resolve this, after execution and its streams have stopped. */
  readonly quiescent: Promise<void>
  /** Requests cancellation; a return or resolution is not a quiescence receipt. */
  cancel(): void | Promise<void>
}
export interface BrokerServer {
  tool(request: BrokerRequest, signal: AbortSignal): PluginExecution
  admin(request: BrokerRequest, signal: AbortSignal): PluginExecution
}
export interface BrokerOptions {
  readonly binding: BrokerBinding
  /** Host-owned inventories; never accepted from an agent or copied from a server reply. */
  readonly reservedNamespace: string
  readonly hostToolNames: readonly string[]
  readonly occupiedNamespaces: readonly string[]
  readonly occupiedQualifiedNames: readonly string[]
  readonly tools: readonly BrokerTool[]
  readonly adminOperations: readonly string[]
  readonly resources: readonly BrokerResource[]
  readonly isAllowed: (identity: BrokerIdentity, use: ResourceUse) => boolean
  readonly server: BrokerServer
}
