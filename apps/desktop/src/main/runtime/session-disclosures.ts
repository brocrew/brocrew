import type { AgentInfo, RuntimeEvent, SessionHandle } from '@brobot2/runtime'
import { providerDescriptor, type Provider } from '@brobot2/shared'
import {
  PROVIDER_HAS_NOT_REPORTED,
  PROVIDER_NAME,
  type ApprovalModeDisclosure,
  type PlanGoAheadDisclosure,
  type SessionSettingsDisclosure,
  type QueuedMessageDisclosure,
  type ConversationProviderBlock,
  type SessionLiveness,
  type SessionInstructions,
  type ReportedModel,
} from '../../shared/runtime-ipc'
import type { WorkFolderGrant } from '../../shared/work-folders'
import { goAheadNotSent } from '../../shared/the-go-ahead'
import { clockTimeFrom } from '../../shared/clock'
import { instructionScope } from './instruction-scope'
import { queuedDisclosure, type QueuedMessage } from './queued-message'

/**
 * 🔴 **W4.189 · a folder an open piece grants the conversation holding it** — read from the piece's
 * give (`PieceRow.givenFolder`, `use: 'grant'`), so a piece that ends takes its grant with it.
 */
export interface HeldGrant {
  /** The folder, as the give spelled it — what a person and the giver read. */
  readonly folder: string
  /**
   * ⚑ **Where it really is** (`filesystemSpelling`, through every link) — what the provider is
   * handed: Codex's sandbox checks a write at its real path, so a grant spelled through a link was
   * granted in name and asked at every write (`probe:codex-work-folders`, W4.189).
   */
  readonly reaches: string
  readonly piece: string
  readonly label: string
  /** The conversation that gave the piece. */
  readonly givenBy: string
  /** ⚑ Whether its brief has been handed over: until then the grant waits for the turn carrying it. */
  readonly delivered: boolean
}

export type ProviderLimitDisclosure = Pick<
  SessionLiveness,
  'providerBlock' | 'providerBlockStatus' | 'providerBlockLastKnown'
> & {
  readonly queued: readonly QueuedMessageDisclosure[]
}

/** ⚑ **F076** — one ending a `background_work` row states, as the provider stated it. */
export type BackgroundWorkEnded = NonNullable<Extract<RuntimeEvent, { type: 'background_work' }>['ended']>

/**
 * 🔴 **F076 — what a turn ended by a refused login was for** ({@link HostedSession.whatItsFailedTurnWasFor}):
 * whether words this app sent opened it, the background work its provider said had finished since
 * the turn before (one row each, its two endings merged), what it still listed running then — which
 * stopped with it — and when it failed.
 */
export interface WhatAFailedTurnWasFor {
  readonly words: boolean
  readonly finished: readonly BackgroundWorkEnded[]
  readonly stillRunning: readonly string[]
  readonly at: number
}

/**
 * 🔴 **F076 — what a conversation is told when Claude refused the login it was started with while a
 * turn of its own was running** — held for its reopen on the login this computer holds now
 * ({@link RuntimeHost.reopenOnARenewedSignIn}), which a different login is what allows. ⚑ The
 * background work that had finished, as its provider described it and where its output is, when
 * that is what the turn was for; ⚑ else that a turn of its own was running; ⚑ and what was still
 * running, which stopped with it. ⚑ It asks nothing of it but to look.
 */

export function aRefusedLoginStoppedText(
  wasFor: WhatAFailedTurnWasFor,
  now: number,
  provider: Provider,
): string {
  const when = clockTimeFrom(wasFor.at, now)
  const name = PROVIDER_NAME[provider]
  const refused = `${name}’s login had changed, and ${name} refused the one this conversation was started with`
  const stopped =
    wasFor.stillRunning.length === 0
      ? ''
      : ` Still running then, and stopped with it: ${wasFor.stillRunning.join('; ')}.`
  const reopened =
    'This app reopened this conversation on the current login; nothing from that turn was sent again.'
  if (wasFor.finished.length === 0) {
    return (
      `At ${when} a turn of your own — one nothing was sent to you for, such as a scheduled ` +
      `wake-up — could not run: ${refused}.${stopped} ${reopened} Check where your work stands.`
    )
  }
  const what = wasFor.finished
    .map((ended) => {
      const said =
        ended.summary ??
        `the background task with the id ${ended.id} ${ended.outcome === 'unknown' ? 'ended' : ended.outcome}`
      return ended.outputFile === undefined
        ? said
        : `${said} — its output is in ${ended.outputFile}`
    })
    .join('; ')
  return (
    `At ${when} background work of yours finished, and the turn that would have told you could not ` +
    `run: ${refused}. What finished: ${what}.${stopped} ${reopened} Check where your work stands.`
  )
}

/**
 * The four ways a session can stop, as one type — because there is now one finalizer and these are
 * its callers (051, from 048 §1 finding 3).
 *
 * They used to be three separate endings with three different amounts of cleanup, and the two that
 * nobody had written down were the dangerous ones:
 *  - `closed` — the user, the window, or the quit asked. The only path that closed the handle.
 *  - `close-timeout` — we asked, and the stream did not drain in time. Deleted the map entry with no
 *    durable record at all.
 *  - `stream-ended` — the provider's stream simply finished. Deleted the map entry **without ever
 *    closing the handle**.
 *  - `stream-failed` — the iterator threw: an `AsyncQueue` overflow, a transport error, a dead
 *    child. Same as above, and this is the one that hurts: the queue failing is a CONSUMER
 *    failure, so the Claude query or the Codex child may still be running — including an unattended
 *    one — and the only handle able to stop it had just been dropped.
 */
export type SessionEnding = 'closed' | 'close-timeout' | 'stream-ended' | 'stream-failed'

/**
 * What a session's durable record should say once it is over.
 *
 * `errored` only for the `stream-failed` ending. The other three are ordinary — a user closing a
 * chat, a quit, a provider finishing — and recording those as errors would put a red session in the
 * list for every normal close.
 *
 * ⚠️ That is a statement about the ENDING, not about the session: because the finalizer is
 * single-flight on the first ending to arrive, a stream that fails *after* its close already timed
 * out is recorded as `ended`. The window is narrow (the drain has to expire first) and the answer is
 * still true — that session was closed and would not drain — but it is not the case that every
 * failed stream leaves an `errored` row.
 *
 * The turn reason is `ended` throughout, which is the enum member for exactly this: *the session
 * ended while a turn was open*. Not `completed` (we did not see it complete), not `failed` (the
 * provider never said so), and not `unknown` — that one belongs to resume, where the app was gone
 * for the ending; here we watched it happen, we just were not told how the turn came out.
 */
export function terminalFor(ending: SessionEnding): 'ended' | 'errored' {
  return ending === 'stream-failed' ? 'errored' : 'ended'
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 🔴 **735 · a refusal's message, ended as a sentence**, so {@link RuntimeHost.startAndSend} can say
 * after it what became of the start. ⚑ The send's own refusals (`cannot send: …`, an attachment's,
 * `R42`'s) often end with no full stop.
 */
export function aSentence(message: string): string {
  const trimmed = message.trimEnd()
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/**
 * ⚑ **What a person is told when the plan was released and the go-ahead did not go** (060, 670).
 * ⛔ **One sentence for both ways it can fail**: the send itself, and a hold that a rail refused.
 * ⚑ **700 · the words are `shared/the-go-ahead.ts`'s**, which the renderer reads too for a taken-back
 * go-ahead (`688` H2) — the bytes are the ones this app has always said.
 */
export function theGoAheadWasNotSent(error: unknown): Error {
  return new Error(goAheadNotSent(errorMessage(error)), { cause: error })
}

/**
 * 🔴 **What approval mode a conversation counts as, for the one rail that compares two of
 * them** (341, HO-005 Q2 — deleted by `366`, restored by `499` under HO-036).
 *
 * ⛔ **`auto` only when it is running `auto` AND is not on its way back to `ask`.**
 * `handle.approval` carries two values — what this turn runs under and what the next one will — and
 * a session that has asked to start prompting again is one whose laxness is being GIVEN UP.
 * Spending it on a child in that window would hand a permanent `auto` conversation to a parent that
 * will be prompting by the time the child says anything. ⚠️ The other direction needs no clause: a
 * session going `ask` → `auto` is `ask` here until the change is adopted, which is the strict answer
 * and the right one.
 *
 * ## ⚠️ It is NOT {@link approvalDisclosure}, and the difference is one state wide
 *
 * ⛔ **`approvalDisclosure` reports `effective` alone** and surfaces the divergence separately as
 * `pendingApprovalMode`, which is right for a DISCLOSURE — a person is told what is running and what
 * is queued. 🔴 **For a GRANT the two must fold, and they must fold the strict way.** For a
 * parent running `auto` that has already asked to go back to `ask`, this answers `ask` and
 * `approvalDisclosure` says `auto`. ⚑ **Reaching for the disclosure's value here would silently
 * pick the laxer of the two** — which is why `366` deleting this function and `499` re-deriving it
 * from `approvalDisclosure` would not have been the same repair.
 */
export function effectiveApprovalOf(session: { handle: SessionHandle }): 'ask' | 'auto' {
  const { effective, requested } = session.handle.approval
  return effective === 'auto' && requested === 'auto' ? 'auto' : 'ask'
}

/**
 * The whole approval disclosure for a live session (034), from the ONE place that knows it: the
 * handle. The host used to keep its own copy of the mode, which was correct for exactly as long as
 * the mode could not change.
 *
 * Three fields rather than one, because a change that has not been adopted yet is a real state and
 * flattening it would produce the worst line available — a header saying AUTO over a turn that is
 * still prompting, or the reverse. `approvalMode` is what is running; `pendingApprovalMode` is what
 * the next turn will run under; `approvalNote` says both, in words, composed host-side like every
 * other provider-specific phrasing.
 */
export function approvalDisclosure(session: {
  provider: Provider
  handle: SessionHandle
}): ApprovalModeDisclosure {
  const { effective, requested } = session.handle.approval
  const note = describeApprovalMode(session.provider, effective)
  return {
    approvalMode: effective,
    pendingApprovalMode: requested === effective ? null : requested,
    approvalNote:
      requested === effective
        ? note
        : `${note} · ${requested === 'auto' ? 'Auto' : 'Ask'} from your next message`,
    // Copied out of the handle, which is the one place that knows (058) — the same rule the mode
    // above follows, and for the same reason: a second copy kept host-side would be right until it
    // was not. A plain array, so the dedupe in `publishStateIfChanged` sees it change.
    blanketGrants: [...session.handle.blanketGrants],
  }
}

/**
 * Everything the liveness channel carries ABOUT the session rather than about the provider's
 * silence (060) — the PID line, the agent rows, what it prompts for, and whether a plan is waiting
 * on you.
 *
 * Extracted because there were three publishers building this object by hand and a fourth field to
 * add to each: the `LivenessTracker` callback, the agent-info republish and the approval republish.
 * Three copies of a growing literal is how one of them ends up a field behind — and the field that
 * goes missing is invisible, because a liveness message with one key absent still renders.
 *
 * Every value is READ FROM THE HANDLE at publish time, never captured: a Codex child that has died
 * reports no pid, and a plan released a moment ago must not be re-announced as pending.
 *
 * ⚠️ That first clause used to read *"a Codex child that has died clears its own `pid`"*, and it was
 * measurably false — Node keeps `pid` after exit on every version this app runs on (074, from 069
 * §2.2; the measurement is in `codex-transport.ts`). Reading at publish time was still the right
 * rule; it was resting on a fact that was not one, and the transport is what makes it true now.
 */
export function sessionDisclosures(session: {
  provider: Provider
  handle: SessionHandle
  mailbox?: readonly QueuedMessage[]
  currentProviderLimits?: () => ProviderLimitDisclosure
  reportedBefore?: ReportedModel | null
  grants?: readonly HeldGrant[]
}): {
  agent: { label: string; value: string }[]
  approval: ApprovalModeDisclosure
  plan: PlanGoAheadDisclosure
  settings: SessionSettingsDisclosure
  queued: readonly QueuedMessageDisclosure[]
  providerBlock?: ConversationProviderBlock | null
  providerBlockStatus?: 'current' | 'unavailable'
  providerBlockLastKnown?: SessionLiveness['providerBlockLastKnown']
  /** ⚠️ **Optional, and 150 made it so** — absent is what a provider with nothing to say says. */
  signInSuperseded?: boolean
  /** ⚑ **W4.189** — {@link SessionLiveness.workFolders}; absent when it holds none. */
  workFolders?: readonly WorkFolderGrant[]
} {
  // ⚠️ **Read ONCE and used twice**, the same rule `publishStateIfChanged` states for its key: the
  // rows and the `settings` field below are two views of one moment, and reading the handle twice
  // is how a header could come to name a model the disclosure beside it says is not running (179).
  const settings = settingsDisclosure(session)
  return {
    agent: describeAgent(session.handle.agentInfo, settings),
    approval: approvalDisclosure(session),
    plan: { planNeedsGoAhead: session.handle.planNeedsGoAhead },
    settings,
    queued: queuedDisclosure(session.mailbox),
    ...session.currentProviderLimits?.(),
    // ⚠️ **The LATCHED flag, never a fresh look** (147). `checkSignIn()` shells out to `security` and
    // this object is built on every liveness publish; asking it here would put a subprocess spawn on
    // the main thread behind every agent-info change. The turn boundary sets the latch; this reads
    // it. That is also why it obeys the rule at the top of this function — read from the handle at
    // publish time — without paying for it.
    //
    // ⛔ **ABSENT where the provider has nothing to say, rather than an explicit `false`** (150,
    // 148 L3). `=== true` turned every adapter's silence into a positive claim that this session's
    // sign-in is current — and for Codex that is not a fact it holds: its profile `auth.json` is a
    // copy that follows nothing, so there is no machine credential for it to have fallen behind and
    // no observation behind the `false`. `SessionHandle.signInSuperseded`'s own contract says *"an
    // adapter with nothing true to say leaves this absent"*, and this line was the one place that
    // filled the silence in. No visible defect today — the renderer reads it as falsy either way —
    // and that is exactly when a contract is cheap to keep.
    ...(session.handle.signInSuperseded === undefined
      ? {}
      : { signInSuperseded: session.handle.signInSuperseded }),
    // ⛔ **Whether this session's adapter can stop one piece of background work** (248), disclosed
    // by the same absent-not-false rule as the line above and for the same reason: `stopBackgroundWork`
    // is OPTIONAL and its absence means *"this adapter cannot say"*, which is Codex today.
    //
    // ⚠️ **The presence of the METHOD, not a call to it.** Asking would be a subprocess round-trip on
    // every liveness publish, and there is nothing to ask: the fact is whether the seam implements
    // the verb. `106`'s rule is what the renderer does with it — a control that cannot act is not
    // offered — and `118` is why it is absent rather than greyed.
    ...(session.handle.stopBackgroundWork === undefined ? {} : { canStopBackgroundWork: true }),
    // ⛔ **Whether this session's adapter holds a running command's output** (300), on the same
    // absent-not-false rule and for the same reason — `commandOutput` is OPTIONAL and Claude omits
    // it, measured rather than deferred (see `claude/capabilities.ts`).
    //
    // ⚠️ **Not redundant with the `commandOutput` CAPABILITY, and the pair is deliberate.** That
    // table is per-PROVIDER and carries the SENTENCE a person reads when there is no tail; this is
    // per-SESSION and is what stops the card asking for one. A recording has no handle at all, so it
    // must read absent here while the provider's capability still says `available` — which is the
    // same split `canStopBackgroundWork` has from `106`'s rule, one control over.
    ...(session.handle.commandOutput === undefined ? {} : { canReadCommandOutput: true }),
    // ⚑ **462, and the same absent-not-false shape a third time.** ⛔ It is what lets a row say
    // *this conversation is not running, so nothing is held* without pressing a door onto nothing:
    // a replay has no handle, so this is absent and the row draws the gap from what it already
    // knows. See `SessionLiveness.canReadToolAnswer`.
    ...(session.handle.toolAnswer === undefined ? {} : { canReadToolAnswer: true }),
    // 🔴 **W4.189 · the folders it may also work in, and whether each is in force** — `applied` once
    // a turn was started with it (the handle's own `effective`, read here at publish time), else
    // `queued`. ⚑ Absent-not-empty, the rule above: a conversation granted nothing says nothing.
    ...grantsDisclosed(session.grants, session.handle.workFolders.effective),
  }
}

/** ⚑ **W4.189** — {@link sessionDisclosures}' `workFolders`, absent when none are held. */
function grantsDisclosed(
  grants: readonly HeldGrant[] | undefined,
  effective: readonly string[],
): { workFolders?: readonly WorkFolderGrant[] } {
  if (grants === undefined || grants.length === 0) return {}
  return {
    workFolders: grants.map((grant) => ({
      folder: grant.folder,
      piece: grant.piece,
      label: grant.label,
      givenBy: grant.givenBy,
      state: effective.includes(grant.reaches) ? ('applied' as const) : ('queued' as const),
    })),
  }
}

/**
 * The three live settings, flattened for the wire (076) — what is running, and what is queued.
 *
 * ⚠️ **A queued value is `null` when nothing is queued, and that is not the same as `undefined`.**
 * `undefined` is a real requested value here — since D-042 (R1: every change is named, the
 * provider's default by its name) only an EFFORT, for a model whose list row offers none — so a
 * scheme where absence meant "nothing pending" could not express asking for it.
 *
 * ⚠️ **The three states live at TWO levels of the type, and saying so precisely matters** (this
 * comment described them at one level and was wrong for it): the field is
 * `{ value: string | undefined } | null`. `null` is "nothing queued"; a non-null WRAPPER is "a change
 * is queued", and the wrapper's `value` is what was asked for — a string, or `undefined` for "no
 * preference". A reader who tested `pendingModel === undefined` would never match anything.
 *
 * The wrapper survives Electron's structured clone even though its `value` may not: `{value:
 * undefined}` arrives as `{}`, which is still non-null and whose `.value` is still `undefined`, so
 * both readings hold. What would NOT survive is a check of the form `'value' in pending` — noted
 * here because the type suggests it would work.
 */
export function settingsDisclosure(session: {
  handle: SessionHandle
  reportedBefore?: ReportedModel | null
}): SessionSettingsDisclosure {
  const { model, reasoningEffort, planMode } = session.handle.settings
  const info = session.handle.agentInfo
  // ⚑ **…else what it last reported in an earlier life, kept on its row** — Claude says nothing
  // until a reopened conversation's first turn, and the rail and `get_agent_status` already read
  // the kept report (`ResumableSessionInfo.reported`, `AgentCard.runsOn`): one fact, three readers.
  const kept = session.reportedBefore ?? null
  return {
    model: model.effective ?? null,
    pendingModel: Object.is(model.effective, model.requested) ? null : { value: model.requested },
    reasoningEffort: reasoningEffort.effective ?? null,
    pendingReasoningEffort: Object.is(reasoningEffort.effective, reasoningEffort.requested)
      ? null
      : { value: reasoningEffort.requested },
    planMode: planMode.effective,
    pendingPlanMode: planMode.effective === planMode.requested ? null : planMode.requested,
    // ⚑ **D-042 · R5 — what the provider REPORTS**, absent until it has said; its effort only where
    // the provider reports one.
    ...(info?.model === undefined
      ? kept === null
        ? {}
        : { reported: kept }
      : {
          reported: {
            model: info.model,
            ...(info.reasoningEffortReported === true && info.reasoningEffort !== undefined
              ? { effort: info.reasoningEffort }
              : {}),
          },
        }),
  }
}

/**
 * **What this session was told, from the two places that know** (158).
 *
 * The injected half was read at LAUNCH and is stored on the session, because it describes what the
 * model was given rather than what is on disk now. The provider half is read off the HANDLE every
 * time, because it is the provider's current answer and the provider is the only one who has it.
 * Composed here so both hand-over paths — a reopen and a re-attach — say the same thing (100's
 * rule: one definition, two callers).
 */
export function instructionsFor(session: {
  handle: SessionHandle
  instructions: SessionInstructions
  /** ⚑ **The two facts the layer label is decided from** (356 §3) — see {@link instructionScope}. */
  cwd: string
  providerHome: string
}): SessionInstructions {
  const reported = session.handle.instructionSources
  return reported && reported.length > 0
    ? {
        ...session.instructions,
        // ⛔ **Labelled HERE, where the home and the cwd are known** (357 §4: *"The renderer must
        // not derive scope from path strings"*). The provider hands over bare strings in its own
        // order; the order is its claim and is preserved, the layer is ours and is added.
        provider: reported.map((path) => ({
          path,
          scope: instructionScope(path, {
            providerHome: session.providerHome,
            cwd: session.cwd,
          }),
        })),
      }
    : session.instructions
}

/**
 * How the session's approval mode reads to a human (078). Composed HERE, not in the view: dropping
 * approvals also drops the SANDBOX on Codex and nothing equivalent exists on Claude, and that is
 * provider knowledge. `ask` gets no note — the normal, safe mode needs no banner.
 *
 * The app names the modes Ask and Auto. Provider flags and persisted mode values stay unchanged.
 */
export function describeApprovalMode(provider: Provider, mode: 'ask' | 'auto'): string {
  // EVERY session states its mode (082, and reviewer 079-B4): showing nothing for `ask` meant a
  // checked yolo box next to a running ask-session looked like yolo was simply broken — the mode
  // was invisible, so there was nothing to contradict the box. A blank that means "ask" is not a
  // disclosure.
  if (mode !== 'auto') return 'approvals: Ask'
  return providerDescriptor(provider).approval.autoNote
}

/**
 * The agent rows the info panel shows (081). Composed HERE so the renderer never learns which
 * provider reports what — that asymmetry is provider knowledge.
 *
 * `…` means "not reported": showing a plausible value we were not told would be worse than showing
 * nothing. It is never a guessed default.
 *
 * The per-provider BRANCH is gone (024). It used to hard-code `n/a` for Claude on the strength of a
 * comment claiming the SDK had no reasoning knob — it does, we now set it, and the difference
 * between the providers is no longer "has one / doesn't" but "confirms it / can't". That difference
 * lives on the data now, so this reads the same field for both.
 */
function describeAgent(
  info: AgentInfo | undefined,
  /**
   * ⛔ **What this launch ASKED for, and 179 is the whole reason it is here.**
   *
   * `info` is what the provider has SAID, and on Claude it says nothing until a turn's
   * `system/init` — which the CLI emits when the first prompt is sent, not when the session opens.
   * So a conversation reopened onto a recorded model read `model: …` for as long as nobody typed
   * into it, while the app held that id on the row it resumed from AND had just handed it to the
   * provider. Measured in the running app and in `scripts/resume-live-smoke.mjs`:
   * `provider: claude · model: … · reasoning: …` on a session reopened onto
   * `claude-haiku-4-5-20251001`.
   *
   * ⚠️ **Second, never first.** A provider report replaces the request the moment it arrives — that
   * is what makes 177's reroute notice legible (*"codex answered this turn with `gpt-5.4` instead of
   * `gpt-5.6-sol`"*): the request and the answer stay two facts, and this row shows the strongest
   * TRUE one available rather than the most recent one.
   */
  settings: SessionSettingsDisclosure,
): { label: string; value: string }[] {
  return [
    { label: 'model', value: describeModel(info, settings) },
    { label: 'reasoning', value: describeReasoning(info, settings) },
  ]
}

/**
 * How the model row reads — the same three facts the reasoning row has always kept apart (179).
 *
 *  - **a provider report** → the id alone. It is running that model; nothing beats being told.
 *  - **our request** → the id, marked `(requested)`. We asked for it on this very launch and the
 *    provider has not spoken yet. ⚠️ **Marked, because a launch can be rerouted** (177) and an
 *    unmarked id here would be a claim we cannot back (086).
 *  - **nothing** → `…`. Nothing asked for a model and the provider has not named one — since D-042
 *    (R1: every launch names one) only a conversation that has named none yet, and the one case
 *    where an ellipsis is the honest answer.
 */
function describeModel(info: AgentInfo | undefined, settings: SessionSettingsDisclosure): string {
  if (info?.model) return info.model
  return settings.model === null ? PROVIDER_HAS_NOT_REPORTED : `${settings.model} (requested)`
}

/**
 * How the reasoning row reads. Three genuinely different facts, kept apart:
 *
 *  - **nothing** → `…`. Not reported, and nothing was asked for.
 *  - **a provider report** → the value alone. Codex's handshake and `thread/settings/updated`
 *    describe the thread that is actually running, so it is a fact about this session.
 *  - **our request** → the value, marked `(requested)`. Claude states the effort a turn ran at
 *    only as that turn ends (F099), so until then this is what we ASKED for. The SDK documents a
 *    silent downgrade on models that do not support the level, which is exactly why an unmarked
 *    value here could be quietly false.
 *
 * ⚠️ **The third case now has TWO sources, and they say the same sentence** (179). `info` carries
 * our request on Claude only once a turn has run; before that — a reopened conversation nobody has
 * typed into yet — the launch's own effort is the only thing there is to say, and it was already
 * being disclosed one field away under `settings`.
 */
function describeReasoning(
  info: AgentInfo | undefined,
  settings: SessionSettingsDisclosure,
): string {
  const effort = info?.reasoningEffort
  if (effort === undefined) {
    return settings.reasoningEffort === null
      ? PROVIDER_HAS_NOT_REPORTED
      : `${settings.reasoningEffort} (requested)`
  }
  return info?.reasoningEffortReported === true ? effort : `${effort} (requested)`
}
