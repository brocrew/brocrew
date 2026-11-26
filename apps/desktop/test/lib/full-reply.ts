import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { readFileSync } from 'node:fs'
import type { AgentToolset } from '@brobot2/runtime'
import { claudeMcpServersFor } from '../../../../packages/runtime/src/claude/agent-tools'

/** **484 · the path a long reply names** on its last line, spaces and all; `null` when it names none. */
export function fullReplyPath(text: string): string | null {
  return /\n\nFull reply: ([^\n]+)$/.exec(text)?.[1] ?? null
}

/**
 * **484 · the whole reply a tool gave**: the text itself, or — when it was long and ends
 * `Full reply: <path>` — what that file holds.
 */
export function wholeReply(text: string): string {
  const path = fullReplyPath(text)
  return path === null ? text : readFileSync(path, 'utf8')
}

/** A reply with its temp file's path left out, so the replies of two calls compare. */
export function theFileUnnamed(text: string): string {
  const path = fullReplyPath(text)
  return path === null ? text : `${text.slice(0, -path.length)}<file>`
}

/** A long reply's short form, the path it names, and the whole reply that file holds. */
export function splitFullReply(text: string): { short: string; path: string; full: string } {
  const path = fullReplyPath(text)
  if (path === null) throw new Error(`no full reply named in: ${text.slice(0, 200)}`)
  return {
    short: text.slice(0, text.length - `\n\nFull reply: ${path}`.length),
    path,
    full: readFileSync(path, 'utf8'),
  }
}

/** What a tool answers through the real Claude MCP server, as the model reads it. */
export async function toolTextViaClaude(
  toolset: AgentToolset,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const server = (
    claudeMcpServersFor(toolset)!['brobot'] as unknown as {
      instance: { server: { connect(transport: unknown): Promise<void>; close(): Promise<void> } }
    }
  ).instance.server
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'fictional-long-reply-reader', version: '1' })
  try {
    await server.connect(serverSide)
    await client.connect(clientSide)
    const answered = await client.callTool({ name, arguments: args })
    return (answered.content as { text: string }[]).map((one) => one.text).join('\n')
  } finally {
    await client.close()
    await server.close()
  }
}
