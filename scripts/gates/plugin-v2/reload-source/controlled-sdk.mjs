// packaged-plugin-gate-only:reload-v1
// Closed build alias for @anthropic-ai/claude-agent-sdk in the dedicated reload MAIN-APP bundle ONLY.
// This file implements no SDK transport, CLI, login, account or network operation.
export const CONTROLLED_SDK_MODE = 'controlled-queryFactory-and-child-witness'
export function query() {
  throw new Error('Reload fixture refuses the default SDK query; controlled factory required')
}
export function tool(name, description, inputSchema) {
  // Metadata may be composed by the real adapter; supplied tool handlers are discarded.
  return Object.freeze({ name, description, inputSchema })
}
export function createSdkMcpServer({ name }) {
  // The controlled query never consumes this descriptor or creates an MCP transport.
  return Object.freeze({ type: 'sdk', name, instance: Object.freeze({}) })
}
