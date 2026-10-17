import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import AgentSectionsSheet from '../../src/renderer/src/components/AgentSectionsSheet.vue'
import {
  AGENT_SECTIONS,
  DOORS,
  SECTION_AT_EACH_DOOR,
  sectionsAbsentAt,
  sectionsDrawnAt,
} from '../../src/renderer/src/lib/agent-sections'
import type { AgentInstructionsReading } from '../../src/shared/own-instructions'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, visible } from './harness'

/**
 * 🔴 **626 · the popup's second door, and the rule that keeps the two doors honest**
 * (`EXT-015` §1–§2, `626` relay 2 §3.2 and §4).
 *
 * ## ⛔ What this test is FOR, stated as the defect it prevents
 *
 * ⚠️ **The Team page cannot fill three of the four sections**, and the tempting build is to draw
 * the one it can and leave the rest out. 🔴 **That is the failure the PO has named in four
 * consecutive documents**: an absence a person cannot account for. ⛔ A person who sees no memory
 * section cannot tell *this agent wrote nothing* from *this app cannot read it from here* — and
 * only the second is worth waiting for.
 *
 * ⚑ **So the assertion is not *"the sections render"*. It is that EVERY member of the vocabulary
 * is either DRAWN or ACCOUNTED FOR, with a sentence a person can read** — driven from
 * `AGENT_SECTIONS` itself, so a fifth section cannot be silently absent from this door.
 *
 * ## ⚠️ Why a dom test and not a render test
 *
 * ⛔ **`own-instructions.dom.test.ts`'s reason, one sheet up**: SSR renders markup and has no
 * layout, and *"the sentence is in the DOM"* is satisfied by a sentence nobody can see. ⚑ Every
 * claim below is about something a person perceives.
 */

/** A store that answers one reading — `own-instructions.dom.test.ts`'s fake, narrowed. */
function storeAnswering(reading: AgentInstructionsReading): AgentStore {
  return {
    instructionsFor: async () => reading,
    instruct: async () => null,
    decideInstruction: async () => null,
  } as unknown as AgentStore
}

const NOTHING_WRITTEN: AgentInstructionsReading = {
  own: { identity: 'brobot', versions: [] },
  waiting: [],
  readAt: 1_700_000_000_000,
}

/** ⚑ The column this sheet actually has — its own `min(780px, …)` box, not a window. */
const SHEET = { width: 800, height: 950 }

/**
 * ⛔ **The viewport is SHARED across this project's files** (`dom-project-viewport-is-shared`), so
 * it is set per test and put back in `afterEach`. ⚠️ **Without it every clip reported is `<body>`'s
 * rather than the sheet's** — `own-instructions.dom.test.ts` wrote that sentence after measuring
 * it, and this file measured it again on its first run: 27px past `<body>` on a 780px panel.
 */
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

async function openTheSheet() {
  await page.viewport(SHEET.width, SHEET.height)
  const sheet = mount(
    AgentSectionsSheet,
    { profileSlug: 'brobot', agentName: 'BroBot', store: storeAnswering(NOTHING_WRITTEN) },
    SHEET,
  )
  // ⚠️ **Two ticks: one for `OwnInstructions`' `immediate` watch, one for the render it causes.**
  // A single tick draws its loading state, which is a real state and not the one this file is about.
  await nextTick()
  await nextTick()
  return sheet
}

afterEach(async () => {
  unmountAll()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

describe('626 · what shapes this agent, from the Team page', () => {
  it('🔴 every section is either drawn or accounted for — none is silently missing', async () => {
    const sheet = await openTheSheet()
    await drawnReady()

    // ⛔ **Driven from the vocabulary, never from a list retyped here.** A fifth section added to
    // `AGENT_SECTIONS` walks into this loop on the day it is added — which is the whole point of
    // `626` relay 2 §4: *"a seventh group cannot be silently absent from both doors."*
    for (const section of AGENT_SECTIONS) {
      const block = sheet.q(`agent-section-${section}`)
      assertDrawn(block, `the ${section} section`)
      // ⚑ Its heading is a person's word for it, and it is on screen.
      expect(block.textContent, `${section} draws its heading`).toContain(
        SECTION_AT_EACH_DOOR[section].heading,
      )

      const declared = SECTION_AT_EACH_DOOR[section].at['the-team-page']
      if (declared.drawn) {
        // ⚠️ **A drawn section must draw CONTENT, not just a heading** — a heading over nothing is
        // the same lie as an omission, wearing a title.
        expect(
          sheet.all(`agent-section-absent-${section}`),
          `${section} is declared drawn, so it must not carry an absence sentence`,
        ).toHaveLength(0)
      } else {
        const said = sheet.q(`agent-section-absent-${section}`)
        assertDrawn(said, `the sentence accounting for ${section}`)
        expect(said.textContent?.trim()).toBe(declared.says)
        // 🔴 **The two reasons are TOLD APART on the element**, which is what stops a later
        // refactor collapsing them into one grey paragraph.
        expect(said.dataset.why).toBe(declared.why)
      }
    }
  })

  it('⚑ the one section it CAN fill holds the real editor, not a copy of it', async () => {
    const sheet = await openTheSheet()
    await drawnReady()

    // ⛔ **The component itself, reached through the sheet** — `626` relay 2 §3.1: reuse it, do not
    // rebuild it. ⚠️ Asserting on `own-instructions`' own handles is what makes "reuse" checkable:
    // a re-implementation would render different ones and this would go red.
    const mine = sheet.q('agent-section-your-instructions')
    expect(mine.dataset.drawn).toBe('true')
    assertDrawn(sheet.q('own-instructions'), 'the editor, mounted rather than reimplemented')
    assertDrawn(sheet.q('own-instructions-text'), 'the box a person types their rules into')
    assertDrawn(
      sheet.q('own-instructions-when'),
      'the one line saying when a change takes effect (EXT-015 §2.1)',
    )
  })

  it('⚠️ a thing that will never be here reads differently from a thing that is coming', async () => {
    const sheet = await openTheSheet()
    await drawnReady()

    // ⛔ **`this-conversation` is `not-here`** — there is no conversation at this door and there
    // never will be; it is nobody's bug. ⚑ **`its-memory` is `not-yet`** — it exists and this app
    // cannot reach it from here. 🔴 A person who cannot tell these apart cannot tell whether to
    // wait, which is the whole of criterion 18.
    const never = sheet.q('agent-section-absent-this-conversation')
    const coming = sheet.q('agent-section-absent-its-memory')
    expect(never.dataset.why).toBe('not-here')
    expect(coming.dataset.why).toBe('not-yet')
    expect(never.dataset.why, 'the two reasons are not the same value').not.toBe(coming.dataset.why)
    // ⚠️ **And they are not the same SENTENCE either** — a shared string would make the data
    // attribute a distinction without a difference.
    expect(never.textContent?.trim()).not.toBe(coming.textContent?.trim())
    expect(visible(never) && visible(coming)).toBe(true)
  })

  it('⛔ the vocabulary answers for every section at every door', () => {
    // ⚑ **The declaration itself, asserted exhaustive at runtime as well as in the type.**
    // `Record<AgentSection, …>` already makes a missing section a compile error; this catches the
    // other half — a door added to `DOORS` that some section forgot to answer for.
    for (const section of AGENT_SECTIONS) {
      for (const door of DOORS) {
        const at = SECTION_AT_EACH_DOOR[section].at[door]
        expect(at, `${section} must say what it does at ${door}`).toBeDefined()
        if (!at.drawn) {
          expect(at.says.trim().length, `${section} at ${door} owes a sentence`).toBeGreaterThan(0)
          // ⛔ **A sentence, not a label.** "Not available" is the absence this module exists to
          // refuse; anything this short is that by another name.
          expect(at.says.trim().length).toBeGreaterThan(20)
        }
      }
    }

    // ⚠️ **The two helpers partition the vocabulary between them** — so a caller that renders both
    // lists renders every section exactly once, and neither helper can quietly drop one.
    for (const door of DOORS) {
      const drawn = sectionsDrawnAt(door)
      const absent = sectionsAbsentAt(door).map((one) => one.section)
      expect([...drawn, ...absent].sort()).toEqual([...AGENT_SECTIONS].sort())
      expect(drawn.filter((one) => absent.includes(one))).toEqual([])
    }
  })

  it('⚑ the Team door names the agent, and does not claim it was TOLD anything', async () => {
    const sheet = await openTheSheet()
    await drawnReady()

    assertDrawn(sheet.q('agent-sections-who'), 'which agent this is about')
    expect(sheet.q('agent-sections-who').textContent?.trim()).toBe('BroBot')
    // 🔴 **The conversation door's title would be FALSE here.** Nothing has been told, because
    // nothing has been launched — see `AgentSectionsSheet`'s own note.
    expect(sheet.q('agent-sections-title').textContent?.trim()).not.toContain('was told')
  })
})
