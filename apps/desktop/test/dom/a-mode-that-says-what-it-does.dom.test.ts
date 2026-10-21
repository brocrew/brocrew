import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
// ⚠️ The MODULE, not the barrel — `@brobot2/runtime`'s index pulls in `node:fs` and the whole file
// fails to import in the browser project. (`yolo-disclosure.dom.test.ts`'s note, verbatim.)
import {
  allProviderCapabilities,
  capabilitiesFor,
} from '../../../../packages/runtime/src/capabilities'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
// ⚑ `417` dropped the `NewConversation.vue`, `drafts` and `visible` imports with §1 — the launcher
// no longer renders this disclosure, so nothing here mounts it.
import CardApproval from '../../src/renderer/src/components/CardApproval.vue'
import { useConversationControls } from '../../src/renderer/src/composables/useConversationControls'
import SessionHeader from '../../src/renderer/src/components/SessionHeader.vue'
import { assertDrawn, cutsOf, drawnReady } from './drawn'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * 🔴 **367 · HO-011 §3.2 — a mode that says what it does, on every surface that names it.**
 *
 * `171` gave yolo its true NAME and one true sentence. The sentence is true of both providers and
 * it is not the whole truth about either, because the two modes differ in kind:
 *
 *  - **Codex** starts the thread `read-only` with approvals on and `danger-full-access` with them
 *    off, so this mode is an OS sandbox coming off.
 *  - **Claude** is handed no sandbox by this app in either mode, so there is none to come off and
 *    what this mode removes is the CARD.
 *
 * ⛔ **In the DOM project, because every assertion here is about a box.** The pill's fit is a
 * measured rectangle and the reach span's `display` is a computed value; an SSR string can produce
 * neither, and `169`'s rule applies throughout: every negative below is paired with a positive
 * taken from the same mount.
 *
 * ⚠️ **`417` removed §1 — the launcher's half — and nothing else.** See the note where it stood,
 * below; the two moments of choice that remain are §2's pill and §3's drawer.
 */

afterEach(unmountAll)

/** The `auto` sentence an adapter declares — read from the declaration, never restated here. */
function declaredNote(provider: 'claude' | 'codex'): string {
  const status = capabilitiesFor(provider).approvals
  if (status.state !== 'available') throw new Error(`${provider}.approvals is not available`)
  return status.note ?? ''
}

const SESSION = (over: Partial<CreatedSession> = {}): CreatedSession =>
  ({
    sessionId: 'sess_1',
    provider: 'claude',
    cwd: '/work',
    providerHome: '/homes/claude',
    profileId: 'default',
    ref: null,
    config: {
      home: '/homes/claude',
      homeEnv: 'CLAUDE_CONFIG_DIR',
      model: null,
      authNote: null,
      files: [],
    },
    instructions: {
      injected: [],
      agentMemory: [],
      provider: [],
      refused: [],
      note: '',
      recallsReported: false,
      writesReported: false,
    },
    approvalMode: 'auto',
    pendingApprovalMode: null,
    approvalNote: '⚠ approvals: YOLO — nothing is asked',
    blanketGrants: [],
    planNeedsGoAhead: false,
    settings: {
      model: null,
      pendingModel: null,
      reasoningEffort: null,
      pendingReasoningEffort: null,
      planMode: false,
      pendingPlanMode: null,
    },
    queued: null,
    liveness: { state: 'live', since: 1_700_000_000_000 },
    hasACommander: false,
    ...over,
  }) as CreatedSession

const header = (session: CreatedSession, box = { width: 1200, height: 808 }): Mounted =>
  mount(
    SessionHeader,
    {
      session,
      status: 'idle',
      ended: false,
      debug: false,
      capabilities: allProviderCapabilities(),
      facets: { doing: 'idle', being: 'live' },
    },
    box,
  )

/* ------------------------------------------------------------------------------------------------
 * ⛔ **§1 · the launcher's half — REMOVED by `417`, because its subject is gone** (HO-022 §2:
 * *"Opening a new conversation opens a conversation with BroBot. That is all."*).
 *
 * Five tests stood here and every one of them mounted `NewConversation.vue` and clicked
 * `auto-approve`:
 *
 *  - *arming the box says BOTH halves: the shared sentence and this provider's own*
 *  - *switching the provider switches the sentence, and the two are not the same words*
 *  - *the two halves READ as one sentence — the reach is inline, not a second column*
 *  - *it is one paragraph and OUTSIDE the fold, so nothing can hide half of it*
 *  - *a map that never arrived loses the second half and keeps the first*
 *
 * `417` deleted the checkbox, the provider select and the whole `Fine-tune` fold together with
 * everything else the launcher used to ask for. It cannot reach `approvalMode: 'auto'` at all any
 * more — the payload is `{ provider, profileId: 'default', approvalMode: 'ask' }` and nothing else
 * — so its copy of the disclosure had nothing left to disclose, and a mount of a control that does
 * not exist is not a weakened test but no test.
 *
 * ⛔ **The DISCLOSURE is untouched.** `367`'s rule is that the mode says what it does *wherever a
 * person meets it*, and the two surfaces where a person still meets it are below: §2's header pill
 * and §3's drawer — which is now the ONLY door to yolo. Both halves, the shared `YOLO_MEANS` and
 * the provider's own `approvals.note`, are still pinned there by clause.
 *
 * ⚑ **The replacement claim for the launcher** is
 * `test/dom/a-front-door-that-asks-nothing.dom.test.ts` §4: the launcher renders no `yolo-means`,
 * no `yolo-reach` and no `auto-approve` at all, and always sends `approvalMode: 'ask'`.
 *
 * ⚠️ **TWO halves of it survived the cut and moved to the foot of §3**, because the rules they
 * measure are enforced on a surface that survives:
 *
 *  - the reach span is `display: inline` rather than a blockified second flex item — the launcher
 *    is where that defect was FOUND, and the drawer is where it can still happen;
 *  - a capability map that never arrived leaves the shared sentence and drops the second half —
 *    `useConversationControls`' own `reach` answers `''` for an absent map, and
 *    `harness.ts`'s `drawerProps` takes `capabilities: null` by default because that is a state
 *    this surface has to draw.
 *
 * ⛔ Neither was rewritten to be satisfiable: the assertions are the launcher's, word for word,
 * pointed at the mount that still exists.
 * ----------------------------------------------------------------------------------------------*/

/**
 * # 🔴 `579` relay 3b · this section's own rule was REVERSED, and by name
 *
 * The visible mode mark says only “YOLO”; the explanatory disclosure belongs in its title.
 *
 * ## ⚠️ What was actually protected, and where it is
 *
 * ⛔ **Two clauses, two rules.** *Nothing is asked* is `171`'s and is about the PROMPT; *nothing is
 * confined* is `367`'s and is about REACH — `364` measured the reach on both providers and got the
 * same answer in this mode, no sandbox and the login's own scope, which is why it was
 * provider-blind. ⚑ **Both survive in the mark's `title`, in plain words**, together with the half
 * the ADAPTER declares — and that is asserted below rather than assumed.
 *
 * ## ⚑ And the rule underneath `367` still holds, which is why this is survivable
 *
 * 🔴 **`171 §3` requires the consequence *where the mode is CHOSEN*** — and this mark is not that
 * place. ⛔ **The two places a person chooses it are §3's subject and they are untouched**: the
 * drawer's control and the front door both render the whole of `YOLO_MEANS` plus the adapter's
 * note, visibly and unfolded. ⚠️ **So this section stops asking the mark to disclose and starts
 * asking it to POINT**, and §3 goes on asking the surfaces that must.
 */
describe('§2 · wherever a session in that mode appears — the mark NAMES it and points', () => {
  it('⛔ the mark is one word, and the two clauses it dropped are in its title', async () => {
    const m = header(SESSION())
    await nextTick()
    const pill = m.q('session-approval-indicator')
    const said = (pill.textContent ?? '').replace(/\s+/g, ' ').trim()
    // ⚑ **The word, and nothing but the word** — the live smokes read this element with `/YOLO/`
    // over its trimmed text, so that is what has to survive.
    expect(said, 'the mark grew a clause again without this file being told').toBe('Auto')

    // 🔴 **The reversal's price, paid in the title rather than left unpaid.** ⛔ Both facts, in a
    // person's words, on the element a person hovers.
    const title = pill.getAttribute('title') ?? ''
    expect(title, "the prompt half — 171's clause").toContain('without asking')
    // 🔴 **The NEGATION, not the verb.** ⛔ `367 M13` replaces *"nothing this app configures
    // confines them"* with *"this app confines them"* — the opposite claim, and `168 H1`'s defect
    // verbatim — and a `toContain('confines them')` is satisfied by it. ⚠️ The row SURVIVED that
    // shape in `the-conversation-header.test.ts` and the same weak assertion had been written
    // here in the same hour; both are corrected.
    expect(title, "the reach half — 367's clause").toContain(
      'nothing this app configures confines them',
    )
    expect(title, 'the tooltip claims a boundary this app does not have').not.toMatch(
      /this app confines them/,
    )
    // ⚠️ **…and the ADAPTER's half is there too**, which is the one that differs by provider and
    // the one this file's §3 exists for.
    expect(title.length, 'the title is a stub').toBeGreaterThan(120)
  })

  it('⚑ …and an `ask` session has no pill at all, which is what makes the pill news', async () => {
    // The paired positive is the mount above: without it this passes against a header that failed
    // to render. 082's rule — a permanent "approvals: ask" is a label nobody keeps reading.
    const m = header(SESSION({ approvalMode: 'ask', approvalNote: 'approvals: ask' }))
    await nextTick()
    expect(m.q('session-approval-indicator').textContent?.trim()).toBe('Ask')
    expect(m.q('session-approval-indicator').title).toContain(
      'Asks when an action needs permission.',
    )
    expect(m.q('session-approval-indicator').title).not.toContain('without asking')
    expect(m.all('conversation-title'), 'the header itself rendered').toHaveLength(1)
    // ⚑ **563 · and the header is READ, not counted.** ⛔ `toHaveLength(1)` says an element is in
    // the tree — the count spelling of `not.toBeNull()` — and a header that rendered every cell
    // empty passes it, which would make *"no pill at all"* a fact about a blank bar. 🔴 The title
    // is what a person reads there, and it is the folder this conversation is in.
    expect(m.q('conversation-title').textContent?.trim()).toBe('work')
  })

  it('🔴 the tooltip carries the PROVIDER’s sentence, and it differs between them', async () => {
    const onClaude = header(SESSION({ provider: 'claude' }))
    await nextTick()
    const claudeTitle = onClaude.q('session-approval-indicator').getAttribute('title') ?? ''

    const onCodex = header(SESSION({ provider: 'codex' }))
    await nextTick()
    const codexTitle = onCodex.q('session-approval-indicator').getAttribute('title') ?? ''

    expect(claudeTitle).toContain(declaredNote('claude'))
    expect(codexTitle).toContain(declaredNote('codex'))
    expect(claudeTitle).not.toBe(codexTitle)
    // ⛔ It still says where to change it — the tooltip's original job, which a rewrite could drop.
    expect(claudeTitle).toContain('in the drawer’s Open tab')
  })

  /**
   * 🔴 **The mark is on the BAR, and it is measured against the bar's own box** (standing rule 26;
   * `EXT-010` §1.2/§1.3).
   *
   * Measure the YOLO mark inside its actual `<header>` on all four edges. It sits in the
   * shrinkable state group, without a conditional band that changes header height. Read the
   * ink rather than the element box so clipping cannot pass unnoticed.
   */
  it('⚠️ the longer mark does not clip, at 1200×808 and at the 460px floor `335` guards', async () => {
    // ⛔ **The worst case this header can be in**, so the measurement is not about the easy state:
    // yolo, a pending switch back, plan mode, and a title long enough to compete for the row.
    const worst = SESSION({
      pendingApprovalMode: 'ask',
      cwd: '/Users/somebody/a/deliberately/very/long/working/directory/for/this/measurement',
      settings: {
        model: null,
        pendingModel: null,
        reasoningEffort: null,
        pendingReasoningEffort: null,
        planMode: true,
        pendingPlanMode: null,
      },
    })
    for (const width of [1200, 460]) {
      const m = header(worst, { width, height: 808 })
      // ⛔ **The host is a COLUMN, because `.conversation-pane` is** (`flex-direction: column`, and
      // this component has more than one root: the bar and the liveness line are siblings).
      // ⚠️ `harness.mount` gives every box `display: flex` with the default ROW direction — a
      // geometry the app never draws.
      m.host.style.flexDirection = 'column'
      await nextTick()
      await drawnReady()
      const barBox = m.q('session-header')
      const bar = barBox.getBoundingClientRect()
      const mark = m.q('session-approval-indicator')
      const pill = mark.getBoundingClientRect()
      // Inside the box it sits in, on every edge. A mark pushed past the right edge is the clip 335
      // guards against; one pushed past the left is the same failure from the other end; one pushed
      // past the top or the bottom is a bar that wrapped.
      expect(Math.round(pill.right), `right edge at ${width}px`).toBeLessThanOrEqual(
        Math.round(bar.right),
      )
      expect(Math.round(pill.left), `left edge at ${width}px`).toBeGreaterThanOrEqual(
        Math.round(bar.left),
      )
      expect(Math.round(pill.top), `top edge at ${width}px`).toBeGreaterThanOrEqual(
        Math.round(bar.top),
      )
      expect(Math.round(pill.bottom), `bottom edge at ${width}px`).toBeLessThanOrEqual(
        Math.round(bar.bottom),
      )
      // …and its word is drawn whole, which the box alone cannot say.
      assertDrawn(mark, `the yolo mark at ${width}px`, barBox)
      // ⚑ **The control**: at 460px the state group really is short of room — its items no longer
      // fit one row and wrap onto a second — so the reading above is made under pressure rather
      // than about a bar with room to spare. At 1200px the same items share one row, so the wrap
      // is the width's doing and not the fixture's.
      // Items of different heights are centred on one row, so a row starts only where an item
      // begins below the bottom of the row before it.
      const boxes = [...m.q('live-settings-pending').parentElement!.children]
        .map((item) => item.getBoundingClientRect())
        .sort((a, b) => a.top - b.top)
      let rows = 0
      let rowBottom = -Infinity
      for (const box of boxes) {
        if (box.top >= rowBottom - 1) rows += 1
        rowBottom = Math.max(rowBottom, box.bottom)
      }
      if (width === 460) {
        expect(
          rows,
          'nothing on the bar is under pressure at 460px — this measures an easy state',
        ).toBeGreaterThan(1)
        // Wrapping is how this bar gives way; the item allowed to shrink is still drawn whole.
        expect(cutsOf(m.q('live-settings-pending'), barBox)).toEqual([])
      } else {
        expect(rows, 'the state group wraps even at 1200px').toBe(1)
      }
      m.unmount()
    }
  })
})

// The approved Ask/Auto switch replaces the disclosure panel and its confirm button.
describe('the agent card uses the confirmed mode', () => {
  it.each(['claude', 'codex'] as const)(
    'keeps the %s switch on the confirmed value',
    async (provider) => {
      for (const mode of ['ask', 'auto'] as const) {
        const approval = useConversationControls({
          session: () => SESSION({ provider, approvalMode: mode }),
          capabilities: () => allProviderCapabilities(),
          fixed: () => false,
          recorded: () => false,
          setApprovalMode: () => {},
          setSessionSetting: () => {},
        }).approval.value!
        const m = mount(CardApproval, { approval })
        await nextTick()
        const input = m.q('card-approval') as HTMLInputElement
        expect(input.checked).toBe(mode === 'auto')
        expect(input.disabled).toBe(false)
        expect(input.closest('label')?.textContent?.replace(/\s/g, '')).toBe('AskAuto')
        expect(input.closest('label')?.title).toContain('next message')
        m.unmount()
      }
    },
  )
})
