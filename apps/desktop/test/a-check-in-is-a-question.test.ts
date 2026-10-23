import { describe, expect, it } from 'vitest'
import {
  composeProfileBundle,
  NOT_IN_THE_FACTORY_TEXT,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import {
  TOOL_NAMES,
  TOOL_PERMANENCE,
  TOOL_REFUSALS,
  toolRemedyOf,
  refuseTool,
} from '../src/main/runtime/agent-tools'
import { PERMANENCE_SAID, RAIL_PERMANENCES } from '../src/shared/refusals'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { TASK_STATES } from '../src/shared/tasks'
import { theConversationCalled } from '../src/shared/piece-called'

/**
 * # 🔴 A check-in is a question, and a refusal names what to do instead (628, `HO-095` §3)
 *
 * ⛔ **One wrong sentence cost five things**, and the fifth was a false lesson written into
 * BroBot's own permanent memory. `HO-095` §3, verbatim:
 *
 * > ⚠️ ***"Send me the plan with `message_agent` as a question — not `reply_to_parent`. Do not
 * > close this task."***
 *
 * ⚑ **The worry was correct and the remedy was wrong.** This file holds the two halves of the fix
 * the PO put together — *"the first is a hope, the second catches it when the hope fails"*:
 *
 *  - **§1** — the shared factory text says it conditionally, when an agent holds work.
 *  - **§2** — 🔴 **the rail neither half had**: every tool name the composed text mentions is a
 *    tool this app actually publishes. `402`'s defect class, measured rather than reviewed.
 *  - **§3** — the refusal names a performable act, and `§4` of the brief's criterion is that the
 *    act is reachable BY THE REFUSED CALLER rather than merely present in a string.
 *  - **§5** — `HO-095` §3.4: *"this call can never succeed"*, seconds before one succeeded.
 */

/** A root conversation holding the one default set, and its own root piece (D-016). */
const context = (over: Partial<InstructionContext> = {}): InstructionContext => ({
  profileSlug: 'somebody',
  cwd: '/tmp/work',
  startedBy: null,
  depth: 0,
  capabilities: DEFAULT_CAPABILITIES,
  spawningEnabled: true,
  root: 'W1',
  // ⚑ **D-024 · R1 — required**: the profile's other conversations. None here, which renders no
  // line at all — the list is not this file's subject.
  others: { shown: [], more: 0 },
  ...over,
})

/**
 * ⚑ **The launches whose composed text differs** (D-014: there are no roles, so every agent gets
 * the same rules). What still changes the bundle is where the conversation stands and whether this
 * app can name its identity: a conversation it cannot name gets no grant lines at all.
 * ⚑ **D-024 · R1 — where it stands now moves only this conversation's own text**; the profile's
 * file moves with the grants alone, so the identity this app cannot name still moves both.
 */
/**
 * The conversation a spawned launch was started by, named the way the dynamic layer renders it: its
 * agent's name and the piece it owns (D-016 · commit 7).
 */
const STARTED_BY = theConversationCalled('Ada', { label: 'W1', title: 'Bakery website' })

const LAUNCHES = {
  'a conversation a person opened': {},
  // ⚑ D-016 · a conversation another agent started owns no root.
  'a conversation another agent started': {
    startedBy: STARTED_BY,
    depth: 1,
    root: null,
  },
  'a conversation this app cannot name': { profileSlug: null, capabilities: null },
} as const satisfies Record<string, Partial<InstructionContext>>

const EVERY_LAUNCH = Object.keys(LAUNCHES) as (keyof typeof LAUNCHES)[]

/**
 * The composed text for one launch, with the widest grants this app can give an identity.
 *
 * ⚑ **D-024 · R1 — two compositions now, and this reads both**: the profile's own file
 * (`composeProfileBundle` — the factory rules and the person's text) and this conversation's own
 * text, sent with its launch (`thisConversationSpans` — `## This conversation` and `## What you
 * have been granted`, which left the file). ⛔ §2's census is over the words an agent is GIVEN, and
 * the dynamic layer still names a tool (`update_work`, in the root line): the file alone would leave
 * that name uncounted.
 */
const bundleFor = (launch: keyof typeof LAUNCHES): string => {
  const launched = context({
    // ⚑ **The WIDEST grants an identity can hold**, so every branched sentence in the factory
    // text is rendered and §2's census walks the whole surface rather than the narrow arm.
    capabilities: { ...DEFAULT_CAPABILITIES, canWriteRules: 'relay' as const },
    ...LAUNCHES[launch],
  })
  return `${composeProfileBundle(launched)}${thisConversationSpans(launched).text}`
}

describe('§1 · ⛔ the factory text says which verb a check-in is', () => {
  it('🔴 every agent is told that a decision it needs is asked with ask_question', () => {
    // The core says which verb a check-in is; the ask-and-wait skill says the rest — a decision
    // on a held piece, what to ask a person, and how a question about a piece is answered.
    for (const launch of EVERY_LAUNCH) {
      expect(bundleFor(launch), `${launch} is not told what a check-in is`).toContain(
        "Ask your questions with ask_question, even to agents; notes expect none. request_action tracks the person's actions. Never guarantee replies.",
      )
    }
  })

  it('⛔ …and no other verb is offered for it: the core names no hand-back', () => {
    // A check-in read as a hand-back would end the piece it asks about.
    for (const launch of EVERY_LAUNCH) {
      expect(bundleFor(launch), `${launch} is offered reply_to_parent`).not.toContain(
        'reply_to_parent',
      )
    }
  })

  it('⚠️ the new rules name no state, because the state this app has is not called `asking`', () => {
    // ⛔ **`HO-095` §3 says the question tool *"keeps the task open in the asking state"* and there
    // is no such state.** 🔴 The vocabulary spells the three waits `waiting-on-an-answer`,
    // `waiting-on-a-person` and `waiting-on-a-worker`; `603` argued against naming a state after
    // who owes the answer, and the code kept that.
    expect(TASK_STATES).not.toContain('asking')
    expect(TASK_STATES).toContain('waiting-on-an-answer')
    // ⚑ **So the sentence describes what happens to the WORK and never names a state** — HO-015
    // §2: where an agent must know a fact about the system it comes from the dynamic layer.
    for (const launch of EVERY_LAUNCH) {
      expect(bundleFor(launch), `${launch} is told a state name`).not.toContain('asking state')
    }
  })

  it('⚑ …and the new sentences trip none of the words this file forbids', () => {
    // ⚠️ **The control that makes the assertion mean something**: the list is non-empty and the
    // check really reads the composed text.
    expect(NOT_IN_THE_FACTORY_TEXT.length).toBeGreaterThan(3)
    for (const launch of EVERY_LAUNCH) {
      const text = bundleFor(launch).toLowerCase()
      expect(text.length).toBeGreaterThan(500)
      for (const forbidden of NOT_IN_THE_FACTORY_TEXT) {
        expect(text, `${launch} says "${forbidden}"`).not.toContain(forbidden)
      }
    }
  })
})

/**
 * 🔴 **§2 · the rail `HO-095` §3's whole chain needed and nothing had.**
 *
 * ⛔ **`402` measured the defect class**: a factory-text sentence naming a verb this app refuses is
 * an instruction an agent cannot follow, and *"a rule an agent cannot follow does not fail loudly;
 * it fails per-model."* ⚑ **Every branch in `factory-text.ts` exists to avoid it and NOTHING
 * asserted the result** — the names in the composed text were never compared against the tools this
 * app publishes.
 *
 * ⚠️ **A grep for a name would not be this**, which is the same argument `TOOL_NAMES`' own docblock
 * makes about the negative it measures: the census walks every `snake_case` token the composed text
 * contains and asks the list, so a sentence naming `ask_parent` — the name this verb had until
 * `611` — is caught without anybody adding a case for it.
 */
describe('§2 · 🔴 every tool the factory text names is a tool this app publishes', () => {
  /**
   * ⛔ **A `snake_case` word, which is the shape every tool in this app is named in.** ⚠️ It over-
   * collects by design — `can_message` is not a tool — so the census subtracts a
   * named, argued exemption list rather than narrowing the pattern until only tools survive.
   */
  const SNAKE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g

  /**
   * ⚑ **Not tools, and each is here for a stated reason** — a column, a grant word, or a piece of
   * this app's own vocabulary a sentence renders.
   *
   * ⛔ **An exemption list is where this census could go quiet**, so it is short, it is named, and
   * §2's second test plants a word that is NOT on it.
   */
  const NOT_A_TOOL = new Set([
    // ⚑ Capability COLUMNS, which the dynamic layer renders from `CAPABILITY_FIELDS`. ⛔ Only the
    // kept ones (D-014): a column nothing reads any more is not exempt, so a sentence naming one
    // fails here.
    'can_message',
    'can_assign_work',
    'can_create_agents',
    'can_write_rules',
    // ⚑ A field the work tools take, named in the core's sentence on give_work and take_on_work.
    'definition_of_done',
    // ⚑ D-016 · `same_project` was exempt here and went with projects, so a sentence naming it
    // fails now.
    // ⚑ D-016 · commit 7 · the spawned launch's parent was exempt here while the launch line named
    // it by its `sess_…` id, which this pattern always matches; it is named by the piece it owns
    // now, so nothing of it is exempt and a snake_case word in that line fails here.
  ])

  const toolsNamedIn = (text: string): string[] =>
    [...new Set(text.match(SNAKE) ?? [])].filter((word) => !NOT_A_TOOL.has(word))

  it('⛔ …on every launch, and the census really found some', () => {
    const published = new Set<string>(TOOL_NAMES)
    let found = 0
    for (const launch of EVERY_LAUNCH) {
      const named = toolsNamedIn(bundleFor(launch))
      found += named.length
      for (const word of named) {
        expect(published.has(word), `${launch} names \`${word}\`, which is no tool of ours`).toBe(
          true,
        )
      }
    }
    // 🔴 **Non-vacuity, and it is the whole point of the census.** A pattern that matched nothing,
    // an exemption list that swallowed everything, or a bundle that failed to compose all produce a
    // clean pass — `a-negative-is-only-as-strong-as-the-search-shape`, and `34`'s shape one layer
    // up: a check that cannot run and a check that found nothing look identical.
    expect(found, 'the census named no tools at all').toBeGreaterThan(4)
  })

  it('🔴 the control: TWO planted names are BOTH reported', () => {
    // ⛔ **Two, never one** (standing rule 12). A census that read only the first token per text
    // would pass this with one plant and is exactly the defect it exists to catch.
    //
    // ⚠️ **`ask_parent` is the first plant and it is not hypothetical**: it is the name
    // `ask_question` carried until `611` renamed it, so a sentence written from `HO-095`'s
    // narrative rather than from the code would have shipped it.
    const planted = `Ask with ask_parent, and finish with hand_off_work when you are done.`
    const named = toolsNamedIn(planted)
    expect(named).toEqual(['ask_parent', 'hand_off_work'])
    const published = new Set<string>(TOOL_NAMES)
    expect(named.filter((word) => published.has(word))).toEqual([])
    // ⚑ **And the same sweep passes the real sentence**, so the plant above is being caught by the
    // membership test rather than by the pattern refusing everything.
    expect(toolsNamedIn('ask for it with ask_question, naming that piece')).toEqual([
      'ask_question',
    ])
    expect(published.has('ask_question')).toBe(true)
  })
})

describe('§3 · ⛔ the refusal names a performable act — in the caller’s own vocabulary', () => {
  const sentenceOf = (rail: (typeof TOOL_REFUSALS)[number]): string => refuseTool(rail, {}).reason

  it('🔴 `that-is-work-you-hold` names BOTH verbs, and says what each does to the work', () => {
    // ⛔ **`HO-096` §2.2's shape, copied rather than its principle** — the model refusal is
    // *"it can shorten the summary and put the long form in a file it names"*: an act, performable,
    // in the caller's own words.
    const said = sentenceOf('that-is-work-you-hold')
    expect(said).toContain('ask_question')
    expect(said).toContain('reply_to_parent')
    expect(said).toContain('stays yours and stays open')
    expect(said).toContain('ends it')
    // ⚠️ **It says what was NOT done**, which every sentence in this table says and which a caller
    // must never have to guess.
    expect(said).toContain('nothing was sent')
  })

  it('⛔ …and every verb it names is one this app publishes — criterion 4', () => {
    // 🔴 **The brief's criterion 4: the remedy is REACHABLE BY THE REFUSED CALLER, not merely
    // present in the string.** ⚠️ `a-priced-cost-can-name-a-remedy-that-does-not-exist` is the
    // failure this is measured against, and `402` is the same shape one layer down: a refusal
    // telling a worker to use a tool only a manager holds is a remedy that does not exist.
    const said = sentenceOf('that-is-work-you-hold')
    const named = [...new Set(said.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])]
    expect(named.length, 'the sentence named no verb at all').toBeGreaterThan(1)
    for (const word of named) {
      expect(TOOL_NAMES as readonly string[], `\`${word}\` is no tool of ours`).toContain(word)
    }
    // ⚑ **Two verbs, and each is reachable by the caller standing in front of this refusal.**
    // ⛔ `ask_question` declares `beyondItsRails: 'nothing-its-rails-do-not-cover'` and
    // `reply_to_parent` has shipped in the worker text since `393` — neither asks a grant.
    // ⚠️ **D-016 · the sentence no longer names `message_agent`**: it says what a follow-up is
    // about (a piece given to somebody else) in words, so no gated verb is named at all — `402`'s
    // defect is a template instructing an identity whose grant the template never saw.
    expect(named.sort()).toEqual(['ask_question', 'reply_to_parent'])
  })

  it('⚠️ the remedy FIELD is null, and the biconditional is what decided it', () => {
    // ⛔ **`REFUSAL_REMEDIES`: *"a rail carries an act if and only if this app can retry it."***
    // ⚑ `may-not-relay-a-rule` is the precedent word for word: *"The SENTENCE tells the caller it
    // may ask; the remedy field would promise this call could be replayed, and it cannot."*
    expect(TOOL_PERMANENCE['that-is-work-you-hold']).toBe('permanent')
    expect(toolRemedyOf('that-is-work-you-hold')).toBeNull()
    // ⚑ **The control**: a rail that IS retryable carries one, so the null above is the
    // biconditional rather than a table nobody filled in.
    expect(TOOL_PERMANENCE['that-work-is-being-sent']).toBe('while-this-holds')
    expect(toolRemedyOf('that-work-is-being-sent')).not.toBeNull()
  })

  it('🔴 relay 1’s table, pinned: the rails that carried no act are permanent and silent', () => {
    // Assert that `no-task-you-gave-that-agent` carries a remedy; callers need an actionable
    // way to recover from this refusal.
    //
    // 🔴 **The asymmetry IS the partition, and this is it as a measurement**: every rail in that
    // run that populated the field is `while-this-holds`, and the one that did not is `permanent`.
    // ⚠️ **Pinned by NAME rather than by a count**, so the docblock beside `TOOL_REMEDY`'s new
    // entry — which reproduces this table — cannot go quietly stale.
    // ⚑ **D-010 retired the run's `agent-already-has-a-message-waiting`** — a conversation holds
    // any number of messages now — ⛔ **and D-016 retired `agent-already-has-work-open` with the
    // one-open-task rail**: a busy conversation takes a piece now, and `give_work`'s
    // `its-work-has-stalled` carries the act in `SPAWN_RAILS`. So the retryable half of the run's
    // table has no rail left in this one, and what is pinned is the half that remains.
    //
    // ⛔ **The one that did not carry an act** (`no-task-you-gave-that-agent` in the run, called
    // `not-a-piece-you-gave` since D-016), plus the rail this dispatch split off it — both
    // `permanent`, both silent, for the same stated reason.
    for (const rail of ['not-a-piece-you-gave', 'that-is-work-you-hold'] as const) {
      expect(TOOL_PERMANENCE[rail]).toBe('permanent')
      expect(toolRemedyOf(rail)).toBeNull()
    }
    // ⚑ **`summary-too-long` is the fifth of the run's rails and it is `reply-rails.ts`'** — the
    // model refusal `HO-096` §2.2 told this dispatch to copy. It is asserted in its own file;
    // naming it here would be a second answer about somebody else's table.
  })

  it('⛔ the refusal the PO called correct-and-useless still fires where it is the truth', () => {
    // 🔴 **The new rail takes ONE case and not the family.** An id that names nothing of anybody's
    // is still `not-a-piece-you-gave` (`no-task-you-gave-that-agent` until D-016), and its sentence
    // still names no verb for held work — the repair is a SPLIT, which is `that-agent-is-you`'s own
    // shape (`424`).
    const said = sentenceOf('not-a-piece-you-gave')
    expect(said).toContain('not a piece you gave')
    expect(said).toContain('list_tasks')
    expect(said).not.toContain('ask_question')
  })
})

describe('§4 · ⚑ the vocabulary is closed, and the new member declares everything', () => {
  it('⛔ every rail has a permanence, a sentence and a remedy decision', () => {
    // ⚠️ **The exhaustive `Record`s are compile errors and this is the runtime half** — a rail
    // added to the union with a table left short cannot reach here, and a rail whose SENTENCE is
    // empty compiles perfectly.
    expect(TOOL_REFUSALS).toContain('that-is-work-you-hold')
    for (const rail of TOOL_REFUSALS) {
      expect(TOOL_PERMANENCE[rail], `${rail} has no permanence`).toBeTruthy()
      expect(refuseTool(rail, {}).reason.length, `${rail} has no sentence`).toBeGreaterThan(30)
    }
  })
})

describe('§5 · 🔴 `HO-095` §3.4 — a sentence that was true of the ARGUMENTS and read as the ACT', () => {
  it('⛔ `permanent` scopes itself to the EXACT call, and leaves the remedy to the rail', () => {
    // 🔴 **The transcript read *"this call can never succeed · retrying will not help"* and seconds
    // later a call succeeded.** ⚑ **The word that was missing had been in the vocabulary since
    // `405`** — `RAIL_PERMANENCES`' own entry is *"This EXACT call can never succeed. Change the
    // call, not the world."* — so the rendered clause was a lossy copy of the definition beside it.
    expect(PERMANENCE_SAID.permanent).toBe('this exact call can never succeed')
    // ⛔ **The REMEDY half of the definition stays out**, and that is a measurement rather than a
    // half-done repair: `466` gave this table a second reader that TALLIES — *"How long each is
    // expected to hold: 1 · <clause>"* — and a remedy inside a count tells a person to change a
    // call they are reading a summary of. ⚑ Each rail's own `reason` is where *what to change*
    // lives, per call.
    expect(PERMANENCE_SAID.permanent).not.toContain('change the call')
  })

  it('⚠️ …and it is the ONLY member this dispatch moved — `627` owns the one beside it', () => {
    // ⛔ **`HO-096` §2.4 calls *while this holds* internal vocabulary and `627` owns the wording.**
    // ⚑ A dispatch rewording a neighbour it was not sent for is how two seats produce two
    // vocabularies — so this pins the boundary rather than the words themselves.
    // ⚠️ **`627` LANDED between this dispatch's branch and its rebase**, and it moved this very
    // member: `'while this holds'` was the enum key with its hyphens taken out, which `HO-096`
    // §2.4 called internal vocabulary. ⛔ **The boundary is what is pinned, not the words** — so
    // the assertion follows `627`'s value rather than freezing a string that is theirs to move.
    expect(PERMANENCE_SAID['while-this-holds']).toBe('only while the reason lasts')
    expect(PERMANENCE_SAID['until-a-person-changes-it']).toBe('until somebody changes it')
    // ⚑ **The control**: the table is exhaustive over the vocabulary, so a member added tomorrow
    // arrives with a clause rather than as `undefined` in a sentence about a refusal.
    expect(Object.keys(PERMANENCE_SAID).sort()).toEqual([...RAIL_PERMANENCES].sort())
  })
})
