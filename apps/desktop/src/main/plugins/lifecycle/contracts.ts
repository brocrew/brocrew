import type { PluginNodeReady } from '../node-host'
import type { VerifiedPluginPackage } from '../package-verifier'
import type { AdmissionObserver } from '../route-admission-trace'
import type { Installation } from '../state/format'
import type { BrokerOptions } from '../tool-broker-types'

export interface AgentAttachmentView {
  package: VerifiedPluginPackage
  connection: Promise<PluginNodeReady>
  installation: Installation
  workspaceId: string
  runId: string
  exited: Promise<void>
  current: (observer?: AdmissionObserver) => boolean
}

export type PluginBrokerBinding = Omit<
  BrokerOptions,
  | 'binding'
  | 'reservedNamespace'
  | 'hostToolNames'
  | 'occupiedNamespaces'
  | 'occupiedQualifiedNames'
>
