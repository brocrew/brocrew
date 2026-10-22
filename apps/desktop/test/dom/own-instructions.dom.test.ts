import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { nextTick } from 'vue'
import OwnInstructions from '../../src/renderer/src/components/OwnInstructions.vue'
import {
  NOBODY_HAS_WRITTEN_ONE,
  TAKES_EFFECT_AT_THE_NEXT_LAUNCH,
  WROTE_IT_MEANS,
  type AgentInstructionsReading,
} from '../../src/shared/own-instructions'
import type { AgentStore } from '../../src/renderer/src/lib/agent-store'
import { assertDrawn, drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **582 · the editor `HO-063` gap 4 asked for, DRAWN** — what a person actually sees when they
 * open an agent and look for the place their own rules go.
 *
 * ## ⛔ Why a dom test and not a render test
 *
 * ⚠️ **The claim the response makes is *"open an agent's sheet and there is a box for your rules"***,
 * and a `v-for` that renders nothing satisfies every source census ever written about it. ⛔ SSR
 * renders markup and has no layout, which is how `080` shipped a grey header past 2043 green tests
 * (`vitest.config.ts`' own note). ⚑ This asks the one question the string cannot.
 *
 * ## ⚠️ What it asserts and what it deliberately does not
 *
 * ⛔ **Properties a person can perceive, never a class name** (`a-scoped-class-matches-nothing-in-
 * another-component`): that the sentence about WHEN a rule takes effect is on screen and whole,
 * that a provenance is drawn from the table rather than from a word beside it, and that the control
 * a person presses to approve an agent's ask exists and reaches the store.
 */

/** A store that answers one reading and records what it was asked to write. */
function storeAnswering(reading: AgentInstructionsReading): {
  store: AgentStore
  wrote: { text: string; broughtBack?: number }[]
  decided: { askId: string; approve: boolean }[]
} {
  const wrote: { text: string; broughtBack?: number }[] = []
  const decided: { askId: string; approve: boolean }[] = []
  const store = {
    instructionsFor: async () => reading,
    instruct: async (_slug: string, text: string, broughtBack?: number) => {
      wrote.push({ text, ...(broughtBack === undefined ? {} : { broughtBack }) })
      return null
    },
    decideInstruction: async (askId: string, approve: boolean) => {
      decided.push({ askId, approve })
      return null
    },
  } as unknown as AgentStore
  return { store, wrote, decided }
}

const EMPTY: AgentInstructionsReading = {
  own: { identity: 'worker', versions: [] },
  waiting: [],
  readAt: 1_700_000_000_000,
}

const HELD: AgentInstructionsReading = {
  own: {
    identity: 'worker',
    versions: [
      {
        version: 2,
        text: 'Never force-push.',
        whoWroteIt: 'relayed-from-user',
        by: { who: 'an-agent', agent: 'sess_1' },
        conversation: 'sess_1',
        said: 'The person told me in this conversation',
        broughtBack: null,
        writtenAt: 1_700_000_100_000,
      },
      {
        version: 1,
        text: 'Read the README first.',
        whoWroteIt: 'a-person',
        by: { who: 'a-person' },
        conversation: null,
        said: null,
        broughtBack: null,
        writtenAt: 1_700_000_000_000,
      },
    ],
  },
  waiting: [
    {
      asked: {
        type: 'instruction_proposed',
        askId: 'iprop_1',
        ask: 'propose',
        about: 'worker',
        proposedBy: 'project-manager',
        text: 'Always run the gate before reporting.',
        why: 'three dispatches reported green without one',
      },
      conversation: 'sess_2',
      at: 1_700_000_200_000,
    },
  ],
  readAt: 1_700_000_300_000,
}

/** ⚑ The column this sheet actually has — `CapabilitiesSheet`'s own box, not a window. */
const SHEET = { width: 760, height: 900 }

/**
 * ⛔ **The viewport is SHARED across this project's files** (`dom-project-viewport-is-shared`), so
 * it is set per test and put back in `afterEach`. ⚠️ Without it the box below is wider than the
 * page and every clip reported is `<body>`'s rather than the component's — which is what this file
 * measured on its first run.
 */
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

describe('582 · the rules box a person writes in', () => {
  afterEach(async () => {
    unmountAll()
    await page.viewport(ORIGINAL.width, ORIGINAL.height)
  })

  const opened = async (
    reading: AgentInstructionsReading,
  ): Promise<Mounted & ReturnType<typeof storeAnswering>> => {
    await page.viewport(SHEET.width, SHEET.height)
    const parts = storeAnswering(reading)
    const box = mount(OwnInstructions, { profileSlug: 'worker', store: parts.store }, SHEET)
    // ⚠️ **Two ticks: one for the watch's `immediate` read, one for the render it causes.** A
    // single tick draws the loading state, which is a real state and not the one this file is
    // about.
    await nextTick()
    await nextTick()
    // ⛔ **The font, before any width is read** — `drawn.ts` refuses otherwise, because every
    // measurement would be the fallback's.
    await drawnReady()
    return { ...box, ...parts }
  }

  it('⛔ an agent nobody has written rules for says so, and offers the box anyway', async () => {
    const sheet = await opened(EMPTY)
    expect(sheet.q('own-instructions-empty').textContent?.trim()).toBe(NOBODY_HAS_WRITTEN_ONE)
    // ⚑ **The control exists in the empty state**, which is the whole of *there is somewhere to
    // write it now*: an editor a person only meets after somebody else has written something is
    // the door `HO-073` §3.1 says does not exist.
    assertDrawn(sheet.q('own-instructions-text'), 'the box a person types their rules into')
    assertDrawn(sheet.q('own-instructions-save'), 'the Save control')
  })

  it('🔴 the sentence about WHEN a rule takes effect is on screen, whole', async () => {
    const sheet = await opened(EMPTY)
    const said = sheet.q('own-instructions-when')
    // ⛔ **Standing rule 8.2's sentence is the one a person must not half-read.** `574` measured
    // what our own prose about WHEN a fact is read costs when it is wrong; a clipped version of it
    // is the same defect with the app doing the clipping.
    expect(said.textContent?.trim()).toBe(TAKES_EFFECT_AT_THE_NEXT_LAUNCH)
    assertDrawn(said, 'the sentence about when a rule takes effect')
  })

  it('🔴 a relayed version says this app did not check the claim, from the TABLE', async () => {
    const sheet = await opened(HELD)
    const newest = sheet.q('own-instructions-version-2')
    // ⛔ **Rendered from `WROTE_IT_MEANS` and not written beside the word** (standing rule 8) —
    // asserted by comparing against the table rather than against a string typed here.
    expect(newest.textContent).toContain(WROTE_IT_MEANS['relayed-from-user'])
    expect(newest.textContent).toContain('in force')
    // ⚑ **The agent's claim is drawn and labelled as a claim.**
    expect(newest.textContent).toContain('The person told me in this conversation')
    // ⚠️ **The older version is still there**, which is the property `HO-009` §1.2 makes the whole
    // point of the layer: *what the rule used to be* is on the screen a person reads.
    expect(sheet.q('own-instructions-version-1').textContent).toContain('Read the README first.')
    assertDrawn(sheet.q('own-instructions-versions'), 'the version history')
  })

  it('⛔ an agent’s ask is drawn with its reasoning, and approving it reaches the store', async () => {
    const sheet = await opened(HELD)
    const ask = sheet.q('own-instructions-ask-iprop_1')
    expect(ask.textContent).toContain('project-manager')
    expect(ask.textContent).toContain('three dispatches reported green without one')
    expect(ask.textContent).toContain('Always run the gate before reporting.')
    assertDrawn(ask, 'the ask an agent made')
    sheet.q('own-instructions-approve-iprop_1').click()
    await nextTick()
    // ⛔ **`HO-009` §2.2's gate, measured at the control**: the only thing that writes a version is
    // a person pressing this.
    expect(sheet.decided).toEqual([{ askId: 'iprop_1', approve: true }])
  })

  it('⚑ Restore sends the OLD text forward and names the version it brought back', async () => {
    const sheet = await opened(HELD)
    sheet.q('own-instructions-restore-1').click()
    await nextTick()
    expect(sheet.wrote).toEqual([])
    sheet.q('own-instructions-restore-confirm').click()
    await nextTick()
    // ⛔ **A revert APPENDS**, and the surface says which version came back — so the reverting is
    // itself revertable, which is what `HO-009` §1.2 asks for.
    expect(sheet.wrote).toEqual([{ text: 'Read the README first.', broughtBack: 1 }])
  })

  it('⚠️ the box does not scroll the page sideways, at the width this sheet actually has', async () => {
    const sheet = await opened(HELD)
    // ⛔ **A pasted operating model is long and has no spaces to break on**, so the one thing a
    // person can perceive going wrong here is a sideways scroll on the sheet behind it. ⚑ Asserted
    // on the box rather than on a class name.
    const root = sheet.q('own-instructions')
    expect(root.scrollWidth).toBeLessThanOrEqual(SHEET.width)
  })
})
