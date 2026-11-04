import { z } from 'zod'
import { PLUGIN_PAGE_CHANNEL } from '../../../shared/plugin-page'
import type { PluginJsonObject, PluginToolCallResult } from '../../../shared/plugin-contract'
import { pluginToolCallResult } from '../tool-result'

const packet = z.object({
  channel: z.literal(PLUGIN_PAGE_CHANNEL),
  requestId: z.string(),
  method: z.literal('callTool'),
  params: z.object({ tool: z.string(), arguments: z.record(z.string(), z.json()) }),
})
/** Configuration is another caller of the same MCP tools, with no app field decoder. */
export class PluginPageTools {
  private closed = false
  private readonly pending = new Map<string, AbortController>()
  constructor(
    private readonly options: {
      current(): boolean
      callTool(
        tool: string,
        args: PluginJsonObject,
        requestId: string,
        signal: AbortSignal,
      ): Promise<PluginToolCallResult>
      cancelTool?(requestId: string): Promise<unknown>
    },
  ) {}
  async invoke(input: unknown): Promise<PluginToolCallResult> {
    const asked = packet.parse(input)
    if (this.closed || !this.options.current()) throw new Error('Plugin unavailable.')
    if (this.pending.has(asked.requestId)) throw new Error('Request is already running.')
    const abort = new AbortController()
    this.pending.set(asked.requestId, abort)
    try {
      const answer = await pluginToolCallResult(() =>
        this.options.callTool(
          asked.params.tool,
          structuredClone(asked.params.arguments),
          asked.requestId,
          abort.signal,
        ),
      )
      if (this.closed || abort.signal.aborted || !this.options.current())
        throw new Error('Plugin unavailable.')
      return answer
    } finally {
      this.pending.delete(asked.requestId)
    }
  }
  close(): void {
    this.closed = true
    for (const [requestId, abort] of this.pending) {
      abort.abort()
      void this.options.cancelTool?.(requestId).catch(() => {})
    }
    this.pending.clear()
  }
}
