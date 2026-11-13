import type { AgentIdentity } from '../agent-identity-contracts'
import type { IdentityUse } from '../agent-roster'
import type { ExternalMcpServerRow } from '../external-mcp'
import type { Provider } from '@brobot2/shared'

export type AgentIdentityName = Pick<AgentIdentity, 'id' | 'slug' | 'displayName'>

/**
 * 🔴 **What a person or an agent supplies to bring an identity into existence** (419, HO-023 §2.4).
 *
 * ⛔ **A slug, and two facts that are each optional and each *nobody has said* when absent.** It
 * takes no project, no provider home, no capabilities and no cwd: HO-010 ruling 6 is global-only
 * identity, capabilities are granted afterwards through the surface that already exists for them,
 * and a home is laid down by the first LAUNCH — see `RuntimeHost.createAgent` for what creation
 * deliberately does NOT write.
 *
 * ⚠️ **`null` rather than absent on both optional fields**, which is 339's `.nullable()` ruling:
 * an absent key and an explicit null are the same value to a `Partial` and are not the same intent,
 * so every caller says what it means about all three.
 */
export interface NewAgent {
  /** The name. Folded before it is written (`agent_identity_slug_folded_ck`), and globally unique (`agent_identity_slug_uq`). */
  readonly slug: string
  /** A human name for it, or null — nobody has named it. */
  readonly displayName: string | null
  /** Which provider its next conversation runs on, or null — nobody has said. */
  readonly provider: Provider | null
  /**
   * Made a service: one conversation its callers share, which runs their work one piece at a time.
   * Absent, it is a normal agent. ⛔ Refused while services are off.
   */
  readonly asAService?: true
}

/**
 * **Everything the grant surface needs in one read** (355).
 *
 * ⚠️ **`foldersWithoutARow` is a real state and this is where it is said out loud** (§4 of the
 * dispatch). A person who typed a name into the launcher and whose launch was refused has a
 * directory and no identity; `setCapabilities` answers `false` for it, and a list that silently
 * omitted it would leave them looking for an agent they can see on disk. ⛔ It is REPORTED and not
 * repaired: viewing a profile may not bring its row into being.
 */
export interface AgentIdentities {
  readonly identities: readonly AgentIdentity[]
  readonly foldersWithoutARow: readonly string[]
  /**
   * 🔴 **What each identity has DONE, and what is still pointing at it** (558, `HO-063` gap 1) —
   * one entry per member of {@link identities}, and nothing else.
   *
   * ⛔ **Beside the rows rather than on them**, which is {@link foldersWithoutARow}'s own placement
   * one field up: every field of {@link AgentIdentity} is a COLUMN of `agent_identity`, and these
   * are counts over two other tables plus a fold over the whole population. ⚑ Folding them onto
   * the row would make `createAgent`'s and `setCapabilities`' read-backs answer a question about
   * conversations, which neither door asks.
   *
   * ⚠️ **It is what `HO-063` gap 1 asks for twice.** *"What it has done"* is
   * {@link IdentityUse.conversations}; *"a way to remove one nothing runs"* is `whatHoldsIt` read
   * over the same record — so the sentence a person reads before the press and the refusal
   * `RuntimeHost.removeAgent` answers with are one derivation.
   */
  readonly use: readonly IdentityUse[]
  /** The global kill switch (341, HO-005 criterion 7). Absence of the row reads `false`. */
  readonly spawningEnabled: boolean
  /** A person has turned services on in this workspace; absent, they are off. */
  readonly servicesOn?: true
  /** The agents that are services, by slug; absent when none is. */
  readonly services?: readonly string[]
  /**
   * 🔴 **The mode a conversation a PERSON starts begins in** (500, HO-036 §3.1) — the second value
   * on `app_policy`, and the second thing on this object that is about nobody in particular.
   *
   * ⛔ **Absence of the row, a NULL, and a word this build cannot read all answer `'ask'`** — the
   * store's fold closes towards the mode that still asks, which is the opposite direction from
   * `spawningEnabled`'s `false` and the same reasoning.
   *
   * ⚠️ **It is a launch default and nothing else reads it.** It does not describe any conversation
   * on this object, it cannot move one that is running, and no spawn ever sees it: the two doors a
   * person presses resolve it in the renderer and put the answer on the wire as an ordinary
   * `approvalMode`.
   */
  /** Whether the launch default was explicitly saved, rather than the safe fallback. */
  readonly defaultApprovalModeChosen?: boolean
  readonly defaultApprovalMode: 'ask' | 'auto'
  /**
   * 🔴 **Every external MCP server a person has registered** (516) — GLOBAL, and since 524 each row
   * says who it is for ({@link ExternalMcpServerRow.reach}).
   *
   * ⛔ **On this object rather than behind a verb of its own**, because the registry and the grants
   * are read together or not at all: a sheet drawing tick-boxes needs the rows AND the ids, and two
   * reads could disagree about a server removed between them. ⚑ `507` §5 proposed exactly this —
   * *"`agentIdentities` can return the global rows and each identity's granted IDs"*.
   *
   * ⚠️ **Empty is the normal answer**: `0032` creates the table empty and no migration seeds it.
   * ⛔ **There is no `brobot` row here and there never will be** — BroBot2's own in-process server is
   * product plumbing with no URL to store (`507` §2.3).
   */
  readonly externalMcpServers: readonly ExternalMcpServerRow[]
}
