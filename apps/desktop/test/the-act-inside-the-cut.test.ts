import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TOOL_SUMMARY_MAX } from '../../../packages/runtime/src/claude/normalize'
import {
  A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
  A_CONVERSATION_CANNOT_ASK_ITSELF,
  A_FOLDER_COULD_NOT_BE_MADE,
  A_PROVIDER_REFUSED_THE_START,
  A_WAKE_ITS_PROVIDER_REFUSED,
  A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE,
  A_WAKE_WHOSE_FOLDER_IS_GONE,
  A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN,
  TOOL_REFUSALS,
  aFollowUpOnAPieceYouDidNotGive,
  aFollowUpOnAPieceYouGaveAnother,
  aMessageAboutAQueuedPiece,
  aStartItsLoginOrSettingsRefused,
  aFollowUpOnAPieceYouHold,
  aTakeBackOfAPieceYouHold,
  aTakeBackOfAPieceYouHoldThatEnded,
  aTakeBackOfYourOwnWork,
  anAgentWithSeveralConversations,
  anEndedPieceSaid,
  refuseTool,
} from '../src/main/runtime/agent-tools'
import { SPAWN_RAILS, refuse, type SpawnRefusalDetail } from '../src/main/runtime/spawn-rails'
import { MESSAGE_RAILS, refuseMessage } from '../src/main/runtime/message-rails'
import { REPLY_RAILS, refuseReply, replyUnkeptFileReason } from '../src/main/runtime/reply-rails'
import { QUESTION_RAILS, refuseQuestion } from '../src/main/runtime/question-rails'
import { INTERRUPT_RAILS, refuseInterrupt } from '../src/main/runtime/interrupt-rails'
import { RESOURCE_RAILS, refuseResource } from '../src/main/resources/resources'
import { MODEL_RAILS, refuseModel, type ModelRefusalDetail } from '../src/main/runtime/model-rails'
import { RAIL_PERMANENCES } from '../src/shared/refusals'
import { pastWorkSearchRefusal } from '../src/shared/past-work-search'
import {
  WORK_SEARCH_RAILS,
  WORK_SEARCH_REFUSAL_WORDS,
  workSearchRefusal,
} from '../src/shared/work-search-words'
import { PROVIDER_NAME } from '../src/shared/runtime-ipc'
import {
  aPieceNotEndedItsQuestionsUnread,
  aPieceNotEndedWhileAQuestionStarts,
} from '../src/shared/questions'

/**
 * 🔴 **675 · a refusal's performable act falls inside what EVERY reader of its row sees** (`644` F2).
 *
 * ## ⛔ Who reads the row — measured, not assumed
 *
 * A refusal answers `refused (<rail>): <sentence>` beside a JSON payload carrying the same sentence
 * as `reason` (`agent-tools.ts`' `refusalAnswer`). ⚑ **Who reads which, on the tree this landed on:**
 *
 * | reader | what it gets | cut |
 * |---|---|---|
 * | **the model that called** — Codex | the row, then the JSON (`probe:codex-tool-answer`) | none |
 * | **the model that called** — Claude | the row, then the JSON, as two text blocks (`probe:claude-tool-answer`, arm B — the shape the app ships since `675`) | none |
 * | **a person** — the transcript's tool row, both providers | the ROW, one line | ⛔ **`TOOL_SUMMARY_MAX` (200)** — then `…`, and on Codex a count |
 * | **a person** — the whole-answer panel (`462`) | everything | none, but **only while the conversation runs** |
 * | **a person** — the `tool_refused` notice | tool · rail · permanence · the remedy WORD | no sentence at all |
 * | **a parent** — of its child's refusal | ⛔ **nothing**: no tool reads another conversation's tool rows, and `tool_refused` lands in the caller's ledger only | — |
 *
 * 🔴 **Until `675` the Claude rows were not the sentence at all.** The app answered with one text
 * block and `structuredContent`, and the pinned CLI hands the model `JSON.stringify` of that field
 * INSTEAD of the text and echoes it back — so a Claude row read
 * `{"outcome":"refused","rail":…,"reason":"…`, cut about ninety characters into the reason. ⚑ Two
 * text blocks put the sentence at the front of the row on both providers, and ONE rule then covers
 * the only reader that is cut: **the act must end within the first 200 characters of the row.**
 *
 * ## ⚑ The cheapest true way, per reader, with the count
 *
 * ⛔ **A raised bound was not available** — `457` priced it out, and a bound for refusal rows only
 * would need the normalizer to know a row is a refusal, which it can learn only by reading our words
 * back out of a provider's transport (`405`). ⚑ **So: lead with the act.** Each sentence keeps its
 * clauses and its facts; what moved is their ORDER — *what stopped it, the act, then the why* — and,
 * where a clause was only padding, a shorter spelling of it. ⚠️ **Rows over the bound are not the
 * measure** — a row may run long as long as its act is inside — so the count that matters is the
 * second one:
 *
 * | measured over every vocabulary, planted parameters at their longest | before `675` (`ef6ee202`) | after |
 * |---|---:|---:|
 * | rows | 91 | 94 |
 * | rows over 200 | 62 | 60 |
 * | ⛔ **rows whose act sits PAST the cut** — the row as Codex drew it | **52** | **0** |
 * | rows whose sentence carries no act at all ({@link NO_ACT}'s one rule) | 18 | 18 |
 *
 * ⚑ **690 added two rows**, the wake door's own `agent-cannot-take-a-message` and `that-agent-is-you`
 * (211 and 192 characters; each act ends inside the cut, at 189 and 191). ⚑ **698 added one** —
 * the wake door's `that-conversation-is-running` about a child already holding a message (185
 * characters; its act ends at 184). ⚑ **703 added two** — `a-message-you-cannot-withdraw-is-waiting`
 * (188 characters; its act ends at 187) and its sentence for a WORK call the next rail would refuse
 * too (228; its act ended at 196 and its `withdraw_task` clause at 226 — ⚑ **`711` reordered it**:
 * 212, and the whole act, that clause included, ends at 162).
 * ⚑ **`726` · R92 removed four** — `cwd-outside-parent`'s two arms, `folder-is-not-allowed` and
 * `resource-outside-workspace` (the last a row with no act, so {@link NO_ACT} holds seventeen), and
 * reworded the four `DOCUMENT_RAILS` acts that said *inside this conversation’s working directory*.
 * ⚠️ The table above is `675`'s measurement and was not re-taken. ⚑ **D-010 removed three** —
 * `698`'s row and `703`'s two, with the one-held-message rule they were about — and
 * `agent-already-has-a-message-waiting`, a row with no act, so {@link NO_ACT} holds sixteen.
 * ⚑ **D-014 removed eight and added one** — the grants and counts that are gone took
 * `may-not-create-projects`, `not-in-can-spawn`, the two fan-out rows and the four interrupt/end
 * grant rows; `assign-work-to-one-you-did-not-start` is new. None of them was in {@link NO_ACT}.
 * ⚑ **D-017 removed three** — `the-conversation-that-asked-has-ended` and `675`'s two per-caller
 * wake sentences (a delivery starts a stopped conversation now) — and reworded
 * `the-conversation-that-asked-has-gone`, a row with no act that still fits inside the cut whole.
 * ⚑ **D-017's third commit** (`end_agent` and `resume_agent` gone) removed `END_RAILS`, the five
 * wake-door sentences, `that-conversation-is-running`, `no-conversation-of-yours-to-wake` and
 * `INTERRUPT_RAILS|that-conversation-has-already-ended` (a row with no act, so {@link NO_ACT} holds
 * thirteen), and added `that-conversation-takes-no-messages`, `it-is-waiting-on-an-answer` and
 * `not-below-you` — the first two with their acts past the cut until they were reordered act-first,
 * and `that-conversation-is-still-stopping`'s *not started again* put its act two characters past
 * it until *again* went (the conversation was not started, which is the fact).
 * ⚑ **D-016 removed thirteen** with projects, proposals and `takes_work_from` — `not-your-project`'s
 * two arms, the four project message rails (`message-outside-your-project`,
 * `may-not-read-a-project`, `read-outside-your-project`, `assign-work-outside-your-project`),
 * `create_project`'s six (`no-project-by-that-name`, `project-name-taken`,
 * `a-proposal-is-already-waiting`, `no-person-to-ask`, `no-such-folder`, `folder-already-exists`)
 * and `read_transcript`'s `that-agent-serves-every-caller`. None of them was in {@link NO_ACT}.
 * ⚑ **D-016 · commit 3** (the tree) — `spawn_agent`'s rails became `give_work`'s, the task words
 * became piece words, the one-open-task rail went, and `DOCUMENT_RAILS` became `RESOURCE_RAILS`: a
 * reply's files are kept as resources, and the registry's project, task, registration and tree words
 * went with it. Every new word chose, below. ⚠️ `wider-than-its-parent` lost its act — a give names
 * no mode, so there is no setting left to drop — and both its arms run past the cut, so they are
 * in {@link NO_ACT} and {@link NO_ACT_PAST_THE_BOUND} by name.
 * ⚑ **D-016 · commit 5** (the giver's verbs) added two — `the-giver-briefs-and-closes-a-piece` (282
 * characters; its act ends at 186) and `that-piece-was-already-closed` (137, a row with no act, so it
 * is in {@link NO_ACT} beside its taken-back twin) — and reworded the acts of `that-piece-has-ended`
 * and `that-is-your-own-work` (ending at 169 and 191) and `resource-not-a-form-this-app-keeps`'s
 * (198): each is said at more than one door now, so each says what is true at all of them.
 * ⚑ **D-016 · commit 6** (a request the person makes) added one — `no-work-of-your-own` (223
 * characters; its act ends at 181) — and reworded `the-giver-briefs-and-closes-a-piece` (288; its act
 * is *Ask with ask_question…* now, true of a piece a person gave too, and ends at 192),
 * `a-person-gave-that-piece` (293, from 208; its act ends at 187) and the clause of
 * `that-is-your-own-work` after its act (327; the act still ends at 191).
 * ⚑ **D-038** (the rail compares reach) reworded `wider-than-its-parent` act-first — *Do this work
 * here, or ask a person whether to change your approval mode* — so both its arms carry an act in
 * {@link ACT} (336 and 289 characters; the act ends at 104 in each). ⚠️ The commit-3 note above,
 * that it had lost its act and sat in {@link NO_ACT}, was already stale before D-038.
 * ⚑ **D-039 · R2** (a start its provider refused) added two — the doors' sentences in place of their
 * words' own, `A_PROVIDER_REFUSED_THE_START` at `give_work` (309 characters; its act ends at 163) and
 * `A_WAKE_ITS_PROVIDER_REFUSED` at a wake (305; its act ends at 170), in {@link OVERRIDES}.
 * ⚠️ **D-039's** `THE_NEW_AGENT_WAS_MADE`, a give's only, is no row of its own: it is said AFTER
 * whichever launch sentence a give with `new: true` met, so every row's act keeps its place — see
 * the note in {@link OVERRIDES}.
 * ⚑ **D-042 added a vocabulary** — `MODEL_RAILS` (`runtime/model-rails.ts`), the one seam
 * `give_work` and `create_agent` judge an agent's model and effort by: seven words and twelve rows,
 * planted in {@link MODEL_DETAILS}, nine of them over the bound. Every one is act-first — *Pick…*,
 * *Leave…*, *Ask a person to check…*, *Name…* or *Give again* — so each act ends inside the cut
 * (the latest at 174: *Pick an effort “m” offers* with a 120-character model), and none is in
 * {@link NO_ACT}.
 * ⚑ **D-050** (no limit on an agent's model) took two words and four rows out —
 * `model-outside-the-limit` and `effort-above-the-limit`'s three arms, all four over the bound — so
 * the seam is five words and eight rows, five of them over the bound.
 *
 * ⚠️ **Three rows are new** — `no-conversation-of-yours-to-wake` and the two per-caller sentences —
 * and the "before" column is the prose row; ⛔ **on Claude it was worse on every row**, since the
 * row was the JSON and the reason began some ninety to a hundred and thirty characters in.
 * ⚑ **Rows over the bound barely moved, and that is the point**: the act moved to the front. ⚠️ Where
 * a clause was also tightened its fact was kept, and the response names each one.
 *
 * ⚠️ **The ones with no act are a finding, not a pass** — each is named in {@link NO_ACT} with
 * why; two run past the cut, and are pinned by name in {@link NO_ACT_PAST_THE_BOUND}. ⛔ **A new word must choose**: an act here, or a line
 * there.
 */

const here = dirname(fileURLToPath(import.meta.url))
const mainRoot = join(here, '../src/main')
const sharedRoot = join(here, '../src/shared')

/** The row a person reads, as `refusalAnswer` builds it. */
const rowOf = (rail: string, sentence: string): string => `refused (${rail}): ${sentence}`

/**
 * ⛔ **Where the act ends in the row, or why it does not count** — the one predicate every test
 * below asks, and the one the planted controls prove can fail.
 */
function whereTheActSits(
  row: string,
  act: string,
): 'inside' | { readonly past: number } | 'not-in-the-row' {
  const at = row.indexOf(act)
  if (at < 0) return 'not-in-the-row'
  const ends = at + act.length
  return ends <= TOOL_SUMMARY_MAX ? 'inside' : { past: ends }
}

/** ⚑ Planted at their longest — 64 is a slug's and a profile name's own cap; a path has none. */
const LONG_SLUG = 'a'.repeat(64)
const LONG_PATH = `/Users/somebody/${'deep/'.repeat(50)}folder`
/**
 * ⚑ **D-016 · commit 3** — the detail fields that are LISTS of labels, each label rendered verbatim.
 * ⚠️ `677`'s provider, model and session fields went with the `spawn_agent` rails that said them.
 */
const LABEL_LISTS = new Set(['held', 'stalled'])
/**
 * ⚑ **D-038** — what a giver keeps past its folder that the child would not (`wouldLack`): both, from
 * a Codex `ask` giver. It was `BOTH_REMOVALS`, what the child's mode also took off.
 */
const BOTH_PROTECTIONS = ['the-card-before-an-act', 'the-sandbox-around-an-act'] as const
/**
 * ⚑ **D-042** — a model's name at its longest: 120 is the cap on one a person types
 * (`ipc.ts`' `aModelsName`, for `createSession` and a hand-added model), and a model an agent names
 * is either one of those or a provider's own, shorter, id.
 */
const LONG_MODEL = 'm'.repeat(120)
/** ⚑ **D-042** — Claude's efforts, the pinned SDK's own (`claude-runtime.ts`' `CLAUDE_EFFORTS`). */
const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
/** ⚑ **D-042** — what a provider could not be asked, in the provider's own words (`refused`). */
const NOT_ASKED = 'Not logged in · Please run /login'

/**
 * ⚠️ **Every parameterised spawn sentence, at every arm and at its longest.** A detail-less
 * `refuse(rail)` prints `?` and picks one arm, which is `what-an-agent-is-told…`'s census's limit and
 * the reason this one plants values.
 */
const SPAWN_DETAILS: Partial<Record<(typeof SPAWN_RAILS)[number], readonly SpawnRefusalDetail[]>> =
  {
    // ⚑ **D-016** — `not-your-project`'s two arms were planted here; the rail went with projects.
    // ⚑ **D-016 · commit 3** — the rails are `give_work`'s now: `unknown-profile`,
    // `profile-already-live` and `not-the-model-a-person-chose` went with `spawn_agent`, and a give
    // names no model, provider or mode. ⚠️ A list of labels has no cap, so the list below is a
    // caller holding its root and two pieces.
    'name-the-piece-you-give-from': [{ held: ['W12', 'W3.4.1', 'W3.4.2'] }],
    // ⚑ D-014 · the ruled limit is 6, so the first refusal is at depth 7. ⛔ The label is the
    // SHORTEST a piece at depth 6 can have — seven parts, each one digit.
    'too-deep': [{ depth: 7, maxDepth: 6, label: 'W1.1.1.1.1.1.1' }],
    'no-free-worker-at-capacity': [{ profileId: LONG_SLUG }],
    'worker-binding-is-unknown': [{ profileId: LONG_SLUG }],
    'that-profile-exists': [{ profileId: LONG_SLUG }],
    // ⚑ **D-038** — the sentence names both modes now, the giver's and the one the child would run
    // in, so `asked` is planted (without it the row prints `?`); a refusal is an `ask` giver whose
    // child would run in `auto`, and `wouldLack` (it was `alsoRemoves`) is what the giver keeps.
    'wider-than-its-parent': [
      { asked: 'auto', spawnerRunsAs: 'ask', wouldLack: BOTH_PROTECTIONS },
      { asked: 'auto', spawnerRunsAs: 'ask', wouldLack: [] },
    ],
    'no-such-profile': [{ profileId: LONG_SLUG }],
    // ⚑ The act comes before the name, so a name at its longest leaves it inside the cut.
    'its-record-cannot-be-read': [{ profileId: LONG_SLUG }],
    // ⚑ An agent with no provider saved whose conversations ran on both, at its longest counts.
    'its-provider-is-not-chosen': [
      { profileId: LONG_SLUG, startedOn: { claude: 9999, codex: 9999 } },
    ],
    // ⚑ `726` · R92 — `cwd-outside-parent`'s two arms were planted here; the rail is gone.
    'folder-unusable': [{ folderReason: `cwd does not exist: ${LONG_PATH}` }],
  }

/**
 * 🔴 **D-042 · every arm of the model seam's sentences, at its longest** — `describeModelRail`'s
 * branches, each planted with the fields its sentence SAYS (the check below asks each planted value
 * to be in the row), so a field the detail carries and the sentence leaves out is left out here.
 * ⚑ `door` and `provider` are said in words — *nothing was given*, *Claude*.
 */
const MODEL_DETAILS: Partial<Record<(typeof MODEL_RAILS)[number], readonly ModelRefusalDetail[]>> =
  {
    'model-not-in-the-list': [
      {
        door: 'give',
        provider: 'claude',
        model: LONG_MODEL,
        choices: ['default', 'opus', 'sonnet', 'haiku'],
      },
    ],
    // ⚑ A model that offers no efforts, then one that does not offer the effort named.
    'effort-not-offered': [
      { door: 'give', model: LONG_MODEL, efforts: [] },
      { door: 'give', model: LONG_MODEL, effort: 'minimal', efforts: CLAUDE_EFFORTS },
    ],
    // ⚑ **D-050** — `model-outside-the-limit` and `effort-above-the-limit`'s three arms were
    // planted here; both words went with the agents' limit.
    // ⚑ The list unread for a model, read with no default for an effort named alone (Codex: Claude
    // names its default by name), and unread for an effort named alone.
    'models-unavailable': [
      { door: 'give', provider: 'claude', model: LONG_MODEL, why: NOT_ASKED },
      { door: 'give', provider: 'codex', effort: 'xhigh' },
      { door: 'give', provider: 'claude', effort: 'xhigh', why: NOT_ASKED },
    ],
    // The provider was too slow to give its list: for a model named, then an effort named alone.
    'models-not-read-in-time': [
      { door: 'give', provider: 'codex', model: LONG_MODEL },
      { door: 'give', provider: 'codex', effort: 'xhigh' },
    ],
    'name-the-model-too': [{ door: 'create' }],
    'the-provider-moved-meanwhile': [{ door: 'give', provider: 'claude' }],
  }
/** ⚑ **D-042** — the model details' fields that are LISTS, each member rendered verbatim. */
const MODEL_LISTS = new Set(['choices', 'efforts'])

interface Row {
  /** `vocabulary|rail`, or `vocabulary|rail/variant` for a sentence the table does not hold. */
  readonly key: string
  readonly rail: string
  readonly row: string
}

/**
 * 🔴 **The vocabularies, as VALUES — each list with the builder that makes its sentence**, and the
 * module it lives in, so the completeness check below is derived from what this census READS
 * rather than from a list typed beside it (review of `675`). ⚑ A builder answers every ARM of a rail:
 * one sentence for most, one per planted detail for the parameterised spawn rails.
 */
const VOCABULARIES: readonly {
  readonly name: string
  readonly module: string
  readonly rails: readonly string[]
  readonly arms: (rail: string) => readonly string[]
}[] = [
  {
    name: 'WORK_SEARCH_RAILS',
    module: 'shared/work-search-words.ts',
    rails: WORK_SEARCH_RAILS,
    arms: (rail) => [
      workSearchRefusal(rail.slice('work-search-'.length) as keyof typeof WORK_SEARCH_REFUSAL_WORDS)
        .reason,
    ],
  },
  {
    name: 'TOOL_REFUSALS',
    module: 'runtime/agent-tools.ts',
    rails: TOOL_REFUSALS,
    arms: (rail) => [refuseTool(rail as never).reason],
  },
  {
    name: 'SPAWN_RAILS',
    module: 'runtime/spawn-rails.ts',
    rails: SPAWN_RAILS,
    arms: (rail) =>
      (SPAWN_DETAILS[rail as (typeof SPAWN_RAILS)[number]] ?? [{}]).map(
        (detail) => refuse(rail as never, detail).reason,
      ),
  },
  {
    name: 'MESSAGE_RAILS',
    module: 'runtime/message-rails.ts',
    rails: MESSAGE_RAILS,
    arms: (rail) => [refuseMessage(rail as never).reason],
  },
  {
    name: 'REPLY_RAILS',
    module: 'runtime/reply-rails.ts',
    rails: REPLY_RAILS,
    arms: (rail) =>
      rail === 'piece-already-ended'
        ? [{}, { state: 'answered' }, { state: 'withdrawn' }, { state: 'closed' }].map(
            (detail) => refuseReply(rail, detail as never).reason,
          )
        : [refuseReply(rail as never).reason],
  },
  {
    name: 'QUESTION_RAILS',
    module: 'runtime/question-rails.ts',
    rails: QUESTION_RAILS,
    // ⚑ `answer-too-long` says its numbers: each arm with them at a length a call can reach, and the
    // sentence a detail without them gets.
    arms: (rail) =>
      rail === 'answer-too-long'
        ? [
            {},
            { argument: 'answers', limit: 1280, was: 12_800_000 },
            { argument: 'cannot_answer', limit: 1280, was: 12_800_000 },
          ].map((detail) => refuseQuestion(rail, detail as never).reason)
        : // Known endings include their time; answered questions still say where to read the reply.
          rail === 'no-open-question-you-asked-by-that-name'
          ? [
              {},
              {
                state: 'answered',
                at: 1_700_000_000_000,
                itsAnswer: 'held-and-this-turn-is-stopping',
              },
              { state: 'answered', at: 1_700_000_000_000, itsAnswer: 'held-until-this-turn-ends' },
              { state: 'answered', at: 1_700_000_000_000, itsAnswer: 'already-sent' },
              {
                state: 'answered',
                at: 1_700_000_000_000,
                itsAnswer: 'held-until-the-limit-resets',
              },
              {
                state: 'rejected',
                at: 1_700_000_000_000,
                itsAnswer: 'held-and-this-turn-is-stopping',
              },
              { state: 'rejected', at: 1_700_000_000_000, itsAnswer: 'held-until-this-turn-ends' },
              { state: 'rejected', at: 1_700_000_000_000, itsAnswer: 'already-sent' },
              {
                state: 'rejected',
                at: 1_700_000_000_000,
                itsAnswer: 'held-until-the-limit-resets',
              },
              { state: 'work-closed', at: 1_700_000_000_000 },
              { state: 'withdrawn', at: 1_700_000_000_000 },
              { state: 'withdrawn' },
            ].map((detail) => refuseQuestion(rail, detail as never).reason)
          : [refuseQuestion(rail as never).reason],
  },
  {
    name: 'INTERRUPT_RAILS',
    module: 'runtime/interrupt-rails.ts',
    rails: INTERRUPT_RAILS,
    arms: (rail) => [refuseInterrupt(rail as never).reason],
  },
  // ⚑ **D-017** — `END_RAILS` (`runtime/end-rails.ts`) went with `end_agent`: nothing ends a
  // conversation any more.
  {
    name: 'RESOURCE_RAILS',
    module: 'resources/resources.ts',
    rails: RESOURCE_RAILS,
    arms: (rail) => [refuseResource(rail as never).reason],
  },
  // 🔴 **D-042 · the one seam an agent's choice of model passes** — `give_work`'s and
  // `create_agent`'s `model`/`effort`, answered in the same `refused (<rail>): <sentence>` row.
  {
    name: 'MODEL_RAILS',
    module: 'runtime/model-rails.ts',
    rails: MODEL_RAILS,
    arms: (rail) =>
      (MODEL_DETAILS[rail as (typeof MODEL_RAILS)[number]] ?? [{}]).map(
        (detail) => refuseModel(rail as never, detail).reason,
      ),
  },
]

/**
 * ⚑ **The sentences a door says INSTEAD of its table's** — `{ ...refuse…, reason: X }` —
 * `675`'s two per-caller sentences, `663`'s three wake-only ones, `690`'s two wake-door ones,
 * `698`'s third, and `703`'s held-rail sentence for a WORK call the next rail would refuse. ⛔
 * Named by the identifier the
 * code spreads in, so the scan below can prove this list is every one there is.
 */
const OVERRIDES: readonly {
  readonly key: string
  readonly rail: string
  readonly spreadAs: string
  readonly sentence: string
}[] = [
  {
    key: 'WORK_SEARCH_RAILS|work-search-invalid/past-work',
    rail: 'work-search-invalid',
    spreadAs: 'refusalReason',
    sentence: pastWorkSearchRefusal('invalid').reason,
  },
  {
    key: 'WORK_SEARCH_RAILS|work-search-unavailable/past-work',
    rail: 'work-search-unavailable',
    spreadAs: 'refusalReason',
    sentence: pastWorkSearchRefusal('unavailable').reason,
  },
  // The longest fixed file-kind wording retains the summary action inside the cut.
  {
    key: 'RESOURCE_RAILS|resource-not-a-form-this-app-keeps/reply-file-kind',
    rail: 'resource-not-a-form-this-app-keeps',
    spreadAs: 'replyUnkeptFileReason',
    sentence: replyUnkeptFileReason('/fictional/file.unrecognised'),
  },
  // ⚑ **D-017** — `675`'s two per-caller sentences went (`THIS_ONE_IS_YOURS_TO_WAKE` at
  // `message_agent`, `THE_ASKER_IS_YOURS_TO_WAKE` with `the-conversation-that-asked-has-ended`):
  // a message or an answer starts a stopped conversation itself, so there is nothing to wake.
  // ⚑ **D-017 · commit 3** — `690`'s two wake-door sentences (`IT_CANNOT_TAKE_A_MESSAGE_EITHER`,
  // `A_WAKE_OF_ITSELF`) and `663`'s three wake-only spawn ones (`A_WAKE_WITH_NO_PARENT_RUNNING`,
  // `aWakeTooDeep`, `aWakeWiderThanItsParent`) went with `resume_agent`: a message starts a stopped
  // conversation, and no wake door is left to say them.
  // ⚑ **716 · R66 — the three that say WHICH a person must fix**: a folder at a spawn, and a program
  // or a folder at a wake — each in place of its word's own sentence, which names a program or three
  // causes.
  {
    key: 'TOOL_REFUSALS|agent-could-not-be-started/a-folder',
    rail: 'agent-could-not-be-started',
    spreadAs: 'A_FOLDER_COULD_NOT_BE_MADE',
    sentence: A_FOLDER_COULD_NOT_BE_MADE,
  },
  {
    key: 'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-program',
    rail: 'that-conversation-could-not-be-resumed',
    spreadAs: 'A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN',
    sentence: A_WAKE_WHOSE_PROGRAM_COULD_NOT_RUN,
  },
  {
    key: 'TOOL_REFUSALS|that-conversation-could-not-be-resumed/a-folder',
    rail: 'that-conversation-could-not-be-resumed',
    spreadAs: 'A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE',
    sentence: A_WAKE_WHOSE_FOLDER_COULD_NOT_BE_MADE,
  },
  // ⚑ **724 · `717` F-2 — a wake whose folder is gone**, said as one.
  {
    key: 'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-folder-is-gone',
    rail: 'that-conversation-could-not-be-resumed',
    spreadAs: 'A_WAKE_WHOSE_FOLDER_IS_GONE',
    sentence: A_WAKE_WHOSE_FOLDER_IS_GONE,
  },
  // 🔴 **D-039 · R2 — a start its PROVIDER refused, said as one**, at the give and at a wake: each
  // word's own sentence names a program (or three causes), and until D-039 this was a broken tool
  // carrying the provider's raw `{"code":-32600,…}`. ⚑ Keyed by the closed reason the classifiers
  // give (`because: 'its-provider-refused-it'`); the provider's words are in the detail, never here.
  {
    key: 'TOOL_REFUSALS|agent-could-not-be-started/its-provider-refused-it',
    rail: 'agent-could-not-be-started',
    spreadAs: 'A_PROVIDER_REFUSED_THE_START',
    sentence: A_PROVIDER_REFUSED_THE_START,
  },
  // ⚑ A start refused on the agent's sign-in, or its Codex settings, said with what a person does
  // first — at its longest, a Codex sign-in at a give.
  {
    key: 'TOOL_REFUSALS|agent-did-not-start/its-sign-in-or-settings',
    rail: 'agent-did-not-start',
    spreadAs: 'aStartItsLoginOrSettingsRefused',
    sentence: aStartItsLoginOrSettingsRefused('sign-in', 'codex', 'give'),
  },
  {
    key: 'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-provider-refused-it',
    rail: 'that-conversation-could-not-be-resumed',
    spreadAs: 'A_WAKE_ITS_PROVIDER_REFUSED',
    sentence: A_WAKE_ITS_PROVIDER_REFUSED,
  },
  // ⚑ **F059 · `update_work` on a piece that has ended, said with how, when and by whom** — its
  // word's own sentence names no ending. The giver's case, whose act is the longest of its three:
  // planted at its longest — a 64-character name, and an ending on another day, said with its date.
  {
    key: 'TOOL_REFUSALS|that-piece-has-ended/how-it-ended',
    rail: 'that-piece-has-ended',
    spreadAs: 'anEndedPieceSaid',
    sentence: anEndedPieceSaid(
      {
        piece: 'work_1',
        label: 'W3.4.1.2',
        state: 'answered',
        at: 0,
        called: LONG_SLUG,
        yoursToRetitle: true,
      },
      3 * 24 * 60 * 60_000,
    ),
  },
  // ⚑ **F087 · a follow-up naming a piece the caller holds, or gave another agent**, said as what it
  // is — the word's own sentence guesses the name may belong to nothing. Planted with a deep label;
  // the act comes first, so no label can push it past the cut.
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-hold',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aFollowUpOnAPieceYouHold',
    sentence: aFollowUpOnAPieceYouHold('W3.4.1.2.1.1'),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-gave-another',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aFollowUpOnAPieceYouGaveAnother',
    sentence: aFollowUpOnAPieceYouGaveAnother('W3.4.1.2.1.1'),
  },
  // A follow-up naming a piece the caller neither gave nor holds: a note to the same agent. Planted
  // with the longest address an agent has, its id.
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-did-not-give',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aFollowUpOnAPieceYouDidNotGive',
    sentence: aFollowUpOnAPieceYouDidNotGive('sess_0123456789abcdef0123456789abcdef'),
  },
  // An agent's profile name with several conversations in reach, at its longest: five labels named.
  {
    key: 'TOOL_REFUSALS|that-agent-has-several-conversations/their-labels',
    rail: 'that-agent-has-several-conversations',
    spreadAs: 'anAgentWithSeveralConversations',
    sentence: anAgentWithSeveralConversations(
      'a-profile-name-of-forty-characters-long',
      Array.from({ length: 7 }, (_, at) => `W3.4.1.2.1.${at + 1}`),
    ),
  },
  // ⚑ A message about a piece still queued at a service, said with its label.
  {
    key: 'TOOL_REFUSALS|that-piece-is-still-queued/its-label',
    rail: 'that-piece-is-still-queued',
    spreadAs: 'aMessageAboutAQueuedPiece',
    sentence: aMessageAboutAQueuedPiece('W3.4.1.2.1.1'),
  },
  // ⚑ **F089 · a take-back of a piece the caller holds**, open, ended, or its root — said as what it
  // is. The ended arm at its longest: taken back by a 64-character name, on another day.
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-a-piece-you-hold',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aTakeBackOfAPieceYouHold',
    sentence: aTakeBackOfAPieceYouHold('W3.4.1.2.1.1'),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-a-piece-you-hold-that-ended',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aTakeBackOfAPieceYouHoldThatEnded',
    sentence: aTakeBackOfAPieceYouHoldThatEnded({
      is: 'ended',
      label: 'W3.4.1.2.1.1',
      state: 'withdrawn',
      at: 0,
      called: LONG_SLUG,
      readAt: 3 * 24 * 60 * 60_000,
    }),
  },
  {
    key: 'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-your-own-work',
    rail: 'not-a-piece-you-gave',
    spreadAs: 'aTakeBackOfYourOwnWork',
    sentence: aTakeBackOfYourOwnWork('W3'),
  },
  // A take-back or a close that cannot end the copies passed up of the piece's questions, said with
  // its label. Planted with a deep label.
  {
    key: 'TOOL_REFUSALS|a-conversation-with-its-questions-is-starting/its-label',
    rail: 'a-conversation-with-its-questions-is-starting',
    spreadAs: 'aPieceNotEndedWhileAQuestionStarts',
    sentence: aPieceNotEndedWhileAQuestionStarts('W3.4.1.2.1.1', 'work-withdrawn'),
  },
  {
    key: 'TOOL_REFUSALS|its-questions-could-not-all-be-read/its-label',
    rail: 'its-questions-could-not-all-be-read',
    spreadAs: 'aPieceNotEndedItsQuestionsUnread',
    sentence: aPieceNotEndedItsQuestionsUnread('W3.4.1.2.1.1', 'work-withdrawn'),
  },
  // ⚑ **F091 · `interrupt_agent` naming the conversation that calls it** — `that-agent-is-you`, with
  // an interrupt's acts in place of a message's.
  {
    key: 'TOOL_REFUSALS|that-agent-is-you/an-interrupt',
    rail: 'that-agent-is-you',
    spreadAs: 'A_CONVERSATION_CANNOT_INTERRUPT_ITSELF',
    sentence: A_CONVERSATION_CANNOT_INTERRUPT_ITSELF,
  },
  {
    key: 'TOOL_REFUSALS|that-agent-is-you/an-ask',
    rail: 'that-agent-is-you',
    spreadAs: 'A_CONVERSATION_CANNOT_ASK_ITSELF',
    sentence: A_CONVERSATION_CANNOT_ASK_ITSELF,
  },
  {
    key: 'TOOL_REFUSALS|that-agent-is-you/with-helper-guidance',
    rail: 'that-agent-is-you',
    spreadAs: 'aSelfAddressSaid',
    sentence:
      refuseTool('that-agent-is-you', { agent: 'sess_self' }).reason +
      ' W1.2 is your own piece, with no helpers recorded under it. list_agents names who you can reach.',
  },
  // ⚠️ **D-039 · `THE_NEW_AGENT_WAS_MADE` is not an override**, and the scan below cannot see it: a
  // give with `new: true` whose launch failed says it AFTER its word's own sentence (or one of the
  // give's two overrides, `A_FOLDER_COULD_NOT_BE_MADE` and `A_PROVIDER_REFUSED_THE_START` — never a
  // wake's: `aWakeRefused` never appends it), as a template literal (`aLaunchRefused`), so the act
  // each row is measured by keeps its place. ⛔ Its own act — *give to it without new* — sits past
  // the cut on all six launch rows (ending at 262 to 391), so a person's 200-character row never
  // shows it; the model that called reads the row whole.
]

/** 🔴 **Every sentence a refusal row can carry**, each through the builder that makes it. */
function everyRow(): Row[] {
  const rows: Row[] = []
  for (const vocabulary of VOCABULARIES) {
    for (const rail of vocabulary.rails) {
      const arms = vocabulary.arms(rail)
      arms.forEach((sentence, index) =>
        rows.push({
          key: `${vocabulary.name}|${rail}${arms.length > 1 ? `/${index + 1}` : ''}`,
          rail,
          row: rowOf(rail, sentence),
        }),
      )
    }
  }
  for (const one of OVERRIDES)
    rows.push({ key: one.key, rail: one.rail, row: rowOf(one.rail, one.sentence) })
  return rows
}

/**
 * ⚑ **The act, per sentence** — ⛔ **ONE rule, applied to every row**: an act is a thing the refused
 * caller can DO, or who ELSE must act for the call to pass, with any condition on it. ⚠️ **A clause
 * that says only that retrying will not help is not an act** — *"Retrying this will never succeed"*,
 * *"No call you can make moves it back inside"* — and a row that says only that is in
 * {@link NO_ACT} (the review found this census counting the same clause both ways). ⛔ A substring of
 * the sentence, so a reworded act fails here as `not-in-the-row` rather than passing on a clause that
 * moved.
 */
const ACT: Readonly<Record<string, string>> = {
  'WORK_SEARCH_RAILS|work-search-invalid/past-work': 'Use one to 20 search words',
  'WORK_SEARCH_RAILS|work-search-unavailable/past-work': 'Try again',
  'WORK_SEARCH_RAILS|work-search-invalid':
    'Use a listed scope and state, at most 20 words, and a limit from 1 to 50',
  'WORK_SEARCH_RAILS|work-search-cursor-invalid': 'Start the search again',
  'WORK_SEARCH_RAILS|work-search-unavailable': 'Try again',
  'WORK_SEARCH_RAILS|work-search-busy': 'Try again in a moment',
  'REPLY_RAILS|result-document-not-returned':
    'must be a Markdown file or page listed in resource_paths',
  // ⚑ **D-017 · R12** — said only about an id no conversation has; the act names what reaches.
  'TOOL_REFUSALS|no-such-agent': 'list_agents names the ones you can reach',
  'TOOL_REFUSALS|that-conversation-takes-no-messages': 'list_agents names the ones you can reach',
  'TOOL_REFUSALS|that-agent-has-several-conversations':
    'make the same call with agent set to one of that agent\u2019s conversations',
  'TOOL_REFUSALS|that-agent-has-several-conversations/their-labels':
    'make the same call with agent set to one of',
  'TOOL_REFUSALS|malformed-request': 'The problems are listed in the detail',
  'TOOL_REFUSALS|agent-cannot-take-a-message':
    'ask a person to inspect why that conversation cannot take a message',
  'TOOL_REFUSALS|that-conversation-has-not-started': 'make the same call again in a moment',
  'TOOL_REFUSALS|a-conversation-with-its-questions-is-starting': 'Try again in a moment',
  'TOOL_REFUSALS|a-conversation-with-its-questions-is-starting/its-label': 'Try again in a moment',
  'TOOL_REFUSALS|its-questions-could-not-all-be-read': 'Try again; if it fails again, ask a person',
  'TOOL_REFUSALS|its-questions-could-not-all-be-read/its-label':
    'Try again; if it fails again, ask a person',
  'REPLY_RAILS|a-conversation-with-its-questions-is-starting': 'Try again in a moment',
  'REPLY_RAILS|its-questions-could-not-all-be-read': 'Try again; if it fails again, ask a person',
  // ⚑ **D-012** — `read_transcript`'s two words: the other door, inside the cut.
  'TOOL_REFUSALS|not-a-conversation-below-you':
    'To ask any other agent something, use ask_question',
  'TOOL_REFUSALS|that-agent-is-you': 'do it yourself — or send it to another agent',
  'TOOL_REFUSALS|that-agent-is-you/with-helper-guidance':
    'do it yourself — or send it to another agent',
  // ⚑ **F091** — its own work is its own to stop, and another agent is named instead.
  'TOOL_REFUSALS|that-agent-is-you/an-interrupt':
    'Stop your own work yourself, or name another agent to interrupt',
  'TOOL_REFUSALS|that-agent-is-not-below-you': 'Call message_agent again without interrupt',
  // ⚑ **D-016 · commit 3** — `agent-already-has-work-open` went with the one-open-task rail; the
  // stall rule (`SPAWN_RAILS|its-work-has-stalled`) replaced it until a give came to
  // name a stall instead of refusing.
  'TOOL_REFUSALS|spawning-disabled': 'no retry will pass until they switch it back on',
  'TOOL_REFUSALS|agent-did-not-start':
    'ask a person to read the detail and decide whether to start that conversation again',
  'TOOL_REFUSALS|agent-took-too-long-to-start': 'make the same call again',
  // ⚑ 707 · R39, extended — the wake's act (`705`), first and inside the cut at the spawn door.
  'TOOL_REFUSALS|agent-could-not-start-just-now': 'Make the same call again in a moment',
  // ⚑ **710 · R51** — the wake's permanent act (below), at the spawn's door.
  'TOOL_REFUSALS|agent-could-not-be-started':
    'Starting it again will not help until a person has looked',
  // ⚑ **716 · R66** — the folder's sentence and the wake's two that say which: the same acts.
  'TOOL_REFUSALS|agent-could-not-be-started/a-folder':
    'Starting it again will not help until a person has looked',
  // ⚑ **D-039 · R2** — the same act at a give whose provider refused the start: *Giving*, since a
  // give is what the caller would repeat; what it may do meanwhile comes after it, past the cut.
  'TOOL_REFUSALS|agent-could-not-be-started/its-provider-refused-it':
    'Giving it again will not help until a person has looked',
  // ⚑ A start refused on the agent's sign-in, or its Codex settings: what a person does, first.
  'TOOL_REFUSALS|agent-did-not-start/its-sign-in-or-settings':
    'Ask a person to save an API key on the Codex card in Providers',
  'TOOL_REFUSALS|may-not-create-agents': 'ask a person to grant agent creation',
  'TOOL_REFUSALS|agent-name-taken': 'Choose a different name, or use the agent that exists',
  'TOOL_REFUSALS|services-are-off-so-none-is-made': 'A person turns them on in Team',
  // ⚑ **D-016 · commit 3** — the task words became piece words, and a new piece is a give.
  'TOOL_REFUSALS|not-a-piece-you-gave': 'list_tasks lists the open pieces you gave out',
  // ⚑ **F087** — the same call as a note, or to the agent holding the piece.
  'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-hold': 'make the same call with kind note',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-gave-another': 'make the same call with agent',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-piece-you-did-not-give': 'send it as kind note to',
  'TOOL_REFUSALS|that-piece-is-still-queued': 'Change its brief with update_work',
  'TOOL_REFUSALS|that-piece-is-still-queued/its-label': 'Change its brief with update_work',
  // ⚑ **F089** — the doors open to work the caller holds, or nothing more owed, or the person.
  'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-a-piece-you-hold':
    'to hand it back finished, call reply_to_parent; to ask about it, call ask_question naming it',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-a-piece-you-hold-that-ended':
    'stop work on that piece',
  'TOOL_REFUSALS|not-a-piece-you-gave/a-take-back-of-your-own-work':
    'ask a person with ask_question naming it, and answer the person here when it is done',
  'TOOL_REFUSALS|that-piece-was-already-answered':
    'Read the reply first; for genuinely new work, give it with give_work',
  'TOOL_REFUSALS|no-piece-by-that-name': 'list_tasks names the open pieces you hold and gave',
  // ⚑ **D-016 · commit 5** — said at `message_agent` and at `update_work` now, so *nothing was done*
  // and then the act, in one clause.
  'TOOL_REFUSALS|that-is-your-own-work':
    'ask a person with ask_question naming it, and answer the person here when it is done',
  'TOOL_REFUSALS|the-start-it-waited-on-did-not-happen': 'Give it again: that starts a new one',
  'TOOL_REFUSALS|the-giver-names-a-piece':
    'To have it called something else, ask it; you may set its status line',
  // ⚑ A status line, a new brief, a close or kept files is what was refused (D-016 · commit 5); the
  // title is the one thing `update_work` still changes on an ended piece.
  'TOOL_REFUSALS|that-piece-has-ended': 'Only its title may still be changed',
  'TOOL_REFUSALS|that-piece-has-ended/how-it-ended': 'read its answer with list_tasks',
  // ⚑ **D-016 · commit 5** — said at `withdraw_task` and at `update_work`'s close; the act is the same.
  'TOOL_REFUSALS|that-work-is-being-sent': 'make this call again once it has gone',
  // ⚑ **D-016 · commit 5 · a new word chose an act** — the owner asks, since only a giver briefs and
  // closes; what the owner may do itself comes after it, past the cut. ⚑ **Commit 6** — *Ask*, not
  // *Ask it*: a piece a person gave has no giving conversation, and its question goes to a person.
  'TOOL_REFUSALS|the-giver-briefs-and-closes-a-piece':
    'Ask with ask_question to change or stop the work',
  // An agent request goes through give_work; an unavailable work read can be retried.
  'TOOL_REFUSALS|no-work-of-your-own': 'Use give_work',
  'TOOL_REFUSALS|work-record-unavailable': 'Try again',
  // ⚑ **F009 · a new word chose an act** — spell a profile the roster holds (192 characters whole;
  // its act ends at 84).
  'TOOL_REFUSALS|no-agent-by-that-name': 'name an agent by the profile list_profiles gives it',
  // Restoring an archived conversation: each refusal names what to do next (the first one's act
  // ends at 195 of 200).
  'TOOL_REFUSALS|that-conversation-is-not-archived':
    'list_agents with archived: true names the archived ones you can reach',
  'TOOL_REFUSALS|it-is-being-archived-or-deleted': 'Call this tool again once that is done',
  'TOOL_REFUSALS|it-could-not-be-restored': 'Tell the person',
  // Asking the person to register an MCP server: each refusal leads with what to do instead.
  'TOOL_REFUSALS|server-already-registered':
    'ask the person with ask_question (a-person) to grant it to your profile',
  'TOOL_REFUSALS|server-already-asked-for': 'wait for the person to decide',
  'TOOL_REFUSALS|too-many-server-requests': 'wait until one is decided',
  'TOOL_REFUSALS|may-not-write-rules': 'You can propose a change with propose_agent_rules',
  'TOOL_REFUSALS|may-not-relay-a-rule':
    'Ask again without claiming it was already agreed, and a person will decide',
  'TOOL_REFUSALS|that-is-work-you-hold':
    'call ask_question naming that piece; to hand it back finished, call reply_to_parent',
  'TOOL_REFUSALS|that-conversation-is-still-stopping': 'Make the same call again in a moment',
  // ⚑ **D-017** — *Sending* again, not *Waking*: a delivery starts a stopped conversation.
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed':
    'Sending again will not help until a person has looked',
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-program':
    'Sending again will not help until a person has looked',
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed/a-folder':
    'Sending again will not help until a person has looked',
  // ⚑ 724 · `717` F-2 — the folder it ran in is gone.
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-folder-is-gone':
    'Sending again will not help until a person has looked',
  // ⚑ **D-039 · R2** — a wake its provider refused: the wake's act, the same at every door.
  'TOOL_REFUSALS|that-conversation-could-not-be-resumed/its-provider-refused-it':
    'Sending again will not help until a person has looked',
  // ⚑ 705 · R39 — the act first, and inside the cut with the rail's 45 characters counted.
  'TOOL_REFUSALS|that-conversation-could-not-be-woken-just-now':
    'Make the same call again in a moment',
  'SPAWN_RAILS|malformed-request': 'Send exactly the fields this tool documents',
  'SPAWN_RAILS|its-provider-is-not-chosen': 'Ask a person to choose a provider for',
  'SPAWN_RAILS|spawning-disabled': 'Only a person can switch it back on',
  'SPAWN_RAILS|no-piece-to-give-from': 'Do the work here until you hold a piece',
  // PE-006: a give names no mode the caller can change; the person who can decide is named first.
  'SPAWN_RAILS|name-the-piece-you-give-from': 'give again naming it as piece',
  'SPAWN_RAILS|no-piece-you-hold-by-that-name': 'list_tasks names what you hold',
  'SPAWN_RAILS|too-deep': 'Do it yourself, or ask whoever gave you your piece',
  'SPAWN_RAILS|parallel-not-for-a-service': 'Leave parallel out to queue the work',
  'SPAWN_RAILS|no-free-worker-at-capacity': 'Give it again when one is free',
  'SPAWN_RAILS|worker-binding-is-unknown': 'Tell a person, and give it again once that is fixed',
  'SPAWN_RAILS|that-profile-exists': 'Give without new to use it',
  'SPAWN_RAILS|services-are-off': 'Do the work yourself, or give it to another agent',
  'SPAWN_RAILS|its-kind-is-unknown': 'Give the work to another agent, or ask a person',
  'SPAWN_RAILS|that-is-this-conversation': 'Do this part within the piece you are working on',
  'SPAWN_RAILS|it-would-wait-on-itself': 'Finish or take back that work, then give this again',
  'SPAWN_RAILS|its-waits-cannot-all-be-checked':
    'Give the work to another agent, or give it again once some of the work',
  'SPAWN_RAILS|its-record-cannot-be-read': 'Give the work to another agent',
  'SPAWN_RAILS|may-not-create-agents': 'Give to an agent list_profiles names, or ask a person',
  'SPAWN_RAILS|no-such-profile': 'check the spelling',
  'SPAWN_RAILS|folder-unusable': 'only a person can make it right',
  // ⚑ **D-038 · the act moved to the front, and changed**: the work here, or the GIVER's own mode —
  // an agent has no mode of its own, and no provider it could be moved to changes the verdict now.
  'SPAWN_RAILS|wider-than-its-parent/1':
    'Do this work here, or ask a person whether to change your approval mode',
  'SPAWN_RAILS|wider-than-its-parent/2':
    'Do this work here, or ask a person whether to change your approval mode',
  'MESSAGE_RAILS|may-not-message': 'ask one, or do the work yourself',
  // ⚑ **D-014** — a note, a follow-up or `ask_question`: since D-010 no message is a question.
  // ⚑ **D-016 · commit 3** — work is given with `give_work`, so this is `give_work`'s wall;
  // `assign-work-to-one-you-did-not-start` went with message_agent's `work` kind.
  'MESSAGE_RAILS|may-not-assign-work':
    'Send it as a note, ask with ask_question, or do the work yourself',
  'REPLY_RAILS|no-piece-by-that-name': 'list_tasks names the pieces you hold',
  // ⚑ **D-016 · commit 3** — a root is a person's gift, so its answer goes to the person.
  'REPLY_RAILS|a-person-gave-that-piece': 'answer the person here',
  'REPLY_RAILS|piece-already-ended/1': 'stop work on that piece',
  'REPLY_RAILS|piece-already-ended/2': 'stop work on that piece',
  'REPLY_RAILS|piece-already-ended/3': 'stop work on that piece',
  'REPLY_RAILS|piece-already-ended/4': 'stop work on that piece',
  // ⚑ **731** — the act names no folder: a resource path takes a file anywhere since `726`.
  // ⚑ **736** — and names the kinds of file the store holds (`733` F-4), rendered from its list.
  'REPLY_RAILS|summary-too-long':
    'Put the rest in a Markdown file, a page, an image or a PDF and name its path in resource_paths',
  'QUESTION_RAILS|no-question-by-that-name': 'list_questions names the requests you can answer',
  'QUESTION_RAILS|a-person-answers-this-one': 'that one is a person’s to settle',
  'QUESTION_RAILS|that-answer-cannot-be-sent':
    'Answer every part it asks about, choosing one of its options unless it takes an answer of your own',
  // ⚑ **679 · a new word chose an act** — the same call, with the field that tells two askers apart.
  'QUESTION_RAILS|more-than-one-question-has-that-id':
    'make the same call again with asked_by set to one of the conversations the detail lists',
  'QUESTION_RAILS|that-conversation-did-not-ask-that':
    'make the same call again with asked_by set to one of the conversations the detail lists',
  'QUESTION_RAILS|no-open-work-by-that-name': 'list_tasks names the pieces you hold',
  // ⚑ **D-016 · commit 3** — a question names the piece it is about.
  'QUESTION_RAILS|name-the-piece-you-ask-about': 'ask again naming it as piece',
  'QUESTION_RAILS|no-piece-to-ask-about': 'A question to another agent needs no piece',
  'QUESTION_RAILS|nobody-to-pass-it-up-to': 'Pass it to a person with a-person instead',
  // ⚑ **D-009 · F012's three**, each with its act inside the cut.
  'QUESTION_RAILS|no-agent-you-can-ask-by-that-name': 'list_agents names the agents you can ask',
  'QUESTION_RAILS|a-question-asked-of-you-by-name-is-yours':
    'it is yours to answer — or to say you cannot, with answer_question and cannot_answer',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/1': 'Use the id ask_question returned',
  // ⚑ **F020** — the caller's own question, answered or declined: the act is to read the answer.
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/2': 'stop here and read its answer',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/3':
    'end this turn to read its answer before you report on that question',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/4':
    'read its answer, which was sent to you as a message',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/5':
    'end this turn to read its answer before you report on that question',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/6':
    'stop here and read the reply declining it',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/7':
    'end this turn to read the reply declining it before you report on that question',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/8':
    'read the reply declining it, which was sent to you as a message',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/9':
    'end this turn to read the reply declining it before you report on that question',
  // ⚑ The act first; the length and the limit after it.
  'QUESTION_RAILS|answer-too-long/1':
    'shorten your answer, or put the long form in a file and name its full path in your answer',
  'QUESTION_RAILS|answer-too-long/2':
    'shorten your answer, or put the long form in a file and name its full path in your answer',
  'QUESTION_RAILS|answer-too-long/3':
    'shorten your reason, or put the long form in a file and name its full path in cannot_answer',
  'INTERRUPT_RAILS|a-person-is-being-asked':
    'carry on with something else, or say that you are blocked on it',
  'INTERRUPT_RAILS|that-conversation-has-not-started': 'ask again in a moment',
  // ⚑ **D-017 · R19** — the caller's own act if it is the conversation that ends the wait; who that
  // is comes before it, in the state.
  'INTERRUPT_RAILS|it-is-waiting-on-an-answer': 'If that is you, answer it with answer_question',
  // ⚑ **D-017 · R12** — the doors that reach further than interrupting.
  'INTERRUPT_RAILS|not-below-you': 'To ask it something use ask_question',
  // ⚑ **D-016 · commit 3** — `DOCUMENT_RAILS` became `RESOURCE_RAILS`: a reply's files are kept as
  // resources, and the registry's words (projects, tasks, registration, the tree) went with it.
  // ⚑ **726 · R92** — the act no longer says *inside this conversation’s working directory*.
  'RESOURCE_RAILS|resource-unreadable': 'Write a file and offer that path instead',
  // ⚑ **731** — the act keeps the work and names its path; the folder is a habit after it (`726` §9).
  // ⚑ **D-016 · commit 5** — door-neutral: a reply, a give's inputs and `update_work` all say it, so
  // the path is named in *what you write*, not in a reply's summary.
  'RESOURCE_RAILS|resource-not-a-form-this-app-keeps/reply-file-kind':
    'Name its full path in summary',
  'RESOURCE_RAILS|resource-not-a-form-this-app-keeps':
    'Keep it where it is and name its full path in what you write',
  'RESOURCE_RAILS|resource-too-large': 'Write a file and offer that path instead',
  'RESOURCE_RAILS|resource-empty': 'Write a file and offer that path instead',
  'RESOURCE_RAILS|resource-not-text': 'Write a file and offer that path instead',
  'RESOURCE_RAILS|resource-could-not-be-kept':
    'Trying again will not help until a person sorts out what stopped it',
  'RESOURCE_RAILS|no-such-resource': 'check the id in the reply or piece record',
  'RESOURCE_RAILS|resource-bytes-missing': 'ask a person to restore the file',
  'RESOURCE_RAILS|resource-bytes-changed': 'ask a person to check or restore the file',
  'RESOURCE_RAILS|resource-bytes-unreadable':
    'Asking again will not help until a person has looked',
  'RESOURCE_RAILS|resource-store-unavailable':
    'Trying again will not help until a person sets it up',
  // ⚑ **D-042 · a new vocabulary, and every word chose an act** — each sentence leads with it.
  // ⚠️ The list a person keeps, and what a person may change, come after the act, past the cut at
  // the longest; the act is what to pick, or who must look.
  'MODEL_RAILS|model-not-in-the-list': 'Pick a model from Claude’s list',
  'MODEL_RAILS|effort-not-offered/1': 'Leave effort out',
  // ⚑ The model is planted at its longest INSIDE the act, so the act's end moves with it.
  'MODEL_RAILS|effort-not-offered/2': `Pick an effort “${LONG_MODEL}” offers`,
  // ⚑ **D-050** — `model-outside-the-limit` and `effort-above-the-limit/1–3` went with the agents'
  // limit.
  'MODEL_RAILS|models-unavailable/1': 'Ask a person to check Claude',
  'MODEL_RAILS|models-unavailable/2': 'Name a model too',
  'MODEL_RAILS|models-unavailable/3': 'Ask a person to check Claude',
  'MODEL_RAILS|models-not-read-in-time/1': 'Give again in a moment',
  'MODEL_RAILS|models-not-read-in-time/2': 'Give again in a moment',
  'MODEL_RAILS|name-the-model-too': 'Name the model too',
  'MODEL_RAILS|the-provider-moved-meanwhile': 'Give again',
  'TOOL_REFUSALS|theme-is-built-in': 'Save it under a new id',
  'TOOL_REFUSALS|theme-exists': 'Set replace to true to replace it',
  'TOOL_REFUSALS|theme-unknown': 'Call list_themes to see the themes this app can use',
  'TOOL_REFUSALS|theme-too-large': 'Use fewer or smaller files',
}

/**
 * ⛔ **The sentences that carry NO act, each with why — a FINDING kept in view, not a pass.**
 *
 * ⚠️ Every one fits under the bound whole, so the cut is not what they lack: they state what
 * happened and stop. ⚑ `675` did not invent acts for them — that is sentence work of its own, and
 * a guessed act is worse than none (`a-priced-cost-can-name-a-remedy-that-does-not-exist`).
 */
const NO_ACT: Readonly<Record<string, string>> = {
  'QUESTION_RAILS|move-offer-not-available':
    'the request cannot be offered; the sentence names no repeatable act',
  'QUESTION_RAILS|move-offer-is-held':
    'the current request is being recorded; the separate remedy names when to repeat the call',
  'QUESTION_RAILS|move-offer-needs-a-person':
    'restoring availability belongs to a person; this sentence gives the caller no act',
  'TOOL_REFUSALS|theme-invalid':
    'the remedy is in separate problem lines, not an act in this sentence',
  'TOOL_REFUSALS|that-agent-is-you/an-ask':
    'a conversation cannot ask itself; no question was recorded',
  'TOOL_REFUSALS|that-piece-was-already-taken-back':
    'what the caller asked for already holds — there is nothing left to do',
  // ⚑ **D-016 · commit 5** — its twin, for a piece the caller closed with `update_work`.
  'TOOL_REFUSALS|that-piece-was-already-closed':
    'what the caller asked for already holds — there is nothing left to do',
  // Known endings require no withdrawal; there is no further act to repeat.
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/10': 'the question already ended',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/11': 'the question was already withdrawn',
  'QUESTION_RAILS|no-open-question-you-asked-by-that-name/12': 'the question already ended',
  // These endings say why no further answer is owed; none offers a repeatable act.
  'QUESTION_RAILS|question-has-already-ended':
    'the question ended, so no further answer is owed or repeatable',
  'QUESTION_RAILS|the-conversation-that-asked-has-gone':
    'the asking conversation is gone, so no further answer is owed or repeatable',
  'QUESTION_RAILS|this-app-does-not-hold-those-words':
    'the original words are gone, so the same id cannot be passed up',
  // The approved words say only whose piece the service is on; the act is its remedy, the same
  // stop once that piece has ended.
  'INTERRUPT_RAILS|that-service-is-on-another-callers-piece':
    'the service is on another caller’s piece; the same stop goes once that piece has ended',
}

/**
 * ⛔ **The no-act rows that run past the cut**, pinned BY NAME so a new one is a decision rather than a
 * drift. ⚑ What the cut takes from each is the why, never an act — they have none.
 */
const NO_ACT_PAST_THE_BOUND: readonly string[] = [
  // Every current no-act sentence fits whole, including its reason why nothing remains to do.
]

describe('675 · the act inside the cut', () => {
  const rows = everyRow()

  it('⚑ the bound is the one the normalizers cut at, and it is not a formality', () => {
    expect(TOOL_SUMMARY_MAX).toBe(200)
    // ⛔ **The count's premise**: rows DO run over the bound, so "inside" is a measurement.
    expect(rows.filter((one) => one.row.length > TOOL_SUMMARY_MAX).length).toBeGreaterThan(40)
  })

  it('🔴 every sentence is accounted for — an act, or a line in NO_ACT — and never both', () => {
    const keys = rows.map((one) => one.key).sort()
    expect(new Set(keys).size, 'two rows share a key').toBe(keys.length)
    const accounted = [...Object.keys(ACT), ...Object.keys(NO_ACT)].sort()
    expect(accounted).toEqual(keys)
    for (const key of Object.keys(NO_ACT)) expect(ACT, key).not.toHaveProperty(key)
  })

  for (const row of everyRow()) {
    const act = ACT[row.key]
    if (act === undefined) continue
    it(`⛔ ${row.key} — its act ends inside the first ${TOOL_SUMMARY_MAX} characters`, () => {
      expect(whereTheActSits(row.row, act), row.row).toBe('inside')
    })
  }

  it('⚠️ …and the ones with no act that run past the cut are exactly the ones named', () => {
    expect(
      rows
        .filter((one) => NO_ACT[one.key] !== undefined && one.row.length > TOOL_SUMMARY_MAX)
        .map((one) => one.key)
        .sort(),
    ).toEqual([...NO_ACT_PAST_THE_BOUND].sort())
  })

  it('🔴 731 · no refusal makes a FOLDER part of its act — a folder is named only in the factory habit', () => {
    // ⛔ On `main` two did: `DOCUMENT_RAILS|resource-not-a-document` (*"Keep it in the project folder
    // and name its path…"*) and `REPLY_RAILS|summary-too-long` (*"…in a Markdown file in your working
    // directory…"*). The PM, ruling on `726` §9: where a file goes is a habit, *"never a condition for
    // anything to work"* — and since `726` `resource_path` takes a file anywhere.
    const habit = 'Use the assigned folder.'
    const namesAFolder = (sentence: string): boolean =>
      /working directory|working folder|project folder/i.test(sentence.split(habit).join(''))
    expect(rows.filter((one) => namesAFolder(one.row)).map((one) => one.key)).toEqual([])
    // ⚑ The census can fail — both old sentences, planted, are caught, and the habit alone is not.
    expect(
      namesAFolder('Keep it in the project folder and name its path in your summary instead.'),
    ).toBe(true)
    expect(namesAFolder('Put the long form in a Markdown file in your working directory.')).toBe(
      true,
    )
    expect(
      namesAFolder(`Keep it where it is and name its full path in what you write. ${habit}`),
    ).toBe(false)
  })

  it('🔴 the predicate CAN fail — an act planted past the cut, and one planted missing', () => {
    // ⛔ Standing rule 12: the control plants TWO, and a census nobody has made fail is a census
    // nobody has measured. The same sentence three ways, so only the act's position differs.
    const padding = 'x'.repeat(TOOL_SUMMARY_MAX)
    const act = 'call list_tasks'
    expect(whereTheActSits(rowOf('planted', `${act}. ${padding}`), act)).toBe('inside')
    expect(whereTheActSits(rowOf('planted', `${padding} ${act}.`), act)).toEqual({
      past: rowOf('planted', `${padding} ${act}`).length,
    })
    expect(whereTheActSits(rowOf('planted', padding), act)).toBe('not-in-the-row')
    // ⚑ The boundary itself: an act ending ON character 200 is read whole (the cut is `>`).
    const exact = rowOf(
      'p',
      'y'.repeat(TOOL_SUMMARY_MAX - rowOf('p', '').length - act.length) + act,
    )
    expect(exact).toHaveLength(TOOL_SUMMARY_MAX)
    expect(whereTheActSits(exact, act)).toBe('inside')
    expect(whereTheActSits(`${exact}!`.replace(act, `z${act}`), act)).toEqual({
      past: TOOL_SUMMARY_MAX + 1,
    })
  })

  it('⚑ the parameterised arms are measured at their LONGEST, and EVERY planted value is in the row', () => {
    // ⛔ An arm measured with `?` in place of a 64-character name, or with a short path, would pass
    // a sentence whose act sits AFTER the parameter — the exact defect `not-your-project` had.
    // ⚑ Every string field, not a chosen three (review of `675`: `liveSessionId` sits BEFORE an
    // act, and was the one left out).
    for (const [rail, details] of Object.entries(SPAWN_DETAILS)) {
      details.forEach((detail, index) => {
        const said = refuse(rail as never, detail).reason
        for (const [field, value] of Object.entries(detail)) {
          // ⚑ A list of labels sits BEFORE an act in the give's sentences, so each one is looked for.
          const shown: readonly unknown[] = LABEL_LISTS.has(field)
            ? (value as readonly unknown[])
            : [value]
          for (const one of shown) {
            if (typeof one !== 'string') continue
            expect(said, `${rail}/${index + 1} · ${field}`).toContain(one)
          }
        }
      })
    }
    // ⚑ **D-042 · the model seam's arms, by the same rule** — every list member looked for, the
    // provider by the name a sentence says, and `door` (said as *nothing was given* or *no agent
    // was made*) not looked for.
    for (const [rail, details] of Object.entries(MODEL_DETAILS)) {
      details.forEach((detail, index) => {
        const said = refuseModel(rail as never, detail).reason
        for (const [field, value] of Object.entries(detail)) {
          if (field === 'door') continue
          const shown: readonly unknown[] =
            field === 'provider'
              ? [PROVIDER_NAME[value as keyof typeof PROVIDER_NAME]]
              : MODEL_LISTS.has(field)
                ? (value as readonly unknown[])
                : [value]
          for (const one of shown) {
            expect(typeof one, `${rail}/${index + 1} · ${field}`).toBe('string')
            expect(said, `${rail}/${index + 1} · ${field}`).toContain(one)
          }
        }
      })
    }
  })
})

describe('675 · the vocabularies this census reads are ALL of them', () => {
  /** ⚠️ Prose quotes code, so a census that reads source has to read the code only. */
  const codeOnly = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

  const everyModule = (): { path: string; source: string }[] => {
    const found: { path: string; source: string }[] = []
    const walk = (dir: string, base: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full, base)
        else if (entry.name.endsWith('.ts')) {
          found.push({ path: relative(base, full), source: readFileSync(full, 'utf8') })
        }
      }
    }
    walk(mainRoot, mainRoot)
    walk(sharedRoot, join(sharedRoot, '..'))
    return found
  }

  /**
   * ⛔ **`what-an-agent-is-told-about-its-work.test.ts`' own derivation**: a module that names one of
   * `RAIL_PERMANENCES` in its CODE prices rails, so it is a vocabulary — derived from what the code
   * does rather than from a list written here (`27.1`: a census scoped by where things live today
   * expires silently).
   */
  const namesAPermanence = (source: string): boolean =>
    RAIL_PERMANENCES.some((word) => codeOnly(source).includes(`'${word}'`))

  /** Modules that only read a refusal's permanence to say it in words; they price no rail. */
  const CONSUMERS: readonly string[] = ['runtime/agent-tool-answer-words.ts']

  it('🔴 every module that prices a rail is read above, and nothing else is', () => {
    const modules = everyModule()
    const pricing = modules
      .filter((file) => namesAPermanence(file.source))
      .map((file) => file.path.split('\\').join('/'))
      .sort()
    // Read each vocabulary, the shared definitions and the theme wrapper's repeated clauses.
    const themeTools = codeOnly(readFileSync(join(mainRoot, 'themes/agent-tools.ts'), 'utf8'))
    expect(themeTools).toContain('PERMANENCE_SAID.permanent')
    expect(themeTools).toContain("PERMANENCE_SAID['while-this-holds']")
    expect(pricing).toEqual(
      [
        ...VOCABULARIES.map((one) => one.module),
        'shared/refusals.ts',
        'themes/agent-tools.ts',
        ...CONSUMERS,
      ].sort(),
    )
    for (const path of CONSUMERS) {
      const found = modules.find((one) => one.path.split('\\').join('/') === path)
      const code = codeOnly(found?.source ?? '')
      const named = RAIL_PERMANENCES.flatMap((word) => code.split(`'${word}'`).slice(1))
      const compared = RAIL_PERMANENCES.flatMap((word) =>
        code.split(new RegExp(`[!=]==\\s*'${word}'`)).slice(1),
      )
      expect(named.length, `${path} names no permanence`).toBeGreaterThan(0)
      expect(compared.length, `${path} prices a rail`).toBe(named.length)
    }
  })

  /**
   * 🔴 **Every sentence a door says INSTEAD of its table's is read above** — found by what the code
   * DOES, `{ ...<a refusal>, reason: <X> }`, and compared with {@link OVERRIDES} by the name it is
   * spread as (review of `675`: the first version listed them by hand, and a sixth would have gone
   * unmeasured).
   */
  const theOverridesIn = (source: string): string[] =>
    [
      ...codeOnly(source).matchAll(
        /\{\s*\.\.\.(?:[^{}]|\{[^{}]*\})*?,\s*reason:\s*([A-Za-z_$][\w$]*)/g,
      ),
    ].map((match) => match[1] ?? '')

  /**
   * ⚠️ **A `reason` that is not a refusal's**, found by the scan and named rather than scoped away:
   * the library's *why this row cannot be resumed*, drawn for a person, never carried in a refusal
   * row; and the schedule planner's *why a job's time is not known* (`found`, in
   * `shared/schedule-receipts.ts`), which no refusal carries either.
   */
  const NOT_A_REFUSALS_REASON = ['whyNotResumable', 'found']

  it('🔴 every refusal sentence a door says in place of its table’s is in the census', () => {
    const spread = everyModule()
      .flatMap((file) => theOverridesIn(file.source))
      .filter((name) => !NOT_A_REFUSALS_REASON.includes(name))
    expect([...new Set(spread)].sort()).toEqual(
      [...new Set(OVERRIDES.map((one) => one.spreadAs))].sort(),
    )
    // ⚑ The exception is still there to be excepted — a name that no longer occurs is a claim
    // about nothing.
    for (const name of NOT_A_REFUSALS_REASON) {
      expect(everyModule().flatMap((file) => theOverridesIn(file.source))).toContain(name)
    }
  })

  it('⚠️ …and the scan finds two planted overrides, and none in prose', () => {
    const planted = [
      `const a = { ...refuse('x'), reason: A_NEW_SENTENCE }\n`,
      `return { ...refuseTool('y', { agent }), reason: anotherOne(detail) }\n`,
      `/** { ...refuse('z'), reason: ONLY_IN_A_DOCBLOCK } */\n`,
    ]
    expect(planted.flatMap(theOverridesIn)).toEqual(['A_NEW_SENTENCE', 'anotherOne'])
  })

  it('⚠️ …and the derivation finds a planted vocabulary, and no commented one', () => {
    const planted = [
      { path: 'runtime/a-new-door.ts', source: `const P = { a: 'permanent' as const }\n` },
      { path: 'runtime/another-door.ts', source: `const Q = { b: 'while-this-holds' as const }\n` },
      { path: 'runtime/prose.ts', source: `/** it is 'until-a-person-changes-it'. */\n` },
    ]
    expect(planted.filter((one) => namesAPermanence(one.source)).map((one) => one.path)).toEqual([
      'runtime/a-new-door.ts',
      'runtime/another-door.ts',
    ])
  })
})
