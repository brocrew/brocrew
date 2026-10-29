import { selectedToolReceipt, type ProviderToolSelectionPolicy } from '../tool-selection'

/** Claude queries use explicit MCP servers and no filesystem setting sources. */
export const claudeToolSelection: ProviderToolSelectionPolicy = {
  describe(request, selected) {
    return {
      status: 'supported',
      catalog: selectedToolReceipt(
        selected,
        request ? 'excluded-by-explicit-config' : 'not-established',
        [],
      ),
    }
  },
}
