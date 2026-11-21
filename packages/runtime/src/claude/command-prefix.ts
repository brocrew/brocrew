import { providerDescriptor } from '@brobot2/shared'
import type { CompactResult, SessionHandle } from '../runtime'

export const CLAUDE_COMMAND_PREFIX = providerDescriptor('claude').commandPrefix

/** The CLI's own `/compact`, when it lists one, with the words as its instructions. */
export async function claudeCompact(
  handle: Pick<SessionHandle, 'send' | 'providerCommands'>,
  instructions?: string,
): Promise<CompactResult> {
  const { commands } = await handle.providerCommands!()
  if (!commands.some((command) => command.name === 'compact' && command.skill === undefined))
    return { compacted: false, reason: 'Claude lists no compact command for this conversation.' }
  const words = instructions?.trim()
  await handle.send(words ? `/compact ${words}` : '/compact')
  return { compacted: true }
}
