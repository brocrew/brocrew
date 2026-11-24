import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { PieceRow } from '../src/shared/task-contracts'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { DEFAULT_PROFILE_ID } from '../src/shared/runtime-ipc'
import { theChannelRefusalIn } from '../src/shared/questions'
import {
  CLI_SUB_AGENT_TOOLS,
  HELPER_PROFILE_ID,
  MODEL,
  PROJECT_MANAGER_PROFILE_ID,
  PROVIDER,
  ROOT,
  WORKER_PROFILE_ID,
  bound,
  note,
  noteChoice,
  personsBrief,
  until,
  type LifecycleRun,
} from './lifecycle-run'

/**
 * ⛔ **How long the kill window holds out for the SECOND piece before taking the first.**
 *
 * ⚠️ Long enough for a healthy chain to reach the second piece — a reply, a resource, a
 * `read_document` and a give, which measured between two and five minutes on both providers when the
 * give was a `message_agent` — and short enough that a chain which stalls still gets its restart
 * performed rather than reported as unreached.
 */
const PREFER_THE_SECOND_MS = 420_000

/**
 * Phase `a`'s steps over one run's state: rows 1 to 11b, then the wait for the kill. The stage
 * calls what this returns, and the runner kills the process inside it.
 */
export function phaseAOf(run: LifecycleRun): () => Promise<void> {
  const {
    store,
    host,
    work,
    person,
    claimed,
    personsAnswers,
    queueListed,
    Watcher,
    theAttentionQueue,
    createdByRow,
    depthOf,
    identityRow,
    pieces,
    sessionsNow,
    spawnedAs,
    subAgentToolsOf,
    theFirstKept,
    theGiven,
    theReplySaid,
    theResourceSaid,
    theWorkersHelper,
    theWorkersPiece,
    toolCallsOf,
    whereItSits,
  } = run

  // ── phase a ──────────────────────────────────────────────────────────────────────────────
  async function phaseA(): Promise<void> {
    writeFileSync(join(ROOT, 'journal.jsonl'), '')

    // ── 1 · BroBot ships with nothing a person set up ───────────────────────────────────────
    //
    // 🔴 **Tier 1 needs no setup** (HO-016 §2 — *"a person granting it by hand is a setup step
    // nobody should have to know about"*): no identity row exists before BroBot's first
    // conversation, and that conversation is the whole of what the app requires.
    //
    // ⛔ **669 · R17: and there is no tier-2 setup either.** Every tier may give any agent work and
    // bring a new one into existence to take it (D-016), so each tier gives the one below it its
    // piece, which rows 2, 4 and 6 perform, and this run sets up nothing for anybody.
    const beforeFirstConversation = store.agentIdentityOf(DEFAULT_PROFILE_ID)

    // ⛔ **BroBot's first conversation, and it is NOT a setup step** — it is how BroBot's identity row
    // comes into being at all, which on a fresh `userData` has never happened: the one migration
    // seeds the app's policy row and no `agent_identity` row. ⚑ **The row rides in on
    // `store.create`**, so opening BroBot once is the whole of what
    // the app requires, and a person who has ever talked to BroBot has already done it.
    const firstBroBot = await host.createSession(
      {
        provider: PROVIDER,
        profileId: DEFAULT_PROFILE_ID,
        cwd: work,
        model: MODEL,
      },
      person,
    )
    await host.close(firstBroBot.sessionId, person)
    // ⛔ **What a fresh install ships, read before any model has had a turn** — row 1b's only window.
    // ⚠️ Every agent may create an identity, so read after the ticket's first turn a correct install
    // could read as shipping two.
    const shippedIdentities = store.agentIdentities().map((one) => one.slug)
    const projectManagerShipped = store.agentIdentityOf(PROJECT_MANAGER_PROFILE_ID) !== null

    // ⚑ BroBot's row exists only because its first conversation ran, and no person wrote anything.
    const brobotRow = identityRow(DEFAULT_PROFILE_ID)
    note(
      '1 BroBot needs no setup',
      beforeFirstConversation === null && brobotRow !== null ? 'PASS' : 'FAIL',
      `${DEFAULT_PROFILE_ID} had ${beforeFirstConversation === null ? 'no row' : 'A ROW'} before its ` +
        `first conversation and ${brobotRow === null ? 'NO ROW' : 'a row'} after it. No person ` +
        `set anything up in this run`,
    )

    // ── 1b · a fresh install ships BroBot and no other identity ──────────────────────────────
    //
    // 🔴 **669 · R17, re-aimed.** `HO-078` §1: *"A fresh install ships `brobot` and no other
    // identity."* ⚑ So the row asks exactly that, of the database as BroBot's FIRST conversation left
    // it — before any model has had a turn: one row, BroBot's, and none for the name the diagram's
    // project manager will have.
    note(
      '1b a fresh install ships BroBot and no other identity',
      isDeepStrictEqual(shippedIdentities, [DEFAULT_PROFILE_ID]) && !projectManagerShipped
        ? 'PASS'
        : 'FAIL',
      `the database held ${JSON.stringify(shippedIdentities)} after BroBot's first ` +
        `conversation; ${PROJECT_MANAGER_PROFILE_ID} has ${projectManagerShipped ? 'A ROW' : 'no row'}`,
    )

    // ── 2 · the person opens BroBot and hands over the ticket ────────────────────────────────
    const brobot = await host.createSession(
      {
        provider: PROVIDER,
        // ⛔ 665 · R15: this read `'default'` — BroBot's slug until `592`, and since then a NEW,
        // ungranted identity this line alone brought into being, beside a handshake that already
        // ran as BroBot. ⚑ The person opens BroBot, so it is BroBot's own constant.
        // ⚑ 669 · R17: and BroBot now CREATES the project manager it gives the ticket to — row 2,
        // by that give itself since D-016. NOT RUN.
        profileId: DEFAULT_PROFILE_ID,
        // ⚑ Every agent BroBot starts runs in its parent's folder unless it names one (D-016), so
        // the whole tree works in `work`.
        cwd: work,
        model: MODEL,
        // 🔴 **`ask`, the mode this app ships as its default, and said out loud — it is the whole
        // tree's.** A give takes no mode: the conversation it starts runs in its giver's (499,
        // HO-036), so this line decides the mode of every conversation below BroBot. ⛔ **`auto`
        // here made the whole tree `auto`**, so no card would ever reach the person and rows 7 and
        // 7b could never be performed. ⚑ BroBot's own cards — its give first among them, which
        // starts something outside this app — are the person's own conversation's, and the loop
        // answers them there like any other.
        approvalMode: 'ask',
      },
      person,
    )
    // ⚑ **The person already owns this one**, so the loop answers on it rather than claiming it.
    claimed.set(brobot.sessionId, person)
    writeFileSync(join(ROOT, 'brobot.txt'), brobot.sessionId)
    // ⛔ **The person starts watching BEFORE the first message**, because the first card can arrive
    // inside the first turn and a person who starts looking afterwards has already stalled the run.
    void theAttentionQueue()
    const before = new Set(sessionsNow())
    await host.send(brobot.sessionId, personsBrief(), person)

    // ── 1c · the three tiers, read once all three exist ─────────────────────────────────────
    //
    // ⚑ **Every launch keeps the CLI's own sub-agents.** It reads that the three identities exist in
    // this run's own database, and each tier's newest published tool inventory for
    // {@link CLI_SUB_AGENT_TOOLS}. ⚠️ Codex publishes no inventory, so
    // there the second half reads `null`, and the row is NOT PERFORMED rather than a PASS over nothing.
    //
    // 🔴 **669 · R17: read AFTER the tiers are created, not before the ticket**, because two of the
    // three do not exist until the tier above creates them — and written on EVERY path past row 2
    // (`noteTheTiers` is called where the stage would otherwise return). ⚠️ A tier the run never
    // created is NOT PERFORMED, not a FAIL (the `669` review).
    const noteTheTiers = (): void => {
      const slugs = [DEFAULT_PROFILE_ID, PROJECT_MANAGER_PROFILE_ID, WORKER_PROFILE_ID]
      const rows = slugs.map((slug) => identityRow(slug))
      const tiers = slugs.map((slug) => ({ slug, subAgents: subAgentToolsOf(slug) }))
      const evidence =
        JSON.stringify(tiers) +
        (tiers.some((tier) => tier.subAgents === null)
          ? ' \u2014 a null sub-agent list is a launch that published no tool inventory, so the ' +
            'tools half was not measured for that tier'
          : '')
      if (rows.some((row) => row === null)) {
        noteChoice(
          '1c every tier keeps the provider’s own sub-agents',
          `a tier was never created: ${evidence}`,
        )
        return
      }
      // ⛔ **A tier whose tools could not be read is not a PASS of the tools half**: a Codex launch
      // publishes no inventory, so there the row is NOT PERFORMED. A tier that published some but
      // not all three is a FAIL.
      const keepsThem = (tier: (typeof tiers)[number]): boolean =>
        tier.subAgents !== null &&
        CLI_SUB_AGENT_TOOLS.every((name) => tier.subAgents?.includes(name))
      note(
        '1c every tier keeps the provider’s own sub-agents',
        tiers.some((tier) => tier.subAgents !== null && !keepsThem(tier))
          ? 'FAIL'
          : tiers.every(keepsThem)
            ? 'PASS'
            : 'NOT PERFORMED',
        evidence,
      )
    }

    // ── 2 · BroBot gives a new project manager the ticket, at depth 1 ───────────────────────
    //
    // 🔴 **D-016 · one give, where `669` performed two rows.** Bringing the project manager into
    // existence, starting its conversation and handing it the ticket are one act, so they are one
    // row, and it waits for the piece — which is written once the brief has reached the conversation.
    const gaveTheTicket = await until(
      'the project manager to hold the ticket',
      bound('pmGive'),
      () => {
        const started = spawnedAs(PROJECT_MANAGER_PROFILE_ID)
        return (
          started !== null &&
          sessionsNow().some((id) => !before.has(id)) &&
          theGiven(started, brobot.sessionId).length > 0
        )
      },
    )
    const pm = spawnedAs(PROJECT_MANAGER_PROFILE_ID)
    const pmParent = pm === null ? null : store.parentOf(pm)
    const ticket = pm === null ? null : (theGiven(pm, brobot.sessionId).at(0) ?? null)
    // 🔴 **669 · R17: the identity it started is one it CREATED** — a fresh install ships no project
    // manager to start. ⛔ A project manager that existed some other way would mean this run rebuilt
    // the product it remembers: that is a FAIL.
    const pmCreatedBy = createdByRow(PROJECT_MANAGER_PROFILE_ID)
    const createdByBroBot = isDeepStrictEqual(pmCreatedBy, {
      by: 'an-agent',
      agent: DEFAULT_PROFILE_ID,
    })
    const pmAppShaped =
      gaveTheTicket &&
      pm !== null &&
      pmParent === brobot.sessionId &&
      ticket !== null &&
      depthOf(ticket.piece) === 1 &&
      createdByBroBot
    note(
      '2 BroBot gives a new project manager the ticket, at depth 1',
      pmAppShaped ? 'PASS' : pm !== null ? 'FAIL' : 'NOT PERFORMED',
      pm === null
        ? `no conversation ran as \`${PROJECT_MANAGER_PROFILE_ID}\`; BroBot called ` +
            `${JSON.stringify(toolCallsOf(brobot.sessionId))}`
        : `${pm}, started by ${String(pmParent)}, holds ${whereItSits(ticket)}; its identity ` +
            `created by ${JSON.stringify(pmCreatedBy)}`,
    )
    if (pm === null) {
      // ⚠️ 1c is written on EVERY path past row 2, so a tier the run never created reads NOT
      // PERFORMED rather than NOT REACHED (the `669` review's second round).
      noteTheTiers()
      return await parkForTheKill('no project manager to work through')
    }

    // ── 4 · the project manager gives a new worker its piece, at depth 2 ─────────────────────
    await until('the worker to hold its piece', bound('workerGive'), () => {
      const started = spawnedAs(WORKER_PROFILE_ID)
      return started !== null && theGiven(started, pm).length > 0
    })
    const theWorker = theWorkersPiece(pm, ticket)
    note(
      '4 the project manager gives a new worker its piece, at depth 2',
      theWorker.verdict,
      theWorker.what,
    )
    const explorer = spawnedAs(WORKER_PROFILE_ID)
    const first = explorer === null ? null : (theGiven(explorer, pm).at(0) ?? null)

    noteTheTiers()
    if (explorer === null) return await parkForTheKill('no worker to be mid-turn')
    writeFileSync(join(ROOT, 'worker.txt'), explorer)
    writeFileSync(join(ROOT, 'pm.txt'), pm)

    // 🔴 **The kill window is ONE TURN WIDE and it opens here — two live runs taught me both halves.**
    //
    // ⛔ **First lesson: it closes while you are looking somewhere else.** The first design waited
    // for a second task and then looked for something open, and got `2 task(s) on the worker, none
    // open` — the project manager had read the document, given task 002 and had it answered *while
    // row 10 was still awaiting `read_document`*. A window that closes inside another row's `await`
    // cannot be waited for in sequence.
    //
    // 🔴 **Second lesson: a piece that stalled stays stalled until its owner is DRIVEN again.** A
    // turn that ends with the work open marks the piece `stalled`; `400` ruled that *"no row in the
    // ledger says this task is being worked on again"*, and since D-005 one does: a turn delivered
    // to the worker that names that piece, or names none (a person typing, a note about nothing),
    // puts it back to `working`, and nothing else does — per piece since D-016 · commit 6, so the
    // project manager's next give, whose brief names only the piece it gives, does not. ⛔ **So once
    // a piece stalls, its window stays shut until something drives it**, and a watcher armed after
    // the first reply can wait for a state nothing will produce. Measured before D-005: `no task on
    // sess_a6 was ever working after its first reply`.
    //
    // ⚑ **So it is armed the moment the worker's first piece exists, and its predicate is `waiting`
    // OR `working`** — exactly the two states `settleRestartedWork` writes a row for, read from the
    // same {@link TASK_IS_OPEN} table minus the one that means nobody is driving it. ⚠️ Row `11b`
    // names which piece the kill landed on, so a reader always knows whether the restart interrupted
    // the first piece of work or the second.
    let signalled: PieceRow | null = null
    let putThereBy = 'the project manager'
    /**
     * ⛔ **It PREFERS the second piece and settles for the first, and both halves were measured.**
     *
     * ⚠️ Armed with no preference it fires on the first piece's very first turn — the middle of the
     * diagram never happens, and the table reads `NOT REACHED` from the helper to the pull. ⚠️ Armed
     * only on the second piece it may never fire at all, because a worker whose turn ends leaves
     * `stalled` work that only a turn delivered to it drives again (D-005). ⚑ So: hold for
     * {@link PREFER_THE_SECOND_MS}
     * hoping the chain reaches the second piece, then take whatever is still being driven — and
     * **name which**, so a reader always knows whether the restart interrupted the first piece of
     * work or the second.
     */
    const firstPiece = first?.piece ?? null
    const theKillWindow = async (): Promise<void> => {
      const preferUntil = Date.now() + PREFER_THE_SECOND_MS
      while (signalled === null && run.watching) {
        const driving = pieces().filter(
          (one) => one.owner === explorer && (one.state === 'working' || one.state === 'waiting'),
        )
        const second = driving.find((one) => one.piece !== firstPiece)
        const take = second ?? (Date.now() > preferUntil ? driving[0] : undefined)
        if (take !== undefined) {
          signalled = take
          writeFileSync(join(ROOT, 'kill-now'), `${take.label}\n${explorer}\n${take.state}\n`)
          note(
            '11b the worker has open work and the runner has been signalled',
            'PASS',
            `${take.label} (${take.piece}) is ${take.state} on ${explorer}, put there by ` +
              putThereBy +
              (second === undefined
                ? ` — the SECOND piece never came, so the restart interrupts the first`
                : ''),
          )
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
    void theKillWindow()

    // ── 6 · the worker gives a new helper a piece, one level below its own ─────────────────────
    //
    // ⚑ **No depth bound refuses a give**, so the worker at depth 2 may give work at depth 3. ⛔ v3's `W->>E: spawn_agent helper` → *refused, max_depth*
    // is no longer the product, and this row measures what is.
    //
    // ⚠️ **A refusal on the way is still read off the app's own row** — `tool_refused` (`405`), with
    // its rail, permanence and retryability — so a rail that stopped the worker is named in the
    // evidence. It waits for the HELPER'S PIECE and not for the call, because the call and what came
    // of it are separate appends (`410`'s false red).
    await until('the worker to give a helper a piece', bound('helperGive'), () => {
      const helper = spawnedAs(HELPER_PROFILE_ID)
      return helper !== null && theGiven(helper, explorer).length > 0
    })
    const helped = theWorkersHelper(explorer)
    note('6 the worker gives a new helper a piece, at depth 3', helped.verdict, helped.what)

    // ── 8 · a permission goes to the person ──────────────────────────────────────────────────
    //
    // ⛔ **Answered by the loop above, which is the app's own door**: a person claims the
    // conversation and answers on it. `assertMayAnswer` refuses a sink that is not a person, so a
    // PASS here is the app agreeing that the answer came from one.
    await until('a permission the worker raised, answered by a person', bound('permission'), () =>
      personsAnswers.some((one) => one.session === explorer),
    )
    const workersCards = personsAnswers.filter((one) => one.session === explorer)
    const routedRight = store
      .routedRequestsOf(explorer)
      .filter((one) => one.went.is === 'the-person-the-channel-left-it-with')
    note(
      '7 a permission goes to a person, and a person answers it',
      workersCards.length > 0 && routedRight.every((one) => one.went.to === 'a-person')
        ? 'PASS'
        : personsAnswers.length > 0
          ? 'NOT PERFORMED'
          : 'FAIL',
      workersCards.length === 0
        ? `the worker raised no permission; the person answered ${String(personsAnswers.length)} ` +
            `elsewhere: ${JSON.stringify(personsAnswers.map((one) => `${one.session}:${one.because}`))}`
        : `${String(workersCards.length)} card(s) on ${explorer}, every permission-shaped routing ` +
            `went to ${JSON.stringify([...new Set(routedRight.map((one) => one.went.to))])}, because ` +
            JSON.stringify([...new Set(routedRight.map((one) => theChannelRefusalIn(one)))]),
    )
    // ⛔ **A FINDING, and the runner is what surfaces it** (§4: report it, do not fix it).
    //
    // ⚠️ **The cards above are found by folding the ledger; this row asks whether the app's own
    // READERS see the same thing.** ⛔ It was FAIL on both of `402`'s final runs because there was
    // one reader and it was `questionsForAPerson`, which cannot admit a permission by construction.
    // ⚑ **`403` added `decisionsForAPerson` and this row now reads both** — Home's `onlyYou` count
    // is the pair of them, so a started child frozen on an answer only a person can give is in a
    // population Home draws.
    note(
      '7b the queue a person reads lists what only a person can answer',
      personsAnswers.length === 0 ? 'NOT PERFORMED' : queueListed.size === 0 ? 'FAIL' : 'PASS',
      `${String(personsAnswers.length)} permission(s) needed a person; the person's own readers ` +
        `listed ${String(queueListed.size)} of them`,
    )

    // ── 9 · a question is routed to the parent, and answered there ───────────────────────────
    //
    // 🔴 **445 · criterion 29, and this is the one row in the diagram no dispatch could settle.**
    //
    // ⛔ **The brief's step `c` names no verb** — see {@link personsBrief}. It states an ambiguity
    // the worker may not settle and requires a decision before it finishes, and every route out of
    // that is the model's: `ask_question`, which keeps the work and waits; `reply_to_parent` with
    // `blocked`, which hands the work back; the provider's own ask, which reaches a PERSON and not
    // a parent; or guessing. ⚑ **This row reads the ledger for the one that leaves a routing to
    // `the-parent` with no channel refusal**, which `RuntimeHost.raiseAQuestion` writes and nothing
    // else does.
    //
    // ⚠️ **The bound is `question` and it is the same on both providers** (`445`, see
    // `lifecycle-steps.mjs`): the twin it replaced priced Codex at 45s because the step was
    // structurally impossible there, and pricing a model-behaviour step by provider is what would
    // decide the answer before the run did.
    const routed = await until(
      'a question routed to the parent',
      bound('question'),
      () => store.routedRequestsOf(explorer).some((one) => one.went.is === 'the-parent'),
      // 🔴 **Structural on BOTH providers since `445`, and the reason MOVED rather than widened.**
      //
      // ⛔ **It read `PROVIDER === 'codex'`**, because v3 records that a spawned Codex worker cannot
      // raise `item/tool/requestUserInput` at all — a fact about a PROVIDER, true on one of them.
      // ⚑ `437` published `ask_parent` (`ask_question` since D-009); `agentToolsFor` offers it to
      // both, and `raiseAQuestion` writes
      // this very routing row. **So no provider is unable to perform this step.**
      //
      // ⚠️ **What makes it structural now is that the step's whole subject is a model's CHOICE.** A
      // worker that needed a decision and reached for `reply_to_parent` instead did not derail the
      // chain — it answered criterion 29 in the negative and carried on — and `410` measured what
      // counting such a miss costs: row 8 missed, row 9 missed on a slow model, and row 10 then
      // reported *"gave up after 20s"* against its own 180s bound. 🔴 **A miss that is evidence
      // about the model cannot also be evidence that the run is derailing.**
      true,
    )
    const question =
      store.routedRequestsOf(explorer).find((one) => one.went.to === 'the-parent') ?? null
    note(
      '8 a question is routed to the parent, not to a person',
      routed && question !== null && question.parent === pm && question.went.is === 'the-parent'
        ? 'PASS'
        : routed
          ? 'FAIL'
          : 'NOT PERFORMED',
      question === null
        ? 'the worker asked its parent nothing'
        : `${question.requestId} → ${question.went.to} (${String(question.parent)}), refusal ${JSON.stringify(question.went)}`,
    )
    if (question !== null) {
      const answered = await until('the parent to answer it', bound('parentAnswer'), () => {
        const now = store
          .routedRequestsOf(explorer)
          .find((one) => one.requestId === question.requestId)
        return now !== undefined && now.state !== 'open'
      })
      const now = store
        .routedRequestsOf(explorer)
        .find((one) => one.requestId === question.requestId)
      note(
        '8b the parent answers it and the child carries on',
        answered && now?.state === 'answered' ? 'PASS' : answered ? 'FAIL' : 'NOT PERFORMED',
        `state ${String(now?.state)}; the pm called ${JSON.stringify(toolCallsOf(pm))}`,
      )
    }

    // ── 9 · the reply, its outcome, and the resource it carries ──────────────────────────────
    const replied = await until('the worker to reply', bound('reply'), () =>
      pieces().some((one) => one.owner === explorer && one.state === 'answered'),
    )
    const closed =
      pieces().find((one) => one.owner === explorer && one.state === 'answered') ?? null
    const resource = closed === null ? null : theFirstKept(closed)
    // ⛔ **v3 asks for THREE things in one reply and the verdict wants all three** — *"outcome done,
    // needs_user_action true, summary plus resource"*. ⚠️ `402` performed two of them because v2's
    // third was `warnings`, a word `TASK_OUTCOMES` refuses (`402` F5); the flag is what replaced it
    // and it is a real argument of `reply_to_parent`, so a run that ignored it would be performing
    // v2 under v3's name.
    note(
      '9 the worker replies with an outcome and a resource, kept as a resource',
      replied && closed !== null && resource !== null && closed.needsUserAction
        ? 'PASS'
        : replied
          ? 'FAIL'
          : 'NOT PERFORMED',
      closed === null
        ? 'no piece on the worker reached `answered`'
        : theReplySaid(closed, resource),
    )

    // ── 9b · …and the parent reads it as the APP's sentence, not as the person's ─────────────
    //
    // A reply reaches its parent through `queueMessage` as a `user_turn`. The turn must carry
    // both `app_authored` authorship and a `work` subject, written together, so
    // `UserMessage.vue` cannot present a child’s report as words the person typed.
    //
    // ⚠️ **Both halves are asserted, because either alone is satisfiable by the wrong thing**: an
    // `app_authored` turn with no `work` is the go-ahead, and a `work` report the person appears to
    // have typed is the bug this closed. ⛔ And the report must carry what the CHILD claimed —
    // `needsUserAction` — or the pair `406` made visible is only half plumbed.
    const appAuthored =
      pm === null
        ? []
        : store
            .events(pm)
            .map((one) => one.event)
            .filter(
              (one): one is Extract<TranscriptEvent, { type: 'user_turn' }> =>
                one.type === 'user_turn' && one.attribution === 'app_authored',
            )
    const reportsWork = appAuthored.filter((one) => one.work !== undefined)
    const carriedTheClaim = reportsWork.filter((one) => one.work?.needsUserAction === true)
    const unattributed =
      pm === null
        ? []
        : store
            .events(pm)
            .map((one) => one.event)
            .filter(
              (one): one is Extract<TranscriptEvent, { type: 'user_turn' }> =>
                one.type === 'user_turn' && one.attribution === undefined,
            )
    // ⛔ **The claim is asserted IN THE GAP, not unconditionally.** `406`'s subject is the
    // authorship: a reply that reaches a parent must not draw as a sentence the person typed. ⚠️ The
    // `needsUserAction` half is only assertable when the child actually made that claim — row 9 is
    // where a missing claim is a failure — so demanding it here would report `406` broken whenever a
    // model declined to set a flag. ⚑ Conditional on the premise, and the premise is row 9's own
    // reading of the same piece.
    const claimedIt = closed?.needsUserAction === true
    note(
      '9b the reply a parent reads is the app’s own, and it carries what the child claimed',
      !replied
        ? 'NOT PERFORMED'
        : reportsWork.length > 0 && (!claimedIt || carriedTheClaim.length > 0)
          ? 'PASS'
          : 'FAIL',
      `${String(appAuthored.length)} app_authored turn(s) on the project manager, ` +
        `${String(reportsWork.length)} carrying a work report, ${String(carriedTheClaim.length)} ` +
        `carrying the child’s needs_user_action; ${String(unattributed.length)} turn(s) there are ` +
        `unattributed and would draw as the PERSON’s own bubble`,
    )

    // ── 10 · the parent reads the resource ───────────────────────────────────────────────────
    const pulled = await until('the parent to read the resource', bound('pull'), () =>
      toolCallsOf(pm).some((name) => name.includes('read_document')),
    )
    // ⚠️ **549 · this read *AS THE PARENT* because `mayReadDocument` decided, and HO-057 withdrew
    // that predicate** — the door takes an id and nothing else (a resource's since D-016), so the
    // step measures that the parent CALLED `read_document` (the line above) and that the bytes came
    // back.
    const pull = resource === null ? null : theResourceSaid(resource)
    note(
      '10 the parent reads the resource it was handed an id for',
      pulled && pull?.carried === true ? 'PASS' : pulled ? 'FAIL' : 'NOT PERFORMED',
      pull === null ? 'there is no resource to read' : pull.what,
    )

    // ── 11 · a second piece, and the kill lands inside its turn ──────────────────────────────
    const second = await until(
      'a second piece on the worker',
      bound('secondPiece'),
      () => theGiven(explorer, pm).length > 1,
    )
    // ⛔ **This row is about the SECOND PIECE EXISTING and nothing else.** Whether the app can be
    // killed inside its turn is `11b`'s claim, watched concurrently above — folding the two into one
    // row is what made a completed chain read as a failure. ⚑ Both pieces are the worker's own, so
    // the give found the conversation the project manager already had with it.
    const onTheWorker = theGiven(explorer, pm)
    note(
      '11 the project manager gives the worker a second piece',
      second ? 'PASS' : 'NOT PERFORMED',
      `${String(onTheWorker.length)} piece(s) from the pm on the worker: ` +
        JSON.stringify(onTheWorker.map((one) => `${one.label} ${one.state}`)),
    )

    // ⛔ **MID-TURN, and the difference is the whole experiment.** A piece that is `working` has a
    // conversation driving it; a piece that is already `stalled` or `answered` has none, and killing
    // the app over one of those exercises nothing the ledger did not already say. ⚑
    // `settleRestartedWork` is explicit about it — it appends nothing for a session with no
    // `waiting`/`working` piece — so a stage that signalled without waiting would report `400`'s row
    // missing and be wrong.
    if (!(await until('the kill window to open', bound('killWindow'), () => signalled !== null))) {
      // 🔴 **A PERSON puts it back to work, and this is a real door rather than a harness hatch.**
      // `400`'s whole ruling is that a stalled piece stays OPEN and somebody decides — and one of the
      // things a person can decide is to open that conversation and type into it. ⛔ Without this the
      // restart half of the diagram is reachable only when a model happens to still be mid-turn at
      // the moment the runner looks, which makes the sharpest row in the table a coin toss.
      // ⚠️ **It is named in the row**, so a reader can always tell which of the two put the worker
      // to work — the project manager's second piece, or a person.
      putThereBy = 'a person typing into the conversation'
      let sink = claimed.get(explorer)
      if (sink === undefined) {
        sink = new Watcher('webContents:person-nudge', true)
        host.claimSession(explorer, sink)
        claimed.set(explorer, sink)
      }
      // ⚠️ **A person's message opens no piece**, so this only works while one is still open — which
      // is the state `TASK_IS_OPEN` names and `11b` reports either way — and since D-005 the turn it
      // starts drives a stalled piece again, which is what opens the window.
      await host.send(
        explorer,
        'Take another look at what you were asked to do and write one more line into findings.md ' +
          'about it. Take your time over it.',
        sink,
      )
      await until(
        'the kill window to open after a person typed',
        bound('nudgedKillWindow'),
        () => signalled !== null,
      )
    }
    if (signalled === null) {
      note(
        '11b the worker has open work and the runner has been signalled',
        'NOT PERFORMED',
        `no piece on ${explorer} was ever \`working\` after its first reply: ` +
          JSON.stringify(store.piecesOwnedBy(explorer).map((one) => `${one.label} ${one.state}`)),
      )
      return await parkForTheKill('the kill window never opened')
    }
    // ⛔ **The signal was written by the WATCHER, not here** — see `theKillWindow` above. ⚠️ The
    // kill itself is the RUNNER's row, because the process that dies cannot report that it died,
    // which is §3.3's *"reports from the outcome, not from its plan"* at its sharpest.
    await parkForTheKill('waiting to be killed')
  }

  /**
   * ⛔ **Idle until the runner kills this process, then a bounded give-up.**
   *
   * ⚠️ **The give-up is a FAIL and never a quiet exit**: a phase that reached its bound without
   * being killed did not perform the restart, and the runner's table has to say so rather than
   * print a table that looks complete.
   */
  async function parkForTheKill(why: string): Promise<void> {
    // ⛔ **The person keeps watching while this phase waits to be killed.** A run that stopped
    // answering here would leave the worker's own turn parked on a card, and the kill would land
    // on a conversation that was not working — which is a different experiment.

    if (!existsSync(join(ROOT, 'kill-now'))) {
      writeFileSync(join(ROOT, 'kill-now'), `no-open-piece\n${why}\n`)
    }
    // ⚠️ **A wait that can only time out**, deliberately: the exit condition for this phase is a
    // signal from outside, so the only thing this loop can report is that the signal never came.
    await until('the runner to end this process', bound('park'), () => false)
    note(
      'the kill never arrived',
      'FAIL',
      `${why}; this stage was still alive 240s after asking to be killed`,
    )
  }

  return phaseA
}
