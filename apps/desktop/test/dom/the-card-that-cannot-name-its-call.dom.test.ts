import { afterEach, describe, expect, it } from 'vitest'
// ⚠️ **The module, not the package barrel.** `@brobot2/runtime`'s index pulls in the adapters and
// with them `node:fs`, which Vite externalises for the browser — so importing from the barrel
// takes this whole file down at load. `codex/external-mcp.ts` imports nothing but its own types.
import {
  codexElicitation,
  elicitationQuestions,
  externalMcpElicitationPrompt,
} from '../../../../packages/runtime/src/codex/external-mcp'
import PermissionCard from '../../src/renderer/src/components/PermissionCard.vue'
import UserInputCard from '../../src/renderer/src/components/UserInputCard.vue'
import type {
  PermissionItem,
  UserInputItem,
  UserInputRequestEvent,
} from '../../src/renderer/src/lib/transcript'
import { boundPermissionDetail } from '../../../../packages/runtime/src/events'
import { publishedOffer } from '../../../../packages/runtime/src/permission'
import { WHAT_COMES_AFTER_IS_NOT_OURS } from '../../src/renderer/src/lib/user-input-offer'
import { mount, unmountAll, visible } from './harness'

/**
 * # 🔴 605 · the card that cannot name its call, as a person reads it
 *
 * ⛔ **`HO-042` §3 refused this card** — *"a card that cannot name its subject cannot meet
 * criterion 20 … That is not a weaker card. It is a worse one."* ⚑ **The PO has withdrawn it**
 * (`HO-090` §1): *"A card that says plainly this is a tool call and we cannot yet tell you which
 * is HONEST."*
 *
 * ## ⚠️ Why a MOUNT and not a render string
 *
 * ⛔ **The whole of `HO-090` §1.2 is a claim about what a person SEES**: the gap is admitted *in
 * the card, visibly* — not in a tooltip, not in a footnote. ⚑ `593` measured what a footnote costs
 * on a desktop app (a hover nobody performs, a keyboard that never reaches it), so the admission
 * is asserted as painted text in the same block as everything else.
 *
 * ## ⛔ Nothing here spells the card's sentence twice
 *
 * ⚑ The expectations are built from `externalMcpElicitationPrompt` and `elicitationQuestions` —
 * the adapter's own composers, fed the frame `probe:codex-external-mcp` arm F recorded off the
 * bundled 0.146.0 binary. ⚠️ **So this goes red the day the card and the adapter stop saying one
 * thing, whichever of them moved**, and it cannot pass because a string was copied into it.
 */

afterEach(unmountAll)

const NOW = 1_700_000_000_000

/** The frame the app-server really sent — `probe:codex-external-mcp` arm F, field for field. */
const FRAME = {
  // ⚠️ **The thread id is the only field a re-run changes**, so it is the one thing here that is
  // not "field for field" in any lasting sense — every other value is the frame's own shape.
  threadId: '01a0c170-2775-76c1-80c1-fa72b85c8874',
  turnId: null,
  serverName: 'kibana',
  mode: 'form',
  _meta: null,
  message: 'Which index should I search?',
  requestedSchema: {
    type: 'object',
    properties: {
      index: { type: 'string', enum: ['logs', 'metrics'], title: 'Index' },
      deep: { type: 'boolean', title: 'Search everything?' },
    },
    required: ['index'],
  },
}

function elicitationOf(
  over: Record<string, unknown> = {},
): NonNullable<ReturnType<typeof codexElicitation>> {
  const parsed = codexElicitation({ ...FRAME, ...over })
  if (parsed === null) throw new Error('the frame the probe recorded no longer parses')
  return parsed
}

const askedItem = (request: UserInputRequestEvent): UserInputItem & { at: number } => ({
  kind: 'userInput',
  id: 'ui_605',
  request,
  answered: null,
  note: null,
  refused: null,
  at: NOW,
})

function theCard(over: Record<string, unknown> = {}): UserInputItem & { at: number } {
  const elicitation = elicitationOf(over)
  return askedItem({
    type: 'user_input_request',
    id: 'req_605',
    prompt: externalMcpElicitationPrompt(elicitation),
    questions: elicitationQuestions(elicitation) as UserInputRequestEvent['questions'],
  })
}

describe('605 §1 · the card names the server and says what it cannot name', () => {
  it('🔴 a person reads WHO is asking, and that BroBot cannot say which call it is', () => {
    const m = mount(UserInputCard, { item: theCard() }, { width: 900, height: 700 })
    const said = m.q('user-input-card').textContent ?? ''

    // ⛔ **The server, because the frame names one** — `HO-090` §3.1's second route, and the
    // difference between this card and the one `HO-042` §3 refused.
    expect(said).toContain('kibana is asking you something')
    // ⚑ **And the gap, in the card** (`HO-090` §1.2) rather than in a title attribute.
    expect(said).toContain('cannot tell you which of this server’s tools you are answering for')
    // ⚠️ **It is PAINTED, not merely present.** `593`'s cost, asserted rather than assumed.
    expect(visible(m.q('user-input-card'))).toBe(true)
  })

  it('⛔ it names no tool and no call, and claims no check this app did not perform', () => {
    const said = (
      mount(UserInputCard, { item: theCard() }).q('user-input-card').textContent ?? ''
    ).toLowerCase()
    // 🔴 **`HO-090` §3.2** — never a call, never a guess, never an implication that the approval
    // is narrower than it is.
    expect(said).not.toContain('tool call')
    // ⛔ **And §5's sweep, by the ruling's own words.** A card that said it had CHECKED what the
    // server was about would be claiming an act this app never performs: it reads one field of
    // one frame and reports it.
    for (const claim of ['verified', 'checked', 'validated', 'confirmed', 'bounded']) {
      expect(said).not.toContain(claim)
    }
  })

  it('⚑ the server’s own words are marked as the server’s, and come AFTER the admission', () => {
    const said = mount(UserInputCard, { item: theCard() }).q('user-input-card').textContent ?? ''
    expect(said).toContain('kibana says: Which index should I search?')
    // ⛔ **`414`'s rule**: *"an attribution that follows the words it attributes is a footnote."*
    // So this app's own sentence is read first and the server's words follow it.
    expect(said.indexOf('cannot tell you')).toBeLessThan(said.indexOf('kibana says:'))
  })

  it('🔴 the admission and the server’s words are SEPARATE, not one wall of text', () => {
    // ⛔ **Found in this dispatch's own photograph** (rule 17.2) and by nothing else: the prompt
    // carries a blank line between the two, HTML collapsed it, and the admission `HO-090` §1.2
    // asks for *visibly* disappeared into the middle of a paragraph.
    //
    // ⚑ **Measured as a property a person perceives, never as a CSS declaration**
    // (`a-scoped-class-matches-nothing-in-another-component`): the same words with the break and
    // without it, and the one with the break is TALLER because it occupies more lines.
    const broken = mount(UserInputCard, { item: theCard() }, { width: 760, height: 620 })
    const asOneLine = theCard()
    const joined = {
      ...asOneLine,
      request: {
        ...asOneLine.request,
        prompt: asOneLine.request.prompt.replace('\n\n', ' '),
      },
    }
    const run = mount(UserInputCard, { item: joined }, { width: 760, height: 620 })
    // ⚠️ **The PARAGRAPH and not the card.** The card is a flex child of a fixed-height host and
    // stretches to fill it, so its box is the same either way — a measurement that would have
    // passed on nothing (`a-positive-assertion-must-differ-from-the-default`, arriving as a
    // measurement taken on the wrong box).
    const heightOf = (m: ReturnType<typeof mount>): number =>
      m.q('user-input-prompt').getBoundingClientRect().height
    expect(heightOf(broken)).toBeGreaterThan(heightOf(run))
    // ⚠️ **And the control that stops this passing on any difference at all**: both cards carry
    // exactly the same words, so the only thing that moved is where the lines break.
    expect(broken.q('user-input-card').textContent?.replace(/\s+/g, ' ')).toBe(
      run.q('user-input-card').textContent?.replace(/\s+/g, ' '),
    )
  })

  it('⚠️ a server that sent no message draws no empty quotation', () => {
    // ⛔ An absent sentence is not a blank one, and `kibana says:` over nothing invents a silence.
    const said =
      mount(UserInputCard, { item: theCard({ message: '' }) }).q('user-input-card').textContent ??
      ''
    expect(said).toContain('kibana is asking you something')
    expect(said).not.toContain('kibana says:')
  })
})

describe('605 §2 · the form is drawn as the questions it is', () => {
  it('🔴 every field the server declared is a control a person can answer', () => {
    const m = mount(UserInputCard, { item: theCard() }, { width: 900, height: 700 })
    // ⚑ The ids are the server's own property names — what the answer is filed under.
    expect(visible(m.q('user-input-question-index'))).toBe(true)
    expect(visible(m.q('user-input-question-deep'))).toBe(true)
    const said = m.q('user-input-card').textContent ?? ''
    // ⛔ **The enum's choices, and the boolean's two labels** — a boolean asked as a text box was
    // the defect `enumChoices`' boolean arm exists to stop.
    for (const label of ['logs', 'metrics', 'Yes', 'No']) expect(said).toContain(label)
  })

  it('⛔ …and the card still says what happens after, which is criterion 20’s third clause', () => {
    const m = mount(UserInputCard, { item: theCard() }, { width: 900, height: 700 })
    // ⚑ **It comes with the vocabulary rather than being written again for one provider** — the
    // reason `605` published a `user_input_request` instead of inventing a card.
    expect(m.q('user-input-after').textContent?.trim()).toBe(WHAT_COMES_AFTER_IS_NOT_OURS)
  })
})

describe('605 §3 · a request this app cannot present is shown, never swallowed', () => {
  const urlElicitation = codexElicitation({
    threadId: '01a0c170-2775-76c1-80c1-fa72b85c8874',
    turnId: null,
    serverName: 'kibana',
    mode: 'url',
    _meta: null,
    message: 'Sign in here first.',
    url: 'https://example.invalid/auth',
    elicitationId: 'e1',
  })

  const urlItem: PermissionItem & { at: number } = {
    kind: 'permission',
    id: 'p_605',
    request: {
      type: 'permission_request',
      id: 'req_605u',
      kind: 'command',
      action: 'kibana',
      // ⛔ **Through the ADAPTER's own composers, not hand-built** — found reviewing this
      // dispatch's diff: §1 and §2 below go red the day the card and the adapter disagree, and
      // this block could not, because it spelled the detail, the offer and the elicitation
      // itself by hand. ⚑ Now a change to any of the three reaches this card too.
      ...boundPermissionDetail(
        externalMcpElicitationPrompt(
          urlElicitation ?? { serverName: 'kibana', message: '', mode: 'url', fields: [] },
        ),
      ),
      scope: {
        paths: [],
        networkHosts: [],
        persistence: 'once',
        amendments: [],
        availableDecisions: publishedOffer([]),
        noPositiveBecause: 'could-not-represent-the-answers',
        underDisclosed: true,
        approvalMode: 'ask',
      },
    },
    outcome: null,
    note: null,
    refused: null,
    at: NOW,
  }

  it('⚠️ the person learns their server asked, and why nothing here can allow it', () => {
    const m = mount(PermissionCard, { item: urlItem }, { width: 900, height: 700 })
    const said = m.q('permission-card').textContent ?? ''
    // ⛔ **A silent decline is the defect `HO-018` names**: the server asked, the person never
    // learned. ⚑ So the same admission is drawn, and the WORD says why there is no way to allow.
    expect(said).toContain('kibana is asking you something')
    expect(visible(m.q('permission-cannot-allow'))).toBe(true)
    expect(m.q('permission-cannot-allow').getAttribute('data-why')).toBe(
      'could-not-represent-the-answers',
    )
    // ⚑ **And the two refusals are still on it** (`487`): withholding what a person may ALLOW is
    // the point; withholding what they may REFUSE never was.
    expect(visible(m.q('permission-deny'))).toBe(true)
  })
})
