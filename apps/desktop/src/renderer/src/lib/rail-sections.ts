import type { AgentIdentity } from '../../../shared/runtime-ipc'
import { agentName, DEFAULT_PROFILE_ID, foldProfileName } from '../../../shared/runtime-ipc'

/**
 * # ⚑ The rail's two sections — BroBot's conversations, then every other agent's
 *
 * Split conversations into collapsible BroBot and other-agent sections, preserving list order within each and placing BroBot first.
 *
 * ⚑ **One list, cut in two by one fact**: whether BroBot runs the conversation. Each section keeps
 * the one list's order (newest first) and its rows; this file decides which section a row is in,
 * once per row, and the rail carries the answer on the row.
 */

/** The sections, in the order the rail draws them: BroBot's first. */
export const RAIL_SECTIONS = ['brobot', 'agents'] as const

export type RailSectionKey = (typeof RAIL_SECTIONS)[number]

/**
 * ⚑ **The section a conversation's row is in, from the profile it runs as.**
 *
 * ⛔ **Compared in ONE spelling, the one `agentName` names a row by**: a profile is the directory
 * spelling a person typed (`BroBot`, `brobot`), folded by {@link foldProfileName} — the fold every
 * name on a row already goes through — so one identity is never in both sections.
 *
 * ⛔ **No profile is NOT BroBot's.** `null` (or a fixture's missing field) is a conversation this app
 * ran as nobody — a person's own, found in a provider's folder or restored from a bundle — or a record
 * the host has not answered for yet; calling either BroBot's would invent an identity (154), so it
 * goes under the other agents. ⚠️ This is deliberately not `agentName`'s `?? DEFAULT_PROFILE_ID`: that
 * default is for a pre-profiles ROW, which the host list hands over already resolved
 * (`ListedConversation.identity`).
 */
export function railSectionOf(profile: string | null | undefined): RailSectionKey {
  if (profile === null || profile === undefined) return 'agents'
  return foldProfileName(profile) === DEFAULT_PROFILE_ID ? 'brobot' : 'agents'
}

/**
 * ⚑ **What each section's header says** — BroBot's by the name every row of it carries
 * ({@link agentName}: `BroBot`, or the name a person gave it), and the other agents' as a group.
 */
export function railSectionHeading(
  key: RailSectionKey,
  identities: readonly AgentIdentity[] | null,
): string {
  return key === 'brobot' ? agentName(DEFAULT_PROFILE_ID, identities) : 'Other agents'
}

/**
 * ⚑ **Where each section remembers whether it is open** — a per-viewer view preference, kept the
 * way the drawer keeps its own (`usePersistentToggle`), and nothing another window or viewer reads.
 */
export const RAIL_SECTION_REMEMBERED: Readonly<Record<RailSectionKey, string>> = {
  brobot: 'brobot2.railBroBotOpen',
  agents: 'brobot2.railOtherAgentsOpen',
}
