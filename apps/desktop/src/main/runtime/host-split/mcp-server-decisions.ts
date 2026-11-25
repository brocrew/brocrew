import type { McpServerAsked, McpServerRequestOutcome } from './host-command-contracts'
import { type ToolRefusal, AGENT_TOOL_SERVER, TOOL_NAMES } from '../agent-tools'
import { foldProfileName } from '../../db/identity'
import {
  theAddressOf,
  A_PERSON_DID_IT,
  ServerNotReached,
  ITS_ASKER_IS_STARTING,
  ANSWERED_FIRST,
  takenDownSays,
  type ApprovalCommitted,
  THE_ASKER_WAS_NOT_TOLD,
  type RequestSettled,
  ItsAskerIsStarting,
  TOLD_ABOUT_A_SERVER_REQUEST,
} from './server-requests'
import { newMcpServerRequestId } from '../../db/ids'
import type {
  AgentIdentity,
  AnswerAck,
  RuntimeEventMessage,
  RuntimeChangeMessage,
} from '../../../shared/runtime-ipc'
import {
  type ExternalMcpServerReach,
  type ExternalMcpServerRow,
  externalMcpNameRefusal,
  externalMcpUrlRefusal,
  collidingToolNames,
  externalMcpCollisionRefusal,
} from '../../../shared/external-mcp'
import {
  type McpServerRequestWaiting,
  MCP_SERVER_REQUEST_TOLD,
  theToolsItOffered,
  type McpServerRequestEnding,
} from '../../../shared/mcp-server-requests'
import { errorMessage } from '../session-disclosures'
import {
  // ⚑ **516 · the one place this app speaks MCP as a client, and the shape a launch is handed.**
  discoverExternalMcpTools,
} from '@brobot2/runtime'
import { type Caller, whoDidIt } from '../conversation-caller'
import type { ActedBy } from '../../../shared/who-did-it'
import type {
  McpServerRequestSettledEvent,
  MailboxKind,
  McpServerRequestedEvent,
} from '../../../shared/conversation-events'
import type { HostedSession, ItsToolsMoved } from './hosted-session'
import type { SessionSlot } from './session-slot'
import type { WhereHeldWordsWait } from './deliveries'
import type { GivingConversation, HeldPiece } from '../spawn-rails'
import type { FactsAQueueCarries } from '../message-records'
import type { SessionStore } from '../../db/session-store'

/** What the server-request commands reach in RuntimeHost, each read only when called. */
interface ServerRequestHost {
  runningAs(sessionId: string): GivingConversation | null
  slotOf(sessionId: string): SessionSlot | undefined
  heldBy(conversation: string): readonly HeldPiece[]
  publishOurs(session: HostedSession, event: McpServerRequestedEvent): void
  theWorldMoved(what: RuntimeChangeMessage['what']): void
  showTheWindowsLookingAt(sessionId: string, message: RuntimeEventMessage): void
  stateMayHaveMoved(conversation: string): void
  emitOurs(session: HostedSession, message: RuntimeEventMessage): void
  theOneInItsPlace(sessionId: string): string
  holdUntilItStarts(
    sessionId: string,
    text: string,
    facts: FactsAQueueCarries,
    kind: MailboxKind,
    kept: (where: WhereHeldWordsWait) => void,
  ): void
  keptStopped(sessionId: string): boolean
  runsNow(sessionId: string): boolean
  ensureRunning(sessionId: string, window: null): Promise<string>
  reopenForItsTools(conversation: string, told: ItsToolsMoved): boolean
  now(): number
}

/** An agent's request to register an external MCP server, and how a person's decision settles it. */
export class McpServerRequests {
  /** MCP server requests a press is deciding right now. */
  private readonly mcpServerRequestsBeingDecided = new Set<string>()

  constructor(
    private readonly deps: {
      readonly store: Pick<
        SessionStore,
        | 'agentIdentityOf'
        | 'append'
        | 'atomically'
        | 'externalMcpServers'
        | 'externalMcpServersFor'
        | 'grantExternalMcpServer'
        | 'mcpServerRequestWasMade'
        | 'mcpServerRequestsWaiting'
        | 'nextOrdinal'
        | 'recordedOne'
        | 'registerExternalMcpServer'
        | 'removeExternalMcpServer'
        | 'setExternalMcpServers'
      >
    },
    private readonly host: ServerRequestHost,
  ) {}

  /**
   * An agent asks the person to register an external MCP server. Any agent may ask: the person's
   * press is the guard. This writes one `mcp_server_requested` row in the asking conversation and
   * contacts nothing; the address is first asked what it offers when the person approves
   * ({@link decideMcpServerRequest}). The caller is not held: it is told when the person decides.
   *
   * Refused when a server of that name, or at that address, is registered (a request cannot change
   * one, and a second name for a registered address could reach agents its own registration does
   * not), or when an agent it names does not exist.
   */
  requestMcpServer(me: string, said: McpServerAsked): McpServerRequestOutcome {
    const no = (
      rail: ToolRefusal,
      detail: Readonly<Record<string, unknown>>,
    ): McpServerRequestOutcome => ({ ok: false, rail, detail })
    const caller = this.host.runningAs(me)
    const session = this.host.slotOf(me)?.session ?? null
    if (caller === null || session === null) {
      return no('malformed-request', {
        problems: ['this conversation is not running in this app, so nothing was asked'],
      })
    }
    const name = foldProfileName(said.name.trim())
    const url = new URL(said.url.trim()).href
    const registered = this.deps.store
      .externalMcpServers()
      .find((server) => server.name === name || theAddressOf(server.url) === theAddressOf(url))
    if (registered !== undefined) {
      return no('server-already-registered', {
        name: registered.name,
        ...(registered.name === name ? {} : { address: url }),
      })
    }
    const agents = [...new Set(said.agents.map((one) => foldProfileName(one)))]
    const unknown = agents.filter((one) => this.deps.store.agentIdentityOf(one) === null)
    if (unknown.length > 0) return no('no-agent-by-that-name', { agents: unknown })
    let piece: { readonly piece: string; readonly label: string } | null = null
    if (said.piece !== null) {
      const named = said.piece
      const held = this.host.heldBy(me).find((one) => one.label === named || one.piece === named)
      if (held === undefined) {
        return no('malformed-request', {
          problems: [`piece names no piece of work you hold: ${named}`],
        })
      }
      piece = { piece: held.piece, label: held.label }
    }
    const requestId = newMcpServerRequestId()
    this.host.publishOurs(session, {
      type: 'mcp_server_requested',
      requestId,
      name,
      url,
      reaches: said.reaches,
      whoGetsIt: said.whoGetsIt,
      ...(said.whoGetsIt === 'only-these-agents' ? { agents } : {}),
      requestedBy: foldProfileName(caller.profileId),
      ...(piece === null ? {} : piece),
    })
    return { ok: true, requestId }
  }

  /**
   * Replace the external MCP servers one identity is associated with, and read the identity back;
   * `null` when no agent has that name.
   */
  setExternalMcpServers(
    profileSlug: string,
    externalMcpServerIds: readonly string[],
  ): AgentIdentity | null {
    if (!this.deps.store.setExternalMcpServers(profileSlug, externalMcpServerIds)) return null
    // A second window showing this identity's sheet re-reads.
    this.host.theWorldMoved('agents')
    return this.deps.store.agentIdentityOf(profileSlug)
  }

  /**
   * 🔴 **Register one external MCP server — and this method IS the refusal rail** (516, HO-040 §4.3,
   * `HO-042` §2).
   *
   * ## ⛔ Three refusals, in this order, and the order is the point
   *
   * 1. **The name**, against {@link AGENT_TOOL_SERVER} and the `__` rule — cheap, local, and it
   *    needs no network.
   * 2. **The URL**, loopback and credential-free — also local.
   * 3. 🔴 **The ROSTER**, which is the only one that costs a handshake: this app asks the server
   *    what it offers and refuses the WHOLE server if any of its raw tool names is one of ours.
   *
   * ⚑ **Cheapest first, so a typo never opens a socket**, and each refusal is a sentence naming what
   * to do about it (`425`).
   *
   * ## 🔴 Why the whole server, and why not a proxy
   *
   * Refuse an external server whose tools collide with app tool names. The probe assumes a loopback server at a URL the person configured; it does not close a server's ability to change its inventory afterward. Revisit proxy enforcement if registration admits third-party or remote servers; see {@link externalMcpCollisionRefusal}.
   *
   * ## ⚠️ What this preflight is NOT
   *
   * ⛔ **It is not repeated at every launch**, which `507` §4.2 recommended and this build does not
   * do. A handshake that fails open on its own deadline cannot be a rail — a slow server would
   * simply not be checked — so the guarantee rests where the PO put it: on the provider's own deny
   * vocabulary, derived from `TOOL_NAMES` for every granted server on every launch
   * (`claudeMcpServersFor` and `forbiddenExternalSpellings`). ⚑ **That set does not depend on asking
   * the server anything**, so a roster that drifts after registration still cannot present one of
   * our names to the model. ⚠️ What is lost is DETECTION of the drift, and `516`'s response files it
   * as a finding rather than leaving it implied.
   *
   * @throws an `Error` carrying the sentence a person is shown.
   */
  async registerExternalMcpServer(said: {
    name: string
    url: string
    reach: ExternalMcpServerReach
  }): Promise<ExternalMcpServerRow> {
    const name = said.name.trim()
    const url = said.url.trim()
    await this.whatAServerOffers(name, url)
    // ⛔ **`reach` passes through this door UNJUDGED, and that is the difference between it and the
    // three refusals above** (524, `HO-048` §1). Those answer *may this be registered at all*; this
    // answers *who is it for*, which is a person's choice and has no wrong value — the PO's whole
    // point is that the app stopped asking it once per identity and started asking it once.
    const row = this.deps.store.registerExternalMcpServer({ name, url, reach: said.reach })
    // ⛔ **The store's null is *that name is taken*, and it is the only reason it answers one** — the
    // creation door's rule one table over (`419`). A sentence naming the folded name is what a
    // person can act on.
    if (row === null) {
      throw new Error(
        `There is already a server called ${foldProfileName(name)}. ` +
          `Remove it first, or register this one under another name.`,
      )
    }
    this.takeDownTheRequestsFor(row.name)
    return row
  }

  /**
   * The person registered this name themselves: an agent's request for it still waiting is taken
   * down. The server is registered whatever becomes of that, so this never throws. A request whose
   * asker is starting is taken down once that start has arrived, if the name is still registered,
   * without holding up the registration; any press on its card meanwhile takes it down as well
   * ({@link settleNow}).
   */
  private takeDownTheRequestsFor(name: string): void {
    let waiting: readonly McpServerRequestWaiting[]
    try {
      waiting = this.deps.store.mcpServerRequestsWaiting()
    } catch (error) {
      console.warn(
        `runtime host registered ${name} but could not read the requests it takes down: ${errorMessage(error)}`,
      )
      return
    }
    for (const one of waiting) {
      if (foldProfileName(one.requested.name) !== foldProfileName(name)) continue
      const { requestId } = one.requested
      const told = MCP_SERVER_REQUEST_TOLD.superseded(requestId, name)
      const couldNot = (error: unknown): void => {
        console.warn(
          `runtime host registered ${name} but could not take down request ${requestId}: ${errorMessage(error)}`,
        )
      }
      try {
        if (this.settleNow(one, 'superseded', A_PERSON_DID_IT, {}, told).is !== 'starting') continue
      } catch (error) {
        couldNot(error)
        continue
      }
      // Once its start has arrived, and only while the name is still registered: the person may
      // have removed it meanwhile.
      void this.untilItsAskerHasArrived(one.conversation)
        .then((arrived) => {
          if (!arrived) {
            couldNot('the conversation that asked is still starting')
            return
          }
          if (this.itsNameIsRegistered(name))
            this.settleNow(one, 'superseded', A_PERSON_DID_IT, {}, told)
        })
        .catch(couldNot)
    }
  }

  /**
   * What a server offers, once its name and address pass the rules — the network call a
   * registration makes before it writes anything, the Add form's and an approval's alike. Refused
   * whole when one of its tools is named as one of this app's own.
   */
  private async whatAServerOffers(name: string, url: string): Promise<readonly string[]> {
    // ⛔ **`AGENT_TOOL_SERVER`, imported and never spelled** — it owns the word `brobot` (`466`), and
    // a literal here would be a second authority on the one name that must never be taken.
    const badName = externalMcpNameRefusal(name, AGENT_TOOL_SERVER)
    if (badName !== null) throw new Error(badName)
    const badUrl = externalMcpUrlRefusal(url)
    if (badUrl !== null) throw new Error(badUrl)
    let offered: readonly string[]
    try {
      offered = await discoverExternalMcpTools(url)
    } catch (error) {
      // ⚠️ **NOT PERFORMED rather than assumed** (standing rule 13). A server that could not be
      // asked is not a server that was found clean: the registration is refused, and the sentence
      // says which half failed so a person can start the thing and try again.
      throw new ServerNotReached(url, error)
    }
    // ⛔ **`TOOL_NAMES`, imported from `agent-tools.ts` and never copied** — brief §3.2.
    const colliding = collidingToolNames(offered, TOOL_NAMES)
    if (colliding.length > 0) {
      throw new Error(externalMcpCollisionRefusal(foldProfileName(name), colliding))
    }
    return offered
  }

  /**
   * A person approves or refuses one agent's request to register an MCP server. The command
   * carries only the request's id: what is registered — name, address and who gets it — is read
   * from the request's own row, so it is exactly what the card showed.
   *
   * Approving a request whose name the person has registered meanwhile ends it as `superseded`
   * without asking the address anything. Otherwise approving asks the address what it offers
   * ({@link whatAServerOffers}), then commits in one transaction ({@link commitAnApproval}): the
   * request still waits, no other name holds the address and the name is free; the server's row,
   * the grants for the agents the request named, and the request settled as approved. Only that
   * commit answers "Registered". An address that cannot be asked keeps the request open with
   * nothing written, unless it ended, or its name was registered, while the address was asked. A
   * clash with this app's tool names, or another name at the address, ends it as
   * `could-not-register`; the person registering that name meanwhile ends it as `superseded`. A
   * press that finds its asker starting writes nothing and says to press again in a moment.
   * Refusing registers nothing. Every ending is written whole or not at all, and the asker is told
   * as it commits.
   */
  async decideMcpServerRequest(
    requestId: string,
    approve: boolean,
    by: Caller,
  ): Promise<AnswerAck> {
    const waiting = this.mcpServerRequestWaiting(requestId)
    if (waiting === null) return this.noLongerWaiting(requestId)
    if (this.mcpServerRequestsBeingDecided.has(requestId)) {
      return {
        outcome: 'refused',
        reason: 'that request is being decided right now, so this press did nothing',
        stillOpen: true,
      }
    }
    const asked = waiting.requested
    const actor = whoDidIt(by)
    this.mcpServerRequestsBeingDecided.add(requestId)
    try {
      if (!approve) {
        return await this.endARequest(
          waiting,
          'refused',
          actor,
          {},
          MCP_SERVER_REQUEST_TOLD.refused(requestId, asked.name, asked.url),
          { outcome: 'taken', reason: 'Refused. Nothing was registered.' },
        )
      }
      const couldNotRegister = (why: string): Promise<AnswerAck> =>
        this.endARequest(
          waiting,
          'could-not-register',
          actor,
          { why },
          MCP_SERVER_REQUEST_TOLD.couldNotRegister(requestId, asked.name, why),
          { outcome: 'refused', reason: `Could not register: ${why}`, stillOpen: false },
        )
      // A name the person registered meanwhile ends it before anything is asked of the address.
      const takenFirst = await this.ifItsNameIsTaken(waiting)
      if (takenFirst !== null) return takenFirst
      let offered: readonly string[]
      try {
        offered = await this.whatAServerOffers(asked.name, asked.url)
      } catch (error) {
        if (error instanceof ServerNotReached) {
          // Read again, with nothing awaited before the answer: while the address was asked, the
          // request may have ended, or the person registered its name. Only one still waiting with
          // its name free gets the approve-again answer.
          const endedMeanwhile = this.endedOrTakenDownNow(waiting)
          if (endedMeanwhile !== null) return endedMeanwhile
          return {
            outcome: 'refused',
            reason: error.message,
            stillOpen: true,
          }
        }
        return await couldNotRegister(errorMessage(error))
      }
      if (!(await this.untilItsAskerHasArrived(waiting.conversation))) return ITS_ASKER_IS_STARTING
      const done = this.commitAnApproval(waiting, offered, actor)
      if (done.is === 'gone') return ANSWERED_FIRST
      if (done.is === 'starting') return ITS_ASKER_IS_STARTING
      // What the transaction found is still so: these end it with nothing awaited since.
      if (done.is === 'taken') {
        return this.answerAnEnding(
          this.settleNow(
            waiting,
            'could-not-register',
            actor,
            { why: done.why },
            MCP_SERVER_REQUEST_TOLD.couldNotRegister(requestId, asked.name, done.why),
          ),
          { outcome: 'refused', reason: `Could not register: ${done.why}`, stillOpen: false },
          asked.name,
        )
      }
      if (done.is === 'superseded') {
        return this.answerAnEnding(
          this.settleNow(
            waiting,
            'superseded',
            A_PERSON_DID_IT,
            {},
            MCP_SERVER_REQUEST_TOLD.superseded(requestId, asked.name),
          ),
          takenDownSays(asked.name),
          asked.name,
        )
      }
      return this.answerAnApproval(waiting, done, offered)
    } catch (error) {
      return {
        outcome: 'refused',
        reason: `BroCrew could not record that decision, so nothing changed: ${errorMessage(error)}. ${approve ? 'Press it again, or refuse it.' : 'Press it again.'}`,
        stillOpen: true,
      }
    } finally {
      this.mcpServerRequestsBeingDecided.delete(requestId)
    }
  }

  /**
   * A press on a request that no longer waits: one that was made and has ended was answered first;
   * one never made, or whose conversation is gone, is not there.
   */
  private noLongerWaiting(requestId: string): AnswerAck {
    return this.deps.store.mcpServerRequestWasMade(requestId)
      ? ANSWERED_FIRST
      : {
          outcome: 'refused',
          reason: 'there is no request waiting by that name, so nothing was registered',
          stillOpen: false,
        }
  }

  /**
   * With nothing awaited from its reads to its answer: that a request no longer waits, or, when the
   * person has registered its name meanwhile, its taking down (or that its asker is starting, with
   * nothing written); `null` while it waits with its name free.
   */
  private endedOrTakenDownNow(waiting: McpServerRequestWaiting): AnswerAck | null {
    const { requestId, name } = waiting.requested
    if (!this.stillWaiting(requestId)) return this.noLongerWaiting(requestId)
    if (!this.itsNameIsRegistered(name)) return null
    return this.answerAnEnding(
      this.settleNow(
        waiting,
        'superseded',
        A_PERSON_DID_IT,
        {},
        MCP_SERVER_REQUEST_TOLD.superseded(requestId, name),
      ),
      takenDownSays(name),
      name,
    )
  }

  /**
   * Before the address is asked: when the person has registered the request's name, which only
   * their own Add form can do, wait out a start of its asker under way, then
   * {@link endedOrTakenDownNow}. `null` while the name is free.
   */
  private async ifItsNameIsTaken(waiting: McpServerRequestWaiting): Promise<AnswerAck | null> {
    if (!this.itsNameIsRegistered(waiting.requested.name)) return null
    if (!(await this.untilItsAskerHasArrived(waiting.conversation))) return ITS_ASKER_IS_STARTING
    return this.endedOrTakenDownNow(waiting)
  }

  /**
   * The press's answer once an approval is committed. The decision stands whatever telling it
   * does, so nothing here throws.
   */
  private answerAnApproval(
    waiting: McpServerRequestWaiting,
    done: Extract<ApprovalCommitted, { is: 'approved' }>,
    offered: readonly string[],
  ): AnswerAck {
    try {
      this.host.theWorldMoved('agents')
    } catch (error) {
      console.warn(`runtime host could not announce ${done.row.name}: ${errorMessage(error)}`)
    }
    let told = false
    try {
      told = this.tellTheAskerItWasApproved(waiting, done.row, offered, done.granted)
    } catch (error) {
      console.warn(
        `runtime host registered ${done.row.name} but could not tell the conversation that asked: ${errorMessage(error)}`,
      )
    }
    const registered = `Registered. It offers: ${theToolsItOffered(offered)}.`
    const notGiven =
      done.notGiven.length === 0
        ? ''
        : ` ${done.notGiven.join(', ')} no longer ${done.notGiven.length === 1 ? 'exists' : 'exist'}, so it was not given to them.`
    return {
      outcome: 'taken',
      reason: `${registered}${notGiven}${told ? '' : ` ${THE_ASKER_WAS_NOT_TOLD}`}`,
    }
  }

  /**
   * End a request without registering it ({@link settleARequest}), and answer the press with
   * `says` once it has ended.
   */
  private async endARequest(
    waiting: McpServerRequestWaiting,
    ending: Exclude<McpServerRequestEnding, 'approved'>,
    by: ActedBy,
    said: Pick<McpServerRequestSettledEvent, 'why'>,
    told: string,
    says: AnswerAck,
  ): Promise<AnswerAck> {
    return this.answerAnEnding(
      await this.settleARequest(waiting, ending, by, said, told),
      says,
      waiting.requested.name,
    )
  }

  /**
   * A press's answer once a request has ended other than by registering it: `says`, or that it was
   * taken down when the person had registered its name meanwhile ({@link settleNow}).
   */
  private answerAnEnding(ended: RequestSettled, says: AnswerAck, name: string): AnswerAck {
    if (ended.is === 'starting') return ITS_ASKER_IS_STARTING
    if (ended.is === 'gone') return ANSWERED_FIRST
    const answer = ended.as === 'superseded' ? takenDownSays(name) : says
    if (ended.told) return answer
    return { ...answer, reason: `${answer.reason ?? ''} ${THE_ASKER_WAS_NOT_TOLD}`.trim() }
  }

  /**
   * An approval's one transaction, after the server has answered and with nothing awaited since:
   * the request still waits, no other name holds its address and its name is free; then the
   * server's row, the grants for the agents it named, and its settled row. Anything that fails
   * rolls all of it back. `superseded`: the person registered that name meanwhile. `starting`: the
   * asking conversation began a start meanwhile, whose first ordinal is taken. Neither writes
   * anything.
   */
  private commitAnApproval(
    waiting: McpServerRequestWaiting,
    offered: readonly string[],
    by: ActedBy,
  ): ApprovalCommitted {
    const asked = waiting.requested
    const reach: ExternalMcpServerReach = asked.whoGetsIt === 'everyone' ? 'everyone' : 'restricted'
    let after: (() => void) | null = null
    let done: ApprovalCommitted
    try {
      done = this.deps.store.atomically((): ApprovalCommitted => {
        if (!this.stillWaiting(asked.requestId)) return { is: 'gone' }
        // A second name for a registered address could reach agents the first one does not.
        const there = this.deps.store
          .externalMcpServers()
          .find((one) => theAddressOf(one.url) === theAddressOf(asked.url))
        if (there !== undefined && foldProfileName(there.name) !== foldProfileName(asked.name)) {
          return {
            is: 'taken',
            why: `a server at ${asked.url} is already registered, as “${there.name}”`,
          }
        }
        const row = this.deps.store.registerExternalMcpServer({
          name: asked.name,
          url: asked.url,
          reach,
        })
        // A name an agent's request holds is taken only at the person's Add form.
        if (row === null) return { is: 'superseded' }
        const grants =
          reach === 'everyone'
            ? null
            : this.deps.store.grantExternalMcpServer(row.name, asked.agents ?? [])
        if (reach !== 'everyone' && grants === null)
          throw new Error(`${row.name} is not registered`)
        const notGiven = grants?.missing ?? []
        const appended = this.appendTheSettledRow(
          waiting.conversation,
          asked.requestId,
          'approved',
          by,
          {
            offered,
            ...(notGiven.length === 0 ? {} : { notGiven }),
          },
        )
        if (appended === 'starting') throw new ItsAskerIsStarting()
        after = appended
        return { is: 'approved', row, granted: grants?.granted ?? null, notGiven }
      })
    } catch (error) {
      if (error instanceof ItsAskerIsStarting) return { is: 'starting' }
      throw error
    }
    if (done.is === 'approved') this.onceItIsSettled(asked.requestId, after)
    return done
  }

  /** Whether the store still reads this request as waiting. */
  private stillWaiting(requestId: string): boolean {
    return this.deps.store
      .mcpServerRequestsWaiting()
      .some((one) => one.requested.requestId === requestId)
  }

  /** One MCP server request still waiting, by its id, or `null`. */
  private mcpServerRequestWaiting(requestId: string): McpServerRequestWaiting | null {
    return (
      this.deps.store
        .mcpServerRequestsWaiting()
        .find((one) => one.requested.requestId === requestId) ?? null
    )
  }

  /**
   * Waits out a start of the asking conversation already under way, which holds its first
   * ordinal, until it has arrived (card 197: no clock of its own; the start ends on its own
   * progress window, exit, cancel or the quit). Answers whether no start is under way now.
   */
  private async untilItsAskerHasArrived(conversation: string): Promise<boolean> {
    for (let waited = 0; waited < 3; waited += 1) {
      const slot = this.host.slotOf(conversation)
      if (slot === undefined || slot.session !== null) return true
      await slot.arrived
    }
    const slot = this.host.slotOf(conversation)
    return slot === undefined || slot.session !== null
  }

  /** {@link settleNow}, once a start of the asking conversation under way has arrived. */
  private async settleARequest(
    waiting: McpServerRequestWaiting,
    ending: Exclude<McpServerRequestEnding, 'approved'>,
    by: ActedBy,
    said: Pick<McpServerRequestSettledEvent, 'why'>,
    told: string,
  ): Promise<RequestSettled> {
    if (!(await this.untilItsAskerHasArrived(waiting.conversation))) return { is: 'starting' }
    return this.settleNow(waiting, ending, by, said, told)
  }

  /**
   * End one MCP server request other than by registering it, in the asking conversation's ledger:
   * one transaction reads it as still waiting first, and the conversation is told `told` as it
   * commits ({@link tellTheAsker}). When the person has registered its name meanwhile, which only
   * their own Add form can do, it ends as `superseded` whatever this ending was, and the words say
   * so. `gone` when it was not waiting, `starting` when that conversation is starting: nothing was
   * written. A failed write throws, and nothing was written.
   */
  private settleNow(
    waiting: McpServerRequestWaiting,
    ending: Exclude<McpServerRequestEnding, 'approved'>,
    by: ActedBy,
    said: Pick<McpServerRequestSettledEvent, 'why'>,
    told: string,
  ): RequestSettled {
    const { requestId, name } = waiting.requested
    let after: (() => void) | null = null
    const written = { as: ending }
    const settled = this.deps.store.atomically((): 'settled' | 'gone' | 'starting' => {
      if (!this.stillWaiting(requestId)) return 'gone'
      const takenDown = ending !== 'superseded' && this.itsNameIsRegistered(name)
      written.as = takenDown ? 'superseded' : ending
      const appended = takenDown
        ? this.appendTheSettledRow(
            waiting.conversation,
            requestId,
            'superseded',
            A_PERSON_DID_IT,
            {},
          )
        : this.appendTheSettledRow(waiting.conversation, requestId, ending, by, said)
      if (appended === 'starting') return 'starting'
      after = appended
      return 'settled'
    })
    if (settled !== 'settled') return { is: settled }
    this.onceItIsSettled(requestId, after)
    const words = written.as === ending ? told : MCP_SERVER_REQUEST_TOLD.superseded(requestId, name)
    return { is: 'settled', as: written.as, told: this.tellTheAsker(waiting.conversation, words) }
  }

  /** Whether a server by this name is registered. */
  private itsNameIsRegistered(name: string): boolean {
    const folded = foldProfileName(name)
    return this.deps.store.externalMcpServers().some((one) => foldProfileName(one.name) === folded)
  }

  /**
   * What follows a request's settled row once its transaction has committed. The decision stands
   * whatever happens here, so a failure is only warned.
   */
  private onceItIsSettled(requestId: string, after: (() => void) | null): void {
    try {
      after?.()
    } catch (error) {
      console.warn(
        `runtime host settled MCP server request ${requestId} but could not show it: ${errorMessage(error)}`,
      )
    }
  }

  /**
   * Inside a store transaction, append a request's settled row to the asking conversation's ledger
   * at its next ordinal. Answers what to do once the transaction commits: tell the running
   * conversation's session, or the windows looking at one nothing runs. `starting` when a start
   * under way holds its first ordinal: nothing is appended. A running conversation no longer being
   * recorded throws {@link ItsRecordIsNotWritten}.
   */
  private appendTheSettledRow(
    conversation: string,
    requestId: string,
    ending: McpServerRequestEnding,
    by: ActedBy,
    said: Pick<McpServerRequestSettledEvent, 'offered' | 'notGiven' | 'why'>,
  ): (() => void) | 'starting' {
    const slot = this.host.slotOf(conversation)
    const session = slot?.session ?? null
    if (slot !== undefined && session === null) return 'starting'
    const event: McpServerRequestSettledEvent = {
      type: 'mcp_server_request_settled',
      requestId,
      ending,
      by,
      ...said,
    }
    const next = this.deps.store.nextOrdinal(conversation)
    const ordinal = session === null ? next : Math.max(session.ordinal, next)
    const at = this.host.now()
    this.deps.store.append(conversation, ordinal, event, at)
    const message: RuntimeEventMessage = { sessionId: conversation, ordinal, at, event }
    return () => {
      if (session === null) {
        this.host.showTheWindowsLookingAt(conversation, message)
        this.host.stateMayHaveMoved(conversation)
        return
      }
      session.ordinal = Math.max(session.ordinal, ordinal + 1)
      this.host.emitOurs(session, message)
    }
  }

  /**
   * Tell the conversation that asked how its request ended, as this app's notice, held now in its
   * mailbox or its ledger ({@link holdUntilItStarts}), so no failed start, stop or restart loses
   * the words. One that is not running is started for them, unless it is archived: then they wait
   * for its next start, and deciding a request does not bring it back. Answers false when the words
   * could not be kept. ⛔ Never throws.
   */
  tellTheAsker(conversation: string, text: string): boolean {
    let asker = conversation
    try {
      asker = this.host.theOneInItsPlace(conversation)
      const kept = { nowhere: false }
      this.host.holdUntilItStarts(asker, text, TOLD_ABOUT_A_SERVER_REQUEST, 'notice', (where) => {
        if (where === 'nowhere') kept.nowhere = true
      })
      if (kept.nowhere) return false
    } catch (error) {
      console.warn(
        `runtime host could not tell ${asker} how its MCP server request ended: ${errorMessage(error)}`,
      )
      return false
    }
    const notStarted = (error: unknown): void => {
      console.warn(
        `runtime host could not start ${asker} to tell it how its MCP server request ended: ${errorMessage(error)}`,
      )
    }
    // The words are held from here, whatever becomes of the start.
    try {
      if (!this.host.keptStopped(asker) && !this.host.runsNow(asker)) {
        void this.host.ensureRunning(asker, null).catch(notStarted)
      }
    } catch (error) {
      notStarted(error)
    }
    return true
  }

  /**
   * Tell the asker its request was approved. When its own profile now gets the server, the words
   * go with a reopen, so the server's tools reach it ({@link reopenForItsTools}); otherwise they
   * say nothing changed for it. Answers false when the words could not be kept.
   */
  private tellTheAskerItWasApproved(
    waiting: McpServerRequestWaiting,
    row: ExternalMcpServerRow,
    offered: readonly string[],
    granted: readonly string[] | null,
  ): boolean {
    const { requestId } = waiting.requested
    const forWhom = granted === null ? 'every agent' : granted.join(', ') || 'no agent'
    const asker = this.host.theOneInItsPlace(waiting.conversation)
    const profile = this.deps.store.recordedOne(asker)?.profileId ?? null
    const itsProfileGetsIt =
      profile !== null &&
      this.deps.store.externalMcpServersFor(profile).some((server) => server.name === row.name)
    if (!itsProfileGetsIt) {
      return this.tellTheAsker(
        asker,
        MCP_SERVER_REQUEST_TOLD.approvedNotHere(requestId, row.name, forWhom),
      )
    }
    return this.host.reopenForItsTools(asker, {
      reopened: MCP_SERVER_REQUEST_TOLD.approvedAndReopened(
        requestId,
        row.name,
        row.url,
        forWhom,
        offered,
      ),
      notReopened: (because) =>
        MCP_SERVER_REQUEST_TOLD.approvedNotReopened(
          requestId,
          row.name,
          row.url,
          forWhom,
          offered,
          because,
        ),
    })
  }

  /**
   * 🔴 **Remove one registered server, and every grant naming it** (516).
   *
   * ⛔ **`false` is *there was no such row*, and it is not an error.** A person pressing Remove twice,
   * or on a row another window has already removed, has asked for a state that already holds —
   * {@link SessionStore.setExternalMcpServers}' `false` one door over, for its reason.
   *
   * ⚠️ **Nothing running is touched.** A conversation's servers are fixed by the query it was
   * started with (`307`), so this reaches the NEXT launch and the sheet says so.
   */
  removeExternalMcpServer(serverId: string): boolean {
    return this.deps.store.removeExternalMcpServer(serverId)
  }
}
