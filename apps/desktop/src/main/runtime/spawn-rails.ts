import type { WorkerBindingReading } from '../../shared/worker-reading'
import { DONE_CONDITION_CHARS, WORK_BRIEF_CHARS, WORK_FIELD_WORDS } from '../../shared/work-fields'
import { refusalReason } from '../../shared/refusals'
import { isAbsolute, join } from 'node:path'
import type { GivenFolder } from '../../shared/work-folders'
import { z } from 'zod'
import { providerSchema, type Provider } from '@brobot2/shared'
// 🔴 **D-038 · the one derivation `wider-than-its-parent` is** — see
// {@link WHAT_STANDS_PAST_ITS_FOLDER}. ⚑ A VALUE import, and the only one this module takes from
// `@brobot2/runtime`; the comparison has to read the table the disclosure's sentence is censused
// against (its `ask` row less its `auto` row is what `auto` takes off), or the rail and the
// sentence a person read at the moment they chose the mode would be two copies of one fact.
import { whatTheChildWouldLack, type ApprovalMode, type Protection } from '@brobot2/runtime'
import { DEFAULT_CAPABILITIES, type ProfileCapabilities } from '../db/session-store'
import {
  PATH_SEGMENT_RULE,
  PROVIDER_NAME,
  foldProfileName,
  isPathSegment,
  type IdentityCreator,
} from '../../shared/runtime-ipc'
import type { ItsProvider, StartedOn } from '../../shared/agent-roster'
import { PIECE_TITLE_CHARS } from '../../shared/piece-called'
import { MAX_RESOURCES_PER_REPLY } from '../../shared/documents'
import { type AgentModelChoice, type WhereItCameFrom } from '../../shared/model-choice'
import type { RailPermanence, RefusalRemedy } from '../../shared/refusals'
import { undrivenSentence, type TaskStallCause } from '../../shared/tasks'
// ⚠️ **Type-only, and it has to stay that way.** `runtime-host.ts` imports this module for real, so
// a value import back would be a runtime cycle; `CallerIdentity` is erased at compile time and the
// two files stay one-directional.
import type { CallerIdentity, TellDelivery } from './runtime-host'
import type { MessageRefusal } from './message-rails'
import type { ResourceRefusal } from '../resources/resources'
import type { ModelRefusal } from './model-rails'

/**
 * 🔴 **D-016 · the rails of the GIVE — `give_work`'s, asked before anything can be written** (341's
 * door, re-purposed: a conversation is started only by a give that found none).
 *
 * ⛔ **The ordering ruling this file exists to honour** (341 §0). *"Tools and rails together. **Not
 * tools first.**"* The published tool adds no rail of its own — it hands the arguments to the host,
 * which asks {@link admitGive}, and every refusal below is decided here, against facts the host
 * supplies.
 *
 * ## ⚑ What a refusal IS here, and why it is not a `SessionUnavailable`
 *
 * HO-005 criterion 4, as the PO refined it: *"the refusal is a **successful call** whose payload
 * names the rail, its permanence and whether it is retryable — and the rail holds regardless of what
 * the model does with it."* So a {@link SpawnRefusal} is **data returned**, not an error thrown,
 * written for an agent that must decide what to do next.
 *
 * ## 🔴 The order the rails are asked in (D-016 · R2), and why it is not arbitrary
 *
 *  1. **The request shape** — a request that cannot be read is one no rule below can be applied to
 *     (`303` B: eight keys in, seven out, an agent asked for something else).
 *  2. **The piece it is given under** — the caller's own, named, or inferred: the one open piece
 *     that has reached it, of several the one its turn drives, else its root (D-022 · R4). ⛔ A
 *     piece the caller does not hold is answered as one that does not exist: one answer, so no id
 *     is an oracle.
 *     ⚠️ A caller that speaks as no conversation holds none: `RuntimeHost.giveWork` answers it
 *     `no-piece-to-give-from` before these are asked.
 *  3. **`may-not-assign-work`** — the grant a person sets on giving (`can_assign_work`), asked of the
 *     caller alone.
 *  4. **Depth** — six below the work a person gave, counted on `work`, or the giver's own
 *     `max_depth`.
 *  5. **The lookup** — the one conversation this giver has with that agent, over reservations in
 *     flight and rows alike ({@link GiveFacts.helperAs}). ⚠️ It is not a rail: it finds, and a give
 *     that finds one goes there, woken if it has stopped.
 *  6. **No stall rule**: a piece of this giver's that stalled there refuses nothing. The host
 *     names it in the give's answer, read as the answer is formed, with its cause, a follow-up and a
 *     take-back.
 *  7. **Only when nothing was found**, the rails of a START: the spawning switch, `can_create_agents`
 *     for a new agent, `wider-than-its-parent`, the profile rule (D-016 · R3), then the folder — the
 *     one clause that touches the disk, and asked only for a conversation that will work in it.
 *
 * ⛔ **Nothing is written on any path through {@link admitGive}.** A new agent's identity row, the
 * number the piece takes and the conversation's reservation all come after it, in the host's one
 * synchronous stretch — so a give refused by any rail leaves no row behind (R2).
 *
 * ⚠️ **The spawning switch is asked late, and that is ruling 12**: it refuses a give only when the
 * give would START a conversation, so work to an agent this giver already has goes on while a person
 * has switched starting off. ⚑ It is still asked before anything about the agent's row, so what it
 * answers is a fact about the app and not about the name.
 */

/**
 * The rails, as a closed vocabulary. Derived-from-the-list types, `session-unavailable.ts`'s rule:
 * a rail cannot reach the type without appearing in the list a test walks.
 */
export const SPAWN_RAILS = [
  /**
   * 🔴 **The request did not parse** (HO-005 criterion 10, from `303` B).
   *
   * ⛔ **`.strict()` is the whole of this rail.** Zod's default is to STRIP unknown keys, which is
   * `303`'s defect exactly: a key we do not know is a caller believing something about this door
   * that is not true, and the only honest answer is to refuse the call.
   */
  'malformed-request',
  /**
   * ⚑ **The caller holds no root, and no open piece that has reached it** (D-022 · R4) — nothing to
   * hang a give under.
   */
  'no-piece-to-give-from',
  /**
   * ⚑ **Two or more open pieces besides its root have reached it, it named none, and the turn it is
   * in drives none of them alone** — the detail lists theirs; a root is inferred only when none has
   * reached it (D-016 · commit 6 · R2; D-022 · R4).
   */
  'name-the-piece-you-give-from',
  /**
   * ⛔ **The piece it named is not one it holds** — unknown, closed, or somebody else's: one answer,
   * so no label or id a caller spells tells it which pieces exist.
   */
  'no-piece-you-hold-by-that-name',
  /** The piece would sit deeper below the work a person gave than the giver's `max_depth` allows. */
  'too-deep',
  /** The agent is a service, and services don't run in this version. */
  'services-are-off',
  /** Whether the agent is a service can't be told, and a service may be at stake. */
  'its-kind-is-unknown',
  'worker-binding-is-unknown',
  'parallel-not-for-a-service',
  'service-provider-is-fixed',
  'no-free-worker-at-capacity',
  'no-room-for-provider-conversation',
  /** The agent is a service, and the giver is that service's one conversation. */
  'that-is-this-conversation',
  /** The service already waits, through work it gave, on the giver: the piece would never be reached. */
  'it-would-wait-on-itself',
  /** Whether the service waits on the giver can't all be checked: it reaches too much open work. */
  'its-waits-cannot-all-be-checked',
  /** Whether the service waits on the giver can't be checked: a record it reaches can't be read. */
  'its-record-cannot-be-read',
  /**
   * 🔴 **D-016 · R3 — the give asked for a NEW agent under a name that is already one.** ⛔ Reusing
   * it would hand the caller an agent with a memory when it asked for a fresh one; the sentence says
   * to give without `new` to use the agent that exists.
   */
  'that-profile-exists',
  /**
   * ⛔ **The global switch is off, and this give would have started a conversation** (criterion 7;
   * ruling 12). One row, app-wide — `schema.ts`'s `appPolicy`.
   */
  'spawning-disabled',
  /**
   * ⚑ **The caller may not bring a new agent into existence** (`can_create_agents`) — asked only of a
   * give that asked for one with `new`. The same word `create_agent` answers.
   */
  'may-not-create-agents',
  /**
   * 🔴 **The conversation this give would start would act past its folder with nobody asked, where
   * the giver is still asked or confined** (499, HO-036; D-038).
   *
   * ⛔ **It is a COMPARISON of REACH**: what each conversation keeps between a write or a command
   * past its folder and that act running unasked — the card on Claude `ask`, the card AND an OS
   * sandbox on Codex `ask`, nothing in `auto` on either — {@link whatTheChildWouldLack}, one
   * derivation; a read and a server's tool are not compared, and `approval-mode.ts` says what each
   * `ask` does with them. 🔴 **Not what each mode REMOVES** (F050): Claude never had a sandbox to
   * take off, so a Claude `auto` giver's Codex `auto` helper reaches no further than its giver, and
   * is given.
   *
   * ⚠️ **No give meets it today.** A conversation a give starts runs in its giver's mode, and a
   * same-mode pair is never wider: `ask` keeps something past its folder on both providers, `auto`
   * nothing on either. ⏸ It stands as the guard on that inheritance; whether it stays, and whether
   * a Claude `ask` giver's Codex `ask` helper becomes its one pair, are held for a ruling (D-038
   * F-A, F-B): that helper writes and runs commands in its folder, reads outside it and runs a
   * server tool its server marks read-only, all with nobody asked.
   */
  'wider-than-its-parent',
  /**
   * 🔴 **D-016 · R3 — no agent by that name, and the give did not ask for a new one.** ⛔ A typo is
   * not a new agent: creating one would mint a durable identity with an empty memory for a misspelt
   * argument. The sentence names `list_profiles` and `new: true`.
   */
  'no-such-profile',
  /**
   * The agent has no provider saved and its conversations ran on both, so only a person can say which
   * one its new conversation starts on.
   */
  'its-provider-is-not-chosen',
  /**
   * ⛔ **The folder a new conversation would work in is not usable** (HO-005 criterion 11).
   *
   * ⚑ **`339` owns this rule and this rail CALLS it** — `checkSessionCwd`, through the same
   * `RuntimeHost.checkCwd` seam the folder picker uses: it exists, it is a directory, and it can be
   * entered. ⚠️ Asked only when a give starts a conversation; one that exists works in its own.
   */
  'folder-unusable',
] as const

export type SpawnRail = (typeof SPAWN_RAILS)[number]

/**
 * **How long the refusal is expected to be true for** — the fact HO-005 criterion 4 asks the payload
 * to carry, and the one a model has to reason about.
 *
 * ⚑ **Defined in `shared/refusals.ts` since `405` and re-exported here**, because the RENDERER draws
 * the word too; the other doors in `runtime/` import it from this module.
 */
export type { RailPermanence } from '../../shared/refusals'

/**
 * ⛔ **One table, so `permanence` and `retryable` cannot disagree** (341). They are two views of one
 * fact; `retryableOf` derives the second from the first.
 */
const PERMANENCE: Readonly<Record<SpawnRail, RailPermanence>> = {
  'malformed-request': 'permanent',
  // ⚑ **The caller's own holdings, and the act is naming a piece**: a name resolves among every
  // piece it holds, even one whose brief has not reached it yet. ⚠️ Either may clear for a LATER
  // turn's call — a piece held for it reaches it once its turn ends, and another turn may drive one
  // of several (D-022 · R4) — but waiting for a held piece or another turn is never the act.
  'no-piece-to-give-from': 'permanent',
  'name-the-piece-you-give-from': 'permanent',
  'no-piece-you-hold-by-that-name': 'permanent',
  // 🔴 **`until-a-person-changes-it`** (486): `max_depth` is a COUNT on the grant sheet, and the
  // depth is fixed by where the caller sits — every piece it holds is at its chain's depth, work a
  // person gave counting as 0 wherever it hangs (D-016 · commit 6) — so there is no change to the
  // call that moves it.
  'too-deep': 'until-a-person-changes-it',
  'services-are-off': 'until-a-person-changes-it',
  'its-kind-is-unknown': 'until-a-person-changes-it',
  'worker-binding-is-unknown': 'until-a-person-changes-it',
  'parallel-not-for-a-service': 'permanent',
  'service-provider-is-fixed': 'permanent',
  'no-free-worker-at-capacity': 'while-this-holds',
  'no-room-for-provider-conversation': 'until-a-person-changes-it',
  'that-is-this-conversation': 'permanent',
  'it-would-wait-on-itself': 'while-this-holds',
  'its-waits-cannot-all-be-checked': 'while-this-holds',
  // ⚑ **`permanent`**: a row that can't be read stays so, and the ledgers the check reads include
  // those of work that has ended, so no give to that service can clear it.
  'its-record-cannot-be-read': 'permanent',
  'that-profile-exists': 'permanent',
  'spawning-disabled': 'until-a-person-changes-it',
  'may-not-create-agents': 'until-a-person-changes-it',
  // 🔴 **`until-a-person-changes-it`** (499): the giver's own approvals button makes the identical
  // call succeed.
  'wider-than-its-parent': 'until-a-person-changes-it',
  'no-such-profile': 'permanent',
  'its-provider-is-not-chosen': 'until-a-person-changes-it',
  'folder-unusable': 'until-a-person-changes-it',
}

export function permanenceOf(rail: SpawnRail): RailPermanence {
  return PERMANENCE[rail]
}

/**
 * **Would the identical call ever succeed on its own?**
 *
 * ⛔ **Only `while-this-holds` is retryable**, and `until-a-person-changes-it` deliberately is not:
 * a switch nobody has thrown does not throw itself.
 */
export function retryableOf(rail: SpawnRail): boolean {
  return permanenceOf(rail) === 'while-this-holds'
}

/**
 * 🔴 **425 · what the caller may do instead** (HO-023 §2.2).
 *
 * ⛔ **Exhaustive, so a new rail fails to compile until somebody has answered *what is left for the
 * caller to do*.** ⚑ A service's waits have an act: the same give, once that work has ended.
 */
const REMEDY: Readonly<Record<SpawnRail, RefusalRemedy | null>> = {
  'malformed-request': null,
  'no-piece-to-give-from': null,
  'name-the-piece-you-give-from': null,
  'no-piece-you-hold-by-that-name': null,
  'too-deep': null,
  'services-are-off': null,
  'its-kind-is-unknown': null,
  'worker-binding-is-unknown': null,
  'parallel-not-for-a-service': null,
  'service-provider-is-fixed': null,
  'no-free-worker-at-capacity': 'make-the-same-call-when-this-settles',
  'no-room-for-provider-conversation': null,
  'that-is-this-conversation': null,
  'it-would-wait-on-itself': 'make-the-same-call-when-this-settles',
  'its-waits-cannot-all-be-checked': 'make-the-same-call-when-this-settles',
  'its-record-cannot-be-read': null,
  'that-profile-exists': null,
  'spawning-disabled': null,
  'may-not-create-agents': null,
  'wider-than-its-parent': null,
  'no-such-profile': null,
  'its-provider-is-not-chosen': null,
  'folder-unusable': null,
}

/** ⛔ **What a caller may do instead, or `null` because this app does not know of anything** (425). */
export function remedyOf(rail: SpawnRail): RefusalRemedy | null {
  return REMEDY[rail]
}

/**
 * The facts a refusal may state beyond the rail itself, carried as DATA.
 *
 * ⚠️ **Kept apart from the sentence for `UnavailableContext`'s reason** (100): recovering a fact by
 * matching it out of prose makes the wording load-bearing.
 */
export interface SpawnRefusalDetail {
  /** The agent the give named — the KEY. */
  profileId?: string
  /** The piece the caller named, as it spelled it — echoed back, never what the app found. */
  piece?: string
  /**
   * `name-the-piece-you-give-from` — the labels of the open pieces that have reached the caller, its
   * root left out (D-022 · R4).
   */
  held?: readonly string[]
  /** `too-deep` — the label of the piece the give would have hung under. */
  label?: string
  /** `too-deep` — the depth the piece would have sat at, and the deepest the giver may give to. */
  depth?: number
  maxDepth?: number
  /**
   * 🔴 **`wider-than-its-parent`'s three facts** (499; D-038) — the mode the new conversation would
   * start in (the giver's own), the giver's, and **what the giver keeps past its folder that the
   * new one would not**. ⚑ Words from `PROTECTIONS`, so the payload carries no sentence a test
   * cannot reach.
   */
  asked?: ApprovalMode
  spawnerRunsAs?: ApprovalMode
  wouldLack?: readonly Protection[]
  /** The service's fixed provider and its current model list, for a different-provider refusal. */
  provider?: Provider
  choices?: readonly string[]
  /** `its-provider-is-not-chosen` — how many of its conversations started on each provider. */
  startedOn?: StartedOn
  /** `folder-unusable`'s reason, which is `checkSessionCwd`'s own sentence and names the directory. */
  folderReason?: string
  /** `malformed-request`'s parse failure, flattened to something a caller can act on. */
  problems?: readonly string[]
  /**
   * `malformed-request` — the fields sent that the tool does not take, as the caller spelled them.
   * ⛔ Their names never reach the record: a refusal's row keeps problems only without them.
   */
  unknownFields?: readonly string[]
}

/**
 * 🔴 **A refusal, as a payload rather than a throw** — HO-005 criterion 4's shape, fixed here and
 * carried over MCP unchanged by the tools dispatch.
 */
export interface SpawnRefusal {
  readonly rail: SpawnRail
  readonly permanence: RailPermanence
  readonly retryable: boolean
  /** What to say. Names the rule and, where there is one, the thing to do instead. */
  readonly reason: string
  /** ⛔ **425 · the same thing as a WORD, or `null`** — one of `REFUSAL_REMEDIES`. */
  readonly remedy: RefusalRemedy | null
  readonly detail: SpawnRefusalDetail
}

/**
 * ⛔ **Each protection, as the clause a giver reads about ITSELF inside `wider-than-its-parent`'s
 * sentence** (499; D-038). ⚑ The VOCABULARY is shared and the WORDING is this door's.
 * 🔴 **Exhaustive over the type**, so a third protection cannot be added without somebody deciding
 * what a caller is told about it.
 */
const PROTECTION_SAID: Readonly<Record<Protection, string>> = {
  'the-card-before-an-act': 'the card before you act',
  'the-sandbox-around-an-act': 'the sandbox around what you run',
}

/** ⚑ `W1.2, W1.3 and W1.5` — the labels a sentence names, in the order it was handed them. */
export const labelsSaid = (labels: readonly string[] | undefined): string => {
  const all = labels ?? []
  if (all.length <= 1) return all[0] ?? '?'
  return `${all.slice(0, -1).join(', ')} and ${String(all[all.length - 1])}`
}

/** A piece of the giver's that stalled in the conversation a give found, and why. */
export interface AStallAGiveNames {
  readonly label: string
  readonly cause: TaskStallCause
}

/**
 * What a give's answer adds when the conversation it went to still holds pieces of the
 * giver's that stalled: each label with its cause, in the words `list_tasks` says it in, and the two
 * acts a stall asks for. Empty when there are none.
 */
export function stalledPiecesSaid(stalled: readonly AStallAGiveNames[]): string {
  if (stalled.length === 0) return ''
  const them = stalled.length > 1 ? 'them' : 'it'
  const named = labelsSaid(stalled.map((one) => `${one.label} (${undrivenSentence(one.cause)})`))
  return `It still holds ${named} from you, not being worked on: follow ${them} up with message_agent (kind follow-up), or take ${them} back with withdraw_task.`
}

/**
 * The sentence for each rail. **No session id, no internal state name** — a label (`W1.2`) is the
 * name a model and a person say a piece by, and it is what the caller acts on.
 *
 * ⚠️ **The act first** (`675`): a caller's row keeps 200 characters, so what to send goes before why.
 */
export function describeRail(rail: SpawnRail, detail: SpawnRefusalDetail = {}): string {
  switch (rail) {
    case 'malformed-request':
      return (
        'This request could not be read, so nothing was given. Send exactly the fields this tool ' +
        'documents — an unrecognised one is refused rather than ignored, because a request that ' +
        'half-arrives gives an agent something else.'
      )
    case 'no-piece-to-give-from':
      return 'Do the work here until you hold a piece; list_tasks shows your board. You hold no open piece that has reached you, so there is nothing to hang this under and nothing was given.'
    case 'name-the-piece-you-give-from':
      return `Say which of your pieces this is for (${labelsSaid(detail.held)}): give again naming it as piece.`
    case 'no-piece-you-hold-by-that-name':
      return 'You hold no open piece by that name, so nothing was given. list_tasks names what you hold.'
    case 'too-deep':
      return (
        `Too deep to give: under ${detail.label ?? '?'} it would sit at depth ${String(detail.depth ?? '?')}, ` +
        `past the ${String(detail.maxDepth ?? '?')} this agent may give. ` +
        'Do it yourself, or ask whoever gave you your piece.'
      )
    case 'services-are-off':
      return `Not given: services are off. Do the work yourself, or give it to another agent; “${detail.profileId ?? '?'}” is a service.`
    case 'its-kind-is-unknown':
      return `Not given: the services list can’t be read. Give the work to another agent, or ask a person; this app can’t tell whether “${detail.profileId ?? '?'}” is a service.`
    case 'parallel-not-for-a-service':
      return 'A service runs one piece at a time. Leave parallel out to queue the work.'
    case 'no-free-worker-at-capacity':
      return `Not given: '${detail.profileId ?? '?'}' already has 64 workers, and none is known to be free. Give it again when one is free.`
    case 'worker-binding-is-unknown':
      return `Not given: '${detail.profileId ?? '?'}' has no known conversation. Tell a person, and give it again once that is fixed.`
    case 'that-is-this-conversation':
      return 'Not given: that agent is you. Do this part within the piece you are working on.'
    case 'it-would-wait-on-itself':
      return 'Not given: that service is waiting on work you hold, so it would never reach this. Finish or take back that work, then give this again.'
    case 'its-waits-cannot-all-be-checked':
      return `Not given: its waits can’t all be checked. Give the work to another agent, or give it again once some of the work “${detail.profileId ?? '?'}” waits on has ended.`
    case 'its-record-cannot-be-read':
      return `Not given: part of this app’s record of what “${detail.profileId ?? '?'}” gave can’t be read. Give the work to another agent.`
    case 'that-profile-exists':
      return `“${detail.profileId ?? '?'}” is already an agent, so no new one was made and nothing was given. Give without new to use it: it keeps its memory.`
    // ⚠️ **True at a refusal AND at a launch**: `factory-text.ts` renders this very string into the
    // instructions while the switch is off (`SPAWNING_IS_OFF`), where nothing has been attempted.
    case 'spawning-disabled':
      return (
        'Agents may not start new conversations in this app right now, so a give that would start ' +
        'one gives nothing. Only a person can switch it back on. Work can still be given to an ' +
        'agent you already have a conversation with.'
      )
    case 'may-not-create-agents':
      return 'You may not bring a new agent into existence, so nothing was given. Give to an agent list_profiles names, or ask a person.'
    // ⚠️ **The act is the giver's own mode** (D-038): an agent has no approval mode of its own, and
    // since the rail compares reach, no provider an agent could be moved to changes the verdict.
    case 'wider-than-its-parent':
      return (
        'Do this work here, or ask a person whether to change your approval mode. ' +
        `Nothing was given: you run in “${detail.spawnerRunsAs ?? '?'}”, with ` +
        `${(detail.wouldLack ?? []).map((kept) => PROTECTION_SAID[kept]).join(' and ') || 'a protection'}, ` +
        `and the conversation it would start would run in “${detail.asked ?? '?'}”, writing outside its ` +
        'folder and reaching the network with nobody asked.'
      )
    case 'no-such-profile':
      return (
        'There is no agent by that name, so nothing was given: check the spelling — list_profiles ' +
        'names every agent. To bring a new agent into existence under this name, give it again with ' +
        `new: true. It asked for “${detail.profileId ?? '?'}”.`
      )
    case 'no-room-for-provider-conversation':
      return (
        `Your worker pool for “${detail.profileId ?? '?'}” is full and has no conversation on ${detail.provider === undefined ? 'the chosen provider' : PROVIDER_NAME[detail.provider]}. ` +
        'Give work on a provider already in that pool, or choose another agent. A person can remove a worker to make room; waiting for these workers to finish will not free a place for another provider.'
      )
    case 'service-provider-is-fixed':
      return (
        `“${detail.profileId ?? '?'}” is a service with one conversation on ${detail.provider === undefined ? 'its provider' : PROVIDER_NAME[detail.provider]}. ` +
        `Give it work on that provider; its models are ${(detail.choices ?? []).join(', ') || 'not available right now'}. ` +
        'A service cannot take a second provider.'
      )
    case 'its-provider-is-not-chosen': {
      const on = Object.entries(detail.startedOn ?? {})
        .filter(([, started]) => started > 0)
        .map(([provider, started]) => `${PROVIDER_NAME[provider as Provider]} (${String(started)})`)
        .join(' and ')
      return on === ''
        ? `Ask a person to choose a provider for “${detail.profileId ?? '?'}” on its sheet, or give ` +
            'the work to another agent: it has no provider saved and no conversation yet, so ' +
            'nothing was given.'
        : `Ask a person to choose a provider for “${detail.profileId ?? '?'}” on its sheet, or give ` +
            `the work to another agent: it has no provider saved and its conversations ran on ` +
            `${on}, so nothing was given.`
    }
    case 'folder-unusable':
      return `The folder a new conversation would work in cannot be used, and only a person can make it right. What is wrong with it: ${detail.folderReason ?? 'no reason given'}.`
  }
}

/** Build the whole payload from the rail and its policy facts, so those fields cannot drift apart. */
export function refuse(rail: SpawnRail, detail: SpawnRefusalDetail = {}): SpawnRefusal {
  return {
    rail,
    permanence: permanenceOf(rail),
    retryable: retryableOf(rail),
    reason: refusalReason(describeRail(rail, detail)),
    remedy: remedyOf(rail),
    detail,
  }
}

/**
 * 🔴 **D-016 · the give's request, and `.strict()` is a rail rather than a style** — see
 * `malformed-request`.
 *
 * ⛔ **It lives in `main/` and not in `shared/runtime-ipc.ts`.** The renderer's protocol is a wire;
 * this is the one door an agent's tool call reaches.
 *
 * ⚑ **There are no provider or approval arguments** (plan ruling 3): a conversation a give starts
 * runs on the agent's own provider ({@link theProviderAStartRunsOn}), in the giver's mode.
 * 🔴 **D-042 · R4 — a model and an effort ARE arguments**: an agent chooses what its helper's
 * one conversation with it runs on, judged at `model-rails.ts`' seam — the list, then the model's
 * efforts.
 */
export const doneConditionSchema = z
  .string({ error: WORK_FIELD_WORDS.required })
  .refine((value) => value.trim() !== '', WORK_FIELD_WORDS.blank)
  .max(DONE_CONDITION_CHARS, WORK_FIELD_WORDS.conditionLimit)

export const workBriefSchema = z
  .string()
  .refine((value) => value.trim() !== '', 'must say something')
  .max(WORK_BRIEF_CHARS, WORK_FIELD_WORDS.briefLimit)

/** What a value sent for a field is, in a word or two. */
function aValueOf(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'a list'
  switch (typeof value) {
    case 'string':
      return 'text'
    case 'number':
      return 'a number'
    case 'boolean':
      return 'true or false'
    default:
      return 'an object'
  }
}

/** What a field takes, in {@link aValueOf}'s words. */
const EXPECTED_SAID: Readonly<Record<string, string>> = {
  string: 'text',
  boolean: 'true or false',
  array: 'a list',
  number: 'a number',
  object: 'an object',
}

const valueAt = (request: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (value, key) =>
      typeof value === 'object' && value !== null
        ? (value as Readonly<Record<PropertyKey, unknown>>)[key]
        : undefined,
    request,
  )

const isWorkFieldWords = (message: string): boolean =>
  (Object.values(WORK_FIELD_WORDS) as readonly string[]).includes(message)

/** Caller-named fields are shown with a bounded name and a bounded list. */
const unknownFieldNames = (keys: readonly string[]): string[] =>
  keys.slice(0, 5).map((key) => (key.length > 40 ? `${key.slice(0, 39)}…` : key))

/**
 * Each problem with a work request, naming its field and what that field takes. A field sent as
 * the wrong kind of value says what came; no value sent is repeated.
 */
const workRequestProblems = (
  issues: readonly z.core.$ZodIssue[],
  /** The request as it was sent, for what kind of value each field came as. */
  request: unknown,
  /** The fields the tool takes, named beside a field it does not. */
  takes: readonly string[],
): string[] =>
  issues.map((issue) => {
    const field = issue.path.map(String).join('.') || '(request)'
    const value = valueAt(request, issue.path)
    if (issue.code === 'invalid_type' && value !== undefined) {
      const expected = EXPECTED_SAID[issue.expected] ?? issue.expected
      return `${field}: expected ${expected}, got ${aValueOf(value)}`
    }
    if (isWorkFieldWords(issue.message)) return issue.message
    const unit = (origin: string): string => (origin === 'array' ? 'items' : 'characters')
    switch (issue.code) {
      case 'invalid_type':
        return `${field} is required`
      case 'unrecognized_keys':
        return `${field}: unknown fields ${unknownFieldNames(issue.keys)
          .map((key) => JSON.stringify(key))
          .join(
            ', ',
          )}${issue.keys.length > 5 ? ` and ${String(issue.keys.length - 5)} more` : ''} — it takes only ${takes.join(', ')}`
      case 'too_big':
        return `${field}: at most ${String(issue.maximum)} ${unit(issue.origin)}`
      case 'too_small':
        return issue.origin === 'string' && Number(issue.minimum) === 1
          ? `${field}: must not be empty`
          : `${field}: at least ${String(issue.minimum)} ${unit(issue.origin)}`
      default:
        return `${field}: ${issue.message}`
    }
  })

/** The details {@link workRequestRefused} composed in this app's words alone. */
const IN_ITS_OWN_WORDS = new WeakSet<object>()

/**
 * A work request that could not be read: each problem, and the fields sent that the tool does not
 * take ({@link SpawnRefusalDetail.unknownFields}). ⚑ With none of those, every word is this app's,
 * and {@link problemsInItsOwnWords} says so.
 */
export function workRequestRefused(
  issues: readonly z.core.$ZodIssue[],
  request: unknown,
  takes: readonly string[],
): { readonly problems: readonly string[]; readonly unknownFields?: readonly string[] } {
  const unknown = issues.flatMap((issue) => (issue.code === 'unrecognized_keys' ? issue.keys : []))
  const problems = workRequestProblems(issues, request, takes)
  if (unknown.length > 0) return { problems, unknownFields: unknownFieldNames(unknown) }
  const detail = { problems }
  IN_ITS_OWN_WORDS.add(detail)
  return detail
}

/** Whether a refusal's detail is a work request's problems in this app's words alone. */
export function problemsInItsOwnWords(detail: unknown): boolean {
  return typeof detail === 'object' && detail !== null && IN_ITS_OWN_WORDS.has(detail)
}

export const giveRequestSchema = z
  .object({
    /** The agent to give it to, by profile. The same path-segment alphabet every profile name uses. */
    profile: z.string().refine(isPathSegment, `must be ${PATH_SEGMENT_RULE}`),
    /** What the piece is called — the line a person and a model read beside its label. */
    title: z.string().trim().min(1).max(PIECE_TITLE_CHARS),
    brief: workBriefSchema,
    definition_of_done: doneConditionSchema,
    /** ⚑ Used only when this give starts a conversation; a relative one is read from the giver's. */
    folder: z.string().optional(),
    /**
     * The caller's own piece to hang this under, by label or id — inferred: the one open piece that
     * has reached it, of several the one its turn drives, else its root (D-022 · R4).
     */
    piece: z.string().min(1).max(200).optional(),
    /** 🔴 **D-016 · R3** — bring a new agent into existence under `profile`. */
    new: z.boolean().optional(),
    /** Choose this provider's conversation; never change an existing conversation's provider. */
    provider: providerSchema.optional(),
    /** Choose a free worker of the same normal profile rather than queueing on its primary. */
    parallel: z.boolean().optional(),
    /**
     * 🔴 **D-016 · files handed over with the work, kept as the piece's inputs** — read from the
     * giver's folder, and kept before anything is written or sent (`RuntimeHost.giveWork`).
     */
    inputs: z.array(z.string().min(1)).max(MAX_RESOURCES_PER_REPLY).optional(),
    /**
     * 🔴 **D-042 · R4 — the model that conversation runs on, from this piece on** — one in the list
     * a person keeps for its provider. ⚑ The provider never changes.
     */
    model: z.string().min(1).max(120).optional(),
    /** 🔴 **D-042 · R4 — its reasoning effort**, one that model offers. */
    effort: z.string().min(1).max(60).optional(),
  })
  .strict()

export type GiveRequest = z.infer<typeof giveRequestSchema>

/**
 * 🔴 **D-016 · commit 6 · R1 — `take_on_work`'s request: a give's own `title` and `brief`, bounded
 * as a give's are, and nothing else.** ⛔ No `folder`, no `inputs`, no `piece`: work taken on always
 * hangs under the caller's own root. ⚑ `.strict()`, as the give's is, so a key a caller believes in
 * is refused by name (`303` B) rather than dropped.
 */
export const takeOnWorkRequestSchema = giveRequestSchema
  .pick({ title: true, brief: true, definition_of_done: true, piece: true, inputs: true })
  .strict()

/**
 * 🔴 **D-042 · what the helper's conversation runs on, as the give's answer says it** (R4: *"the
 * give's answer says what it now runs"*).
 *
 * ⚑ **Read after the brief was delivered**, from the running conversation or its row, so a start
 * that named the provider's default reports the name it sent. ⚑ `how` is what the give did:
 * `started` it, `switched` its pair from this piece on, left it `unchanged`, kept the pair a person
 * chose for it (F1), or reached a conversation that took its place on `another-provider`, whose
 * list never judged the choice. ⚑ `from` says, for a start, where its MODEL came from — R1's order.
 */
export interface WhatItRunsOn {
  readonly provider: Provider
  /** `null` only for a conversation that has named none yet. */
  readonly model: string | null
  /** `null` where its model offers no effort, or none is named yet. */
  readonly effort: string | null
  /** ⚑ R5 — `true` only when its provider last reported running that very effort; else asked for. */
  readonly effortReported: boolean
  readonly how: 'started' | 'switched' | 'unchanged' | 'a-person-chose-it' | 'another-provider'
  readonly from: WhereItCameFrom | null
  /** ⚑ What the give itself named, so the answer claims no half it did not. */
  readonly named: { readonly model: boolean; readonly effort: boolean }
}

/**
 * 🔴 **The token `RuntimeHost.createSession` requires before it will record a parent** — and the
 * only way to hold one is to have passed every rail above, or to be carrying on a conversation a
 * give already started ({@link admitAReplacement}).
 *
 * ⛔ **Branded with a `unique symbol` this module never exports as a value**, so no other file can
 * spell the key and no object literal elsewhere can satisfy the type — *"the rails ran"* is a
 * COMPILE-TIME fact. ⚑ **And a runtime one as well, because a type is not a gate**: every token this
 * module mints is remembered in {@link minted}, and {@link wasAdmitted} is what the chokepoint asks.
 */
declare const admittedBrand: unique symbol

export interface AdmittedSpawn {
  readonly [admittedBrand]: true
  /** The conversation that gives the work, and so the new conversation's parent. */
  readonly parentSessionId: string
  readonly profileId: string
  readonly provider: Provider
  readonly cwd: string
  readonly approvalMode: 'ask' | 'auto'
  /**
   * Who may drive the new conversation. `340`'s `commandedBy`: the giver, as an identity — the app
   * itself is not storable as one, because a slot commanded by the superuser would be commandable by
   * everything.
   */
  readonly commandedBy: CallerIdentity | null
}

/**
 * ⛔ **A `WeakSet` and not a flag on the object**, so the mark cannot be copied by a spread.
 */
const minted = new WeakSet<object>()

/** Whether this token came out of this module rather than out of a cast. */
export function wasAdmitted(spawn: AdmittedSpawn): boolean {
  return minted.has(spawn)
}

/**
 * 🔴 **The conversation giving the work, as much of it as the rails need to see** — its id and its
 * profile for every give (the pieces it holds, the conversation it already has, and the grant sheet
 * the depth is read from), and its provider, folder and approval mode only when a give would START
 * a conversation.
 *
 * ⚠️ **Its approval mode is the EFFECTIVE mode and never the requested one** — `RuntimeHost`'s
 * `effectiveApprovalOf`: a giver that has already asked to go back to prompting is giving up its
 * laxness, and spending it on a conversation it starts would outlive it.
 */
export interface GivingConversation {
  readonly sessionId: string
  /** The profile it is RUNNING as — the identity whose grants are being spent. */
  readonly profileId: string
  readonly provider: Provider
  readonly cwd: string
  /** 🔴 **What it is running under RIGHT NOW**, which the new conversation inherits. */
  readonly approvalMode: ApprovalMode
}

/**
 * ⚑ **D-016 · one piece a conversation HOLDS, as a give reads it** — its root, or an open piece given
 * to it or taken on for a person. ⛔ The pieces it may hang a give under, and no others.
 */
export interface HeldPiece {
  readonly piece: string
  readonly label: string
  /**
   * ⚑ **D-016 · commit 6 · R2 — whether it is the caller's root**, its conversation's own work,
   * rather than a piece given to it or one it took on: a give that names no piece hangs under the
   * one open piece, and under the root only when there is none.
   */
  readonly root: boolean
  /** The conversation that gave it; `null` for its root or a piece it took on for a person. */
  readonly giver: string | null
  /**
   * 🔴 **D-022 · R4 — whether its brief has reached the caller**: its root always has (it is the
   * conversation's own work); a piece has unless its give still waits to be sent to it — held in the
   * caller's mailbox, or handed on by a stop to its next start. ⚑ Where the give's own message
   * waits, asked by the host (`RuntimeHost.itsGiveStillWaits`), and not the fold's `waiting`, which a
   * restart's first turn can read `working` while the give still waits behind it. ⚑ A piece that
   * has not reached it is one it cannot mean, so no inference counts it; naming it still resolves.
   */
  readonly received: boolean
}

/**
 * The world, as thunks.
 *
 * ⛔ **Lazy on purpose.** The order the rails are asked in is load-bearing (see this file's header),
 * and a world computed eagerly would run the folder check — the one clause that touches the disk —
 * for a give that was going to a conversation that already exists.
 */
export interface GiveFacts {
  /**
   * ⚑ **The conversation the caller speaks as** — its session in this host, whether or not its
   * process is stopping (`05`; D-016c: `message_agent` and `ask_question` never refuse a sender for
   * it). ⚠️ `RuntimeHost.giveWork` answers a caller that speaks as none before the rails are asked.
   */
  readonly giver: () => GivingConversation
  /**
   * Its root, when it owns one, then its open pieces — in that order, each saying whether it is the
   * root and whether it has reached it.
   */
  readonly held: (giver: string) => readonly HeldPiece[]
  /**
   * 🔴 **D-022 · R4 — the piece of the caller's own the turn it is in drives** — the one its opening
   * row names or drives (a brief, a new brief, words about one of its pieces or about work under
   * one) — or `null`: that row names none, the messages it delivered drive different pieces
   * (D-027), or no turn this app sent is open.
   */
  readonly drivenByTheTurn: () => string | null
  /**
   * Whether the caller is a helper: a conversation another one started, whose own root holds only
   * what a person asked it directly.
   */
  readonly isAHelper: () => boolean
  /** ⚑ `can_assign_work` asked of the caller alone — `admitReachAtAll('assign', …)`. */
  readonly mayGiveWork: () => MessageRefusal | null
  /**
   * How far below the work a person gave a piece sits: a root is 0, and so is a piece taken on for
   * a person (D-016 · commit 6).
   */
  readonly depthOf: (piece: string) => number
  readonly capabilitiesOf: (profileSlug: string) => ProfileCapabilities | null
  /**
   * 🔴 **The conversation this giver has with that agent on the chosen provider, or `null`** (R2 step 5) — over the
   * reservations in flight and the rows, the giver's predecessors included, followed through
   * `theOneInItsPlace`. ⛔ **A lookup and not a rail**: whatever state it is in, a give that finds
   * it goes there.
   */
  readonly helperAs: (giver: string, profileSlug: string, provider?: Provider) => string | null
  /** Stable normal-worker lookup; no binding is invented from an incomplete reading. */
  readonly workerAt?: (
    giver: string,
    profileSlug: string,
    parallel: boolean,
    provider?: Provider,
  ) =>
    | { readonly is: 'legacy' | 'unknown' | 'full' }
    | { readonly is: 'known'; readonly conversation: string | null }
  /** Whether a give to `profileSlug` reaches a service, and how ({@link ServiceAtAGive}). */
  readonly serviceAt: (giver: string, profileSlug: string) => ServiceAtAGive
  readonly spawningEnabled: () => boolean
  /**
   * ⚑ **Who is creating, when the caller may bring a new agent into existence**, else `null` — the
   * answer `RuntimeHost.mayCreateAgents` gives `create_agent`.
   */
  readonly mayCreateAgents: () => IdentityCreator | null
  /** The provider the TARGET agent runs on, and what says so (`theProviderOfAnAgent`). */
  readonly itsProvider: (profileSlug: string) => ItsProvider
  /**
   * The provider whose list alone holds the model the give names, read before the give's stretch;
   * `null` when it names none, or more or fewer than one list holds it.
   */
  readonly theNamedModelsProvider: () => Provider | null
  /** The service's own list, read before admission only when a different provider is named. */
  readonly serviceModels?: () => readonly string[]
  /** 🔴 **The TARGET identity's default model and effort, or null** (677; D-042 · R2). */
  readonly modelChoiceOf: (profileSlug: string) => AgentModelChoice | null
  readonly checkFolder: (path: string) => { ok: true; path: string } | { ok: false; reason: string }
}

/**
 * A give's target as a service: `normal` for an agent that is not one; `off` while services don't
 * run; `unknown` where its kind can't be told and a service may be at stake; else its one
 * conversation (`null` before its first give), whether that is the giver itself, whether it already
 * waits on the giver through work it gave, and the provider its first give records it on.
 */
export type ServiceAtAGive =
  | { readonly is: 'normal' | 'off' | 'unknown' }
  | {
      readonly is: 'service'
      readonly conversation: string | null
      readonly isTheGiver: boolean
      /**
       * Whether it already waits on the giver: `unknown` where the work it reaches is too much to
       * check, `unread` where a record of it can't be read.
       */
      readonly waitsOnTheGiver: 'yes' | 'no' | 'unknown' | 'unread'
      readonly provider: Provider | null
    }

/**
 * ⚑ **What {@link admitGive} answers** — the piece it hangs under and where the work goes: the
 * conversation found, or a START, admitted.
 *
 * ⛔ **A start carries a token and, for a new agent, who is creating it** — the identity row is the
 * host's first write, made after every rail has answered.
 */
export type GiveAdmission =
  | { readonly ok: false; readonly refusal: SpawnRefusal | MessageRefusal }
  | {
      readonly ok: true
      readonly asked: GiveRequest
      readonly giver: string
      readonly under: HeldPiece
      readonly goes:
        | {
            readonly to: 'the-one-it-has'
            readonly conversation: string
            /**
             * 🔴 **W4.189 · the folder the give named, resolved and usable — a grant on that
             * conversation for this piece**; `null`: it named none, or one that cannot be used.
             */
            readonly grant: string | null
            /**
             * ⚑ **Why a folder it named was not granted** — `checkSessionCwd`'s own sentence, naming
             * it; `null`: none was named, or it was granted. ⛔ Never a refusal of the give (R92).
             */
            readonly notGranted: string | null
          }
        | {
            readonly to: 'a-new-conversation'
            readonly start: AdmittedSpawn
            /** ⚑ The identity to write first, when the give asked for a new agent; else `null`. */
            readonly creating: { readonly slug: string; readonly by: IdentityCreator } | null
          }
        | {
            /** A service: the piece is queued on its one conversation, recorded first if none. */
            readonly to: 'a-service'
            readonly conversation: string | null
            readonly profileId: string
            /** The provider its first give records its conversation on; `null` once it has one. */
            readonly provider: Provider | null
            readonly grant: string | null
            readonly notGranted: string | null
          }
    }

/**
 * 🔴 **What `RuntimeHost.giveWork` answers with** — the piece, where it went, or the rail that
 * stopped it.
 *
 * ⛔ **The refusal is a value on a resolved promise**, which is HO-005 criterion 4's *"a successful
 * call whose payload names the rail"*. ⚠️ **A launch or a delivery that fails after admission still
 * THROWS**, and that is not a rail: `give_work` classifies it as `message_agent` and a start do.
 */
export type GiveOutcome =
  | {
      readonly ok: true
      readonly piece: string
      readonly label: string
      /** 🔴 **The conversation the brief reached** — after a replacement, not the one looked up (R2). */
      readonly owner: string
      /** The conversation the lookup found or the start made, before any replacement. */
      readonly found: string
      readonly profile: string
      /** The bound normal worker selected by an explicit parallel give. */
      readonly worker?: WorkerBindingReading
      /**
       * ⚑ **D-022 · R3 — what became of the brief**, in the words the giver's piece verbs share:
       * `sent` as the owner's turn now, or `held` until its turn ends.
       */
      readonly delivery: Exclude<TellDelivery, 'not-delivered'>
      /** 🔴 **D-042 · what the conversation runs on now** — see {@link WhatItRunsOn}. */
      readonly runsOn: WhatItRunsOn
      /** The folder the new conversation works in, when this give started one. */
      readonly startedIn: string | null
      /** This start used the agent's default provider, rather than a provider or model named in the give. */
      readonly startedOnDefault?: true
      /**
       * 🔴 **W4.189 · the folder the give named, as this app used it** — the new conversation's
       * working folder, or a grant on the one it has — with D's notice when it meets one of the
       * places this app names; `null`: the give named none.
       */
      readonly givenFolder: GivenFolder | null
      /** ⚑ **W4.189** — why a folder named for the conversation it has was not granted, or `null`. */
      readonly folderNotGranted: string | null
      /**
       * ⚑ **W4.189 · what the grant changes for that conversation**, so the receipt says only what
       * is true: `writes` — Codex asking first, which may now write there without asking; `reads` —
       * Claude asking first, which reads there without asking and still asks before changing
       * anything; `already` — a conversation that runs without asking reached it already. `null`:
       * no grant.
       */
      readonly grantReach: 'writes' | 'reads' | 'already' | null
      /** 🔴 **The files it handed over, kept as the piece's inputs** — by id and name; `[]`: none. */
      readonly inputs: readonly { readonly resource: string; readonly name: string }[]
      /** How many open pieces are ahead of it at the service it was queued on; absent for no service. */
      readonly queuedBehind?: number
      /** When the piece being worked on at that service stalled, while it stays stalled. */
      readonly queueStalledAt?: number
      /** The giver's stalled pieces in the conversation it went to, with why. */
      readonly stalled?: readonly AStallAGiveNames[]
    }
  /**
   * ⚑ **A resource refusal is the give's last rail** — a file that cannot be kept refuses the whole
   * give before anything is written or sent. 🔴 **D-042 · and a model refusal its choice's**
   * (`model-rails.ts`), judged after the rails and before anything is written.
   */
  | {
      readonly ok: false
      readonly refusal: SpawnRefusal | MessageRefusal | ResourceRefusal | ModelRefusal
    }

/**
 * ⚑ **D-017 · R10 — a conversation a parent started that can never be reopened, as its ledger
 * recorded it** — what {@link admitAReplacement} carries on in a new conversation.
 */
export interface ReplacedConversation {
  readonly parentSessionId: string
  readonly profileId: string
  /** ⚠️ **The provider as the identity names it NOW** (R10), else the one it ran on. */
  readonly provider: Provider
  readonly cwd: string
  readonly approvalMode: ApprovalMode
  /** The parent's own caller, which commands the new conversation as it commanded the old. */
  readonly commandedBy: CallerIdentity
}

/**
 * ⚑ **D-017 · R10 — the token a REPLACEMENT carries into `RuntimeHost.createSession`** (`05` rule
 * 3): the conversation its parent already started, carried on in a new one because its own record
 * can never be reopened.
 *
 * ⛔ **No rail is asked, and that is the ruling rather than a gap**: nothing new is decided — the
 * parent, the identity and the folder are the ones the give that started it admitted — and a
 * delivery's start asks no launch rail (R1). ⚑ The token is minted HERE, into the same set
 * {@link wasAdmitted} reads, so `createSession` still takes a parent only from this module.
 */
export function admitAReplacement(replaced: ReplacedConversation): AdmittedSpawn {
  const admitted = {
    parentSessionId: replaced.parentSessionId,
    profileId: replaced.profileId,
    provider: replaced.provider,
    cwd: replaced.cwd,
    approvalMode: replaced.approvalMode,
    commandedBy: replaced.commandedBy,
  } as AdmittedSpawn
  minted.add(admitted)
  return admitted
}

/**
 * Resolve the provider before both conversation lookup and a new start. An explicit provider wins,
 * then a model held by exactly one provider's list, then the identity's default and the giver's.
 * A legacy identity whose conversations differ and has no default still needs a choice.
 * The host uses this same rule before reading a model list and again after that await.
 */
export function theProviderAStartRunsOn(
  asked: Pick<GiveRequest, 'profile' | 'provider'>,
  /** Whether that agent exists — `capabilitiesOf` answered for it. */
  known: boolean,
  giving: Pick<GivingConversation, 'provider'>,
  facts: Pick<GiveFacts, 'modelChoiceOf' | 'itsProvider'>,
  /** {@link GiveFacts.theNamedModelsProvider}'s answer. */
  theNamedModels: Provider | null,
): Provider | null {
  if (asked.provider !== undefined) return asked.provider
  if (theNamedModels !== null) return theNamedModels
  const its: ItsProvider = known
    ? facts.itsProvider(asked.profile)
    : { provider: null, from: 'nothing-yet' }
  if (its.provider !== null) return its.provider
  if (its.from === 'its-conversations-differ') return null
  const chosen = known ? facts.modelChoiceOf(asked.profile) : null
  return chosen?.provider ?? giving.provider
}

/**
 * ⚑ **Where a give's folder is**, read as a first give has read it since `726`'s review: a RELATIVE
 * one from the giver's own folder (`checkSessionCwd` would read it from THIS process's, which is
 * `/` for the packaged app); `~` and an absolute one as written. ⚑ W4.189 · one rule for a first
 * conversation's folder and a grant.
 */
function placedFrom(folder: string, giversFolder: string): string {
  const spelled = folder.trim()
  return spelled !== '' && !isAbsolute(spelled) && spelled !== '~' && !spelled.startsWith('~/')
    ? join(giversFolder, spelled)
    : folder
}

/**
 * 🔴 **Every rail of a give, in R2's order, and nothing is written on any path through it.**
 *
 * ⚠️ **Synchronous, and the host keeps it so from here until a start has reserved its slot** (R2
 * step 5): two gives in one tick — Codex makes parallel tool calls — must find one conversation, and
 * the second finds the first one's reservation only if nothing awaits between the two.
 */
export function admitGive(
  request: unknown,
  /** ⚑ The giver, as the caller the new conversation's slot is commanded by (340). */
  by: CallerIdentity,
  facts: GiveFacts,
): GiveAdmission {
  const no = (rail: SpawnRail, detail: SpawnRefusalDetail = {}): GiveAdmission => ({
    ok: false,
    refusal: refuse(rail, detail),
  })

  // 1 · the shape.
  const parsed = giveRequestSchema.safeParse(request)
  if (!parsed.success) {
    const takes = Object.keys(giveRequestSchema.shape)
    return no('malformed-request', workRequestRefused(parsed.error.issues, request, takes))
  }
  const asked = parsed.data
  const giving = facts.giver()

  // 2 · the piece it is given under — the caller itself, never its predecessors: pieces never change
  // owner, and a replaced root owner has its own new root (D-016 spec D38).
  const held = facts.held(giving.sessionId)
  let under: HeldPiece
  if (asked.piece !== undefined) {
    const named = held.find((one) => one.piece === asked.piece || one.label === asked.piece)
    if (named === undefined) return no('no-piece-you-hold-by-that-name', { piece: asked.piece })
    under = named
  } else {
    // 🔴 **D-022 · R4 — only a piece whose brief has reached it counts**: the ONE such piece; of
    // several, the one the turn it is in drives; with none, its root (commit 6 · R2); else
    // ambiguous, naming them. ⚑ A root owner that took work on hangs what it gives under that work.
    // ⛔ A helper never uses its own root while it holds a piece someone gave it, whose brief may
    // still be on its way: that work belongs in the tree it was given in.
    const received = held.filter((one) => !one.root && one.received)
    const givenToIt = held.filter((one) => !one.root && one.giver !== null)
    const notItsRoot = received.length === 0 && givenToIt.length > 0 && facts.isAHelper()
    const drives = received.length > 1 ? facts.drivenByTheTurn() : null
    const inferred =
      received.length === 1
        ? received[0]
        : received.length > 1
          ? received.find((one) => one.piece === drives)
          : notItsRoot
            ? undefined
            : held.find((one) => one.root)
    if (inferred === undefined) {
      if (notItsRoot) {
        return no('name-the-piece-you-give-from', { held: givenToIt.map((one) => one.label) })
      }
      return received.length > 1
        ? no('name-the-piece-you-give-from', { held: received.map((one) => one.label) })
        : no('no-piece-to-give-from')
    }
    under = inferred
  }

  // 3 · the grant on giving, asked of the caller alone.
  const wall = facts.mayGiveWork()
  if (wall !== null) return { ok: false, refusal: wall }

  // 4 · depth. ⛔ **`?? DEFAULT_CAPABILITIES` is the one default set every agent holds** — a caller
  // `may-not-assign-work` admitted has a row, and a row nobody narrowed reads as exactly this.
  const giver = facts.capabilitiesOf(giving.profileId) ?? DEFAULT_CAPABILITIES
  const depth = facts.depthOf(under.piece) + 1
  if (depth > giver.maxDepth) {
    return no('too-deep', {
      depth,
      maxDepth: giver.maxDepth,
      label: under.label,
      profileId: asked.profile,
    })
  }

  // 5 · the lookup — a lookup, not a rail: whatever state the conversation is in, the work goes there.
  const service = asked.new === true ? null : facts.serviceAt(giving.sessionId, asked.profile)
  if (service?.is === 'off') return no('services-are-off', { profileId: asked.profile })
  if (service?.is === 'unknown') return no('its-kind-is-unknown', { profileId: asked.profile })
  if (service?.is === 'service') {
    const requestedProvider = asked.provider ?? facts.theNamedModelsProvider()
    if (
      requestedProvider != null &&
      service.provider !== null &&
      requestedProvider !== service.provider
    ) {
      return no('service-provider-is-fixed', {
        profileId: asked.profile,
        provider: service.provider,
        choices: facts.serviceModels?.() ?? [],
      })
    }
    if (asked.parallel === true)
      return no('parallel-not-for-a-service', { profileId: asked.profile })
    if (service.isTheGiver) return no('that-is-this-conversation', { profileId: asked.profile })
    if (service.waitsOnTheGiver === 'yes') {
      return no('it-would-wait-on-itself', { profileId: asked.profile })
    }
    if (service.waitsOnTheGiver === 'unknown') {
      return no('its-waits-cannot-all-be-checked', { profileId: asked.profile })
    }
    if (service.waitsOnTheGiver === 'unread') {
      return no('its-record-cannot-be-read', { profileId: asked.profile })
    }
    if (service.conversation === null) {
      // Recording its first conversation is a start, for the switch that stops agents' starts.
      const mayStart = facts.spawningEnabled()
      if (!mayStart) return no('spawning-disabled', { profileId: asked.profile })
      if (service.provider === null) {
        const its = facts.itsProvider(asked.profile)
        return no('its-provider-is-not-chosen', {
          profileId: asked.profile,
          ...(its.from === 'its-conversations-differ' ? { startedOn: its.startedOn } : {}),
        })
      }
    }
    // The folder a give names is the piece's to work in, granted when it is used.
    const named = asked.folder?.trim() ?? ''
    const checked = named === '' ? null : facts.checkFolder(placedFrom(named, giving.cwd))
    const grant = checked?.ok === true ? checked.path : null
    const notGranted = checked !== null && !checked.ok ? checked.reason : null
    return {
      ok: true,
      asked,
      giver: giving.sessionId,
      under,
      goes: {
        to: 'a-service',
        conversation: service.conversation,
        profileId: foldProfileName(asked.profile),
        provider: service.conversation === null ? service.provider : null,
        grant,
        notGranted,
      },
    }
  }

  const known = facts.capabilitiesOf(asked.profile) !== null
  const provider = theProviderAStartRunsOn(
    asked,
    known,
    giving,
    facts,
    facts.theNamedModelsProvider(),
  )
  const worker = facts.workerAt?.(
    giving.sessionId,
    asked.profile,
    asked.parallel === true && asked.new !== true,
    provider ?? undefined,
  )
  if (worker?.is === 'full') {
    return asked.parallel === true
      ? no('no-free-worker-at-capacity', { profileId: asked.profile })
      : no('no-room-for-provider-conversation', {
          profileId: asked.profile,
          ...(provider === null ? {} : { provider }),
        })
  }
  if (worker?.is === 'unknown') return no('worker-binding-is-unknown', { profileId: asked.profile })
  const found =
    worker?.is === 'known'
      ? worker.conversation
      : facts.helperAs(giving.sessionId, asked.profile, provider ?? undefined)
  if (found !== null) {
    // 5b · ⚑ a found conversation proves the agent exists, and reusing it would give "a new agent" a
    // memory — R3's own reason (D-016 spec D1).
    if (asked.new === true) return no('that-profile-exists', { profileId: asked.profile })
    // For an existing conversation, a supplied folder becomes an additional grant for this work. An unusable folder adds no grant and is explained in the receipt; it does not refuse the give. The host reports its location separately.
    let grant: string | null = null
    let notGranted: string | null = null
    if (asked.folder !== undefined && asked.folder.trim() !== '') {
      const folder = facts.checkFolder(placedFrom(asked.folder, giving.cwd))
      if (folder.ok) grant = folder.path
      else notGranted = folder.reason
    }
    return {
      ok: true,
      asked,
      giver: giving.sessionId,
      under,
      goes: { to: 'the-one-it-has', conversation: found, grant, notGranted },
    }
  }

  // 7 · nothing found: the rails of a START.
  if (!facts.spawningEnabled()) return no('spawning-disabled', { profileId: asked.profile })
  // ⚑ **Whether the agent exists is a read of its row** — `list_profiles` names every one, so the
  // answer is no secret — and it decides which of the two rails below the name meets.
  const creator = asked.new === true && !known ? facts.mayCreateAgents() : null
  if (asked.new === true && !known && creator === null) {
    return no('may-not-create-agents', { profileId: asked.profile })
  }

  // ⛔ **INHERITED** (499, HO-036): a conversation a give starts runs in its giver's mode.
  const approvalMode = giving.approvalMode

  // ⚑ never wider than the giver — see the rail for why it compares what each keeps past its folder.
  const wouldLack =
    provider === null
      ? []
      : whatTheChildWouldLack(
          { provider, approvalMode },
          { provider: giving.provider, approvalMode: giving.approvalMode },
        )
  if (wouldLack.length > 0) {
    return no('wider-than-its-parent', {
      asked: approvalMode,
      spawnerRunsAs: giving.approvalMode,
      wouldLack,
      profileId: asked.profile,
    })
  }

  // ⚑ **R3 — the name**: a typo is refused, and a new agent is asked for by `new` alone.
  if (!known && asked.new !== true) return no('no-such-profile', { profileId: asked.profile })
  if (known && asked.new === true) return no('that-profile-exists', { profileId: asked.profile })

  // ⚑ After the name, so a give a person's choice would not let through is never told to wait for it.
  if (provider === null) {
    const its = facts.itsProvider(asked.profile)
    return no('its-provider-is-not-chosen', {
      profileId: asked.profile,
      ...(its.from === 'its-conversations-differ' ? { startedOn: its.startedOn } : {}),
    })
  }

  // the folder, last, because it is the only clause that asks the disk anything.
  //
  // 🔴 **A give that names no folder starts its conversation in the giver's** (HO-010 ruling 4, as
  // a DEFAULT, and `726` · R92: never a bound). ⛔ **A BLANK folder is an absent one.** A RELATIVE
  // one is read from the giver's own folder (`726`'s review): `checkSessionCwd` resolves against
  // THIS process's directory, which is `/` for the packaged app. `~` is left to `checkSessionCwd`.
  const requested =
    asked.folder !== undefined && asked.folder.trim() !== '' ? asked.folder : giving.cwd
  const folder = facts.checkFolder(placedFrom(requested, giving.cwd))
  if (!folder.ok) return no('folder-unusable', { folderReason: folder.reason })

  const start = {
    parentSessionId: giving.sessionId,
    // ⚑ **An agent this give creates starts under its folded name** — the one its row is written
    // with; an existing one under the spelling the give used, which `provider_session.profile_id`
    // keeps (187).
    profileId: known ? asked.profile : foldProfileName(asked.profile),
    provider,
    cwd: folder.path,
    approvalMode,
    // ⛔ **The giver commands what it starts** (340): an identity a slot holds for as long as it runs.
    commandedBy: by,
  } as AdmittedSpawn
  minted.add(start)
  return {
    ok: true,
    asked,
    giver: giving.sessionId,
    under,
    goes: {
      to: 'a-new-conversation',
      start,
      creating: creator === null ? null : { slug: foldProfileName(asked.profile), by: creator },
    },
  }
}
