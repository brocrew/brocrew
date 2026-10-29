import { selectedToolReceipt, type ProviderToolSelectionPolicy } from '../tool-selection'

const uncovered = ['home-mcp', 'project-mcp', 'native-plugins'] as const
/** Known server filters do not establish exclusion of every inherited source. */
export const codexToolSelection: ProviderToolSelectionPolicy = {
  describe(request, selected) {
    if (request !== undefined)
      return {
        status: 'unsupported',
        unsupportedSources: [...uncovered],
        message: 'Exact inherited MCP source exclusion is not supported by this Codex adapter.',
      }
    return {
      status: 'supported',
      catalog: selectedToolReceipt(selected, 'not-established', uncovered),
    }
  },
}
