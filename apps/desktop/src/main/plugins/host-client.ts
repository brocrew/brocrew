import type {
  PluginBeforeTurnInput,
  PluginBeforeTurnResult,
  PluginHostResult,
} from '../../shared/plugin-contract'
import type { PluginHostSnapshot, PluginHostUiRequest } from '../../shared/plugin-host'

export interface PluginHostConnection {
  snapshot(): Promise<PluginHostSnapshot>
  request(input: PluginHostUiRequest): Promise<PluginHostResult<unknown>>
  beforeTurn(input: Omit<PluginBeforeTurnInput, 'workspaceId'>): Promise<PluginBeforeTurnResult>
  onChanged(listener: () => void): () => void
}
