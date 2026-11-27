import { emptyForestBridge } from './forest-fixture'
import { PROVIDER_DESCRIPTORS } from '@brobot2/shared'
import { launchFacts, resolveProviderLaunch } from './provider-launch-fixture'
import type { PersistedEventInfo, TranscriptEvent } from '../../src/shared/conversation-events'
import { allProviderCapabilities } from '@brobot2/runtime'
import { runtimeCommandSchema } from '../../src/main/runtime/ipc'
import { asTheWireWouldCarry } from './the-wire'
import { RETITLE_SAID } from '../../src/shared/piece-called'
import type {
  CreatedSession,
  ResumedSession,
  FirstMessageAnswer,
  RuntimeBridge,
  RuntimeEventMessage,
  SessionLivenessMessage,
  SessionLiveness,
} from '../../src/shared/runtime-ipc'

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
    listRecentConversations: async () => [],
    providerCatalogue: async () => PROVIDER_DESCRIPTORS,
    providerLaunchChoices: async (input) => launchFacts(await impl.modelList(input)),
    resolveProviderLaunch: async (input) => resolveProviderLaunch(input, null),
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
    // This run's publisher and the stamped queue: the window does not read them yet.
    currentEpoch: async () => ({ run: 'fictional-run', n: 0 }),
    personsQueue: async () => {
      throw new Error('the stamped queue is not read by this store yet')
    },
    listConversations: async () => {
      throw new Error('the stamped listing is not read by this store yet')
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
    ...emptyForestBridge(calls),
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
        path: '/fictional/kept/file',
        text: `bytes for ${resourceId}`,
        bytes: 9,
      }
    },
    close: async ({ sessionId }) => void calls.push(`close:${sessionId}`),
    compact: async () => {},
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
    providerConnections: async () => [],
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
      // 500 · the fail-closed pair, each closing towards the state somebody is still consulted in:
      // no spawning, and a launch that asks.
      defaultApprovalMode: 'ask' as const,
      // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
      externalMcpServers: [],
    }),
    setExternalMcpServers: async () => null,
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
    agentMethods: async () => null,
    agentMethodBody: async () => null,
    agentMethodChanges: async () => ({ ok: true, changes: [] }),
    removeAgentMethod: async () => ({ ok: false, reason: 'source-unavailable' }),
    undoAgentMethod: async () => ({ ok: false, reason: 'source-unavailable' }),
    checkInterruptedAgentMethods: async () => ({ ok: false, reason: 'source-unavailable' }),
    agentOwnNotes: async () => null,
    agentOwnNotesUnread: async () => ({ newestAgentVersion: 0, seenThrough: 0, unread: false }),
    saveOwnNotes: async () => null,
    undoOwnNotes: async () => null,
    markOwnNotesSeen: async () => false,
    agentRulesUnread: async () => ({ newestDirectVersion: 0, seenThrough: 0, unread: false }),
    undoAgentRules: async () => null,
    markAgentRulesSeen: async () => false,
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
    undoAgentMemory: async () => null,
    checkInterruptedMemory: async () => null,
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
    // 500 · answers the fail-safe word, like the switch above answers the fail-closed one.
    setDefaultApprovalMode: async () => ({ defaultApprovalMode: 'ask' as const }),
    readConversationIdentity: async () => null,
    readConversationIdentities: async () => [],
    readConversationTasks: async () => ({ ok: false, reason: 'unknown-conversation' }),
    readAllConversationTasks: async () => ({ ok: false, reason: 'unknown-conversation' }),
    readConversationTitleHistory: async () => null,
    // D-016 · R4 · This double has no conversation or piece to rename.
    renameConversation: async () => ({
      ok: false as const,
      code: 'unknown-conversation' as const,
      reason: 'No matching conversation.',
    }),
    setCurrentRules: async () => ({ ok: false as const, reason: 'Conversation not found.' }),
    retitleWork: async () => ({
      ok: false as const,
      rail: 'no-piece-by-that-name' as const,
      reason: RETITLE_SAID['no-piece-by-that-name'],
    }),
    takeBackWork: async () => ({
      ok: false as const,
      rail: 'not-a-piece-a-service-is-on' as const,
    }),
    closeWork: async () => ({ ok: false as const, rail: 'not-a-stopped-piece' as const }),
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
    reprovisionProviderHomes: async () => ({
      replaced: 0,
      pending: 0,
      skipped: 0,
      failed: 0,
      profiles: [],
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
    filesLibrary: async () => ({ type: 'released' }),
    teamProfileGraph: async () => ({ type: 'released' }),
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

export { ended, fakeBridge, hello, reply }
