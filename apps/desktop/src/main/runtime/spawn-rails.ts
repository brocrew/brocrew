import type { SendRecipientState, ToolOutcome } from '../../shared/tool-outcome'
import type { AgentModelChoice, WhereItCameFrom } from '../../shared/model-choice-contracts'
import { isAbsolute, join } from 'node:path'
import type { GivenFolder } from '../../shared/work-folders'
import { type Provider } from '@brobot2/shared'
import type { ApprovalMode } from '@brobot2/runtime'
import { foldProfileName } from '../../shared/runtime-ipc'
import { isTheDefaultProfile } from '../../shared/profile-name'
import type { ItsProvider } from '../../shared/agent-roster'
import { aConversationTitle } from '../../shared/conversation-title'

// Import identity and delivery contracts from their defining modules, as types only.
// They must stay erased so these contracts add no runtime initialization dependency.
import type { CallerIdentity } from './conversation-caller'
import type { TellDelivery } from './message-records'
import type { ResourceRefusal } from '../resources/resources'
import type { ModelRefusal } from '../connections/model-rails'
import type { SendOverflow } from './send-overflow'
import {
  type AStallAGiveNames,
  type RecentConversation,
  refuse,
  type SpawnRail,
  type SpawnRefusal,
  type SpawnRefusalDetail,
} from './spawn-refusals'
import { type GiveRequest, giveRequestSchema, workRequestRefused } from './give-request'
export {
  type AStallAGiveNames,
  describeRail,
  labelsSaid,
  permanenceOf,
  refuse,
  remedyOf,
  retryableOf,
  SPAWN_RAILS,
  type SpawnRail,
  type SpawnRefusal,
  type SpawnRefusalDetail,
  stalledPiecesSaid,
} from './spawn-refusals'
export {
  doneConditionText,
  type GiveRequest,
  giveRequestSchema,
  problemsInItsOwnWords,
  takeOnWorkRequestSchema,
  workBriefText,
  workRequestRefused,
} from './give-request'

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
 *  3. The giver names a conversation by address, or uses "new" to start one. A service is named by its profile.
 *  4. Stalled work is reported in the receipt with its cause and the available actions.
 *  5. A new conversation checks the working folder. This check touches the disk.
 *
 * ⛔ **Nothing is written on any path through {@link admitGive}.** A new agent's identity row, the
 * number the piece takes and the conversation's reservation all come after it, in the host's one
 * synchronous stretch — so a give refused by any rail leaves no row behind (R2).
 */

/**
 * **How long the refusal is expected to be true for** — the fact HO-005 criterion 4 asks the payload
 * to carry, and the one a model has to reason about.
 *
 * ⚑ **Defined in `shared/refusals.ts` since `405` and re-exported here**, because the RENDERER draws
 * the word too; the other doors in `runtime/` import it from this module.
 */
export type { RailPermanence } from '../../shared/refusals'

/**
 * 🔴 **D-042 · what the helper's conversation runs on, as the give's answer says it** (R4: *"the
 * give's answer says what it now runs"*).
 *
 * ⚑ **Read after the brief was delivered**, from the running conversation or its row, so a start
 * that named the provider's default reports the name it sent. ⚑ `how` is what the give did:
 * `started` it, `switched` its pair from this piece on, left it `unchanged`, or reached a
 * conversation that took its place on `another-provider`, whose
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
  readonly how: 'started' | 'switched' | 'unchanged' | 'another-provider'
  readonly from: WhereItCameFrom | null
  /** ⚑ What the give itself named, so the answer claims no half it did not. */
  readonly named: { readonly model: boolean; readonly effort: boolean }
}

/** The start plan returned after the normal give/replacement eligibility checks. */
export interface AdmittedSpawn {
  /** The conversation that gives the work. */
  readonly giverSessionId: string
  /** The giver, as the new conversation's parent; `null` when the new one stands at the top level. */
  readonly parentSessionId: string | null
  readonly profileId: string
  readonly provider: Provider
  /** The folder the give named, or `null`: then the new conversation starts in its profile's home. */
  readonly cwd: string | null
  readonly approvalMode: 'ask' | 'auto'
  /**
   * Who may drive the new conversation. `340`'s `commandedBy`: the giver, as an identity — the app
   * itself is not storable as one, because a slot commanded by the superuser would be commandable by
   * everything.
   */
  readonly commandedBy: CallerIdentity | null
}

/**
 * 🔴 **The conversation giving the work, as much of it as the rails need to see** — its id and its
 * profile for every give (the pieces it holds and the conversation it already has), and its
 * provider, folder and approval mode only when a give would START a conversation.
 *
 * ⚠️ **Its approval mode is the EFFECTIVE mode and never the requested one** — `RuntimeHost`'s
 * `effectiveApprovalOf`: a giver that has already asked to go back to prompting is giving up its
 * laxness, and spending it on a conversation it starts would outlive it.
 */
export interface GivingConversation {
  readonly sessionId: string
  /** The profile it is running as. */
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
  readonly agentExists: (profileSlug: string) => boolean
  /** The conversation an address names, its agent and the provider it runs on; `null` if none. */
  readonly conversationAt: (address: string) => AddressedConversation | null
  /** The giver's most recent conversations with that agent, newest first, read a page at most. */
  readonly recentWith: (profileSlug: string) => {
    readonly rows: readonly RecentConversation[]
    readonly more: boolean
  }
  /** Whether a give to `profileSlug` reaches a service, and how ({@link ServiceAtAGive}). */
  readonly serviceAt: (profileSlug: string) => ServiceAtAGive
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

/** A conversation a give's `to` addressed. */
interface AddressedConversation {
  readonly conversation: string
  readonly profileId: string
  /** `null` for a conversation recorded before its provider was. */
  readonly provider: Provider | null
}

/**
 * A give's target: `normal` for an agent that is not a service, `queue-not-owned` when this app
 * does not own the service queue, `unknown` if its kind can't be told; else its one
 * conversation and its fixed provider, or the provider on which a first conversation is recorded.
 */
export type ServiceAtAGive =
  | { readonly is: 'normal' | 'queue-not-owned' | 'unknown'; readonly why?: string }
  | {
      readonly is: 'service'
      readonly conversation: string | null
      readonly provider: Provider | null
    }

/**
 * ⚑ **What {@link admitGive} answers** — the piece it hangs under and where the work goes: the
 * conversation found, or a START, admitted.
 *
 * A start carries its plan; nothing is written until every rail has answered.
 */
export type GiveAdmission =
  | { readonly ok: false; readonly refusal: SpawnRefusal }
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
            /** The job's name, written as the new conversation's first title. */
            readonly title: string
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
export type GiveOutcome = ToolOutcome<
  {
    readonly piece: string
    readonly label: string
    readonly targetKind: 'new' | 'continued'
    /** When the continued conversation was last active, read before this give; absent for a new one. */
    readonly lastActiveAt?: number | null
    /** 🔴 **The conversation the brief reached** — after a replacement, not the one looked up (R2). */
    readonly owner: string
    /** The conversation the lookup found or the start made, before any replacement. */
    readonly found: string
    readonly profile: string
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
    readonly overflow?: readonly SendOverflow[]
    /** How many open pieces are ahead of it at the service it was queued on; absent for no service. */
    readonly queuedBehind?: number
    readonly recipientState: SendRecipientState
    /** When the piece being worked on at that service stalled, while it stays stalled. */
    readonly queueStalledAt?: number
    /** The giver's stalled pieces in the conversation it went to, with why. */
    readonly stalled?: readonly AStallAGiveNames[]
  },
  /**
   * ⚑ **A resource refusal is the give's last rail** — a file that cannot be kept refuses the whole
   * give before anything is written or sent. 🔴 **D-042 · and a model refusal its choice's**
   * (`model-rails.ts`), judged after the rails and before anything is written.
   */
  SpawnRefusal | ResourceRefusal | ModelRefusal
>

/**
 * Resolve the provider before both conversation lookup and a new start. An explicit provider wins,
 * then a model held by exactly one provider's list, then the identity's default and the giver's.
 * A legacy identity whose conversations differ and has no default still needs a choice.
 * The host uses this same rule before reading a model list and again after that await.
 */
export function theProviderAStartRunsOn(
  asked: Pick<GiveRequest, 'profile' | 'provider'>,
  /** Whether that agent exists. */
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
  if (asked.under !== undefined) {
    const named = held.find((one) => one.piece === asked.under || one.label === asked.under)
    if (named === undefined) return no('no-piece-you-hold-by-that-name', { piece: asked.under })
    under = named
  } else {
    // Left unnamed, the piece is the one the turn it is in drives; else the one piece held whose
    // brief has reached it; else, holding none, its own root. Several, none driven, is ambiguous
    // and names them.
    const received = held.filter((one) => !one.root && one.received)
    const drives = facts.drivenByTheTurn()
    const driven = drives === null ? undefined : held.find((one) => one.piece === drives)
    const inferred =
      driven ??
      (received.length === 1
        ? received[0]
        : received.length > 1
          ? undefined
          : held.find((one) => one.root))
    if (inferred === undefined) {
      const choices = received.length > 1 ? received : held
      return choices.length === 0
        ? no('no-piece-to-give-from')
        : no('name-the-piece-you-give-from', { held: choices.map((one) => one.label) })
    }
    under = inferred
  }

  const service = facts.serviceAt(asked.profile)
  if (service?.is === 'queue-not-owned')
    return no('service-queue-not-owned', { profileId: asked.profile })
  if (service?.is === 'unknown')
    return no('its-kind-is-unknown', {
      profileId: asked.profile,
      ...(service.why ? { executionProblem: service.why } : {}),
    })
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
    if (
      asked.to !== undefined &&
      (asked.to === 'new' ||
        service.conversation === null ||
        facts.conversationAt(asked.to)?.conversation !== service.conversation)
    ) {
      return no('a-service-has-one-conversation', { profileId: asked.profile })
    }
    if (service.conversation === null && service.provider === null) {
      const its = facts.itsProvider(asked.profile)
      return no('its-provider-is-not-chosen', {
        profileId: asked.profile,
        ...(its.from === 'its-conversations-differ' ? { startedOn: its.startedOn } : {}),
      })
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

  const known = facts.agentExists(asked.profile)
  if (!known) return no('no-such-profile', { profileId: asked.profile })
  if (asked.to === undefined) {
    const recent = facts.recentWith(asked.profile)
    return no('name-the-conversation', {
      profileId: asked.profile,
      recent: recent.rows,
      more: recent.more,
    })
  }
  if (asked.to !== 'new') {
    const at = facts.conversationAt(asked.to)
    if (at === null) return no('no-conversation-by-that-address', { address: asked.to })
    if (foldProfileName(at.profileId) !== foldProfileName(asked.profile)) {
      return no('not-that-agents-conversation', {
        address: asked.to,
        profileId: asked.profile,
        ownerProfile: at.profileId,
      })
    }
    const requested = asked.provider ?? facts.theNamedModelsProvider()
    if (requested !== null && at.provider !== null && requested !== at.provider) {
      return no('its-provider-is-fixed', {
        address: asked.to,
        provider: at.provider,
        requestedProvider: requested,
      })
    }
    // For an existing conversation, a supplied folder becomes an additional grant for this work. An unusable folder adds no grant and is explained in the receipt; it does not refuse the give.
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
      goes: { to: 'the-one-it-has', conversation: at.conversation, grant, notGranted },
    }
  }
  const title = aConversationTitle(asked.conversation_title)
  if (title === null) return no('conversation-title-needed')
  const provider = theProviderAStartRunsOn(
    asked,
    known,
    giving,
    facts,
    facts.theNamedModelsProvider(),
  )

  // ⛔ **INHERITED** (499, HO-036): a conversation a give starts runs in its giver's mode.
  const approvalMode = giving.approvalMode

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
  // A give that names no folder starts its conversation in that profile's own home. ⛔ **A BLANK
  // folder is an absent one.** A RELATIVE one is read from the giver's own folder (`726`'s review):
  // `checkSessionCwd` resolves against THIS process's directory, which is `/` for the packaged app.
  // `~` is left to `checkSessionCwd`.
  let cwd: string | null = null
  if (asked.folder !== undefined && asked.folder.trim() !== '') {
    const folder = facts.checkFolder(placedFrom(asked.folder, giving.cwd))
    if (!folder.ok) return no('folder-unusable', { folderReason: folder.reason })
    cwd = folder.path
  }

  const start: AdmittedSpawn = {
    giverSessionId: giving.sessionId,
    // The default profile's conversations stand at the top level, with a root of their own; the
    // task still names this giver.
    parentSessionId: isTheDefaultProfile(asked.profile) ? null : giving.sessionId,
    // An existing agent starts under the spelling the give used, which `provider_session.profile_id`
    // keeps (187).
    profileId: asked.profile,
    provider,
    cwd,
    approvalMode,
    // ⛔ **The giver commands what it starts** (340): an identity a slot holds for as long as it runs.
    commandedBy: by,
  }
  return {
    ok: true,
    asked,
    giver: giving.sessionId,
    under,
    goes: {
      to: 'a-new-conversation',
      start,
      title,
    },
  }
}
