import { executeForestCommand } from './forest-command'
import { MOVE_WORDS } from '../../shared/move-request'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import {
  RUNTIME_COMMAND_CHANNEL,
  RUNTIME_EVENT_CHANNEL,
  RUNTIME_LIVENESS_CHANNEL,
  type RuntimeCommandKind,
  type RuntimeCommandResult,
} from '../../shared/runtime-ipc'
import { AGENT_MEMORY_NOTES_SHOWN } from './instructions'
import type { RuntimeEventSink, RuntimeHost } from './runtime-host'
import type { MainThreadWork } from '../stall-watch'
import { DEFAULT_PROFILE_ID } from '../connections/homes'
import { whyALaunchWasRefused } from './launch-refusal'
import { sinkOwnerId } from './window-caller'
import { isAPageReport, type PageReceipt } from './page-performance'
import { describeIssues } from './ipc-input'
import { runtimeCommandSchema } from './ipc-schemas'
import { DURING_A_QUIT, refusedDuringAQuit, requireAPerson } from './ipc-doors'

export { runtimeCommandSchema } from './ipc-schemas'
export { noPersonBehindIt, refusedDuringAQuit } from './ipc-doors'

/**
 * One renderer→main `invoke` channel validates the command union with the runtime's own schemas.
 * Page freeze reports use `page-performance.ts` instead and never reach the host.
 * Electron imports stay type-only so plain Node tests can load this module.
 */

/**
 * What one command's case may answer: the reply `RuntimeCommandResults` names for it, or a promise
 * of it. Each case's answer is checked against its own row with `satisfies`, so main and the
 * preload cannot drift apart on a reply's shape; the check is erased, and the reply is unchanged.
 */
type Answer<K extends RuntimeCommandKind> =
  RuntimeCommandResult<K> | Promise<RuntimeCommandResult<K>>

/**
 * Validate one command and run it against the host. Every rejection carries a readable message,
 * which `ipcMain.handle` propagates to the renderer's awaiting promise — ⚠️ **as `toString()`, so as
 * `${name}: ${message}`**, which is why {@link registerRuntimeIpc} re-throws a named class as a
 * plain `Error` (675). Rejections that are already plain pass through as they were.
 *
 * ## Where the `user_command` breadcrumbs are written, and why it differs by command (097)
 *
 * This is the layer that records WHICH control the user pressed, because it is the only layer that
 * knows a person pressed one — the window closing underneath a session and the app quitting call
 * the same host methods and correctly leave no trail. See {@link UserCommandEvent}.
 *
 * ⚠️ **Two placements, one rule, and the first version of this got it wrong twice** (review):
 *
 *  - **Before the call** for gestures that act on the conversation AS IT IS — `close`, `interrupt`,
 *    `sendInterrupting`, `endPlanMode`. Each of them either destroys the thing being written to,
 *    terminalizes the turn the breadcrumb has to attach to, or composes two operations of which the
 *    first can land and the second throw. Recorded afterwards, every one of them loses exactly the
 *    fact it exists to record.
 *  - **After the call** for `setApprovalMode` and `setSessionSetting`, whose breadcrumb carries an
 *    OBJECT — the setting's new value. That value is only true once the provider has accepted it,
 *    and `changed_model → X` written before a provider refused X would be a fact about a session
 *    that never existed.
 *
 * The cost of "before" is stated rather than hidden: a command refused after the note leaves a
 * breadcrumb for a gesture that did not take effect. That is bounded — each of these four either
 * cannot be refused, refuses only for a session `noteUserCommand` also skips, or refuses with an
 * error the user is shown — and it is the cheaper mistake than the one 085 actually reported.
 *
 * ⛔ **203 broke the middle clause of that sentence and repaired it in `noteUserCommand` rather
 * than here.** `close` can now be refused for a session that function would happily write to — a
 * foreign window forging `closed` into somebody else's ledger — so the skip it already performs for
 * an unknown session performs for an unowned one too. The placement rule above is unchanged.
 *
 * ## Who is asking (203, from 195 H1)
 *
 * ⛔ **Every session-scoped CONTROL verb below passes `sink`, and that is not a convenience.** The
 * sink is the only trustworthy statement of who is asking — it is the channel the ask arrived on,
 * not a value the caller typed — and {@link RuntimeHost.require} now demands one. Before this,
 * `create`, `resume`, `cancelLaunch` and `attachOpen` took it and the other thirteen did not: a
 * window that `attachOpen` returned nothing for and `resume` refused could still approve another
 * window's tool, inject a message, change its approval mode, interrupt it or close it, with an id
 * `listLibrary` hands out by design.
 *
 * ⚠️ **The READ verbs deliberately do not pass it, and that is 064's line rather than an omission.**
 * `earlierHistory`, `latestHistory`, `exportSession` and the two
 * `read*Work` commands answer about a conversation without driving it — the session library is
 * built on exactly that, and scoping reads to the owning window would break reading a running
 * conversation from the library, which is a feature. `latestHistory` does hand over a pending
 * request id and the decisions it offers; what 203 removes is the ability to USE one.
 */
export async function executeRuntimeCommand(
  host: RuntimeHost,
  sink: RuntimeEventSink,
  raw: unknown,
): Promise<unknown> {
  const parsed = runtimeCommandSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(`invalid runtime command: ${describeIssues(parsed.error)}`)
  }
  const command = parsed.data
  // 🔴 **The shutdown door** (273 §1) — see {@link DURING_A_QUIT} for what it refuses and why the
  // exemptions are exemptions.
  //
  // ⚠️ **After the parse and before the switch**, and both halves of that are deliberate. After,
  // because the ruling is per command and there is no kind to rule on until the wire has been
  // checked — an unparseable payload is still an unparseable payload during a quit, and saying so is
  // more use than "we are shutting down". Before, because the whole point is that nothing reaches a
  // host method: a refusal written inside one would be the try/catch 273 §1 forbids, hiding the call
  // rather than stopping it.
  if (host.closing && DURING_A_QUIT[command.kind] === 'refused') {
    // The stamped queue says its refusal at its stamp, so a window can order it; nothing is read.
    if (command.kind === 'personsQueue')
      return host.personsQueueRefused(refusedDuringAQuit(command.kind))
    if (command.kind === 'listConversations')
      return host.listingRefused(refusedDuringAQuit(command.kind))
    throw new Error(refusedDuringAQuit(command.kind))
  }
  switch (command.kind) {
    case 'createSession':
      try {
        const created = await host.createSession(
          {
            provider: command.provider,
            cwd: command.cwd,
            approvalMode: command.approvalMode,
            profileId: command.profileId,
            reasoningEffort: command.reasoningEffort,
            model: command.model,
            planMode: command.planMode,
            // The max-effort orchestration mode (106) — and the line above is why this one has a test
            // of its own. Every other launch setting lands in a session row that a later assertion
            // can read; this one is deliberately recorded nowhere, so a drop here would be invisible
            // everywhere downstream. `runtime-ipc.test.ts` asserts it where it lands, and did in fact
            // catch this exact omission on the first run.
            ultracode: command.ultracode,
            // ⚠️ **Every field is listed by hand here, and 102's review found what that costs.** The
            // schema accepted `launchKey`, the renderer sent one, and this rebuild dropped it — so
            // every slot was reserved with `launchKey: null` and the launcher's Cancel could never
            // find the launch it was pressed on. A dead button, with a passing test suite on both
            // sides of it, because nothing crossed this line. `launch-deadline.test.ts` does now.
            launchKey: command.launchKey,
          },
          sink,
        )
        // 🔴 **D-042 · R2 — a model a PERSON named for a new conversation is their last pick** on that
        // provider — written here, the one door that knows a window asked, from what the launch
        // named, ⛔ when the list holds it ({@link RuntimeHost.aPersonPicked}). ⚑ Not awaited: the
        // conversation is made either way, and its answer waits on no list.
        if (
          command.model !== undefined &&
          sink.aPersonIsBehindIt &&
          created.settings.model !== null
        ) {
          void host.aPersonPicked(created.provider, created.profileId, {
            model: created.settings.model,
            effort: created.settings.reasoningEffort,
          })
        }
        return created satisfies Answer<'createSession'>
      } catch (error) {
        // 🔴 **716 · `710` F-7 — a refusal the caller asked to have ANSWERED**, with its word
        // ({@link whyALaunchWasRefused}). ⚑ `said` is the message a rejection would have carried;
        // ⛔ a failure with no word is still thrown, and so is every refusal nobody asked about.
        const reason = command.answerARefusal === true ? whyALaunchWasRefused(error) : null
        if (reason === null) throw error
        // ⚑ **…and logged, whole** (review of `716`): Electron prints every REJECTED handler with its
        // stack and cause, and nothing prints an answer — so without this line a missing program's
        // own words (its `cause`) would be recorded nowhere.
        console.warn(`runtime command createSession was refused (${reason}) and answered:`, error)
        return {
          refused: { reason, said: error instanceof Error ? error.message : String(error) },
        } satisfies Answer<'createSession'>
      }
    case 'send':
      return (await host.send(
        command.sessionId,
        command.text,
        sink,
        command.attachments,
      )) satisfies Answer<'send'>
    case 'sendInterrupting':
      // ⚠️ **085's breadcrumb moved INTO `sendInterrupting` in 150** (148 L2). Written here it ran
      // before the sign-in gate, so a refused turn left the ledger saying the user had interrupted
      // one — a gesture that did not happen (039). It is now written on the far side of that gate
      // and still ahead of the interrupt, which keeps the reason it was early in the first place:
      // an interruption that lands and a send that then throws must not vanish.
      //
      // ⚠️ The text is deliberately still not part of it — the `user_turn` holds it, and the
      // breadcrumb is a verb rather than a second copy of the message.
      return (await host.sendInterrupting(
        command.sessionId,
        command.text,
        sink,
        command.attachments,
      )) satisfies Answer<'sendInterrupting'>
    case 'queueMessage':
      return (await host.queueMessage(
        command.sessionId,
        command.text,
        sink,
        command.attachments,
      )) satisfies Answer<'queueMessage'>
    case 'cancelQueuedMessage':
      return (await host.cancelQueuedMessage(
        command.sessionId,
        command.messageId,
        sink,
      )) satisfies Answer<'cancelQueuedMessage'>
    case 'takeBackAndStop':
      return (await host.takeBackAndStop(
        command.sessionId,
        command.messageId,
        sink,
      )) satisfies Answer<'takeBackAndStop'>
    case 'respondPermission':
      return (await host.respondPermission(
        command.sessionId,
        command.requestId,
        command.decision,
        sink,
      )) satisfies Answer<'respondPermission'>
    case 'resolveLink':
      // A link reads only its target's indexed facts, without a whole-window snapshot.
      return host.resolveLink(command.target) satisfies Answer<'resolveLink'>
    case 'decideMoveRequest':
      if (!sink.aPersonIsBehindIt) throw new Error(MOVE_WORDS.personOnly)
      return (await host.decideMoveRequest(command, sink)) satisfies Answer<'decideMoveRequest'>
    case 'respondUserInput':
      return (await host.respondUserInput(
        command.sessionId,
        command.requestId,
        command.response,
        sink,
      )) satisfies Answer<'respondUserInput'>
    case 'answerAction':
      return (await host.answerAction(
        command.sessionId,
        command.request,
        command.done,
        command.note ?? null,
        sink,
      )) satisfies Answer<'answerAction'>
    case 'interrupt':
      // ⚠️ **BEFORE, and this one was written the other way round and was WRONG** (097 review,
      // finding 1). `handle.interrupt()` terminalizes the running turn from inside its own promise:
      // the `turn` event is pushed to the queue, the pump delivers it, and `appendTx` closes the
      // turn row — all on microtasks that land BEFORE the `await` here resumes. `sendInterrupting`
      // already documents that ordering as a fact found in review. So a breadcrumb written after
      // the await arrives to find no open turn, and `turnFor` stamps it `null` — the ONE gesture
      // whose whole value is being attached to the turn it stopped, detached from it.
      //
      // Refusal costs nothing: `host.interrupt`'s entry rails reject via `require()` for a session
      // that is unknown or still starting, and `noteUserCommand` is a silent no-op in exactly those
      // cases. ⚠️ Since `720` (`709` F-6) it can also reject AFTER the breadcrumb: a provider that
      // refuses the interrupt inside the bounded wait — and that is a Stop the person did press.
      host.noteUserCommand(command.sessionId, 'interrupted', sink)
      return (await host.interrupt(command.sessionId, sink)) satisfies Answer<'interrupt'>
    case 'stopBackgroundWork':
      // ⚠️ **No breadcrumb, and that is a decision rather than an omission** (097). `UserCommandEvent`
      // has a CLOSED set of commands, every one of which changes the CONVERSATION's own state — the
      // turn that stopped, the session that closed, the mode that changed — so the transcript can
      // say "you did this" beside the effect. This changes one detached command and leaves the
      // conversation exactly as it was, and its effect already arrives as its own event: the
      // `background_work.ended` carrying `stopped`. A breadcrumb here would be a second telling of
      // one fact, which is 246's whole subject.
      return (await host.stopBackgroundWork(
        command.sessionId,
        command.id,
        sink,
      )) satisfies Answer<'stopBackgroundWork'>
    case 'close':
      // BEFORE, per the rule above: a close destroys the thing being written to, and `close()`
      // cannot be refused anyway (it is a tolerant no-op on a session that has already ended).
      // Recorded after, this breadcrumb would exist for no close at all.
      //
      // ⚠️ A second Close on a session already tearing down writes a second row. That is not a
      // duplicate of one gesture: the button really was pressed twice, and a ledger that hid the
      // second press would be answering "which control produced this" less well, not better.
      host.noteUserCommand(command.sessionId, 'closed', sink)
      return (await host.close(command.sessionId, sink)) satisfies Answer<'close'>
    case 'compact':
      return (await host.compactForAPerson(command.sessionId)) satisfies Answer<'compact'>
    case 'refreshConfig':
      return host.refreshConfig(command.sessionId, sink) satisfies Answer<'refreshConfig'>
    case 'setApprovalMode': {
      const result = await host.setApprovalMode(command.sessionId, command.mode, sink)
      host.noteUserCommand(command.sessionId, 'changed_approval_mode', sink, command.mode)
      return result satisfies Answer<'setApprovalMode'>
    }
    case 'setSessionSetting': {
      const result = await host.setSessionSetting(
        command.sessionId,
        command.body.kind === 'model'
          ? { kind: 'model', model: command.body.value }
          : command.body.kind === 'reasoningEffort'
            ? { kind: 'reasoningEffort', effort: command.body.value }
            : { kind: 'planMode', on: command.body.on },
        sink,
      )
      // The value is carried as the breadcrumb's object; ABSENT means the user cleared it back to
      // the provider's own default, which is a different gesture from choosing a model that happens
      // to be the default one, and the ledger can now tell them apart.
      host.noteUserCommand(
        command.sessionId,
        command.body.kind === 'model'
          ? 'changed_model'
          : command.body.kind === 'reasoningEffort'
            ? 'changed_effort'
            : 'entered_plan_mode',
        sink,
        command.body.kind === 'planMode' ? undefined : command.body.value,
      )
      return result satisfies Answer<'setSessionSetting'>
    }
    case 'endPlanMode':
      // 085's own case, and the two endings are kept apart because they are different decisions:
      // leaving planning is *"I am done proposing"*, starting the plan is *"do this"*. The text is
      // not carried — the `user_turn` the second one produced is already the record of it.
      //
      // ⚠️ BEFORE, per the rule above, and this one was written the other way and was wrong (097
      // review, finding 3). `endPlanMode` COMPOSES a mode change and a send: the mode change is
      // committed and published, then the send can throw. Written afterwards, the case where plan
      // mode really ended and the message did not go — the case a reader most needs explaining —
      // is the exact case that left no trace. Its up-front refusals happen before anything moves
      // AND raise an error the user sees, so a breadcrumb beside one is a visible pair, not a
      // silent lie.
      host.noteUserCommand(
        command.sessionId,
        command.text === undefined ? 'left_plan_mode' : 'started_the_plan',
        sink,
      )
      return (await host.endPlanMode(
        command.sessionId,
        sink,
        command.text,
      )) satisfies Answer<'endPlanMode'>
    case 'listResumable':
      return host.readForWindow(
        () => host.resumableSessions(),
        'listing',
      ) satisfies Answer<'listResumable'>
    case 'listUnresumable':
      return host.readForWindow(
        () => host.unresumableSessions(),
        'listing',
      ) satisfies Answer<'listUnresumable'>
    case 'adoptSessions':
      // Awaited like every other async host call here: it became one in 046, when importing moved
      // to the streaming path, and a bare `return` of a promise would be the only case in this
      // switch whose rejection is not this function's to own.
      return (await host.adoptSessions()) satisfies Answer<'adoptSessions'>
    case 'exportSession':
      // ⚑ **633 · the whole command, not two fields** — one kind carries a body and the TYPE is
      // what says which, so the host is handed the payload rather than a pair somebody has to keep
      // in step. ⛔ `readingBody` arrives as `readingBody`; the host reads `body`, so the one
      // translation lives here where the wire's own name is chosen.
      // ⛔ **The pairing is refused HERE, once, because the schema could not say it** — see the
      // `readingBody` note above. ⚠️ A `reading` with no body is a caller that named a kind and
      // sent nothing to write; saying so is better than a host arm reached with `undefined`.
      if (command.exportKind === 'reading') {
        if (command.readingBody === undefined) {
          throw new Error('a readable export needs the composed body')
        }
        return (await host.exportSession({
          sessionId: command.sessionId,
          exportKind: 'reading',
          body: command.readingBody,
        })) satisfies Answer<'exportSession'>
      }
      if (command.readingBody !== undefined) {
        throw new Error(
          `only a readable export carries a body, and this one is ${command.exportKind}`,
        )
      }
      return (await host.exportSession({
        sessionId: command.sessionId,
        exportKind: command.exportKind,
      })) satisfies Answer<'exportSession'>
    case 'importBundleFile':
      return host.importBundleFile(command.path) satisfies Answer<'importBundleFile'>
    case 'resume':
      // ⚑ **D-017 · R1** — joins a start a delivery is already making, then takes or attaches it.
      return (await host.reopenForAPerson(
        command.sessionId,
        sink,
        command.launchKey ?? null,
      )) satisfies Answer<'resume'>
    case 'look':
      // ⚑ **D-017b** — the owner and the sink change in one block when a press takes a conversation,
      // and the page is read in the same block; only a life whose provider has said it is over is
      // waited out first (`RuntimeHost.look`).
      return (await host.look(
        command.sessionId,
        sink,
        command.claim === true,
      )) satisfies Answer<'look'>
    case 'stopLooking':
      // ⚑ Whose look ends comes from the channel, so a window cannot end another window's.
      return host.stopLooking(command.sessionId, sink.ownerId) satisfies Answer<'stopLooking'>
    case 'startAndSend':
      // 🔴 **735 · `701` F-8** — see `RuntimeHost.startAndSend`. ⚑ A refusal it can name is ANSWERED
      // (`FirstMessageAnswer`), with its word, and logged there.
      return (await host.startAndSend(
        command.sessionId,
        command.text,
        sink,
        command.attachments,
        command.launchKey ?? null,
      )) satisfies Answer<'startAndSend'>
    case 'cancelLaunch':
      // ⚠️ The owner comes from the SINK, never from the command (102). A window may only cancel
      // what it started, and the only trustworthy statement of who is asking is the channel the ask
      // arrived on — the same reason `attachOpen` takes no parameters.
      return (await host.cancelLaunch(
        command.launchKey,
        sink.ownerId,
      )) satisfies Answer<'cancelLaunch'>
    case 'attachOpen':
      // Synchronous host-side, and returned without an `await`: there is nothing asynchronous to
      // wait for, and adding one would open a window in which a session could be torn down between
      // being attached and being reported.
      return host.attachOpenSessions(sink) satisfies Answer<'attachOpen'>
    case 'questionsForAPerson':
      // ⛔ **A read, and it takes no sink and no owner** (398). Every other verb in this switch acts
      // on one conversation and is gated by who holds it; this one asks what has been left waiting
      // on a PERSON, which is a question about the app rather than about a session. ⚠️ There is
      // nothing here to entitle: a window that can reach this IPC channel is already a surface a
      // person is sitting at — and it is on no agent's toolset. ⚑ **D-046 · it carries each
      // question's words**, which the person it is waiting on is the one to read; a window may
      // already read any conversation they sit in. ⛔ And never a refused request's: the store's
      // reader leaves out by name every request only a person may settle at its card — a
      // permission, a grant, a consent, a secret, a server's form — so none of their words cross.
      return host.readForWindow(() =>
        host.questionsForAPerson(),
      ) satisfies Answer<'questionsForAPerson'>
    case 'decisionsForAPerson':
      // ⛔ **A read, and it takes no sink and no owner** (403) — `questionsForAPerson`'s note: ids,
      // one named hop, the line and the vocabulary's own sentence for the refusal. A row whose
      // conversation no window holds also carries the request as its card draws it, so the person
      // it waits on can read and answer it there. This read is on no agent's toolset, so a parent
      // still never reads a permission's words.
      return host.readForWindow(() =>
        host.decisionsForAPerson(),
      ) satisfies Answer<'decisionsForAPerson'>
    case 'limitsForAPerson':
      // ⛔ **A read, and it takes no sink and no owner** (533) — `questionsForAPerson`'s note, and
      // this is the NARROWEST payload of them. ⚠️ Nothing of a conversation
      // crosses here at all: every field is the provider's own statement about the provider's own
      // account — which provider, which metered window, when it resets, and the sentence the
      // adapter already wrote (⚑ F096: or, for a window near its limit, this app's own sentence from
      // the provider's own usage figure — `wallsFromUsage`). ⛔ No request text, no prompt, no
      // assignment, and not even the id of the conversation the line was recorded in.
      return host.readLimitsForWindow() satisfies Answer<'limitsForAPerson'>
    case 'readLimitsDisplay':
      return host.readLimitsDisplay() satisfies Answer<'readLimitsDisplay'>
    case 'instructionAsksForAPerson':
      // ⛔ **A read, and it takes no sink and no owner** — `questionsForAPerson`'s note. ⚑ The asks
      // are what `agentInstructions` already hands the window for one identity, for every one.
      return host.instructionAsksForAPerson() satisfies Answer<'instructionAsksForAPerson'>
    case 'mcpServerRequestsForAPerson':
      // A read, and it takes no sink and no owner, as its neighbour above.
      return host.mcpServerRequestsForAPerson() satisfies Answer<'mcpServerRequestsForAPerson'>
    case 'stalledWorkForAPerson':
      // This read sends the window the assignment text, piece number, holder and giver names,
      // what stopped the work and who asked for the stop. It sends no request text, prompt or
      // transcript, and nothing the person could not already read on the Work tab.
      // The store walk uses no worker snapshot, so it waits for no routing read.
      return host.stalledWorkForAPerson() satisfies Answer<'stalledWorkForAPerson'>
    case 'stoppedWorkForAPerson':
      // A read, and it takes no sink and no owner, as its neighbour above. It reads no routing, so
      // it waits for no window snapshot.
      return host.stoppedWorkForAPerson() satisfies Answer<'stoppedWorkForAPerson'>
    case 'currentEpoch':
      // A read of what this run is called, which every stamped answer names; no sink and no owner.
      return host.currentEpoch() satisfies Answer<'currentEpoch'>
    case 'personsQueue':
      // A read, and it takes no sink and no owner, as the eight reads it gathers. It sends what
      // they send, under one stamp.
      return host.personsQueue() satisfies Answer<'personsQueue'>
    case 'listConversations':
      // A read, and it takes no sink and no owner, as the two halves it gathers. It sends what
      // they send, under one stamp.
      return host.listConversations() satisfies Answer<'listConversations'>
    case 'listRecentConversations':
      return host.listRecentConversations() satisfies Answer<'listRecentConversations'>
    case 'workIncidentsForAPerson':
      // A read, and it takes no sink and no owner, as its neighbours. It sends each piece's label,
      // title, holder and giver names and what is wrong with it; no brief and no transcript.
      return host.workIncidentsForWindow() satisfies Answer<'workIncidentsForAPerson'>
    case 'waitingOnWhoWroteForAPerson':
      // This read sends the window the piece's label, title, holder name and the moment its turn
      // ended. It sends no brief, prompt, transcript or the person's own words.
      // The store walk uses no worker snapshot, so it waits for no routing read.
      return host.waitingOnWhoWroteForAPerson() satisfies Answer<'waitingOnWhoWroteForAPerson'>
    case 'recentActivity':
      return host.recentActivity({
        from: command.from,
        to: command.to,
      }) satisfies Answer<'recentActivity'>
    case 'digest':
      // ⛔ **A read, and it takes no sink and no owner** (438) — `questionsForAPerson`'s note, a
      // third time. ⚠️ **No request text, no prompt and no assignment text crosses here**: the
      // payload is composed sentences about counts, an agent's own report of how its work went,
      // and a list of what could not be answered. ⚑ Synchronous, like its neighbours, so there is
      // no `await`: the host folds rows it has already read.
      return host.digest(command.from, command.to) satisfies Answer<'digest'>
    case 'workGivenBy':
      // ⛔ **A read, and it takes no sink and no owner** (508) — `digest`'s note, one verb over.
      // ⚠️ **No `requireAPerson`**: the answer is what THIS window's conversation
      // handed out, and no agent reaches this door — `list_tasks` is the toolset's own way in and
      // it goes through `pieceBoard`. The canonical walk is read in the window worker.
      return host.workGivenBy(command.sessionId) satisfies Answer<'workGivenBy'>
    case 'whoCalledWhom':
      // ⛔ **A read, and it takes no sink and no owner** (543) — `workGivenBy`'s note, one verb
      // over. ⚠️ **No `requireAPerson`**: it discloses this app's own record of which conversation
      // started which and which handed work to which, offers no act at all, and no agent reaches
      // this door — an agent asking about its own children has `list_agents` and `list_tasks`, both
      // through their own rails. ⚑ **Synchronous, and here that is load-bearing rather than an
      // economy**: {@link WhoCalledWhom.readAt} is one completion point over four walks, and an
      // `await` anywhere between them would be a moment a write could land in one list and not the
      // others — see that field, which carries the whole argument.
      return host.whoCalledWhom(command.sessionId) satisfies Answer<'whoCalledWhom'>
    case 'readWorkspace':
      // ⛔ **A read, and it takes no sink and no owner** (567) — `whoCalledWhom`'s note one verb
      // over. ⚠️ **No `requireAPerson`**: it discloses two numbers about this app's own workspace,
      // offers no act at all, and no agent reaches this door. ⚑ **Synchronous, and here that is
      // load-bearing rather than an economy**: `WorkspaceReading.readAt` is one completion point
      // over every read it makes, and an `await` anywhere between them would be a moment a write
      // could land in one count and not the other — see that field, which carries the whole
      // argument. ⚠️ **No number here on purpose** — a count in prose is a claim nothing asserts
      // (`a-number-can-survive-the-death-of-its-derivation`).
      return host.readForWindow(() => {
        return host.readWorkspace()
      }) satisfies Answer<'readWorkspace'>
    case 'whatIsBeingDone':
      // ⛔ **A read, and it takes no sink and no owner** (575) — `readWorkspace`'s note one verb
      // over. ⚠️ **No `requireAPerson`**: it discloses what this app's own live conversations were
      // last told they are doing, offers no act at all, and no agent reaches this door. ⚑
      // **Synchronous, and here that is load-bearing rather than an economy**: `WhatIsBeingDone.readAt`
      // is one completion point over every row, and an `await` anywhere between them would be a
      // moment a session could move between two rows and land in one of them.
      return host.whatIsBeingDone() satisfies Answer<'whatIsBeingDone'>
    case 'whatEachConversationIsWaitingOn':
      // ⛔ **A read, and it takes no sink and no owner** (621) — `whatIsBeingDone`'s note one verb
      // over, and the same three clauses. ⚠️ **No `requireAPerson`**: it names no conversation, so
      // `203`'s owner check has nothing to be about, and it offers no act. ⚑ **Synchronous, and
      // load-bearing for the same reason**: `WhatEachConversationIsWaitingOn.readAt` is one
      // completion point over every row, and `better-sqlite3` runs on this thread — so nothing can
      // be written between two of the three reads a row is built from.
      return host.readForWindow(() => {
        return host.whatEachConversationIsWaitingOn()
      }) satisfies Answer<'whatEachConversationIsWaitingOn'>
    case 'forestReading':
    case 'forestNodes':
      return executeForestCommand(host, command)
    case 'processMemory':
      // Reads process memory without an owner or sink.
      return host.processMemory() satisfies Answer<'processMemory'>
    case 'claim':
      // ⛔ **Synchronous, and here that is a requirement rather than an economy** (336): the owner
      // changes and the sink is swapped in one block with nothing awaited across it, so there is no
      // instant at which this surface owns the conversation and is not yet receiving it. An `await`
      // on this line would not create that gap, but it is the same rule `attachOpen` states and the
      // reason to state it here is that the gap it protects is one event wide.
      return host.claimSession(command.sessionId, sink) satisfies Answer<'claim'>
    case 'release':
      // ⛔ **Synchronous for {@link RuntimeHost.claimSession}'s reason read backwards** (523): the
      // owner is cleared and the sink is put back to nothing in one block, so there is no instant
      // at which this surface has given the conversation up and is still being told about it.
      //
      // ⚑ **`sink`, not a payload field.** The host answers *is this yours* off the channel the ask
      // arrived on — the rule stated at the top of this switch — so a window cannot hand back a
      // conversation by naming somebody else's id.
      return host.releaseSession(command.sessionId, sink) satisfies Answer<'release'>
    case 'listLibrary':
      return (await host.listLibrary({
        query: command.query,
        recordId: command.recordId,
        filters: command.filters,
        limit: command.limit,
        offset: command.offset,
      })) satisfies Answer<'listLibrary'>
    case 'importRecordedSession':
      return (await host.importRecordedSession(
        command.sessionId,
      )) satisfies Answer<'importRecordedSession'>
    case 'importUserHomeSession':
      return (await host.importUserHomeSession(
        command.provider,
        command.providerSessionId,
      )) satisfies Answer<'importUserHomeSession'>
    case 'rebuildLedger':
      return (await host.rebuildLedger(command.sessionId)) satisfies Answer<'rebuildLedger'>
    case 'readWorkflowOutput':
      // No sink, no session: this is a file read scoped to one recorded run (108).
      return host.readWorkflowOutput(
        command.sessionId,
        command.taskId,
      ) satisfies Answer<'readWorkflowOutput'>
    case 'readInstructionSource':
      // 356. No sink and no turn: one file off the list this session's provider reported, read at
      // the moment somebody pressed the row. See `main/instruction-source.ts` for the confinement.
      return host.readInstructionSource(
        command.sessionId,
        command.index,
      ) satisfies Answer<'readInstructionSource'>
    case 'revealPath':
      // 356. The only command in this union whose effect is outside the app. It still takes no path:
      // the host resolves the target against the session it launched, and hands the OS a string the
      // renderer never chose.
      return host.revealPath(command.sessionId, command.target) satisfies Answer<'revealPath'>
    case 'readConfigFile':
      // 733. No sink and no turn: one file off the list this session's provider config declares,
      // read at the moment somebody pressed its row. See `main/config-file.ts`.
      return host.readConfigFile(command.sessionId, command.name) satisfies Answer<'readConfigFile'>
    case 'readCommandOutput':
      // 300. No sink either, and no file: this reads a buffer the live handle has been filling off
      // its own stream. A session that is not live has none, which is the `null` the card renders as
      // "this app is not holding it" rather than as "it printed nothing".
      return host.readCommandOutput(
        command.sessionId,
        command.toolCallId,
      ) satisfies Answer<'readCommandOutput'>
    case 'readToolAnswer':
      // 462. No sink and no file, exactly as above: this reads a bounded hold the live handle filled
      // off its own stream. A replayed conversation has no handle at all, which is the `null` the
      // panel renders as "this app is not holding it" rather than as "the tool said nothing".
      return host.readToolAnswer(
        command.sessionId,
        command.toolCallId,
      ) satisfies Answer<'readToolAnswer'>
    case 'readResource':
      // 🔴 **510 · no sink, no session and no path.** ⛔ The renderer names a resource ID — a row in
      // this app's own table — and the host finds the file from the row, inside `resourcesRoot`.
      // ⚠️ Neither door asks an entitlement: any agent may read any resource (HO-057, carried from
      // the documents resources replaced), and ⚑ **HO-005 is why THIS one never asked**: a window is
      // not an agent, and there was never a grant a person could be missing.
      return host.readResourceForAPerson(command.resourceId) satisfies Answer<'readResource'>
    case 'drawResource':
      // 🔴 **D-032 · `readResource`'s door, for a picture or a PDF**: an id in, the kept bytes and
      // the type to draw them as out. ⚠️ On no toolset, so only a window reaches it.
      return host.drawResourceForAPerson(command.resourceId) satisfies Answer<'drawResource'>
    case 'revealResource':
      // 🔴 **D-032 · `revealPath`'s act, by a resource id**: the host finds the kept file from its
      // row, inside `resourcesRoot`, and hands the OS a path the renderer never saw.
      return host.revealResource(command.resourceId) satisfies Answer<'revealResource'>
    case 'resolveMessagePaths':
      return (await host.resolveMessagePaths(command)) satisfies Answer<'resolveMessagePaths'>
    case 'openMessagePath':
      return (await host.openMessagePath(command)) satisfies Answer<'openMessagePath'>
    case 'revealMessagePath':
      return (await host.revealMessagePath(command)) satisfies Answer<'revealMessagePath'>
    case 'filesKept':
      if (command.scope === 'tree' && command.withAdded === true)
        return (await host.filesKeptForWindow(command.conversation)) satisfies Answer<'filesKept'>
      // ⛔ **D-026 · a read, and it takes no sink and no owner** — `whoCalledWhom`'s note. ⚠️ **No
      // `requireAPerson`**, `readResource`'s reading: a window is not an agent (HO-005), it offers no
      // act, and no agent reaches this door — it is on no toolset. ⚑ Synchronous, like every read
      // on this wire.
      return host.filesKept(command) satisfies Answer<'filesKept'>
    case 'filesLibrary':
      return (await host.filesLibraryForWindow(
        command.request,
        sink,
      )) satisfies Answer<'filesLibrary'>
    case 'teamProfileGraph':
      return (await host.teamProfileGraphForWindow(
        command.request,
        sink,
      )) satisfies Answer<'teamProfileGraph'>
    case 'searchWork':
      return (await host.searchWork(
        command.conversation,
        command.query,
      )) satisfies Answer<'searchWork'>
    case 'readChildState':
      // 296. No sink and no session of its own: this asks the PARENT's live handle about one of its
      // children, and the ledger decides whether that child is ours to ask about.
      return (await host.readChildState(
        command.sessionId,
        command.agentId,
        sink,
      )) satisfies Answer<'readChildState'>
    case 'sendToChild':
      // ⛔ **The first command in this union that writes to a child** — the sentence two cases below
      // said there was none, and 296 is the dispatch that made it false. It still takes no sink: the
      // child's answer is not this session's stream, it is the child's own record.
      return (await host.sendToChild(
        command.sessionId,
        command.agentId,
        command.text,
        sink,
      )) satisfies Answer<'sendToChild'>
    case 'readChildWork':
      // Same shape as `readWorkflowOutput` (112): a file read scoped to one recorded run. ⚑ **No
      // longer "read-only by construction"** — see the two cases above, which 296 added; this verb
      // is still a pure read, and that is now a property of the verb rather than of the union.
      return host.readChildWork(
        command.sessionId,
        command.part === 'transcript'
          ? { part: 'transcript', agentId: command.agentId }
          : { part: command.part, taskId: command.taskId },
      ) satisfies Answer<'readChildWork'>
    case 'earlierHistory':
      // No sink either, and for a stronger reason: this is a query about the LEDGER. It is the same
      // call whether the session is live or a recording, which is what stops scrolling back from
      // being two features that could disagree.
      return host.earlierHistory(
        command.sessionId,
        command.before,
        command.turns,
      ) satisfies Answer<'earlierHistory'>
    case 'latestHistory':
      // The way back after scrolling far enough to release the tail (054).
      return host.latestHistory(command.sessionId) satisfies Answer<'latestHistory'>
    case 'capabilities':
      return host.capabilities() satisfies Answer<'capabilities'>
    case 'providerCatalogue':
      return host.providerCatalogue() satisfies Answer<'providerCatalogue'>
    case 'providerConnections':
      return host.providerConnections() satisfies Answer<'providerConnections'>
    case 'profiles':
      // Synchronous host-side — it is a `readdir` under `userData` — and returned without an
      // `await` for the same reason `attachOpen` is: there is nothing asynchronous to wait for.
      return host.profiles() satisfies Answer<'profiles'>
    // 098. The profile defaults HERE rather than in the host, so that every credential path resolves
    // "which profile" in one place — the same rule `createSession` follows.
    case 'checkProviderAuth':
      return (await host.checkProviderAuth(
        command.provider,
        command.profileId ?? DEFAULT_PROFILE_ID,
        command.probe,
      )) satisfies Answer<'checkProviderAuth'>
    case 'reprovisionProviderHomes':
      return (await host.reprovisionProviderHomes(
        command.provider,
        command.statusOnly,
      )) satisfies Answer<'reprovisionProviderHomes'>
    case 'reprovisionProviderAuth':
      return (await host.reprovisionProviderAuth(
        command.provider,
        command.profileId ?? DEFAULT_PROFILE_ID,
      )) satisfies Answer<'reprovisionProviderAuth'>
    case 'signInProvider':
      return (await host.signInProvider(
        command.provider,
        command.profileId ?? DEFAULT_PROFILE_ID,
      )) satisfies Answer<'signInProvider'>
    case 'cancelProviderSignIn':
      return (await host.cancelProviderSignIn(
        command.provider,
        command.profileId ?? DEFAULT_PROFILE_ID,
      )) satisfies Answer<'cancelProviderSignIn'>
    case 'checkCwd':
      // No sink and no session: this is a question about a directory, asked before there is a
      // conversation to own. Synchronous host-side — it is a `stat` — and returned without an
      // `await` for the same reason `profiles` is.
      return host.checkCwd(command.path) satisfies Answer<'checkCwd'>
    case 'skills':
      return (await host.skillsForAPerson(command.request)) satisfies Answer<'skills'>
    case 'agentIdentities':
      requireAPerson(sink, command.kind)
      return host.agentIdentities() satisfies Answer<'agentIdentities'>
    case 'setExternalMcpServers':
      return host.setExternalMcpServers(
        command.profileId,
        command.externalMcpServerIds,
      ) satisfies Answer<'setExternalMcpServers'>
    case 'registerExternalMcpServer':
      // ⛔ **`requireAPerson`, with `setExternalMcpServers` as the precedent** (516, 355, 349). ⚠️ **The
      // reason is not that a registry row is a capability — it is not, and it grants nobody** — it
      // is that this door decides what an agent may be given, and HO-005's *"the human is
      // unrestricted"* is a statement about a HUMAN. ⚑ What keeps an AGENT off it is the same thing
      // that keeps one off `createAgent`: the verb lives on this wire and on no toolset, which
      // `the-rails-before-anything-can-reach-them.test.ts` is where the inventory for is pinned.
      //
      // 🔴 **And it is the ONE command on this union that opens a socket**, to an address a person
      // typed. That is the collision preflight and it is the whole rail — see
      // `RuntimeHost.registerExternalMcpServer`.
      requireAPerson(sink, command.kind)
      return (await host.registerExternalMcpServer({
        name: command.name,
        url: command.url,
        reach: command.reach,
      })) satisfies Answer<'registerExternalMcpServer'>
    case 'removeExternalMcpServer':
      return host.removeExternalMcpServer(
        command.serverId,
      ) satisfies Answer<'removeExternalMcpServer'>
    case 'setAgentProvider':
      return host.setAgentProvider(
        command.profileId,
        command.provider,
      ) satisfies Answer<'setAgentProvider'>
    case 'setAgentDisplayName':
      return host.setAgentDisplayName(
        command.profileId,
        command.displayName,
      ) satisfies Answer<'setAgentDisplayName'>
    case 'retitleWork':
      return host.retitleForAPerson(
        command.piece,
        command.title,
        sink,
      ) satisfies Answer<'retitleWork'>
    case 'readConversationIdentity':
      return host.readConversationIdentity(
        command.sessionId,
      ) satisfies Answer<'readConversationIdentity'>
    case 'readConversationIdentities':
      return host.readConversationIdentities(command) satisfies Answer<'readConversationIdentities'>
    case 'readConversationTasks':
      return host.readConversationTasks(command) satisfies Answer<'readConversationTasks'>
    case 'readAllConversationTasks':
      return host.readAllConversationTasks(command) satisfies Answer<'readAllConversationTasks'>
    case 'readConversationTitleHistory':
      return host.readConversationTitleHistory(
        command,
      ) satisfies Answer<'readConversationTitleHistory'>
    case 'renameConversation':
      return (await host.renameConversation(command, {
        kind: 'person',
      })) satisfies Answer<'renameConversation'>
    case 'takeBackWork':
      return (await host.takeBackForAPerson(command.piece, sink)) satisfies Answer<'takeBackWork'>
    case 'closeWork':
      return (await host.closeForAPerson(command.piece, sink)) satisfies Answer<'closeWork'>
    case 'setAgentModelAndEffort':
      return host.setAgentModelAndEffort(
        command.profileId,
        command.provider === null || command.model === null
          ? null
          : { provider: command.provider, model: command.model, effort: command.effort },
      ) satisfies Answer<'setAgentModelAndEffort'>
    case 'agentModelAndEffort':
      // ⚑ **Gated like `agentIdentities`, the roster it sits beside** (677): the sheet is a person's.
      requireAPerson(sink, command.kind)
      return host.agentModelAndEffort(command.profileId) satisfies Answer<'agentModelAndEffort'>
    case 'providerLaunchChoices':
      requireAPerson(sink, command.kind)
      return host.providerLaunchChoices(
        command.provider,
        command.profileId ?? DEFAULT_PROFILE_ID,
      ) satisfies Answer<'providerLaunchChoices'>
    case 'resolveProviderLaunch':
      requireAPerson(sink, command.kind)
      return host.resolveProviderLaunch(command) satisfies Answer<'resolveProviderLaunch'>
    case 'modelList':
      // ⚑ **D-042 · gated like `agentModelAndEffort`**: the list carries a person's own models and
      // last pick. ⚑ The profile defaults HERE, the credential gestures' rule: every path that
      // resolves "which profile" does it in one place (257 §2).
      requireAPerson(sink, command.kind)
      return host.modelList(
        command.provider,
        command.profileId ?? DEFAULT_PROFILE_ID,
      ) satisfies Answer<'modelList'>
    case 'addHandAddedModel':
      return host.addHandAddedModel(
        command.provider,
        command.model,
      ) satisfies Answer<'addHandAddedModel'>
    case 'deleteHandAddedModel':
      return host.deleteHandAddedModel(
        command.provider,
        command.model,
      ) satisfies Answer<'deleteHandAddedModel'>
    case 'apiKeyStatus':
      // ⚑ Ungated, `capabilities`' reason: where a key stands is not the key, and a surface
      // deciding what to offer asks it before anything is started.
      return (await host.apiKeyStatus(command.provider)) satisfies Answer<'apiKeyStatus'>
    case 'setApiKey':
      return host.setApiKey(command.provider, command.key) satisfies Answer<'setApiKey'>
    case 'removeApiKey':
      return host.removeApiKey(command.provider) satisfies Answer<'removeApiKey'>
    case 'checkApiKey':
      return host.checkApiKey(command.provider) satisfies Answer<'checkApiKey'>
    // ⚑ **The Providers screen's four reads** — open to any window, as `checkProviderAuth` is: none
    // carries a credential, a conversation or anything a person wrote.
    case 'providerVersions':
      return host.providerVersions() satisfies Answer<'providerVersions'>
    case 'providerSetup':
      return host.providerSetup() satisfies Answer<'providerSetup'>
    case 'providerUsage':
      return host.providerUsage() satisfies Answer<'providerUsage'>
    // ⚑ What an *Always allow* kept, and its removal — which edits a file of the person's, so only a
    // person's press does it.
    case 'keptRules':
      return host.keptRules() satisfies Answer<'keptRules'>
    case 'removeKeptRule':
      requireAPerson(sink, command.kind)
      return host.removeKeptRule({
        provider: command.provider,
        file: command.file,
        kept: command.kept,
      }) satisfies Answer<'removeKeptRule'>
    case 'providerResources':
      return host.providerResources() satisfies Answer<'providerResources'>
    case 'instructAgent':
      // ⛔ **`requireAPerson`, with `setAgentDisplayName` directly above as the precedent** (582,
      // 558, 433, 349). ⚠️ **And here the gate is not a formality**: `a-person` is the one
      // authority this door writes, so a caller that is not a person reaching it would put an
      // agent's words into the ledger under a person's name, which is the one provenance a reader
      // cannot check afterwards.
      //
      // ⚠️ **618 · this read *"`HO-009` §2.2 gives the configured layer exactly three
      // authorities"*** and the count moved: `HO-078` §4 added `its-creator`, a creator writing
      // the first version of an identity it is bringing into existence. ⛔ **The gate on THIS door
      // is untouched** — the sentence is corrected because a count outlives its derivation
      // (`WHO_WROTE_IT` is where the four are argued).
      //
      // ⚑ An AGENT's route to this layer is `propose_agent_rules`, which writes
      // `instruction_proposed` and nothing else — pinned by
      // `the-rails-before-anything-can-reach-them.test.ts`. ⚠️ **The name in this line was
      // `propose_instruction` until `618` and no tool has ever been called that**; nothing read it,
      // which is why nothing went red.
      requireAPerson(sink, command.kind)
      return host.instructAgent(
        command.profileId,
        command.text,
        command.broughtBack,
        sink,
        command.baseline,
      ) satisfies Answer<'instructAgent'>
    case 'agentInstructions':
      // ⛔ **`requireAPerson` on a READ, which is rarer in this switch than on a write.** ⚠️ The
      // reason is not secrecy — an agent already receives its own rules in its bundle at every
      // launch — it is that this payload carries every OTHER identity's asks and versions too, and
      // the verb lives on the window wire for the sheet that draws them.
      requireAPerson(sink, command.kind)
      return host.agentInstructions(command.profileId) satisfies Answer<'agentInstructions'>
    case 'agentMethods':
      requireAPerson(sink, command.kind)
      return host.agentMethods(
        command.profileId,
        command.offset ?? 0,
        command.limit ?? 50,
        sink,
      ) satisfies Answer<'agentMethods'>
    case 'agentMethodBody':
      requireAPerson(sink, command.kind)
      return host.agentMethodBody(
        command.profileId,
        command.key,
        sink,
      ) satisfies Answer<'agentMethodBody'>
    case 'agentMethodChanges':
      requireAPerson(sink, command.kind)
      return host.agentMethodChanges(
        command.profileId,
        command.offset ?? 0,
        command.limit ?? 50,
        sink,
      ) satisfies Answer<'agentMethodChanges'>
    case 'removeAgentMethod':
      return host.removeAgentMethod(
        command.profileId,
        command.selection,
        sink,
      ) satisfies Answer<'removeAgentMethod'>
    case 'undoAgentMethod':
      return host.undoAgentMethod(
        command.profileId,
        command.changeId,
        sink,
      ) satisfies Answer<'undoAgentMethod'>
    case 'checkInterruptedAgentMethods':
      return host.checkInterruptedAgentMethods(
        command.profileId,
        command.confirmed,
        sink,
      ) satisfies Answer<'checkInterruptedAgentMethods'>
    case 'agentOwnNotes':
      requireAPerson(sink, command.kind)
      return host.agentOwnNotes(command.profileId) satisfies Answer<'agentOwnNotes'>
    case 'agentOwnNotesUnread':
      requireAPerson(sink, command.kind)
      return host.agentOwnNotesUnread(command.profileId) satisfies Answer<'agentOwnNotesUnread'>
    case 'saveOwnNotes':
      return host.saveOwnNotes(command.profileId, command, sink) satisfies Answer<'saveOwnNotes'>
    case 'undoOwnNotes':
      return host.undoOwnNotes(
        command.profileId,
        command.expectedVersion,
        sink,
      ) satisfies Answer<'undoOwnNotes'>
    case 'markOwnNotesSeen':
      return host.markOwnNotesSeen(
        command.profileId,
        command.throughVersion,
        sink,
      ) satisfies Answer<'markOwnNotesSeen'>
    case 'agentRulesUnread':
      requireAPerson(sink, command.kind)
      return host.agentRulesUnread(command.profileId) satisfies Answer<'agentRulesUnread'>
    case 'undoAgentRules':
      requireAPerson(sink, command.kind)
      return host.undoAgentRules(
        command.profileId,
        command.expectedVersion,
        sink,
      ) satisfies Answer<'undoAgentRules'>
    case 'markAgentRulesSeen':
      return host.markAgentRulesSeen(
        command.profileId,
        command.throughVersion,
        sink,
      ) satisfies Answer<'markAgentRulesSeen'>
    case 'agentMemory':
      // ⚑ **F093 · C8 b — paged when a page is named**, behind the same gate; else the first
      // twenty, as before.
      if (command.offset !== undefined || command.limit !== undefined) {
        requireAPerson(sink, command.kind)
        return host.agentMemoryPage(
          command.profileId,
          command.offset ?? 0,
          command.limit ?? AGENT_MEMORY_NOTES_SHOWN,
        ) satisfies Answer<'agentMemory'>
      }
      // ⛔ **`requireAPerson`, with `agentInstructions` directly above as the precedent** (625,
      // 582). ⚠️ **And here the reason is not the one above.** That payload carries other
      // identities' asks; this one carries only the identity named — but it carries an agent's own
      // memory VERBATIM, and `HO-005`'s *"the human is unrestricted"* is a statement about a HUMAN.
      // ⚑ An agent reading another agent's memory is not something anybody has asked for, and this
      // verb lives on this wire and on no toolset — pinned by
      // `the-rails-before-anything-can-reach-them.test.ts`.
      requireAPerson(sink, command.kind)
      return host.agentMemory(command.profileId) satisfies Answer<'agentMemory'>
    case 'whatThisAgentWasGiven':
      // 🔴 **F093 · `requireAPerson`, with `agentMemory` directly above as the precedent**: this
      // read carries an agent's memory VERBATIM, and its own instructions — a person's door, on no
      // toolset.
      requireAPerson(sink, command.kind)
      return host.whatThisAgentWasGiven(command.sessionId) satisfies Answer<'whatThisAgentWasGiven'>
    case 'whatTheModelGot':
      // 🔴 **F093 · C9 d · `requireAPerson`, with `whatThisAgentWasGiven` directly above as the
      // precedent**: it carries an agent's own instructions and every message as it was handed over —
      // a person's door, on no toolset.
      requireAPerson(sink, command.kind)
      return host.whatTheModelGot(
        command.sessionId,
        command.ordinal,
      ) satisfies Answer<'whatTheModelGot'>
    case 'amendAgentMemory':
      return host.amendAgentMemory(command, sink) satisfies Answer<'amendAgentMemory'>
    case 'undoAgentMemory':
      return host.undoAgentMemory(command, sink) satisfies Answer<'undoAgentMemory'>
    case 'checkInterruptedMemory':
      return host.checkInterruptedMemory(command, sink) satisfies Answer<'checkInterruptedMemory'>
    case 'decideInstruction':
      // ⛔ **`requireAPerson`, and `HO-009` §2.2 is what makes it load-bearing**: *"An agent
      // proposes. A proposal is a card; approval writes it."* ⚑ Approval is the only thing that
      // turns an ask into a version, so a gate an agent could open would be criterion 21's *his
      // approval is the ONLY gate* with the gate removed.
      requireAPerson(sink, command.kind)
      return host.decideInstruction(
        command.askId,
        command.approve,
        sink,
      ) satisfies Answer<'decideInstruction'>
    case 'decideMcpServerRequest':
      // `requireAPerson`: approving registers a server agents may then use, which is the person's
      // call alone. No toolset carries this verb, so no agent can approve its own request.
      requireAPerson(sink, command.kind)
      return (await host.decideMcpServerRequest(
        command.requestId,
        command.approve,
        sink,
      )) satisfies Answer<'decideMcpServerRequest'>
    case 'removeAgent':
      return host.removeAgent(command.profileId) satisfies Answer<'removeAgent'>
    case 'archiveConversation':
      return host.archiveConversation(command.sessionId) satisfies Answer<'archiveConversation'>
    case 'restoreConversation':
      return host.restoreConversation(command.sessionId) satisfies Answer<'restoreConversation'>
    case 'checkDeleteConversation':
      return host.deleteVerdict(command.sessionId) satisfies Answer<'checkDeleteConversation'>
    case 'deleteConversation':
      return host.deleteConversation(
        command.sessionId,
        command.parts,
      ) satisfies Answer<'deleteConversation'>
    case 'setDefaultApprovalMode':
      // ⛔ **`requireAPerson`, and `noPersonBehindIt`'s sentence is true of it without stretching**:
      // *"changes what agents are allowed to do"* is exactly what a default of `auto` changes, one
      // launch later, for every conversation a person opens after it. ⚑ What keeps an AGENT off the
      // door is not this gate but the same thing that keeps one off `setAgentProvider` and
      // `createAgent`: the verb lives on this wire and on no toolset.
      requireAPerson(sink, command.kind)
      return host.setDefaultApprovalMode(command.mode) satisfies Answer<'setDefaultApprovalMode'>
    case 'createAgent':
      return host.createAgent(
        {
          slug: command.slug,
          displayName: command.displayName,
          provider: command.provider,
          ...(command.asAService === true ? { asAService: true as const } : {}),
        },
        sink,
      ) satisfies Answer<'createAgent'>
  }
}

/** A sink that pushes events into one renderer, and reports honestly once it is gone. */
export function webContentsSink(
  contents: WebContents,
  timing?: Pick<MainThreadWork, 'start'>,
): RuntimeEventSink {
  const ownerId = sinkOwnerId(contents)
  return {
    ownerId,
    // A `WebContents` sink draws requests in a window where the person can read and answer them. Set `aPersonIsBehindIt` here; other sinks must declare their own audience instead of assuming one.
    //
    // ⚠️ **A literal and not a check.** There is no runtime question to ask a `WebContents`: a
    // destroyed window is what `alive` below is for, and a window with nobody looking at it is
    // still the surface a card is drawn on. What this field answers is *"could a person read this"*,
    // and for a renderer the answer does not vary.
    aPersonIsBehindIt: true,
    get alive(): boolean {
      return !contents.isDestroyed()
    },
    send(message): void {
      const finish = timing?.start('window conversation event send')
      try {
        if (contents.isDestroyed()) return
        contents.send(RUNTIME_EVENT_CHANNEL, message)
      } finally {
        finish?.()
      }
    },
    sendLiveness(message): void {
      const finish = timing?.start('window liveness send')
      try {
        if (contents.isDestroyed()) return
        contents.send(RUNTIME_LIVENESS_CHANNEL, message)
      } finally {
        finish?.()
      }
    },
  }
}

/** The subset of `ipcMain` this module needs — kept structural so tests can drive it. */
export interface IpcHandleRegistrar {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void
}

/**
 * A command's kind for a log line: one this app knows, or a fixed word — never text a page made up.
 */
export function aCommandsKind(raw: unknown): string {
  const kind =
    typeof raw === 'object' && raw !== null ? (raw as { kind?: unknown }).kind : undefined
  if (typeof kind !== 'string') return 'not a command'
  if (Object.hasOwn(DURING_A_QUIT, kind) || isAPageReport(raw)) return kind
  return 'of an unknown kind'
}

export function registerRuntimeIpc(options: {
  ipc: IpcHandleRegistrar
  host: RuntimeHost
  sinkFor: (event: IpcMainInvokeEvent) => RuntimeEventSink
  /** The page's own freeze reports, taken before any runtime command is parsed. */
  pageReceipt?: PageReceipt
}): void {
  const ipc =
    options.pageReceipt === undefined
      ? options.ipc
      : takingThePagesReports(options.ipc, options.pageReceipt)
  ipc.handle(RUNTIME_COMMAND_CHANNEL, async (event, raw) => {
    if (aCommandsKind(raw) === 'teamProfileGraph' && event.sender.isDestroyed())
      throw new Error('Window closed.')
    return executeRuntimeCommand(options.host, options.sinkFor(event), raw).catch(
      (error: unknown) => {
        throw withoutItsClassName(error)
      },
    )
  })
}

/** The registrar, with the page's report answered by `receipt` before the command's listener. */
function takingThePagesReports(ipc: IpcHandleRegistrar, receipt: PageReceipt): IpcHandleRegistrar {
  return {
    handle: (channel, listener) =>
      ipc.handle(channel, (event, ...args) =>
        isAPageReport(args[0]) ? receipt.take(event, args[0]) : listener(event, ...args),
      ),
  }
}

/**
 * 🔴 **675 · a class name is a developer's word, and this is the door where it would become a
 * person's** (`670` F-c).
 *
 * ⛔ **Measured on Electron 43.2.0: `ipcMain.handle` sends a rejection as `error.toString()`** —
 * `${name}: ${message}` — and the renderer's `readableError` strips exactly one wrapper prefix,
 * `\w*Error:`. So a class that names itself anything not ending in `Error` reached a person whole:
 * *"MessageAlreadyHeld: a message is already waiting…"* at the Queue button and, since `670`, at a
 * send and an interrupt-and-send that lose their race and find work already held.
 *
 * ⚑ **Fixed HERE, once, rather than in each class**, because the property is about what crosses
 * this boundary and not about any one class: `ProfileUnopenable` reached the same screen at two
 * credential doors, and a class added tomorrow would too. ⚠️ **Nothing reads `.name`** — every
 * classifier in this app is `instanceof` — so the classes keep their names for the log, and the
 * original rides as `cause`. ⛔ A plain `Error` passes through untouched: its `toString()` already
 * says `Error: …`, which is the one prefix the renderer strips.
 *
 * ⚠️ **Scoped to this channel**, which is the one every runtime command crosses. The other
 * `ipcMain.handle` registrations in `main/index.ts` throw no named class today.
 */
export function withoutItsClassName(error: unknown): unknown {
  if (!(error instanceof Error) || error.name === 'Error') return error
  return new Error(error.message, { cause: error })
}
