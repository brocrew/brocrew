import { foldProfileName } from '../../../shared/runtime-ipc'
import { whereItWorks, type SessionRecord } from './session-record'
import { sessionPanel } from './session-panel'
import type { TranscriptState } from './transcript'

/**
 * 🔴 **Closing a conversation and opening it again, as one gesture — what it costs and what it is
 * waiting for** (470, lifted from `149`).
 *
 * ## ⛔ Why this is a module and not two copies
 *
 * ⚑ **`147` refused an automatic resume and wrote down why**: *"no action whose cost the user never
 * agreed to… The user is told and handed the button instead."* ⚠️ `149` then built the one surface
 * that offers it — the sign-in bar in `ConversationPane` — with the rule (*is this conversation
 * holding work a reopen would destroy?*) and the sentence (*what a reopen keeps and loses*) written
 * inline in that component.
 *
 * 🔴 **`470` needs the same offer on a second surface**, because HO-028 §3 ruled that an edit to a
 * grant with a launch boundary reaches a running conversation only when it next starts, and
 * *"offer the person a relaunch if they want it applied now — their press, never ours."*
 * ⛔ **Two surfaces reading one rule from two copies is `099`/`064`**, and it is precisely the class
 * `464` F3 named one subject over: *a grant's LABEL is derived by three readers; a grant's
 * SENTENCES are all literals.*
 *
 * ## ⚠️ The deixis is what had to move, and one sentence could not move on it alone
 *
 * ⛔ **`149`'s two waiting sentences opened *"Answer the question ABOVE first"* and *"THIS
 * conversation is still working"***, which are true of a bar attached to the conversation and false
 * of a row in a list of them. ⚑ Both now open on `It`, which the sign-in bar's own note names one
 * line above and the grant sheet's row names one column to the left. **The cost sentence did not
 * move at all**, because it was already written about the act rather than about the surface.
 *
 * ⚠️ **The turn sentence is a one-phrase swap and the question sentence is not** (`470 · relay
 * 1`). *"Answer the question above first"* without its *"above"* names no question at all, so the
 * row's version says which one is waiting before it asks for anything: *"It has a question
 * waiting. Answer that first…"*. ⛔ **A rewrite is not a deictic swap**, and a docblock that
 * flattened the two into one claim would send the next copy review past the sentence that changed.
 */

/** What a reopen would destroy if it happened right now, or `null` — nothing is in its way. */
export type ReopeningHeldBy = 'question' | 'turn' | null

/**
 * 🔴 **What the reopen would destroy if it were live right now** (149, from 148 M3) — unchanged in
 * `470` beyond moving here.
 *
 * ⛔ **The button was disabled only while a renderer command was in flight, and its sentence said
 * *"Nothing here is lost"*.** Both halves were wrong at once. A supersession is discovered by a
 * gesture — a queue or an interrupt — which can land while a turn is still running or a card is
 * still open; once that command settles, `busy` clears and the button goes live over live work.
 * Pressing it then ends the turn, terminally settles the open card (`markReopened` →
 * `settlePending`) and abandons a queued message.
 *
 * ⚑ **So the button waits instead**, and the surface says what it is waiting for. That is the same
 * judgement `147` made about the automatic resume it refused to ship. It costs one extra gesture —
 * answer the question, or stop the turn — and both are gestures the user was going to make anyway.
 *
 * An ENDED conversation holds nothing back: there is no turn to interrupt and its cards are settled
 * already, so the button stays live and reopening is exactly what it is for.
 */
export function reopeningHeldBy(state: TranscriptState): ReopeningHeldBy {
  if (sessionPanel(state).waiting > 0) return 'question'
  if (!state.ended && state.status !== 'idle') return 'turn'
  return null
}

/**
 * 🔴 **656 · what a close-then-resume actually does to a conversation — the ONE list.**
 *
 * ⛔ **There were three lists and no two agreed** (`643` F5). `RuntimeHost.assertSignInCurrent`'s
 * docblock named `sessionGrants`, `ultracode` and the open cards; {@link REOPENING_SAYS}' docblock
 * named the transcript, the draft, the approvals, `ultracode` and a queued message; the sentence a
 * person reads named three of those. ⚠️ **None of the three named the one cost a person is most
 * likely to meet** — work still running in the background, which the provider child takes with it
 * — and two of them named a cost no conversation can pay (`ultracode`: nothing in the app turns it
 * on today).
 *
 * ⚑ **Why a TABLE, and why HERE.** The costs live in three layers — the provider handle, the host's
 * resume, and `markReopened` in this renderer — so neither the host's docblock nor the button's
 * sentence can be the source by being written more carefully: prose in either place can drift from
 * the other two without anything turning red. 🔴 **A structured list can be held:**
 * `what-a-reopen-costs.test.ts` requires every row to DECIDE — its words are in the `free`
 * sentence, or it says why a person need not be told — and requires every sweep `markReopened`
 * performs to belong to a row, in both directions. ⚠️ **It sits beside the sentence because the
 * sentence is the one of the three a person acts on**; the host's docblock points here and keeps only
 * its argument.
 *
 * 🔴 **678 · ONE `free` sentence again.** ⚠️ `672` measured that the draft of a conversation that was
 * not the selected one was deleted by the reopen, split the draft row by ARM and gave the grant
 * sheet a second sentence saying so. ⚑ **R26 ruled that the draft survives** — `sweepDrafts` in
 * `drafts.ts` holds its slot through the gesture — so the rows fold back into one that is true of
 * every conversation, and the sheet's rows read the same words as the sign-in bar.
 *
 * ⚑ **"When the button is enabled" is the state every `isNotTold` reason is written for** —
 * {@link reopeningHeldBy} answers `null`: nothing is waiting on a person and no turn is running.
 * ⛔ In any other state the "no-op" rows below are real losses too — so the host's own reopen on the
 * current sign-in, for what an agent or this app holds for a conversation, waits for that state, and
 * also for no work running in the background and no planning (`RuntimeHost.reopenForWhatWaits`).
 */

export interface ReopenCost {
  /** What a person would call it. */
  readonly what: string
  /** What the gesture does to it. */
  readonly becomes: 'kept' | 'lost' | 'stopped' | 'settled' | 'sent when it starts'
  /** The mechanism, where it lives — so a reader can check the row rather than trust it. */
  readonly how: string
  /**
   * ⛔ **The renderer sweeps in `markReopened` this row answers for** — named exactly, because the
   * census compares these against the calls that function actually makes. Empty for a cost that
   * happens in the provider or the host.
   */
  readonly sweeps: readonly string[]
  /** The words the `free` sentence must contain, or why a person pressing it need not be told. */
  readonly person: { readonly isTold: string } | { readonly isNotTold: string }
}

export const REOPEN_COSTS: readonly ReopenCost[] = [
  {
    what: 'the transcript',
    becomes: 'kept',
    how: 'durable in the ledger and replayed into the reopened window',
    sweeps: [],
    person: { isTold: 'keeps the transcript' },
  },
  {
    what: 'what is typed or attached in the message box',
    becomes: 'kept',
    how:
      '`sweepDrafts.reopening` holds the conversation’s draft slot from before the close until the ' +
      'resume answers, so neither the words nor the attachments are swept while it is out of ' +
      '`store.live` — the selected conversation and every other one alike (`678`, R26; `672` ' +
      'measured the loss this replaces); a refused resume keeps the slot until it is open again',
    sweeps: [],
    person: { isTold: 'whatever you have typed or attached' },
  },
  {
    what: '“Allow for this conversation” approvals',
    becomes: 'lost',
    how:
      'on Claude the grant is the CLI’s own session rule (`736`, R94), held by the child the close ' +
      'ends, so the new child starts with none; on Codex the grant is the app-server’s and every ' +
      'launch and resume spawns a new one — ' +
      '`672` measured a file change granted for the session asking again after a reopen, 3 runs of ' +
      '3 (a Codex command card was never offered the choice, on 14 shapes); `697` landed that ' +
      'instrument as `probe:codex-reopen-grant`, which asserts it on every run — the 14 shapes ' +
      'too, as its `sweep` arm (`704`)',
    sweeps: [],
    person: { isTold: 'Allow for this conversation' },
  },
  {
    // 🔴 739 · `736` F-1 — the grant that is NOT the session's. ⚑ The file the card named
    // (`scope.grants.alwaysFile`) is read again by the launch the reopen makes.
    what: 'what you chose to “Always allow”',
    becomes: 'kept',
    how:
      'kept in the file its card named (`scope.grants.alwaysFile`), which a reopen does not touch; ' +
      'the launch a reopen makes reads it again, as every later launch that reads that file does — ' +
      'measured: a new launch on the same home was not asked again (`736`, `always-2`); since `740` ' +
      '(R99) a rule the CLI keeps in a project’s own settings is read for launches in that project, ' +
      'which a reopen is — ⚠️ except where the repository carries that file: BroBot records no ' +
      'trust for a folder, so the host’s launch does not apply its allow rules (`740`, ' +
      '`projectRulesFor` / `carriedByTheRepository`) — so the free sentence says where it STAYS, ' +
      'not that it applies',
    sweeps: [],
    person: { isTold: 'always allow' },
  },
  {
    what: 'work left running in the background',
    becomes: 'stopped',
    how:
      'the provider child is closed, and `stopDetachedWork` marks every row still running as not ' +
      'finished and empties the running list — detached work outlives its turn by design, so the ' +
      'button can be offered while it runs',
    sweeps: ['stopDetachedWork'],
    person: { isTold: 'running in the background' },
  },
  {
    what: 'a message waiting to be sent',
    becomes: 'sent when it starts',
    how:
      'D-017 · R3: teardown hands it on (`handOnWhatItHeld`) and the next start sends it first, in ' +
      'order; only a message caught mid-handover ends `abandoned` — a superseded sign-in keeps what ' +
      'its flush could not send held for this start',
    sweeps: [],
    person: { isTold: 'is sent once it has reopened' },
  },
  {
    what: 'an open question or permission card',
    becomes: 'settled',
    how: '`settlePending` settles every card still open',
    sweeps: ['settlePending'],
    person: {
      isNotTold:
        'the button is not offered while one is waiting — `reopeningHeldBy` answers `question`',
    },
  },
  {
    what: 'a running turn, its tool calls, its sub-agents and the activity line',
    becomes: 'stopped',
    how: '`closeStreaming`, `stopOpenToolCalls` and `stopRunningSubAgents`, and the activity is cleared',
    sweeps: ['closeStreaming', 'stopOpenToolCalls', 'stopRunningSubAgents'],
    person: {
      isNotTold:
        'the button is not offered while a turn runs — `reopeningHeldBy` answers `turn` — and the ' +
        'turn’s own ending already swept all of these',
    },
  },
  {
    what: 'scheduled jobs',
    becomes: 'kept',
    how:
      'nothing sweeps them — the jobs are left standing until the new process restates them (253); ' +
      '⚠️ its resume drops a one-shot whose time passed, a repeating job 7 days old or more, a job ' +
      'made before the conversation was last compacted and a `/loop` wake-up (D-029)',
    sweeps: [],
    person: {
      isNotTold:
        'what a resume drops is the conversation’s to act on: it is told, in one turn from this app, ' +
        'of a one-shot whose time passed (a `/loop` wake-up whose time passed with it: this app ' +
        'cannot tell the two apart) and of a job made before its last compaction — ⚠️ not of a ' +
        '`/loop` wake-up still ahead, which the resume drops unsaid, nor of a repeating job that ' +
        'aged out, as a running provider ages it out unsaid',
    },
  },
  {
    what: 'plan mode',
    becomes: 'lost',
    how:
      '`741` · R99 (corrected): a reopen leaves planning, whoever started the plan, as both CLIs’ ' +
      'own resumes do (measured, `740`/`741`) — the host resumes a row that planned as released ' +
      'and writes the release, and each provider tells the model in its own words (the plan-resume ' +
      'probes); the plan go-ahead pointer is cleared, and a finished turn had already cleared it',
    sweeps: [],
    person: { isTold: 'leaves plan mode' },
  },
  {
    what: 'model, reasoning effort and approval mode',
    becomes: 'kept',
    how: 'the resume re-reads each from the conversation’s own row',
    sweeps: [],
    person: { isNotTold: 'nothing is lost' },
  },
  {
    what: '`ultracode`',
    becomes: 'lost',
    how: '`ResumeOptions` cannot carry it, so a resumed child would come back without it',
    sweeps: [],
    person: {
      isNotTold:
        'nothing in the app turns it on today — no launch control and no spawn sets it — so no ' +
        'conversation can pay this; it stays listed because the wire still accepts it',
    },
  },
  {
    what: 'a question this conversation asked through the agent tools',
    becomes: 'kept',
    how:
      'D-017 · R4: from its `launched` row on, a stop abandons only what the provider held, so the ' +
      'question stays open in its ledger and an answer starts the conversation again; one asked ' +
      'before that row existed is abandoned by the stop, as it always was',
    sweeps: [],
    person: { isNotTold: 'nothing is lost' },
  },
]

/**
 * ⛔ **One sentence per state, and `free` is the one that is a COST rather than a wait.**
 *
 * ⚠️ **Written from what a close-then-resume actually does, measured, not from what would read
 * well — and since `656` the measurement is {@link REOPEN_COSTS}, not this paragraph.** ⛔ This
 * docblock used to list the costs itself and its list had drifted: it named `ultracode`, which no
 * conversation can pay, and not the work left running in the background, which the `free` sentence
 * now names. ⚑ `what-a-reopen-costs.test.ts` holds the sentence to the table, so the two cannot
 * come apart without a test going red. `086`: never claim more than happened — which cuts both
 * ways, and *"nothing here is lost"* claimed more than happened.
 *
 * ⚑ **`reopen` and never `relaunch`.** `470` measured the app's own word before writing a control:
 * *Reopen on the current sign-in*, *Reopening keeps the transcript*, `Reopen ${row.label}` in the
 * palette. **`relaunch` appears in no rendered string in this app**, and the first one would be a
 * second word for a gesture that already has one.
 */
export const REOPENING_SAYS: Readonly<Record<'question' | 'turn' | 'free', string>> = {
  question: 'It has a question waiting. Answer that first — reopening now would close it.',
  turn: 'It is still working. Let the turn finish, or stop it, then reopen.',
  // 🔴 **678 · *"or attached"*, and true of every row again** (R26). ⚠️ `672` gave the grant sheet a
  // second sentence — *"anything typed or attached in its message box is cleared"* — for every
  // conversation that was not the selected one, because that was what a reopen did. ⚑ It no longer
  // does, and the attachments were always kept wherever the words were; now the sentence says so.
  // 🔴 **741 · *"leaves plan mode"*** — R99 (corrected): a reopened conversation does not resume
  // planning, as its CLI's resume does not; a person reopening a planning one is told.
  // 🔴 **739 · `736` F-1 — and what a person chose to *Always allow*** ({@link REOPEN_COSTS}' kept
  // row): R95's grant outlives the conversation, so a reopen does not forget it — said as where it
  // STAYS (the file its card named), because a launch may not apply it (`740`: a file the repository
  // carries — BroBot records no trust for a folder, so its host does not apply that file's allows).
  free:
    'Reopening keeps the transcript and whatever you have typed or attached, and what you chose to ' +
    'always allow stays where it was kept. It forgets its ' +
    '“Allow for this conversation” approvals, leaves plan mode and stops anything still ' +
    'running in the background, and a message waiting to be sent is sent once it has reopened.',
}

/** The sentence for a state — {@link REOPENING_SAYS} with `null` folded onto `free`. */
export function reopeningSays(heldBy: ReopeningHeldBy): string {
  return REOPENING_SAYS[heldBy ?? 'free']
}

/**
 * 🔴 **A conversation this window has open, as the grant sheet needs to see it** (470).
 *
 * ⛔ **Resolved by the screen and handed over, never derived in the sheet** — the rule
 * `CapabilitiesSheet`'s own `runsOn` prop is written to: *"there must be ONE derivation of it"*, so
 * the sheet cannot disagree with the rail about which conversations are open or which of them is
 * holding work.
 *
 * ⚠️ **It is a POSITIVE list and an empty one claims nothing.** The renderer's session store holds
 * *"every session this window has open"*, and `running` on the wire is per-HOST — the host itself
 * *"cannot answer"* the per-window question. ⛔ So the surface that reads this may say *here is one
 * you can reopen* and may never say *there is nothing running as this identity*.
 */
export interface AConversationToReopen {
  readonly sessionId: string
  /** The folder it is working in, or `null` — this app holds no path for it. */
  readonly where: string | null
  /** {@link reopeningHeldBy} for this one, resolved by the screen. */
  readonly heldBy: ReopeningHeldBy
  /**
   * A command for it is already in flight, inside its bound (739, `A_COMMAND_IS_WAITED_ON_MS`) — the
   * same double-click guard the sign-in bar uses.
   */
  readonly busy: boolean
}

/**
 * 🔴 **Which of this window's open conversations are running as one identity** (470).
 *
 * ⛔ **A function here rather than a computed in the screen, and the reason is measurement.**
 * `RuntimeScreen` is the component nothing mounts — its own docblocks say so half a dozen times —
 * so a rule written inside it can only ever be pinned by a source census, and
 * `a-source-census-that-pins-a-line-kills-every-row-on-it` is what that costs. ⚑ Out here the rule
 * has a test and a mutation that can express its defect.
 *
 * ⚠️ **`meta === null` is a record this window has made and the host has not answered for yet.**
 * It carries no identity, so it is not offered: a row claiming to run as this identity on the
 * strength of a null would be inventing one, which is the same refusal `SideRail.who` makes.
 *
 * ⛔ **FOLDED on both sides, which is the app's answer everywhere else this question is asked**
 * (`runtime-host.ts`: *"Compared FOLDED… this rail is about the identity, not about the spelling a
 * launch used"*; `spawn-rails.ts` rail 7; `NewAgent.vue`). 🔴 **The two sides come from different
 * namespaces**: the slug is `agent_identity.slug`, written through `foldProfileName`, while
 * `meta.profileId` is the launch's verbatim directory spelling — *"which keeps every spelling
 * verbatim"*. ⚠️ A conversation started as `Worker` would have been dropped from `worker`'s offer,
 * and the module's own rule that an empty list claims nothing makes that miss look exactly like
 * nothing being open. Found by review.
 */
export function conversationsToReopen(
  open: readonly SessionRecord[],
  profileSlug: string,
): readonly AConversationToReopen[] {
  const wanted = foldProfileName(profileSlug)
  return open
    .filter((record) => {
      const ran = record.meta?.profileId
      return ran !== undefined && foldProfileName(ran) === wanted
    })
    .map((record) => ({
      sessionId: record.sessionId,
      // ⚑ **One owner for *where a conversation is working*** — {@link whereItWorks}. It was a
      // fourth copy of `basenameOf(record.meta?.cwd ?? '') || null` until review counted them.
      where: whereItWorks(record),
      heldBy: reopeningHeldBy(record.control),
      busy: record.busy,
    }))
}
