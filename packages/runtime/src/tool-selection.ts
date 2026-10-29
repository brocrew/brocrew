import type { AgentToolset } from './agent-tools'
import type { ExternalMcpReach } from './external-mcp'
import type { ManagedPluginMcpServer } from './managed-plugin-mcp'
import type { SessionHandle } from './runtime'

/** A trusted host asks for a source boundary, never for extra grants. */
export interface ToolSelectionRequest {
  readonly inheritedSources: 'exclude'
}
export interface SelectedToolInputs {
  readonly agentTools?: AgentToolset
  readonly externalMcp?: ExternalMcpReach
  readonly managedPluginMcp?: readonly ManagedPluginMcpServer[]
}
export interface ToolCatalogReceipt {
  readonly selected: {
    readonly appTools: readonly string[]
    readonly externalServers: readonly string[]
    readonly pluginServers: readonly string[]
  }
  readonly inheritedSources: {
    readonly mcp: 'excluded-by-explicit-config' | 'not-established'
    readonly uncovered: readonly string[]
  }
  readonly knownRestrictions: {
    readonly excludedServers: readonly string[]
    readonly filteredTools: readonly string[]
  }
  readonly discovery: {
    readonly appTools: 'declared'
    readonly externalTools: 'not-established'
  }
}
export type ToolSelectionDescription =
  | { readonly status: 'supported'; readonly catalog: ToolCatalogReceipt }
  | {
      readonly status: 'unsupported'
      readonly unsupportedSources: readonly string[]
      readonly message: string
    }
export interface ProviderToolSelectionPolicy {
  describe(
    request: ToolSelectionRequest | undefined,
    selected: SelectedToolInputs,
  ): ToolSelectionDescription
}
export class ToolSelectionUnsupportedError extends Error {
  override readonly name = 'ToolSelectionUnsupportedError'
  constructor(
    readonly unsupportedSources: readonly string[],
    message: string,
  ) {
    super(message)
  }
}

/** A receipt contains declared names only, never handlers or broker capabilities. */
export function selectedToolReceipt(
  selected: SelectedToolInputs,
  mcp: ToolCatalogReceipt['inheritedSources']['mcp'],
  uncovered: readonly string[],
): ToolCatalogReceipt {
  const receipt: ToolCatalogReceipt = {
    selected: {
      appTools: selected.agentTools?.tools.map((tool) => tool.name) ?? [],
      externalServers: selected.externalMcp?.servers.map((server) => server.name) ?? [],
      pluginServers: selected.managedPluginMcp?.map((server) => server.name) ?? [],
    },
    inheritedSources: { mcp, uncovered: [...uncovered] },
    knownRestrictions: { excludedServers: [], filteredTools: [] },
    discovery: { appTools: 'declared', externalTools: 'not-established' },
  }
  for (const names of [
    receipt.selected.appTools,
    receipt.selected.externalServers,
    receipt.selected.pluginServers,
    receipt.inheritedSources.uncovered,
    receipt.knownRestrictions.excludedServers,
    receipt.knownRestrictions.filteredTools,
  ])
    Object.freeze(names)
  Object.freeze(receipt.selected)
  Object.freeze(receipt.inheritedSources)
  Object.freeze(receipt.knownRestrictions)
  Object.freeze(receipt.discovery)
  return Object.freeze(receipt)
}

/** Omission preserves the old launch; a requested boundary must be enforced or refused. */
export function requireToolSelection(
  policy: ProviderToolSelectionPolicy,
  context: SelectedToolInputs & { readonly toolSelection?: ToolSelectionRequest },
): ToolCatalogReceipt | undefined {
  if (context.toolSelection === undefined) return undefined
  if (context.toolSelection.inheritedSources !== 'exclude')
    throw new ToolSelectionUnsupportedError(
      ['invalid-request'],
      'The tool source selection is not supported.',
    )
  const described = policy.describe(context.toolSelection, context)
  if (described.status === 'unsupported')
    throw new ToolSelectionUnsupportedError(described.unsupportedSources, described.message)
  return described.catalog
}

/** The immutable launch receipt is separate from a later provider inventory or live grant read. */
export function withToolCatalog(
  handle: SessionHandle,
  catalog: ToolCatalogReceipt | undefined,
): SessionHandle {
  if (catalog === undefined) return handle
  Object.defineProperty(handle, 'toolCatalog', { value: catalog, enumerable: true })
  return handle
}
