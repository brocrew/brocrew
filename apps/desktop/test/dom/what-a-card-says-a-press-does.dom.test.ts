import { afterEach, describe, expect, it } from 'vitest'
// ⚠️ **The module, not the package barrel.** `@brobot2/runtime`'s index pulls in the adapters and
// with them `node:fs`, which Vite externalises for the browser — so importing the floor from
// the barrel takes this whole file down at load. `permission.ts` imports nothing but zod.
import { ALWAYS_HONOURED, publishedOffer } from '../../../../packages/runtime/src/permission'
import PermissionCard from '../../src/renderer/src/components/PermissionCard.vue'
import UserInputCard from '../../src/renderer/src/components/UserInputCard.vue'
import { attentionQueue } from '../../src/renderer/src/lib/attention'
import { noPositiveSays, permissionDecisionFor } from '../../src/renderer/src/lib/permission-offer'
import type {
  NoPositiveBecause,
  PermissionItem,
  PermissionOutcome,
  UserInputItem,
  UserInputRequestEvent,
} from '../../src/renderer/src/lib/transcript'
import {
  CANCEL_STOPS_NOTHING,
  WHAT_COMES_AFTER_IS_NOT_OURS,
  userInputOffer,
  whatThisAnswerDoes,
} from '../../src/renderer/src/lib/user-input-offer'
import { ASKED_TO_STOP } from '../../src/shared/how-work-stopped'
import { contrast, mount, paintedInk, parseColor, record, unmountAll, visible } from './harness'

/**
 * # 🔴 482 · the sentences, as a person reads them on the two cards
 *
 * ⛔ **`478` F3: *"`PermissionCard` says it in one word (Cancel turn), and `UserInputCard`'s
 * Approve says nothing at all."*** The queue has drawn the effect line under every button since
 * `434`; the surfaces a person actually answers on drew the word and stopped.
 *
 * ## ⚠️ Why this is a mount and not a render string
 *
 * ⛔ **A sentence can be right in a `Record` and unreadable on the control it belongs to** (`083`).
 * ⚑ The line is an 11px `<small>` inside a button that is FILLED on three of its variants —
 * `--waiting` on the approvals, the danger pair on the refusals, `--accent` on the card's primary —
 * and the muted grey every other explanation in this app uses is a token chosen for a PANEL.
 * §3 is that measurement.
 *
 * ## 🔴 §1 is the JOIN the dispatch asked for, and it has the queue on the other end
 *
 * ⛔ **Nothing here spells a sentence.** The expectation for each button is
 * `whatThisAnswerDoes` of the decision **`attentionQueue` itself built** for the same
 * `permission_request` — so this fails the day the card and the queue stop saying one thing,
 * whichever of them moved.
 */

afterEach(unmountAll)

const NOW = 1_700_000_000_000

/** A card that offers everything a Claude command card can, including the wholesale grant. */
const WIDE_SCOPE = {
  cwd: '/work',
  paths: [],
  networkHosts: [],
  persistence: 'once' as const,
  amendments: [],
  availableDecisions: ['allow', 'allow_all_for_session', 'deny', 'cancel'] as PermissionOutcome[],
  underDisclosed: true,
}

const permissionItem = (
  availableDecisions: PermissionOutcome[],
  over: Partial<PermissionItem> = {},
  // ⚑ **487 · the adapter's own word for why nothing here can be allowed**, absent on the cards
  // that can be. Its own parameter because `over` reaches the ITEM, not the request's scope.
  noPositiveBecause?: NoPositiveBecause,
): PermissionItem & { at: number } => ({
  kind: 'permission',
  id: 'item_1',
  request: {
    type: 'permission_request',
    id: 'req_1',
    kind: 'command',
    action: 'Bash',
    detail: 'run: ls',
    scope: { ...WIDE_SCOPE, availableDecisions, noPositiveBecause },
  } as PermissionItem['request'],
  outcome: null,
  note: null,
  refused: null,
  at: NOW,
  ...over,
})

/** One `user_input_request`, built whole. */
const asking = (over: Partial<UserInputRequestEvent> = {}): UserInputRequestEvent => ({
  type: 'user_input_request',
  id: 'req_u',
  prompt: 'the agent asks you to approve something',
  questions: [],
  ...over,
})

const inputItem = (request: UserInputRequestEvent): UserInputItem & { at: number } => ({
  kind: 'userInput',
  id: 'ui_1',
  request,
  answered: null,
  note: null,
  refused: null,
  at: NOW,
})

/**
 * 🔴 **The OTHER surface's answer to the same request** — `attention.ts`'s own projection, not a
 * list rebuilt here. This is what makes §1 a join rather than a second assertion that the card
 * calls a function.
 */
function whatTheQueueSays(availableDecisions: PermissionOutcome[]): Map<string, string> {
  const rec = record([
    permissionItem(availableDecisions).request as never,
    { type: 'status', state: 'waiting_permission' } as never,
  ])
  const [row] = attentionQueue([rec], () => 'waiting: permission')
  if (!row) throw new Error('the queue drew no row for a request it must draw one for')
  return new Map(
    row.decisions.map((decision) => [
      decision.kind === 'permission' ? decision.decision.outcome : decision.kind,
      whatThisAnswerDoes(decision),
    ]),
  )
}

const smallIn = (button: HTMLElement): string =>
  button.querySelector('small')?.textContent?.trim() ?? ''
const px = (el: Element): number => Number.parseFloat(getComputedStyle(el).fontSize)

/* ------------------------------------------------------------------ §1 · PermissionCard, joined */

describe('§1 · every button on a permission card says what it does, in the queue’s words', () => {
  it('🔴 the card’s line for each outcome IS the queue’s line for the same outcome', () => {
    const said = whatTheQueueSays(WIDE_SCOPE.availableDecisions)
    const m = mount(PermissionCard, { item: permissionItem(WIDE_SCOPE.availableDecisions) })

    // ⚑ The premise: the queue really did project more than one answer for this request, so the
    // loop below is measuring a set rather than a single lucky case.
    expect(said.size).toBeGreaterThan(2)
    for (const [outcome, sentence] of said) {
      const button = m.q(`permission-${outcome}`)
      expect(visible(button), `${outcome} is not on screen`).toBe(true)
      expect(smallIn(button), `${outcome} says the wrong thing`).toBe(sentence)
    }
  })

  // 🔴 743 · re-aimed — `739` F-1, ruled by the PM: the queue offers the wholesale grant too (after
  // its row, under the card's warning), so its line is joined like every other. It pinned the queue
  // NOT drawing it.
  it('⛔ …including the wholesale grant, which the queue draws too — in the card’s own words', () => {
    const said = whatTheQueueSays(WIDE_SCOPE.availableDecisions)
    expect(said.has('allow_all_for_session')).toBe(true)
    const m = mount(PermissionCard, { item: permissionItem(WIDE_SCOPE.availableDecisions) })
    const wide = m.q('permission-allow_all_for_session')
    expect(visible(wide)).toBe(true)
    expect(smallIn(wide)).toBe(said.get('allow_all_for_session'))
    expect(smallIn(wide)).toBe(
      whatThisAnswerDoes({
        kind: 'permission',
        label: 'Always allow',
        decision: { outcome: 'allow_all_for_session' },
      }),
    )
  })

  it('⚑ the unknown is admitted once for the row, exactly as the queue admits it', () => {
    const m = mount(PermissionCard, { item: permissionItem(WIDE_SCOPE.availableDecisions) })
    expect(m.all('permission-after')).toHaveLength(1)
    expect(m.q('permission-after').textContent?.trim()).toBe(WHAT_COMES_AFTER_IS_NOT_OURS)
  })

  it('⛔ an ANSWERED card predicts nothing — the sentences are about a press still to come', () => {
    const m = mount(PermissionCard, {
      item: permissionItem(WIDE_SCOPE.availableDecisions, {
        outcome: 'deny',
      }),
    })
    expect(m.all('permission-after')).toHaveLength(0)
    expect(m.all('permission-does-deny')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------- §2 · UserInputCard, joined */

describe('§2 · both of a question card’s controls say what they do', () => {
  it('🔴 Approve says what the OFFER says, which is the decision the overview is handed', () => {
    const request = asking({ consent: 'stop-planning' })
    const offer = userInputOffer(request)
    const m = mount(UserInputCard, { item: inputItem(request) })

    expect(smallIn(m.q('user-input-answer'))).toBe(offer.positiveDoes)
    expect(smallIn(m.q('user-input-answer'))).toBe(whatThisAnswerDoes(offer.decisions[0] as never))
    expect(smallIn(m.q('user-input-reject'))).toBe(offer.rejectDoes)
    expect(m.q('user-input-after').textContent?.trim()).toBe(WHAT_COMES_AFTER_IS_NOT_OURS)
  })

  it('⚑ …and a DIFFERENT consent moves the line, so the line is about this request', () => {
    // `a-comparison-tested-where-both-sides-agree`: without this, one sentence for every card
    // would satisfy the test above.
    const planning = mount(UserInputCard, {
      item: inputItem(asking({ consent: 'start-planning' })),
    })
    const grant = mount(UserInputCard, {
      item: inputItem(asking({ permission: { paths: [], network: false } })),
    })
    expect(smallIn(planning.q('user-input-answer'))).not.toBe(smallIn(grant.q('user-input-answer')))
  })

  it('⛔ a card that ASKS says what its form sends, and the word beside it is still Answer', () => {
    const request = asking({
      questions: [{ id: 'q', prompt: 'which?', options: [{ label: 'Yes' }, { label: 'No' }] }],
    })
    const m = mount(UserInputCard, { item: inputItem(request) })
    const button = m.q('user-input-answer')
    expect(button.querySelector('strong')?.textContent?.trim()).toBe('Answer')
    expect(smallIn(button)).toBe(userInputOffer(request).positiveDoes)
  })
})

/* --------------------------------------------------------------------- §3 · a person can read it */

describe('§3 · the line is quieter than the word, and legible on a FILLED control', () => {
  it('🔴 smaller than the word it sits under, on both cards', () => {
    const permission = mount(PermissionCard, {
      item: permissionItem(WIDE_SCOPE.availableDecisions),
    })
    const allow = permission.q('permission-allow')
    const word = allow.querySelector('strong')
    const line = allow.querySelector('small')
    expect(word && line).toBeTruthy()
    expect(px(line as Element)).toBeLessThan(px(word as Element))

    const input = mount(UserInputCard, { item: inputItem(asking()) })
    const approve = input.q('user-input-answer')
    expect(px(approve.querySelector('small') as Element)).toBeLessThan(
      px(approve.querySelector('strong') as Element),
    )
  })

  it('⛔ readable against the fill it is printed on — the three variants, measured', () => {
    // ⚠️ **This is why the rule is `color: inherit` and not `--muted`.** The approvals are filled
    // with `--waiting`, the refusals with the danger pair and the question card's primary with
    // `--accent`; a grey picked for a panel would vanish on all three
    // (`an-alpha-fill-in-a-light-scope-is-not-a-light-surface`).
    const permission = mount(PermissionCard, {
      item: permissionItem(WIDE_SCOPE.availableDecisions),
    })
    const input = mount(UserInputCard, { item: inputItem(asking()) })
    const lines = [
      permission.q('permission-allow').querySelector('small'),
      permission.q('permission-cancel').querySelector('small'),
      input.q('user-input-answer').querySelector('small'),
    ]
    for (const line of lines) {
      expect(line).toBeTruthy()
      const colour = parseColor(getComputedStyle(line as Element).color)
      expect(colour).not.toBeNull()
      const { fg, bg } = paintedInk(line as Element, colour as never)
      expect(
        contrast(fg, bg),
        `unreadable on its own fill: ${(line as Element).textContent}`,
      ).toBeGreaterThan(3)
    }
  })
})

/* ------------------------------------------------ §4 · the move nobody could reach, on the card */

describe('§4 · the Codex agent-tool card now draws its third move', () => {
  /** What `handleAgentToolCall` publishes since 482 — one positive plus the adapters' floor. */
  const AGENT_TOOL = ['allow', ...ALWAYS_HONOURED] as PermissionOutcome[]

  it('🔴 Cancel turn is on screen, pressable, and says what it does', () => {
    const m = mount(PermissionCard, { item: permissionItem(AGENT_TOOL) })
    const cancel = m.q('permission-cancel')
    expect(visible(cancel)).toBe(true)
    expect((cancel as HTMLButtonElement).disabled).toBe(false)
    expect(cancel.querySelector('strong')?.textContent?.trim()).toBe('Cancel turn')
    // ⛔ **The word is not replaced by the line, and the line carries a clause the word cannot.**
    expect(smallIn(cancel)).toBe(
      whatThisAnswerDoes({
        kind: 'permission',
        label: 'Cancel turn',
        decision: { outcome: 'cancel' },
      }),
    )
    expect(smallIn(cancel)).not.toBe('Cancel turn')
    // 🔴 **492 · and the CLAIM reaches a person, painted** (`HO-032` §1 · criterion 20). ⛔ This is
    // the door the ruling is about: the press sends `turn/interrupt`, and `interrupt_agent` — the
    // verb that performs the same act for a model — composes its answer from the same bytes. ⚑ A
    // string being right in a `Record` is not a person reading it (`083`), which is why this
    // assertion is here and not only in the value tests.
    expect(smallIn(cancel)).toContain(ASKED_TO_STOP)
    // ⚠️ **And not the claim it used to make.** *is interrupted* said the turn was already over,
    // which `RuntimeHost.interruptAgent` refuses to say on either provider.
    expect(smallIn(cancel)).not.toContain('is interrupted')
  })

  it('⚑ …and the control: the set that card published before 482 drew no such button', () => {
    const m = mount(PermissionCard, { item: permissionItem(['allow', 'deny']) })
    expect(m.all('permission-cancel')).toHaveLength(0)
    expect(m.all('permission-allow')).toHaveLength(1)
  })
})

/* ------------------------------------- §5 · the card a person could not answer at all (487) */

/**
 * 🔴 **487 · the painted half of `483`'s repair 1.**
 *
 * ⛔ **`482` drew the missing move on the agent-tool card and left the fail-closed one alone**,
 * because what an offer with nothing in it should show a person was a ruling. ⚑ This is that
 * ruling in a real engine: the two refusals are pressable, they emit the payload the host
 * settles, and the line above them no longer blames the provider for this app's decision.
 *
 * ⚠️ **The ledger half is one file over** — `every-answer-through-the-persons-queue.test.ts` §487
 * settles exactly this payload into a `user_decision` row. ⛔ **No harness in this repo runs a
 * mounted component against a real ledger** (this project is chromium and has no `node:fs`), so
 * the join is an asserted identity between the two: the emitted decision here, and the decision
 * settled there, are both `permissionDecisionFor(outcome)`.
 */
describe('§5 · the withheld-positive card is refusable, and says whose decision that was (487)', () => {
  /** The offer `commandScope` publishes when it cannot describe the grant — floor and nothing else. */
  const WITHHELD = publishedOffer([])

  it('🔴 both refusals are on screen and pressable, and no positive is', () => {
    const m = mount(PermissionCard, {
      item: permissionItem(WITHHELD, {}, 'could-not-describe-the-grant'),
    })
    for (const refusal of ['deny', 'cancel'] as const) {
      const button = m.q(`permission-${refusal}`)
      expect(visible(button)).toBe(true)
      expect((button as HTMLButtonElement).disabled).toBe(false)
    }
    for (const positive of ['allow', 'allow_for_session', 'allow_all_for_session'] as const) {
      expect(m.all(`permission-${positive}`)).toHaveLength(0)
    }
  })

  it('🔴 the press emits exactly what the host settles, for each refusal', () => {
    for (const outcome of ['deny', 'cancel'] as const) {
      const emitted: unknown[] = []
      const m = mount(PermissionCard, {
        item: permissionItem(WITHHELD, {}, 'could-not-describe-the-grant'),
        onDecide: (_id: string, decision: unknown) => emitted.push(decision),
      })
      ;(m.q(`permission-${outcome}`) as HTMLButtonElement).click()
      // ⛔ **The identity that joins this to the ledger test**, and it is the product's own
      // producer rather than a literal typed twice.
      expect(emitted).toEqual([permissionDecisionFor(outcome)])
    }
  })

  it('⛔ the line above them names this app, and never the provider', () => {
    const m = mount(PermissionCard, {
      item: permissionItem(WITHHELD, {}, 'could-not-describe-the-grant'),
    })
    const said = m.q('permission-cannot-allow')
    expect(visible(said)).toBe(true)
    expect(said.innerText.trim()).toBe(noPositiveSays('could-not-describe-the-grant'))
    expect(said.getAttribute('data-why')).toBe('could-not-describe-the-grant')
    // ⚑ **The control, one fact over**: the same card with a positive draws no such line, so the
    // assertions above cannot be satisfied by an element that is always there.
    const ordinary = mount(PermissionCard, { item: permissionItem(WIDE_SCOPE.availableDecisions) })
    expect(ordinary.all('permission-cannot-allow')).toHaveLength(0)
  })
})

/* ------------------------------------------------ §6 · a SERVER's card says what the server is told */

describe('§6 · 728 — a card an MCP server raised says what the SERVER is told, not the agent', () => {
  // ⛔ Until `728` (review) every line said *"the agent …"*: on a server's card Allow sends the
  // SERVER `accept`, Deny `decline`, Cancel `cancel`, and the agent is told nothing.
  const serversCard = (cancelStopsNothing: boolean) =>
    permissionItem(['allow', 'deny', 'cancel'], {
      request: {
        type: 'permission_request',
        id: 'req_s',
        kind: 'command',
        action: 'kibana',
        detail: 'kibana says: may I go on?',
        mcpServerAsks: { server: 'kibana' },
        ...(cancelStopsNothing ? { cancelStopsNothing: true } : {}),
        scope: { ...WIDE_SCOPE, availableDecisions: ['allow', 'deny', 'cancel'] },
      } as PermissionItem['request'],
    })

  it('🔴 Allow and Deny name the server and what it is told — Cancel keeps 730’s words (R81)', () => {
    const quiet = mount(PermissionCard, { item: serversCard(true) })
    expect(smallIn(quiet.q('permission-allow'))).toBe('kibana is told yes')
    expect(smallIn(quiet.q('permission-deny'))).toBe('kibana is told no')
    expect(smallIn(quiet.q('permission-cancel'))).toBe(CANCEL_STOPS_NOTHING)
    const stopping = mount(PermissionCard, { item: serversCard(false) })
    expect(smallIn(stopping.q('permission-cancel'))).toBe(
      `the whole turn is ${ASKED_TO_STOP}, and this request is refused`,
    )
  })

  it('⚑ CONTROL · the same card without the marker speaks of the agent, as ever', () => {
    const m = mount(PermissionCard, {
      item: permissionItem(['allow', 'deny', 'cancel']),
    })
    expect(smallIn(m.q('permission-allow'))).toBe('the agent may do this once')
  })

  it('🔴 …and the queue says the same of it, from the same function', () => {
    const rec = record([
      serversCard(true).request as never,
      { type: 'status', state: 'waiting_permission' } as never,
    ])
    const [row] = attentionQueue([rec], () => 'waiting: permission')
    if (!row) throw new Error('the queue drew no row for a server’s card')
    const said = row.decisions.map((decision) => whatThisAnswerDoes(decision))
    expect(said).toContain('kibana is told yes')
    expect(said).toContain('kibana is told no')
  })

  it('🔴 a server’s form WITH fields sends its answers to the server, and its reject tells the server no', () => {
    const offer = userInputOffer(
      asking({
        prompt: 'kibana says: which index?',
        questions: [{ id: 'index', prompt: 'Index', options: [{ label: 'logs' }] }],
        mcpServerAsks: { server: 'kibana' },
      } as Partial<UserInputRequestEvent>),
    )
    expect(offer.positiveDoes).toBe('kibana gets the answers you filled in here')
    expect(offer.rejectDoes).toBe('kibana is told no')
    // ⚑ The control: the agent's own question keeps the agent's words.
    const own = userInputOffer(
      asking({ questions: [{ id: 'index', prompt: 'Index', options: [{ label: 'logs' }] }] }),
    )
    expect(own.positiveDoes).not.toContain('kibana')
  })
})
