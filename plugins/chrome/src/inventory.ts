import { allToolDefs } from './tools/index.js'
import { jsonSchemaOf } from './tools/schema.js'
import { configurationDefinition, configurationDiscoveryDefinition } from './configuration.js'

/** Author-generated documentation. MCP tools/list remains the runtime inventory. */
export function chromeToolInventory() {
  return [
    ...allToolDefs().map(({ spec }) => ({
      name: spec.name,
      description: spec.description,
      inputSchema: jsonSchemaOf(spec),
    })),
    configurationDefinition,
    configurationDiscoveryDefinition,
  ]
}
