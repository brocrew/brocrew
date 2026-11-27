/**
 * A give's refusals: the closed list of rails, each one's permanence and remedy, and the sentence a
 * refusal says. Split out of spawn-rails.ts as a pure move.
 */
import type { TaskStallCause } from '../../shared/task-contracts'
import { workStateWord } from '../../shared/work-state-words'
import { refusalReason } from '../../shared/refusals'
import { type Provider } from '@brobot2/shared'
import { PROVIDER_NAME } from '../../shared/runtime-ipc'
import type { StartedOn } from '../../shared/agent-roster'
import type { RailPermanence, RefusalRemedy } from '../../shared/refusals'
import { undrivenSentence } from '../../shared/tasks'

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
  /** This app does not own the queue for the requested service. */
  'service-queue-not-owned',
  /** Whether the agent is a service can't be told, and a service may be at stake. */
  'its-kind-is-unknown',
  'service-provider-is-fixed',
  /** A give to a normal agent named no conversation: `to` is "new" or an address. */
  'name-the-conversation',
  /** `to` named an address no conversation answers to. */
  'no-conversation-by-that-address',
  /** `to` named a conversation of another agent than `profile`. */
  'not-that-agents-conversation',
  /** The addressed conversation runs on another provider; a conversation keeps its provider. */
  'its-provider-is-fixed',
  /** A give to "new" named no conversation_title. */
  'conversation-title-needed',
  /** A service has one conversation, so a give to it names no other. */
  'a-service-has-one-conversation',
  /**
   * No agent by that name. ⛔ A typo is not a new agent; the sentence names `list_profiles` and
   * `create_agent`.
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
  'service-queue-not-owned': 'until-a-person-changes-it',
  'its-kind-is-unknown': 'until-a-person-changes-it',
  'service-provider-is-fixed': 'permanent',
  'name-the-conversation': 'permanent',
  'no-conversation-by-that-address': 'permanent',
  'not-that-agents-conversation': 'permanent',
  'its-provider-is-fixed': 'permanent',
  'conversation-title-needed': 'permanent',
  'a-service-has-one-conversation': 'permanent',
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
  'service-queue-not-owned': null,
  'its-kind-is-unknown': null,
  'service-provider-is-fixed': null,
  'name-the-conversation': null,
  'no-conversation-by-that-address': null,
  'not-that-agents-conversation': null,
  'its-provider-is-fixed': null,
  'conversation-title-needed': null,
  'a-service-has-one-conversation': null,
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
  executionProblem?: string
  /** The piece the caller named, as it spelled it — echoed back, never what the app found. */
  piece?: string
  /**
   * `name-the-piece-you-give-from` — the labels of the open pieces that have reached the caller, its
   * root left out (D-022 · R4).
   */
  held?: readonly string[]
  /** The service's fixed provider and its current model list, for a different-provider refusal. */
  provider?: Provider
  requestedProvider?: Provider
  choices?: readonly string[]
  /** `its-provider-is-not-chosen` — how many of its conversations started on each provider. */
  startedOn?: StartedOn
  /** The address `to` named. */
  address?: string
  /** `not-that-agents-conversation` — the agent the addressed conversation belongs to. */
  ownerProfile?: string
  /** `name-the-conversation` — the giver's most recent conversations with that agent, newest first. */
  recent?: readonly RecentConversation[]
  /** `name-the-conversation` — whether it has more such conversations than `recent` lists. */
  more?: boolean
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
  const named = labelsSaid(
    stalled.map(({ label, cause }) => {
      const reason = undrivenSentence(cause)
      return cause === 'turn_ended'
        ? `${label} (${workStateWord('stalled', cause)}, ${reason})`
        : `${label} (${reason})`
    }),
  )
  return `It still holds ${named} from you: follow ${them} up with message_agent , or take ${them} back with withdraw_task.`
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
      return `Say which of your pieces this is for (${labelsSaid(detail.held)}): give again naming it as under.`
    case 'no-piece-you-hold-by-that-name':
      return 'You hold no open piece by that name, so nothing was given. list_tasks names what you hold.'
    case 'service-queue-not-owned':
      return 'this app may be open twice. Ask the person with request_action to close any other BroCrew instance using this workspace and reopen this one, or give the work to another agent.'
    case 'its-kind-is-unknown':
      if (detail.executionProblem) return `Not sent: ${detail.executionProblem}`
      return `Not sent: the services list can’t be read. Give the work to another agent, or ask a person; this app can’t tell whether “${detail.profileId ?? '?'}” is a service.`
    case 'name-the-conversation': {
      const recent = (detail.recent ?? []).map(
        (one) => `${one.address}${one.title === null ? '' : ` · ${one.title}`}`,
      )
      const listed =
        recent.length === 0
          ? ` You have no conversation with “${detail.profileId ?? '?'}” yet.`
          : ` Your recent conversations with “${detail.profileId ?? '?'}”: ${recent.join('; ')}${detail.more === true ? '; and more (search finds the rest)' : ''}.`
      return `Not sent: say which conversation this goes to. Give it again with to: "new" for a new job, or to: a conversation's address to continue its job.${listed}`
    }
    case 'no-conversation-by-that-address':
      return `Not sent: no conversation has the address ${detail.address ?? '?'}. list_agents lists conversations; to: "new" starts one.`
    case 'not-that-agents-conversation':
      return `Not sent: ${detail.address ?? '?'} is a conversation of “${detail.ownerProfile ?? '?'}”, not of “${detail.profileId ?? '?'}”.`
    case 'its-provider-is-fixed':
      return `Not sent: conversation ${detail.address ?? '?'} runs on ${detail.provider === undefined ? 'another provider' : PROVIDER_NAME[detail.provider]} and keeps it. To use ${detail.requestedProvider === undefined ? 'another provider' : PROVIDER_NAME[detail.requestedProvider]}, give with to: "new" and a brief pointing at ${detail.address ?? 'that conversation'}.`
    case 'conversation-title-needed':
      return 'Not sent: a new conversation needs conversation_title, naming the job.'
    case 'a-service-has-one-conversation':
      return `Not sent: ${detail.profileId ?? '?'} has one service conversation. Use its address or omit to.`
    case 'no-such-profile':
      return `Not sent: no agent is called ${detail.profileId ?? '?'}. list_profiles names them; create_agent makes one.`
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

/** One of the giver's recent conversations with an agent, as a refusal lists it. */
export interface RecentConversation {
  readonly address: string
  readonly title: string | null
}
