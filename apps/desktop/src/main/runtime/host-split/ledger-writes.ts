import type { HostedSession, WordsForTheNextStart } from './hosted-session'
import type {
  UnqueuedMessageEvent,
  MailboxKind,
  QueuedMessageEvent,
  TranscriptEvent,
} from '../../../shared/conversation-events'
import { theAnswerItCarries, AN_ANSWER_HELD_THEN_LOST } from '../../../shared/tasks'
import { type IntoItsLedger, type WhereHeldWordsWait, isANoticeForItsNextInput } from './deliveries'
import { RecordWriteFailed } from '../record-write'
import { errorMessage } from '../session-disclosures'
import type { FactsAQueueCarries, TurnFacts } from '../message-records'
import { onItsWayOut, type SessionSlot } from './session-slot'
import { type QueuedMessage, newQueuedMessageId } from '../queued-message'
import { whoseWordsTheseAre, WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS } from './whose-words'
import { THE_APP_ITSELF, type Caller } from '../conversation-caller'
import type { RuntimeEventMessage, RuntimeChangeMessage } from '../../../shared/runtime-ipc'
import { transcriptMessageForDisplay } from '../../providers/error-presentation'
import type { TurnOrigin } from '../turn-origin'
import type { OneLook } from './answer-reads'
import type { SessionStore } from '../../db/session-store'

/** What LedgerWrites reaches in RuntimeHost, each read only when called. */
interface LedgerWritesHost {
  launches(): { readonly closed: boolean }
  lookingAtItsRecord(): Map<string, Map<string, OneLook>>
  slots(): ReadonlyMap<string, SessionSlot>
  startupRepairs(): ReadonlySet<string>
  repairingStartup(): boolean
  profileOf(conversation: string): string | null
  emitOurs(session: HostedSession, message: RuntimeEventMessage): void
  flushQueued(session: HostedSession): void
  givenBriefNoticeStillGoes(pieceId: string, noticeId: string): boolean
  now(): number
  originOf(by: Caller): TurnOrigin | null
  publishOurs(session: HostedSession, event: IntoItsLedger): void
  publishStateIfChanged(session: HostedSession): void
  rememberWordsHeldAtAStop(sessionId: string, held: QueuedMessage): void
  settleBeforeUse(owner: string): Promise<void>
  thePieceTheseWordsDrive(recipient: string, facts: TurnFacts): string | null
  theWorldMoved(what: RuntimeChangeMessage['what']): void
  withCurrentAgentState(message: RuntimeEventMessage): RuntimeEventMessage
  writeRecord<T>(sessionId: string, table: string, write: () => T): T
}

type LedgerWritesDeps = {
  readonly store: Pick<
    SessionStore,
    'append' | 'nextOrdinal' | 'queuedPromptProgress' | 'recordedOne'
  >
}

/** Rows this app writes into a conversation's ledger: into a running one, held for its next start, or appended when nothing runs it. */
export class LedgerWrites {
  constructor(
    private readonly readDeps: () => LedgerWritesDeps,
    private readonly host: LedgerWritesHost,
  ) {}

  /** RuntimeHost's wrapped deps, read when used: the leaf is built before RuntimeHost wraps them. */
  private get deps(): LedgerWritesDeps {
    return this.readDeps()
  }

  /**
   * 🔴 **729 · PM ruling R89 — an answer held for its giver that ended without being sent** (`724`
   * F-1): *"Lost is lost, whatever lost it."*
   *
   * ⚑ **{@link deliverReply}'s record, written LATER, by the one party that sees the loss.** A reply
   * `held` for a busy giver, or `kept` for its next start (D-030), is `REPLY_LANDED` when it is
   * queued — its words are in the giver's mailbox or ledger, and that is what the replying agent was
   * handed back — and when a stop that cut its handover or a Cancel at its door then ends the
   * message unsent, the same row is written into the same ledger —
   * {@link ReplyUndeliveredEvent}, with {@link AN_ANSWER_HELD_THEN_LOST} for `because` — so every
   * reader of *"did this answer reach its giver"* reads one fact; ⚑ for a crash, the next launch's
   * repair writes it. ⚠️ A Close, a stop, a stream's end and a quit hand held words on to the next
   * start ({@link handOnWhatItHeld}), and a moved sign-in keeps them for its reopen
   * ({@link reopenForWhatWaits}), so none of them loses one.
   *
   * ⛔ **Only for the answer itself** ({@link theAnswerItCarries}): the `answered` report, relayed
   * from the conversation that answered — never the app's own notice about that work.
   *
   * ⚠️ **A write deferred for a replier mid-reopen is not durable**: the giver's ending is committed
   * first, so a crash before the reopen settles leaves an ending the next launch's repair does not
   * look at, and no record (reported).
   */
  recordAnAnswerItsGiverNeverGot(giver: HostedSession, ending: UnqueuedMessageEvent): void {
    const answer = theAnswerItCarries(ending)
    if (answer === null) return
    this.writeIntoItsLedger(answer.owner, {
      type: 'reply_undelivered',
      piece: answer.piece,
      parent: giver.id,
      because: AN_ANSWER_HELD_THEN_LOST,
    })
  }

  /**
   * ⛔ **Into a conversation's ledger, whatever state it is in** — {@link endInstructionAsk}'s
   * choice, and one state more. ⚑ **D-017** — a lost answer, and since D-017 an answer, a withdrawal
   * and its questions' endings for a conversation this app is not running.
   *
   * ⚑ **Live** (a registered session, closing included): through {@link publishOurs}, so a window on
   * it sees its card stop saying *delivered*, and the row takes the session's own next ordinal.
   * ⚑ **Not running**: the store's append — the ledger is the fold's, whoever has it open.
   * 🔴 **STARTING — a reopen in flight — waits for {@link SessionSlot.arrived}**: the reopen took its
   * first ordinal off the store before it asked the provider (`startingOrdinal`), so a row appended
   * now would take that same ordinal, and the conversation's first own row would fail to record —
   * *"no longer being recorded"*, for the rest of its life. ⚠️ Asked once more when the launch has
   * settled, and to the store if the SAME slot is still there with nothing registered, so a slot that
   * never registers cannot make this a loop.
   */
  writeIntoItsLedger(
    sessionId: string,
    row: IntoItsLedger,
    /** ⚑ **D-017 · R6** — told once the row is down, whenever that is. */
    landed?: () => void,
  ): void {
    if (!this.host.repairingStartup() && this.host.startupRepairs().has(sessionId)) {
      void this.host
        .settleBeforeUse(sessionId)
        .then(() => this.writeIntoItsLedger(sessionId, row, landed))
        .catch((error: unknown) => {
          if (!(error instanceof RecordWriteFailed)) {
            console.warn(`runtime host could not write into ${sessionId}: ${errorMessage(error)}`)
          }
        })
      return
    }
    const slot = this.host.slots().get(sessionId)
    if (slot?.session != null) {
      this.host.publishOurs(slot.session, row)
      landed?.()
      return
    }
    if (slot !== undefined) {
      void slot.arrived
        .then(() => {
          const neverRegistered = this.host.slots().get(sessionId) === slot && slot.session === null
          if (neverRegistered) {
            if (this.appendIntoItsLedger(sessionId, row)) landed?.()
          } else this.writeIntoItsLedger(sessionId, row, landed)
        })
        .catch((error: unknown) => {
          if (!(error instanceof RecordWriteFailed)) {
            console.warn(
              `runtime deferred write failed: session=${sessionId} table=events error=${errorMessage(error)}`,
            )
          }
        })
      return
    }
    if (this.appendIntoItsLedger(sessionId, row)) landed?.()
  }

  /**
   * ⚑ **D-017 · R1 — words this app delivers, held for a conversation that is not running**, so its
   * next start sends them first ({@link putBackWhatWaitedForThisStart}) — and they are in its LEDGER
   * now, so no failed start, stop or quit can lose them: an open `message_queued` is what that start
   * rebuilds from.
   *
   * ⚑ **Whatever state it is in**, as {@link writeIntoItsLedger}: ⚑ running or on its way out — into
   * its mailbox, where a turn's end sends it and a stop hands it on ({@link handOnWhatItHeld}), or,
   * once that stop has handed on what it held, beside those — ⚑ a sign-in that moved on holds them
   * in that mailbox for its reopen; ⚑ still starting — once it registers, since its first ordinal is
   * taken; ⚑ not running — appended, and kept for its next start.
   * ⛔ **It starts nothing**: the caller decides whether a start follows.
   *
   * ⚑ **D-030 — `kept` is told where the words wait** ({@link WhereHeldWordsWait}), once, whatever
   * happens: ⚠️ a hold deferred to a start that throws is warned and told `nowhere`, never left
   * unanswered.
   */
  holdUntilItStarts(
    sessionId: string,
    text: string,
    facts: FactsAQueueCarries,
    kind: MailboxKind = 'notice',
    /** ⚑ Told where the words wait, and the id they are held under once they are held. */
    kept?: (where: WhereHeldWordsWait, id?: string) => void,
    /** ⚑ The id to hold them under, when holding them again must be the same message. */
    id?: string,
    /** Sender and attachment facts when an outbound message is held before starting. */
    left?: WordsForTheNextStart,
  ): void {
    if (this.host.startupRepairs().has(sessionId)) {
      void this.host
        .settleBeforeUse(sessionId)
        .then(() => {
          if (this.host.launches().closed) kept?.('nowhere')
          else this.holdUntilItStarts(sessionId, text, facts, kind, kept, id, left)
        })
        .catch((error: unknown) => {
          if (!(error instanceof RecordWriteFailed)) {
            console.warn(
              `runtime host could not hold words for ${sessionId}: ${errorMessage(error)}`,
            )
          }
          kept?.('nowhere')
        })
      return
    }
    const slot = this.host.slots().get(sessionId)
    const session = slot?.session ?? null
    if (slot !== undefined && session === null && !onItsWayOut(slot)) {
      void slot.arrived.then(() => {
        try {
          const neverRegistered = this.host.slots().get(sessionId) === slot && slot.session === null
          if (!neverRegistered) this.holdUntilItStarts(sessionId, text, facts, kind, kept, id, left)
          else this.holdForTheNextStart(sessionId, null, text, facts, kind, kept, id, left)
        } catch (error) {
          console.warn(
            `runtime host could not hold words for ${sessionId}'s start: ${errorMessage(error)}`,
          )
          kept?.('nowhere')
        }
      })
      return
    }
    this.holdForTheNextStart(sessionId, session, text, facts, kind, kept, id, left)
  }

  /**
   * This app's own words, held for a conversation, and the row that records them; or, with `left`, a
   * caller's words held for a service while services are off.
   */
  wordsThisAppHolds(
    sessionId: string,
    text: string,
    facts: FactsAQueueCarries,
    kind: MailboxKind,
    id?: string,
    left?: WordsForTheNextStart,
  ): { readonly held: QueuedMessage; readonly row: QueuedMessageEvent } {
    // ⚑ **D-016 · commit 6 · R4** — the piece of its own these words drive, when they name one.
    const drives = this.host.thePieceTheseWordsDrive(sessionId, facts)
    const from = left === undefined ? null : this.host.originOf(left.by)
    // Keep the exact incident piece with its reminder as well as with an agent note.
    const itNames =
      from?.who === 'a-caller-with-an-id' ||
      facts.appNotice === 'a-work-wait-needs-attention' ||
      facts.appNotice === 'a-given-brief-could-not-start'
        ? (facts.aboutPiece?.piece ?? null)
        : null
    const rebriefs =
      left?.rebriefs === undefined ? {} : { ...left.rebriefs, rebrief: true as const }
    const providerFailure =
      kind === 'notice' &&
      facts.appNotice === 'a-provider-turn-failed' &&
      facts.providerFailureHolder !== undefined
        ? { providerFailureHolder: facts.providerFailureHolder }
        : {}
    const held: QueuedMessage = {
      id: id ?? newQueuedMessageId(),
      kind,
      text,
      since: this.host.now(),
      attachments: left?.attachments ?? [],
      authorship: whoseWordsTheseAre(
        left?.by ?? THE_APP_ITSELF,
        this.host.profileOf,
        facts,
        left === undefined ? WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS : left.says,
      ),
      ...rebriefs,
      ...providerFailure,
      ...(drives === null ? {} : { drives }),
      ...(from === null ? {} : { origin: from }),
      ...(facts.asks === undefined ? {} : { asks: facts.asks }),
      ...(facts.unansweredQuestion === undefined
        ? {}
        : { unansweredQuestion: facts.unansweredQuestion }),
      ...(facts.messageAct === undefined ? {} : { messageAct: facts.messageAct }),
      ...(itNames === null ? {} : { about: itNames }),
    }
    const row: QueuedMessageEvent = {
      type: 'message_queued',
      messageId: held.id,
      kind,
      text,
      ...(held.attachments.length > 0 ? { attachments: [...held.attachments] } : {}),
      ...held.authorship,
      ...rebriefs,
      ...providerFailure,
      ...(facts.appNotice === 'a-given-brief-could-not-start' ? { forItsNextStart: true } : {}),
      ...(drives === null ? {} : { drives }),
      ...(itNames === null ? {} : { about: itNames }),
      ...(held.asks === undefined ? {} : { asks: held.asks }),
      ...(held.unansweredQuestion === undefined
        ? {}
        : { unansweredQuestion: held.unansweredQuestion }),
      ...(held.messageAct === undefined ? {} : { messageAct: held.messageAct }),
    }
    return { held, row }
  }

  /** ⚑ **D-017 · R1** — {@link holdUntilItStarts}' write, for a conversation that is not starting. */
  private holdForTheNextStart(
    sessionId: string,
    session: HostedSession | null,
    text: string,
    facts: FactsAQueueCarries,
    kind: MailboxKind,
    /** ⚑ **D-030** — see {@link holdUntilItStarts}. */
    kept?: (where: WhereHeldWordsWait, id?: string) => void,
    id?: string,
    left?: WordsForTheNextStart,
  ): void {
    if (
      facts.appNotice === 'a-given-brief-could-not-start' &&
      (id === undefined ||
        facts.aboutPiece === undefined ||
        !this.host.givenBriefNoticeStillGoes(facts.aboutPiece.piece, id) ||
        this.deps.store.queuedPromptProgress(sessionId, id, facts.appNotice) !== 'missing')
    ) {
      kept?.('nowhere')
      return
    }
    const { held, row } = this.wordsThisAppHolds(sessionId, text, facts, kind, id, left)
    // ⚑ **D-030 · its mailbox, while it runs** — and a sign-in that moved on holds them there for
    // its reopen ({@link reopenForWhatWaits}), which the flush asks for.
    if (session !== null && session.finalizing === null && isANoticeForItsNextInput(held)) {
      // Recorded now; it rides the next ordinary input and starts no turn of its own.
      this.host.publishOurs(session, row)
      session.noticesForItsNextInput.push(held)
      this.host.theWorldMoved('work')
      kept?.('its-ledger', held.id)
      return
    }
    if (session !== null && session.finalizing === null) {
      // ⚑ Its mailbox: a turn's end sends it, and a stop that has not yet handed on what it held does.
      this.host.publishOurs(session, row)
      session.mailbox.push(held)
      this.host.publishStateIfChanged(session)
      this.host.flushQueued(session)
      this.host.theWorldMoved('work')
      kept?.('its-mailbox', held.id)
      return
    }
    // ⚑ **D-030** — kept only once its row is down: the next start reads its ledger, never this
    // run's memory alone ({@link whatWaitedForThisStart}). ⚑ Held while nothing runs in it, the row
    // says so, and a launch keeps it ({@link QueuedMessageEvent.forItsNextStart}).
    let down: boolean
    if (session !== null) {
      this.host.publishOurs(session, row)
      down = true
    } else down = this.appendIntoItsLedger(sessionId, { ...row, forItsNextStart: true })
    this.host.rememberWordsHeldAtAStop(sessionId, held)
    this.host.theWorldMoved('work')
    kept?.(down ? 'its-ledger' : 'nowhere', held.id)
  }

  /**
   * ⚠️ **Never throws** — it runs inside another conversation's teardown, and a warn is the trace.
   * ⛔ **Announces nothing**: the verb that ended the held message already did (`638`'s rule, *at a
   * verb, after its append*). ⚑ What the row moves in the one state is said on its own
   * ({@link aRowWasWritten}, D-019). ⚑ **D-030** — answers whether the row is down.
   */
  appendIntoItsLedger(sessionId: string, row: IntoItsLedger): boolean {
    return this.writeWhileNothingRunsIt(sessionId, row)
  }

  /**
   * 🔴 **A row written into a ledger nothing runs** — the one writer of it — and shown, as it is
   * written, to every window that has the conversation open ({@link lookingAtItsRecord}): a window
   * looking at a conversation nothing runs reads it again on such a row, and draws it from its
   * ledger as a reopen would. ⛔ It starts nothing. ⚑ A row that could not be written is shown to
   * nobody. ⚑ Answers whether the row is down. ⛔ It never throws.
   */
  writeWhileNothingRunsIt(sessionId: string, row: TranscriptEvent): boolean {
    try {
      const written = this.host.writeRecord(sessionId, 'events', () => {
        const ordinal = this.deps.store.nextOrdinal(sessionId)
        const at = this.host.now()
        this.deps.store.append(sessionId, ordinal, row, at)
        return { sessionId, ordinal, at, event: row }
      })
      this.showTheWindowsLookingAt(sessionId, written)
      return true
    } catch (error) {
      if (!(error instanceof RecordWriteFailed)) throw error
      return false
    }
  }

  /** A row of a conversation nothing runs, sent to the windows that have it open. ⛔ Never throws. */
  showTheWindowsLookingAt(sessionId: string, message: RuntimeEventMessage): void {
    if (!this.host.lookingAtItsRecord().has(sessionId)) return
    const provider = this.deps.store.recordedOne(sessionId)?.provider
    this.sendToTheWindowsLookingAt(sessionId, null, () =>
      transcriptMessageForDisplay(this.host.withCurrentAgentState(message), provider),
    )
  }

  /**
   * A row a running conversation sent the one holding it, sent marked to the windows that draw it
   * from its ledger and do not hold it ({@link RuntimeEventMessage.notHeldHere}), so their view
   * follows the turn. ⛔ Never throws.
   */
  showTheWindowsThatDoNotHoldIt(
    sessionId: string,
    holder: string,
    shown: RuntimeEventMessage,
  ): void {
    this.sendToTheWindowsLookingAt(sessionId, holder, () => ({ ...shown, notHeldHere: true }))
  }

  private sendToTheWindowsLookingAt(
    sessionId: string,
    holder: string | null,
    compose: () => RuntimeEventMessage,
  ): void {
    const looking = this.host.lookingAtItsRecord().get(sessionId)
    if (looking === undefined) return
    for (const [owner, { sink }] of looking) {
      if (owner === holder) continue
      if (!sink.alive) {
        looking.delete(owner)
        continue
      }
      try {
        sink.send(compose())
      } catch (error) {
        console.warn(
          `runtime host could not show ${sessionId}'s new row to a window: ${errorMessage(error)}`,
        )
      }
    }
    if (looking.size === 0) this.host.lookingAtItsRecord().delete(sessionId)
  }

  /**
   * Inside a store transaction, a row this app writes, appended to a conversation's ledger at its
   * next ordinal — a running one's too when its session is no longer recorded, so the row is in the
   * store whatever that session's own rows came to. Answers what to do once the transaction
   * commits, which never throws: move the running session's next ordinal past the row and publish
   * it, or show it to the windows looking at one nothing runs. ⛔ A conversation whose start is
   * under way holds its next ordinal, so it is never written here: it throws, as a failed append
   * does, and the transaction writes nothing. The callers refuse that case before they write.
   */
  appendInTheTransaction(conversation: string, event: IntoItsLedger): () => void {
    const slot = this.host.slots().get(conversation)
    const session = slot?.session ?? null
    if (slot !== undefined && session === null) {
      throw new Error(`${conversation} is starting, so ${event.type} cannot be written into it now`)
    }
    const next = this.deps.store.nextOrdinal(conversation)
    const ordinal = session === null ? next : Math.max(session.ordinal, next)
    const at = this.host.now()
    this.deps.store.append(conversation, ordinal, event, at)
    const message: RuntimeEventMessage = { sessionId: conversation, ordinal, at, event }
    return () => {
      if (session !== null) session.ordinal = Math.max(session.ordinal, ordinal + 1)
      try {
        if (session === null) this.showTheWindowsLookingAt(conversation, message)
        else this.host.emitOurs(session, message)
      } catch (error) {
        console.warn(
          `runtime host wrote ${event.type} into ${conversation}'s record and could not show it: ${errorMessage(error)}`,
        )
      }
    }
  }
}
