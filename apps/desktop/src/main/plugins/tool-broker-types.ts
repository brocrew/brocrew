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
export interface PublishedBrokerTool {
  readonly namespace: string
  readonly name: string
  readonly qualifiedName: string
  readonly description: string
  readonly inputSchema: BrokerInput
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
export interface BrokerClock {
  now(): number
  after(ms: number, callback: () => void): () => void
}
export type BrokerFailure =
  | 'invalid'
  | 'unauthorized'
  | 'unavailable'
  | 'denied'
  | 'busy'
  | 'cancelled'
  | 'deadline'
  | 'downstream'
export interface BrokerAudit {
  readonly event: 'queued' | 'started' | 'finished' | 'refused' | 'unavailable'
  readonly operation: 'tool' | 'admin'
  readonly queued: number
  readonly code?: BrokerFailure
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
  readonly clock?: BrokerClock
  readonly audit?: (event: BrokerAudit) => void
}
declare const workspaceBrand: unique symbol
declare const agentBrand: unique symbol
declare const personBrand: unique symbol
export interface BrokerWorkspace {
  readonly [workspaceBrand]: true
}
export interface BrokerAgent {
  readonly [agentBrand]: true
}
export interface BrokerPerson {
  readonly [personBrand]: true
}
export interface PluginToolBroker {
  readonly agent: {
    discover(capability: BrokerAgent): readonly PublishedBrokerTool[]
    call(
      capability: BrokerAgent,
      qualifiedName: string,
      input: BrokerInput,
      signal?: AbortSignal,
    ): Promise<BrokerValue>
  }
  readonly person: {
    call(
      capability: BrokerPerson,
      operation: string,
      input: BrokerInput,
      signal?: AbortSignal,
    ): Promise<BrokerValue>
  }
  /** Retained by the authenticated owner; never handed to agents or a plugin. */
  readonly owner: {
    attach(workspaceId: string): BrokerWorkspace
    grantAgent(workspace: BrokerWorkspace, incarnation: string): BrokerAgent
    grantPerson(workspace: BrokerWorkspace, incarnation: string): BrokerPerson
    revoke(capability: BrokerAgent | BrokerPerson): void
    detach(workspace: BrokerWorkspace): void
    invalidate(): void
  }
  status(): Readonly<{
    available: boolean
    queued: number
    executing: boolean
    awaitingQuiescence: boolean
  }>
}
