import type { PluginBeforeTurnResult, PluginTitleCandidate } from '../../shared/plugin-contract'
import { pieceLink } from '../../shared/links'

/** Titles and destinations come from the current store snapshot, never from plugin prose. */
export function pluginTitlesBlock(
  candidates: readonly PluginTitleCandidate[],
  result: PluginBeforeTurnResult,
): string {
  const selected = new Set(
    result.pointers.map((pointer) => JSON.stringify([pointer.resourceId, pointer.version])),
  )
  const lines = candidates
    .filter((item) => selected.has(JSON.stringify([item.resourceId, item.version])))
    .map(
      (item) =>
        `- ${pieceLink(item.pieceId, 'File', item.title.replace(/[\r\n]/g, ' '))} — resource ${item.resourceId}, version ${item.version}`,
    )
  return lines.length
    ? `Suggested file titles (open a resource with read_document):\n${lines.join('\n')}`
    : ''
}
export function withPluginTitles(text: string, block: string): string {
  return block ? `${block}\n\n${text}` : text
}
