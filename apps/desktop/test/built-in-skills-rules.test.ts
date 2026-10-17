import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The rules the app's own text used to give every agent, and that the core leaves to a skill:
 * each is held here by its exact sentence in the skill body that carries it, so a rule cannot
 * leave the skills without a test going red. The core itself is held by the factory-text tests.
 */
const resources = resolve(import.meta.dirname, '../resources/built-in-skills')
const body = (name: string): string =>
  readFileSync(resolve(resources, name, 'SKILL.md'), 'utf8').replace(/\s+/g, ' ')

/** The person's "ok" to a question is a go-ahead for what it proposed. */
const OK_IS_A_GO_AHEAD =
  'When the person answers "ok" to your question, take it as a go-ahead for what that question proposed.'
/** A decision question carries the default an "ok" accepts, when one is safe. */
const PROPOSE_A_DEFAULT =
  'Put a safe proposed default in a decision question; "ok" accepts that proposal.'
/** What only the person saw or heard gets no default. */
const NO_DEFAULT_FOR_AN_OBSERVATION =
  'Do not propose a default for an observation only the person can make.'
/** With no safe factual default, the question proposes waiting rather than a guess. */
const WAIT_RATHER_THAN_GUESS =
  'If a required fact has no safe default, propose waiting for it, not a guessed answer.'
/** One question settles one thing, not a bundle of decisions. */
const ONE_FOCUSED_QUESTION =
  'Keep a question focused; do not bundle unrelated decisions to avoid future turns.'

/** Each skill, and the sentences it must carry, in the words it ships with. */
const CARRIED: Readonly<Record<string, readonly string[]>> = {
  'ask-and-wait': [
    // A check-in is a question, and the work stays open.
    'Ask the parent about work it gave you, the person about work they gave you, or a named agent about something it can settle.',
    'Use hand-back for a genuine blocked handover or completion, not to hide a still-needed answer.',
    'Before ending a turn, use ask_question for a decision or observation you need from the person, or request_action for something they must do.',
    'Neither belongs only in chat: chat alone does not track it under Waiting on you.',
    'A useful but non-blocking preference can be asked after dispatch, with a stated default already in use.',
    OK_IS_A_GO_AHEAD,
    PROPOSE_A_DEFAULT,
    NO_DEFAULT_FOR_AN_OBSERVATION,
    WAIT_RATHER_THAN_GUESS,
    ONE_FOCUSED_QUESTION,
    // A question waiting on you.
    'Use list_questions for questions awaiting your answer; your own questions may appear in the turn block or on the work piece.',
    "Return the answer with answer_question on the helper's original id; never create a second question for the same decision.",
    // Stalled work, and what is not a stall.
    'For work reported as not being worked on, read the piece first.',
    'Follow up with its holder when allowed, or deliberately take it back; neither choice requires the other.',
    'An approval wait is not a stalled piece.',
    'An agent cannot approve it or force an interrupt through that wait.',
    'Only the person answers approvals.',
  ],
  'hand-back': [
    'For assigned work, use reply_to_parent once with the outcome the tool supports: done only when the done condition is met; blocked when outside help is needed to finish; failed when nothing further can be tried.',
    'For a file-based result, keep the full detail and relevant evidence in supported files on the piece; a path mentioned only in chat is not a kept file.',
    'The owner keeps project records and integrates corrections.',
    'Reply briefly to the actual reader, with the result or decision first.',
    'The file carries details when there is one.',
    'For a file-free result, put enough in the reply or checkpoint to satisfy the request; do not manufacture a document.',
    // After handback, a read-only re-check is a note.
    'A quick read-only re-check needs no new piece; send a permitted note with its result.',
  ],
  remember: [
    "A useful method should help a later conversation avoid a repeated mistake, not merely recount today's task.",
    'Keep personal facts, project decisions, source excerpts and task evidence on the piece or in permitted person/project memory, separate from methods.',
    "Honor a person's request to update or forget within its scope and the supported mechanism.",
    'Say plainly if a requested save could not be made, and check the result of any permitted write.',
  ],
  delegate: [
    'Use the history that matters; an existing conversation does not automatically know what was said in yours.',
    'Prefer BroCrew agents so the person can see and revisit their work.',
    'Create a new profile only when no suitable one exists and the current permissions allow it.',
    "At every give_work or create_agent handoff, explicitly choose a supported model and an effort level only when offered; respect the person's locked choices.",
    'Routine extraction or mechanical work usually needs less reasoning; ordinary research and planning need proportionate effort; use higher effort for hard trade-offs, costly errors or demonstrated quality failures.',
    // Profiles, which build-a-team carried until it became a pointer to delegate.
    'Name profiles for lasting expertise, not the current task, item or batch.',
    'Reuse them so their knowledge grows.',
  ],
  'build-a-team': ['See delegate for profile reuse, service choice and model settings.'],
  'split-work': [
    'The result owner keeps the whole requested outcome in view.',
    "If a helper's work stalls, inspect that piece and use ask-and-wait; do not duplicate it as a new task.",
  ],
}

describe('the rules the app text left to the skills', () => {
  for (const [name, sentences] of Object.entries(CARRIED)) {
    it(`${name} carries each of its rules, word for word`, () => {
      const text = body(name)
      for (const sentence of sentences) expect(text, `${name}: ${sentence}`).toContain(sentence)
    })
  }

  it('the control: a skill without one of its sentences is caught, and only that one', () => {
    const [first, second] = CARRIED['ask-and-wait'] ?? []
    if (first === undefined || second === undefined) throw new Error('no sentences to plant')
    const without = body('ask-and-wait').replace(first, '')
    const missing = (CARRIED['ask-and-wait'] ?? []).filter((one) => !without.includes(one))
    expect(missing).toEqual([first])
    expect(without).toContain(second)
  })

  it('the control: ask-and-wait without its "ok" paragraph misses exactly its five sentences', () => {
    const sentences = [
      OK_IS_A_GO_AHEAD,
      PROPOSE_A_DEFAULT,
      NO_DEFAULT_FOR_AN_OBSERVATION,
      WAIT_RATHER_THAN_GUESS,
      ONE_FOCUSED_QUESTION,
    ]
    const paragraph = sentences.join(' ')
    const text = body('ask-and-wait')
    expect(text).toContain(paragraph)
    const without = text.replace(paragraph, '')
    const missing = (CARRIED['ask-and-wait'] ?? []).filter((one) => !without.includes(one))
    expect(missing).toEqual(sentences)
  })
})
