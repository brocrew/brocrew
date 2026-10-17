import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { providerSchema, type Provider } from '@brobot2/shared'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import {
  composeProfileBundle,
  NOT_IN_THE_FACTORY_TEXT,
  NO_TEXT_PROMISES_A_WATCHER,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'
import { theConversationCalled, theOwnerOf } from '../src/shared/piece-called'

/**
 * 684 + 686: the core's reader, voice and brevity clauses, pinned across providers; every agent gets
 * one bundle (D-014). Keeping detail in files and giving an agent the whole handover is the
 * hand-back skill's.
 */
const CLAUSES = {
  recipient: 'Address the actual reader',
  person: 'Lead with the answer or needed decision',
  warmth: 'in warm, plain words',
  courtesyKeptBrief: 'Keep greetings and apologies brief',
  noFiller: 'End with the answer or needed question; no offers or filler',
  recapOnlyToHelp: 'Keep recaps useful',
  brief: 'Keep finished files on the piece so agents can find them',
} as const
/** The parent's own piece, which names it in the launch line and the direction line (D-016 · commit 7). */
const THE_PARENTS_PIECE = { label: 'W1', title: 'Bakery website' } as const
/** The conversation a child's launch says started it, named by the piece it owns. */
const STARTED_BY = theConversationCalled('Pat', THE_PARENTS_PIECE)
const OLD_RULE =
  'Give the whole answer. Never truncate it, and never guess at a limit you were not told.'
const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function context(over: Partial<InstructionContext> = {}): InstructionContext {
  return {
    profileSlug: 'reader-test',
    cwd: '/tmp/work',
    startedBy: null,
    depth: 0,
    capabilities: DEFAULT_CAPABILITIES,
    spawningEnabled: true,
    // D-016: a conversation a person started owns a root (unnumbered on its first launch); one
    // another conversation started owns none.
    root: (over.startedBy ?? null) === null ? 'not-yet-numbered' : null,
    // ⚑ D-024 · R1 · no other conversation of the profile.
    others: { shown: [], more: 0 },
    ...over,
  }
}

function delivered(provider: Provider, input: InstructionContext): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot-684-text-'))
  roots.push(root)
  const home = join(root, 'home')
  const cwd = join(root, 'work')
  mkdirSync(home)
  mkdirSync(cwd)
  const launch: InstructionContext = { ...input, cwd }
  const bundle = publishProfileBundle(provider, home, composeProfileBundle(launch))
  expect(bundle.ok).toBe(true)
  // ⚑ D-024 · R1 · what is true of this conversation is composed apart, as `main/index.ts` does.
  const read = readSessionInstructions({
    provider,
    cwd,
    providerHome: home,
    bundle,
    thisConversation: thisConversationSpans(launch),
  })
  // Claude's app-side append is the delivered text. Codex reads its published file itself;
  // this asserts those bytes, not a claim that a hosted model obeyed them. ⚑ D-024 · R1 · and
  // Codex is handed this conversation's own text in front of its first message, so those bytes
  // are delivered too.
  return provider === 'claude'
    ? (read.instructions.composed ?? '')
    : `${readFileSync(bundle.path, 'utf8')}\n${read.firstTurnLead ?? ''}`
}

function missingClauses(text: string): string[] {
  return Object.entries(CLAUSES).flatMap(([name, clause]) => (text.includes(clause) ? [] : [name]))
}

function forbidden(text: string): string[] {
  return NOT_IN_THE_FACTORY_TEXT.filter((word) => text.toLowerCase().includes(word))
}

describe('684 · what reaches a person is short, whatever the provider', () => {
  for (const provider of providerSchema.options) {
    it(`${provider}: person, agent and unknown-reader clauses reach the launch`, () => {
      for (const startedBy of [null, STARTED_BY]) {
        const text = delivered(provider, context({ startedBy, depth: startedBy === null ? 0 : 1 }))
        for (const [name, clause] of Object.entries(CLAUSES)) expect(text, name).toContain(clause)
        expect(text).not.toContain(OLD_RULE)
        expect(forbidden(text)).toEqual([])
        for (const [why, pattern] of Object.entries(NO_TEXT_PROMISES_A_WATCHER))
          expect(text, why).not.toMatch(pattern)
      }
    })
  }

  it('the old text passes the old guards while missing the new obligation', () => {
    const current = composeProfileBundle(context())
    const old =
      current
        .split('\n')
        .filter((line) => !Object.values(CLAUSES).some((clause) => line.includes(clause)))
        .join('\n') + `\n- ${OLD_RULE}`
    expect(forbidden(old)).toEqual([])
    expect(missingClauses(old)).toEqual(Object.keys(CLAUSES))
    expect(missingClauses(current)).toEqual([])
    // Two planted forbidden clauses: a guard that checks only the first hit fails this control.
    expect(forbidden(`${current}\nsummary limit\nrecorded as a failure`)).toEqual([
      'summary limit',
      'recorded as a failure',
    ])
  })

  it('each load-bearing clause has its own failing control; no numeric ceiling is added', () => {
    const text = composeProfileBundle(context())
    for (const [name, clause] of Object.entries(CLAUSES)) {
      expect(missingClauses(text.replace(clause, ''))).toEqual([name])
    }
    const rules = text
      .split('\n')
      .filter((line) => Object.values(CLAUSES).some((clause) => line.includes(clause)))
    expect(rules.join('\n')).not.toMatch(/\d/)
  })

  it('the current sender can be a person even when the launch still names a parent', () => {
    // ⚑ **D-024 · R1 — the launch names its parent in this conversation's own text**, composed for
    // it alone; the profile's file, which a sibling's launch rewrites, names nobody.
    const launch = context({ startedBy: STARTED_BY, depth: 1 })
    const child = thisConversationSpans(launch).text
    expect(child).toContain(`This conversation was started by ${STARTED_BY}.`)
    expect(composeProfileBundle(launch)).not.toContain('This conversation was started by')
    expect(messageNamingItsSender('Status?', THE_PERSON_AT_A_WINDOW)).toContain(
      'You are answering a person.',
    )
    expect(
      messageNamingItsSender(
        'Status?',
        {
          who: 'a-caller-with-an-id',
          caller: 'sess_parent',
          profile: 'parent',
          aPersonIsBehindIt: false,
        },
        () => ({
          name: 'Pat',
          handsYou: null,
          openWorkItGaveYou: ['W1.1'],
          gaveYouWorkThatIsClosed: false,
          // ⚑ D-016 · commit 7 · the giver of W1.1 owns W1, and is addressed by it.
          named: THE_PARENTS_PIECE,
          about: null,
        }),
      ),
    ).toContain(
      // ⚑ W4.187 · by its name alone: the sender line named it in full.
      `The words you write in this turn do not reach Pat, ${theOwnerOf(THE_PARENTS_PIECE)}.`,
    )
    // App-authored input has no sender: never infer a person from the absence of an agent label.
    expect(messageNamingItsSender('Continue.', null)).toBe('Continue.')
  })
})
