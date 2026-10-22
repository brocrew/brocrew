import type { Provider } from '@brobot2/shared'
import { DEFAULT_PROFILE_ID, PROVIDER_NAME, foldProfileName } from './runtime-ipc'
import type { AgentIdentity } from './runtime-ipc'

/**
 * 🔴 **What an identity has DONE, and what is still pointing at it** (558, `HO-063` gap 1).
 *
 * ## ⛔ Why the two questions are one record
 *
 * ⚠️ **`HO-063` gap 1 asks for two things that look unrelated** — *"what it has done"* and *"a
 * way to remove one nothing runs"* — ⛔ **and they are the same fold read twice.** A removal is
 * refused by exactly the facts a roster row displays: it has conversations, this app mints the name
 * for itself, or a launch of it is in flight. ⚑ So
 * one record carries both, {@link whatHoldsIt} reads it, and the sentence a person reads before the
 * press and the refusal the door answers with cannot come apart.
 *
 * 🔴 **That is `485`'s rule for a grant's WORDS applied to a removal's REASONS.** The alternative —
 * a roster that computes *may this go* and a door that computes it again — is two derivations of
 * one answer, and `460` F1 is what that costs one screen later.
 *
 * ## ⚠️ It is not on {@link AgentIdentity}, and that is deliberate
 *
 * ⛔ **Every field of `AgentIdentity` is a COLUMN of `agent_identity`.** These are neither: they are
 * counts over two other tables and a fold over the whole population. ⚑ Putting them on the row
 * would make `createAgent`'s and `setCapabilities`' read-backs answer a question about
 * conversations, which neither of those doors asks and neither of them could answer cheaply — and
 * it is `foldersWithoutARow`'s own placement, one field over on {@link AgentIdentities}: *a fact
 * about the population is not a column on a row*.
 */
export interface IdentityUse {
  /** An unfinished filesystem change still holds its recoverable originals. */
  readonly hasUnfinishedMethodChange?: boolean
  readonly hasUnfinishedMemoryChange?: boolean
  readonly isChangingMemory?: boolean

  /**
   * ⛔ **The identity this is about, FOLDED** — the same key {@link AgentIdentity.slug} carries, so
   * a reader joins the two lists on one spelling (238).
   */
  readonly slug: string
  /**
   * 🔴 **How many conversations have ever been recorded as this identity** — `provider_session`
   * rows, every rotation, ended or not.
   *
   * ⛔ **Zero is *nothing has EVER run it*, which is the question `HO-063` gap 1 asks** — not
   * *nothing is running it right now*. ⚠️ A live count would make a removal legal the moment
   * somebody closed a window, and would delete the identity a person had been talking to an hour
   * ago.
   */
  readonly conversations: number
  /**
   * 🔴 **This app mints this name for itself, so a removal would be undone by the next launch.**
   *
   * ⛔ **The front door launches the default profile** — {@link DEFAULT_PROFILE_ID} — and a launch
   * writes the row of the identity it runs as, so removing that one survives exactly until somebody
   * opens a conversation. ⚑ Reporting that as a refusal is the honest answer; letting the press
   * succeed and the row come back is the surface claiming a settlement that did not hold, which is
   * HO-029 §3's shape.
   *
   * ⚠️ **A display fact and not a guard** — it decides what the roster says and whether the removal
   * door refuses, and nothing about what any agent may do.
   */
  readonly thisAppMintsIt: boolean
  /**
   * 🔴 **This host is launching OR running a conversation as it RIGHT NOW** (558, found in review) —
   * every phase; ⚠️ the window before any row exists is the reason it was written, not all it says.
   * *Which* are still starting is {@link isStarting} (`724`).
   *
   * ⛔ **The one referent no foreign key can catch, because the rows do not exist yet.**
   * `store.create` → `identityRowFor` → `writeIdentityRow` runs from `onRegistered`, which is AFTER the
   * provider has been spawned. ⚠️ **Between `createSession` and `onRegistered` an identity a person
   * just created has no session and nothing pointing at it** — so every other reason here is false,
   * a removal succeeds, and `onRegistered`'s `INSERT OR IGNORE` then puts the row back, now unbound
   * from the conversation the person is watching start.
   *
   * 🔴 **That is HO-029 §3's shape reached by a second road** — a surface reporting a settlement
   * that did not hold — and it is why this is a fact the HOST supplies rather than one the ledger
   * carries: it is the only reason here that is not in the database at all.
   *
   * ⚑ **Every phase of a slot counts, not just `starting`.** A live slot's session row already
   * makes {@link conversations} non-zero, so for the REMOVAL this field was written for, including
   * it is redundant and harmless; the rule *this host is running or starting a conversation as it*
   * does not depend on which side of `onRegistered` the answer is taken. ⛔ **724 · and so it is not
   * *"no row says so yet"* for a reader**: it is true of a running conversation too, and a surface
   * that must tell a start from one — `714` F-4, the Team page — needs {@link isStarting} (on the
   * wire since `724`; nothing in the renderer reads it yet — the frontend's).
   */
  readonly isLaunching: boolean
  /**
   * 🔴 **724 · `714` F-4 — a conversation is STARTING as it right now**: a reservation whose provider
   * has not arrived, and that is not on its way out — `AgentCard.state`'s `'starting'` (main), the
   * same two facts. ⚑ Always a subset of {@link isLaunching}, which counts every phase.
   *
   * ⛔ **Measured by `714`**: {@link isLaunching} counts a live slot too, so a launch and a
   * conversation already running were one record, and *"a conversation is starting"* would have
   * claimed a start for a running conversation. ⚑ So a page CAN tell them apart from this; drawing
   * it is the frontend's, and nothing reads it yet.
   *
   * ⚠️ **It includes a Resume, a reopen and a wake** — each reserves a slot the same way — so it says
   * *a conversation is starting*, never *a NEW one*. ⛔ And it is pushed with the roster: `agents` is
   * announced when a start registers, not when it is reserved or refused, so a window learns a start
   * on its next read of this record (as it learns {@link isLaunching}).
   */
  readonly isStarting: boolean
  /** The provider it runs on, and what says so ({@link theProviderOfAnAgent}). */
  readonly runsOn: ItsProvider
}

/** How many of an agent's conversations started on each provider. */
export type StartedOn = Readonly<Record<Provider, number>>

/** No conversation started on any provider. */
export const NONE_STARTED: StartedOn = Object.fromEntries(
  Object.keys(PROVIDER_NAME).map((provider) => [provider, 0]),
) as StartedOn

/**
 * The provider an agent runs on, and what says so: the one saved for it, else the one every
 * conversation of its that started ran on. With neither, nothing names one yet; and when its
 * conversations ran on both, only a person's choice can.
 */
export type ItsProvider =
  | { readonly provider: Provider; readonly from: 'saved' | 'its-conversations' }
  | {
      readonly provider: null
      readonly from: 'its-conversations-differ'
      readonly startedOn: StartedOn
    }
  | { readonly provider: null; readonly from: 'nothing-yet' }

/**
 * An agent keeps its provider: a give never changes it. Its own conversations say what it is when
 * nobody saved one, and a conversation that never started says nothing, so a failed start on the
 * wrong provider cannot move it.
 */
export function theProviderOfAnAgent(saved: Provider | null, startedOn: StartedOn): ItsProvider {
  if (saved !== null) return { provider: saved, from: 'saved' }
  const on = (Object.keys(startedOn) as Provider[]).filter((provider) => startedOn[provider] > 0)
  const [only] = on
  if (on.length === 1 && only !== undefined) return { provider: only, from: 'its-conversations' }
  return on.length === 0
    ? { provider: null, from: 'nothing-yet' }
    : { provider: null, from: 'its-conversations-differ', startedOn }
}

/**
 * 🔴 **Why an identity may not be removed** (558) — a closed vocabulary, as a value, so the surface
 * that explains a disabled control and the door that refuses the press are derived from one list.
 *
 * ⛔ **Every member is a fact a removal would BREAK, not a preference.** ⚑ **Only one of them the
 * database itself refuses** — `conversations`: `provider_session.agent_identity_id` is
 * `NO ACTION`, so a bare `DELETE` raises. ⚠️ The
 * others nothing would catch: the front door's profile is a code constant, and a launch in flight
 * has written no row yet at all.
 *
 * 🔴 **The COUNT is asserted** — `every-identity-he-has.test.ts` §3 — because a number in prose is
 * what goes stale when a list moves (`a-number-can-survive-the-death-of-its-derivation`).
 */
export const WHAT_HOLDS_AN_IDENTITY = [
  'conversations',
  'this-app',
  'a-launch',
  'unfinished-method-change',
  'unfinished-memory-change',
  'memory-change-in-flight',
] as const

/** One of {@link WHAT_HOLDS_AN_IDENTITY}. */
export type WhatHoldsAnIdentity = (typeof WHAT_HOLDS_AN_IDENTITY)[number]

/**
 * ⛔ **What each reason says to a person, in one place** (558) — `485`'s rule: the words a surface
 * draws and the words a refusal carries are one table, never two.
 *
 * ⚠️ **Each sentence says what would BREAK, not that the app declines.** *"Conversations have run
 * as it"* is a fact about the database; *"you may not do that"* would be a policy nobody wrote.
 */
export const HOLDING_SAYS: Readonly<Record<WhatHoldsAnIdentity, string>> = {
  conversations: 'conversations have run as it, and their record names it',
  'this-app': 'this app ships this name, so the next launch would bring it back',
  'a-launch': 'a conversation is starting as it right now',
  'unfinished-method-change': "a change to its saved methods didn't finish and needs checking",
  'unfinished-memory-change': "a change to its memory didn't finish and needs checking",
  'memory-change-in-flight': 'a change to its memory is still running',
}

/**
 * 🔴 **What is still holding this identity here — empty means nothing is** (558).
 *
 * ⛔ **The ONE derivation**, read by the roster to explain a control and by
 * `RuntimeHost.removeAgent` to refuse a press. ⚠️ **Order is {@link WHAT_HOLDS_AN_IDENTITY}'s**, so
 * two callers listing the reasons cannot list them differently.
 */
export function whatHoldsIt(use: IdentityUse): readonly WhatHoldsAnIdentity[] {
  const held: WhatHoldsAnIdentity[] = []
  if (use.conversations > 0) held.push('conversations')
  if (use.thisAppMintsIt) held.push('this-app')
  if (use.isLaunching) held.push('a-launch')
  if (use.hasUnfinishedMethodChange) held.push('unfinished-method-change')
  if (use.hasUnfinishedMemoryChange) held.push('unfinished-memory-change')
  if (use.isChangingMemory) held.push('memory-change-in-flight')
  return held
}

/** ⚑ Nothing points at it, so a removal would take nothing with it. */
export function nothingHoldsIt(use: IdentityUse): boolean {
  return whatHoldsIt(use).length === 0
}

/**
 * 🔴 **What the database knows about one identity's history** (558) — the store's half of
 * {@link IdentityUse}, before the two facts that are folds over the roster itself.
 *
 * ⛔ **One grouped statement and no per-identity scan.**
 */
export interface IdentityHistory {
  /** `aid:<folded slug>` — the row id, which is what the statement groups by. */
  readonly identityId: string
  /** `provider_session` rows recorded as it. */
  readonly conversations: number
  /** Those of them that started — their provider named a thread to resume — on each provider. */
  readonly startedOn: StartedOn
}

/**
 * 🔴 **Would this app write this identity's row again if it were removed?** (558; D-014.)
 *
 * ⛔ **Only for the profile the front door launches** — {@link DEFAULT_PROFILE_ID}, folded, because
 * `Default` and `default` are one identity (238). ⚑ That is the fact that makes *the next launch
 * would bring it back* true, and it is a display fact: it names no rule about what any agent may
 * do.
 */
export function thisAppWouldMintIt(profileSlug: string): boolean {
  return foldProfileName(profileSlug) === DEFAULT_PROFILE_ID
}

/**
 * 🔴 **The fold that makes {@link IdentityUse} out of the roster and its history** (558) — PURE, so
 * the same answer is reachable from a test without a database.
 *
 * ⛔ **Every identity gets exactly one entry and nothing else does.** A history row naming an id no
 * identity carries is DROPPED rather than reported: the foreign key behind it is `NO ACTION`, so
 * the database refuses to let that state exist, and inventing a roster entry for one would make
 * this list disagree with `agentIdentities`' own — which is the one thing a surface joining them by
 * slug cannot survive. ⚑ An identity with no history at all gets an entry saying so, which is the
 * population this exists for.
 */
export function identityUse(
  identities: readonly AgentIdentity[],
  history: readonly IdentityHistory[],
  /**
   * ⚑ **Folded slugs of the identities this host is launching or running as**
   * (`RuntimeHost.launchesByIdentity`) — a member is {@link IdentityUse.isLaunching}.
   */
  launching: ReadonlySet<string>,
  /**
   * ⚑ **724 · the same, for the launches still STARTING** (`RuntimeHost.identityUseNow`) — a member
   * is {@link IdentityUse.isStarting}.
   */
  starting: ReadonlySet<string>,
): readonly IdentityUse[] {
  const byId = new Map(history.map((one) => [one.identityId, one]))
  return identities.map((identity) => {
    const mine = byId.get(identity.id)
    return {
      slug: identity.slug,
      conversations: mine?.conversations ?? 0,
      thisAppMintsIt: thisAppWouldMintIt(identity.slug),
      // ⛔ **Folded by the CALLER**, which is `RuntimeHost.launchesByIdentity` — a slot keeps the
      // spelling its launcher typed, and the roster's slugs are folded by a database constraint.
      isLaunching: launching.has(identity.slug),
      isStarting: starting.has(identity.slug),
      runsOn: theProviderOfAnAgent(identity.provider, mine?.startedOn ?? NONE_STARTED),
    }
  })
}

/**
 * 🔴 **What removing an identity did, or why it did nothing** (558).
 *
 * ⛔ **A refusal payload rather than a `boolean`, and `removeExternalMcpServer` is the precedent it
 * departs from on purpose.** That verb's only failure is *no such row*, which `false` says
 * completely. ⚠️ This one has several ways to be refused and a person pressing the control is owed
 * which — `425`'s rule that a refusal carries its remedy, where the remedy is *end the
 * conversations* or *wait for the launch*.
 */
export type AgentRemoved =
  | { readonly ok: true; readonly slug: string }
  /** ⛔ Criterion 12, the removal direction: a name with no row is not a thing to un-create. */
  | { readonly ok: false; readonly rail: 'no-such-agent' }
  /** ⚠️ {@link whatHoldsIt}, verbatim and never re-derived. Non-empty by construction. */
  | {
      readonly ok: false
      readonly rail: 'it-is-still-held'
      readonly held: readonly WhatHoldsAnIdentity[]
    }

/**
 * ⛔ **What a person is told BEFORE the press** (558) — `EXTERNAL_MCP_REMOVAL_MEANS`' own rule, one
 * noun over: the second thing a removal does is said in front of the control, not after it.
 *
 * ⚠️ **It says what removal does NOT reach, because that is the half a person cannot see.** The
 * folder this app keeps for an identity is its memory, and this app does not delete a person's
 * bytes — see `keeping-a-credential-only-a-person-can-replace`. A row can be made again; what is
 * in that folder cannot.
 *
 * ⛔ **It says *its folder*, and 151's register is why.** *"Name the two programs, call the thing a
 * folder"* — `provider-home-words.test.ts` is the rail, and a sentence a person reads may not use
 * this repo's own word for a directory.
 */
export const AGENT_REMOVAL_MEANS =
  'Removing an agent takes its row and the server grants on it. Its Claude and Codex folders stay ' +
  'on disk, and creating the same name again picks them back up.'
