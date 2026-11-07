import type { Provider } from '@brobot2/shared'
import type { WorkerBindingReading } from '../../shared/worker-reading'
import type { AgentState } from '../../shared/agent-state-contracts'
import type { WorkThatNamesIt } from '../../shared/piece-called'
import type { AskToStop, LastEndedTurn } from '../../shared/how-work-stopped'
import type { TaskState } from '../../shared/task-contracts'
import type { ModelAndEffort } from '../../shared/model-choice-contracts'
import type { ArchivedConversations } from '../archived-file'

/**
 * ⚑ **D-017 · R12 — how many conversations `list_agents` names**, the most recently active first,
 * and the answer says how many more there are. Any other can still be messaged and looked at by its
 * id.
 */
export const CONVERSATIONS_LISTED = 50

/**
 * 🔴 **WHO is in a conversation, when this app can say who** (610 · HO-092 §1, §2).
 *
 * ## Identify a conversation by its recorded agent
 *
 * ⚠️ **He asked Ali to relay a message to Ada, and Ali answered:** *"I don't see anyone named 'Ada'
 * among the agents/conversations visible to me in this app… Could you clarify who Ada is?"* — then,
 * asked what it could see: *"Neither is named 'Ada' — that first one's ID just happens to contain
 * 'ada' as a substring, but it's not a person or an agent called Ada."*
 *
 * ⛔ **The app knew, and the same screen said so twice** — *SPAWNED THIS CONVERSATION · Ada* and
 * *Task #2 from Ada*. ⚑ **Ali reasoned WELL on the data it had**: a session id carrying `ada` as a
 * substring really is a coincidence worth naming. 🔴 **It did careful work and reached a false
 * conclusion because this payload answered badly**, which is why the repair is here and not in
 * anybody's instructions (standing rule 15).
 *
 * ## ⚠️ Why every assertion passed
 *
 * ⛔ **`list_agents` said so in its own description:** *"Reports **id**, project, profile, state and
 * where each came from."* ⚑ **No name — so nothing ever claimed one was there**, and a test that
 * checks a field exists is not a test that the row is usable. `HO-092` §2.2 is right that this is
 * `530`'s clipped grant line again: a surface answering correctly and saying nothing anybody can
 * use.
 *
 * ## 🔴 A union rather than a `name` beside the `profile` field it replaces, and §3 is the reason
 *
 * ⛔ **{@link agentName} has an input it must never be given**, and `runtime-ipc.ts` states it
 * twice: *"a conversation the sweep found in the user's own provider home has no profile at all,
 * and calling it BroBot would invent one."* ⚠️ **A nullable `name` beside a nullable `profile` can
 * represent exactly that invention** — `(profile: null, name: 'BroBot')` — so the pair would leave
 * the defect writable by the next edit. ⚑ **On this shape the name exists on ONE arm only**, which
 * is `a-value-beside-a-word-or-a-union-of-arms`' test for a union, and the invented name is
 * unconstructable rather than merely unwritten.
 *
 * ⚑ **`profile` MOVED onto the arm where it is honest** rather than staying beside the
 * discriminant, so the two cannot disagree about one fact — `607`'s rule for the split it made of
 * {@link TurnOrigin}, one payload over.
 */
export type WhoseConversation =
  | {
      /**
       * ⚑ **This conversation NAMES an identity**, which is the positive fact — see
       * {@link whoseConversationIs} for why the question is asked that way round.
       */
      readonly is: 'an-identity-this-app-holds'
      /**
       * ⛔ **The slug, which is the spendable half** — what `give_work` and `create_agent` take,
       * and what `list_profiles` reports. It is the spelling the conversation RAN under; see
       * {@link SessionStore.identityOf} for why that is not always the folded one.
       */
      readonly profile: string
      /**
       * 🔴 **What a person called this identity** — {@link agentName}, the derivation the rail
       * already draws, so a name cannot mean one thing on a screen and another in a tool answer.
       *
       * ⚠️ **Never absent, and never the empty string.** With no roster row, or a row nobody has
       * named, it is {@link profileLabel} — the slug, or *BroBot* for the default one — which is
       * that function's own contract and is a REPORT rather than a guess.
       */
      readonly name: string
    }
  | {
      /**
       * ⛔ **This app cannot say whose conversation this is, and must not guess.**
       *
       * ⚠️ **{@link SessionSlot.profileId}'s own words:** *"`null` means 'this slot cannot name its
       * identity', never 'it has none.' A resumed row that was adopted out of a provider home
       * carries no `profile_id`, and the honest answer for such a slot is to stay out of the
       * question rather than to guess a default and refuse a stranger."*
       *
       * This includes the person's own conversations discovered in a provider home. `agentName(null, …)` would incorrectly name them BroBot.
       */
      readonly is: 'an-identity-this-app-cannot-name'
    }

/**
 * ⚑ **D-017 · R12 — what `list_agents` is handed**: the conversations a caller may reach, newest
 * activity first and cut at {@link CONVERSATIONS_LISTED}, and how many more there are.
 */
export interface AgentsListed {
  readonly agents: readonly AgentCard[]
  readonly notListed: number
}

/** ⚑ **D-017 · R12** — one conversation a caller may reach, before it is cut into a list. */
export interface VisibleConversation {
  readonly id: string
  /** Its newest activity — what every list of agents is ordered by. */
  readonly at: number
  /** Its card, read only if it makes the cut. */
  readonly card: () => AgentCard
}

/** One archived conversation a caller may reach: its card, and when it was archived (epoch ms). */
export interface ArchivedAgent {
  readonly card: AgentCard
  readonly archivedAt: number
}

/** The archived conversations a caller may reach, cut as every list of agents is. */
export interface ArchivedListed {
  readonly archived: readonly ArchivedAgent[]
  readonly notListed: number
  /** When this was read, to place each `archivedAt` on a day. */
  readonly readAt: number
}

/** ⚑ **D-017 · R12** — the cut every list of agents takes, and how many it left out. */
function listedFrom(reachable: readonly VisibleConversation[]): AgentsListed {
  return {
    agents: reachable.slice(0, CONVERSATIONS_LISTED).map((one) => one.card()),
    notListed: Math.max(0, reachable.length - CONVERSATIONS_LISTED),
  }
}

/** ⚑ **D-016 · one piece on an agent's card** — see {@link AgentCard.pieces}. */
export interface PieceOnTheCard {
  readonly piece: string
  readonly label: string
  /** Its title — a root's newest, `null` while nobody has titled it. */
  readonly title: string | null
  /** `null` for the root: its state is the conversation's, which is the card's. */
  readonly state: TaskState | null
}

/** A request a conversation's turn is stopped on until a person answers it: what, and since when. */
export interface StoppedOnAPerson {
  /** What it asks, as a noun phrase: *its request to use Bash (npm test)*. */
  readonly asks: string
  /** When it was asked, epoch ms. */
  readonly since: number
  /** When this was read, epoch ms — what {@link since} is said against. */
  readonly readAt: number
}

export interface AgentCard {
  /** Stable worker identity, separate from the state and process reading. */
  readonly worker?: WorkerBindingReading
  /**
   * The session id — what every tool that takes an agent takes, beside the label of a piece it owns
   * (D-016 · commit 7 · R1).
   */
  readonly agent: string
  /**
   * 🔴 **Who is in it, by NAME and by slug** (610, HO-092 §1) — see {@link WhoseConversation}.
   *
   * ⛔ **It was `profile: string | null` and it is what Ali could not read.** ⚑ The slug did not
   * go anywhere: it is `whose.profile`, on the arm where this app can say there is one.
   */
  readonly whose: WhoseConversation
  readonly provider: Provider | null
  /**
   * ⚑ **D-017 · R11 — what the agent is doing, in the ONE derivation every reader asks**
   * ({@link agentStateOf}): needs you, active, waiting on another conversation's answer, running in
   * the background, scheduled, waiting on the conversations holding work it gave out (D-036), or
   * idle (`05` rule 5).
   *
   * ⛔ **Whether a process runs is never part of it** — a conversation this app is not running reads
   * `idle` unless somebody owes it something, and a message starts it; ⚑ or *scheduled*, when it
   * holds a job its wake-up starts it for (D-029). ⚠️ It replaced the handle's status plus three
   * states of the SLOT (`starting`, `ending`, `open-nothing-running`), each of which told a reader
   * a process fact.
   */
  readonly state: AgentState
  /**
   * What its turn is stopped on until a person answers it — a request its provider raised that only
   * a person can settle — or `null`. ⚑ While it is set, nothing sent to it goes in: an interrupt is
   * refused too (`a-person-is-being-asked`), so only the person's answer moves it.
   */
  readonly stoppedOnAPerson: StoppedOnAPerson | null
  /**
   * Who is driving it in THIS process — dies with the process, by design (340 §0). ⚑ **D-017 · for a
   * conversation this app is not running it is the recorded PARENT**, which is what the start its
   * next message makes writes into the slot it reserves — so the card does not change across that
   * start.
   */
  readonly spawnedBy: string | null
  /** Who started it, from the ledger — the half that survives a restart (criterion 8). */
  readonly parent: string | null
  /**
   * 🔴 **D-016 · commit 7 · R2 — the work that names this conversation**
   * (`SessionStore.workThatNames`): what `list_agents`' line leads with.
   */
  readonly named: WorkThatNamesIt | null
  /**
   * ⚑ **W4.209 · what to call {@link parent}**, by the piece it started this one from — its agent's
   * name and that piece, as an agent's record and the launch line say it (`theStarterCalled`), ⛔ never
   * by its work now; its name alone when it started this one by a message. `null` with no parent.
   */
  readonly parentCalled: string | null
  /**
   * 🔴 **D-016 · the pieces it holds** — its root first, with `state: null` because a root's state is
   * the card's own (R1), then its OPEN pieces with theirs. ⛔ Open only (spec D17): the record of
   * every piece is `list_tasks`'.
   */
  readonly pieces: readonly PieceOnTheCard[]
  /**
   * 🔴 **How the last turn that ENDED stopped, who asked, and when** (395 §1, 484) — or `null`
   * because there is no closed turn to report on.
   *
   * ## ⛔ Why the card grew a field rather than the tool growing a sentence
   *
   * ⚠️ **{@link state} answers *"what is it doing now"* and answered nothing else.** After a fault
   * and after an interruption it is `idle` in both cases, so a parent that had just watched a child
   * stop could not tell *somebody stopped this* from *this broke* — `395` §1's requirement, at the
   * one surface a parent has. ⛔ Composing the answer inside `agent-tools.ts` would put the
   * derivation in the layer that renders it, where `list_agents` and `get_agent_status` would be
   * free to read it two ways.
   *
   * ⚑ **`null` is *no closed turn*, and it is not `nothing-has-said`.** A conversation that has
   * never finished a turn has no ending to report; one whose turn ended with no terminal row has an
   * ending this app did not see. Those are different facts and `222` §3 is the dispatch that
   * separated them.
   *
   * ## 🔴 484 · it was called `lastTurn` and a reader could not tell WHICH turn
   *
   * ⛔ **HO-031 §2.2:** *"stale or describing an older turn — unclear which, which is itself the
   * defect."* ⚠️ The narrowing has been `closed_at IS NOT NULL` since `395` and the value never said
   * so, so a parent holding it beside this card's live {@link state} had a question the payload
   * could not answer. ⚑ The name says the subject and {@link LastEndedTurn} makes the other reading
   * unrepresentable; the ambiguity was the defect, not the staleness.
   */
  readonly lastEndedTurn: LastEndedTurn | null
  /**
   * 🔴 **The last time anybody asked this conversation's work to stop** (484, HO-031 §2.1) — `null`
   * when no row says.
   *
   * ## ⛔ The measurement this field exists for
   *
   * ⚠️ **A person stopped an agent through the UI, the app wrote `work_interrupted {"by":
   * "a-person"}`, and `get_agent_status` answered `lastTurn.who: null`.** ⛔ **The supervisor
   * watching would have recorded that its child recovered on its own** — HO-031 §2.1's *"a
   * supervisor that cannot see human intervention in its own subtree will confidently narrate a
   * false history"*, which is worse than the digest case because an agent's false belief becomes a
   * written report.
   *
   * 🔴 **The hole is `turn_id`, and it is structural rather than a bug in the fold.**
   * {@link RuntimeHost.recordTheAsk} writes the row for every caller at every moment, and
   * `SessionStore`'s `turnFor` gives it `turn_id = null` when nothing is running — so a Stop on an
   * idle or stalled conversation is invisible to {@link lastEndedTurn}, which joins on the turn.
   * ⚑ This asks the CONVERSATION instead, which is the subject an interruption actually has.
   *
   * ## ⚠️ Two fields and not one, and the reason is what each is about
   *
   * ⛔ **Folding this into {@link lastEndedTurn}'s `who` would report a person's Stop of an idle
   * conversation as the ending of a turn it never touched** — a second false sentence in place of
   * the first. ⚑ {@link AskToStop.turn} is what lets a reader see when the two are about one turn
   * — and since `709` (R43) they are still two facts: the ask, and the ending in the provider's word.
   *
   * ## ⚑ 494 · a permission answered `cancel` is one of these asks
   *
   * ⛔ **It is here because of THIS payload rather than because of that door.** This field and
   * {@link lastEndedTurn} are read together off one card, and `494` teaches the second to name the
   * person who cancelled; a field beside it answering *no row says* about the same press is the
   * defect above, arriving between two fields instead of between a ledger and a tool.
   */
  readonly lastAskToStop: AskToStop | null
  /**
   * 🔴 **D-042 · R6 — what it runs on, so a giver can check what its helper runs**: the pair it is
   * selected to run (`null` for a conversation nothing has named one for yet — an adopted one, or a
   * row from before D-042 that has not started since: every helper until its next start), and what
   * its provider last REPORTED running (`null` until it has said). ⚠️ `reported.effort` is
   * `null` until the provider reports one — Claude's, as a turn ends (F099): until then its effort is
   * what was requested.
   */
  readonly runsOn: {
    readonly selected: ModelAndEffort | null
    readonly reported: { readonly model: string; readonly effort: string | null } | null
  }
  /**
   * 🔴 **676 · F3 — how many ledger rows THIS card's reads could not read** — the two fields above
   * that come from the ledger, {@link lastEndedTurn} and {@link lastAskToStop}, counted once each
   * (`RowsUnread`'s rule): a count, never a cause.
   *
   * ⛔ **Until `676` both skipped a torn row with a warning and nothing else** (`671` F3), so a card
   * could say *nobody asked it to stop* about a conversation whose newest ask was the torn row.
   * ⚠️ **Above `0`, either field may be OLDER than the truth** — the rows counted are the ones each
   * read passed over on its way to its answer.
   *
   * ⚠️ **The card's own**, and never folded into a list's count: a card is read on its own by
   * `get_agent_status`, and it must say so there. ⚑ **D-016 · its {@link pieces} are read under the
   * same count**, so a torn row one of them met is counted here too. ⛔ **D-036 · never a row of
   * another conversation's ledger**: the work it gave out, which its {@link state} and its pieces'
   * waits read, is folded from the ledgers of the conversations holding it, and what those cannot
   * read — a torn row, or a whole ledger whose fold throws — is skipped and warned under that read's
   * own note: never counted here nor in {@link ledgersSkipped}, whose words say *its record*, and
   * never thrown out of the card.
   */
  readonly rowsUnread: number
  /** ⚑ **D-017 · R8** — `1` when this conversation's record could not be read at all, else `0`. */
  readonly ledgersSkipped: number
}

export function agentsVisibleTo(
  reachable: readonly VisibleConversation[],
  me: string | null,
  archived: Pick<ArchivedConversations, 'has'>,
): AgentsListed {
  // An archived conversation is out of sight here, as in a person's lists; it is still reached
  // by its label or id, and {@link archivedVisibleTo} lists it.
  return listedFrom(
    reachable.filter(
      // The caller's own is always listed.
      (one) => one.id === me || !archived.has(one.id),
    ),
  )
}

export function archivedVisibleTo(
  reachable: readonly VisibleConversation[],
  archive: Pick<ArchivedConversations, 'archivedAt'>,
  now: () => number,
): ArchivedListed {
  const archived = reachable
    .flatMap((one) => {
      const archivedAt = archive.archivedAt(one.id)
      return archivedAt === null ? [] : [{ card: one.card, archivedAt }]
    })
    .sort((one, other) => other.archivedAt - one.archivedAt)
  return {
    archived: archived
      .slice(0, CONVERSATIONS_LISTED)
      .map(({ card, archivedAt }) => ({ card: card(), archivedAt })),
    notListed: Math.max(0, archived.length - CONVERSATIONS_LISTED),
    readAt: now(),
  }
}
