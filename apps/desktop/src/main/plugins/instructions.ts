import { PLUGIN_STATES, type PluginState } from '../../shared/plugin-settings'

/** Verified catalogue purpose plus the lifecycle/broker's current state; never tool names. */
export interface PluginInstructionEntry {
  readonly id: string
  /** Same display name as the Plugins page, when one exists. */
  readonly name?: string
  readonly description?: string
  readonly state: PluginState
  readonly tools: 'all agents' | 'none'
  readonly service: string | null
}
export interface PluginInstructionSource {
  /** A synchronous reading of the controller's current verified catalogue and install state. */
  instructionCatalogue(): readonly PluginInstructionEntry[] | null
}
export const PLUGINS_HEADING = 'Plugins'
export const PLUGIN_SUGGESTION =
  'When an available plugin would help, suggest it; the person installs it in Settings → Plugins.'
export const PLUGIN_TRUST = 'Plugins run with your computer user’s rights; they are not sandboxed.'

const line = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= maximum &&
  !/[\p{Cc}\p{Cs}\u2028\u2029]/u.test(value)

/** No controller means no section. Invalid readings do not invent availability. */
export function readPluginInstructions(
  controller: PluginInstructionSource | undefined,
): readonly PluginInstructionEntry[] | null {
  if (!controller) return null
  try {
    const entries = controller.instructionCatalogue()
    if (
      !Array.isArray(entries) ||
      entries.length > 200 ||
      !entries.every(
        (entry) =>
          entry &&
          typeof entry.id === 'string' &&
          /^[a-z][a-z0-9-]{0,63}$/.test(entry.id) &&
          (entry.name === undefined || line(entry.name, 128)) &&
          (entry.description === undefined || line(entry.description, 240)) &&
          PLUGIN_STATES.includes(entry.state) &&
          ['all agents', 'none'].includes(entry.tools) &&
          (entry.service === null || line(entry.service, 128)) &&
          (entry.state !== 'Available' || (entry.tools === 'none' && entry.service === null)),
      ) ||
      new Set(entries.map((entry) => entry.id)).size !== entries.length
    )
      return null
    return entries.map((entry) => ({ ...entry }))
  } catch {
    return null
  }
}
export function pluginInstructionParagraphs(
  entries: readonly PluginInstructionEntry[],
): readonly string[] {
  return [
    PLUGIN_SUGGESTION,
    PLUGIN_TRUST,
    ...entries.map(
      (entry) =>
        `Plugins: ${entry.name ?? entry.id} — ${entry.state}; tools: ${entry.tools}; service: ${entry.service ?? 'none'}.${entry.description === undefined ? '' : ` ${entry.description}`}`,
    ),
  ]
}
export function pluginInstructionSection(
  entries: readonly PluginInstructionEntry[] | null,
): string | null {
  return entries === null
    ? null
    : `## ${PLUGINS_HEADING}\n\n${pluginInstructionParagraphs(entries).join('\n\n')}`
}
