import type { TranscriptEvent } from '../src/shared/conversation-events'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { TASK_IS_OPEN, givenByAConversation } from '../src/shared/tasks'
import { permissionShaped, theChannelRefusalIn } from '../src/shared/questions'
import {
  PIECES_OF_WORK,
  PROJECT_MANAGER_PROFILE_ID,
  ROOT,
  WORKER_PROFILE_ID,
  bound,
  note,
  say,
  until,
  type LifecycleRun,
  type Verdict,
} from './lifecycle-run'

/**
 * Phase `b`'s steps over one run's state: the restart over the same ledger, rows 13 to 21, and the
 * rows the kill destroyed, re-read from that ledger. The stage calls what this returns.
 */
export function phaseBOf(run: LifecycleRun): () => Promise<void> {
  const {
    store,
    host,
    claimed,
    personsAnswers,
    queueListed,
    Watcher,
    theAttentionQueue,
    pieces,
    spawnedAs,
    theFirstKept,
    theGiven,
    theReplySaid,
    theResourceSaid,
    theWorkersHelper,
    theWorkersPiece,
    toolCallsOf,
  } = run

  /**
   * 🔴 **Every step phase `a` managed to WRITE DOWN before it was killed** — which is not the same
   * set as the steps it performed, and `402` measured the gap.
   *
   * ⛔ **That run's Codex arm read `NOT REACHED` on rows 8–11 while the ledger held the evidence for
   * all four**: task #2 was `answered` and its document was in the registry — facts rows 14 and 18
   * then depended on — but phase `a` was killed *while it was still observing them*, so the notes
   * were never appended. ⚠️ A row whose observation the kill destroyed is exactly what `NOT REACHED`
   * means, and the table was right to say so; what was wrong was leaving it there when **the ledger
   * survives the kill and phase `b` can read it**. `402`'s response names this as the one follow-on
   * it did not spend another pair of live runs on.
   *
   * ⛔ **Only the steps with NO line at all are re-observed.** A step phase `a` judged is never
   * overwritten from here — the table takes the LAST line for a step, so re-judging a `FAIL` would
   * let a second look quietly upgrade a verdict the run earned.
   */
  const observedInPhaseA = new Set<string>(
    (existsSync(join(ROOT, 'journal.jsonl'))
      ? readFileSync(join(ROOT, 'journal.jsonl'), 'utf8').split('\n')
      : []
    )
      .filter((line) => line.trim() !== '')
      .flatMap((line) => {
        try {
          return [(JSON.parse(line) as { step: string }).step]
        } catch {
          return []
        }
      }),
  )

  /**
   * Re-observe one step from the ledger, and only if the kill destroyed its note.
   *
   * ⚠️ **`re-observed after the restart` is in every sentence it writes**, because a fact folded now
   * and a fact folded at the moment it happened are not the same evidence: this one cannot tell how
   * long anything took, and it is reading a database two processes have written.
   */
  const reObserve = (id: string, look: () => { verdict: Verdict; what: string } | null): void => {
    if (observedInPhaseA.has(id)) return
    const seen = look()
    if (seen === null) return
    note(id, seen.verdict, `re-observed after the restart · ${seen.what}`)
  }

  // ── phase b ──────────────────────────────────────────────────────────────────────────────
  async function phaseB(): Promise<void> {
    // ⛔ **Everything is DERIVED from the ledger, and only then compared with what phase `a`
    // wrote** — `400`'s own property: a restart re-derives, it does not restore. A phase that read
    // its ids out of a file would be asserting the file.
    // ⛔ **BroBot is derived from the PM's parent, not by profile.** A person opened it, so it has no
    // parent of its own — but the conversation that started the project manager is exactly the one
    // a person opened, and that is a fact the ledger holds rather than one this phase would
    // otherwise have to be handed.
    const fromDisk = (name: string): string | null => {
      const path = join(ROOT, name)
      return existsSync(path) ? readFileSync(path, 'utf8') : null
    }
    const pm = spawnedAs(PROJECT_MANAGER_PROFILE_ID)
    const explorer = spawnedAs(WORKER_PROFILE_ID)
    const brobot = pm === null ? null : store.parentOf(pm)
    note(
      '13 the restart re-derives the conversations from the ledger alone',
      explorer !== null &&
        explorer === fromDisk('worker.txt')?.trim() &&
        pm === fromDisk('pm.txt')?.trim()
        ? 'PASS'
        : 'FAIL',
      `derived worker ${String(explorer)} / pm ${String(pm)} / brobot ${String(brobot)}; ` +
        `phase a wrote ${String(fromDisk('worker.txt')?.trim())} / ${String(fromDisk('pm.txt')?.trim())}`,
    )
    if (explorer === null) return

    // ⛔ **The snapshot row 20 reads, taken before this phase repairs anything** — see that row.
    // ⚑ D-016 · commit 6 · work a conversation gave: a piece a person gave has no giver's ledger to
    // be named in, and its owner's turn ending leaves it waiting on them, never stalled.
    const quietAtRestart = pieces()
      .filter(givenByAConversation)
      .filter((one) => one.stalledBecause === 'turn_ended')

    // ── 14 · what the engine recorded about a kill it did not watch finish ───────────────────
    const restarted = store
      .events(explorer)
      .map((one) => one.event)
      .filter(
        (one): one is Extract<TranscriptEvent, { type: 'work_restarted' }> =>
          one.type === 'work_restarted',
      )
    // ⚑ **D-016 · the restart NAMES what it stalls**, so the row asks that the piece it stalled is
    // one the row named — a stall no restart row accounts for is not the restart's.
    const named = new Set(restarted.flatMap((one) => one.pieces ?? []))
    const stalled = store.piecesOwnedBy(explorer).filter((one) => one.state === 'stalled')
    // ⛔ **What the piece was DOING when the app died decides what this row may claim.**
    // `settleRestartedWork` appends `work_restarted` for a session holding `waiting`/`working`
    // work and for no other — so demanding the row after a kill that landed on already-stalled
    // work would be reporting a defect for the behaviour working correctly. ⚑ The state is read
    // from the handshake file phase `a` wrote, which is the runner's own note and not product
    // state; every product fact on this row is still folded from the ledger.
    const wasDriving = ['working', 'waiting'].includes(fromDisk('kill-now')?.split('\n')[2] ?? '')
    note(
      '14 the restart records what it observed, and closes nothing',
      !wasDriving
        ? 'NOT PERFORMED'
        : restarted.length === 1 &&
            stalled.some((one) => one.stalledBecause === 'app_restarted' && named.has(one.piece))
          ? 'PASS'
          : 'FAIL',
      (wasDriving
        ? ''
        : `the kill did not land mid-turn — the piece was already ` +
          `${JSON.stringify(fromDisk('kill-now')?.split('\n')[2] ?? null)}, which is a state ` +
          `settleRestartedWork correctly writes nothing for. `) +
        `${String(restarted.length)} work_restarted row(s) naming ${JSON.stringify([...named])}; ` +
        `pieces ` +
        JSON.stringify(
          store.piecesOwnedBy(explorer).map((one) => ({
            label: one.label,
            piece: one.piece,
            state: one.state,
            because: one.stalledBecause,
          })),
        ),
    )

    // ── 15 · …and the parent is TOLD, rather than left to poll ───────────────────────────────
    //
    // 🔴 **`404` moved the trigger, and this is the moment it moved it TO.** ⛔ `400` hung the push
    // off the provider PUMP — `turn` and `status` — and `402` measured what that cost: row 15 red
    // on both providers, *"1 inbound row on the pm; 'is not being worked on' ABSENT"*, beside a row
    // 14 that PASSED. ⚠️ **A conversation that is not running pumps nothing, and a restart is
    // exactly the moment nothing is running.**
    //
    // ⚑ **So the trigger is a parent BECOMING REACHABLE**, and `tellAboutWorkItGaveOut` runs from
    // `register` for every conversation this host takes up. ⛔ **The project manager therefore has
    // to be taken up for this row to be answerable at all**, and phase `b` did not do that before
    // `410`: it resumed the worker alone, so the one slot the notice needed was never live and the
    // row would have stayed red over a closed repair.
    //
    // ⚠️ **This is a PERSON reopening that conversation**, which is the only door there is — the
    // same `resumeSession` the worker goes through below. ⛔ It is not a harness hatch and it is not
    // the app resuming anything by itself: nothing in this product re-opens conversations at a
    // launch, and a run that pretended otherwise would be measuring a feature nobody built.
    void theAttentionQueue()
    let pmSink: RuntimeEventSink | null = null
    if (pm !== null) {
      try {
        pmSink = new Watcher('webContents:person-pm', true)
        await host.resumeSession(pm, pmSink)
        claimed.set(pm, pmSink)
      } catch (error) {
        say(
          `   the person could not reopen the project manager: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        )
        pmSink = null
      }
    }
    const wasToldAboutIt = (): boolean =>
      pm !== null &&
      JSON.stringify(
        store
          .events(pm)
          .map((one) => one.event)
          .filter((one) => one.type === 'message_queued' || one.type === 'user_turn'),
      ).includes('is not being worked on')
    await until('the parent to be told', bound('parentTold'), wasToldAboutIt)
    const told =
      pm === null
        ? []
        : store
            .events(pm)
            .map((one) => one.event)
            .filter((one) => one.type === 'message_queued' || one.type === 'user_turn')
    const sentences = wasToldAboutIt()
    // 🔴 **A FINDING lives in this row when it is red, and it is now a DIFFERENT finding.**
    //
    // ⛔ **Until `404` this row could not go green**: `400` predicted its own gap in writing —
    // *"`app_restarted` (launch), `message_never_sent` and app-side `conversation_ended` never
    // arrive there"* — and `402` found it live two dispatches later. ⚑ **`404` closed it**, so a red
    // row here no longer means *the app cannot do this*; it means the notice did not arrive on a run
    // where the parent was reachable, which is a regression rather than a known hole.
    note(
      '15 the parent is told, not left to find it by polling',
      pm === null ? 'NOT PERFORMED' : sentences ? 'PASS' : 'FAIL',
      pm === null
        ? 'no project manager in this ledger'
        : `${String(told.length)} inbound row(s) on the pm; "is not being worked on" ` +
            `${sentences ? 'present' : 'ABSENT'}; the person ` +
            `${pmSink === null ? 'could NOT reopen' : 'reopened'} the project manager, which is the ` +
            `moment 404 hangs the push on` +
            (sentences
              ? ''
              : ' — ⛔ 404 moved this off the provider pump and onto a parent becoming reachable; ' +
                'the parent became reachable on this run and the notice did not arrive'),
    )

    // ── 16 · the work is still open, and the parent can still finish it ──────────────────────
    const openAfter = store.piecesOwnedBy(explorer).filter((one) => TASK_IS_OPEN[one.state])
    note(
      '16 nothing the engine did not watch finish was closed',
      openAfter.length > 0 ? 'PASS' : 'FAIL',
      `${String(openAfter.length)} open piece(s) after the restart: ` +
        JSON.stringify(openAfter.map((one) => `${one.label} ${one.state}`)),
    )

    // ── the rows the kill destroyed, re-read from the ledger that survived it ────────────────
    //
    // ⛔ **`402`'s own follow-on, and it changes what the table means for the cheaper provider.**
    // See {@link observedInPhaseA}: the middle of the diagram HAPPENED on that run and five rows
    // read `NOT REACHED` because the process holding the pen was killed. ⚠️ Everything below is
    // folded from the same store phase `a` folded, so the facts are the same facts; what is lost is
    // the timing, and every sentence says so.
    const worked = store.piecesOwnedBy(explorer)
    const finishedFirst = worked.find((one) => one.state === 'answered') ?? null
    const keptFirst = finishedFirst === null ? null : theFirstKept(finishedFirst)
    if (pm !== null) {
      reObserve('4 the project manager gives a new worker its piece, at depth 2', () =>
        theWorkersPiece(pm, theGiven(pm, brobot).at(0) ?? null),
      )
    }
    reObserve('6 the worker gives a new helper a piece, at depth 3', () =>
      theWorkersHelper(explorer),
    )
    reObserve('8 a question is routed to the parent, not to a person', () => {
      const question =
        store.routedRequestsOf(explorer).find((one) => one.went.to === 'the-parent') ?? null
      return {
        verdict: question !== null && question.parent === pm ? 'PASS' : 'NOT PERFORMED',
        what:
          question === null
            ? // 🔴 **445 · the clause that used to sit here named a PROVIDER and it expired at
              // `437`.** It read *"v3: Codex raises no question from a spawned worker, recorded and
              // not a pass"*, which is true of `item/tool/requestUserInput` and false of
              // `ask_parent` (`ask_question` since D-009). ⚑ What an empty result means now is the
              // same on both arms.
              `the worker asked its parent nothing — it called ` +
              `${JSON.stringify(toolCallsOf(explorer))}, and criterion 29 turns on whether ` +
              `ask_question is among them`
            : `${question.requestId} → ${question.went.to} (${String(question.parent)}), refusal ` +
              JSON.stringify(question.went),
      }
    })
    reObserve('8b the parent answers it and the child carries on', () => {
      const question =
        store.routedRequestsOf(explorer).find((one) => one.went.to === 'the-parent') ?? null
      if (question === null) return { verdict: 'NOT PERFORMED', what: 'no question was routed' }
      return {
        verdict: question.state === 'answered' ? 'PASS' : 'NOT PERFORMED',
        what: `state ${question.state}`,
      }
    })
    reObserve('9 the worker replies with an outcome and a resource, kept as a resource', () => ({
      verdict:
        finishedFirst !== null && keptFirst !== null && finishedFirst.needsUserAction
          ? 'PASS'
          : finishedFirst !== null
            ? 'FAIL'
            : 'NOT PERFORMED',
      what:
        finishedFirst === null
          ? 'no piece on the worker reached `answered`'
          : theReplySaid(finishedFirst, keptFirst),
    }))
    reObserve(
      '9b the reply a parent reads is the app’s own, and it carries what the child claimed',
      () => {
        if (pm === null)
          return { verdict: 'NOT PERFORMED', what: 'no project manager in this ledger' }
        const turns = store
          .events(pm)
          .map((one) => one.event)
          .filter(
            (one): one is Extract<TranscriptEvent, { type: 'user_turn' }> =>
              one.type === 'user_turn',
          )
        const ours = turns.filter(
          (one) => one.attribution === 'app_authored' && one.work !== undefined,
        )
        const claimed = ours.filter((one) => one.work?.needsUserAction === true)
        // ⚛ The same conditional as the phase `a` row above, read from the ledger: the premise
        // is whether any piece the worker answered carried the claim at all.
        const anyClaim = worked.some((one) => one.needsUserAction)
        return {
          verdict: ours.length > 0 && (!anyClaim || claimed.length > 0) ? 'PASS' : 'FAIL',
          what:
            `${String(ours.length)} app_authored turn(s) carrying a work report, ` +
            `${String(claimed.length)} carrying the child’s needs_user_action; ` +
            `${String(turns.filter((one) => one.attribution === undefined).length)} unattributed`,
        }
      },
    )
    reObserve('10 the parent reads the resource it was handed an id for', () => {
      if (pm === null || keptFirst === null)
        return { verdict: 'NOT PERFORMED', what: 'no resource to read' }
      const pulled = toolCallsOf(pm).some((name) => name.includes('read_document'))
      const read = theResourceSaid(keptFirst)
      return {
        verdict: pulled && read.carried ? 'PASS' : 'NOT PERFORMED',
        what: `the pm ${pulled ? 'called' : 'never called'} read_document; ${read.what}`,
      }
    })
    reObserve('11 the project manager gives the worker a second piece', () => ({
      verdict: worked.length > 1 ? 'PASS' : 'NOT PERFORMED',
      what:
        `${String(worked.length)} piece(s) on the worker: ` +
        JSON.stringify(worked.map((one) => `${one.label} ${one.state}`)),
    }))

    // ── 17 · the conversation resumes and the work can be finished ───────────────────────────
    //
    // ⛔ **The person watches in this phase too, and leaving it out cost a whole run.** A resumed
    // worker's next tool call parks on a card exactly as it did before the kill; without the loop
    // the send below is answered by nobody and step 18 reports a model that declined to finish
    // work it was in fact blocked on. ⚑ Ownership is not the same question: `resumeSession` makes
    // this sink the owner, which is what makes the answer ALLOWED — somebody still has to give it.
    // ⚑ **Started further up, before the project manager was reopened** (410): a parent that comes
    // back mid-card needs somebody looking at it too, and starting the loop here left the window
    // between the two resumes unwatched.
    const resumedSink = new Watcher('webContents:2', true)
    let resumed = false
    try {
      await host.resumeSession(explorer, resumedSink)
      // ⛔ **The resume made this sink the OWNER** — see `personAnswersOne`. Without this line the
      // attention loop is refused on every pass and the resumed worker never gets its card answered.
      claimed.set(explorer, resumedSink)
      resumed = true
    } catch (error) {
      // ⛔ **The roster's id, verbatim, on BOTH branches.** A failure written under a shorter name
      // lands in the table's `extra` block — printed, but not against the row it is about, so the
      // diagram row it failed reads `NOT REACHED` beside it. Found reviewing this file rather than
      // by running it.
      note(
        '17 the killed conversation reopens on the same thread',
        'FAIL',
        error instanceof Error ? error.message : String(error),
      )
    }
    if (!resumed) return
    const stillOpen = openAfter.at(-1)
    note(
      '17 the killed conversation reopens on the same thread',
      'PASS',
      `${explorer} reopened; ${stillOpen === undefined ? 'nothing' : stillOpen.label} still open`,
    )

    if (stillOpen !== undefined) {
      // 🔴 **412 · the id came OUT of this nudge, and that is the measurement** (HO-020 §5.3).
      // ⛔ `410`'s first Claude run only finished because this line quoted the task's id for the
      // model — *"if the runner still supplies the id, the run proves the runner rather than the
      // product"*, the same trap `410` §3 caught with the seed. ⚑ The worker now has two honest
      // routes to the piece and both are the product's: the turn that gave it the work names its
      // label ({@link messageNamingThePiece}), and `list_tasks` lists it.
      // ⚠️ **The outcome word stays.** `402` F5 measured a worker obeying the diagram's `warnings`
      // and being refused `malformed-request`; naming a word the tool takes is not naming the piece.
      await host.send(
        explorer,
        'The app was restarted while you were working. Finish the piece of work you were given: ' +
          'write retest.md in your working directory, then finish it with reply_to_parent and ' +
          'outcome `done`.',
        resumedSink,
      )
      const finished = await until('the worker to finish', bound('resumeFinish'), () =>
        store
          .piecesOwnedBy(explorer)
          .some((one) => one.piece === stillOpen.piece && one.state === 'answered'),
      )
      const done = store.piecesOwnedBy(explorer).find((one) => one.piece === stillOpen.piece)
      note(
        '18 the work the restart left open is finished afterwards',
        finished && done?.state === 'answered' ? 'PASS' : finished ? 'FAIL' : 'NOT PERFORMED',
        `${stillOpen.label} is ${String(done?.state)}, outcome ${String(done?.outcome)}`,
      )
    }

    // ── 18 · and the chain ends where it started ─────────────────────────────────────────────
    //
    // ⛔ **The piece BroBot GAVE, not the work BroBot holds.** BroBot holds its own root, which a
    // person gave it and which no reply answers (D-016 · R1) — so what *"the final reply reaches
    // BroBot"* means is that the piece BroBot gave the project manager is answered. ⚠️ Reading
    // `piecesOwnedBy(brobot)` would ask about work given TO it and answer `NOT PERFORMED` for every
    // healthy run.
    // ⛔ **The conversation the PERSON started, reopened by the person** — the last hop of v3 is
    // `E-->>B: header` and `B-->>U: digest`, and a BroBot nothing has taken up receives neither.
    // ⚠️ `402` reported this row NOT PERFORMED on both providers, and its own reading is the right
    // one — the project manager's turn had ended before it replied — but the rig also never gave
    // BroBot a slot to be replied INTO. ⚑ Reopening it separates the two, so a red row after this
    // is about the chain and not about the instrument.
    if (brobot !== null && !claimed.has(brobot)) {
      try {
        const brobotSink = new Watcher('webContents:person-brobot', true)
        await host.resumeSession(brobot, brobotSink)
        claimed.set(brobot, brobotSink)
      } catch (error) {
        say(
          `   the person could not reopen BroBot: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    const given = pm === null ? [] : theGiven(pm, brobot)
    const homeAgain = await until(
      'the project manager to reply to BroBot',
      bound('parentReplies'),
      () => pm !== null && theGiven(pm, brobot).some((one) => one.state === 'answered'),
    )
    const closed = pm === null ? [] : theGiven(pm, brobot).filter((one) => one.state === 'answered')
    // ── 19 · the diagram's stale note, performed as HO-018 amended it ───────────────────────
    //
    // ⛔ **The note on the diagram says *"turn ends with no reply, or idles past timeout: task
    // fails, PM is told"*, and every clause of it is now wrong** (402 §3.1, HO-018 §2.1/§2.2):
    // there is no idle timeout at all, and a turn ending with the piece open does not FAIL it — it
    // marks `stalled`, a condition on an OPEN piece, and pushes that to its giver. ⚑ This row is
    // the amended behaviour, wherever in the run it happened to occur, and it is the one row that
    // performs `400` through a real provider rather than through a fake runtime.
    // 🔴 **Read BEFORE row 18 answers it, because answering it is what erases the evidence.**
    //
    // ⛔ **Measured on 410's first Codex run**: row 14 reported task #2 `stalled` `because
    // turn_ended` and row 20, eight rows later, reported *"no turn in this run ended with its work
    // still open"* — about the same task. ⚠️ Row 18 had answered it in between, and an `answered`
    // piece carries no stall cause, so the fold found nothing and said the amended note was never
    // reached. ⚑ **A later step that repairs the thing an earlier one measures hides it**, and the
    // fix is to take the reading in the gap rather than after the repair.
    const endedQuiet = quietAtRestart
    const toldAbout = endedQuiet.filter((one) =>
      JSON.stringify(store.events(one.giver).map((entry) => entry.event)).includes(one.piece),
    )
    note(
      '20 a turn that ended with the work open stalled it and told the parent',
      endedQuiet.length === 0
        ? 'NOT PERFORMED'
        : toldAbout.length === endedQuiet.length && endedQuiet.every((one) => one.endedAt === null)
          ? 'PASS'
          : 'FAIL',
      endedQuiet.length === 0
        ? 'no turn in this run ended with its work still open, so the amended note was not reached'
        : `${String(endedQuiet.length)} piece(s) stalled on turn_ended, ${String(toldAbout.length)} ` +
            `named in their giver's own ledger, all still open (no endedAt): ` +
            JSON.stringify(endedQuiet.map((one) => `${one.label} ${one.state}`)),
    )

    // ── 21 · the count HO-020 was about ─────────────────────────────────────────────────────
    //
    // 🔴 **`412` measured SEVEN tasks for three pieces of work on a run that was otherwise 26/26**,
    // because `workBeingAssigned` asked one question — is the caller an agent — and answered *this
    // is work* for every message that was. ⛔ **The cascade is a COUNT**, so the row that would have
    // caught it is a count: four gives are asked for in this run — BroBot's to the project manager,
    // the project manager's two to the worker, and the worker's to its helper — and every piece in
    // the run should be one of them. ⚑ Since D-016 only a give opens a piece, so this row now
    // guards the give against opening one it was not asked for.
    //
    // ⚠️ **Computed from the outcome and not from the plan** (§13). A run that did not reach the
    // last give has FEWER, which is a row above this one already red; a run with MORE is the
    // defect this row exists to catch, and the titles are printed so a reader can see what the
    // extra one was.
    const everyPiece = pieces()
    note(
      '21 the run holds exactly the pieces its briefs hand out',
      everyPiece.length === PIECES_OF_WORK
        ? 'PASS'
        : everyPiece.length < PIECES_OF_WORK
          ? 'NOT PERFORMED'
          : 'FAIL',
      `${String(everyPiece.length)} piece(s) for ${String(PIECES_OF_WORK)} give(s) in the briefs: ` +
        JSON.stringify(
          everyPiece.map(
            (one) => `${one.label} ${one.state} · ${one.title.replace(/\s+/g, ' ').slice(0, 48)}`,
          ),
        ),
    )

    note(
      '19 the final reply reaches BroBot',
      homeAgain && closed.length > 0 ? 'PASS' : given.length > 0 ? 'NOT PERFORMED' : 'FAIL',
      pm === null
        ? 'no project manager in this ledger'
        : `${String(closed.length)} of ${String(given.length)} piece(s) BroBot gave the pm are ` +
            `answered: ` +
            JSON.stringify(theGiven(pm, brobot).map((one) => `${one.label} ${one.state}`)),
    )

    // ── the person's two rows, re-read LAST, because the kill can land inside them ───────────
    //
    // 🔴 **445 · found by this run's own first Codex arm, and it is the defect `402` predicted.**
    //
    // ⛔ **Rows 7 and 7b read `NOT REACHED` on a run whose ledger holds six answered permissions
    // on the worker.** ⚠️ Phase `a`'s serial body was parked in row 6's wait when the kill landed —
    // that wait could not succeed, which is the OTHER defect this run found — and
    // {@link observedInPhaseA} had no re-observer for either row. ⛔ *"A row whose observation the
    // kill destroyed is what NOT REACHED means; what is wrong is leaving it there when the ledger
    // survives the kill."*
    //
    // ⚑ **Re-read at the END of phase `b` and nowhere earlier, and the position is load-bearing for
    // 7b.** Row 7 is a fold and could be read anywhere; 7b reads the app's own person-facing
    // READERS, which answer about cards that are waiting NOW — so it has to be asked after phase
    // `b`'s own attention queue has met the resumed worker's cards, which is after row 18.
    reObserve('7 a permission goes to a person, and a person answers it', () => {
      const workersCards = personsAnswers.filter((one) => one.session === explorer)
      const routedRight = store
        .routedRequestsOf(explorer)
        .filter((one) => one.went.is === 'the-person-the-channel-left-it-with')
      const settled = permissionShaped(store.routedRequestsOf(explorer)).filter(
        (one) => one.went.to === 'a-person' && one.state !== 'open',
      )
      return {
        verdict:
          settled.length > 0 && routedRight.every((one) => one.went.to === 'a-person')
            ? 'PASS'
            : routedRight.length > 0
              ? 'FAIL'
              : 'NOT PERFORMED',
        what:
          `${String(settled.length)} permission(s) on ${explorer} went to a person and are ` +
          `settled (${String(workersCards.length)} of them answered by THIS phase's person); ` +
          `every permission-shaped routing went to ` +
          `${JSON.stringify([...new Set(routedRight.map((one) => one.went.to))])}, because ` +
          JSON.stringify([...new Set(routedRight.map((one) => theChannelRefusalIn(one)))]),
      }
    })
    reObserve('7b the queue a person reads lists what only a person can answer', () => {
      // ⛔ **A phase-`b` measurement and not a ledger fold, and the sentence has to say so.** ⚠️ It
      // cannot speak for the cards phase `a` answered: `questionsForAPerson` and
      // `decisionsForAPerson` answer about what is WAITING, and everything phase `a` raised was
      // settled before it died. ⚑ What it can say is whether the readers saw the cards THIS phase's
      // worker raised, which is the same question asked of the same two readers.
      if (personsAnswers.length === 0) {
        return {
          verdict: 'NOT PERFORMED',
          what: 'no permission needed a person in phase b, so its readers were never asked',
        }
      }
      return {
        verdict: queueListed.size === 0 ? 'FAIL' : 'PASS',
        what:
          `${String(personsAnswers.length)} permission(s) needed a person in PHASE B; the ` +
          `person's own readers listed ${String(queueListed.size)} of them`,
      }
    })
  }

  return phaseB
}
