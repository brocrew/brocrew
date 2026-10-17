/**
 * 🔴 **Words this app wrote ITSELF, about something it observed** (624, `HO-095` §6.1) — the
 * vocabulary, and the sentences every surface reads it through.
 *
 * ## ⛔ The defect, in the PO's words
 *
 * Give held approval carriers app-notice provenance. Without it, `QueuedMessage.vue` can label them You and offer cancellation, then `transcript.ts` can classify delivery as a plan go-ahead. Neither describes an app-authored proposal decision correctly.
 *
 * 🔴 **Nothing was added to make that happen.** `whoseWordsTheseAre` already marked the turn
 * `app_authored`; what decides the ENTRY is the SUBJECT beside it, and this producer had none.
 * ⚑ `transcript.ts`' own note says so in as many words — *"a turn carrying `attribution` and no
 * `work` would render as the go-ahead's continuation"* — and priced the fallback as sound
 * *"for every ledger ever written"*, which was true until `615` wrote the fourth producer.
 *
 * ## ⚑ So this is a SUBJECT, in `406`'s and `413`'s family and not a fourth kind of authorship
 *
 * ⛔ **`WorkReport` says *these words are about work you gave out*; {@link
 * UserTurnEvent.relayedFrom} says *these words are another conversation's*. ⚑ This says *these
 * words are this app's own report of something that happened*** — and, like both of them, it
 * rides {@link TurnAuthorship}, so the held row, the turn it becomes and the ending that rebuilds
 * a row nobody saw queued all carry it without anybody remembering to widen three writers.
 *
 * ## 🔴 Marked on the NOTICE and never on the go-ahead, and the direction is load-bearing
 *
 * ⛔ **Every app-authored turn in every ledger written before `624` is a go-ahead**, so absence
 * has to keep meaning that. ⚠️ Marking the go-ahead instead would have made every old row read as
 * a notice — `413` §3's *"the dangerous default"* pointed at a different reader, and the same
 * answer: the new fact travels, and the old population is left saying what it always said.
 *
 * ## ⚠️ It is a pure vocabulary — this module imports NOTHING
 *
 * ⛔ **Not even a type**, which `tasks.ts` and `own-instructions.ts` only approximate. ⚑ A word, a
 * table of what each word means and two readers over them: nothing here can reach a store, a
 * clock or a host, and the compiler checks that on every build rather than a test remembering to
 * drop something.
 */

/**
 * ⛔ **What the app is reporting — a CLOSED vocabulary, because the caption is rendered from the
 * word** (standing rule 8).
 *
 * ## 🔴 Why a word and not a flag
 *
 * ⚠️ **`HO-095` §6.3 is a caption written for one feature and reused on another**, which is
 * standing rule 8.1. ⛔ A boolean would have bought one sentence true of every notice, and the
 * next producer would have inherited it the way this one inherited the go-ahead's — ⚑ **a word
 * makes the sentence a compile error until somebody writes it**, which is the only shape that
 * stops the reuse happening again.
 *
 * ## ⚠️ The members are the producers that have no other subject
 *
 * ⛔ **Not every `'notice'` `RuntimeHost` queues reaches here.** `tellOneParent` carries a
 * {@link WorkReport}, so *work you gave out* is its subject and {@link WorkReportItem} is its entry;
 * a question answered by a PERSON (`591`) carries nothing at all. ⚑ A producer with no subject owes
 * a member here, and the `Record` below is what says so. ⚑ **W4.178 · a member with no producer
 * leaves**: *a question that will not be answered* went, since every question still has a
 * conversation that can answer it — a replaced one's pass to the one in its place; an old row
 * carrying its word reads the generic sentence.
 *
 * ⚠️ **An ANSWER a conversation gave is not one of these.** `deliverAnswer` passes `carriedFor`
 * when an agent answered, so those words are that agent's and the row is a relay —
 * {@link RuntimeHost.deliverAnswer} states the split. This member is the arm where the answerer
 * is a person and the sentence is this app's own report of what they did.
 */
export const APP_NOTICES = [
  'a-work-wait-needs-attention',
  'a-person-gave-new-work',
  'an-answer-to-a-question',
  // 🔴 **D-016** — the conversation that gave this one a piece of work took it back, and this app
  // tells the owner so it stops working on it (`withdraw_task`).
  'a-piece-taken-back',
  // 🔴 **D-016** — the conversation that gave this one a piece of work closed it, and this app tells
  // the owner so it stops working on it (`update_work`'s close).
  'a-piece-closed',
  // 🔴 A person took back the piece a service is on, and this app tells the service, so it stops
  // working on it, and the conversation that gave it, so it no longer waits for its answer.
  'a-piece-a-person-took-back',
  'a-piece-it-gave-a-person-took-back',
  // 🔴 **D-016** — the conversation that gave this one a piece of work added files to it as inputs,
  // and this app tells the owner their ids (`update_work`'s resources).
  'inputs-added-to-a-piece',
  // 🔴 **D-029** — a job this conversation scheduled came due while it was stopped, is no longer
  // on its schedule, or is one this app does not start it for; its provider says nothing of such a
  // job when it starts again, so this app tells it.
  'a-scheduled-job-that-will-not-run',
  // 🔴 Restarting the app stopped background work this conversation was running, and this app
  // started it again to tell it what stopped.
  'background-work-a-restart-stopped',
  // 🔴 **F076** — Claude refused the login this conversation was started with while a turn of its own
  // was running, so that turn could not run; this app reopened it on the login this computer holds now and
  // says what the turn was for.
  'a-turn-a-refused-login-stopped',
  // 🔴 The app's quit, or the app stopping unexpectedly, cut a turn this conversation was running,
  // and this app started it again, on the same account, to continue it.
  'a-turn-the-app-cut',
  // The person decided a request this conversation made to register an MCP server, or registered
  // a server of that name themselves, and this app tells it how the request ended.
  'an-mcp-server-request-decided',
] as const

/** One of {@link APP_NOTICES}. */
export type AppNotice = (typeof APP_NOTICES)[number]

/**
 * 🔴 **Who the row is headed by** (624, `HO-095` §6.1) — and it is a CATEGORY, not a name.
 *
 * ## ⛔ Not `BroBot`, and that is the PO's own correction
 *
 * Use an app category rather than {@link DEFAULT_PROFILE_LABEL}, which names the BroBot agent receiving the carrier. The agent did not write those words. `relayed-turn.ts` similarly uses `AN_UNNAMED_RELAYER` when the sender cannot be named.
 *
 * ⚠️ **`GO_AHEAD_SENDER` still reads `BroBot` and this is not a drift.** ⛔ That row is *BroBot
 * speaking FOR the person* and its own docblock argues the name; this row is the SOFTWARE
 * reporting, with nobody on whose behalf it speaks. 🔴 **`WORK_REPORT_MARK` reads `BroBot · work
 * you gave out` and reaches the same reader** — swept by `624` and reported rather than changed,
 * because renaming a row this dispatch does not own is a ruling about what the product calls
 * itself and not a consequence of this one.
 */
export const THE_APP_IS_THE_AUTHOR = 'This app'

/**
 * ⛔ **The subject, where `ContinuationEntry` puts *sent for you* and `RelayedEntry` puts *from
 * another conversation*.**
 *
 * ⚠️ **It has to CONTRADICT *sent for you*, not merely differ from it** — `RELAYED_MARK`'s rule,
 * and it applies here for its reason. ⛔ That line means *you pressed a button and I sent this on
 * your behalf*, and both halves are false of a notice: nobody pressed anything in this
 * conversation, and the words are not being sent on anybody's behalf. ⚑ *Reporting* is what is
 * left when both of those go.
 */
export const APP_NOTICE_MARK = 'reporting what happened'

/**
 * ⛔ **Why a message nobody typed is in the conversation, rendered from the word** (standing rule
 * 8) — the position `GO_AHEAD_AUTHORSHIP` holds on the go-ahead's entry.
 *
 * ## ⚠️ Every sentence is about HOW THE WORDS GOT HERE and about nothing else
 *
 * ⛔ **None of them says what the reader should do, that anything is owed, or that a reply is
 * expected** — the words above the caption already carry the fact, and a caption that instructed
 * would be this app deciding for the conversation (HO-018's principle, one surface over).
 *
 * ⚑ **Each one names the act that actually happened**, which is `HO-095` §6.3's whole complaint:
 * a caption naming *a control the reader pressed* on a row nobody pressed anything for.
 *
 * ⚠️ **The compiler will not let this table go short**, so {@link APP_NOTICES}' next member
 * arrives with its own sentence rather than inheriting one written for a different act.
 */
export const NOTICE_MEANS: Readonly<Record<AppNotice, string>> = {
  'a-work-wait-needs-attention':
    'This app added this note because a piece of work needs attention. You did not write it, and it is not a go-ahead.',
  'a-person-gave-new-work':
    'This app added this note: a person gave new work to an agent this conversation gave work to. You did not write it, and it is not a go-ahead.',
  'an-answer-to-a-question':
    'This app put these words here because a question this conversation had asked was answered. ' +
    'You did not write them, and they were not sent on anybody’s behalf.',
  'a-piece-taken-back':
    'This app put these words here because the conversation that gave this conversation a piece of ' +
    'work took it back. You did not write them, and they were not sent on anybody’s behalf.',
  'a-piece-closed':
    'This app put these words here because the conversation that gave this conversation a piece of ' +
    'work closed it. You did not write them, and they were not sent on anybody’s behalf.',
  'a-piece-a-person-took-back':
    'This app put these words here because a person took back a piece of work this conversation ' +
    'held. You did not write them, and they were not sent on anybody’s behalf.',
  'a-piece-it-gave-a-person-took-back':
    'This app put these words here because a person took back a piece of work this conversation ' +
    'gave. You did not write them, and they were not sent on anybody’s behalf.',
  'inputs-added-to-a-piece':
    'This app put these words here because the conversation that gave this conversation a piece of ' +
    'work added files to it. You did not write them, and they were not sent on anybody’s behalf.',
  'a-scheduled-job-that-will-not-run':
    'This app put these words here because a job this conversation had scheduled came due while it ' +
    'was stopped, is no longer on its schedule, or is one this app does not start it for. You did ' +
    'not write them, and they were not sent on anybody’s behalf.',
  'background-work-a-restart-stopped':
    'This app put these words here because restarting the app stopped background work this ' +
    'conversation was running. You did not write them, and they were not sent on anybody’s behalf.',
  'a-turn-a-refused-login-stopped':
    'This app put these words here because its provider refused the login this conversation was ' +
    'started with while a turn of it was running, and this app reopened it on the current login. ' +
    'You did not write them, and they were not sent on anybody’s behalf.',
  'a-turn-the-app-cut':
    'This app put these words here because this conversation’s turn was cut while it was working: ' +
    'the app restarted or stopped, its program stopped, or a usage limit was reached. You did not ' +
    'write them, and they were not sent on anybody’s behalf.',
  'an-mcp-server-request-decided':
    'This app put these words here because a request this conversation made to register an MCP ' +
    'server was decided. You did not write them, and they were not sent on anybody’s behalf.',
}

/** ⛔ **Is this a member of the vocabulary, asked of a value that has crossed the LEDGER?** */
export function isAppNotice(said: unknown): said is AppNotice {
  return typeof said === 'string' && (APP_NOTICES as readonly string[]).includes(said)
}

/**
 * ⚑ **What any notice means, for a word this build has no sentence for** — a sentence true of
 * EVERY app notice, and so of a retired one: it names no act, only who put the words there.
 *
 * ⚠️ **D-016 · the ledgers hold such words.** Rows written before D-016 carry
 * `a-decision-a-person-made`, and a conversation's history is kept whole, so this is what they
 * read under for good. ⛔ **Not the word itself**, which is a caption nobody can read, and not a
 * member's sentence, which would name an act that did not happen (`HO-095` §6.3).
 */
const A_NOTICE_MEANS =
  'This app put these words here to report something that happened. ' +
  'You did not write them, and they were not sent on anybody’s behalf.'

/**
 * ⚑ **The caption off a replayed ledger, and {@link A_NOTICE_MEANS} when this build has no sentence
 * for the word** — `TranscriptEvent` is `JSON.parse`d and cast with no schema between the database
 * and the fold, so a row written by a build whose vocabulary has moved reaches a reader as a word
 * it does not know.
 *
 * ⛔ **Printing `undefined` under a message nobody typed would be the confident sentence
 * criterion 18 exists to prevent**, in the one position on the row whose whole job is to say why
 * the words are there.
 */
export function noticeMeans(said: string): string {
  return isAppNotice(said) ? NOTICE_MEANS[said] : A_NOTICE_MEANS
}
