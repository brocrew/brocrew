import { McpError } from '@modelcontextprotocol/sdk/types.js'
import type { PluginToolCallResult } from '../../shared/plugin-contract'

/** Protocol details reach the caller; ordinary local failures have a fixed public message. */
export async function pluginToolCallResult(
  call: () => Promise<PluginToolCallResult>,
): Promise<PluginToolCallResult> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof McpError)
      return {
        status: 'protocol-error',
        error: {
          code: error.code,
          message: error.message,
          ...(error.data === undefined ? {} : { data: error.data }),
        },
      }
    return { status: 'transport-error', message: 'The plugin tool call failed.' }
  }
}
