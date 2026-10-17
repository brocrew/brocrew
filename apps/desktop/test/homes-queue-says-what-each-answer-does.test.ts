import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { PermissionOutcome } from '@brobot2/runtime'
import { permissionDecisionFor } from '../src/renderer/src/lib/permission-offer'
import {
  userInputOffer,
  whatThisAnswerDoes,
  type AttentionDecision,
  type ConsentAsked,
} from '../src/renderer/src/lib/user-input-offer'
import type { UserInputRequestEvent } from '../src/renderer/src/lib/transcript'

/**
 * # 🔴 481 · one sentence, one place, two surfaces
 *
 * ⛔ **HO-030 §2 put criterion 20's third clause on Home's queue**, which means the sentence a
 * person reads under a button is drawn in more than one place. ⚠️ **That is exactly the shape
 * `214` §3, `299` §1, `464` and `470` were each paid for**: one fact about a request, written down
 * twice, in two files, free to drift — and the last of those fixed the class by making the sentence
 * a FIELD of the thing it describes rather than a table beside it.
 *
 * ⚑ **So the dispatch's §5.2 asks for a test that fails if they diverge, and there are two halves
 * to that.** The painted half — both surfaces drawing one decision set and saying the same words —
 * is `test/dom/homes-queue-says-what-each-answer-does.dom.test.ts`. **This file is the structural
 * half**: neither component may CONTAIN one of these sentences, whatever it then draws.
 *
 * ⛔ **A census that reads prose is a census that lies** (`a-source-census-must-strip-prose-before-
 * it-asserts`: a docblock quoting the call it retired turned one red). So the search runs over
 * source with its comments removed — and the control below proves the stripper did not simply eat
 * the file, which is the other way this could pass over nothing.
 */

/**
 * ⛔ **Every component that DRAWS the sentence**, and the list grows with the ruling — `482` is
 * putting it on the cards, and a card added to this array is the whole of what that costs here.
 * ⚠️ **Not derived by walking the tree**: a walk that found no component would pass this file
 * silently, and a named list is a claim somebody has to keep true.
 */
const COMPONENTS = ['AttentionQueue.vue', 'PersonsQueue.vue'] as const

const sourceOf = (file: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../src/renderer/src/components/${file}`, import.meta.url)),
    'utf8',
  )

/**
 * ⚠️ **Block comments, line comments and TEMPLATE comments**, because a `.vue` file has all three
 * and this repository's components carry more prose than code.
 */
const withoutComments = (text: string): string =>
  text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')

/**
 * ⛔ **Every member of {@link AttentionDecision}, keyed so a new one does not compile** — the same
 * device the vocabulary itself uses. ⚠️ A plain array would let a sixth kind arrive with no
 * sentence under census, which is `a-loop-over-a-literal-variant-list-is-not-exhaustive`.
 */
const EVERY_OUTCOME = {
  allow: 0,
  allow_for_session: 0,
  allow_all_for_session: 0,
  // ⚑ 736 · R95
  allow_always: 0,
  deny: 0,
  cancel: 0,
} as const satisfies Readonly<Record<PermissionOutcome, 0>>

const EVERY_CONSENT = {
  'access-for-this-turn': 0,
  'start-planning': 0,
  'stop-planning': 0,
  'a-consent-this-window-cannot-name': 0,
} as const satisfies Readonly<Record<ConsentAsked, 0>>

const asking = (questions: UserInputRequestEvent['questions']): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_481',
  prompt: 'the agent asks',
  questions,
})

/** Every decision any surface can offer, built by the two production offer functions. */
function everyDecision(): AttentionDecision[] {
  const permissions = (Object.keys(EVERY_OUTCOME) as PermissionOutcome[]).map((outcome) => ({
    kind: 'permission' as const,
    label: outcome,
    decision: permissionDecisionFor(outcome),
  }))
  const consents = (Object.keys(EVERY_CONSENT) as ConsentAsked[]).map((consent) => ({
    kind: 'approve' as const,
    label: 'Approve',
    consent,
  }))
  const answered = userInputOffer(
    asking([{ id: 'release', prompt: 'Which release?', options: [{ label: 'Current' }] }]),
  ).decisions
  return [...permissions, ...consents, ...answered]
}

describe('481 · the sentence Home draws is the one the vocabulary owns', () => {
  it('🔴 every answer any surface can offer has its own non-empty sentence, and no two share one', () => {
    const sentences = everyDecision().map(whatThisAnswerDoes)
    // ⛔ **Non-empty, per `467`'s instinct**: a blank effect line reads as *no consequence*, which
    // is a claim, and the worst one to make by omission.
    for (const sentence of sentences) expect(sentence.trim().length).toBeGreaterThan(0)
    // ⚑ **And distinct** — `an-enumeration-whose-members-must-differ-needs-a-distinctness-check`.
    // Two answers sharing a sentence is how one card came to carry three effects under one line,
    // which is the defect `478` was sent at.
    expect(new Set(sentences).size).toBe(sentences.length)
  })

  it('⛔ neither surface CONTAINS one of them — the sentence lives where it is composed', () => {
    const sentences = everyDecision().map(whatThisAnswerDoes)
    for (const file of COMPONENTS) {
      const code = withoutComments(sourceOf(file))
      // ⚑ **The positive first, so the negative below is about this file rather than about an
      // empty string**: the component reaches the vocabulary, once, by calling it.
      expect(code, file).toContain('whatThisAnswerDoes(decision)')
      for (const sentence of sentences)
        expect(code, `${file} spells: ${sentence}`).not.toContain(sentence)
    }
  })

  it('⚠️ …and the search really would find one — the control the negative above leans on', () => {
    const sentence = whatThisAnswerDoes({ kind: 'reject', label: 'Reject' })
    // ⛔ **Plant it the way a second copy would arrive** — in the template, in a `<small>`, with a
    // docblock beside it — and the same two steps find it.
    const planted = withoutComments(
      `<!-- ${sentence} -->\n<template><small>${sentence}</small></template>`,
    )
    expect(planted).toContain(sentence)
    // ⚠️ **A copy that lived ONLY in a comment is not a second copy and must not read as one.**
    expect(withoutComments(`/** ${sentence} */`)).not.toContain(sentence)
    // 🔴 **And the stripper did not simply eat the components.** Without this the census above
    // passes over an empty string for every file — `a-filter-can-blind-the-instrument-that-
    // justifies-it`, in two lines of regex.
    expect(withoutComments(sourceOf('AttentionQueue.vue'))).toContain('Nothing needs you.')
    expect(withoutComments(sourceOf('PersonsQueue.vue'))).toContain('pq-answer')
  })
})
