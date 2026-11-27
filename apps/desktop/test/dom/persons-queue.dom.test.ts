import { noPositiveSays } from '../../src/renderer/src/lib/permission-offer'
import type {
  AboutWork,
  LedgerWalk,
  LedgerWalkKind,
  PersonsDecision,
  PersonsQuestion,
  RequestOnlyAPersonCanSettle,
  RoutedRequest,
  WorkInHand,
} from '../../src/shared/question-contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import CapabilitiesSheet from '../../src/renderer/src/components/CapabilitiesSheet.vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import OverlayHost from '../../src/renderer/src/components/OverlayHost.vue'
import PersonsQueue from '../../src/renderer/src/components/PersonsQueue.vue'
import { usePersonsQueue, type PersonsQueueRow } from '../../src/renderer/src/lib/persons-queue'
import type { AttentionDecision, AttentionRequest } from '../../src/renderer/src/lib/attention'
import {
  NOTHING_NAMED_THE_WORK,
  chainReading,
  chainSentence,
  decisionReading,
  escalationChain,
  readingSentence,
  aPersonsSince,
} from '../../src/shared/questions'
import type { AgentIdentities } from '../../src/shared/runtime-ipc'
import {
  contrast,
  luminance,
  mount,
  paintedBackground,
  parseColor,
  show,
  unmountAll,
  visible,
  type Mounted,
  permission as permissionEvent,
  permissionButtons,
  permissionOnQueue,
} from './harness'

/**
 * 🔴 **401 · the queue that ends at a person, measured where a person would see it.**
 *
 * ## ⛔ Why this is a DOM file and not a render one
 *
 * The load-bearing claims are all about two layers of a real layout: that the summons and the
 * emergency stop occupy disjoint bands, that neither is under the other, and that the stop is
 * still one Shift+Tab away when the summons is drawn. ⚑ `390`'s own probe samples one point, and
 * `392` measured what that misses — so §1 reads rects and §2 reads paint order, and each has a
 * planted control that fails when the property it measures stops holding.
 *
 * ⚠️ **The viewport is shared across this whole directory**, so it is captured before the first
 * resize and restored after every test.
 */

/* ------------------------------------------------------------------------------ the fixtures */

const NOW = 1_700_000_000_000
const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }

const queue = usePersonsQueue()
let travelled: PersonsQueueRow[] = []
/** ⚑ **434** — what was settled HERE, and what was taken over without leaving. */
let settled: { row: PersonsQueueRow; decision: AttentionDecision }[] = []
let takenOver: PersonsQueueRow[] = []

const identities = (): AgentIdentities => ({
  identities: [
    {
      id: 'agp:default:pm',
      slug: 'pm',
      displayName: null,
      createdAt: NOW,
      // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
      createdBy: null,
      provider: null,
      // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
      externalMcpServerIds: [],
    },
  ],
  foldersWithoutARow: [],
  use: [],
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
})

const NAME = (id: string): string => id.replace('sess_', '')

/**
 * ⚑ **613 · the marked NAME on a hop, and never the act beside it.** ⛔ A hop draws two spans and
 * both carry a `data-cy`, so `span[data-cy]` reads the chain twice; this names the two marks a
 * participant can carry — `PersonsQueueHop.you` decides which.
 */
const NAMED = '[data-cy="persons-queue-hop"], [data-cy="persons-queue-you"]'

function routed(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
): RoutedRequest {
  return {
    parent: 'sess_pm-alpha',
    went: { is: 'the-parent', to: 'the-parent' },
    at: NOW,
    state: 'open',
    endedAt: null,
    escalatedAt: NOW + 30_000,
    ...over,
  }
}

function asked(
  over: Partial<RoutedRequest> & {
    requestId: string
    askedBy: string
    work?: readonly WorkInHand[]
    about?: AboutWork
  },
  openQuestionOf: (sessionId: string) => RoutedRequest | null = () => null,
): PersonsQuestion {
  const request = routed(over)
  const chain = escalationChain(request, openQuestionOf)
  return {
    request,
    // ⚑ **611 · the moment it became a person's** — every row of this fixture is escalated, so it
    // is that stamp, which is what this fixture's ordering has always been drawn from.
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    // ⚑ **Empty by default, and that is the ordinary shape** (434): most conversations that ask a
    // question hold no piece of work, and the row says so rather than leaving the clause out.
    work: over.work ?? [],
    // ⚑ **474 · the ordinary arm** — a provider-raised question names no work, which is what `430`
    // measured and what every row of this fixture is.
    about: over.about ?? NOTHING_NAMED_THE_WORK,
    // ⚑ **602 · and the arm that goes with it** — see `HowItWasRaised`. A provider-raised question
    // has a card in the asker's transcript, which is what every row of this fixture is.
    raisedBy: 'the-provider',
    // ⚑ **619 · a provider-raised question has a card and the card carries its offer** — see
    // `whatTheAskerOffered`, which answers `null` for every row this fixture builds.
    offered: null,
    asked: null,
  }
}

const ONE = [asked({ requestId: 'req_1', askedBy: 'sess_worker-7' })]

/**
 * ⛔ **403's population: a request that never travelled.** One hop, `because` set, and the age is
 * the routing's own stamp because nothing ever escalated it.
 */
function onlyAPersons(
  over: Partial<RoutedRequest> & { requestId: string; askedBy: string },
  says = 'a command or file approval, which is a person’s to give',
): PersonsDecision {
  const request = {
    ...routed({ escalatedAt: null, ...over }),
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
  } as const satisfies RequestOnlyAPersonCanSettle
  const reading = decisionReading(request.askedBy, NAME)
  return {
    request,
    reading,
    sentence: readingSentence(reading),
    says,
    work: [],
  }
}

/**
 * ⚑ **453 · the ordinary walk around a fixture list** — `PersonsQueue.supply` takes a `LedgerWalk`
 * per population now, and every case in this file means *a walk that opened a ledger and dropped
 * nothing*. ⛔ `null` stays `null`: it is *this read has never answered*, which is a different fact
 * and the one `partial` is drawn from.
 */
function walked<Row>(
  rows: readonly Row[] | null,
  walk: LedgerWalkKind = 'every-conversation-that-routed',
): LedgerWalk<Row> | null {
  return rows === null ? null : { rows, walk, ledgers: Math.max(rows.length, 1), rowsUnread: 0 }
}

/**
 * ⚠️ **One stub for the whole file, installed before anything mounts.** `useAgentStore` memoises
 * the bridge at first call and is a module singleton, so a per-test stub is captured by the first
 * test and ignored by every later one — `a-stop-a-modal-cannot-cover.dom.test.ts`'s note, and the
 * reason the panel this file opens on top of is a REAL one from that file's census rather than a
 * placeholder div that would prove nothing about paint order.
 */
;(window as unknown as { api?: unknown }).api = {
  runtime: {
    agentIdentities: async () => identities(),
    setExternalMcpServers: async () => identities().identities[0],
  },
}

/**
 * 🔴 **One live attention row, as `attention.ts` projects it** (434) — what makes a queue row
 * answerable where it stands.
 *
 * ⚠️ **Only the fields this surface reads are meaningful**; the rest are the projection's own
 * shape, filled so the object is the real type and not a cast.
 */
function live(
  key: string,
  over: {
    sent?: boolean
    refused?: string
    withhold?: boolean
  } = {},
): AttentionRequest {
  const [sessionId = '', requestId = ''] = key.split(':')
  const event = permissionEvent(requestId)
  return permissionOnQueue(
    sessionId,
    over.withhold
      ? {
          ...event,
          scope: {
            ...event.scope,
            availableDecisions: ['deny', 'cancel'],
            noPositiveBecause: 'could-not-describe-the-grant',
          },
        }
      : event,
    { sent: over.sent ?? false, refused: over.refused ?? null },
  )
}

/** ⚑ **The map `RuntimeScreen` builds from `needsYou`**, for one key. */
function answerable(
  key: string,
  over: Parameters<typeof live>[1] = {},
): Map<string, AttentionRequest> {
  return new Map([[key, live(key, over)]])
}

/** Hand the module a world, the way `RuntimeScreen` does. */
function supply(
  questions: readonly PersonsQuestion[] | null,
  world: Partial<{
    held: Set<string>
    answerable: Map<string, AttentionRequest>
    now: number
    decisions: readonly PersonsDecision[] | null
    lastLookAnswered: { questions: boolean; decisions: boolean }
    /** ⚑ **468 · keys this window has already answered** — `PersonsQueueWorld.answeredFromHere`. */
    answeredFromHere: ReadonlySet<string>
    /** ⚑ **453 · every look walked NOTHING** — `NULL_SESSION_STORE`'s own answer. */
    noLedger: boolean
    /** ⚑ **453 · ledger rows the questions walk could not read.** */
    rowsUnread: number
  }> = {},
): void {
  const shape = <Row>(
    rows: readonly Row[] | null,
    walk: LedgerWalkKind = 'every-conversation-that-routed',
    rowsUnread = 0,
  ): LedgerWalk<Row> | null =>
    world.noLedger === true
      ? { rows: [], walk: 'no-ledger', ledgers: 0, rowsUnread: 0 }
      : rows === null
        ? null
        : { ...walked(rows, walk)!, rowsUnread }
  queue.supply(
    shape(questions, 'every-conversation-that-routed', world.rowsUnread ?? 0),
    // ⚠️ **Defaulted to EMPTY and never to `null`.** `null` from every read is `null` for the
    // whole view (403), so a helper that defaulted another population to *not asked yet* would
    // make every one of `401`'s tests assert on a queue that never renders.
    shape(world.decisions === undefined ? [] : world.decisions),
    {
      held: world.held ?? new Set<string>(),
      answerable: world.answerable ?? new Map<string, AttentionRequest>(),
      now: world.now ?? NOW + 120_000,
      lastLookAnswered: world.lastLookAnswered ?? { questions: true, decisions: true },
      answeredFromHere: world.answeredFromHere ?? new Set<string>(),
    },
    {
      travel: (row) => travelled.push(row),
      settle: (row, decision) => settled.push({ row, decision }),
      takeOver: (row) => takenOver.push(row),
      open: () => {},
    },
  )
}

/**
 * ⚠️ **A 10px box.** `OverlayHost` is `position: fixed`, so a wide host div would silently supply
 * the width the VIEWPORT is supposed to — and the whole question here is which layer is on top at
 * a real coordinate.
 */
const Layer = defineComponent({
  name: 'OverlayUnderTest',
  props: { open: { type: Function as PropType<() => unknown>, required: true } },
  emits: ['close'],
  setup:
    (props, { emit }) =>
    () =>
      h(
        OverlayHost,
        { label: 'A sheet', onClose: () => emit('close') },
        { default: () => [props.open()] },
      ),
})

async function overlayOf(
  open: () => unknown,
  width = 1180,
  height = 808,
  onClose?: () => void,
): Promise<Mounted> {
  await page.viewport(width, height)
  const m = mount(Layer, { open, onClose }, { width: 10, height: 10 })
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
  const toggle = m.all('persons-queue-toggle')[0]
  if (toggle) {
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    toggle.click()
    await nextTick()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  }
  return m
}

async function overlay(width = 1180, height = 808, onClose?: () => void): Promise<Mounted> {
  return overlayOf(
    () => h(CapabilitiesSheet, { profileSlug: 'pm', runsOn: 'codex' }),
    width,
    height,
    onClose,
  )
}

/** `390`'s own question, unchanged: is the thing I am pointing at the thing that gets the click. */
function reachable(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect()
  if (box.width === 0 || box.height === 0) return false
  const at = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return at !== null && element.contains(at)
}

/** A real Tab, at the window, where `OverlayHost` listens. */
function tab(shiftKey = false): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }))
}

/** Open a row's more-options disclosure, where its category, provenance and broader answers are. */
async function openMore(m: Mounted, key: string): Promise<void> {
  ;(m.q(`persons-queue-more-${key}`) as HTMLDetailsElement).open = true
  await nextTick()
}

beforeEach(() => {
  travelled = []
  settled = []
  takenOver = []
  supply(ONE)
})

afterEach(async () => {
  unmountAll()
  queue.forget()
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

it('switches the Waiting on you questions between oldest and newest first', async () => {
  const older = asked({ requestId: 'older', askedBy: 'sess_older', escalatedAt: NOW - 2 })
  const newer = asked({ requestId: 'newer', askedBy: 'sess_newer', escalatedAt: NOW })
  const middle = asked({ requestId: 'middle', askedBy: 'sess_middle', escalatedAt: NOW - 1 })
  const sameDate = asked({ ...middle.request, escalatedAt: NOW })
  const latest = asked({ requestId: 'latest', askedBy: 'sess_latest', escalatedAt: NOW + 1 })
  const earlier = asked({ requestId: 'earlier', askedBy: 'sess_earlier', escalatedAt: NOW - 3 })
  supply([newer, middle, older])
  const home = mount(WaitingOnYou, {}, { width: 1180, height: 808 })
  await nextTick()
  const order = () =>
    Array.from(home.q('waiting-list-questions').children, (card) =>
      card.querySelector('[data-cy^="persons-queue-row-"]')?.getAttribute('data-cy'),
    )
  const keys = (...requests: PersonsQuestion[]) =>
    requests.map(({ request }) => `persons-queue-row-${request.askedBy}:${request.requestId}`)
  const select = home.q('waiting-sort') as HTMLSelectElement
  const pickOrder = async (value: string) => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
  }

  expect(select.selectedOptions[0]?.textContent).toBe('Oldest first')
  expect(order()).toEqual(keys(older, middle, newer))
  await pickOrder('newest')
  expect(select.selectedOptions[0]?.textContent).toBe('Newest first')
  expect(order()).toEqual(keys(newer, middle, older))

  // The refresh makes two dates equal. The queue's key order would now put middle first.
  supply([older, sameDate, newer, latest])
  await nextTick()
  expect(order()).toEqual(keys(newer, sameDate, older))
  home.q('waiting-show-new').click()
  await nextTick()
  expect(order()).toEqual(keys(latest, newer, sameDate, older))

  supply([older, sameDate, newer, latest, earlier])
  await nextTick()
  const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
  try {
    home.q('waiting-show-new').click()
    await nextTick()
    expect(order()).toEqual(keys(latest, newer, sameDate, older, earlier))
    expect(scroll.mock.contexts).toEqual([home.q('waiting-list-questions').lastElementChild])
  } finally {
    scroll.mockRestore()
  }

  await pickOrder('oldest')
  expect(order()).toEqual(keys(earlier, older, sameDate, newer, latest))
})

describe('The waiting queue stays reachable in an overlay', () => {
  it.each([1440, 1200, 1180])('keeps the queue in its band at %spx', async (width) => {
    const m = await overlay(width)
    const band = m.q('overlay-host').querySelector<HTMLElement>('.overlay-corner')!
    const box = band.getBoundingClientRect()
    const queue = m.q('persons-queue')
    const card = queue.getBoundingClientRect()
    expect(Math.round(box.left)).toBe(10)
    expect(Math.round(box.width)).toBe(200)
    expect(Math.round(card.left)).toBe(10)
    expect(Math.round(card.right)).toBe(210)
    expect(Math.round(card.bottom)).toBe(Math.round(box.bottom))
    expect(reachable(queue)).toBe(true)
  })

  it('a layer above the queue makes it unreachable', async () => {
    const m = await overlay(1180)
    const lid = document.createElement('div')
    lid.style.cssText = 'position:fixed;inset:0;z-index:3;background:#fff'
    m.q('overlay-host').append(lid)
    await nextTick()
    expect(reachable(m.q('persons-queue'))).toBe(false)
    lid.remove()
  })

  it('draws no queue when nothing is waiting', async () => {
    supply([])
    const m = await overlay(1180)
    expect(m.all('persons-queue')).toEqual([])
  })

  it('reaches the queue with Shift+Tab from the opening focus', async () => {
    const m = await overlay(1180)
    tab(true)
    await nextTick()
    expect(m.q('persons-queue').contains(document.activeElement)).toBe(true)
  })

  it('⛔ the summons does not take the focus a dialog opens with', async () => {
    const m = await overlay(1180)
    const active = document.activeElement as HTMLElement | null
    expect(active).not.toBe(null)
    expect(m.q('persons-queue').contains(active)).toBe(false)
    expect(m.q('capabilities-sheet').contains(active)).toBe(true)
  })

  /**
   * ⚑ **The summons is IN the tab order, immediately before the stop** — which is what makes it
   * reachable by keyboard at all, and what keeps the stop last.
   *
   * ⛔ **Asserted as the order rather than as two keystrokes.** `OverlayHost`'s trap only
   * intercepts Tab at the ENDS of its own list; in between, the browser's own focus move does the
   * work, and a synthesised `keydown` performs no default action — so a second `tab(true)` here
   * moves nothing and a test written that way would be measuring the harness. The host's own
   * selector is the tab order, so this reads it.
   */
  it('🔴 the last focus in the overlay is reachable through the queue', async () => {
    const m = await overlay(1180)
    const host = m.q('overlay-host')
    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const order = [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
    expect(order.at(-1)).toBe(m.q('persons-queue-go-sess_worker-7:req_1'))
    expect(host.contains(m.q('persons-queue'))).toBe(true)

    // ⛔ **The paired negative**: with nothing waiting, the stop is still last and the element
    // before it belongs to the panel — so the assertion above is about the summons being inserted
    // in the right place rather than about the stop being last, which was already true.
    supply([])
    await nextTick()
    const without = [...host.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    )
    expect(m.q('capabilities-sheet').contains(without.at(-1)!)).toBe(true)
  })

  /**
   * ⚠️ **Pressing it does not dismiss what a person was doing by accident.** `OverlayHost` closes
   * on a mousedown that STARTED on the backdrop, and this is the assertion that the summons is a
   * child of the backdrop and not the backdrop itself.
   */
  it('⛔ a mousedown on the summons is not a click-out', async () => {
    let closed = 0
    const m = await overlay(1180, 808, () => (closed += 1))
    m.q('persons-queue').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await nextTick()
    expect(closed).toBe(0)
  })
})

/* ------------------------------------------------------------- §3 · the chain, drawn from the rows */

describe('§3 · worker → pm → you', () => {
  it('🔴 one name per participant, in order, with the person last', async () => {
    const m = await overlay(1180)
    // ⚑ **613 · read off the MARKED elements rather than the list items**, because a hop now
    // carries a name AND the act — see `PersonsQueueHop.did`. ⛔ The mark did not move: it is on
    // the name, which is still exactly what the host said, and the act is its sibling.
    const hops = [
      ...m.q('persons-queue-chain-sess_worker-7:req_1').querySelectorAll<HTMLElement>(NAMED),
    ].map((el) => el.innerText.trim())
    expect(hops).toEqual(['worker-7', 'pm-alpha', 'you'])
    expect(m.all('persons-queue-you')).toHaveLength(1)
    expect(m.q('persons-queue-you').innerText.trim()).toBe('you')
  })

  /**
   * 🔴 **The law: what is DRAWN reconstructs what the host SAID.** The names on screen, re-joined
   * the way HO-007 words the line, are the sentence the host composed from the same walk — so the
   * two renderings of one chain cannot come apart. ⚑ And the sentence itself is the list's
   * accessible name, so a reader gets the prose and a looker gets the shape.
   */
  it('🔴 the drawn hops re-join into the host’s own evidence line', async () => {
    const pm = routed({ requestId: 'req_2', askedBy: 'sess_pm-alpha', parent: 'sess_lead' })
    supply([
      asked({ requestId: 'req_1', askedBy: 'sess_worker-7' }, (id) =>
        id === 'sess_pm-alpha' ? pm : null,
      ),
    ])
    const m = await overlay(1180)
    const list = m.q('persons-queue-chain-sess_worker-7:req_1')
    // ⚑ **613 · the NAMES, which is what the sentence is a join of** — the act beside each one is
    // this app's own claim about the hop and was never part of HO-007's line.
    const hops = [...list.querySelectorAll<HTMLElement>(NAMED)].map((el) => el.innerText.trim())
    const clauses = hops.slice(0, -1).map((hop, index) => `${hop} waiting on ${hops[index + 1]!}`)
    expect(clauses.join(', ')).toBe(list.getAttribute('aria-label'))
    expect(list.getAttribute('aria-label')).toBe(
      'worker-7 waiting on pm-alpha, pm-alpha waiting on lead, lead waiting on you',
    )
  })

  /**
   * ⛔ **The arrow is a pseudo-element**, so the only text in a hop is the name the host gave it.
   * ⚠️ Asserted rather than assumed: a separator rendered as a text node would be read back by the
   * law above and would make it pass on a chain nobody could read.
   */
  it('⛔ a hop’s text is the name, the act, and nothing else', async () => {
    const m = await overlay(1180)
    for (const hop of [...m.q('persons-queue-chain-sess_worker-7:req_1').children]) {
      expect((hop as HTMLElement).innerText.trim()).not.toContain('→')
    }
    // ⚑ **613 · and the marked element is still the name ALONE** — the chain's rule did not
    // relax when the act arrived; the act is a sibling, not more text inside the mark. See
    // `the-chain-a-question-carries.dom.test.ts` §1 for the whole of it.
    for (const named of m.all('persons-queue-hop')) {
      expect(named.innerText.trim()).not.toContain(' ')
    }
  })
})

/* ---------------------------------------------------------------- §4 · the three absences, on screen */

describe('§4 · three ways to be handed nothing, three different screens', () => {
  it('🔴 nobody has answered yet: nothing is drawn, and nothing is claimed', async () => {
    // ⛔ **BOTH refused** (⚑ all three from `446` until D-016 took proposals out) — one refused and
    // the other empty is a different screen, and it is the next test. ⚠️ The rule was never about a
    // count: it is that `null` means *nothing has been drawn yet*, and one list that HAS answered is
    // enough to draw.
    supply(null, { decisions: null })
    const m = await overlay(1180)
    expect(m.all('persons-queue')).toEqual([])
    // ⚑ **The paired positive**, so the assertion is about the null and not about the mount.
    supply(ONE)
    await nextTick()
    expect(m.all('persons-queue')).toHaveLength(1)
  })

  /**
   * 🔴 **The fourth absence, and it was invisible in the first version** (403, from the review):
   * one read refused while the other came back EMPTY.
   *
   * ⛔ **`rows.length` is 0 there, so the card drew nothing and Home said the workspace was
   * quiet** — over a population the app had failed to read, which is `086`'s false all-clear made
   * out of a failure rather than out of a fact. ⚑ A card carrying only the short-list line is the
   * honest screen, and Home is forbidden to claim quiet beside it.
   */
  it('🔴 one read refused and the other empty draws the disclosure, not silence', async () => {
    supply(null, { decisions: [] })
    const m = await overlay(1180)
    expect(m.all('persons-queue')).toHaveLength(1)
    expect(m.all('persons-queue-row-sess_worker-7:req_1')).toEqual([])
    expect(m.q('persons-queue-partial').innerText).toContain('could not be read')

    // 🔴 **The card says ONE thing, and the photograph is what found this.** It was drawing the
    // strong line *"Nothing is waiting on you"* and a `0` badge directly above the disclosure —
    // one card claiming to know and saying it does not, with a count of nothing between them.
    expect(m.q('persons-queue-heading').innerText.trim()).toBe('One list could not be read')
    expect(m.all('persons-queue-count')).toEqual([])
    expect(m.all('persons-queue-line')).toEqual([])
    // ⚑ **The paired positive**: with a row to draw, the heading and the count come back —
    // ⚑ **UI-009** and the line does not: it explained the machinery, and it is gone.
    supply(ONE, { decisions: [] })
    await nextTick()
    expect(m.q('persons-queue-heading').innerText.trim()).toBe('A question is waiting on you')
    expect(m.q('persons-queue-count').innerText.trim()).toBe('1')
    expect(m.all('persons-queue-line')).toEqual([])
    supply(null, { decisions: [] })
    await nextTick()

    // ⛔ **And the announcement stays SILENT**, because there is nothing to summon anybody for —
    // the disclosure is a caveat on a list, not a summons.
    expect(m.q('overlay-queue-announcement').textContent?.trim()).toBe('')

    unmountAll()
    await page.viewport(1440, 900)
    const home = mount(WaitingOnYou, {}, { width: 1440, height: 900 })
    await nextTick()
    expect(home.all('waiting-list-none')).toEqual([])
    expect(home.all('waiting-intro')).toEqual([])
    expect(home.q('waiting-list-short').innerText).toContain("Couldn't read all of this list")
    // The list could not be read whole and holds nothing known: its pill claims no number.
    expect(home.q('waiting-pill-count-questions').innerText.trim()).toBe('')

    // ⚑ **The paired positive**: with both reads landed and empty, the claim comes back.
    supply([], { decisions: [] })
    await nextTick()
    expect(home.q('waiting-list-none').innerText).toBe('No questions for you.')
    expect(home.q('waiting-intro').innerText).toBe('Nothing needs you.')
    expect(home.all('waiting-list-short')).toEqual([])
  })

  it('⛔ nothing is waiting: still nothing drawn — and Home is the surface that says so', async () => {
    supply([])
    const m = await overlay(1180)
    expect(m.all('persons-queue')).toEqual([])

    unmountAll()
    const home = mount(WaitingOnYou, {}, { width: 1180, height: 808 })
    await nextTick()
    expect(home.q('waiting-pill-count-questions').innerText.trim()).toBe('0')
    expect(home.q('waiting-intro').innerText).toBe('Nothing needs you.')
    expect(home.q('waiting-list-none').innerText).toBe('No questions for you.')
  })

  /**
   * ⛔ **The walk did not arrive**: the row says so, and no hop on it says `you`. ⚠️ The paired
   * negative is the ordinary row above, which does say it — so the assertion measures the state
   * rather than the absence of the word from the whole file.
   */
  it('⛔ a chain that could not be followed names nobody as the answerer', async () => {
    const a = routed({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' })
    const b = routed({ requestId: 'req_b', askedBy: 'sess_b', parent: 'sess_a' })
    supply([
      asked({ requestId: 'req_a', askedBy: 'sess_a', parent: 'sess_b' }, (id) =>
        id === 'sess_b' ? b : id === 'sess_a' ? a : null,
      ),
    ])
    const m = await overlay(1180)
    expect(visible(m.q('persons-queue-unfollowable-sess_a:req_a'))).toBe(true)
    expect(m.q('persons-queue-unfollowable-sess_a:req_a').innerText).toContain(
      'could not be followed',
    )
    expect(m.all('persons-queue-you')).toEqual([])

    supply(ONE)
    await nextTick()
    expect(m.all('persons-queue-unfollowable-sess_worker-7:req_1')).toEqual([])
    expect(m.all('persons-queue-you')).toHaveLength(1)
  })

  it('⛔ a missing stamp reads as "no time recorded", never as a moment', async () => {
    supply([asked({ requestId: 'req_1', askedBy: 'sess_worker-7', escalatedAt: null })])
    const m = await overlay(1180)
    // ⛔ **And it says where it SORTED** (434). The list is oldest-first, so a row at the bottom
    // with no words on it reads as the newest thing in it — which is the one claim an unrecorded
    // instant cannot make.
    expect(m.q('persons-queue-since-sess_worker-7:req_1').innerText.trim()).toBe(
      'no time recorded — listed last, not first',
    )

    supply(ONE)
    await nextTick()
    expect(m.q('persons-queue-since-sess_worker-7:req_1').innerText.trim()).toBe(
      'yours since 2m ago',
    )
  })
})

/* ------------------------------------------------------------------- §5 · the route, and what it is not */

describe('§5 · it takes you to the card, and it never answers', () => {
  it('🔴 pressing it travels, and names the row it travelled for', async () => {
    const m = await overlay(1180)
    m.q('persons-queue-go-sess_worker-7:req_1').click()
    await nextTick()
    expect(travelled.map((row) => row.key)).toEqual(['sess_worker-7:req_1'])
  })

  /**
   * ⛔ **From inside a modal it LEAVES first.** The host is the only party that knows how to close
   * itself, and a surface swap behind an open dialog is a result a person cannot see.
   */
  it('🔴 inside an overlay it asks the host to close, and the host closes', async () => {
    let closed = 0
    const m = await overlay(1180, 808, () => (closed += 1))
    m.q('persons-queue-go-sess_worker-7:req_1').click()
    await nextTick()
    expect(closed).toBe(1)
    expect(travelled).toHaveLength(1)
  })

  /** ⚠️ …and the in-flow copy travels without asking anybody to close anything. */
  it('⛔ on Home it travels and asks nothing to close', async () => {
    const m = mount(PersonsQueue, {}, { width: 640, height: 400 })
    await nextTick()
    m.q('persons-queue-go-sess_worker-7:req_1').click()
    await nextTick()
    expect(travelled).toHaveLength(1)
  })

  /**
   * ⛔ **The whole surface offers exactly one control per row, and it is the route.** Knowledge
   * escalates; authority does not — so there is no Allow, no Deny, no Answer and no text box
   * anywhere on it. ⚑ A census over the real DOM rather than over the template's source, so a
   * control added by a child component is caught too.
   */
  /**
   * 🔴 **`401`'s negative, and `434` is the dispatch that LIFTED it** (HO-024 criterion 17:
   * *"clearing it there clears it everywhere"*).
   *
   * ⛔ **What it asserted — *there is nothing here that could answer anything* — is no longer the
   * rule, and pretending otherwise would have been the safer-looking way to leave a criterion
   * unmet.** ⚑ What survives of it is the half that is still true and is now the DISCRIMINANT: a
   * row this window cannot answer offers nothing to press but the way there. The queue never
   * gained an answer path of its own; it gained the card's.
   */
  it('⛔ a row this window cannot answer still offers nothing but the way there', async () => {
    const m = await overlay(1180)
    const root = m.q('persons-queue')
    const controls = [
      ...root.querySelectorAll('button, input, select, textarea, [contenteditable]'),
    ]
    // ⚑ Two: the way there, and `336`'s door — and the second one CLAIMS rather than answers.
    expect(controls.map((one) => one.getAttribute('data-cy'))).toEqual([
      'persons-queue-toggle',
      'persons-queue-take-over-sess_worker-7:req_1',
      'persons-queue-go-sess_worker-7:req_1',
    ])
    for (const word of ['Allow', 'Deny', 'Approve', 'Reject']) {
      expect(root.innerText, `the queue offered ${word}`).not.toContain(word)
    }
    // ⛔ **And it says why**, rather than leaving a person to work out that the buttons are missing.
    expect(m.q('persons-queue-no-answer-sess_worker-7:req_1').innerText).toContain(
      'cannot be answered from here yet',
    )
  })

  // ⚑ **D-017b · one press everywhere** — the conversation opens in its full view whoever holds it,
  // so the row names ONE gesture, held or not. ⛔ It forked *Open* / *Take it over and open it*.
  it('🔴 the gesture is named before it is made: one press, held here or not', async () => {
    const m = await overlay(1180)
    const go = (): string => m.q('persons-queue-go-sess_worker-7:req_1').innerText.trim()
    expect(go()).toContain('Open the conversation')
    expect(go()).not.toContain('Take it over')
    supply(ONE, { held: new Set(['sess_worker-7']) })
    await nextTick()
    expect(go()).toContain('Open the conversation')
    expect(go()).not.toContain('Take it over')
  })

  it('⛔ a card open in this window says so, and the row is still listed', async () => {
    // ⚑ **D-017 · R19 — *Waiting on you* no longer lists that card beside this row**
    // (`listedNowhereElse`), so the row says where the card IS rather than that it is listed twice.
    supply(ONE, { answerable: answerable('sess_worker-7:req_1') })
    const m = await overlay(1180)
    expect(m.all('persons-queue-row-sess_worker-7:req_1')).toHaveLength(1)
    await openMore(m, 'sess_worker-7:req_1')
    expect(m.q('persons-queue-also-sess_worker-7:req_1').innerText).toContain(
      'Its card is open in this window too',
    )

    supply(ONE)
    await nextTick()
    expect(m.all('persons-queue-also-sess_worker-7:req_1')).toEqual([])
  })
})

/* ------------------------------------------------------------------------ §6 · Home, and its arithmetic */

describe('§6 · Home cannot say the workspace is quiet over one of these', () => {
  it('🔴 the group, its label and its count are drawn from the same list', async () => {
    await page.viewport(1440, 900)
    const m = mount(WaitingOnYou, {}, { width: 1440, height: 900 })
    await nextTick()
    // ⚠️ **Lower-cased, because `.group-label` is `text-transform: uppercase`** and `innerText`
    // reports the TRANSFORMED text — a comparison against the authored casing would be red for a
    // reason that has nothing to do with the words.
    // ⛔ **`403` renamed it, and the rename is the point rather than churn.** The group now holds
    // requests that were NEVER escalated — a permission a spawned child parked on was a person's
    // from the instant it was routed — so the old label described half of its own contents.
    expect(m.q('waiting-pill-questions').getAttribute('aria-selected')).toBe('true')
    expect(m.q('waiting-pill-questions').innerText).not.toContain('a-question')
    expect(m.q('waiting-pill-count-questions').innerText.trim()).toBe('1')
    expect(m.all('persons-queue-row-sess_worker-7:req_1')).toHaveLength(1)
  })

  /**
   * 🔴 **`alone` is a claim about the SCREEN** (305 §1). With an escalated row listed below it,
   * the live queue's *"Nothing needs you."* headline is false — and this is the exact
   * contradiction `304` filed, arriving through a third population.
   */
  it('🔴 the live queue stops claiming the screen is empty', async () => {
    await page.viewport(1440, 900)
    const m = mount(WaitingOnYou, {}, { width: 1440, height: 900 })
    await nextTick()
    // ⚑ **UI-009 (F052) · and the empty live list is not drawn above it at all** — no *Conversations
    // 0*, and no sentence about a list with nothing in it.
    expect(m.all('waiting-list-none')).toEqual([])
    // ⛔ **The intro names no population and no location since `403`**: the number folds
    // escalated questions AND requests that never travelled.
    expect(m.q('waiting-intro').innerText).toBe('1 thing needs you.')
    expect(m.q('waiting-intro').innerText).not.toContain('a-question')

    // ⛔ **The paired negative**: take the escalation away and the claim comes back.
    supply([])
    await nextTick()
    expect(m.q('waiting-list-none').innerText).toBe('No questions for you.')
  })

  /**
   * 🔴 **The sentence the live queue KEEPS is narrowed as well.** *"No conversation is frozen on a
   * permission or a question"* is a claim about every conversation there is, and this screen now
   * prints a list of questions escalated from conversations this window is not running directly
   * underneath it. ⛔ Two adjacent sentences, one denying what the other states.
   */
  it('🔴 the kept sentence says only what the list it labels can see', async () => {
    // ⚑ **UI-009** — with a row listed below, the live list is not drawn (above); the narrowed
    // sentence is what it says when a list below could not be read.
    supply(null, { decisions: [] })
    await page.viewport(1440, 900)
    const m = mount(WaitingOnYou, {}, { width: 1440, height: 900 })
    await nextTick()
    // A list that was not read whole says so, and claims nothing about what is in it.
    expect(m.q('waiting-list-short').innerText).toContain("Couldn't read all of this list")
    expect(m.all('waiting-list-none')).toEqual([])

    // ⛔ **The paired positive**: with the list read whole and empty, the claim comes back, and
    // the read line goes.
    supply([])
    await nextTick()
    expect(m.q('waiting-list-none').innerText).toBe('No questions for you.')
    expect(m.all('waiting-list-short')).toEqual([])
  })

  it('⛔ the count is the number of rows, unrounded, at twelve', async () => {
    supply(
      Array.from({ length: 12 }, (_unused, index) =>
        asked({ requestId: `req_${String(index)}`, askedBy: `sess_w${String(index)}` }),
      ),
    )
    await page.viewport(1440, 900)
    const m = mount(WaitingOnYou, {}, { width: 1440, height: 900 })
    await nextTick()
    expect(m.q('waiting-pill-count-questions').innerText.trim()).toBe('12')
    expect(m.all('persons-queue-row-sess_w11:req_11')).toHaveLength(1)
    // ⛔ **And the group's own header is NOT drawn here.** The label above it already names the
    // list and carries the number; a second heading and a second count in the same six inches is
    // three renderings of one fact.
    expect(m.all('persons-queue-count')).toEqual([])
    expect(m.all('persons-queue-heading')).toEqual([])
  })
})

/* ------------------------------------------------------------------- §7 · it is legible where it is drawn */

describe('§7 · paper, not the near-black it would inherit', () => {
  /**
   * 🔴 **The card is PAPER, measured as a luminance and not as an equality.** `OverlayHost` carries
   * `data-chat-theme="light"`, so a token that lost its light value repaints the whole overlay
   * layer near-black — and an assertion that only compared this card to its neighbour would move
   * with it and stay green. ⚑ The paired negative is the same element with the scope flipped.
   */
  it('🔴 the card paints paper in the light scope and near-black outside it', async () => {
    const m = await overlay(1180)
    const card = m.q('persons-queue')
    expect(luminance(paintedBackground(card))).toBeGreaterThan(0.8)

    m.q('overlay-host').setAttribute('data-chat-theme', 'dark')
    expect(luminance(paintedBackground(card))).toBeLessThan(0.2)
    m.q('overlay-host').setAttribute('data-chat-theme', 'light')
    expect(luminance(paintedBackground(card))).toBeGreaterThan(0.8)
  })

  /**
   * 🔴 **The amber word is the PILL token, not the ink one** — the choice this component's
   * docblock is about. In a light scope `--waiting` is `#784f10`, a near-black that reads as ink
   * rather than as a summons; `--waiting-text-label` is the one legible in both.
   *
   * ⛔ **A positive reading of the token, taken inside the scope that redeclares it**, so the
   * assertion differs from both defaults it could fall back to: swapping in `var(--waiting)`
   * fails the equality, and deleting the rule lands on the inherited `--text-soft`, which is
   * neither.
   */
  it('🔴 the person at the end of the chain is amber, through the pill token', async () => {
    const m = await overlay(1180)
    const card = m.q('persons-queue')
    const scope = getComputedStyle(card)
    const label = parseColor(scope.getPropertyValue('--waiting-text-label').trim())
    const ink = parseColor(scope.getPropertyValue('--waiting').trim())
    expect(label, 'the label token did not resolve in this scope').not.toBeNull()
    expect(ink).not.toEqual(label)

    const you = parseColor(getComputedStyle(m.q('persons-queue-you')).color)
    expect(you).toEqual(label)
    expect(you).not.toEqual(ink)
    // ⚠️ **Read inside the scope that redeclares it, never off the root** — the two differ, and
    // that difference is the whole reason the pill token exists.
    expect(scope.getPropertyValue('--waiting').trim()).not.toBe(
      getComputedStyle(document.documentElement).getPropertyValue('--waiting').trim(),
    )
    // ⛔ …and it is legible on the card it sits on.
    expect(contrast(you!, paintedBackground(card))).toBeGreaterThanOrEqual(4.5)
  })

  it('⛔ every row is inside the host, so it is inside the trap and inside the light scope', async () => {
    const m = await overlay(1180)
    const host = m.q('overlay-host')
    expect(host.getAttribute('data-chat-theme')).toBe('light')
    expect(host.contains(m.q('persons-queue-row-sess_worker-7:req_1'))).toBe(true)
  })
})

/* ---------------------------------------------------------- §8 · one channel, inside the layer */

describe('§8 · the announcement is hosted, not carried by a surface drawn twice', () => {
  /**
   * ⛔ **The queue component carries NO live region**, and that is the point: it is drawn in the
   * overlay layer and on Home, and a region inside it would announce everything twice.
   */
  it('⛔ neither copy of the queue declares aria-live, role=status or role=alert', async () => {
    const m = await overlay(1180)
    for (const root of [m.q('persons-queue'), ...m.all('persons-queue-row-sess_worker-7:req_1')]) {
      // ⛔ **The ROOT as well as its descendants.** `querySelectorAll` does not match the element
      // it is called on, so a `role="status"` planted on the `<section>` itself would pass a
      // descendant-only check while announcing the summons a third time.
      expect(root.getAttribute('role')).toBeNull()
      expect(root.getAttribute('aria-live')).toBeNull()
      expect(root.querySelectorAll('[aria-live]')).toHaveLength(0)
      expect(root.querySelectorAll('[role="status"]')).toHaveLength(0)
      expect(root.querySelectorAll('[role="alert"]')).toHaveLength(0)
    }
  })

  /**
   * 🔴 **The channel that can be HEARD from inside a modal**, which the shell's own cannot be:
   * `aria-modal="true"` tells assistive technology to ignore the rest of the document, and the
   * shell's region is outside this host.
   *
   * ⛔ **Present with an empty string before there is anything to say.** A live region inserted
   * into the tree already carrying its text is not reliably announced, so the assertion is that
   * the node exists while the queue is empty and CHANGES when it fills.
   */
  it('🔴 the host carries a polite region that is present, empty, and then speaks', async () => {
    supply([])
    const m = await overlay(1180)
    const region = m.q('overlay-queue-announcement')
    expect(m.q('overlay-host').contains(region)).toBe(true)
    expect(region.getAttribute('role')).toBe('status')
    expect(region.getAttribute('aria-live')).toBeNull()
    expect(region.textContent?.trim()).toBe('')

    supply(ONE)
    await nextTick()
    expect(region.textContent?.trim()).toBe('1 question waiting on you.')

    // ⛔ **Off-screen without being hidden** — `display: none` would take it out of the
    // accessibility tree and announce nothing at all.
    const painted = getComputedStyle(region)
    expect(painted.display).not.toBe('none')
    expect(painted.visibility).not.toBe('hidden')
    expect(region.getBoundingClientRect().width).toBeLessThanOrEqual(1)
  })
})

/* ----------------------------------------- §9 · the population 401 could not see, on screen (403) */

/**
 * 🔴 **403 · a decision only a person can make, drawn where a person would see it.**
 *
 * ⛔ **Two of these claims cannot be made anywhere but here.** That the new line is LEGIBLE in the
 * host's light scope is a paint question — `390` shipped an invisible card by getting exactly this
 * wrong, on this layer, with a token that reads fine in the app's own dark ground. And that a
 * bounded band with two lists in it still bounds the whole of both is a layout question a render
 * test cannot ask.
 */
describe('§9 · a decision, its words, and the two groups', () => {
  const PERMISSION = onlyAPersons({ requestId: 'req_p', askedBy: 'sess_worker-9' })

  it('🔴 the chain is worker → you, with no parent invented in the middle', async () => {
    supply([], { decisions: [PERMISSION] })
    const m = await overlay(1180)
    const hops = [
      ...m.q('persons-queue-chain-sess_worker-9:req_p').querySelectorAll<HTMLElement>(NAMED),
    ].map((el) => el.innerText.trim())
    // ⛔ **Two elements and not three.** `pm-alpha` is the worker's real parent and is on the row
    // it came from; a chain that drew it would name a conversation this app refuses, by rail, to
    // ask. ⚑ The paired positive is §3, where the same relationship gives a question three.
    expect(hops).toEqual(['worker-9', 'you'])
    expect(hops).not.toContain('pm-alpha')
    expect(m.q('persons-queue-chain-sess_worker-9:req_p').getAttribute('aria-label')).toBe(
      'worker-9 waiting on you',
    )
  })

  /**
   * 🔴 **`390`'s finding, on the line `403` adds.** `OverlayHost` carries
   * `data-chat-theme="light"`, so every token in the card resolves to its PAPER value — and the
   * stop lane's heading was invisible until it stopped painting an 8%-alpha tint over the dim
   * backdrop. ⛔ This line is amber, on this layer, and the only way to know it can be read is to
   * measure the ink against what is actually painted behind it.
   */
  it('🔴 the words are legible against what is painted behind them, in the light scope', async () => {
    supply([], { decisions: [PERMISSION] })
    const m = await overlay(1180)
    const says = m.q('persons-queue-says-sess_worker-9:req_p')
    // The category is under the row's more options, so it is read with them open.
    expect(visible(says)).toBe(false)
    await openMore(m, 'sess_worker-9:req_p')
    expect(visible(says)).toBe(true)
    expect(says.innerText.trim()).toBe('a command or file approval, which is a person’s to give')

    const ink = parseColor(getComputedStyle(says).color)
    expect(ink).not.toBeNull()
    const behind = paintedBackground(says)
    const ratio = contrast(ink!, behind)
    expect(ratio, `the refusal sentence reads at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    // ⚑ **The control that would have caught `390`**: the near-black app ground is what a
    // TRANSLUCENT card composites to, and the same ink on it fails this bar — so what is being
    // measured is the paint, not a token that happens to be dark. ⛔ And the surface really is
    // opaque paper: a light painted ground is the half `390` shipped without.
    expect(contrast(ink!, [17, 19, 24, 1])).toBeLessThan(4.5)
    expect(luminance(behind), `the card is painted ${show(behind)}`).toBeGreaterThan(0.5)
  })

  /**
   * ⛔ **Legible is not the same claim as AMBER, and the mutation table found the gap** (403).
   *
   * ⚠️ **`var(--waiting)` would pass the contrast bar above.** In the host's light scope it
   * resolves to `#784f10` — a near-black, which on this paper card reads perfectly well and reads
   * as INK. ⛔ So the test that would have caught the wrong token is not a legibility test: it is
   * that this line is in the same colour as the card's own summons marks and NOT in the colour of
   * the body text beside it. ⚑ That is `391`'s pill trio doing the job it exists for, and it is
   * the property `390`'s stop lane was actually about.
   */
  it('🔴 the refusal sentence is in the SUMMONS colour, not in the body ink', async () => {
    supply(ONE, { decisions: [PERMISSION] })
    const m = await overlay(1180)
    const ink = (el: Element): string => getComputedStyle(el).color
    const says = ink(m.q('persons-queue-says-sess_worker-9:req_p'))

    // ⛔ **The same colour the count badge and the mark carry** — one amber family on the card.
    expect(says).toBe(ink(m.q('persons-queue-count')))
    // ⛔ **And NOT the row's own body ink**, which is what a token swap would make it.
    const hop = m.q('persons-queue-chain-sess_worker-9:req_p').children[0]
    expect(hop).toBeDefined()
    expect(says).not.toBe(ink(hop as Element))
    expect(says).not.toBe(ink(m.q('persons-queue-since-sess_worker-9:req_p')))
  })

  /**
   * 🔴 **`403` labelled two GROUPS and `434` took the groups away** (criterion 17: *ordered, with
   * the oldest-blocked first*).
   *
   * ⛔ **A group is a second ordering.** With the rows grouped, a permission a child parked on nine
   * minutes ago sat below a question that became a person's four seconds ago — because of which
   * READER found it. ⚑ So there is one list, and the fact the label carried — which population a
   * row is — is on the row, which is where `PersonsQueueRow.kind` always said it was.
   */
  it('🔴 ONE list, in blocked-since order, with the population on each row', async () => {
    // ⚑ The permission was routed at `NOW`; the question became a person's at `NOW + 30_000`. So
    // the decision is OLDER and, under `403`, was drawn second.
    supply(ONE, { decisions: [PERMISSION] })
    const m = await overlay(1180)
    const lists = [...m.q('persons-queue').querySelectorAll('ol.pq-rows')]
    expect(lists, 'a second list is a second ordering').toHaveLength(1)
    expect(m.all('persons-queue-group-escalated')).toEqual([])
    expect(m.all('persons-queue-group-a-decision')).toEqual([])
    const order = [...m.q('persons-queue').querySelectorAll('.pq-row')].map(
      (el) => (el as HTMLElement).dataset['kind'],
    )
    expect(order).toEqual(['a-decision', 'a-question'])

    // ⛔ **Every row says which population it is**, drawn whether or not the other one is present —
    // with the list interleaved there is no group for a reader to infer it from. It is said under
    // each row's more options.
    await openMore(m, 'sess_worker-9:req_p')
    await openMore(m, 'sess_worker-7:req_1')
    expect(m.q('persons-queue-kind-sess_worker-9:req_p').innerText).toContain(
      'nobody else was ever asked',
    )
    expect(m.q('persons-queue-kind-sess_worker-7:req_1').innerText).toContain(
      'nobody above has answered',
    )
    for (const key of ['sess_worker-9:req_p', 'sess_worker-7:req_1']) {
      const label = m.q(`persons-queue-kind-${key}`).innerText
      expect(label).not.toContain('routed')
      expect(label).not.toContain('these')
      expect(label).not.toContain('them')
    }
    // ⛔ **The one list is NAMED with what its order means**, so a screen reader hears the ordering
    // rather than *"list, 2 items"*.
    expect(m.q('persons-queue-rows').getAttribute('aria-label')).toContain('longest-blocked first')

    // ⚑ **And with only one population the row label is still there** — `305 §1` was about a label
    // over a GROUP, and this one is a fact about a row.
    supply([], { decisions: [PERMISSION] })
    await nextTick()
    await openMore(m, 'sess_worker-9:req_p')
    expect(m.q('persons-queue-kind-sess_worker-9:req_p').innerText).toContain(
      'nobody else was ever asked',
    )
  })

  it('⛔ an escalated row draws no refusal sentence, and a decision draws no gap paragraph', async () => {
    supply(ONE, { decisions: [PERMISSION] })
    const m = await overlay(1180)
    expect(m.all('persons-queue-says-sess_worker-7:req_1')).toEqual([])
    expect(m.all('persons-queue-says-sess_worker-9:req_p')).toHaveLength(1)
    expect(m.all('persons-queue-unfollowable-sess_worker-9:req_p')).toEqual([])
  })

  /**
   * ⛔ **The two clocks, told apart in the copy** — see `PersonsQueueRow.since`. *Yours since* is
   * a claim that a person was TOLD at that moment; nothing ever told them about a routing.
   */
  it('⛔ a decision has been WAITING since, and an escalated question has been YOURS since', async () => {
    supply(ONE, { decisions: [PERMISSION] })
    const m = await overlay(1180)
    expect(m.q('persons-queue-since-sess_worker-9:req_p').innerText.trim()).toMatch(
      /^waiting since /,
    )
    expect(m.q('persons-queue-since-sess_worker-7:req_1').innerText.trim()).toMatch(/^yours since /)
  })

  it('🔴 the heading and the announcement name both populations, with one count over them', async () => {
    supply(ONE, { decisions: [PERMISSION] })
    const m = await overlay(1180)
    expect(m.q('persons-queue-heading').innerText.trim()).toBe(
      '1 question and 1 decision are waiting on you',
    )
    expect(m.q('persons-queue-count').innerText.trim()).toBe('2')
    expect(m.q('overlay-queue-announcement').textContent?.trim()).toBe(
      '1 question and 1 decision waiting on you.',
    )
  })

  /**
   * ⛔ **ONE scroller for both groups, and the band still bounds the whole card.** Two scrollers
   * in a bounded column can hide a whole group behind the other's overflow — and the group most
   * likely to be hidden is the one added last. ⚠️ The stop is what the bound exists for: a list
   * that grew without limit would push it off the screen, which is the one thing this card may
   * never do.
   */
  it('🔴 both groups stay on screen and share one scroller', async () => {
    const many = Array.from({ length: 12 }, (_unused, index) =>
      asked({ requestId: `req_e${String(index)}`, askedBy: `sess_e${String(index)}` }),
    )
    const decisions = Array.from({ length: 12 }, (_unused, index) =>
      onlyAPersons({ requestId: `req_d${String(index)}`, askedBy: `sess_d${String(index)}` }),
    )
    supply(many, { decisions })
    const m = await overlay(1180, 808)
    const card = m.q('persons-queue')
    const scrollers = [...card.querySelectorAll('*'), card].filter(
      (el) => getComputedStyle(el).overflowY === 'auto',
    )
    expect(scrollers).toHaveLength(1)
    expect((scrollers[0] as HTMLElement).className).toContain('pq-body')

    expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(808)
    expect(card.getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    // ⚑ **And both groups are really in there**, so the bound is holding 24 rows rather than
    // hiding half of them behind a `v-if` this test never noticed.
    expect(card.querySelectorAll('.pq-row')).toHaveLength(24)
  })

  it('⛔ Home counts both populations in one group, and the label no longer says "escalated"', async () => {
    supply(ONE, { decisions: [PERMISSION] })
    await page.viewport(1440, 900)
    const home = mount(WaitingOnYou, {}, { width: 1440, height: 900 })
    await nextTick()
    expect(home.q('waiting-pill-count-questions').innerText.trim()).toBe('1')
    expect(home.q('waiting-pill-count-approvals').innerText.trim()).toBe('1')
    home.q('waiting-pill-approvals').click()
    await nextTick()
    expect(home.all('persons-queue-row-sess_worker-9:req_p')).toHaveLength(1)
    // ⛔ **And Home draws no heading or line** — those belong to the corner copy, where nothing
    // else on screen explains what the box is.
    expect(home.all('persons-queue-heading')).toEqual([])
    expect(home.all('persons-queue-line')).toEqual([])
  })

  /**
   * ⛔ **It travels, and it still never answers.** The button says the gesture it is about to
   * perform and then hands the row back to the screen — which opens the conversation, navigates and
   * scrolls to the card. Nothing here decides anything.
   */
  it('🔴 the button on a decision row leaves the modal and asks to travel', async () => {
    let closed = 0
    supply([], { decisions: [PERMISSION] })
    const m = await overlay(1180, 808, () => (closed += 1))
    const go = m.q('persons-queue-go-sess_worker-9:req_p')
    // ⚑ **D-017b** — the one press, *Open the conversation*.
    expect(go.innerText).toContain('Open the conversation')
    go.click()
    await nextTick()
    expect(closed).toBe(1)
    expect(travelled.map((row) => row.requestId)).toEqual(['req_p'])
    expect(travelled[0]?.kind).toBe('a-decision')
  })
})

/* --------------------------------------------------- §10 · 434 · clearing it where the summons is */

/**
 * 🔴 **434 · criterion 17's second clause, measured in the 200px band it has to live in.**
 *
 * ⛔ **The corner is the hard case and it is the one that matters.** `390`'s whole reason for
 * putting this summons on the overlay layer is that a sheet covers the rail — so if the answers fit
 * on Home and not here, then the one state the surface exists for is the state a person still
 * cannot clear anything in. ⚑ Every measurement below is at `--app-min-w` (1180), in the corner
 * copy, with a real sheet underneath.
 */
describe('§10 · the answers are reachable in the corner, and they change nothing else', () => {
  const KEY = 'sess_worker-7:req_1'

  it('🔴 the card’s own answers are drawn, each with what it does, and each takes a click', async () => {
    // ⚑ **UI-009 · a DECISION row** — what an answer does, and the gap after it, are drawn on a
    // decision's row only: on a question the label is the answer.
    const decisionKey = 'sess_worker-9:req_p'
    supply([], {
      decisions: [onlyAPersons({ requestId: 'req_p', askedBy: 'sess_worker-9' })],
      held: new Set(['sess_worker-9']),
      answerable: answerable(decisionKey),
    })
    const m = await overlay(1180)
    const buttons = permissionButtons(m.q('persons-queue'))
    expect(buttons.map((one) => one.querySelector('strong')?.textContent?.trim())).toEqual([
      'Approve',
      'Deny',
    ])
    // ⛔ **`390`'s own question, asked of the new controls**: is the thing I am pointing at the
    // thing that gets the click. A button that renders and is covered is `390` with the subject
    // changed again.
    for (const button of buttons) expect(reachable(button)).toBe(true)
    expect(buttons[0]!.querySelector('small')?.textContent).toContain('the agent may do this once')
    expect(buttons[1]!.querySelector('small')?.textContent).toContain('refused this one thing')
    const detail = m.q('permission-after').closest('details')!
    expect(detail.open).toBe(false)
    detail.querySelector('summary')!.click()
    await nextTick()
    expect(visible(m.q('permission-after'))).toBe(true)
    expect(m.q('permission-after').innerText).toContain('does not predict')
  })

  it('🔴 pressing one settles THAT row with THAT decision — and does not travel or close', async () => {
    supply(ONE, { held: new Set(['sess_worker-7']), answerable: answerable(KEY) })
    const m = await overlay(1180)
    const buttons = permissionButtons(m.q('persons-queue'))
    buttons[1]!.click()
    await nextTick()
    expect(settled).toHaveLength(1)
    expect(settled[0]!.row.key).toBe(KEY)
    expect(settled[0]!.decision.label).toBe('Deny')
    // ⛔ **It is not the travelling gesture**, which is the one thing a queue that only navigated
    // could ever do.
    expect(travelled).toEqual([])
    // ⛔ **And the layer stays open**, because a person clearing three things must not have it
    // close under them after the first.
    expect(m.all('overlay-host').length).toBe(1)
    expect(m.all('persons-queue').length).toBe(1)
    // 🔴 **The row is STILL THERE** — nothing in this window removes it. The ledger does, at the
    // next look, which is the lag `§9.5` states rather than hides.
    expect(m.all(`persons-queue-row-${KEY}`)).toHaveLength(1)
  })

  it('🔴 the take-over door is pressed here and does not navigate', async () => {
    const m = await overlay(1180)
    m.q(`persons-queue-take-over-${KEY}`).click()
    await nextTick()
    expect(takenOver.map((row) => row.key)).toEqual([KEY])
    expect(travelled).toEqual([])
  })

  /**
   * ⛔ **The band is the constraint `401` reserved and `434` may not spend.** Two answers, their
   * consequence lines, the work line and two controls all arrive inside one 200px column — so the
   * assertion is the band's own arithmetic, unchanged, with the tallest row this surface can draw
   * inside it.
   */
  it('⛔ answers stay within the queue band', async () => {
    const m = await overlay(1180)
    const alone = m.q('persons-queue').getBoundingClientRect()
    supply(
      Array.from({ length: 6 }, (_unused, index) =>
        asked({ requestId: `req_${String(index)}`, askedBy: `sess_worker-${String(index)}` }),
      ),
      {
        held: new Set(Array.from({ length: 6 }, (_u, index) => `sess_worker-${String(index)}`)),
        answerable: new Map(
          Array.from({ length: 6 }, (_u, index) => {
            const key = `sess_worker-${String(index)}:req_${String(index)}`
            return [key, live(key)] as const
          }),
        ),
      },
    )
    await nextTick()
    const band = m.q('overlay-host').querySelector<HTMLElement>('.overlay-corner')!
    const box = band.getBoundingClientRect()
    expect(Math.round(box.left)).toBe(10)
    expect(Math.round(box.width)).toBe(200)
    const crowded = m.q('persons-queue').getBoundingClientRect()
    expect(Math.round(crowded.bottom)).toBe(Math.round(alone.bottom))
    expect(reachable(m.q('persons-queue'))).toBe(true)
    expect(m.q('persons-queue').getBoundingClientRect().top).toBeGreaterThanOrEqual(0)
    // ⛔ **The answers stayed INSIDE the 200px column**, rather than overflowing it sideways into
    // the sheet — which a row of side-by-side buttons would have done at this width.
    const drawn = permissionButtons(m.q('persons-queue'))
    // ⚑ **Non-vacuity: there really are answers to measure** — the loop below passes over nothing.
    expect(drawn).toHaveLength(12)
    for (const button of drawn) {
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(Math.round(box.right) + 1)
    }
  })

  it('🔴 a read that has stopped answering says so, on the card', async () => {
    supply(ONE, { lastLookAnswered: { questions: false, decisions: true } })
    const m = await overlay(1180)
    expect(m.q('persons-queue-stale').innerText).toContain('is not here')
    // ⚑ **And the rows it had are still drawn** — the disclosure is beside them, never instead.
    expect(m.all(`persons-queue-row-${KEY}`)).toHaveLength(1)
    supply(ONE)
    await nextTick()
    expect(m.all('persons-queue-stale')).toEqual([])
  })

  /**
   * 🔴 **453 · the card draws at all when there was no ledger behind the answer.**
   *
   * ⛔ **This is the `v-if` and not only the sentence.** The section was gated on
   * `rows.length > 0 || partial || stale`, and a `no-ledger` answer is none of those — so at zero
   * rows the card rendered NOTHING and Home fell back to *"Nothing needs you. The workspace is
   * quiet."* over a reader that had no database to look in. ⚑ Asserted in the browser because SSR
   * would pass on a `v-if` that never ran.
   */
  it('🔴 no ledger behind the answer draws the card, with the honest heading', async () => {
    supply([], { noLedger: true })
    const m = await overlay(1180)
    expect(m.all('persons-queue')).toHaveLength(1)
    expect(m.q('persons-queue-no-ledger').innerText).toContain('no record to read')
    expect(m.q('persons-queue-heading').innerText.trim()).toBe('No list could be read at all')
    // ⛔ **And no count**, for the same reason `403`'s disclosure-only card draws none: a `0` badge
    // spends a reader's attention to tell them there was nothing to spend it on.
    expect(m.all('persons-queue-count')).toEqual([])
    // ⚑ **The paired positive**: the same empty rows with a ledger behind them draw no card at
    // all, which is what makes this a measurement rather than a card that is always there.
    supply([])
    await nextTick()
    expect(m.all('persons-queue')).toEqual([])
  })

  /**
   * 🔴 **453 · a ledger row this app could not read is disclosed on the card** — `150`'s skip,
   * which has been silent above the store since it was written.
   */
  it('🔴 a dropped ledger row says so, beside the rows that did land', async () => {
    supply(ONE, { rowsUnread: 2 })
    const m = await overlay(1180)
    expect(m.q('persons-queue-rows-dropped').innerText).toContain('may be missing')
    // ⛔ **Beside the rows and never instead of them** — one unreadable row does not delete the
    // list, which is the whole reason it is counted rather than thrown.
    expect(m.all(`persons-queue-row-${KEY}`)).toHaveLength(1)
    supply(ONE)
    await nextTick()
    expect(m.all('persons-queue-rows-dropped')).toEqual([])
  })

  it('⚑ criterion 20’s *which work* is on the row, with its gap', async () => {
    // ⚑ **UI-009 · a DECISION row** — the work line is a decision's only; a question's row
    // explained the machinery with it.
    const decisionKey = 'sess_worker-9:req_p'
    const decision = onlyAPersons({ requestId: 'req_p', askedBy: 'sess_worker-9' })
    supply([], { decisions: [{ ...decision, work: [{ label: 'W1.12' }] }] })
    const m = await overlay(1180)
    await openMore(m, decisionKey)
    const work = m.q(`persons-queue-work-${decisionKey}`).innerText
    expect(work).toContain('W1.12')
    expect(work).toContain('not recorded')

    supply([], { decisions: [decision] })
    await nextTick()
    expect(m.q(`persons-queue-work-${decisionKey}`).innerText).toContain(
      'No piece of work is recorded',
    )
  })
})

/**
 * 🔴 **§12 · 468 · what a person READS in the five seconds after the press.**
 *
 * ⛔ **The gap has never been read as a sight.** `persons-queue.test.ts` §9.5 pins that the row
 * survives a settle and `§10` above pins that it survives a real click — both assert PRESENCE.
 * ⚠️ Neither reads the words, and the words were the defect: once the card in this window closed,
 * the row fell into the branch for *"this window holds that conversation and its card is not in the
 * part on screen — open it to answer"*, about a card the person had just answered from that row.
 *
 * ⚑ **Every case here is a PAIR**, because the two states differ by one fact and a test that read
 * either alone would pass against a surface that drew one sentence for both.
 */
describe('§12 · 468 · the sentence in the gap, and the refusal that used to be silent', () => {
  const KEY = 'sess_worker-7:req_1'
  const HELD = new Set(['sess_worker-7'])

  it('🔴 the press is answered on the row, in words, in the tick it is made', async () => {
    supply(ONE, { held: HELD, answerable: answerable(KEY, { sent: true }) })
    const m = await overlay(1180)
    // ⛔ **`207` M2's rule, read as a person reads it** — the buttons are gone and the reason is
    // where they were. This is the first assertion in this repository that reads it as text.
    expect(permissionButtons(m.q(`persons-queue-row-${KEY}`))).toHaveLength(0)
    const said = m.q(`persons-queue-no-answer-${KEY}`)
    expect(visible(said)).toBe(true)
    expect(said.innerText.trim()).toBe(
      'An answer is already on its way — waiting for the conversation to settle.',
    )
  })

  it('⛔ …and the control: an unpressed row draws buttons and no sentence at all', async () => {
    supply(ONE, { held: HELD, answerable: answerable(KEY) })
    const m = await overlay(1180)
    expect(permissionButtons(m.q(`persons-queue-row-${KEY}`))).toHaveLength(2)
    expect(m.all(`persons-queue-no-answer-${KEY}`)).toHaveLength(0)
  })

  it('🔴 once the card here has CLOSED, the row says so instead of sending them back to it', async () => {
    // ⚠️ **The live projection is empty and the conversation is still held** — which is exactly
    // the state a `user_decision` leaves behind, one round trip after the press and up to five
    // seconds before the next look.
    supply(ONE, { held: HELD, answerable: new Map(), answeredFromHere: new Set([KEY]) })
    const m = await overlay(1180)
    const said = m.q(`persons-queue-no-answer-${KEY}`)
    expect(said.innerText.trim()).toBe(
      'That was answered from this window — this list has not caught up yet.',
    )
    // 🔴 **The false instruction is GONE.** Before 468 this row read *"…open it to answer"*.
    expect(said.innerText).not.toContain('open it to answer')
    // ⛔ …and the row is still in the list, because the ledger has not been asked again. 468 moved
    // the words and not the authority.
    expect(m.all(`persons-queue-row-${KEY}`)).toHaveLength(1)
  })

  it('⛔ …and the control: a held card this window never answered keeps the paging sentence', async () => {
    supply(ONE, { held: HELD, answerable: new Map(), answeredFromHere: new Set<string>() })
    const m = await overlay(1180)
    expect(m.q(`persons-queue-no-answer-${KEY}`).innerText).toContain('open it to answer')
  })

  it('🔴 a refused answer brings the buttons back WITH the host’s own sentence', async () => {
    supply(ONE, {
      held: HELD,
      answerable: answerable(KEY, { sent: false, refused: 'that answer was not usable' }),
    })
    const m = await overlay(1180)
    // ⛔ **Answerable again** — `noteAnswer` puts the request back on the table, so a person can
    // press again; what they could not do before 468 is learn why they had to.
    expect(permissionButtons(m.q(`persons-queue-row-${KEY}`))).toHaveLength(2)
    const why = m.q('permission-refused')
    expect(visible(why)).toBe(true)
    expect(why.innerText.trim()).toBe('that answer was not usable')
  })

  it('⛔ …and the control: nothing bounced, nothing is drawn', async () => {
    supply(ONE, { held: HELD, answerable: answerable(KEY) })
    const m = await overlay(1180)
    expect(m.all('permission-refused')).toHaveLength(0)
  })

  /**
   * 🔴 **487 · the third surface says why it cannot be allowed** (`483`'s repair 1, §1.2).
   *
   * ⛔ **This is the surface a spawned child's card is reached from** (`403`), and HO-030 §2 rules
   * that a sentence true on one surface and absent on another *"trains the reader out of
   * looking"*. ⚠️ The row can still be REFUSED — that is 487's whole point — so the sentence is
   * not a {@link NoAnswerHere}, and the buttons stay beside it.
   */
  it('🔴 a withheld-positive row says so, and keeps both refusals (487)', async () => {
    supply(ONE, {
      held: HELD,
      answerable: answerable(KEY, { withhold: true }),
    })
    const m = await overlay(1180)
    const said = m.q('permission-cannot-allow')
    expect(visible(said)).toBe(true)
    expect(said.innerText.trim()).toBe(noPositiveSays('could-not-describe-the-grant'))
    // ⛔ **Beside the answers, not instead of them** — a sentence that replaced the buttons would
    // be `nothing-on-offer` again, about a row that has two.
    expect(permissionButtons(m.q(`persons-queue-row-${KEY}`))).toHaveLength(2)
    expect(m.all(`persons-queue-no-answer-${KEY}`)).toHaveLength(0)
  })

  it('⛔ …and the control: a row that can be allowed says nothing about it (487)', async () => {
    supply(ONE, { held: HELD, answerable: answerable(KEY) })
    const m = await overlay(1180)
    expect(m.all('permission-cannot-allow')).toHaveLength(0)
    expect(permissionButtons(m.q(`persons-queue-row-${KEY}`))).toHaveLength(2)
  })

  /**
   * ⚑ **The weight, and it is the card's.** `PermissionCard`'s own `.refused` paragraph is
   * `var(--muted)`; a queue that drew the same sentence louder would make the quieter surface look
   * like the less important one. ⛔ Read as a COLOUR rather than as a class name, because a class
   * proves only that somebody wrote one.
   */
  it('⚑ the refusal is quiet-secondary, not a second summons', async () => {
    // ⚠️ **A DECISION row, because an escalated one has no `says`** — `PersonsQuestion` carries
    // `says: null` and the amber paragraph is not drawn for it at all. ⛔ The first draft of this
    // case guarded the amber half on `if (says !== undefined)` over an escalated row, so the half
    // that matters never ran: a control that cannot be reached measures nothing.
    const decisionKey = 'sess_worker-9:req_p'
    supply([], {
      decisions: [onlyAPersons({ requestId: 'req_p', askedBy: 'sess_worker-9' })],
      held: new Set(['sess_worker-9']),
      answerable: answerable(decisionKey, { sent: false, refused: 'that answer was not usable' }),
    })
    const m = await overlay(1180)
    const why = m.q('permission-refused')
    const work = m.q(`persons-queue-work-${decisionKey}`)
    // The two are the same weight, and `pq-work` is the file's own quiet-secondary precedent.
    expect(getComputedStyle(why).color).toBe(getComputedStyle(work).color)
    // ⛔ …and NOT the amber a summons is spent under — `pq-says` holds that licence, and this row
    // really does draw one, which is what makes the inequality a measurement.
    const says = m.q(`persons-queue-says-${decisionKey}`)
    await openMore(m, decisionKey)
    expect(says.innerText.trim().length).toBeGreaterThan(0)
    expect(getComputedStyle(why).color).not.toBe(getComputedStyle(says).color)
  })
})
