import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import { createAgentStore, type AgentStore } from '../../src/renderer/src/lib/agent-store'
import { REOPENING_SAYS, type AConversationToReopen } from '../../src/renderer/src/lib/reopening'
import {
  CAPABILITY_FIELDS,
  DEFAULT_CAPABILITIES,
  type AnyCapabilityField,
} from '../../src/shared/capabilities'
import type { AgentIdentities, AgentIdentity, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **470 · the sentence a person reads about the launch boundary, and the offer under it.**
 *
 * ## ⛔ Why this is a DOM file and not an SSR one
 *
 * ⚠️ **SSR tests pass vacuously** (the dispatch's §3, and this project's standing lesson). Markup
 * would show the sentence; it cannot show that the offer is ABSENT when nothing is open, that the
 * button is DEAD while a conversation is holding work, and that pressing the second row's button
 * asks for the second conversation. ⛔ Every one of those is a press or an absence.
 *
 * ## ⚑ The fixture's own premise
 *
 * **The schema decides which grant carries the disclosure, not the component** — so the fixture
 * runs a field the app does not have, declaring its own `whenItTakesEffect`, to show the sentence
 * is drawn from the descriptor rather than from `canWriteRules`' name.
 * `capabilities-sheet.dom.test.ts` is the precedent: *"a capability nobody has proposed"*, mounted
 * to prove the enumeration is real.
 */

interface Answers {
  list: AgentIdentities
  saved: unknown[]
  /** ⚑ Held open by a test that needs the save to still be in flight — see §4. */
  holdSave: (() => void) | null
}

let answers: Answers

const identity = (slug: string): AgentIdentity => ({
  id: `agp:default:${slug}`,
  slug,
  displayName: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const ROSTER = (): AgentIdentities => ({
  identities: [identity('pm'), identity('worker')],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
})

/** ⚑ The same roster with `pm`'s rule-writing grant already CHOSEN, so a reversal is one. */
const chosenPm = (): AgentIdentities => ({
  ...ROSTER(),
  identities: [
    {
      ...identity('pm'),
      capabilities: { ...DEFAULT_CAPABILITIES, canWriteRules: 'relay' },
      chosen: { ...identity('pm').chosen, canWriteRules: 'chosen' },
    },
    identity('worker'),
  ],
})

function storeOver(): AgentStore {
  const bridge = {
    agentIdentities: async () => answers.list,
    setCapabilities: async (input: unknown) => {
      structuredClone(input)
      answers.saved.push(input)
      if (answers.holdSave !== null) {
        await new Promise<void>((resolve) => {
          answers.holdSave = resolve
        })
      }
      return answers.list.identities[0] ?? null
    },
    setSpawningEnabled: async () => ({ spawningEnabled: true }),
    // ⚑ **696 · the door's answer since `682`** — the identity AND what it cleared (`AgentProviderSet`).
    setAgentProvider: async () => {
      const one = answers.list.identities[0]
      return one === undefined ? null : { ...one, modelChoiceCleared: null }
    },
  } as unknown as RuntimeBridge
  return createAgentStore(bridge)
}

const open = (over: Partial<AConversationToReopen> = {}): AConversationToReopen => ({
  sessionId: 'sess_1',
  where: 'login-explorer',
  heldBy: null,
  busy: false,
  ...over,
})

async function sheet(
  openAs: readonly AConversationToReopen[],
  over: Record<string, unknown> = {},
): Promise<{ m: Mounted; asked: () => string[]; closes: () => number }> {
  const store = storeOver()
  await store.load()
  const asked: string[] = []
  let closed = 0
  const m = mount(
    CapabilitiesSheet,
    {
      profileSlug: 'pm',
      runsOn: 'codex',
      store,
      openAs,
      onReopen: (sessionId: string) => asked.push(sessionId),
      onClose: () => (closed += 1),
      ...over,
    },
    { width: 900, height: 1200 },
  )
  await nextTick()
  return { m, asked: () => asked, closes: () => closed }
}

const text = (m: Mounted, cy: string): string => (m.q(cy).textContent ?? '').replace(/\s+/g, ' ')

describe('470 · a grant that waits for the next launch', () => {
  beforeEach(() => {
    answers = { list: ROSTER(), saved: [], holdSave: null }
  })
  afterEach(() => {
    unmountAll()
  })

  describe('§1 · the sentence, on the one grant that has two answers', () => {
    it('🔴 it is drawn under the rule-writing grant and under no other control', async () => {
      const { m } = await sheet([])
      const said = text(m, 'grant-canWriteRules-when')
      expect(said).toContain('one already running keeps what it was told')
      expect(said).toContain('Narrowing it stops new requests')
      // ⛔ **The paired negative, and it is the whole of *disclose it where it bites*** (HO-028 §3:
      // *"the disclosure should not shout at a person changing a grant it does not affect"*).
      for (const field of CAPABILITY_FIELDS.filter((one) => one.whenItTakesEffect === null)) {
        expect(m.all(`grant-${field.key}-when`), field.key).toHaveLength(0)
      }
      // ⚑ …and the sheet really did draw every other control, so the sweep above is not passing
      // over a sheet that rendered nothing.
      expect(m.all('capability-canMessage')).toHaveLength(1)
      expect(m.all('capability-maxDepth')).toHaveLength(1)
    })

    it('⛔ a capability this app does not have draws it too — the schema decides, not the name', async () => {
      // 🔴 **HO-008 §3's promise, measured on the one property `470` added.** A sentence keyed on
      // `canWriteRules` by name would pass every assertion above and fail this one.
      const invented = {
        key: 'canBroadcast',
        column: 'can_broadcast',
        editor: 'choice',
        label: 'May broadcast',
        help: 'Nothing real reads this.',
        ruled: 'never',
        narrowest: 'never',
        vocabulary: ['never', 'always'],
        whenItTakesEffect: 'A sentence no dispatch has written, declared by the field itself.',
      } as unknown as AnyCapabilityField
      const { m } = await sheet([], { fields: [...CAPABILITY_FIELDS, invented] })
      expect(text(m, 'grant-canBroadcast-when')).toContain('declared by the field itself')
      // ⚑ **And the offer follows it**, because the offer keys on the same declaration.
      const { m: withOne } = await sheet([open()], { fields: [...CAPABILITY_FIELDS, invented] })
      expect(withOne.all('grant-canBroadcast-open-now')).toHaveLength(1)
    })
  })

  describe('§2 · the offer appears only where there is something to reopen', () => {
    it('⛔ nothing open: the sentence stands and no offer is drawn — the paired negative', async () => {
      const { m } = await sheet([])
      expect(m.all('grant-canWriteRules-when')).toHaveLength(1)
      expect(m.all('grant-canWriteRules-open-now')).toHaveLength(0)
      // 🔴 **An empty list claims NOTHING.** `store.open` is what this window holds and `running`
      // on the wire is per-host, so the absence of an offer must not be a sentence saying there is
      // nothing running as this identity.
      const body = (m.q('capabilities-sheet').textContent ?? '').replace(/\s+/g, ' ')
      expect(body).not.toMatch(/nothing is running|no conversation is (open|running)/i)
    })

    it('⛔ …and even WITH one open, no other grant is offered a reopen', async () => {
      // 🔴 **The other half of *disclose it where it bites*.** The negative above is satisfied by a
      // surface that draws no offer at all; this one needs an offer to exist and to appear on
      // exactly one control. ⚠️ Without it, an offer keyed on nothing but `openAs.length` passes
      // every assertion in this file.
      const { m } = await sheet([open()])
      expect(m.all('grant-canWriteRules-open-now')).toHaveLength(1)
      for (const field of CAPABILITY_FIELDS.filter((one) => one.whenItTakesEffect === null)) {
        expect(m.all(`grant-${field.key}-open-now`), field.key).toHaveLength(0)
      }
    })

    it('🔴 one open conversation: it is named, and pressing Reopen asks for that session', async () => {
      const { m, asked } = await sheet([open({ sessionId: 'sess_7', where: 'login-explorer' })])
      expect(text(m, 'grant-canWriteRules-open-now')).toContain('login-explorer')
      // ⚑ **The identity's own slug is in the line**, so a person reading it knows which sheet's
      // conversations these are.
      expect(text(m, 'grant-canWriteRules-open-now')).toContain('pm')
      const button = m.q('grant-canWriteRules-reopen-sess_7') as HTMLButtonElement
      expect(button.disabled).toBe(false)
      button.click()
      expect(asked()).toEqual(['sess_7'])
    })

    it('⚠️ …and the row falls back to the session id when this app holds no path for it', async () => {
      const { m } = await sheet([open({ sessionId: 'sess_9', where: null })])
      expect(text(m, 'grant-canWriteRules-open-now')).toContain('sess_9')
    })

    it('⛔ two open conversations are two rows, and the second button asks for the SECOND one', async () => {
      // 🔴 **The control the single-row test needs.** A component that emitted the first row's id,
      // or the prop's head, passes the test above and fails this one.
      const { m, asked } = await sheet([
        open({ sessionId: 'sess_1', where: 'one' }),
        open({ sessionId: 'sess_2', where: 'two' }),
      ])
      ;(m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement).click()
      expect(asked()).toEqual(['sess_2'])
      ;(m.q('grant-canWriteRules-reopen-sess_1') as HTMLButtonElement).click()
      expect(asked()).toEqual(['sess_2', 'sess_1'])
    })
  })

  describe('§3 · it cannot destroy live work on one press', () => {
    it('🔴 a conversation with a question waiting: the button is dead and the row says why', async () => {
      // ⛔ **`147`'s ruling, inherited rather than re-decided**: *"no action whose cost the user
      // never agreed to."* HO-028 §3 refused an automatic restart for the same reason, and a live
      // button over a waiting card would be that restart one press away.
      const { m, asked } = await sheet([open({ sessionId: 'sess_3', heldBy: 'question' })])
      const button = m.q('grant-canWriteRules-reopen-sess_3') as HTMLButtonElement
      expect(button.disabled).toBe(true)
      button.click()
      expect(asked()).toEqual([])
      expect(text(m, 'grant-canWriteRules-cost-sess_3')).toContain(REOPENING_SAYS.question)
      // 🔴 **106 as this app states it** (`send-refusals.ts`): *a disabled control must say what
      // would let it, and the thing it names must be reachable.* ⛔ The card is in the
      // conversation and this sheet is `aria-modal` over it, so the sentence says how to get
      // there — and the remedy IT names is on screen.
      expect(text(m, 'grant-canWriteRules-cost-sess_3')).toContain('Cancel this sheet to reach it')
      expect((m.q('capabilities-cancel') as HTMLButtonElement).disabled).toBe(false)
    })

    it('⛔ a conversation that is still working says the other sentence', async () => {
      const { m, asked } = await sheet([open({ sessionId: 'sess_4', heldBy: 'turn' })])
      ;(m.q('grant-canWriteRules-reopen-sess_4') as HTMLButtonElement).click()
      expect(asked()).toEqual([])
      expect(text(m, 'grant-canWriteRules-cost-sess_4')).toContain(REOPENING_SAYS.turn)
      expect(text(m, 'grant-canWriteRules-cost-sess_4')).toContain('Cancel this sheet to reach it')
    })

    it('⚑ …and an idle one says what reopening COSTS, which is the third arm of one table', async () => {
      // ⚠️ **The pair that makes the two above measurements rather than three dead buttons.**
      const { m, asked } = await sheet([open({ sessionId: 'sess_5' })])
      // ⚑ **Exactly the table's sentence and nothing appended** — the paired negative that keeps
      // the locus clause conditional rather than decorative.
      expect(text(m, 'grant-canWriteRules-cost-sess_5')).toBe(REOPENING_SAYS.free)
      expect(text(m, 'grant-canWriteRules-cost-sess_5')).not.toContain('Cancel this sheet')
      ;(m.q('grant-canWriteRules-reopen-sess_5') as HTMLButtonElement).click()
      expect(asked()).toEqual(['sess_5'])
    })

    it('⚠️ a command already in flight keeps the button dead — the same double-click guard', async () => {
      const { m, asked } = await sheet([open({ sessionId: 'sess_6', busy: true })])
      const button = m.q('grant-canWriteRules-reopen-sess_6') as HTMLButtonElement
      expect(button.disabled).toBe(true)
      button.click()
      expect(asked()).toEqual([])
    })
  })

  describe('§4 · an unsaved edit, and the close that would have taken the offer away', () => {
    /** ⚑ Pick a word in the rule-writing grant's own control, as a person does. */
    const pick = async (m: Mounted, word: string): Promise<void> => {
      const select = m.q('capability-canWriteRules-select') as HTMLSelectElement
      select.value = word
      select.dispatchEvent(new Event('change'))
      await nextTick()
    }

    it('🔴 a word the person has not saved kills the Reopen, and the row says why', async () => {
      // ⛔ **The one hazard this control can cause.** A reopen hands the conversation the row AS
      // STORED, so pressing it over an unsaved pick gives that conversation the opposite of what
      // is on the screen — and it is the conversation the person was trying to fix.
      const { m, asked } = await sheet([open({ sessionId: 'sess_2' })])
      expect((m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement).disabled).toBe(false)
      await pick(m, 'relay')
      const button = m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement
      expect(button.disabled).toBe(true)
      button.click()
      expect(asked()).toEqual([])
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).toContain('Save first')
      // ⚑ **And it says what a save would NOT do**, so the sentence is a reason rather than a
      // scold — `106`: a control that cannot act must say what would let it.
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).toContain('not what you have changed here')
    })

    it('🔴 …and an edit to ANY grant kills it, because a reopen re-reads the whole row', async () => {
      // ⛔ **This asserted the opposite until review.** A reopen hands the conversation the stored
      // row for all six grants — `instructionContext` → `capabilitiesOf` → every field into the
      // bundle — so an unsaved `maxDepth` is a row that says something other than the screen.
      // ⚠️ And the flow is the one this dispatch creates: `save()` holds the sheet open so the
      // person can press Reopen, and the next thing they touch need not be the rule-writing grant.
      const { m, asked } = await sheet([open({ sessionId: 'sess_2' })])
      const depth = m.q('capability-maxDepth-input') as HTMLInputElement
      depth.value = '4'
      depth.dispatchEvent(new Event('input'))
      await nextTick()
      const button = m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement
      expect(button.disabled).toBe(true)
      button.click()
      expect(asked()).toEqual([])
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).toContain('Save first')
    })

    it('⛔ …and an edit PUT BACK is not an edit — the sentence and the button both recover', async () => {
      // 🔴 **A defect I shipped and review found.** The first version recorded a TOUCH, so moving
      // a control and moving it back left the Reopen dead beside a sentence saying *not what you have
      // changed here* over a screen that matched the row exactly — and the only way out was a
      // write that changed nothing.
      // ⚠️ **On a row that has already CHOSEN**, because that is where a reversal is exactly a
      // reversal: on a row following the default, picking the default's own word still moves
      // `chosen` from *nobody has said* to *this row says none*, which `341` is explicit is a real
      // change.
      answers.list = chosenPm()
      const { m, asked, closes } = await sheet([open({ sessionId: 'sess_2' })])
      await pick(m, 'propose')
      expect((m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement).disabled).toBe(true)
      await pick(m, 'relay')
      const button = m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement
      expect(button.disabled).toBe(false)
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).toBe(REOPENING_SAYS.free)
      button.click()
      expect(asked()).toEqual(['sess_2'])
      // ⚑ …and a Save from that state is a save that moved nothing, so the sheet closes as it
      // always has rather than holding a person on a surface for a write they did not make.
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(closes()).toBe(1)
    })

    it('⛔ …and an unsaved edit outranks the wait — this sheet’s own state answers first', async () => {
      // ⚑ **The only pair no other case builds**, and the branch order is a person-visible
      // decision: the remedy offered has to be the one that would make the button live.
      const { m } = await sheet([open({ sessionId: 'sess_2', heldBy: 'turn' })])
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).toContain(REOPENING_SAYS.turn)
      await pick(m, 'relay')
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).toContain('Save first')
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).not.toContain(REOPENING_SAYS.turn)
    })

    it('🔴 “Use the default” is a launch-boundary edit too', async () => {
      // ⛔ **The other editor path, and no test in this repo presses it on a launch-time grant.**
      // Handing the grant back to its default is as much an unsaved edit as picking a word.
      answers.list = chosenPm()
      const { m, asked } = await sheet([open({ sessionId: 'sess_2' })])
      expect((m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement).disabled).toBe(false)
      m.q('capability-canWriteRules-use-default').click()
      await nextTick()
      const button = m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement
      expect(button.disabled).toBe(true)
      button.click()
      expect(asked()).toEqual([])
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).toContain('Save first')
    })

    it('🔴 saving a launch-time grant with a conversation open keeps the sheet — the offer is the remedy', async () => {
      // ⛔ **The same argument the file already makes about a refusal**, on the other outcome: the
      // offer is the only place the remedy is named, and closing over a successful save would take
      // it away at exactly the moment it started being true.
      const { m, closes } = await sheet([open({ sessionId: 'sess_2' })])
      await pick(m, 'relay')
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
      expect(answers.saved).toHaveLength(1)
      expect(closes()).toBe(0)
      // ⚑ …and the offer is now live, because the edit it was guarding against has landed.
      expect((m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement).disabled).toBe(false)
    })

    it('⛔ …and with nothing open it closes exactly as it always has', async () => {
      const { m, closes } = await sheet([])
      await pick(m, 'relay')
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(answers.saved).toHaveLength(1)
      expect(closes()).toBe(1)
    })

    it('🔴 an edit that lands WHILE the save is in flight is still unsaved when it returns', async () => {
      // ⛔ **Nothing disables the editors across the round trip** — only Save carries `blocked` —
      // and `store.save` is two IPC calls. ⚠️ A first version re-seeded from the SCREEN when the
      // write returned, so a pick that landed mid-flight was marked as though it had been sent:
      // the Reopen went live over it and a press would have handed the conversation the row
      // WITHOUT it. Found by review.
      answers.holdSave = () => {}
      const { m } = await sheet([open({ sessionId: 'sess_2' })])
      await pick(m, 'relay')
      m.q('capabilities-save').click()
      await nextTick()
      expect(answers.saved).toHaveLength(1)
      // the write has NOT returned yet, and the person picks another word
      await pick(m, 'propose')
      const release = answers.holdSave as unknown as () => void
      release()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await nextTick()
      // ⚑ …so the sheet still says the row and the screen disagree, and the button is still dead.
      expect((m.q('grant-canWriteRules-reopen-sess_2') as HTMLButtonElement).disabled).toBe(true)
      expect(text(m, 'grant-canWriteRules-cost-sess_2')).toContain('Save first')
    })

    it('⛔ …and so does a save that moved no launch-time grant', async () => {
      // 🔴 **Both halves of the narrowing.** A sheet that stayed open on every save with a
      // conversation running would be shouting at a person who changed a number.
      const { m, closes } = await sheet([open({ sessionId: 'sess_2' })])
      const depth = m.q('capability-maxDepth-input') as HTMLInputElement
      depth.value = '4'
      depth.dispatchEvent(new Event('input'))
      await nextTick()
      m.q('capabilities-save').click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(answers.saved).toHaveLength(1)
      expect(closes()).toBe(1)
    })
  })

  describe('§5 · the offer does not push the sheet out of the window', () => {
    /**
     * ⛔ **`scrollWidth` cannot answer this and the first version of this file asked it anyway.**
     * `.capabilities-sheet` is `overflow: hidden`, so its scroll width never exceeds its client
     * width however far a child reaches — the assertion passed with the CSS deleted, which is
     * `a-mutation-that-changes-nothing-reports-as-a-survivor` arriving from the test's side.
     * ⚑ **This is `capabilities-sheet-fits.dom.test.ts`' own method**: walk to the box that CLIPS
     * each element and compare the two rectangles.
     */
    const clipper = (el: Element): HTMLElement | null => {
      let at = el.parentElement
      while (at !== null) {
        const style = getComputedStyle(at)
        if (style.overflowX === 'hidden' || style.overflowX === 'clip') return at
        if (style.overflowY === 'hidden' || style.overflowY === 'clip') return at
        at = at.parentElement
      }
      return null
    }

    const escapes = (root: HTMLElement): string[] => {
      const out: string[] = []
      for (const el of root.querySelectorAll('*')) {
        const box = clipper(el)
        if (box === null) continue
        const mine = el.getBoundingClientRect()
        const theirs = box.getBoundingClientRect()
        if (mine.width === 0 && mine.height === 0) continue
        if (mine.right > theirs.right + 1 || mine.left < theirs.left - 1) {
          out.push(el.getAttribute('data-cy') ?? el.tagName.toLowerCase())
        }
      }
      return out
    }

    it('⛔ a long folder name stays inside the sheet — `335`’s rule, on a row that grew', async () => {
      // 🔴 **A flex item's automatic minimum size is its CONTENT** unless its overflow is hidden,
      // and a working-directory basename is arbitrary text nobody chose with this sheet in mind.
      const { m } = await sheet([
        open({
          sessionId: 'sess_8',
          where: 'a-repository-with-a-name-nobody-would-ever-shorten-by-hand-before-typing-it',
        }),
      ])
      const box = m.q('capabilities-sheet')
      expect(escapes(box)).toEqual([])
      // ⚑ **The button is the thing that leaves first**, because it sits after the spacer.
      const button = m.q('grant-canWriteRules-reopen-sess_8').getBoundingClientRect()
      expect(button.right).toBeLessThanOrEqual(box.getBoundingClientRect().right + 1)
      expect(button.width).toBeGreaterThan(20)
    })

    it('🔴 the control — a child that really does reach past the sheet IS found', async () => {
      // ⛔ **Without this, an `escapes` that could see nothing passes the test above.**
      // `a-control-must-be-trapped-the-way-the-subject-is`: planted inside the same offer, and
      // measured by the same walk.
      const { m } = await sheet([open({ sessionId: 'sess_8' })])
      const box = m.q('capabilities-sheet')
      expect(escapes(box)).toEqual([])
      const planted = document.createElement('div')
      planted.setAttribute('data-cy', 'planted')
      planted.style.cssText = 'position:absolute;left:0;width:4000px;height:4px'
      m.q('grant-canWriteRules-open-now').append(planted)
      expect(escapes(box)).toContain('planted')
    })
  })
})
