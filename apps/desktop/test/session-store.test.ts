import { describe, expect, it, vi } from 'vitest'
import { computed, nextTick, reactive } from 'vue'
import { allProviderCapabilities, answerToForward } from '@brobot2/runtime'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import { asTheWireWouldCarry } from './lib/the-wire'
import { createSessionStore, overTheWire } from '../src/renderer/src/lib/session-store'
// 🔴 **623 · FIVE of the six readers of this clause in this file are NEGATIVES** (`HO-095` §2), and
// four of them are about a hand-over — the exact hypothesis that section raises. ⛔ They were aimed
// at the word `gap`, which `623` reworded out of the app; ⚠️ aimed at the export, a rewording moves
// them instead of leaving them green over a claim they had stopped being able to make.
import { NOT_REACHED_THIS_WINDOW } from '../src/renderer/src/lib/session-record'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import { sessionPanel } from '../src/renderer/src/lib/session-panel'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { tailWindow } from '../src/renderer/src/lib/transcript-window'
import { RETITLE_SAID } from '../src/shared/piece-called'
import type {
  CreatedSession,
  PersistedEventInfo,
  ResumedSession,
  FirstMessageAnswer,
  FirstMessageNotSent,
  RuntimeBridge,
  RuntimeEventMessage,
  SessionLivenessMessage,
  SessionLiveness,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * Many conversations at once (090).
 *
 * The host has been multi-session since 046 while the renderer held exactly one, and every
 * symptom — "session is already open", a session running behind a switched-away view, a second
 * chat that could not be started — came from that one mismatch. These drive the store directly:
 * no component, no DOM, no provider, because the routing and the ordinal continuity are the part
 * that has to be right and none of it is about pixels.
 */

/**
 * ⛔ **The double refuses exactly what the WIRE refuses** (221 §4).
 *
 * ## The tenth vacuity class: a test double that accepts what production rejects
 *
 * `fakeBridge` recorded every send verbatim and validated NOTHING. It was built for `216` — *"every
 * send-ish input, verbatim, so an attachment cannot be lost down one branch"* — and it does that
 * job. What it could not do is know what the wire refuses, and one line of `runtimeCommandSchema`
 * refused an attachment-only message that every other layer implements.
 *
 * ⚠️ **So the 🔴-flagged test below — *"an ATTACHMENT-ONLY message is sent, not swallowed"* —
 * asserted the exact behaviour that was broken in production, and passed.** `220` found it by
 * dropping a file on the launcher and pressing Send; nothing in this file could have.
 *
 * ## What this changes
 *
 * Every command method now builds the SAME payload the preload builds — `{ kind: <method name>,
 * ...input }`, which is one-to-one for every method but `checkCwd` — and parses it with the real
 * `runtimeCommandSchema` before the fake answers. ⛔ **A store test can no longer assert a shape the
 * wire rejects**, and that protects every test in this file, not the one that found it.
 *
 * ⚑ **It REJECTS rather than throwing**, because `ipcRenderer.invoke` returns a rejected promise and
 * a synchronous throw travels differently through a caller that forgot to await.
 *
 * ⚠️ **The listeners are skipped and nothing else is.** `onEvent`/`onLiveness` are subscriptions,
 * not commands; a method absent from the union would fail the discriminator and be caught here as
 * loudly as a bad body, which is the direction worth failing in.
 *
 * ## 🔴 What `361` added: the clone, before the parse
 *
 * `221` closed one half of *"a test double that accepts what production rejects"* — the SHAPE half.
 * ⛔ **The other half is that a double is an ordinary function call**, so the payload arrives by
 * reference and a value the wire cannot serialise is never noticed. `355` sent a Vue reactive Proxy
 * as a capability grant and every layer here waved it through; `121` and `218` did the same before
 * it. See `test/lib/the-wire.ts`, which this and the DOM project's setup file both run.
 */
function throughTheWire(impl: RuntimeBridge): RuntimeBridge {
  const subscriptions = new Set(['onEvent', 'onLiveness'])
  const checked: Record<string, unknown> = { ...impl }
  for (const [name, member] of Object.entries(impl)) {
    if (typeof member !== 'function' || subscriptions.has(name)) continue
    const answer = member as (...args: unknown[]) => unknown
    checked[name] = (...args: unknown[]) => {
      // `checkCwd(path)` is the one bridge method whose argument is not the command body — the
      // preload spells it `command({ kind: 'checkCwd', path })`. Every other method is `...input`.
      const body = name === 'checkCwd' ? { path: args[0] } : ((args[0] as object | undefined) ?? {})
      // 🔴 **The CLONE first, because that is the order the real wire runs them in** (361 §2). A
      // renderer serialises before main has seen anything, so a payload that cannot be cloned is
      // refused by `ipcRenderer.invoke` and `runtimeCommandSchema` never gets a look at it. Running
      // the parse first would report a shape complaint about a call that in the app fails earlier
      // and for a different reason — and, worse, would PASS a proxy, because zod reads through one.
      let carried: unknown[]
      try {
        carried = args.map((argument, index) =>
          asTheWireWouldCarry(args.length === 1 ? name : `${name} argument ${index + 1}`, argument),
        )
      } catch (cause) {
        return Promise.reject(cause as Error)
      }
      const parsed = runtimeCommandSchema.safeParse({ kind: name, ...body })
      if (parsed.success) return answer(...carried)
      const why = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')
      return Promise.reject(
        new Error(
          `⛔ the wire would refuse this ${name} — ${why}. A store test may not assert a shape ` +
            '`runtimeCommandSchema` rejects (221 §4).',
        ),
      )
    }
  }
  // `as unknown as` because the wrapper builds a plain record: every member is re-created as a
  // variadic function, which is exactly what makes it a boundary rather than a passthrough.
  return checked as unknown as RuntimeBridge
}

/** A bridge that records what was asked of it and lets a test push events back. */
function fakeBridge() {
  let listener: ((message: RuntimeEventMessage) => void) | null = null
  let livenessListener: ((message: SessionLivenessMessage) => void) | null = null
  const calls: string[] = []
  /** 216 — every send-ish input, verbatim, so an attachment cannot be lost down one branch. */
  const inputs: { sessionId: string; text: string; attachments?: unknown[] }[] = []
  const created = new Map<string, CreatedSession>()
  let counter = 0
  const histories = new Map<string, PersistedEventInfo[]>()
  /** Sessions the host is still running for this window, which `attachOpen` hands back (100). */
  const held = new Set<string>()
  /**
   * Launches this fake is deliberately not answering (102), by the name the STORE gave them.
   *
   * The wedge the whole dispatch is about: a provider that has been spawned and has not spoken. The
   * fake reproduces it exactly — the launch promise is held, and `cancelLaunch` is the only thing
   * that settles it, rejecting the way the real host does once the abort reaches the adapter.
   */
  const stalled = new Map<string, (reason: Error) => void>()
  let stall = false

  const liveness = { state: 'live' as const, since: 0 }

  /**
   * One page of a fake session's history (054), in the shape the wire really carries.
   *
   * `from` is the FIRST ordinal of what is being handed over rather than a constant 0, because the
   * store now tells the record where its page begins so the ordinal check does not report a gap on
   * the very first replayed event. A fake that always said 0 would make that impossible to get
   * wrong here and perfectly possible to get wrong in the app.
   */
  function windowOf(sessionId: string) {
    const entries = histories.get(sessionId) ?? []
    return {
      entries,
      from: entries[0]?.ordinal ?? 0,
      // These fakes hand over everything they hold, so there is never an older page. A test that
      // wants the paging behaviour sets it explicitly.
      hasOlder: false,
      turnAligned: true,
    }
  }

  function session(sessionId: string, provider: 'claude' | 'codex' = 'claude'): CreatedSession {
    return {
      hasACommander: false,
      // 523 · this fixture is a session a window asked for.
      startedWithoutAWindow: false,
      mayHandItBack: false,
      sessionId,
      provider,
      cwd: `/work/${sessionId}`,
      providerHome: `/homes/${provider}`,
      profileId: 'default',
      // 158: told nothing extra — the shape every fixture that is not about instructions wants.
      instructions: {
        injected: [],
        agentMemory: [],
        provider: [],
        refused: [],
        note: '',
        recallsReported: false,
        writesReported: false,
        composed: null,
      },
      ref: { provider, sessionId: `${sessionId}-ref`, cwd: `/work/${sessionId}`, rotation: 0 },
      config: { home: `/homes/${provider}`, homeEnv: 'X', model: 'm', authNote: null, files: [] },
      approvalMode: 'ask',
      pendingApprovalMode: null,
      approvalNote: 'approvals: ask',
      blanketGrants: [],
      planNeedsGoAhead: false,
      settings: {
        model: null,
        pendingModel: null,
        reasoningEffort: null,
        pendingReasoningEffort: null,
        planMode: false,
        pendingPlanMode: null,
      },
      // Nothing waiting: a session cannot have a queued message before it has run a turn (077).
      queued: [],
      liveness,
    }
  }

  /** A launch that never answers, until something cancels it. Never resolves; only rejects. */
  function neverAnswers<T>(launchKey: string): Promise<T> {
    return new Promise<T>((_resolve, reject) => stalled.set(launchKey, reject))
  }

  const impl: RuntimeBridge = {
    skills: async () => ({ operation: 'refused', reason: 'source-unavailable' }),
    createSession: async (input) => {
      calls.push(`create:${input.provider}`)
      if (stall && input.launchKey !== undefined) return neverAnswers(input.launchKey)
      const record = session(`sess_${++counter}`, input.provider)
      created.set(record.sessionId, record)
      return record
    },
    resume: async ({ sessionId, launchKey }) => {
      calls.push(`resume:${sessionId}`)
      if (stall && launchKey !== undefined) return neverAnswers(launchKey)
      // A RECORDING reopened — a new provider on a conversation that had stopped (100).
      return {
        ...session(sessionId),
        history: windowOf(sessionId),
        handover: 'resumed',
      } satisfies ResumedSession
    },
    release: async ({ sessionId }) => {
      calls.push(`release:${sessionId}`)
      // ⚑ **The word the room would use, as the host computes it after the write** (523) — see
      // `ReleasedSession.running`. This double holds no slots, so it states the answer a live host
      // would measure for a conversation nobody is watching any more.
      return { sessionId, running: 'unwatched', waitingForAHuman: false }
    },
    // ⚑ **735's first message and its start, in one act** — since D-017b a message sent from a
    // recorded conversation's view (`store.startAndSend`). ⚑ The whole input is recorded, as the sends' are, so what crossed
    // the wire is read back; a test answers otherwise by replacing the method.
    startAndSend: async (input) => {
      calls.push(`startAndSend:${input.sessionId}`)
      inputs.push(input)
      return {
        sent: {
          ...session(input.sessionId),
          history: windowOf(input.sessionId),
          handover: 'resumed',
        },
      } satisfies FirstMessageAnswer
    },
    // What the HOST is still running for this window (100). Empty unless a test plants something
    // in `held` — the ordinary case is a store that starts with nothing to take back, and a fake
    // that always handed one over would make the "nothing to reconcile" path untestable.
    // ⚑ **336's claim, faked as the one thing this store can observe about it**: it hands back a
    // conversation in exactly the shape `attachOpen` does, so the renderer folds it by the same
    // path. Nothing in the renderer calls it yet — the store's own surface is unchanged — and this
    // entry exists because `RuntimeBridge` is total, which is what stops a wire verb being added
    // with no fake and therefore no test that could ever have driven it.
    // ⚑ **D-017b · the look, faked as the host answers it**: a conversation this window holds is
    // handed back attached, and any other is drawn from its ledger — `recorded`, nothing started.
    look: async ({ sessionId }) => {
      calls.push(`look:${sessionId}`)
      return {
        ...session(sessionId),
        history: windowOf(sessionId),
        handover: held.has(sessionId) ? 'attached' : 'recorded',
      } satisfies ResumedSession
    },
    stopLooking: async ({ sessionId }) => {
      calls.push(`stopLooking:${sessionId}`)
    },
    claim: async ({ sessionId }) => {
      calls.push(`claim:${sessionId}`)
      return {
        ...session(sessionId),
        history: windowOf(sessionId),
        handover: 'attached',
      } satisfies ResumedSession
    },
    // ⚑ **401's read, faked as the empty answer.** ⛔ Empty is the ORDINARY answer — nothing is
    // overdue — and the store's own surface turns a REFUSAL into `null` instead, which is the
    // difference this fake cannot express and `persons-queue.test.ts` drives directly.
    questionsForAPerson: async () => {
      calls.push('questionsForAPerson')
      // ⚑ **453 · a walk that opened every ledger and found nothing**, which is what `[]` meant
      // here before the shape carried it. See `LedgerWalk`.
      return {
        rows: [],
        walk: 'every-conversation-that-routed' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
    },
    // ⚑ **403's second read, faked the same way and for the same reason.** ⛔ Empty is the
    // ORDINARY answer — nothing is waiting on a person — and the store turns a REFUSAL into
    // `null`, which is the difference `persons-queue.test.ts` drives directly.
    decisionsForAPerson: async () => {
      calls.push('decisionsForAPerson')
      // ⚑ **453 · a walk that opened every ledger and found nothing**, which is what `[]` meant
      // here before the shape carried it. See `LedgerWalk`.
      return {
        rows: [],
        walk: 'every-conversation-that-routed' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
    },
    // ⚑ **533's fourth read, faked the same way and for the same reason a fourth time.** ⛔ Empty is
    // the ORDINARY answer — no provider has walled — and the store turns a REFUSAL into `null`,
    // which is what keeps a dropped call from claiming every provider is still taking work.
    readLimitsDisplay: async () => ({ is: 'unavailable', databaseEpoch: 1, signInEpoch: 1 }),
    onLimitsDisplayChanged: () => () => {},
    limitsForAPerson: async () => {
      calls.push('limitsForAPerson')
      return {
        rows: [],
        walk: 'every-provider-wall-recently-recorded' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
    },
    // ⚑ **557's read, faked the same way and for the same reason.** ⛔ An empty list here is the
    // claim *nothing has stopped with nobody to tell*, which is exactly why the store under test
    // turns a REFUSAL into `null` rather than into these bytes.
    stalledWorkForAPerson: async () => {
      calls.push('stalledWorkForAPerson')
      return {
        rows: [],
        walk: 'every-conversation-that-was-given-work' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
    },
    // ⚑ Open work no other list shows, faked the same way: empty is the ordinary answer.
    workIncidentsForAPerson: async () => {
      calls.push('workIncidentsForAPerson')
      return {
        rows: [],
        walk: 'every-conversation-that-was-given-work' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
    },
    // ⚑ Work whose holder stopped with it, faked the same way: empty is the ordinary answer.
    stoppedWorkForAPerson: async () => {
      calls.push('stoppedWorkForAPerson')
      return {
        rows: [],
        walk: 'every-conversation-that-was-given-work' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
    },
    // ⚑ **F097's read, faked the same way and for the same reason.** ⛔ Empty is the ORDINARY answer
    // — no agent is waiting on a person's reply — and the store turns a REFUSAL into `null`.
    waitingOnWhoWroteForAPerson: async () => {
      calls.push('waitingOnWhoWroteForAPerson')
      return {
        rows: [],
        walk: 'every-conversation-that-was-given-work' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
    },
    // ⚑ **D-017 · R19's sixth read, faked the same way and for the same reason.** ⛔ Empty is the
    // ORDINARY answer — no agent has asked to change an identity's instructions — and the store
    // turns a REFUSAL into `null`, which is what keeps a dropped call from drawing an all-clear.
    instructionAsksForAPerson: async () => {
      calls.push('instructionAsksForAPerson')
      return []
    },
    // The agents' requests to register an MCP server, faked the same way: empty is the ordinary answer.
    mcpServerRequestsForAPerson: async () => {
      calls.push('mcpServerRequestsForAPerson')
      return []
    },
    // ⚑ **438's read, faked the same way and for the same reason again.** ⛔ A digest that walked
    // no conversation and saw nothing is the ORDINARY answer on a database with none; the store
    // turns a REFUSAL into `null`, and `digest.test.ts` drives that difference directly.
    recentActivity: async (window) => ({
      window,
      read: { walk: 'one-window-over-every-agents-conversation', ledgers: 0, rowsUnread: 0 },
      lines: [],
      capped: false,
    }),
    digest: async () => {
      calls.push('digest')
      return {
        window: { from: 0, to: 0 },
        limit: { says: '' },
        digest: {
          sessions: 0,
          read: {
            walk: 'one-window-over-every-agents-conversation' as const,
            ledgers: 0,
            rowsUnread: 0,
          },
          lines: [],
          gaps: [],
          fanOut: { children: 0, reported: 0, missing: 0, tokens: null },
        },
        heldByNoAgent: 0,
        cost: { totalMs: 0 },
      }
    },
    // ⚑ **508's read, faked the same way and for the same reason a fifth time.** ⛔ The walk word
    // carries the same distinction here: an empty `rows` under
    // `every-conversation-this-one-gave-work-to` is *this conversation gave nobody work*, and the
    // store turns a REFUSAL into `null`. ⚑ D-016 · `workGivenBy`, where it was `tasksAssignedBy`.
    workGivenBy: async () => {
      calls.push('workGivenBy')
      return {
        rows: [],
        walk: 'every-conversation-this-one-gave-work-to' as const,
        ledgers: 0,
        rowsUnread: 0,
      }
    },
    // ⚑ **543's read, faked the same way and for the same reason a fifth time.** ⛔ Four walks with
    // four words and ONE `readAt`, which is the whole shape: the store turns a REFUSAL into `null`,
    // and a null answer is *the read did not answer* rather than *this conversation has no edges*.
    whoCalledWhom: async () => {
      calls.push('whoCalledWhom')
      return {
        conversation: 'sess_x',
        parent: null,
        children: {
          rows: [],
          walk: 'every-conversation-this-one-spawned' as const,
          ledgers: 0,
          rowsUnread: 0,
        },
        workGivenOut: {
          rows: [],
          walk: 'every-conversation-this-one-gave-work-to' as const,
          ledgers: 0,
          rowsUnread: 0,
        },
        workTakenIn: {
          rows: [],
          walk: 'every-piece-of-work-this-one-was-given' as const,
          ledgers: 1,
          rowsUnread: 0,
        },
        readAt: 1_700_000_000_000,
      }
    },
    // ⚑ **567's read, faked the same way and for the same reason a sixth time.** ⛔ Two counts and
    // ONE `readAt`, which is the whole shape: the store turns a REFUSAL into `null`, and a null
    // answer is *the read did not answer* rather than *the workspace is quiet*.
    readWorkspace: async () => {
      calls.push('readWorkspace')
      return {
        open: { counted: 'in-full' as const, count: 0 },
        needsYou: { counted: 'in-full' as const, count: 0 },
        readAt: 1_700_000_000_000,
      }
    },
    // ⚑ **575's read, faked the same way and for the same reason a seventh time.** ⛔ An EMPTY
    // population and one `readAt`, which is the whole shape: the store turns a REFUSAL into `null`,
    // and a null answer is *the read did not answer* rather than *this app is running nothing*.
    whatIsBeingDone: async () => {
      calls.push('whatIsBeingDone')
      return { conversations: [], readAt: 1_700_000_000_000 }
    },
    // ⚑ **621's read, faked the same way and for the same reason an eighth time.** ⛔ An EMPTY
    // population and one `readAt`: the store turns a REFUSAL into `null`, and a null answer is
    // *the read did not answer* rather than *nothing in this app is waiting on anybody*.
    whatEachConversationIsWaitingOn: async () => {
      calls.push('whatEachConversationIsWaitingOn')
      return { conversations: [], readAt: 1_700_000_000_000, rowsUnread: 0 }
    },
    // ⚑ **637 · the tenth read whose refusal is a VALUE** — a real forest with no nodes, so the
    // store's `null` can only have come from a REFUSAL and never from an empty workspace.
    theWholeForest: async () => {
      calls.push('theWholeForest')
      return {
        nodes: { rows: [], walk: 'every-conversation-this-app-placed', ledgers: 0, rowsUnread: 0 },
        conversations: 0,
        heldByNoAgent: 0,
        readAt: 1_700_000_000_000,
      }
    },
    // ⚑ **D-018's read, faked the same way**: an EMPTY population, so the store's `null` can only
    // have come from a REFUSAL and never from *this app is running nothing*.
    processMemory: async () => {
      calls.push('processMemory')
      return { conversations: [] }
    },
    attachOpen: async () => {
      calls.push('attachOpen')
      // The SAME session handed back, which never stopped — the other half of the discriminant.
      return [...held].map(
        (sessionId) =>
          ({
            ...session(sessionId),
            history: windowOf(sessionId),
            handover: 'attached',
          }) satisfies ResumedSession,
      )
    },
    // What the host does on a Cancel (102): the abort reaches the adapter, so the launch it stops
    // REJECTS — with the host's own sentence, translated, never a provider string. `false` when
    // there was nothing to stop, which is the race a press cannot avoid.
    cancelLaunch: async ({ launchKey }) => {
      calls.push(`cancelLaunch:${launchKey}`)
      const reject = stalled.get(launchKey)
      if (reject === undefined) return false
      stalled.delete(launchKey)
      reject(
        new Error(
          'This conversation was stopped before it opened. Start it again whenever you are ready.',
        ),
      )
      return true
    },
    // ⚑ **The whole input is recorded since 216**, not just the id: an attachment carried down one
    // branch and not the others is a defect this fake could not see when it kept only the id.
    send: async (input) => {
      calls.push(`send:${input.sessionId}`)
      inputs.push(input)
    },
    sendInterrupting: async (input) => {
      calls.push(`sendInterrupting:${input.sessionId}`)
      inputs.push(input)
    },
    // Faithful to the host (077): queueing answers with WHICH of the two things happened, and the
    // fake says `'queued'` because these tests drive it while a turn is running. A fake that always
    // said `'sent'` would let a store bug that ignored the outcome pass. ⚑ **And it answers with a
    // NAME** (354), because that is the half of the outcome the sent branch does not have.
    queueMessage: async (input) => {
      calls.push(`queueMessage:${input.sessionId}`)
      inputs.push(input)
      return { outcome: 'queued', messageId: 'msg_fake' }
    },
    // ⚑ **The id is recorded, not discarded** (354): a store that cancelled by session alone would
    // otherwise pass here, and naming the message is the whole of what this verb changed.
    cancelQueuedMessage: async ({ sessionId, messageId }) =>
      void calls.push(`cancelQueued:${sessionId}:${messageId}`),
    takeBackAndStop: async ({ sessionId, messageId }) =>
      void calls.push(`takeBackAndStop:${sessionId}:${messageId}`),
    // Faithful to the host (146): answering ACKS, and a refusal is a value that says whether the
    // card survived it. A fake that resolved to nothing would let a store that ignored the ack pass.
    respondPermission: async ({ sessionId }) => {
      calls.push(`permission:${sessionId}`)
      return { outcome: 'taken' as const }
    },
    resolveLink: async () => ({
      state: 'unavailable',
      kind: 'conversation',
      title: null,
      status: null,
      opens: null,
    }),
    decideMoveRequest: async () => ({ outcome: 'refused' as const, reason: 'No move offer.' }),
    respondUserInput: async ({ sessionId }) => {
      calls.push(`userInput:${sessionId}`)
      return { outcome: 'taken' as const }
    },
    answerAction: async ({ sessionId }) => {
      calls.push(`answerAction:${sessionId}`)
      return { outcome: 'taken' as const }
    },
    interrupt: async ({ sessionId }) => void calls.push(`interrupt:${sessionId}`),
    stopBackgroundWork: async ({ sessionId, id }) => {
      calls.push(`stopBackgroundWork:${sessionId}:${id}`)
      // The host's own answer for "the request went out" — the ending arrives as an event, and a
      // double that resolved `false` would be modelling the one case a gated button cannot reach.
      return true
    },
    // 300. ⚠️ **A tail rather than `null`**, so a caller that forgets the call id still fails: the
    // string carries it, and a store test asserting on the text is asserting on what it asked for.
    readCommandOutput: async ({ sessionId, toolCallId }) => {
      calls.push(`readCommandOutput:${sessionId}:${toolCallId}`)
      return { text: `tail for ${toolCallId}`, dropped: 0, closed: false }
    },
    // 462. ⚠️ **An ANSWER rather than `null`, for the reason the tail above it is one**: the part
    // text carries the call id, so a store test asserting on it is asserting on what it asked for.
    readToolAnswer: async ({ sessionId, toolCallId }) => {
      calls.push(`readToolAnswer:${sessionId}:${toolCallId}`)
      return { parts: [{ text: `answer for ${toolCallId}`, dropped: 0 }], partsDropped: 0 }
    },
    // 510. ⛔ **No `sessionId` in the payload, and the double proves the call shape** — the id
    // travels back in the answer so a store test asserting on it is asserting on what it asked
    // for, which is the reason the tail above it answers that way too. ⚑ D-016 · a reply's file is
    // a RESOURCE, read by its id, where it was a canonical document.
    searchWork: async ({ conversation, query }) => {
      calls.push(`searchWork:${conversation}:${query.scope}`)
      return {
        ok: true,
        page: {
          hits: [],
          searched: 0,
          rows_unread: 0,
          ledgers_skipped: 0,
          complete: true,
          next_cursor: null,
        },
      }
    },
    readResource: async ({ resourceId }) => {
      calls.push(`readResource:${resourceId}`)
      return {
        ok: true,
        // ⚑ **635 · Markdown, which is what every fixture written before the widening is.**
        form: 'markdown',
        resourceId,
        name: 'response.md',
        text: `bytes for ${resourceId}`,
        bytes: 9,
      }
    },
    close: async ({ sessionId }) => void calls.push(`close:${sessionId}`),
    refreshConfig: async ({ sessionId }) => {
      calls.push(`refreshConfig:${sessionId}`)
      return { home: '/homes/x', homeEnv: 'X', model: 'reread', authNote: null, files: [] }
    },
    setApprovalMode: async ({ sessionId, mode }) => {
      calls.push(`setApprovalMode:${sessionId}:${mode}`)
      // Faithful to the host (034): a live session cannot change the turn it is already running,
      // so what comes back still says `ask` and names the change as pending.
      return {
        blanketGrants: [],
        approvalMode: 'ask',
        pendingApprovalMode: mode === 'ask' ? null : mode,
        approvalNote:
          mode === 'ask' ? 'approvals: ask' : 'approvals: ask · YOLO from your next message',
      }
    },
    endPlanMode: async ({ sessionId, text }) => {
      // Faithful to the host (060): the state change comes back on the LIVENESS channel, not as a
      // result, so this returns nothing and a test that wants the flag cleared has to publish it.
      calls.push(`endPlanMode:${sessionId}:${text}`)
    },
    setSessionSetting: async ({ sessionId, body }) => {
      calls.push(`setSessionSetting:${sessionId}:${body.kind}`)
      // Faithful to the host (076): a live session cannot change the turn it is already running, so
      // what comes back still reports the OLD value and names the new one as pending.
      return {
        settings: {
          model: null,
          pendingModel: body.kind === 'model' ? { value: body.value } : null,
          reasoningEffort: null,
          pendingReasoningEffort: body.kind === 'reasoningEffort' ? { value: body.value } : null,
          planMode: false,
          pendingPlanMode: body.kind === 'planMode' ? true : null,
        },
        thePick: null,
      }
    },
    listResumable: async () => [],
    listUnresumable: async () => [],
    // The library surfaces (047) are not what this suite is about; they are here because the bridge
    // is implemented in full, which is what makes a missing method a compile error rather than an
    // `undefined` discovered at runtime.
    listLibrary: async () => ({
      entries: [],
      matched: 0,
      counts: {
        total: 0,
        ours: 0,
        userHome: 0,
        restored: 0,
        imported: 0,
        notImported: 0,
        onlyHere: 0,
        providers: [],
      },
      skipped: [],
      skippedTotal: 0,
    }),
    importRecordedSession: async ({ sessionId }) => {
      calls.push(`importRecorded:${sessionId}`)
      return { outcome: 'imported', readable: true, note: 'Imported.' }
    },
    importUserHomeSession: async ({ providerSessionId }) => {
      calls.push(`import:${providerSessionId}`)
      return { outcome: 'imported', sessionId: 'sess_imported', readable: true, note: 'Imported.' }
    },
    rebuildLedger: async ({ sessionId }) => {
      calls.push(`rebuild:${sessionId}`)
      return {
        outcome: 'imported',
        status: {
          present: true,
          derived: 'current',
          derivedThrough: 1,
          rawFrames: 1,
          normalizerVersion: 1,
          failure: null,
        },
      }
    },
    // 108. Nothing in this file drives a workflow output, so the honest stub is the refusal the
    // host itself returns for a run that recorded no file — never a fabricated document.
    readWorkflowOutput: async () => ({ ok: false, reason: 'no-output' }) as const,
    readInstructionSource: async () => ({ ok: false, reason: 'no-source' }) as const,
    revealPath: async () => ({ ok: false, reason: 'no-path' }) as const,
    readConfigFile: async () => ({ ok: false, reason: 'no-path' }) as const,
    readChildWork: async () => ({ ok: false, reason: 'unknown-agent' }) as const,
    readChildState: async () => ({ ok: false, reason: 'not-live' }) as const,
    sendToChild: async () => ({ ok: false, reason: 'not-live' }) as const,
    latestHistory: async ({ sessionId }) => {
      calls.push(`latestHistory:${sessionId}`)
      return windowOf(sessionId)
    },
    earlierHistory: async ({ sessionId, before }) => {
      calls.push(`earlierHistory:${sessionId}:${before}`)
      const entries = (histories.get(sessionId) ?? []).filter((entry) => entry.ordinal < before)
      return { entries, from: entries[0]?.ordinal ?? 0, hasOlder: false, turnAligned: true }
    },
    // The real declarations rather than a stub: the store never reads them, so a fake here would be
    // a shape this file invented and nothing would notice if it stopped matching the wire.
    capabilities: async () => allProviderCapabilities(),
    // 167 — the launcher's menu. Nothing in this file drives it; the entry exists so the stub is a
    // whole `RuntimeBridge` rather than one with a hole in it.
    profiles: async () => ['default'],
    checkCwd: async (path) => ({ ok: true, path }),
    // 419 — this file's store never asks, and a stub that answered with an identity would be
    // inventing one that nothing created.
    createAgent: async () => {
      throw new Error('this test bridge creates no agents')
    },
    agentIdentities: async () => ({
      identities: [],
      foldersWithoutARow: [],
      use: [],
      spawningEnabled: false,
      // 500 · the fail-closed pair, each closing towards the state somebody is still consulted in:
      // no spawning, and a launch that asks.
      defaultApprovalMode: 'ask' as const,
      // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
      externalMcpServers: [],
    }),
    setCapabilities: async () => null,
    // 516 — `createAgent`'s treatment, and for its reason: this file's store never registers a
    // server, and a stub that answered with a row would be inventing one nothing created.
    registerExternalMcpServer: async () => {
      throw new Error('this test bridge registers no MCP servers')
    },
    removeExternalMcpServer: async () => false,
    setAgentProvider: async () => null,
    setAgentDisplayName: async () => null,
    // 677 · ⛔ **`no-such-agent`, the refusal arm, for the two writers' reason above**: this double
    // holds no identity, so there is nothing to choose a model for — and the read answers `null`.
    setAgentModelAndEffort: async ({ profileId }) => ({
      ok: false as const,
      rail: 'no-such-agent' as const,
      reason: `There is no agent called “${profileId}”, so there is nothing to choose a model for.`,
      detail: { profileId },
    }),
    agentModelAndEffort: async () => null,
    // ⚑ **D-042 · R3 — the model list's three doors**; this file's store asks none of them. ⚑ The
    // READ answers `providerModels`' own `no-profile` beside it, and with no list and nothing else
    // naming a model, nothing to start on. ⛔ The write that would put something in the list is
    // `createAgent`'s treatment — a stub that answered with a model would be inventing one nobody
    // set — and the delete is `removeExternalMcpServer`'s: nothing to take off.
    modelList: async ({ provider }) => ({
      provider,
      notAsked: { ok: false as const, reason: 'no-profile' as const },
      standIn: null,
      models: [],
      lastPicked: null,
      startsOn: null,
    }),
    addHandAddedModel: async () => {
      throw new Error('this test bridge adds no models')
    },
    deleteHandAddedModel: async () => [],
    apiKeyStatus: async ({ provider }) => ({ provider, set: false, setAt: null, inUse: false }),
    setApiKey: async () => {
      throw new Error('this test bridge keeps no API key')
    },
    removeApiKey: async ({ provider }) => ({ provider, set: false, setAt: null, inUse: false }),
    checkApiKey: async () => ({ ok: false, reason: 'this test bridge checks no API key' }),
    providerVersions: async () => ({
      claude: { version: null, reason: 'this test bridge bundles nothing' },
      codex: { version: null, reason: 'this test bridge bundles nothing' },
    }),
    providerSetup: async () => ({ claude: null, codex: null }),
    keptRules: async () => ({ claude: [], codex: [] }),
    removeKeptRule: async () => ({ removed: false, why: 'this test bridge keeps no rules' }),
    providerUsage: async () => ({ claude: [], codex: [] }),
    providerResources: async () => ({
      claude: { running: 0, at: 0, rssBytes: 0, cpuPercent: 0 },
      codex: { running: 0, at: 0, rssBytes: 0, cpuPercent: 0 },
    }),
    // 582 · ⛔ **`null` is the refusal arm and is what an identity this double does not hold
    // answers**, exactly as the two writers above it answer. ⚑ The READ has no refusal arm, so it
    // answers an empty history and a stamp — the honest shape for a bridge that holds nothing.
    instructAgent: async () => null,
    agentInstructions: async () => ({
      own: { identity: 'nobody', versions: [] },
      waiting: [],
      readAt: 0,
    }),
    // 625 · ⚑ **Stores nobody has written to, and `no-home` is the TRUTHFUL word rather than the
    // convenient one**: a bridge that reaches no filesystem has provisioned no home, so *never ran
    // here* is what it honestly has to say. ⛔ `nothing-written` would be this double reporting an
    // empty store it never looked at.
    agentMemory: async () => ({
      profileId: 'nobody',
      stores: [
        {
          provider: 'claude' as const,
          state: 'no-home' as const,
          dir: null,
          entries: [],
          refused: [],
        },
        {
          provider: 'codex' as const,
          state: 'no-home' as const,
          dir: null,
          entries: [],
          refused: [],
        },
      ],
      amendments: [],
      readAt: 0,
    }),
    // F093 · ⚑ **This double holds no conversation, so the read refuses**, as the host does for a
    // session it has no record of.
    whatThisAgentWasGiven: async (sessionId: string) => {
      throw new Error(`session ${sessionId} has no record`)
    },
    // F093 · C9 d · ⚑ The same: no conversation here, so no message to read.
    whatTheModelGot: async (sessionId: string) => {
      throw new Error(`session ${sessionId} has no record`)
    },
    // ⚑ **Null, exactly as `instructAgent` above answers** — this double holds no identity, so
    // criterion 12's *there is nothing here to configure* is its honest answer.
    amendAgentMemory: async () => null,
    // ⚠️ **Refused rather than taken**, because this double settles nothing: a `taken` would let a
    // test believe a decision landed in a ledger that does not exist.
    decideInstruction: async () => ({
      outcome: 'refused' as const,
      reason: 'this test bridge decides nothing',
      stillOpen: false,
    }),
    decideMcpServerRequest: async () => ({
      outcome: 'refused' as const,
      reason: 'this test bridge decides nothing',
      stillOpen: false,
    }),
    removeAgent: async () => ({ ok: false, rail: 'no-such-agent' }) as const,
    archiveConversation: async () => ({ done: false, refusal: 'not here' }) as const,
    restoreConversation: async () => ({ done: false, refusal: 'not here' }) as const,
    checkDeleteConversation: async () => ({ ok: false, refusal: 'not here' }) as const,
    deleteConversation: async () => ({ done: false, refusal: 'not here' }) as const,
    setSpawningEnabled: async () => ({ spawningEnabled: false }),
    setServicesOn: async () => ({ servicesOn: false }),
    // 500 · answers the fail-safe word, like the switch above answers the fail-closed one.
    setDefaultApprovalMode: async () => ({ defaultApprovalMode: 'ask' as const }),
    // D-016 · R4 · ⛔ **`no-piece-by-that-name`, the refusal arm, as `setAgentDisplayName` answers
    // its own**: this double holds no work, so there is no piece to rename — in the door's own words.
    retitleWork: async () => ({
      ok: false as const,
      rail: 'no-piece-by-that-name' as const,
      reason: RETITLE_SAID['no-piece-by-that-name'],
    }),
    takeBackWork: async () => ({
      ok: false as const,
      rail: 'not-a-piece-a-service-is-on' as const,
    }),
    adoptSessions: async () => ({
      found: 0,
      adopted: 0,
      alreadyKnown: 0,
      archived: 0,
      imported: 0,
      descentsLearned: 0,
      named: 0,
      skipped: [],
    }),
    exportSession: async () => ({
      kind: 'bundle' as const,
      path: '/tmp/x',
      frames: 0,
      ledgerEntries: 0,
      resumable: false,
      note: '',
    }),
    // 214 §1 — the return half. Not this store's business either; stubbed to the contract shape for
    // the same reason the credential commands below are.
    importBundleFile: async () => ({ ok: false as const, reason: 'no bundle in this test' }),
    // 098: the credential commands are not this store's business — it never asks. Stubbed to the
    // shape the contract requires so the double stays a REAL `RuntimeBridge`; a cast would have let
    // the next contract change slip past this file silently.
    checkProviderAuth: async () => ({
      state: 'usable' as const,
      login: 'account' as const,
      expiresAt: null,
    }),
    reprovisionProviderAuth: async () => 'unchanged' as const,
    signInProvider: async () => ({
      success: false,
      state: { state: 'usable' as const, login: 'account' as const, expiresAt: null },
    }),
    cancelProviderSignIn: async () => {},
    onEvent: (fn: (message: RuntimeEventMessage) => void) => {
      listener = fn
      return () => void (listener = null)
    },
    onLiveness: (fn: (message: SessionLivenessMessage) => void) => {
      livenessListener = fn
      return () => void (livenessListener = null)
    },
    // ⚑ **534 · this store subscribes to nothing on `runtime:changed`.** The channel is the
    // WINDOW's — `RuntimeScreen` wires it through `whenTheWorldMoves` to the two list surfaces —
    // and a session store that held a listener for it would be a second reader of a fact it draws
    // nothing from. ⛔ The unsubscribe is real rather than a no-op so a caller that let go could
    // still be measured.
    onChanged: () => () => {},
    onProvidersChanged: () => () => {},
    // ⚑ **D-019 · nor on `runtime:states`**, for the same reason: `RuntimeScreen` hands what each
    // agent is doing to the rail's one list, and this store draws nothing from it.
    onStates: () => () => {},
    // ⚑ **D-026 · nor any kept files**: this store draws no files; the surfaces that do are UI-002's.
    filesKept: async () => ({ ok: true, files: [] }),
    // ⚑ **D-032 · nor a kept picture, nor Finder**: the viewer that asks for them is not this store.
    drawResource: async () => ({ ok: false, reason: 'no-store' }),
    revealResource: async () => ({ ok: false, reason: 'no-store' }),
    // Nor the paths a message wrote: the transcript that draws them asks for them.
    resolveMessagePaths: async () => [],
    openMessagePath: async () => ({ ok: false, reason: 'no-path' }),
    revealMessagePath: async () => ({ ok: false, reason: 'no-path' }),
  }

  const bridge = Object.assign(throughTheWire(impl), {
    __history: histories,
    __held: held,
    __calls: calls,
    __inputs: inputs,
    /** Make every launch from here on hang, the way a wedged handshake does (102). */
    __stall: (on = true) => void (stall = on),
    __stalledCount: () => stalled.size,
    /** End a stalled launch for a reason of its OWN, so a later cancel finds nothing to stop. */
    __reject: (launchKey: string, cause: Error) => {
      const reject = stalled.get(launchKey)
      if (reject === undefined) return false
      stalled.delete(launchKey)
      reject(cause)
      return true
    },
    __emit: (sessionId: string, ordinal: number, event: TranscriptEvent, at = 1_700_000_000_000) =>
      listener?.({ sessionId, ordinal, at, event }),
    __liveness: (
      sessionId: string,
      state: 'live' | 'silent' | 'ended' | 'errored',
      packet: Partial<SessionLiveness> = {},
    ) => livenessListener?.({ sessionId, liveness: { state, since: 0, ...packet } }),
    __listening: () => listener !== null,
  })
  return bridge
}

const hello = (text: string): TranscriptEvent => ({ type: 'user_turn', text })
const reply = (text: string): TranscriptEvent => ({ type: 'assistant_message', text })
const ended: TranscriptEvent = { type: 'status', state: 'ended' }

/**
 * ⛔ **296 · which word a BROKEN CHANNEL gets, per verb — and this block exists because a mutation
 * measured that nothing checked it.** `mutations.py` M17 flips the child-state catch from
 * `unreachable` to `unknown-agent`; the row was applied and all three projects stayed GREEN, so the
 * distinction the store's own comment argues for was protected by nothing at all.
 *
 * ⚠️ **The two words are not interchangeable and that is the whole point.** `unknown-agent` says
 * this session's LEDGER has no such child — a claim about our own record. `unreachable` says the
 * provider was asked and did not answer. A bridge that threw supports the second and not the first,
 * and printing the first would blame the ledger for a broken pipe.
 */

describe('296 · a channel that failed is not a fact about the child', () => {
  const throwing = (): ReturnType<typeof fakeBridge> => {
    const bridge = fakeBridge()
    bridge.readChildState = async () => {
      throw new Error('the bridge is gone')
    }
    bridge.sendToChild = async () => {
      throw new Error('the bridge is gone')
    }
    bridge.readChildWork = async () => {
      throw new Error('the bridge is gone')
    }
    return bridge
  }

  it('⛔ a thrown bridge is `unreachable` for BOTH child verbs', async () => {
    const store = createSessionStore(throwing())
    expect(await store.readChildState('sess_1', 'agent_1')).toEqual({
      ok: false,
      reason: 'unreachable',
    })
    expect(await store.sendToChild('sess_1', 'agent_1', 'hello')).toEqual({
      ok: false,
      reason: 'unreachable',
    })
  })

  it('⚑ …and STILL `unknown-agent` for the file read beside them — the paired negative', async () => {
    // ⚠️ The 112 ruling, unchanged and now pinned against its neighbour: a channel that failed says
    // nothing about a FILE, so the refusal that claims nothing about disk is the honest one there.
    // Without this half, both catches could be collapsed onto one word and nothing would notice.
    const store = createSessionStore(throwing())
    expect(await store.readChildWork('sess_1', { part: 'transcript', agentId: 'agent_1' })).toEqual(
      {
        ok: false,
        reason: 'unknown-agent',
      },
    )
  })

  it('the paired positive: a bridge that answers is passed through untouched', async () => {
    const store = createSessionStore(fakeBridge())
    expect(await store.readChildState('sess_1', 'agent_1')).toEqual({
      ok: false,
      reason: 'not-live',
    })
  })
})

describe('the session store', () => {
  it('keeps two conversations at once, each with its own transcript', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)

    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''
    expect(first).not.toBe(second)

    bridge.__emit(first, 0, hello('to the first'))
    bridge.__emit(second, 0, hello('to the second'))
    bridge.__emit(second, 1, reply('answering the second'))

    // Each session's events land in its own transcript and nowhere else.
    expect(store.get(first)?.transcript.items.map((item) => 'text' in item && item.text)).toEqual([
      'to the first',
    ])
    expect(store.get(second)?.transcript.items.map((item) => 'text' in item && item.text)).toEqual([
      'to the second',
      'answering the second',
    ])
    await nextTick()
    expect(store.live.value.map((record) => record.sessionId)).toEqual([first, second])
    store.dispose()
  })

  it('keeps a conversation running while you read another one', () => {
    // The switch is not in the store at all — there is nothing here to switch. That is the
    // point: a session cannot go quiet because the view moved, because the view is elsewhere.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    expect(Object.keys(store)).not.toContain('activeId')
    store.dispose()
  })

  it('never asks the host to reopen something it is already running', async () => {
    // This is the "session is already open" error, gone by construction: the store answers from
    // what it already holds instead of asking.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    const again = await store.resume(id)

    expect(again).toBe(id)
    expect(bridge.__calls.filter((call) => call.startsWith('resume:'))).toEqual([])
    expect(store.launchError.value).toBeNull()
    store.dispose()
  })

  it('holds events that arrive before the host has said what the session is', async () => {
    // The provider starts talking the moment it is spawned, which can be before `createSession`
    // resolves. Those events are the beginning of the conversation, not noise.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)

    // Two sessions opening at once, one of them already streaming.
    bridge.__emit('sess_1', 0, hello('said before we were told'))
    bridge.__emit('sess_2', 0, hello('the other one, also early'))

    await store.create({ provider: 'claude' }) // becomes sess_1
    await store.create({ provider: 'codex' }) // becomes sess_2

    expect(store.get('sess_1')?.transcript.items.map((i) => 'text' in i && i.text)).toEqual([
      'said before we were told',
    ])
    // The old single-session code cleared one shared buffer on every start; the second session's
    // opening events would have gone with it.
    expect(store.get('sess_2')?.transcript.items.map((i) => 'text' in i && i.text)).toEqual([
      'the other one, also early',
    ])
    store.dispose()
  })

  it('continues the ordinals across a resume, so the seam raises no gap', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_old', [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      { ordinal: 1, at: 2_000, event: reply('this') },
      {
        ordinal: 2,
        at: 3_000,
        event: {
          type: 'session',
          state: 'ended',
          ref: { provider: 'claude', sessionId: 'x', cwd: '/w', rotation: 0 },
        },
      },
    ])

    await store.resume('sess_old')
    // The live stream carries on from where the recording stopped.
    bridge.__emit('sess_old', 3, reply('and now this'))

    const items = store.get('sess_old')?.transcript.items ?? []
    expect(items.map((item) => 'text' in item && item.text)).toEqual([
      'what did we say?',
      'this',
      // ⚑ **D-017b · no `session ended` notice** — whether a process runs is never said (`05` rule
      // 5), so the replay's ending draws nothing between the two lives.
      'and now this',
    ])
    // A hole would have been folded in as an error notice; there is none.
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(false)
    // …and it is usable again rather than still reading as the ended session it was.
    expect(store.get('sess_old')?.transcript.ended).toBe(false)
    store.dispose()
  })

  /**
   * ## An attached conversation never stopped, so nothing in it may be declared finished (100)
   *
   * ⚠️ **653 · of its RUNNING life.** An attached hand-over whose running life was itself a reopen
   * carries `liveFrom`, and the life before it IS corrected there — see
   * `a-woken-conversation-drawn-as-ended.test.ts`. The fixture below has no earlier life, which is
   * the case this section is about.
   *
   * `markReopened` says, in its own words, *"the only true one on reopen is that nothing is
   * running"*: it settles every pending card, clears the activity, stops the running sub-agents and
   * closes the open tool calls. That is right for a RECORDING being reopened and wrong for a
   * session the host never stopped — and the difference is the whole reason `attachOpen` is not
   * just `resume` under another name.
   *
   * Driven as an A/B against the SAME history, because that is the only way to show the difference
   * is the code path rather than the fixture.
   */
  const stillWaiting = (): PersistedEventInfo[] => [
    { ordinal: 0, at: 1_000, event: hello('run it') },
    // ⚠️ **A tool call with no result — a tool that is RUNNING** (review sweep). The invariant names
    // three things an attached session keeps: an answerable card, a running tool, and a running
    // sub-agent. Testing only the card would leave `stopOpenToolCalls` — which `markReopened` also
    // calls — unpinned, and it is the one that draws a working tool as finished.
    {
      ordinal: 1,
      at: 1_500,
      event: { type: 'tool_call', id: 'call_live', name: 'Bash', summary: 'sleep 30' },
    },
    {
      ordinal: 2,
      at: 2_000,
      event: {
        type: 'permission_request',
        id: 'req_live',
        kind: 'command',
        action: 'run a command',
        detail: 'ls',
        scope: {
          cwd: '/work',
          paths: [],
          networkHosts: [],
          persistence: 'once',
          amendments: [],
          availableDecisions: ['allow', 'deny'],
          underDisclosed: false,
        },
      },
    },
  ]

  it('leaves an attached conversation still waiting on the question it is waiting on', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_live', stillWaiting())
    bridge.__held.add('sess_live')

    expect(await store.attachOpen()).toEqual(['sess_live'])

    const items = store.get('sess_live')?.transcript.items ?? []
    const card = items.find((item) => item.kind === 'permission')
    // Still answerable: this agent is sitting in front of the user right now waiting for a click.
    expect(card).toMatchObject({ outcome: null })
    expect(card && 'note' in card && card.note).toBeFalsy()
    // …and the tool it is running is still running, not drawn as one that died with a past life.
    const tool = items.find((item) => item.kind === 'tool')
    expect(tool).toBeDefined()
    expect(tool && 'unfinished' in tool && tool.unfinished).toBeFalsy()
    // …and the epoch that would have made a re-fold settle both of them later was never written.
    expect(store.get('sess_live')?.liveFrom).toBeNull()
    store.dispose()
  })

  it('does not fold an event twice when it is both buffered and in the replayed page', async () => {
    // ⚠️ **Found in review.** The host writes an event to the ledger and THEN pushes it to the
    // sink, so an event that arrives while the hand-over is in flight is already inside the history
    // the host read — and the buffer holds it too, because this record has no `meta` yet. Applied
    // twice, `acceptEvent` folds the duplicate in AND reports a gap, because the ordinal it gets is
    // not the one it is waiting for. Only a LIVE hand-over can produce this; a stopped conversation
    // emits nothing mid-resume, which is why the resume path never met it.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_live', [
      { ordinal: 0, at: 1_000, event: hello('run it') },
      { ordinal: 1, at: 2_000, event: reply('the reply that must appear once') },
    ])
    bridge.__held.add('sess_live')

    const attaching = store.attachOpen()
    // Delivered before the answer comes back — the same ordinal the page above already carries.
    bridge.__emit('sess_live', 1, reply('the reply that must appear once'), 2_000)
    await attaching

    const items = store.get('sess_live')?.transcript.items ?? []
    const replies = items.filter(
      (item) => 'text' in item && item.text === 'the reply that must appear once',
    )
    expect(replies).toHaveLength(1)
    // …and no hole was invented, which is the second half of the same mistake.
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(false)
    // Non-vacuity: the page really was replayed, so this is not passing over an empty transcript.
    expect(items.some((item) => 'text' in item && item.text === 'run it')).toBe(true)
    store.dispose()
  })

  it('a SECOND hand-over for a session already taken is refused, and costs it nothing (149)', async () => {
    // ⛔ **The other half of the guard 149 narrowed, and nothing pinned it — M26 came back green.**
    // Reconciliation runs on its own the moment a store is built and a click can be in the air at
    // the same time, so two hand-overs for one conversation can both be in flight. The second must
    // stop: `openWindow` clears the record before it replays, so re-adopting throws away every live
    // event folded since the first one — the busiest conversations losing the most.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_live', [{ ordinal: 0, at: 1_000, event: hello('run it') }])
    bridge.__held.add('sess_live')

    expect(await store.resume('sess_live')).toBe('sess_live') // the click gets there first
    bridge.__emit('sess_live', 1, reply('and this arrived after the hand-over'), 2_000)

    // …and the reconciliation lands afterwards, offering the same conversation again.
    expect(await store.attachOpen()).toEqual([]) // it reports taking nothing, because it took nothing

    const items = store.get('sess_live')?.transcript.items ?? []
    expect(items.some((item) => 'text' in item && item.text === 'run it')).toBe(true)
    expect(
      items.some((item) => 'text' in item && item.text === 'and this arrived after the hand-over'),
    ).toBe(true)
    store.dispose()
  })

  it('never reports a reopen this window cannot show — the claim needs a source (149, 039)', async () => {
    // ⛔ **148 H1's other half.** `resume` used to return the id the moment the round trip resolved,
    // whatever the window had done with it, which is how a refused adoption was reported as a
    // reopened conversation. The question it answers now is "is this conversation open HERE".
    //
    // Reachable, and this is how: two reopens in flight for one session. Both take the same record
    // — `slot` returns it — and the one that FAILS deletes it, because it was never adopted. The
    // survivor then adopts a record the map no longer holds: adopted, phase `open`, and invisible to
    // every list in the app. Reporting success there would strand it exactly as H1 did.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const real = bridge.resume
    let release: (() => void) | null = null
    let call = 0
    bridge.resume = (input) => {
      call += 1
      // The first press is held open; the second is refused while it waits.
      if (call === 1) return new Promise((resolve) => (release = () => resolve(real(input))))
      return Promise.reject(new Error('the host said no'))
    }

    const held = store.resume('sess_x')
    expect(await store.resume('sess_x')).toBeNull() // the refusal deletes the never-adopted record
    release!()

    expect(await held).toBeNull()
    expect(store.isLive('sess_x')).toBe(false)
    expect(store.live.value.map((record) => record.sessionId)).not.toContain('sess_x')
    store.dispose()
  })

  it('settles the same card when the conversation is REOPENED, which is the difference', async () => {
    // ⚠️ **The other half of the A/B, and without it the test above is just an assertion that a
    // card is unsettled — which would pass against a build where nothing was ever settled at all.**
    // 085's rule stands for a genuine reopen: the buttons reach a new adapter that has never heard
    // of the id, so offering them is offering to act on the past.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__history.set('sess_old', stillWaiting())

    await store.resume('sess_old')

    const items = store.get('sess_old')?.transcript.items ?? []
    const card = items.find((item) => item.kind === 'permission')
    expect(card && 'note' in card && card.note).toContain('when this conversation was last open')
    // …and the tool really is marked as having died with the session it belonged to.
    const tool = items.find((item) => item.kind === 'tool')
    expect(tool && 'unfinished' in tool && tool.unfinished).toBe(true)
    expect(store.get('sess_old')?.liveFrom).not.toBeNull()
    store.dispose()
  })

  it('reports a gap rather than pretending the conversation is whole', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    bridge.__emit(id, 0, hello('one'))
    bridge.__emit(id, 5, reply('five'))

    const items = store.get(id)?.transcript.items ?? []
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(true)
    store.dispose()
  })

  it('drops a session from the open list when it ends, and leaves the others alone', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''

    // ⚑ The ledger holds what the host sent — the page a look draws the record from (D-017b).
    bridge.__history.set(first, [{ ordinal: 0, at: 1_700_000_000_000, event: ended }])
    bridge.__emit(first, 0, ended)
    await nextTick()

    expect(store.live.value.map((record) => record.sessionId)).toEqual([second])
    // ⚑ **D-017b · its fold ended, so it is looked at again** — drawn from its ledger, `recorded`,
    // in the same view, rather than kept as the ended life's record.
    await vi.waitFor(() => {
      expect(bridge.__calls).toContain(`look:${first}`)
      expect(store.get(first)?.meta).toMatchObject({ handover: 'recorded' })
    })
    // It is not forgotten — the record stays, so a chat you close does not vanish while you are
    // still reading it. A message sent from it continues it.
    expect(store.get(first)?.phase).toBe('recorded')
    expect(store.get(first)?.transcript.ended).toBe(true)
    // The record is still here, which is what lets the screen keep showing a chat you just
    // closed instead of blanking it mid-read.
    expect(store.get(first)).not.toBeNull()
    expect(store.isLive(first)).toBe(false)
    store.dispose()
  })

  it('⚑ a recorded conversation let go tells the host this window stopped looking at it; one still held does not', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = 'sess_recorded'
    bridge.__history.set(id, [{ ordinal: 0, at: 1_700_000_000_000, event: ended }])
    expect(await store.look(id)).toBe(id)
    expect(store.get(id)?.phase).toBe('recorded')

    // ⛔ Held while a look at it is out: it is not let go, so the host is told nothing.
    const again = store.look(id, 'again')
    store.forget(id)
    expect(bridge.__calls).not.toContain(`stopLooking:${id}`)
    await again

    // ⚑ Let go: the host is told, once.
    store.forget(id)
    expect(store.get(id)).toBeNull()
    expect(bridge.__calls.filter((call) => call === `stopLooking:${id}`)).toHaveLength(1)
    store.dispose()
  })

  it('reports a close the host AGREED to, which is the half a reopen rides on (147)', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    expect(await store.close(id)).toBe(true)
    expect(store.get(id)?.phase).toBe('recorded')
    store.dispose()
  })

  /**
   * ## Close and reopen the same record
   *
   * ⛔ **The premises were split and that is why nothing caught it.** Resume was tested on a virgin
   * record, close was tested on its own, and no test did both to one record — so a guard that read
   * *"already adopted"* off `meta` alone, and therefore refused to re-adopt a record whose life had
   * ENDED, satisfied every assertion in this file while stranding a live provider child behind a
   * conversation the window called over. The only way out was reloading the window, which works
   * because a fresh renderer holds no already-adopted record.
   *
   * ⚑ **It was never the sign-in button's bug.** Any close-then-reopen inside one window took this
   * path; the amber remedy is simply the first thing that does both in one gesture.
   */
  it('close then resume on the SAME record leaves the conversation OPEN and visible (149)', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, hello('what did we say?'))
    // What the host will hand back: this conversation's ledger, ending where it stopped.
    bridge.__history.set(id, [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      {
        ordinal: 1,
        at: 2_000,
        event: {
          type: 'session',
          state: 'ended',
          ref: { provider: 'claude', sessionId: 'x', cwd: '/w', rotation: 0 },
        },
      },
    ])

    expect(await store.close(id)).toBe(true)
    expect(store.isLive(id)).toBe(false) // the premise: an adopted record that has ended

    expect(await store.resume(id)).toBe(id)

    // ⛔ The four ways the failure showed itself, each asserted rather than inferred from one flag.
    expect(store.get(id)?.phase).toBe('open')
    expect(store.isLive(id)).toBe(true)
    expect(store.live.value.map((record) => record.sessionId)).toContain(id)
    expect(store.get(id)?.control.ended).toBe(false) // …and the composer is usable again

    // ⚠️ **And the previous life was not folded in twice.** 064 measured exactly that — "a
    // three-message conversation closed and reopened rendered six messages" — and `openWindow`
    // clearing the record first is what keeps re-adoption safe.
    const items = store.get(id)?.transcript.items ?? []
    expect(items.filter((item) => 'text' in item && item.text === 'what did we say?')).toHaveLength(
      1,
    )
    store.dispose()
  })

  /**
   * 🔴 **The sentence 239 called the most trust-eroding thing in the running app** (242 §3).
   *
   * ⛔ **What a person sees, twice per Codex Resume**: *"event stream gap: expected ordinal 108, got
   * 111"*, then *"expected ordinal 135, got 138"* — printed into the ordinary conversation, in
   * 239's words *"an intact-looking transcript announcing that it may not be intact."*
   *
   * ## ⛔ Measured before it was fixed, and the sentence is TRUE
   *
   * ⚑ **The ledger is whole.** `deliver` takes the ordinal, writes the row, and only then pushes to
   * the sink — so every one of the missing events is on disk, in order, and `assertGapFree` over the
   * session's ledger passes. ⚠️ **What is missing is what the RENDERER kept**, and this is where it
   * goes:
   *
   *  1. The host reads the history page and takes `startingOrdinal` **before** `runtime.resume`.
   *  2. `register` starts the pump, so the new life's first events are sent to the sink
   *     immediately — while the `resume` IPC answer is still travelling back to this window.
   *  3. ⛔ **The listener folded them**, because the routing test was `record?.meta` and a reopened
   *     conversation's record HAS `meta` — it is the record the previous life left behind.
   *  4. `replayInto` then clears the window and re-anchors `nextOrdinal` to the page, which ENDS
   *     BEFORE those events. They are gone, and the next live event is reported as a gap.
   *
   * 🔴 **So the notice is not the bug; it is the only honest thing in the sequence.** It is
   * correctly reporting a hole that was really there, and the repair is to stop making the hole —
   * `earlyEvents` and `adoptSession`'s drain, which already exist for exactly this, simply were not
   * reachable on the one path where a record already had `meta`.
   *
   * ⚠️ **Three, both times, because three is what Codex emits between register and the answer.**
   * The number is a property of the provider's opening, not of the mechanism.
   */
  it('🔴 events that land WHILE the reopen is in flight are kept, not dropped (242 §3, 239)', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, hello('what did we say?'))
    bridge.__history.set(id, [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      {
        ordinal: 1,
        at: 2_000,
        event: {
          type: 'session',
          state: 'ended',
          ref: { provider: 'claude', sessionId: 'x', cwd: '/w', rotation: 0 },
        },
      },
    ])
    expect(await store.close(id)).toBe(true)

    // ⚑ **The race, made deterministic.** The host's pump is running before its answer arrives, so
    // these three are emitted after the history window was snapshotted and before `resume` resolves
    // — which is exactly the ordering `reopenSession` produces and cannot avoid.
    const answer = bridge.resume
    bridge.resume = async (input) => {
      const resumed = await answer(input)
      bridge.__emit(id, 2, reply('first of the new life'))
      bridge.__emit(id, 3, reply('second'))
      bridge.__emit(id, 4, reply('third'))
      return resumed
    }

    expect(await store.resume(id)).toBe(id)
    bridge.__emit(id, 5, reply('and now this'))

    const items = store.get(id)?.transcript.items ?? []
    // ⛔ **No hole reported**, which is the sentence a person was reading…
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(false)
    // …and the three events it was telling the truth about are ON SCREEN.
    expect(items.map((item) => ('text' in item ? item.text : item.kind))).toEqual([
      'what did we say?',
      // ⚑ D-017b: the previous life's ending draws no `session ended` notice (`05` rule 5).
      'first of the new life',
      'second',
      'third',
      'and now this',
    ])
    store.dispose()
  })

  it('🔴 a SECOND reopen settling first does not un-hold the first one (242 §3, adversarial pass)', async () => {
    /**
     * ⛔ **The hold was a boolean, and two reopens of one session are reachable.**
     *
     * `store.resume` is wired to `@reopen` from both the side rail and the session library, and
     * their re-entrancy guards are separate per-component maps that do not consult each other. So
     * the second press's `finally` lowered the flag while the FIRST was still waiting on the
     * provider — and every event from that moment was folded into the transcript `replayInto` was
     * about to clear. ⚠️ **242 §3's defect, reintroduced by 242 §3's fix**, which is why the hold is
     * a COUNT.
     */
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, hello('what did we say?'))
    bridge.__history.set(id, [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      {
        ordinal: 1,
        at: 2_000,
        event: {
          type: 'session',
          state: 'ended',
          ref: { provider: 'claude', sessionId: 'x', cwd: '/w', rotation: 0 },
        },
      },
    ])
    expect(await store.close(id)).toBe(true)

    // A slow first reopen, and a fast second one that settles while the first is still out.
    const answer = bridge.resume
    // ⚠️ A no-op rather than `null`: the only assignment is inside a Promise executor, which TS's
    // control flow does not follow, so a nullable would narrow to `null` at the call below.
    let releaseFirst = (): void => {}
    let call = 0
    bridge.resume = async (input) => {
      call += 1
      if (call === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
        return await answer(input)
      }
      // The second press is refused by the host — "already opening" — and takes the failure exit,
      // which is the one that must NOT lower a hold it does not own.
      throw new Error('session is already opening')
    }

    const first = store.resume(id)
    const second = store.resume(id)
    await expect(second).resolves.toBeNull()

    // ⛔ The events the new life emits WHILE the first reopen is still in flight.
    bridge.__emit(id, 2, reply('first of the new life'))
    bridge.__emit(id, 3, reply('second'))
    bridge.__emit(id, 4, reply('third'))
    releaseFirst()
    expect(await first).toBe(id)
    bridge.__emit(id, 5, reply('and now this'))

    const items = store.get(id)?.transcript.items ?? []
    expect(
      items.some((item) => item.kind === 'notice' && item.text.includes(NOT_REACHED_THIS_WINDOW)),
    ).toBe(false)
    expect(items.map((item) => ('text' in item ? item.text : item.kind))).toEqual([
      'what did we say?',
      // ⚑ D-017b: the previous life's ending draws no `session ended` notice (`05` rule 5).
      'first of the new life',
      'second',
      'third',
      'and now this',
    ])
    store.dispose()
  })

  it('⛔ …and a reopen that FAILS does not keep them in a buffer nobody reads (242 §3)', async () => {
    // ⚠️ **The other end of the hold.** `foldHeldEvents` runs on the successful path from inside
    // `adoptSession`; a refused reopen never reaches it, so without the failure branch these events
    // would be received by this window, held, and never drawn — a quieter version of the very
    // defect being fixed.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, hello('what did we say?'))
    expect(await store.close(id)).toBe(true)

    bridge.resume = () => {
      bridge.__emit(id, 1, reply('arrived while the reopen was failing'))
      return Promise.reject(new Error('the host said no'))
    }
    // ⚑ The ledger holds both: the host writes a row before it sends it (`deliver`).
    bridge.__history.set(id, [
      { ordinal: 0, at: 1_000, event: hello('what did we say?') },
      { ordinal: 1, at: 2_000, event: reply('arrived while the reopen was failing') },
    ])
    expect(await store.resume(id)).toBeNull()

    // ⚑ **D-017b · a RECORDED record's held events are not folded into its page**: they say this
    // window is being fed the conversation, so it is looked at again, and the page it is drawn from
    // has them. ⛔ And nothing is left in the buffer.
    await vi.waitFor(() => {
      expect(bridge.__calls).toContain(`look:${id}`)
      const items = store.get(id)?.transcript.items ?? []
      expect(items.map((item) => ('text' in item ? item.text : item.kind))).toContain(
        'arrived while the reopen was failing',
      )
    })
    expect(store.get(id)?.earlyEvents).toEqual([])
    store.dispose()
  })

  it('⛔ …and does not ask the host about a session it is already being handed (242 §3)', async () => {
    // ⚠️ **The cost of holding events, kept at zero.** `askAboutUnknown` exists for a session nobody
    // ever described (172); a hand-over in flight IS the description, and asking again would spend a
    // round trip — carrying every open conversation's history window — to be told what is already on
    // its way. The bound in 172 M2 makes it one wasted trip rather than one per event, which is why
    // this is a cost rather than a storm; it is still a trip nothing needed.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    expect(await store.close(id)).toBe(true)
    const before = bridge.__calls.filter((call) => call === 'attachOpen').length

    const answer = bridge.resume
    bridge.resume = async (input) => {
      bridge.__emit(id, 1, reply('mid-handover'))
      return await answer(input)
    }
    await store.resume(id)

    expect(bridge.__calls.filter((call) => call === 'attachOpen')).toHaveLength(before)
    store.dispose()
  })

  it('…and a resume the host REFUSED still reports failure — the paired negative (149)', async () => {
    // The other half of the pair. Reporting the id is a claim that this window has the conversation
    // open; when it does not, saying so is what puts the sentence under the row the user pressed and
    // keeps the Resume there to press again.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    expect(await store.close(id)).toBe(true)
    bridge.resume = () => Promise.reject(new Error('the host said no'))

    expect(await store.resume(id)).toBeNull()
    expect(store.isLive(id)).toBe(false)
    expect(store.get(id)?.phase).toBe('recorded')
    expect(store.resumeError.value).toBe('the host said no')
    store.dispose()
  })

  it('does not call a session ended when the host refused to close it', async () => {
    // Marking it ended anyway would drop a conversation the host is still running out of the
    // list, and the only way back would be a reopen the host would then refuse.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.close = () => Promise.reject(new Error('the host said no'))

    // ⚑ **And it SAYS the host refused** (147). `reopenSignIn` closes and then reopens, and a reopen
    // on top of a close that failed attaches to the very child it was trying to leave behind — and
    // reports success. The sentence is already on the record; this boolean is what lets a caller
    // stop. The pair matters: the success case below has to answer `true`, or a caller that checked
    // it would never reopen anything.
    expect(await store.close(id)).toBe(false)

    expect(store.isLive(id)).toBe(true)
    expect(store.get(id)?.error).toBe('the host said no')
    // ⚠️ **And the word goes back to `open`** (089). `closing` is a claim about a future that is
    // not coming; a row left in it would draw a fading underline, forever, on a live conversation.
    expect(store.get(id)?.phase).toBe('open')
    store.dispose()
  })

  /**
   * ⚠️ **The window `closing` exists for** (089). Teardown drains and archives (075), and for the
   * whole of it the provider still reports `live` — `LivenessState` has no word for this. That a
   * close was asked for is a fact only this side holds, which is why the store says it rather than
   * waiting to be told (064's principle, on the way out).
   */
  it('says a session is CLOSING from the moment we ask, not when the ending lands', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    expect(store.get(id)?.phase).toBe('open')

    let release = (): void => {}
    bridge.close = () =>
      new Promise<void>((resolve) => {
        release = () => resolve()
      })
    const closing = store.close(id)
    await nextTick()

    // Mid-teardown: on its way out, and still in the open list, because it is still open.
    expect(store.get(id)?.phase).toBe('closing')
    expect(store.isLive(id)).toBe(true)

    release()
    await closing
    expect(store.get(id)?.phase).toBe('recorded')
    expect(store.isLive(id)).toBe(false)
    store.dispose()
  })

  it('says it about a session closed before the host finished opening it, too', async () => {
    // ⚠️ The case the first version of this missed (089 review): the guard read `=== 'open'`, so a
    // conversation closed while still `opening` went `starting → ended` with no closing state at
    // all — and that is the case where teardown is MOST likely to take a visible moment, because
    // the host must wait for the provider to arrive before it can stop it.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    const record = store.get(id)!
    record.phase = 'opening'

    let fail = (): void => {}
    bridge.close = () =>
      new Promise<void>((_resolve, reject) => {
        fail = () => reject(new Error('the host said no'))
      })
    const closing = store.close(id)
    await nextTick()
    expect(store.get(id)?.phase).toBe('closing')

    // …and a refusal puts back the phase it actually had, not a flat `open` it was never in.
    fail()
    await closing
    expect(store.get(id)?.phase).toBe('opening')
    store.dispose()
  })

  it('sends to the session you name, not to whichever spoke last', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''

    await store.send(first, 'for the first')
    await store.send(second, 'for the second')

    expect(bridge.__calls.filter((call) => call.startsWith('send'))).toEqual([
      `send:${first}`,
      `send:${second}`,
    ])
    store.dispose()
  })

  it('the USER picks interrupt-or-queue; a bare send never interrupts on its own (077)', async () => {
    // A plain send from the open composer must not silently interrupt and discard the running
    // turn’s work. The person chooses whether to queue or interrupt a mid-turn message.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, { type: 'status', state: 'working' })

    await store.send(id, 'stop that, do this instead', 'interrupt')
    await store.send(id, 'and afterwards, this', 'queue')

    expect(bridge.__calls).toContain(`sendInterrupting:${id}`)
    expect(bridge.__calls).toContain(`queueMessage:${id}`)
    store.dispose()
  })

  it('⛔ a cancel names the MESSAGE, and the name reaches the wire (354)', async () => {
    // ⚠️ **The store is the last place the id could be dropped**, and dropping it would not fail:
    // `cancelQueuedMessage` used to be built from `SessionInput`, so a bridge call missing the field
    // would simply be a command the schema refuses one layer further out — a refusal nobody in this
    // suite would see. This is the assertion that makes the store carry it.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    await store.cancelQueuedMessage(id, 'msg_the_one_on_screen')

    expect(bridge.__calls).toContain(`cancelQueued:${id}:msg_the_one_on_screen`)
    // ⚑ **Non-vacuous**: the string really does carry both halves, so an id that never arrived would
    // read `…:undefined` and this would go red rather than matching on the session alone.
    expect(bridge.__calls).not.toContain(`cancelQueued:${id}:undefined`)
    store.dispose()
  })

  it('⛔ stopping one piece of background work leaves the conversation alone (248 §4)', async () => {
    // ⚠️ **`busy` is the assertion, not decoration.** `forSession` — which every other control verb
    // here goes through — raises `record.busy` for the length of the call, and that is right for
    // `interrupt`: the session IS busy, which is why you are interrupting it. This gesture leaves
    // the turn untouched, so a session that went `busy` would darken the plan's two buttons and the
    // sign-in Reopen, mid-press, on an idle conversation (737: not the composer, which `busy` never
    // reached). `094` is the dispatch about a state and its affordances disagreeing.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    const record = store.live.value.find((one) => one.sessionId === id)
    expect(record, 'the conversation this test is about').toBeDefined()

    const answer = store.stopBackgroundWork(id, 'b6uoyo82k')
    expect(record?.busy, 'the conversation is not made busy by stopping one task').toBe(false)
    await expect(answer).resolves.toBe(true)
    expect(bridge.__calls).toContain(`stopBackgroundWork:${id}:b6uoyo82k`)
    store.dispose()
  })

  it('⛔ …and a stop that FAILS says so beside the conversation (106, 118)', async () => {
    // A control that failed and said nothing is a control that cannot act pretending it can. The
    // rejection here is a real one from the real `runtimeCommandSchema` — `throughTheWire` refuses
    // an empty id — so what is under test is what the store does with a bridge that threw, not a
    // hand-built error object.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    const record = store.live.value.find((one) => one.sessionId === id)

    await expect(store.stopBackgroundWork(id, '')).resolves.toBe(false)
    expect(record?.error, 'the failure reached the session banner').toBeTruthy()
    // …and the paired positive: the conversation is still usable, which is the whole point of the
    // verb being separate from `interrupt`.
    expect(record?.busy).toBe(false)
    store.dispose()
  })

  it('🔴 a handed PATH goes down whichever branch the intent picks (216 §2)', async () => {
    // ⛔ A mutation survived the table until this existed: the store spread `attachments` onto one
    // branch and not the others, so attaching while the agent happened to be BUSY sent the words and
    // dropped the paths — the chip vanishing as if it had gone.
    const attachments = [{ path: '/work/alpha/notes.md', kind: 'file' as const, outsideCwd: false }]
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, { type: 'status', state: 'working' })

    await store.send(id, 'interrupting', 'interrupt', attachments)
    await store.send(id, 'queueing', 'queue', attachments)

    // Every branch that was taken carried them.
    expect(bridge.__inputs).toHaveLength(2)
    expect(bridge.__inputs.every((input) => input.attachments?.length === 1)).toBe(true)
    expect(bridge.__inputs.map((input) => input.text)).toEqual(['interrupting', 'queueing'])
    store.dispose()
  })

  it('🔴 WHAT THE STORE PUTS ON THE BRIDGE CLONES — the defect 216 shipped, found live by 218', async () => {
    // ⛔ **This is what was actually broken in the running app, on both surfaces, from `3151a36`.**
    // Pressing Send with anything attached put `An object could not be cloned.` on the screen and
    // ended the session with no turn at all — the attachment never reached the host, ever.
    //
    // ⚠️ **`createAttachmentBook` keeps the staged paths in a `reactive(new Map())`**, so what a
    // composer hands back to `send` is a Vue Proxy. The store spread the ARRAY and left every
    // element a proxy; `ipcRenderer.invoke` structured-clones its payload, and that algorithm
    // refuses a Proxy by name.
    //
    // ⚑ **The two tests above pass on the broken version**, and that is the point of this one: they
    // hand the store an object LITERAL, which clones perfectly. Only a value that came out of the
    // book the app actually uses reproduces it — and only the clone algorithm itself, run over what
    // reached the bridge, can tell the two apart.
    const book = createAttachmentBook()
    book.write(draftKey('a'), [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }])
    const staged = book.read(draftKey('a'))
    // The defect is present in the INPUT — if Vue ever stops proxying here this line fails and the
    // guard can be retired deliberately rather than sitting green over a problem that moved.
    expect(() => structuredClone(staged), 'a reactive read is no longer a Proxy').toThrow()

    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    await store.send(id, 'look at this', 'now', staged)

    const sent = bridge.__inputs.at(-1)?.attachments
    // 🔴 The claim: what crossed is cloneable, which is the only thing the real bridge asks of it.
    expect(() => structuredClone(sent)).not.toThrow()
    expect(sent).toEqual([{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }])
    store.dispose()
  })

  it('🔴 an ATTACHMENT-ONLY message is sent, not swallowed as "nothing to send"', async () => {
    // ⛔ Found in review, and it survived the mutation table until this existed: the empty-text
    // early-out guarded on the words alone, so "here, look at this" with a folder staged returned
    // `true` — reported as SENT — having sent nothing. `messageWithHandedPaths` composes exactly
    // this case (with no words it sends the block alone), so the store must let it through.
    const attachments = [{ path: '/work/alpha/src', kind: 'directory' as const, outsideCwd: false }]
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    expect(await store.send(id, '', 'now', attachments)).toBe(true)
    expect(bridge.__inputs).toHaveLength(1)
    expect(bridge.__inputs[0]?.attachments).toEqual(attachments)

    // ⚑ THE PAIRED NEGATIVE: nothing typed and nothing attached still short-circuits, because that
    // really is nothing to send — and returning `false` would make the caller hand an empty string
    // back to a composer the user had just cleared.
    expect(await store.send(id, '   ', 'now', [])).toBe(true)
    expect(bridge.__inputs).toHaveLength(1)
    store.dispose()
  })

  it('⛔ the double REFUSES a shape the wire refuses — the teeth on `throughTheWire` (221 §4)', async () => {
    // ⚠️ **Without this, every assertion in this file is over a fake that might be validating
    // nothing.** A wrapper that silently skipped every method would leave all 47 tests green and
    // the vacuity exactly where it was — which is the shape of the defect it was written for.
    const bridge = fakeBridge()

    // A message with no words and nothing attached: refused by the schema, as `077` always meant.
    await expect(bridge.send({ sessionId: 'sess_1', text: '' })).rejects.toThrow(
      /the wire would refuse this send/,
    )
    // …on all three send verbs, and on whitespace, which `min(1)` used to let through.
    await expect(bridge.queueMessage({ sessionId: 'sess_1', text: '  ' })).rejects.toThrow(
      /the wire would refuse this queueMessage/,
    )
    await expect(bridge.sendInterrupting({ sessionId: 'sess_1', text: '' })).rejects.toThrow(
      /the wire would refuse this sendInterrupting/,
    )
    // ⛔ …and a rule that has nothing to do with sending, so the wrapper is not a send special case:
    // an attachment path must be ABSOLUTE (216, found in review).
    await expect(
      bridge.send({
        sessionId: 'sess_1',
        text: 'look',
        attachments: [{ path: '.env', kind: 'file', outsideCwd: false }],
      }),
    ).rejects.toThrow(/absolute/)

    // ⚑ **THE PAIRED POSITIVE**: the shapes the app really sends still go straight through, so this
    // is a gate rather than a wall. Nothing above reached the recorder; both below did.
    expect(bridge.__inputs).toHaveLength(0)
    await bridge.send({ sessionId: 'sess_1', text: 'words' })
    await bridge.send({
      sessionId: 'sess_1',
      text: '',
      attachments: [{ path: '/work/alpha/src', kind: 'directory', outsideCwd: false }],
    })
    expect(bridge.__inputs).toHaveLength(2)
  })

  it('⚑ …and a send with NOTHING attached carries no such key, so the ordinary wire is unchanged', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    await store.send(id, 'just words')

    expect(bridge.__inputs).toEqual([{ sessionId: id, text: 'just words' }])
    store.dispose()
  })

  it('an unqualified send into a running turn QUEUES rather than interrupting (077)', async () => {
    // The race: the composer decided "idle" and the turn started before the command landed. It is
    // resolved to the non-destructive side on purpose — interrupting would throw away work nobody
    // asked to discard, on the strength of a status that changed mid-keypress.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, { type: 'status', state: 'working' })

    await store.send(id, 'typed while it looked idle')

    expect(bridge.__calls).toContain(`queueMessage:${id}`)
    // Paired positive/negative (086): the queue call above proves something happened, and these
    // prove it was not either of the two operations that would have been wrong.
    expect(bridge.__calls).not.toContain(`sendInterrupting:${id}`)
    expect(bridge.__calls).not.toContain(`send:${id}`)
    store.dispose()
  })

  it('says whether the message GOT THROUGH, so a refusal can hand the text back (077)', async () => {
    // ⚠️ The composer clears the box on emit. Without a truthful answer here, a refused send —
    // teardown, an ended conversation, or a message already waiting — takes the user's text with
    // it. That is the "silently dropped message" the dispatch calls the worst outcome, and 077 is
    // what made it reachable by adding two new refusals.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, { type: 'status', state: 'working' })

    expect(await store.send(id, 'this one lands', 'queue')).toBe(true)

    bridge.queueMessage = () => Promise.reject(new Error('a message is already waiting to be sent'))
    expect(await store.send(id, 'this one is refused', 'queue')).toBe(false)
    // The reason reaches the session, so the surface can say why as well as hand the text back.
    expect(store.get(id)?.error).toContain('already waiting')

    store.dispose()
  })

  it('an empty message reports success — nothing was lost, so nothing is handed back (077)', async () => {
    // `false` here would make the caller write an empty string into a box the user had just
    // cleared, which is a different way of losing what they were typing.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    expect(await store.send(id, '   ')).toBe(true)
    expect(bridge.__calls).not.toContain(`send:${id}`)
    store.dispose()
  })

  it('reads the SESSION being working, not the page being read (064)', async () => {
    // ⚠️ 061 finding 5, on the send path: *"send can call the wrong bridge operation."* A reader
    // paged back into a quiet stretch of history left `record.transcript.status` at whatever that
    // stretch ended on, and the choice of bridge operation was read off it — so a message aimed at
    // a running turn went out as a plain send and the runtime refused it.
    //
    // 077 changed WHICH operation the busy case picks (queue, not interrupt) and changed nothing
    // about the rule this test exists for: the answer still comes from `control`, never from the
    // fold the reader happens to be looking at.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    const record = store.get(id)!

    // The shape a release produces: the reading fold is a page of old history that ends idle, the
    // control fold is the live tail and it is working.
    record.control = createTranscript()
    record.tail = tailWindow([])
    applyEvent(record.control, { type: 'status', state: 'working' })
    expect(record.transcript.status).toBe('idle')

    await store.send(id, 'actually, do this instead')

    expect(bridge.__calls).toContain(`queueMessage:${id}`)
    // The whole point: had it read the READING fold it would have seen `idle` and sent plainly.
    expect(bridge.__calls).not.toContain(`send:${id}`)
    store.dispose()
  })

  it('takes a request off the table before it awaits anything (064)', async () => {
    // The in-flight guard used to be a `ref` inside the card, so a re-fold that remounted the card
    // handed back a fresh `false` and an already-submitted decision became clickable again (061
    // finding 8). Set on the record by the thing that actually sends, it cannot be lost that way.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''

    await store.respondPermission(id, 'req_1', { outcome: 'allow' })

    expect(store.get(id)?.requests.get('req_1')?.sent).toBe(true)
    store.dispose()
  })

  it('puts a refused request BACK on the table (064)', async () => {
    // Found by review. Making the in-flight guard durable made a FAILURE durable too: the host
    // refused the answer, so nothing echoes back on the stream, so the next re-fold rebuilds the
    // card without the note — and it would have come back with every button dead and no reason on
    // it. Before 064 a remount happened to clear the guard, which was the accident this replaces.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.respondPermission = () => Promise.reject(new Error('nope'))

    await store.respondPermission(id, 'req_1', { outcome: 'allow' })

    expect(store.get(id)?.requests.get('req_1')?.sent).toBe(false)
    store.dispose()
  })

  it('puts a failure on the session it belongs to, not on the app', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''
    bridge.interrupt = () =>
      Promise.reject(new Error("Error invoking remote method 'x': Error: nope"))

    await store.interrupt(first)

    expect(store.get(first)?.error).toBe('nope')
    expect(store.get(second)?.error).toBeNull()
    expect(store.launchError.value).toBeNull()
    store.dispose()
  })

  it('puts a refused answer on the card it was meant for, and leaves it live (473)', async () => {
    // The card disables its buttons on the first click so a second cannot race it. If the refusal
    // never reached the item, that card would sit there answerable-looking and dead, and the
    // composer — which freezes while any request is unanswered — would never thaw (Slice 2 · 005).
    //
    // 🔴 **473 · the MARK changed and the delivery did not.** This fixture is a REJECTION — the
    // pre-146 shape, where `ipcMain.handle` flattened every refusal to a `.message` — so the store
    // learns nothing about whether the request was consumed. ⛔ Since `469` measured what a wrong
    // guess costs, silence is read as *not settled*: the sentence lands on the card as `refused`,
    // above buttons that are still live, instead of as a `note` that retires it.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'claude' })) ?? ''
    bridge.__emit(id, 0, {
      type: 'permission_request',
      id: 'req_1',
      kind: 'command',
      action: 'run a command',
      detail: 'ls',
      scope: {
        cwd: '/work',
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: ['allow', 'deny'],
        underDisclosed: false,
      },
    })
    bridge.respondPermission = () =>
      Promise.reject(
        new Error("Error invoking remote method 'x': Error: request req_1 is not pending"),
      )

    await store.respondPermission(id, 'req_1', { outcome: 'allow' })

    const card = store.get(id)?.transcript.items.find((item) => item.kind === 'permission')
    expect(card).toMatchObject({ outcome: null })
    expect(card && 'refused' in card && card.refused).toContain('request req_1 is not pending')
    // ⛔ The half that says which mark it got: a note is what retires a card, and this one is not
    // retired — the provider has not been told anything.
    expect(card && 'note' in card && card.note).toBeNull()
    store.dispose()
  })

  /**
   * **146 §1 · which mark a refusal gets, and why it is not one mark.**
   *
   * ⛔ The defect 145 HIGH 1 measured: every failed response went through `markRequestFailed`,
   * which writes `note`, and any note makes a card settled and non-awaiting. The adapters refuse an
   * unusable answer BEFORE it takes the broker slot — the request is still pending, and
   * `RuntimeHost` says so — so the card lost its buttons while the provider went on waiting.
   *
   * ⚑ **The bridge here is faithful rather than canned.** It runs the real `answerToForward` — the
   * same function both adapters call — over the question the card actually holds, and translates
   * its verdict exactly as `RuntimeHost.refusalOf` does. So the refusal below is DERIVED from a
   * whitespace-only option label, not asserted into existence.
   */
  describe('a refusal that did not consume the request (146 §1)', () => {
    /** The host's own sentences, verbatim — see `RuntimeHost.refusalOf`. */
    const NOT_USABLE = 'that answer cannot be sent: every question needs one that says something'
    const NOT_PENDING = 'the agent is no longer waiting for an answer to this'

    /**
     * ⚑ **The seam with `dom/user-input-refusal.dom.test.ts`.** That test presses the chip and the
     * Answer button on a real card and asserts the payload it emits is exactly `{q0: ['   ']}`;
     * this one takes that value on. Neither half is hand-waved and the value is literal in both.
     */
    const CLICKED = { q0: ['   '] }
    const QUESTIONS = [
      {
        id: 'q0',
        prompt: 'Which one?',
        options: [{ label: '   ' }, { label: 'the real one' }],
        multiSelect: true,
      },
    ]

    const openQuestion = async (): Promise<{
      bridge: ReturnType<typeof fakeBridge>
      store: ReturnType<typeof createSessionStore>
      id: string
    }> => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      const id = (await store.create({ provider: 'claude' })) ?? ''
      bridge.__emit(id, 0, {
        type: 'user_input_request',
        id: 'toolu_1',
        prompt: 'AskUserQuestion',
        questions: QUESTIONS,
      })
      return { bridge, store, id }
    }

    const cardOf = (
      store: ReturnType<typeof createSessionStore>,
      id: string,
    ): { note: string | null; refused: string | null } => {
      const item = store.get(id)?.transcript.items.find((i) => i.kind === 'userInput')
      expect(item, 'the question card is in the transcript').toBeDefined()
      return item?.kind === 'userInput' ? item : { note: null, refused: null }
    }

    it('says why ON the card and leaves every control alive', async () => {
      const { bridge, store, id } = await openQuestion()
      // The host's own composition: the shared rule decides, `refusalOf` translates.
      bridge.respondUserInput = async ({ response }) => {
        const forward = answerToForward(
          QUESTIONS,
          response.kind === 'answer' ? response.answers : {},
        )
        return forward.forwardable
          ? { outcome: 'taken' }
          : { outcome: 'refused', reason: NOT_USABLE, stillOpen: true }
      }

      await store.respondUserInput(id, 'toolu_1', { kind: 'answer', answers: CLICKED })

      expect(cardOf(store, id).refused).toBe(NOT_USABLE)
      // ⛔ **THE DEFECT.** A note here is what removed Answer and Reject and unfroze the composer.
      expect(cardOf(store, id).note).toBeNull()
      // Still counted as waiting, which is the value `ConversationPane` freezes the composer on.
      expect(sessionPanel(store.get(id)!.control).waiting).toBe(1)
      // …and answerable a second time: the in-flight guard came back off (064).
      expect(store.get(id)?.requests.get('toolu_1')?.sent).toBe(false)
      // No red banner three paragraphs away from the card (085): a refusal is not a session fault.
      expect(store.get(id)?.error).toBeNull()
      store.dispose()
    })

    it('…and a refusal that DID consume it still settles the card', async () => {
      // The paired positive. Without it this fix would read as "no refusal ever settles anything",
      // and a card offering buttons for a request nobody is waiting on is the same lie inverted.
      const { bridge, store, id } = await openQuestion()
      bridge.respondUserInput = async () => ({
        outcome: 'refused',
        reason: NOT_PENDING,
        stillOpen: false,
      })

      await store.respondUserInput(id, 'toolu_1', { kind: 'answer', answers: CLICKED })

      expect(cardOf(store, id).note).toBe(NOT_PENDING)
      expect(cardOf(store, id).refused).toBeNull()
      expect(sessionPanel(store.get(id)!.control).waiting).toBe(0)
      store.dispose()
    })

    it('…and a fault nobody classified leaves it LIVE (473 reverses 146 here)', async () => {
      // 🔴 **The ruling this test pinned is reversed, and `469` is why.** It used to read *"an
      // unclassified throw says nothing about whether the request was consumed, so leaving the card
      // live on a guess is worse than settling it with the reason on it"*, and it settled the card.
      //
      // ⛔ **`469` drove the ordinary takeover-then-permission path and measured the cost of that
      // guess**: the window drew *Not answered* with actions, pending, panel and live all zero
      // while the child's ledger held zero `user_decision` rows and the provider sat on
      // `waiting_permission`. ⚠️ **The two wrong guesses are not the same size.** A live card on a
      // request that has gone costs ONE press — the host answers `not-pending`, `AnswerAck`
      // classifies it, and the case below settles it in the host's own words. A settled card on a
      // request that is still waiting costs the conversation, and no gesture recovers it.
      const { bridge, store, id } = await openQuestion()
      bridge.respondUserInput = () => Promise.reject(new Error('the pipe closed'))

      await store.respondUserInput(id, 'toolu_1', { kind: 'answer', answers: CLICKED })

      expect(cardOf(store, id).refused).toContain('the pipe closed')
      // ⛔ …and it says the card is still waiting rather than reporting a past-tense failure.
      expect(cardOf(store, id).refused).toContain('still waiting')
      expect(cardOf(store, id).note).toBeNull()
      expect(sessionPanel(store.get(id)!.control).waiting).toBe(1)
      // ⚑ The in-flight guard came back off, so the person can press again — which is the whole of
      // what makes the live card recoverable rather than a dead one with a sentence on it (064).
      expect(store.get(id)?.requests.get('toolu_1')?.sent).toBe(false)
      // ⛔ **The half this test was missing** (150, 148 L5). It asserted the note ON THE CARD and
      // stopped, so a regression that cleared the session-level error — the red banner, which is
      // the only thing a user reading the top of the pane would see — stayed green. The behaviour
      // was already correct; the test simply did not describe it, which is the same false green
      // 146 LOW 3 kept finding.
      expect(store.get(id)?.error, 'the session says so too, not just the card').toContain(
        'the pipe closed',
      )
      store.dispose()
    })

    it('a taken answer writes nothing at all — the stream says what happened', async () => {
      // ⚠️ The non-vacuity of all three above: `noteAnswer` returning early on the ordinary path is
      // what keeps a successful answer from acquiring a sentence about a refusal that never was.
      const { store, id } = await openQuestion()

      await store.respondUserInput(id, 'toolu_1', {
        kind: 'answer',
        answers: { q0: ['the real one'] },
      })

      expect(cardOf(store, id).note).toBeNull()
      expect(cardOf(store, id).refused).toBeNull()
      expect(store.get(id)?.requests.get('toolu_1')?.sent).toBe(true)
      store.dispose()
    })
  })

  it('🔴 523 · D-017b · handing one back keeps its record, recorded and looked at again — and a refused one leaves it alone', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const sessionId = await store.claim('sess_1').then(() => 'sess_1')
    expect(store.isLive(sessionId), 'the claim adopted nothing to release').toBe(true)

    const released = await store.release(sessionId)
    // ⛔ **Never drawn as ended.** `421`'s whole subject is that a live conversation must not be,
    // and this one is still running with its provider child and its ledger — what changed is that
    // this window is no longer fed it. ⚑ **D-017b · so the record stays, `recorded`**, and the host
    // is asked to describe it as one this window does not hold: the view a person was reading stays
    // where it is (it was deleted before D-017b).
    expect(store.get(sessionId)?.phase).toBe('recorded')
    expect(store.isLive(sessionId)).toBe(false)
    expect(store.get(sessionId)?.control.ended).toBe(false)
    expect(released.running).toBe('unwatched')
    await vi.waitFor(() => {
      expect(bridge.__calls).toContain(`look:${sessionId}`)
      expect(store.get(sessionId)?.meta).toMatchObject({ handover: 'recorded' })
    })

    // ⚑ **And the pairing, which is the half that matters**: a refused hand-back leaves a
    // conversation this window really does still hold, so letting go of it first would take the
    // pane away from a person who still has it. Same direction as `close`'s *"marking it ended here
    // would hide a live conversation behind an error message."*
    await store.claim(sessionId)
    expect(store.isLive(sessionId), 'the second claim took nothing').toBe(true)
    bridge.release = () => Promise.reject(new Error('You started this conversation'))
    await expect(store.release(sessionId)).rejects.toThrow('You started this conversation')
    expect(store.isLive(sessionId), 'a refused hand-back took the conversation away').toBe(true)
  })

  describe('F062 · a window that takes a running conversation back reads what the host knew', () => {
    const bash = { said: 'an-activity', phase: 'tool', detail: 'Bash' } as const
    const quiet = { said: 'nothing', because: 'no-activity-right-now' } as const

    /** A claim answered the way the host answers one, with what it knew beside the page. */
    function claimedWith(
      bridge: ReturnType<typeof fakeBridge>,
      asHandedOver: ResumedSession['asHandedOver'],
    ) {
      const original = bridge.claim
      bridge.claim = async (input) => ({
        ...(await original(input)),
        ...(asHandedOver === undefined ? {} : { asHandedOver }),
      })
    }

    it('🔴 the status the host held, and the activity it was told, replace a page that begins too late to hold them', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      // The page: one turn's opening words and nothing after — no `status` row, no tool call.
      bridge.__history.set('sess_long', [{ ordinal: 0, at: 1_000, event: hello('a long turn') }])
      claimedWith(bridge, { status: 'working', told: bash })
      await store.claim('sess_long')
      const record = store.get('sess_long')!
      expect(record.control.status).toBe('working')
      expect(record.control.activity).toEqual({ phase: 'tool', detail: 'Bash' })
    })

    it('⛔ the page’s own activity stays where the host holds none, and the status is still the host’s', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      bridge.__history.set('sess_long', [
        { ordinal: 0, at: 1_000, event: hello('a long turn') },
        { ordinal: 1, at: 2_000, event: { type: 'activity', phase: 'thinking' } },
      ])
      claimedWith(bridge, { status: 'waiting_permission', told: quiet })
      await store.claim('sess_long')
      const record = store.get('sess_long')!
      expect(record.control.status).toBe('waiting_permission')
      expect(record.control.activity).toEqual({ phase: 'thinking' })
    })

    it('⚑ the host’s activity wins over a sub-agent’s call the page mistook for the conversation’s own', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      bridge.__history.set('sess_long', [
        { ordinal: 0, at: 1_000, event: hello('hand it over') },
        { ordinal: 1, at: 2_000, event: { type: 'activity', phase: 'tool', detail: 'Read' } },
      ])
      claimedWith(bridge, {
        status: 'working',
        told: { said: 'an-activity', phase: 'tool', detail: 'Task' },
      })
      await store.claim('sess_long')
      expect(store.get('sess_long')!.control.activity).toEqual({ phase: 'tool', detail: 'Task' })
    })

    it('🔴 …and the control: nothing handed over leaves the fold exactly as the page makes it', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      bridge.__history.set('sess_long', [{ ordinal: 0, at: 1_000, event: hello('a long turn') }])
      claimedWith(bridge, undefined)
      await store.claim('sess_long')
      const record = store.get('sess_long')!
      expect(record.control.status).toBe('idle')
      expect(record.control.activity).toBeNull()
    })

    it('⛔ the same hand-over is taken on a reload (attachOpen) and ignored on a resume, whose page ends where the new life begins', async () => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      bridge.__history.set('sess_reload', [{ ordinal: 0, at: 1_000, event: hello('running') }])
      bridge.__held.add('sess_reload')
      const attach = bridge.attachOpen
      bridge.attachOpen = async () =>
        (await attach()).map((one) => ({ ...one, asHandedOver: { status: 'working', told: bash } }))
      await store.attachOpen()
      expect(store.get('sess_reload')!.control.status).toBe('working')

      bridge.__history.set('sess_resumed', [{ ordinal: 0, at: 1_000, event: hello('a recording') }])
      const resume = bridge.resume
      bridge.resume = async (input) => ({
        ...(await resume(input)),
        asHandedOver: { status: 'working', told: bash },
      })
      await store.resume('sess_resumed')
      expect(store.get('sess_resumed')!.control.status).not.toBe('working')
      expect(store.get('sess_resumed')!.control.activity).toBeNull()
    })
  })

  it('leaves no half-session behind when a reopen fails', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.resume = () => Promise.reject(new Error('no resumable session: sess_gone'))

    const opened = await store.resume('sess_gone')

    expect(opened).toBeNull()
    expect(store.get('sess_gone')).toBeNull()
    // A reopen failure sets `resumeError` while `launchError` remains empty. A shared ref
    // would show the same refusal in both the row and launcher banner; the negative assertion
    // prevents that duplicate display.
    expect(store.resumeError.value).toContain('no resumable session')
    expect(store.launchError.value).toBeNull()
    store.dispose()
  })

  /**
   * # A launch you can walk away from (102)
   *
   * 100 left one door open and named it: a slot wedged in `starting` had no in-app release, so the
   * only way out of a launcher that never settled was to quit the app. These are the store's half —
   * that a Cancel finds the launch it means, that the rejection it causes is not reported as a
   * failure, and that nothing half-open is left behind.
   */
  it('stops a new conversation that is still opening, and reports no failure for it', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()

    const launching = store.create({ provider: 'claude' })
    // Non-vacuity: the fake really is holding a launch open, so `create` below is genuinely
    // unsettled rather than having already failed for some other reason.
    expect(bridge.__stalledCount()).toBe(1)
    expect(store.isLaunching()).toBe(true)

    expect(await store.cancelLaunch()).toBe(true)
    expect(await launching).toBeNull()

    expect(store.isLaunching()).toBe(false)
    // ⚠️ **The point of the whole test.** The cancel reaches the provider by ABORTING it, so the
    // command always rejects — and a red sentence under a button that means "stop" would be the app
    // arguing with the user about something they asked for.
    expect(store.launchError.value).toBeNull()
    expect(store.resumeError.value).toBeNull()
    expect(store.live.value).toHaveLength(0)
    store.dispose()
  })

  it('…and an ordinary launch still opens, so the cancel is not just a broken start', async () => {
    // The pair 102 asks for by name: a test that only proved "cancel refuses" would pass just as
    // well against a store that had stopped being able to start anything at all.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)

    const sessionId = await store.create({ provider: 'claude' })

    expect(sessionId).not.toBeNull()
    expect(store.launchError.value).toBeNull()
    expect(store.live.value).toHaveLength(1)
    // …and a cancel with nothing in flight is a no-op rather than an error: the launch finishing
    // between the press and the call is a race no press can avoid.
    expect(await store.cancelLaunch()).toBe(false)
    expect(store.live.value).toHaveLength(1)
    store.dispose()
  })

  it('keeps a long Codex reopen visibly starting until the host answers', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const reopening = store.resume('sess_orchard')
    try {
      expect(bridge.__stalledCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(store.isLaunching('sess_orchard')).toBe(true)
      expect(store.resumeError.value).toBeNull()
      expect(await store.cancelLaunch('sess_orchard')).toBe(true)
      expect(await reopening).toBeNull()
      expect(store.isLaunching('sess_orchard')).toBe(false)
    } finally {
      vi.useRealTimers()
      await store.cancelLaunch('sess_orchard')
      await reopening
      store.dispose()
    }
  })

  it('stops a REOPEN that is still opening, and leaves no half-attached session (102)', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()

    const reopening = store.resume('sess_wedged')
    // An event for the conversation lands mid-launch — the shape 100's review found, where a
    // buffered event creates a record before the host has said anything about it. Cancelling must
    // take that record with it, or the rail is left offering a session nothing is behind.
    bridge.__emit('sess_wedged', 0, hello('are you there'))
    expect(store.get('sess_wedged')).not.toBeNull()

    expect(await store.cancelLaunch('sess_wedged')).toBe(true)
    expect(await reopening).toBeNull()

    expect(store.get('sess_wedged')).toBeNull()
    expect(store.live.value).toHaveLength(0)
    expect(store.resumeError.value).toBeNull()
    store.dispose()
  })

  it('does not report a launch as failed when the cancel found nothing to stop', async () => {
    // ⚠️ **Review finding.** The store marks a key cancelled BEFORE asking, so the rejection the
    // abort causes is not shown as a failure. When the host answers "there was nothing to cancel",
    // that mark has to come off again — otherwise the press swallows the launch's own, real reason
    // for ending, and the launcher just stops spinning with nothing said.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()

    const launching = store.create({ provider: 'claude' })
    const key = 'launch-1' // the first name this store hands out
    // The launch ends on its own — the host's 15s deadline, a bad cwd, anything — a moment before
    // the press lands. The fake answers the cancel with `false`, exactly as the host does.
    const stalled = bridge.__reject(key, new Error("This conversation's agent did not answer."))
    expect(stalled, 'positive: the launch this test is about really was in flight').toBe(true)

    expect(await store.cancelLaunch()).toBe(false)
    expect(await launching).toBeNull()

    expect(store.launchError.value).toContain('did not answer')
    store.dispose()
  })

  it('cancels the launch it was pointed at, and not the other one in flight', async () => {
    // Two launches at once is ordinary: the rail is on screen while the launcher is, and a reopen
    // does not disable the other rows. A cancel keyed by "whatever this window is doing" would
    // stop both, which is why the key is per gesture.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__stall()

    const creating = store.create({ provider: 'claude' })
    const reopening = store.resume('sess_other')
    expect(bridge.__stalledCount()).toBe(2)

    expect(await store.cancelLaunch('sess_other')).toBe(true)
    expect(await reopening).toBeNull()

    // The create is untouched: still in flight, still holding its own name.
    expect(bridge.__stalledCount()).toBe(1)
    expect(store.isLaunching()).toBe(true)
    // ⚠️ **And the answer is per GESTURE** (review). One shared flag would say "yes" here for the
    // reopen that has just been cancelled — which is how the launcher came to render a Cancel that
    // looked up a launch it did not have and did nothing at all.
    expect(store.isLaunching('sess_other')).toBe(false)
    expect(await store.cancelLaunch()).toBe(true)
    expect(await creating).toBeNull()
    store.dispose()
  })

  it('applies liveness that arrives before the session is adopted', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.__liveness('sess_1', 'silent')

    await store.create({ provider: 'claude' })

    expect(store.get('sess_1')?.meta?.liveness.state).toBe('silent')
    store.dispose()
  })

  it.each(['live', 'silent', 'ended', 'errored'] as const)(
    'a later early %s packet without detail clears the earlier detail at adoption',
    async (state) => {
      const bridge = fakeBridge()
      const store = createSessionStore(bridge)
      const agent = [{ label: 'model', value: 'a reported model' }]
      bridge.__liveness('sess_1', 'silent', {
        since: 10,
        detail: 'the earlier silence',
        thinking: true,
        agent,
      })
      bridge.__liveness('sess_1', state, { since: 20 })
      const latest = { state, since: 20, agent }
      expect(store.get('sess_1')?.meta).toBeNull()
      expect(store.get('sess_1')?.earlyLiveness).toEqual(latest)
      await store.create({ provider: 'claude' })
      expect(store.get('sess_1')?.meta?.liveness).toEqual(latest)
      expect(store.get('sess_1')?.earlyLiveness).toBeNull()
      store.dispose()
    },
  )

  it('a later early packet keeps its own detail and the earlier agent disclosure', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const agent = [{ label: 'model', value: 'a reported model' }]
    bridge.__liveness('sess_1', 'silent', { detail: 'old detail', agent })
    bridge.__liveness('sess_1', 'errored', { since: 20, detail: 'the current failure' })
    await store.create({ provider: 'claude' })
    expect(store.get('sess_1')?.meta?.liveness).toEqual({
      state: 'errored',
      since: 20,
      detail: 'the current failure',
      agent,
    })
    store.dispose()
  })

  it('routes liveness to the right conversation once both are open', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const first = (await store.create({ provider: 'claude' })) ?? ''
    const second = (await store.create({ provider: 'codex' })) ?? ''

    bridge.__liveness(second, 'errored')

    expect(store.get(first)?.meta?.liveness.state).toBe('live')
    expect(store.get(second)?.meta?.liveness.state).toBe('errored')
    store.dispose()
  })

  it('lets go of the bridge when the window does', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    await store.create({ provider: 'claude' })

    store.dispose()

    expect(bridge.__listening()).toBe(false)
  })

  it('shows what the HOST says after a mode switch, not what was asked for (034)', async () => {
    // The gap between the two is the whole point: neither provider can change the mode of a turn
    // already running, so between the click and the next message the session is genuinely still
    // prompting. A store that wrote the requested mode straight into the record would put the one
    // dangerous claim on screen for exactly as long as a turn lasts.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const id = await store.create({ provider: 'codex' })

    await store.setApprovalMode(id!, 'auto')

    expect(bridge.__calls).toContain(`setApprovalMode:${id}:auto`)
    expect(store.get(id!)?.meta?.approvalMode).toBe('ask')
    expect(store.get(id!)?.meta?.pendingApprovalMode).toBe('auto')
    expect(store.get(id!)?.meta?.approvalNote).toMatch(/from your next message/)
    store.dispose()
  })

  it('recomputes the open list as sessions come and go', async () => {
    // The list is a computed over a reactive Map; if Map mutations were not tracked, the sidebar
    // would simply never update — a failure that looks like nothing happening at all.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const seen = computed(() => store.live.value.length)

    expect(seen.value).toBe(0)
    await store.create({ provider: 'claude' })
    expect(seen.value).toBe(1)
    await store.create({ provider: 'codex' })
    expect(seen.value).toBe(2)
    store.dispose()
  })
})

/**
 * ⛔ **The killer for the clone `361` added to {@link throughTheWire}** — without it that clone is a
 * line no mutation can make red, because every store test in this file builds its payloads out of
 * literals and a literal survives any wire.
 *
 * ⚑ **Both halves, one fact apart.** The same three fields, reached the way `218` reached them (out
 * of a `reactive` map) and then copied, so what is being measured is the PAYLOAD rather than the
 * wrapper's willingness to refuse things.
 */
describe('the double refuses what the wire refuses (361 §2)', () => {
  const asBook = (): Map<string, { path: string; kind: 'file'; outsideCwd: boolean }> =>
    reactive(new Map([['/a', { path: '/a', kind: 'file' as const, outsideCwd: false }]]))

  /**
   * ⛔ **At the BRIDGE and not through `store.send`, and that is not a shortcut.** `218`'s fix lives
   * in `store.send`, which calls {@link overTheWire} on the way past — so a payload driven through
   * the store is plain by the time the double sees it, and this assertion could never go red there.
   * The proxy has to be put where `ipcRenderer.invoke` would meet it.
   */
  it('🔴 a send whose attachments are still proxies is rejected, not recorded', async () => {
    const bridge = fakeBridge()

    await expect(
      bridge.send({ sessionId: 's1', text: 'read this', attachments: [...asBook().values()] }),
    ).rejects.toThrow(/would not survive ipcRenderer\.invoke/)
    expect(bridge.__inputs).toEqual([])
  })

  it('⚑ …and the same send with `overTheWire`’s copy is delivered', async () => {
    const bridge = fakeBridge()

    await bridge.send({
      sessionId: 's1',
      text: 'read this',
      attachments: overTheWire([...asBook().values()]),
    })
    expect(bridge.__inputs).toEqual([
      {
        sessionId: 's1',
        text: 'read this',
        attachments: [{ path: '/a', kind: 'file', outsideCwd: false }],
      },
    ])
  })
})

/**
 * 🔴 **737 · `730` F-7 — `busy` is lowered by the LAST command to settle, never by the first** — ⚠️
 * or, since `739` (`737` F-6), by the bound of one that has had no answer
 * (`A_COMMAND_IS_WAITED_ON_MS`, 15 s): each command counts until it answers or its bound passes. The
 * Stops below all settle inside their bounds; past it is `a-command-that-has-no-answer.test.ts`.
 *
 * ⛔ **It was a boolean**, flipped on and off by every command that goes through the store's
 * `forSession`. Two commands for one conversation can be out at once — a second Stop pressed while
 * the first still waits, which the host joins to the standing ask and answers under its own bound
 * (`RuntimeHost.interrupt`, R83) — and whichever settled first lowered `busy` under the other. ⚑ What
 * a person saw: Leave planning (`plan-leave-button`) and the sign-in remedy lit again while a
 * command for the conversation was still out.
 */
describe('🔴 737 · `730` F-7 — `busy` counts the commands that are out, each until it answers or its bound (`A_COMMAND_IS_WAITED_ON_MS`) passes', () => {
  /** A bridge whose Stops wait until the test answers them, in any order. */
  function stopsThatWait() {
    const bridge = fakeBridge()
    const answers: { resolve: () => void; reject: (cause: Error) => void }[] = []
    bridge.interrupt = () =>
      new Promise<void>((resolve, reject) => void answers.push({ resolve, reject }))
    return { bridge, answers }
  }

  it('⚑ the control: one Stop raises it while it is out and lowers it when it settles', async () => {
    const { bridge, answers } = stopsThatWait()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'codex' })) ?? ''
    const record = store.get(id)
    expect(record?.busy, 'nothing is out yet').toBe(false)

    const stop = store.interrupt(id)
    expect(record?.busy, 'the Stop is out').toBe(true)
    answers[0]?.resolve()
    await stop
    expect(record?.busy, 'nothing is out any more').toBe(false)
    store.dispose()
  })

  it('🔴 two Stops out at once: the FIRST to settle leaves it up while the second still waits', async () => {
    const { bridge, answers } = stopsThatWait()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'codex' })) ?? ''
    const record = store.get(id)

    const first = store.interrupt(id)
    const second = store.interrupt(id)
    expect(answers, 'both presses reached the host').toHaveLength(2)

    answers[0]?.resolve()
    await first
    expect(record?.busy, 'the second Stop is still out, so the conversation is still busy').toBe(
      true,
    )

    answers[1]?.resolve()
    await second
    expect(record?.busy, 'the last one settled').toBe(false)
    store.dispose()
  })

  it('🔴 …and in the other order, and a command that FAILS counts down as one that answers', async () => {
    const { bridge, answers } = stopsThatWait()
    const store = createSessionStore(bridge)
    const id = (await store.create({ provider: 'codex' })) ?? ''
    const record = store.get(id)

    const first = store.interrupt(id)
    const second = store.interrupt(id)
    answers[1]?.reject(new Error("Error invoking remote method 'x': Error: nope"))
    await second
    expect(record?.error, 'the failure is said beside the conversation').toBe('nope')
    expect(record?.busy, 'the first Stop is still out').toBe(true)

    answers[0]?.resolve()
    await first
    expect(record?.busy).toBe(false)
    store.dispose()
  })
})

/**
 * 🔴 **737 · `735` §3 — the store's door for a first message and its start, in ONE act.**
 *
 * ⚑ `store.startAndSend` asks the host's `startAndSend` under the conversation's own launch name, so
 * the pane's Cancel reaches it, and adopts what the host hands over exactly as a reopen does:
 *  - `sent` → adopted; the words are NOT sent again;
 *  - `notSent` with `running` (`735` F-1: the start was kept) → adopted, and the host's sentence is
 *    said beside that conversation (`record.error`);
 *  - `notSent` with nothing running (a Cancel is one: the host ANSWERS it), or a rejection → no
 *    record is left for the list.
 *
 * ⚠️ **A new door**: on `main` the store has no `startAndSend`, so these fail there by a TypeError —
 * they pin the door, and draw 1's RED on `main` is measured through the real host in
 * `a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts` §1.
 */
describe('🔴 737 · `store.startAndSend` — the first message and its start, in one act', () => {
  const refused = (over: Partial<FirstMessageNotSent['notSent']> = {}): FirstMessageAnswer => ({
    notSent: {
      refusedBy: 'after-the-start',
      said: 'A command with a file attached is not sent.',
      launch: null,
      running: null,
      ...over,
    },
  })

  it('⚑ sent: ONE command, adopted here, and nothing sent a second time', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const came = await store.startAndSend('sess_kept', 'where were we', [])
    expect(came).toEqual({ sent: true, openHere: true })
    expect(store.isLive('sess_kept')).toBe(true)
    expect(bridge.__calls.filter((call) => /^(startAndSend|resume|send):/.test(call))).toEqual([
      'startAndSend:sess_kept',
    ])
    store.dispose()
  })

  it('🔴 `735` F-5 — the attachments cross as a PLAIN copy, never the composer’s reactive array', async () => {
    // ⛔ The fake clones as the wire does (`throughTheWire`), so a `Proxy` handed over throws here.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const staged = reactive([
      { path: '/work/sess_kept/notes.md', kind: 'file' as const, outsideCwd: false },
    ])
    await expect(store.startAndSend('sess_kept', 'look', staged)).resolves.toEqual({
      sent: true,
      openHere: true,
    })
    expect(bridge.__inputs.at(-1)?.attachments).toEqual([
      { path: '/work/sess_kept/notes.md', kind: 'file', outsideCwd: false },
    ])
    store.dispose()
  })

  it('🔴 `735` F-1 — a start KEPT and handed over running is adopted, and the host’s sentence is said beside it', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    const running: ResumedSession = {
      ...(await bridge.resume({ sessionId: 'sess_kept' })),
      handover: 'resumed',
    }
    const said =
      'Another message reached it first. It had been started for this message, and it is running now.'
    bridge.startAndSend = async () => refused({ said, running })
    const came = await store.startAndSend('sess_kept', 'hi', [])
    expect(came).toMatchObject({ sent: false, openHere: true })
    expect(store.isLive('sess_kept')).toBe(true)
    expect(store.get('sess_kept')?.error).toBe(said)
    store.dispose()
  })

  it('⚑ …and one fact over: refused with nothing running — no record is left for the list, nothing said on one', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.startAndSend = async () => refused()
    const came = await store.startAndSend('sess_kept', '/usage', [])
    expect(came).toMatchObject({ sent: false, openHere: false })
    expect(store.get('sess_kept')).toBeNull()
    store.dispose()
  })

  it('⚑ a REJECTION (the wire’s own refusal) is no answer: `null`, its sentence on `resumeError`, no record', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    bridge.startAndSend = () =>
      Promise.reject(new Error("Error invoking remote method 'x': Error: the app is quitting"))
    await expect(store.startAndSend('sess_kept', 'hi', [])).resolves.toBeNull()
    expect(store.resumeError.value).toBe('the app is quitting')
    expect(store.get('sess_kept')).toBeNull()
    store.dispose()
  })

  it('🔴 737 review · an ask about ANOTHER session mid-start does not adopt this one early — an undone start leaves no record', async () => {
    // ⛔ `askAboutUnknown`'s own guard is keyed on the event's session: an event for some OTHER
    // unknown conversation asked the host for every open one, the host named this one (registered to
    // this window mid-start), and it was adopted before the answer — so an undone start left a
    // record behind for a conversation still open with nothing running.
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    let answer!: (came: FirstMessageAnswer) => void
    bridge.startAndSend = () => new Promise<FirstMessageAnswer>((resolve) => (answer = resolve))
    const pending = store.startAndSend('sess_kept', '/usage', [])
    bridge.__held.add('sess_kept')
    bridge.__emit('sess_other', 0, hello('a conversation this window has never heard of'))
    for (let tick = 0; tick < 100 && !bridge.__calls.includes('attachOpen'); tick++) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    expect(bridge.__calls, 'the premise: the other session made the store ask the host').toContain(
      'attachOpen',
    )
    // ⚑ Let the host's answer land and every adoption it would make run.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(store.isLive('sess_kept'), 'adopted by an ask about another session').toBe(false)
    bridge.__held.delete('sess_kept')
    answer(refused())
    await expect(pending).resolves.toMatchObject({ sent: false, openHere: false })
    expect(store.get('sess_kept')).toBeNull()
    store.dispose()
  })

  it('🔴 the pane’s Cancel REACHES the start — it is named under the conversation’s own id', async () => {
    const bridge = fakeBridge()
    const store = createSessionStore(bridge)
    let answer!: (came: FirstMessageAnswer) => void
    bridge.startAndSend = (input) => {
      bridge.__inputs.push(input)
      return new Promise<FirstMessageAnswer>((resolve) => (answer = resolve))
    }
    const pending = store.startAndSend('sess_kept', 'hi', [])
    expect(store.isLaunching('sess_kept'), 'the start is named under its own id').toBe(true)
    const key = (bridge.__inputs.at(-1) as { launchKey?: string }).launchKey
    expect(key, 'a launch key crossed with it').toBeTypeOf('string')
    await store.cancelLaunch('sess_kept')
    expect(bridge.__calls).toContain(`cancelLaunch:${key}`)
    // ⚑ The host answers a cancelled start (`the-start`, `cancelled`) — an answer, not a rejection.
    answer(refused({ refusedBy: 'the-start', said: 'Cancelled.', launch: 'cancelled' }))
    await expect(pending).resolves.toMatchObject({ sent: false, openHere: false })
    store.dispose()
  })
})
