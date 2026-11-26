import type { AgentIdentities, AgentIdentity } from '../../src/shared/runtime-ipc'
import type { IdentityUse } from '../../src/shared/agent-roster'

/**
 * Card 607 · the agent identities DOM tests hand a screen, built one way. Each builder carries the
 * shipped defaults and nothing else, so a test states only the facts its case is about.
 */

/**
 * One identity as the roster reads it: `aid:<slug>`, no name, no provider, no grants, and nobody
 * recorded as its maker (598). ⚑ `createdAt` is a fixed instant; a surface that draws an age passes
 * its own.
 */
export const anIdentity = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName: null,
  createdAt: 1_700_000_000_000,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  ...over,
})

/** What the roster says an identity is doing: no conversations, and nothing it runs on yet. */
export const aUse = (slug: string, over: Partial<IdentityUse> = {}): IdentityUse => ({
  slug,
  conversations: 0,
  thisAppMintsIt: false,
  isLaunching: false,
  isStarting: false,
  runsOn: { provider: null, from: 'nothing-yet' },
  ...over,
})

/**
 * The roster a window reads: these identities and their uses, no folder without a row, `ask` as the
 * launch default (500), and an empty server registry (516), which is a real answer.
 */
export const aRoster = (
  identities: AgentIdentity[],
  use: IdentityUse[] = [],
  over: Partial<AgentIdentities> = {},
): AgentIdentities => ({
  identities,
  foldersWithoutARow: [],
  use,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
  ...over,
})

/**
 * ⚠️ **An identity row cut to the three fields a name is read from** — id, slug and display name —
 * for the surfaces that read nothing else. It is not a whole {@link AgentIdentity}; the cast says so.
 */
export const aNameRow = (slug: string, displayName: string | null): AgentIdentity =>
  ({ id: `aid:${slug}`, slug, displayName }) as unknown as AgentIdentity
