import type { BrokerOptions } from '../../src/main/plugins/tool-broker'

export function echoBinding(text: string): Pick<BrokerOptions, 'tools' | 'server'> {
  return {
    tools: [{ name: 'echo', description: 'Fictional echo', inputSchema: { type: 'object' } }],
    server: {
      tool: () => ({
        result: Promise.resolve({
          ok: true as const,
          value: { content: [{ type: 'text', text }] },
        }),
        quiescent: Promise.resolve(),
        cancel() {},
      }),
    },
  }
}
