/**
 * Classify what a live-step failure can establish, separately from its observed verdict.
 * A model-dependent subject may never be produced, so zero failures alone cannot state how
 * many app claims were exercised.
 *
 * Classification is an explicit judgement, not a syntactic derivation. `step-census.test.mjs`
 * requires exactly the offered steps and rejects an app-only default for a step that can
 * report an unreachable claim, keeping the declared coverage complete and current.
 */

/**
 * ⛔ **A step that cannot always reach one of its claims, and says so per claim instead of throwing.**
 *
 * `cause: 'provider'` — the subject is something the provider may decline to produce (a tool it was
 * free not to call, reasoning it was free not to show, a plan it was free to write as prose, a
 * message the CLI declares and does not always send). `196` H1's fourth cell exists for exactly this
 * and `113` ruled that `PASS`, `SKIPPED` and `NOT RUN` are three different things; a red here would
 * be a red nobody could act on. ⚑ This is §5's *"model-dependent"*, spelled wider because the thing
 * that declines is not always the model.
 *
 * `cause: 'reach'` — the claim is outside a live step's REACH whatever the provider does: an
 * OS-owned dialog, a wire path the app no longer offers, a machine that has nothing stale on it. Not
 * a mood; a limit, and named as one so the two are never summed into a single excuse.
 *
 * ⚑ **Every entry here carries a positive control** (224 §4) — something the run DID produce,
 * asserted in the same breath, so the absence is a fact rather than a shrug. Where the control fails,
 * the step is RED, not blank. That is what keeps this list from being the hiding place `193` and
 * `196` were dispatched to close.
 */
export const GUARDED = {
  zw: {
    cause: 'reach',
    why: '⚑ 695 §4.1: a launch shorter than the 2 s watch tick, or one made while the window server could not be read, is never looked at — and is reported as a claim not reached, never counted clean. ⚑ The control is the watch itself: every directory it DID look at is asserted, and a single sighting is RED',
  },
  '1w': {
    cause: 'reach',
    why: "⚑ 695 §1: an ATTACHED app (BROBOT_CDP_PORT) is somebody's own window, and this step has nothing to say about it — it says so rather than passing. ⚑ The control is the launch: a run that launched its app asserts the window is off screen and titled BroBot2 — test, and a window server it could not read is NOT PERFORMED, never a pass",
  },
  '7b': {
    cause: 'provider',
    why: 'the run may produce no unmapped event at all, and none of a category the conversation drops',
  },
  '7d': {
    cause: 'provider',
    why: 'the conversation may produce no session/turn housekeeping for the lifecycle view to keep',
  },
  '7d2': {
    cause: 'reach',
    why: 'an OFF-SCREEN window that is throttled fires no rAF, so what a PAINT costs cannot be measured from here (212 §1) — ⚑ 695: a window this run LAUNCHED is never shown and runs unthrottled (121 rAF a second, measured), and 7d2 asserts both claims on it; an ATTACHED app that is minimised or covered is still throttled and still cannot be measured',
  },
  7: {
    cause: 'provider',
    why: '⛔ moved out of EXPOSED by 237 §4, which built the guard rather than declaring one: whether Claude reasons AT ALL is the model’s choice, so the shape on screen is a claim rather than an assertion. ⚠️ The second claim — a disclosure opened onto real words — is unreachable on this adapter by construction (claude/normalize.ts emits a redacted COUNT and never a text) and is reported as such rather than counted; step 12 reaches it on Codex. ⚑ The control is the ledger, plus 235’s erasure marker: reasoning that arrived and was drawn nowhere is still RED',
  },
  '11e': {
    cause: 'reach',
    why: "dialog.showOpenDialog is modal and OS-owned — main/index.ts's app:choose-cwd handler, which no CDP click can answer — so the pick itself and the last two hops are supplied by hand. ⚑ 420: step 46 used to be where this rule was stated; 417 deleted the field it was about and 46 is now WITHDRAWN, so it is stated here instead of cited",
  },
  '11f': {
    cause: 'reach',
    why: "CDP's file payload is always a real path on this machine, so a drop with NO usable path cannot be produced live",
  },
  '11g': {
    cause: 'reach',
    why: 'maxlength is not enforced for a scripted .value, and the wire refusing an attachment-only send is no longer reachable — which is 221’s point',
  },
  12: {
    cause: 'provider',
    why: 'Codex may reason nowhere on a turn (221). A pill with no toggle, or thinking events in the ledger with no entry on screen, is still RED (224)',
  },
  16: {
    cause: 'provider',
    why: 'Codex may run the whole task without ever sending a plan (193)',
  },
  17: {
    cause: 'provider',
    why: 'a run may produce no collab row to read, and a child may end without its own turn ever completing, so its outcome and usage are claims (226)',
  },
  19: {
    cause: 'provider',
    why: 'the model may answer in prose and never call ExitPlanMode (221). An ExitPlanMode with no document on screen is still RED (224)',
  },
  37: {
    cause: 'reach',
    why: 'nothing on a fresh user-data-dir is behind its archive, so the rebuild half is not exercised (193)',
  },
  '38b': {
    cause: 'reach',
    why: 'the second launch may stand down faster than 12 s of polling can catch it alive',
  },
  '44b': {
    cause: 'provider',
    why: 'the two endings this pairs depend on what the run actually recorded for the two conversations (222)',
  },
  47: {
    cause: 'reach',
    why: "219's negative half — the two send controls disappearing on a superseded sign-in — cannot be driven from a live step at all",
  },
  48: {
    cause: 'reach',
    why: 'the ledger row needs an active conversation on the rail to key the query on — and since 704 the provider’s own record of the interrupt is Codex’s rollout in this run’s OWN home, which an attached app, or a conversation that is not Codex’s, does not give it. ⚠️ And since 704 a model that finishes its reply before it can be cut short leaves the whole step NOT ASSERTED rather than red — nothing was interrupted, so nothing was measured',
  },
  57: {
    cause: 'provider',
    why: 'a dynamic workflow may end with no phase at done, and return no output document (193)',
  },
  58: {
    cause: 'provider',
    why: 'the child may write no prose row, leave no ending summary, and produce no boundary to be on both sides of',
  },
  62: {
    cause: 'provider',
    why: '/compact is manual and the provider can decline it (193); the phase can also be shorter than the poll interval',
  },
  63: {
    cause: 'reach',
    why: 'the counts line is evidence for the noun rather than the rule, and this run may not use it either way',
  },
  68: {
    cause: 'provider',
    why: 'either half is the model’s to give — it may search and never attempt Bash (219, 221), or neither. A row that did not finish, or a call in the ledger with no row on screen, is still RED (224)',
  },
  70: {
    cause: 'provider',
    why: "the pinned CLI may emit no conversation_reset for /clear in the session it is asked in — NOT ASSERTED only when the CLI's own frame is absent from the event log too; its frame with no `conversation_reset` from the app THROWS (721, R75)",
  },
  71: {
    cause: 'reach',
    why: 'claim 3 compares the rail rows that share the step’s folder, and a rail read showing fewer than two of them, or two that read alike, is reported as a claim not reached with the rows quoted (210 finding 4). ⚑ The control is the queue itself: the three conversations, the six facts on every row and the one answer that clears exactly one are asserted on every run',
  },
  73: {
    cause: 'provider',
    why: 'the app cannot make a request FAIL — an unroutable model name is rejected by the provider, and a provider that routed it instead would leave no failure to narrate and no occurrences to count. Whether it also announces a reroute (177) is its business too. ⚑ The control is the count itself: a machine text a person reads TWICE is RED, and so is a ledger that stopped recording the separate accounts of it (246 §1)',
  },
  77: {
    cause: 'provider',
    why: "whether the model reaches CronCreate is its own discretion — 250 measured it doing so unaided on five runs, but a turn that answers in prose creates no job and the app has nothing to be wrong about. ⚡ The discriminator is READ from TWO surfaces and carries the tool's own STATUS: the transcript's rows and the ledger must agree that a CronCreate COMPLETED, so *the model declined*, *the provider rejected it* and *the app dropped it* are three different absences (224 §4). ⛔ **Everything after it is app-shaped and THROWS**: a level on the wire with no bar above the composer, a bar whose expression or job id the raw event does not carry, a row that shows no schedule or no prompt, a pill or a rail row that still reads `idle`, a drawer paragraph whose `data-scheduled` says otherwise, and — 258 §2 — a close that either deletes the job, keeps promising it, or changes the heading it may not change",
  },
  76: {
    cause: 'provider',
    why: 'whether a NATIVE ⌘V can be driven at all is the instrument’s question, and whether the model can OCR the token is provider work; each is reported as an unasserted claim instead of an app-defect RED. ⛔ **The delivery path stays app-shaped and THROWS**: a paste event that arrived and staged nothing, a picture written inside protected userData, a false chip label/glyph/undo/dimension, or a transcript that drops the attachment or person’s message is still a defect (254 §2/§4)',
  },
  75: {
    cause: 'provider',
    why: 'whether the model DETACHES the command is its own discretion, exactly as it is for 74 — a turn that runs it in the foreground puts nothing in the level set and leaves no row to name. ⚑ The control is TWO app-shaped throws, and they are what make a red here mean a defect: a registry that names NOTHING while the OS still holds the process, and a row that reads the provider’s description while the card carrying its own background id is on screen — which is proof the task↔tool binding existed and the join was simply not taken (251 §2)',
  },
  78: {
    cause: 'provider',
    why: '⚠️ **Narrower than 74 by a measurement, not by choice.** Whether the model RUNS the command it was handed is still its business, and a turn that answers in prose leaves nothing in the process table and nothing for this step to be about. ⛔ **Everything after that is app-shaped and THROWS**, because 275 measured the provider half to be deterministic on the pinned 0.146.0 — a plain `sleep` turn ends at 4 009 ms over a 400-second command, on every run, with the row listed at t = 0 ms and `terminate` answering `{terminated:true}` with the pid leaving the table. So a process the OS still holds while the registry names nothing is RED, a named row with no stop is RED, and a stop that leaves the process alive 20 s later is RED (275 §3)',
  },
  74: {
    cause: 'provider',
    why: 'whether the model DETACHES the command is its own discretion — 247 measured Haiku and Sonnet doing it on every asked row, and on 2 of 4 unasked ones, but a turn that runs it in the foreground opens no window and leaves nothing to be truthful about. The stop is the provider’s too: Query.stopTask promises a notification, not a death. ⚑ The control is the OS, and it is what makes the red app-shaped: a card that reads FINISHED while the process table still holds the process and no stamp is on disk THROWS (248 §7)',
  },
  80: {
    cause: 'provider',
    why: "⚠️ **Only the FIRST claim is the provider's** — whether the model reaches for the Task tool at all is its choice, and a run in which it answers directly has produced no child for this step to open. ⛔ **Everything downstream of a card appearing is app-shaped and THROWS**: a card that offers to open a child and opens nothing, a viewer with no channel band, a band carrying no sentence, and — the one this dispatch exists for — a Send button that can be PRESSED for a provider whose `childInput` is declared absent. ⚑ The control that tells a provider's choice from a defect is the card count itself: `subagent-open-transcript` is rendered from this app's own ledger, so zero cards is a measurable state and every claim after it is unconditional (296 §1/§2)",
  },
  82: {
    cause: 'provider',
    why: 'each unit asks a fresh real ask-mode controller to give a child its one action through one inspected one-shot give_work permission — the child running on the model a person chose for its agent, from the list its provider offers — then asks that provider to choose one exact Write/apply_patch action. A guarded exit preserves controller/child status plus provider tool/file events; once the intended file permission and durable request_routed row exist, every takeover, exact-copy, IPC, ledger and filesystem assertion throws on an app mismatch',
  },
  79: {
    cause: 'provider',
    why: '⚠️ **Only the ROWS are the provider’s** — whether a CLI publishes any commands at all is its own business, and `probe:provider-commands` measured 44 rather than assuming them, so an empty list is a fact to report and not a defect to redden on. ⛔ **Everything else is app-shaped and THROWS**: a palette that does not open, and a palette that opens over a live conversation with NO sentence about its agent, are both this app failing to say what it knows. ⚑ And when rows do arrive, five further claims are app-shaped in turn — the provider’s own prefix on every title, the provider’s own description in the detail, the provider named in the heading, §3’s does-not-run-them disclosure on screen, and BroBot’s own destinations still listed beside them with not one agent row announcing itself as an option (279 §2/§3)',
  },
  83: {
    cause: 'provider',
    why: "715 · R64: the `cd` that moves the CLI is the MODEL's to make after the reopen, and a model that declines it leaves no later init with a moved folder to name. ⚑ Two controls, each quoted in its NOT ASSERTED: the ledger's Bash call after the reopen and the folder its result printed; and the CLI's own transcript recording the next turn in `findings`. A reopen that never landed THROWS. ⛔ Past the move, a resume mismatch and a stored ref whose cwd is not the launch folder THROW; a turn after the move that ends for any OTHER reason is the provider's to explain, and is NOT ASSERTED with its errors quoted",
  },
  84: {
    cause: 'provider',
    why: "721 · R75: the reset is the CLI's to send on `/clear`, and a ledger holding no reset FRAME from the CLI (its `unknown{conversation_reset}`) leaves no ref with anywhere to move — NOT ASSERTED, with every row type quoted. ⛔ Past that frame, the app raising no `conversation_reset` from it, a stored ref that is not the one the reset moved to (or is the frame's own `new_conversation_id`) or names no conversation with a transcript, an Open the window refuses (its one-line notice, since D-017b: the row's own `resume-failed` went with Resume), a `resume mismatch`, and a reopen that opened anything but the conversation the `/clear` began all THROW; a turn after the reopen that ends for any OTHER reason is the provider's to explain, and is NOT ASSERTED with its errors quoted",
  },
  85: {
    cause: 'provider',
    why: "721 · R76: the reset is the CLI's to send when a reopen's first message is `/clear`; a ledger with no reset FRAME from the CLI after the reopen, or one that came after the opening or named another conversation than the one reopened, is not R76's shape — NOT ASSERTED. ⛔ A Resume the reopen list refuses, a `resume mismatch` (on `main` the measured fatal), a reopen that never opened, an opening naming anything but the conversation asked for, no move after it, and a stored ref that is not the one moved to or names no conversation with a transcript all THROW; a later turn that ends for any OTHER reason is NOT ASSERTED with its errors quoted",
  },
  86: {
    cause: 'provider',
    why: "726 · R92: whether the model makes each call is its own — the two reads (`Read` on Claude, one `cat` per file on Codex) and the one `give_work` — and a call it did not make, a give refused on a rail other than a folder's, a child left in the parent's own folder (a give that named no `folder`), or a cheap model its provider's own list does not offer the child is NOT ASSERTED with the ledger's calls quoted. ⚑ The controls are the run's own ledger: the tool call naming each planted path, the tool's result, and the child's row. ⛔ A read the tool did not run, a give refused `folder-unusable` on the folder the step made, and a child started anywhere but the folder asked for or the parent's own all THROW; a turn past its bound, or one the provider failed before any call (its errors quoted), is NOT PERFORMED",
  },
  '86b': {
    cause: 'provider',
    why: "726 · R92, on Codex: the same three calls are the model's to make, and the same premises are NOT ASSERTED with the ledger quoted. ⚑ Codex's reads were never guarded by this app, so they are the control that passed before `726` too; the give is the subject. ⛔ A refused `cat`, a give refused `folder-unusable` on the folder the step made, and a child started anywhere but the folder asked for or the parent's own THROW; a turn past its bound, or one the provider failed before any call (its errors quoted), is NOT PERFORMED",
  },
}

/**
 * ⛔ **Model-dependent in its subject, and STILL app-shaped when the model declines** (224 §5's third
 * bullet, and §4's list).
 *
 * ⚠️ **These are the dangerous ones and they are named individually rather than counted.** A step
 * lands here when its subject needs the provider to volunteer and the step still THROWS for it — so
 * the red a person eventually reads is app-shaped, whatever caused it. Every `why` below was written
 * from the assertion that trips and the message it prints, not from the step's title.
 *
 * ⛔ **`control` is 224 §4's list, as data.** `'available'` means the step already asserts something
 * about what the run DID produce that would separate *"the provider declined"* from *"the app is
 * broken"* — so it could be reclassified the way `12`, `19` and `68` were, by a dispatch that reads
 * it properly. `'none'` means it does not, and `224 §4` is explicit about those: *"a step with no
 * such control cannot be reclassified — say which ones those are and leave them FAIL; that list is a
 * finding, not a shortfall."*
 *
 * ⚠️ **Nothing here was reclassified by 224 and nothing here is a bug report about the app.** They
 * are reds waiting to happen, and the reason they are written down is that four of them already did.
 */
export const EXPOSED = {
  3: {
    cause: 'provider',
    control: 'available',
    why: 'the reply must contain PINGPONG, fenced as a code BLOCK, with both list markers inside the same message — and an activity pill must be caught mid-turn',
  },
  4: {
    cause: 'provider',
    control: 'none',
    why: 'the composer freeze is only observed while a card is open, so a model that answers in prose reds it as "the composer was never observed while the card was open"',
  },
  '4b': {
    cause: 'provider',
    control: 'none',
    why: "it drives no turn of its own: the answered card it collapses is step 4's, so step 4's decline reds a step that never mentions a provider",
  },
  5: {
    cause: 'provider',
    control: 'none',
    why: 'a model that declines the write raises no permission_request, and the message reads as the permission pipeline being broken',
  },
  '5b': {
    cause: 'provider',
    control: 'available',
    why: 'the session grant needs a carded tool call on BOTH turns; the middle one hangs for the full turn budget when the second write never comes',
  },
  6: {
    cause: 'provider',
    control: 'available',
    why: 'the interrupt needs a genuinely long stream, and this run has already refused a bulk-output prompt outright once',
  },
  '6b': {
    cause: 'provider',
    control: 'none',
    why: 'liveness silence needs a quiet long-running command; a turn that ends first reds as "the turn ended before any silence"',
  },
  '7e': {
    cause: 'provider',
    control: 'none',
    why: 'three of its nine measured surfaces exist only if the provider produced that kind of content, and their absence is reported as "this step proved nothing about: …"',
  },
  '11d': {
    cause: 'provider',
    control: 'available',
    why: 'the agent has to actually READ the handed file and echo its token; a decline is three minutes of silence naming no model behaviour',
  },
  18: {
    cause: 'provider',
    control: 'available',
    why: 'yolo-off has to raise a card, which needs Codex to call a file-write tool inside the turn budget',
  },
  22: {
    cause: 'provider',
    control: 'available',
    why: 'the unattended turn must really call a write tool, or the policy re-arm has no decision to be about',
  },
  23: {
    cause: 'provider',
    control: 'none',
    why: 'the model has to render a RELATIVE link for anything to be clicked; the step says INCONCLUSIVE and still throws',
  },
  29: {
    cause: 'provider',
    control: 'none',
    why: 'the panel empties when a question is answered — and there is no question unless the model raises a permission card',
  },
  30: {
    cause: 'provider',
    control: 'available',
    why: 'Codex has to emit a plan item that renders a plan body; it can plan in prose instead',
  },
  31: {
    cause: 'provider',
    control: 'available',
    why: 'the wholesale Bash grant needs a first Bash card, and then a SECOND command that the model may not run',
  },
  32: {
    cause: 'provider',
    control: 'available',
    why: 'a Codex plan has to be proposed before it can be approved, and then the work has to actually change the file',
  },
  34: {
    cause: 'provider',
    control: 'none',
    why: 'the unattended session must ASK — and "timed out waiting for the question card" is character for character the regression this step exists to catch',
  },
  35: {
    cause: 'provider',
    control: 'none',
    why: 'the generation has to produce an image event; "no image entry in the conversation" reads as a pure app or wire defect',
  },
  36: {
    cause: 'provider',
    control: 'none',
    why: 'after fourteen paid padding turns it needs an AskUserQuestion the model may simply not raise',
  },
  41: {
    cause: 'provider',
    control: 'none',
    why: 'the card with the whole command tail only exists if the model runs a long command',
  },
  45: {
    cause: 'provider',
    control: 'none',
    why: "the provider's CATALOGUE has to offer more than the three levels 024 hard-coded — deterministic per pinned CLI rather than per run, and the step's own error message asks a human to go and fetch the model/list response",
  },
  51: {
    cause: 'provider',
    control: 'none',
    why: 'a question that outlives its turn needs a card nobody answers, and Codex has to raise one',
  },
  52: {
    cause: 'provider',
    control: 'available',
    why: "Codex has to propose a plan AND a go-ahead bar; the step's own comment says the timeout 'reads as the feature is gone'",
  },
  53: {
    cause: 'provider',
    control: 'none',
    why: 'it loops over BOTH providers, so either one declining to raise a card reds the whole step',
  },
  56: {
    cause: 'provider',
    control: 'none',
    why: '⛔ added by 237 §3, and it is step 45’s class exactly: the live half WAITED for `haiku` to REFUSE the mode, which holds only while the provider’s catalogue leaves that model undescribed. ⚑ 420: the step is WITHDRAWN — 417 deleted `ultracode` with the Fine-tune fold — so this entry describes the exposure it will have again if the surface returns, not one it has today. ⚠️ A catalogue that starts reporting effort levels for haiku times the wait out as "the mode never refused the named model" — an app-shaped red for a change on the provider’s side, deterministic per pinned CLI rather than per run, and nothing the step asserts would tell the two apart',
  },
  60: {
    cause: 'provider',
    control: 'available',
    why: 'refusing a question needs a question, and the model chooses whether to ask one',
  },
  61: {
    cause: 'provider',
    control: 'none',
    why: 'work the provider starts BY ITSELF is the subject, and nothing can make a provider start it',
  },
  66: {
    cause: 'provider',
    control: 'available',
    why: "the agent has to choose to WRITE a memory; 165's first run failed because the model refused outright, which was the model being right",
  },
  67: {
    cause: 'provider',
    control: 'available',
    why: 'the same write, on two profiles, before anything about carrying it across projects can be read',
  },
  69: {
    cause: 'provider',
    control: 'none',
    why: 'Codex has to obey a planted AGENTS.md and end its reply with a token — pure model discretion',
  },
}

/**
 * ⛔ **The exposed inventory as PUBLISHED, frozen — the one thing here that is not re-derived**
 * (237 §2, from `230` H2).
 *
 * ⚠️ **Everything else in this file is a same-instant consistency check between two representations
 * of TODAY, and that is the whole finding.** Every expectation in `step-census.test.mjs` reads
 * `Object.keys(EXPOSED)` and follows the inventory wherever it goes; `riskOf` falls through to
 * `'app'` for a token in neither list; and `app` and `exposed` have IDENTICAL source-side predicates
 * (the contrapositive of *"a step that blanks is never left in the app default"* is *"an app step
 * does not blank"*, which is exactly what the exposed guard asserts). ⛔ **So the axis
 * `appDefectOnly` was computed on could not be falsified by anything in the suite**: deleting all
 * thirty entries below LEFT the run reporting `97/97 step(s) can go red ONLY for an app defect`,
 * green, with no live step changed. ⚑ Past tense — this list and {@link DEPARTED} are what changed
 * it, and deleting the published inventory now reports unexplained departures and a red.
 *
 * ⚑ **A baseline is the only thing that fixes that, because the missing property is temporal.** It
 * is dated rather than maintained: this is what `224` measured, and nothing may quietly leave it —
 * see {@link DEPARTED}, which is the door.
 *
 * ⚠️ Steps that JOIN the exposed list stay free, deliberately. The direction that needs a written
 * reason is the one that makes the headline read better.
 */
export const EXPOSED_EVER = [
  '3',
  '4',
  '4b',
  '5',
  '5b',
  '6',
  '6b',
  '7',
  '7e',
  '11d',
  '18',
  '22',
  '23',
  '29',
  '30',
  '31',
  '32',
  '34',
  '35',
  '36',
  '41',
  '45',
  '51',
  '52',
  '53',
  '60',
  '61',
  '66',
  '67',
  '69',
  // ⛔ **Added since, and in the baseline for the same reason the thirty are** (237 §3). ⚠️ Freezing
  // only what `224` published would leave every LATER addition free to leave again in silence —
  // which is `230` H2's finding with a smaller number on it. An entry joins this list on the day it
  // joins {@link EXPOSED}, and leaves only through {@link DEPARTED}.
  '56', // 237 §3 — step 45's class: the live half holds only while the catalogue leaves haiku undescribed
]

/**
 * ⛔ **Every step that has LEFT {@link EXPOSED_EVER}, and what earned it** (237 §2).
 *
 * ⚠️ **One-way, and that asymmetry is the point.** `230` H2 says the census can read stronger while
 * covering less; the three ways it can happen are a step being deleted, renamed, or reclassified,
 * and before this every one of them was green. ⛔ Now a token may leave the exposed list only by
 * appearing here — with the dispatch that moved it, where it went, and **the assertion that earned
 * the move, verified to exist in that step's own body**.
 *
 * ⚑ **`control` is what makes this more than a comment.** `224 §4` built a positive control for each
 * of the three steps it reclassified and the test names those by hand — its own docstring says *"a
 * fourth step reclassified later needs its own line here"*. This is that line, as data: the string
 * has to be IN the step, so a reclassification that moved the label and built nothing goes red.
 *
 * @type {Record<string, { at: string, to: 'guarded' | 'app' | 'retired', control: string, why: string }>}
 */
/**
 * 🔴 **WITHDRAWN — a step whose SUBJECT the product no longer has** (`420` §4).
 *
 * ⛔ **A fourth cell, and it exists because the other three would all be lies about these steps.**
 * `app` says *"a red here can only mean the app is wrong"*; `guarded` and `exposed` say *"a
 * provider may decline this"*. A withdrawn step is neither: it cannot go red at all, for anybody,
 * ever, because the gesture it was written to make was deleted from the product. Counting one
 * towards `appDefectOnly` would make the instrument's headline number grow by exactly the steps
 * that stopped measuring anything — which is `196`'s defect, at the level of the whole suite.
 *
 * ⚠️ **This is not `DEPARTED`.** That records a step leaving the EXPOSED list — a step that got
 * better. This records a step that lost its subject, which is a step that got smaller, and the two
 * movements must not share a number.
 *
 * ## 🔴 `427` · the SECOND way a step stops being able to go red, and why it shares this cell
 *
 * ⛔ **Every entry above lost its GESTURE. `69b` lost its ANSWER.** `356`/`357` ruled that no
 * instruction file may be presented as the profile's own; `377` then made `profile-bundle.ts`
 * write a profile-scoped `AGENTS.override.md`, so a correct app now reports exactly what that
 * step asserted it must not. ⚠️ **Whether `377`'s override is legitimate is a RULING**, and until
 * somebody makes it there is no fact for the step to be red ABOUT.
 *
 * ⚑ **The arithmetic is identical and that is the whole reason it is here**: a step that cannot go
 * red for anybody must not count towards `appDefectOnly`, whichever way it got there. 🔴 **What
 * must not happen is the third thing** — the entry quietly reading as a deleted gesture, so that
 * the day the ruling is made nobody knows a step is waiting on it. The `why` says which kind each
 * one is, and `69b`'s names the two dispatches that have to be reconciled.
 *
 * ⚑ **Every entry names the surface and the dispatch that removed it**, so the row is a work item
 * rather than an epitaph: the day the roster (HO-022 §4) or a placement surface (`417` §11.2)
 * lands, the entry says exactly what to put back.
 *
 * 🔴 **And a withdrawn step is still RUN.** It returns `notPerformed(…)`, prints its reason on
 * every run, and is counted in the headline's own `NOT PERFORMED` cell. ⛔ Deleting it instead
 * would take the denominator with it, and `420` §4's whole rule is that an instrument may lose a
 * step but may not lose it silently.
 */
export const WITHDRAWN = {
  '69b': {
    at: '377',
    // ⚠️ **Not a surface that was deleted — a surface that started saying the opposite.** Named as
    // the writer rather than as a control, because there is no control here to bring back.
    surface: 'profile-bundle.ts’s profile-scoped AGENTS.override.md',
    // ⛔ **WHOLLY withdrawn — the step's body is `notPerformed(…)` and nothing else.** Declared
    // rather than left to a default: `riskOf` reads an absent `partial` as wholly withdrawn and
    // `step-census.test.mjs`'s `stillRuns` reads it as partial, so an entry that omits the field
    // is counted one way by the classifier and the other way by the test. `427` met that on its
    // first entry; the assertion in that file now refuses an entry that does not say.
    partial: false,
    why: 'the two halves of step 69 that 356/357 wrote — no reported instruction file is labelled `profile`, and the block states the profile layer is ABSENT. 377 (e557809) made the app author a profile instruction leaf, so a correct build now reports one. ⛔ Reconciling 377 against 356/357 is a RULING and 427 did not make it; step 69 prints what the block actually said on every run, so the decision can be made from a run',
  },
  13: {
    at: '417',
    surface: 'the launcher’s provider, profile, model and effort controls',
    // ⚠️ PARTIAL, and the row says so: the step still runs and still asserts two things (the front
    // door asks for none of the thirteen deleted hooks; the composer keeps 015's keyboard
    // contract). What went is the half its NAME was about.
    partial: true,
    why: '“pick Claude and Claude is what starts” (013), the chip following the live selection, the effort arriving as REQUESTED (024), the picker on “default” saying what a profile owns (167 §3) and send dying over “../../escape” (169 §1) — all five were claims about a control, and 417 deleted all five controls (HO-022 §2). 🔴 **THREE of those controls came back at 435** (HO-025 §5: the front door asks nothing and OFFERS EVERYTHING), so the first three claims are LIVE-ABLE again and this step does not yet make them: 435 added the presence census and left the gestures to whoever owns the instruments (435 §6). ⚑ UI-012 folded the three into ONE control, the model picker (`model-picker-face`): its list names the provider. ⛔ The profile picker is not coming back (HO-023 §2) and the folder never was, so the last two stay withdrawn for their original reason',
  },
  30: {
    at: '417',
    surface: 'plan-mode and plan-capability-note, behind the deleted Fine-tune fold',
    partial: true,
    why: 'the launcher-disclosure half — “the launcher discloses what Codex plan mode IS, before the box is ticked”. The plan DOCUMENT half is untouched and still asserted',
  },
  31: {
    at: '417',
    surface:
      'model-input, model-choices, model-say, model-remedy, profile-select, new-profile-name',
    partial: true,
    why: 'halves A and A2 — whether the launcher’s model menu came from the PROVIDER, and whether “+ New profile…” said WHY it had none (310). The wholesale-Bash-grant half is untouched. ⚑ **435 put model-input, model-choices, model-say and model-remedy back** and closed 310’s own finding that its sentence reached no screen at all — so half A is live-able again and this step’s `unasserted` names exactly what to restore. ⚑ UI-012 folded all four into the model picker’s panel (`model-picker-row`, `model-picker-said`, `model-picker-remedy`). ⛔ profile-select and new-profile-name are not coming back (HO-023 §2)',
  },
  45: {
    at: '417',
    surface: 'reasoning-effort-select, behind the deleted Fine-tune fold',
    partial: false,
    why: 'the effort menu is the provider’s levels and not three we wrote down (076). The drawer’s live-effort-select asks a related question of a RUNNING session from a pooled catalogue union, which is a different claim — 420 declined to re-point rather than re-point quietly. 🔴 **435 put reasoning-effort-select back on the front door** (HO-025 §4), and ⚑ UI-012 folded it into the model picker, whose effort levels are the picked model’s own and pooled with nothing (`model-picker-effort`) — so the original claim has a control to be made against again: this step is still `notPerformed` because nobody re-wrote it, not because its subject is gone',
  },
  46: {
    at: '417',
    surface: 'cwd-input and cwd-choose',
    partial: false,
    why: 'the cwd field refuses a forbidden folder at CHOOSE-time (076 §3). The rule is still enforced at the launch; the project sheet, the other surface that asked at choose-time, went with projects at D-016',
  },
  56: {
    at: '417',
    surface: 'ultracode, ultracode-note, ultracode-blocked',
    partial: false,
    why: 'the max-effort mode is a checkbox and not a reasoning rung, it discloses what it does, and it says why it is unavailable on a model that cannot run it (106). ⛔ There is no successor: ultracode has never had a setSessionSetting arm, by design. ⚠️ 435 brought reasoning-effort-select back (HO-025 §5), and UI-012 moved it into the model picker, so the FIRST of 106’s three claims — ultracode must not appear among that control’s options — is expressible again; the ultracode hooks themselves stay deleted and HO-025 §4 does not name them',
  },
  72: {
    at: '417',
    surface: 'the launcher draft — provider, profile and folder — and lib/launch-draft.ts itself',
    partial: false,
    why: 'an unsent launch survives leaving the page (211 §1). Three of the four fields have no control AND no stored draft; the fourth, the prompt, is PromptComposer’s own draft and is covered in the dom project',
  },
}

export const DEPARTED = {
  7: {
    at: '237',
    to: 'guarded',
    // ⚠️ The control, not the fix. 237 §4 removed the false red; what earns the BLANK is this — the
    // step may report "no reasoning this session" only while the ledger agrees there was none.
    control: "const reasoningEvents = (await ledgerRows(cdp, 'thinking')).length",
    why: '⚠️ the ban it carried was UNFALSIFIABLE, not merely wrong: it threw on any thinking-toggle, and claude/normalize.ts cannot produce one (a redacted COUNT, never a text), so it read as a passing renderer assertion while asserting nothing — and would have reddened the CORRECT renderer behaviour the day the adapter grew a text path. 237 §4 replaced it with the shape as it is on screen, plus a ledger control and an erasure control that keep the absence honest',
  },
}

/**
 * ⛔ **Every step token that has LEFT the census, and why** (237 §2).
 *
 * ⚠️ **{@link CENSUS} follows the smoke wherever it goes, so a deleted step takes its own coverage
 * out of the guard with it** — the roster shrinks, every set comparison re-derives, and the headline
 * ratio improves. That is `230` H2's shape one level up from the exposed list, and it is why
 * {@link EVER_AT_LEAST} exists rather than a second frozen roster: additions stay free, removals do
 * not.
 */
export const RETIRED = {
  20: {
    at: 'transcript-copy-removal',
    why: 'The bulk transcript-copy sweep was removed with raw_frame. Imports and rebuilds now read provider files directly; there is no sweep to exercise.',
  },
  15: {
    at: 'D-016',
    why: 'the overlays it opened — the document drawer, the all-documents sheet and the dispatch gate — drew the demo seed’s documents, and D-016 deleted the seed with every surface that drew only it. ⚠️ Its subject left the product; no other step inherits its claims',
  },
  81: {
    at: 'D-016',
    why: 'its one gesture was a person’s No on a PROJECT PROPOSAL from their queue, and D-016 deleted create_project and proposals. ⚑ Step 82 still measures a person’s take-over and press crossing real IPC on three surfaces. ⚠️ What went with it: no step now holds a settlement visible across a withheld queue look',
  },
}

/**
 * ⛔ **How many steps this census has EVER held.** `CENSUS ∪ RETIRED` may not fall below it.
 *
 * ⚠️ **A floor, not a count** — new steps push the union up and never need it touched. What it costs
 * is the one act it exists to make visible: removing a step without saying where it went. ⚑ It
 * JOINS the pre-existing `toBeGreaterThan(90)` rather than replacing it: that one is a sanity check
 * on the PARSER (a census of two tokens is a parser that stopped finding steps), this one is a
 * ratchet on the roster. The old floor had six silent deletions of slack in it; this has none.
 */
export const EVER_AT_LEAST = 97

/**
 * Every step token `ui-live-smoke.mjs` offers, in file order.
 *
 * ⛔ **The list is here so the guard has something to compare against**, and it is checked against
 * the file itself rather than trusted: `stepTokensIn` re-derives it at `pnpm run ci` time.
 */
export const CENSUS = [
  '1',
  '1w',
  '1b',
  '1b2',
  '1c',
  '1d',
  '2',
  '2b',
  '3',
  '3b',
  '4',
  '4b',
  '5',
  '5b',
  '6',
  '6b',
  '7',
  '7b',
  '7c',
  '7d',
  '7d2',
  '7e',
  '8',
  '9',
  '10',
  '11',
  '11c',
  '11b',
  '11d',
  '11e',
  '11f',
  '11g',
  '11h',
  '12',
  '13',
  '14',
  '16',
  '16b',
  '17',
  '18',
  '19',
  '19b',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '38b',
  '39',
  '40',
  '41',
  '42',
  '43',
  '44',
  '44b',
  '45',
  '46',
  '47',
  '48',
  '49',
  '50',
  '51',
  '52',
  '53',
  '54',
  '55',
  '56',
  '57',
  '58',
  '59',
  '60',
  '61',
  '62',
  '63',
  '64',
  '65',
  '66',
  '67',
  '68',
  '69',
  '69b',
  '70',
  '71',
  '72',
  '73',
  '74',
  '75',
  '76',
  '77',
  '78',
  '79',
  '80',
  '83',
  '84',
  '85',
  '86',
  '86b',
  '82',
  'zw',
]

/**
 * What a red from `token` can mean.
 *
 * ⛔ **Throws for a token the census does not know**, rather than answering `'app'`. A default that
 * silently absorbs an unknown step is how the number this file exists to state would drift upwards
 * every time somebody wrote a new one.
 *
 * ⚠️ **The three readers below take the classification as an argument, defaulted to this file's.**
 * Without that seam the arithmetic could only ever be tested against the census as it happens to
 * stand today — and every test of "an exposed step is counted against the instrument" would go
 * toothless on the day a dispatch guards the last of them, silently, with nothing to say so.
 *
 * @returns {'app' | 'guarded' | 'exposed' | 'withdrawn'}
 */
export function riskOf(token, classification = {}) {
  const { guarded = GUARDED, exposed = EXPOSED, census = CENSUS } = classification
  // ⛔ **Defaulted WITH the inventory it belongs to, not independently** — the trap
  // `censusNumbers` records a few lines below, and that an adversarial pass found there first. A
  // caller handing in its own `guarded`/`exposed` is describing a DIFFERENT census, and pairing
  // that with this module's real `WITHDRAWN` would classify a synthetic token spelled `45` as
  // withdrawn on the strength of a step it has never heard of.
  const withdrawn =
    classification.withdrawn ??
    (classification.exposed === undefined && classification.guarded === undefined ? WITHDRAWN : {})
  // ⛔ **Ahead of everything, and a PARTIAL one is not** (`420`). A wholly withdrawn step can go
  // red for nobody; a partial one still asserts something and still answers to whichever of the
  // three cells its surviving half belongs to, so only the total loss short-circuits here.
  if (Object.hasOwn(withdrawn, token) && withdrawn[token].partial !== true) return 'withdrawn'
  if (Object.hasOwn(exposed, token)) return 'exposed'
  if (Object.hasOwn(guarded, token)) return 'guarded'
  if (!census.includes(token)) {
    throw new Error(
      `step-census: "${token}" is not in the census, so what a red from it means has never been ` +
        'decided — add it to CENSUS (and to GUARDED or EXPOSED if a provider can decline its subject)',
    )
  }
  return 'app'
}

/**
 * ⛔ **§5's three numbers, computed rather than typed** (224 §5).
 *
 * `appDefectOnly` is the one the dispatch calls the instrument's real strength: how many steps can go
 * red ONLY because this app is wrong. A `guarded` step counts towards it — that is the whole point of
 * guarding it — and an `exposed` step does not.
 *
 * @param {readonly string[]} [tokens] the steps in play; defaults to the whole census
 */
export function censusNumbers(tokens = CENSUS, classification = {}) {
  const { guarded: guardedBy = GUARDED, exposed: exposedBy = EXPOSED } = classification
  // ⛔ **The baseline defaults WITH the inventory it is a baseline for, not independently.** A caller
  // that hands in its own `exposed` is describing a different census, and pairing that with this
  // module's frozen list reported the entire published inventory as departed — which would have made
  // every synthetic test in the suite read the real repository's history. ⚠️ Found by an adversarial
  // pass over this dispatch's own diff; the shape is `196`'s *"a control that measures the wrong tree"*.
  const published =
    classification.published ?? (classification.exposed === undefined ? EXPOSED_EVER : [])
  const departedBy =
    classification.departed ?? (classification.exposed === undefined ? DEPARTED : {})
  const risks = tokens.map((token) => ({ token, risk: riskOf(token, classification) }))
  const of = (risk) => risks.filter((r) => r.risk === risk).map((r) => r.token)
  const guarded = of('guarded')
  const exposed = of('exposed')
  // 🔴 **Steps that can go red for NOBODY** (`420` §4). ⛔ Out of `appDefectOnly` below, because
  // the number that sentence states is *"can go red only because this app is wrong"* and these
  // cannot go red at all.
  const withdrawn = of('withdrawn')
  // ⛔ **The only backward-looking numbers here** (237 §2). Everything above re-derives itself from
  // the classification it was handed, which is why the exposed inventory could shrink to nothing
  // with a green suite; these two compare it against what was PUBLISHED, and `unexplained` is the
  // set that shrank without anyone saying so.
  const departed = published.filter((token) => !Object.hasOwn(exposedBy, token))
  return {
    total: risks.length,
    appDefectOnly: risks.length - exposed.length - withdrawn.length,
    guarded,
    exposed,
    withdrawn,
    departed,
    unexplained: departed.filter((token) => !Object.hasOwn(departedBy, token)),
    // ⚠️ §5's *"how many are model-dependent"*. The cause is spelled `provider` because the thing
    // that declines is not always the model — a CLI that emits no `conversation_reset`, a catalogue
    // that lists three levels — and lumping those in with `reach` would make one excuse of two facts.
    modelDependent: [...guarded, ...exposed].filter(
      (token) => (exposedBy[token] ?? guardedBy[token]).cause === 'provider',
    ),
    // ⛔ 224 §4's two halves of the exposed list: the ones a later dispatch could reclassify, and
    // the ones it could not without building a control that is not there. Both are findings.
    reclassifiable: exposed.filter((token) => exposedBy[token].control === 'available'),
    blind: exposed.filter((token) => exposedBy[token].control !== 'available'),
  }
}

/**
 * ⛔ **One line under the headline saying what a red is worth** (224 §5).
 *
 * ⚠️ **It is not a fifth cell** — the dispatch is explicit that the headline gains nothing new, and
 * the four verdicts are untouched. This says what the run COULD have found, which is the question a
 * reader who did not run it is actually asking when they see `0 FAILED`.
 */
export function censusLine(tokens = CENSUS, classification = {}) {
  const n = censusNumbers(tokens, classification)
  const named = (list) => (list.length > 0 ? ` (${list.join(', ')})` : '')
  return (
    `instrument: ${n.appDefectOnly}/${n.total} step(s) can go red ONLY for an app defect · ` +
    // ⚠️ The guarded ones are COUNTED and not named, and the exposed ones are named: a reader of
    // this line is deciding how much to trust a red, and only the second list is something to act
    // on. Both are named in full in `GUARDED`/`EXPOSED` above, with a reason each.
    `${n.guarded.length} report a claim they could not reach instead · ` +
    // 🔴 **NAMED, always** (`420` §4). A withdrawn step is a capability nobody is watching, and a
    // count without the tokens is a finding nobody can act on. `0` is the ordinary answer.
    // ⚠️ **"or its answer" is not padding** (`427`). Every entry on this list used to have lost
    // its GESTURE; `69b` lost its ANSWER — the app now reports the opposite of what it asserts and
    // whether that is right is an unmade ruling. ⛔ A line that said *their subject left the
    // product* about it would be a sentence DESCRIBING the cell rather than rendering it, which is
    // standing rule 8 in the instrument's own headline. The `why` on each entry says which kind.
    (n.withdrawn.length > 0
      ? `⛔ ${n.withdrawn.length} NOT PERFORMED — their subject, or its answer, left the product${named(n.withdrawn)} · `
      : '') +
    (n.exposed.length > 0
      ? `⛔ ${n.exposed.length} still go red for a provider's choice${named(n.exposed)}, ` +
        `${n.blind.length} of them with no control to tell that from a defect`
      : 'none still goes red for a provider’s choice') +
    // ⛔ **What LEFT the published list, and by whose hand** (237 §2). ⚠️ Printed rather than left in
    // the file, for this file's own standing reason: a census with no reader is a census nobody has
    // to keep true — and a shrinking exposed list is the one movement that makes the number above
    // read better. `0` is the ordinary answer and says so.
    ` · ${n.departed.length} step(s) have left the exposed list they were frozen on` +
    (n.departed.length > 0 ? ` (${n.departed.join(', ')})` : '')
  )
}

/**
 * ⛔ **Every step token the smoke actually registers, re-derived from its source.**
 *
 * ⚠️ **The whole guard rests on this, so it REFUSES what it cannot read** rather than returning what
 * it managed. A parser that silently skipped the steps whose names are constants would report
 * a census with holes in it as complete — the same shape of failure `196` found in the
 * headline, one level down.
 *
 * Every supported call shape is resolved: a string literal on the `step(`
 * line, a string literal on the line after it, and an identifier bound to a string literal by a
 * `const` on its own line or the next.
 *
 * @param {string} source
 * @returns {{ token: string, title: string, line: number }[]} in file order
 */
export function stepTokensIn(source) {
  // ⚠️ **Comments are blanked, not dropped** — this file's prose also says `step()` in comments, and
  // a parser that read them would refuse the whole census over a sentence. Blanking keeps every line
  // number true, which is what the error above is worth quoting.
  const lines = source.split('\n').map((line) => {
    const trimmed = line.trim()
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
      ? ''
      : line
  })
  const constants = new Map()
  for (const [index, line] of lines.entries()) {
    const named = line.match(/^\s*const ([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!named) continue
    const value = literalIn(named[2]) ?? literalIn(lines[index + 1] ?? '')
    if (value !== null) constants.set(named[1], value)
  }

  const found = []
  for (const [index, line] of lines.entries()) {
    // ⚠️ **`await step(`, or `step(` opening a statement — and nothing else.** A bare `\bstep\(`
    // also matches the English inside a template literal (`${steps.length} step(s)`, line 7056),
    // which is how a parser that refuses what it cannot read refuses the whole file over a sentence.
    // The declaration of `step` itself is not a call either.
    if (/function step\(/.test(line)) continue
    const call = line.match(/(?:\bawait |^\s*)step\(\s*(.*)$/)
    if (!call) continue
    const title =
      literalIn(call[1]) ??
      identifierIn(call[1], constants) ??
      literalIn(lines[index + 1] ?? '') ??
      identifierIn(lines[index + 1] ?? '', constants)
    if (title === null) {
      throw new Error(
        `step-census: the step registered at line ${index + 1} names itself in a way this parser ` +
          `cannot read — "${line.trim().slice(0, 80)}". Every step has to be readable from the ` +
          'source, or the census silently stops covering it',
      )
    }
    found.push({ token: title.split(' ')[0], title, line: index + 1 })
  }
  return found
}

/** The first single- or double-quoted string in `text`, or null. Backticks are deliberately not a step name. */
function literalIn(text) {
  const quoted = text.match(/^\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/)
  if (!quoted) return null
  return (quoted[1] ?? quoted[2]).replace(/\\(['"])/g, '$1')
}

/** A `const`-bound step name used in place of a literal — or null when the name is not one. */
function identifierIn(text, constants) {
  const ident = text.match(/^\s*([A-Z][A-Z0-9_]*)\s*,/)
  if (!ident) return null
  return constants.get(ident[1]) ?? null
}
