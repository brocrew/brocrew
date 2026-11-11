/** The naming convention supplied with a tool inventory. */
export interface ToolNaming {
  readonly prefix: string
  readonly separator: string
}

/** Spell a server's tool using the supplied convention. */
export function qualify(naming: ToolNaming, server: string, tool: string): string {
  return `${naming.prefix}${server}${naming.separator}${tool}`
}

/** Split at the first separator, preserving the rest of the tool name verbatim. */
export function splitQualified(
  naming: ToolNaming,
  name: string,
): { server: string; tool: string } | null {
  if (!name.startsWith(naming.prefix)) return null
  const body = name.slice(naming.prefix.length)
  const at = body.indexOf(naming.separator)
  if (at <= 0) return null
  const tool = body.slice(at + naming.separator.length)
  if (tool === '') return null
  return { server: body.slice(0, at), tool }
}
