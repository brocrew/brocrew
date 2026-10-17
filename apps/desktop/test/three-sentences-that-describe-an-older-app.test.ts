import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import { ANOTHER_CALLER_MAY_REACH_IN } from '../src/renderer/src/lib/standing-grants'

/**
 * 🔴 **634 · the halves of `HO-095` §7's three rows that are not a drawn word.**
 *
 * The removed Home rail row and commander mark have no DOM suite left:
 * `test/dom/three-sentences-that-describe-an-older-app.dom.test.ts` is absent. This file
 * retains the vocabulary of the paragraph Info still draws and explicitly reports the
 * remaining row without changing it.
 */
const here = dirname(fileURLToPath(import.meta.url))
const renderer = join(here, '../src/renderer/src')

/** ⛔ **CODE only** — `a-source-census-must-strip-prose-before-it-asserts`. */
const codeOf = (file: string): string =>
  readFileSync(join(renderer, file), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')

describe('634 · three sentences that described an older app', () => {
  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the rail row's sentence
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the dashboard sentence is gone from the rail, and from nowhere else', () => {
    it('⛔ no renderer file still tells a person Home is a dashboard across active projects', () => {
      // 🔴 **The search shape, stated** (rule 4): the question is not *did I edit `SideRail.vue`*
      // — it is *does this sentence reach a person from anywhere*. ⚑ So the census walks the two
      // files that could draw it: the row that did, and the surface it pointed at. ⚑ **D-016
      // deleted that surface** (`HomeSurface.vue`, with Home), so the second file is the rail's
      // first destination in its place, *Waiting on you*.
      for (const file of ['components/SideRail.vue', 'components/WaitingOnYou.vue']) {
        expect(codeOf(file), `${file} still says it`).not.toContain(
          'Dashboard across active projects',
        )
      }
      // ⚑ **THE CONTROL**: the census can see a sentence this rail really does draw, so the
      // negative above is not an empty read.
      expect(codeOf('components/SideRail.vue')).toContain('Conversations from here')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the commander sentences
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the paragraph behind Info’s commander row', () => {
    it('⛔ the paragraph answers the third question, which nothing answered before', () => {
      // ⚠️ **The PO asked three things**: whether the conversation will move, whether his own
      // messages compete, whether it matters. ⚑ This is the second, and it is on the paragraph
      // because that is where detail lives (`527`).
      expect(ANOTHER_CALLER_MAY_REACH_IN).toContain('Your own messages are unaffected')
      // ⛔ **The clauses `395` corrected are untouched**, so this is an addition and not a rewrite
      // of a sentence two dispatches already argued over.
      // ⚠️ **D-014 · one of them moved** — *"What it may do is a grant a person made"* went when
      // ending and stopping stopped reading a grant; *"It can go as far as"* is the clause that
      // still keeps the verbs from reading as a complete list. ⚑ **D-017 · *"and ending it"* went
      // with `end_agent`**: nothing ends a conversation, so the list is the two acts a caller has.
      expect(ANOTHER_CALLER_MAY_REACH_IN).toContain(
        'It can go as far as sending messages here and stopping what this conversation is doing.',
      )
      expect(ANOTHER_CALLER_MAY_REACH_IN).not.toMatch(/\bending it\b/)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the one this dispatch REPORTS
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **§3.1 asked which of two things is true, and it was the first one** — *Take it over and open
   * it* was honest, and there was no read-only path.
   *
   * ⚑ **D-017b · the fork is gone, and so is the gap.** Every conversation opens in its one full view
   * whatever it is doing — held here, running for no window, or drawn from its ledger — so a row
   * offers ONE press in one sentence (`taking-over.ts`). ⛔ The two arms this section walked
   * (`gestureFor`'s claim, `recordingGesture`'s read) went with `closed-threads.ts`, so they are not
   * re-asked here: there is no gesture per process state to ask about.
   */
  describe('§3 · one press opens a conversation, and it is the one full view', () => {
    it('⛔ the label says OPEN, and the press opens through the look — never a take-over first', () => {
      // 🔴 **The press is `openConversation`**, which asks the host to LOOK (`store.look`): one
      // held here is answered at once, one running with no window is taken for this window (a
      // person's press, `claim: true`), and any other is drawn from its ledger — nothing is started.
      expect(OPEN_THE_CONVERSATION).toBe('Open the conversation')
      const screen = codeOf('components/RuntimeScreen.vue')
      const body = screen.slice(screen.indexOf('async function openConversation('))
      expect(body.length, 'the slice found no openConversation body').toBeGreaterThan(200)
      expect(body.slice(0, 400)).toContain('await store.look(sessionId)')
      // ⛔ **And the old fork's take-over is not how it opens**: `takeOver` went with the gesture.
      expect(body.slice(0, 400)).not.toContain('store.claim(')
      expect(screen).not.toContain('async function takeOver(')
    })
  })
})
