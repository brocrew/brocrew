import { afterEach, describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PersonsQueue from '../src/renderer/src/components/PersonsQueue.vue'
import { usePersonsQueue } from '../src/renderer/src/lib/persons-queue'
import type { PersonsQueueDoors } from '../src/renderer/src/lib/persons-queue'
import {
  chainReading,
  chainSentence,
  escalationChain,
  type AboutWork,
  type LedgerWalk,
  type PersonsQuestion,
  type RoutedRequest,
  type WorkInHand,
  aPersonsSince,
} from '../src/shared/questions'

/**
 * 🔴 **474 · an absent edge and a dropped edge, both DRAWN** — `463` F4's §3.4.
 *
 * ## ⛔ Why this file exists beside the node one
 *
 * ⚠️ **The node suite proves the host hands the right arm over.** It cannot prove a person is told
 * anything: `PersonsQueue.vue` chooses the sentence, and until `474` it chose ONE sentence for every
 * row — *"That conversation is working on #5 in nightly — which of it this is about is not
 * recorded"* — over a row whose ledger said exactly which.
 *
 * ⚑ **Three arms, three sentences, and the assertion is that they DIFFER** rather than that any one
 * of them reads a particular way. ⛔ A component that drew the old sentence three times would pass
 * every `toContain` written about the third arm and fail here, which is the shape
 * `a-comparison-tested-where-both-sides-agree` warns about.
 *
 * ⚠️ **SSR renders text, which is what this file asserts, and nothing about layout** — `SSR tests
 * pass vacuously` applies to geometry and not to a sentence. ⛔ Every negative here is paired with
 * the positive that makes it mean something.
 *
 * ## 🔴 UI-009 (F052) · a question this app asked says its piece on its card, and no more
 *
 * ⚑ The two arms only `question_asked` can produce — a piece named, and a piece named that nothing
 * answers to — are rows this app raised, and those rows are now `QuestionCard`: the piece is in its
 * head (*"BroBot asked you · W1.4"*), and *"This is about W1.4 — that conversation is working on …"*
 * is one of the sentences F052 took out. ⚑ The provider's row, whose edge nothing recorded, draws
 * no line either: on a question's row it only explained the machinery, and it is a decision's now.
 */

const NOW = 1_760_000_000_000

const NAME = (id: string): string => id.replace('sess_', '')

const DOORS: PersonsQueueDoors = {
  travel: () => {},
  settle: () => {},
  takeOver: () => {},
  open: () => {},
}

const WORLD = {
  held: new Set<string>(),
  answerable: new Map(),
  answeredFromHere: new Set<string>(),
  now: NOW,
  lastLookAnswered: { questions: true, decisions: true },
}

const routed = (requestId: string, askedBy: string): RoutedRequest => ({
  requestId,
  askedBy,
  parent: 'sess_pm',
  went: { is: 'the-parent', to: 'the-parent' },
  at: NOW - 600_000,
  state: 'open',
  endedAt: null,
  escalatedAt: NOW - 500_000,
})

const asked = (
  requestId: string,
  askedBy: string,
  about: AboutWork,
  work: readonly WorkInHand[],
): PersonsQuestion => {
  const request = routed(requestId, askedBy)
  const chain = escalationChain(request, () => null)
  return {
    request,
    // ⚑ **611 · when it became a person's** — every row here is escalated.
    aPersonsSince: aPersonsSince(request),
    chain,
    reading: chainReading(chain, NAME),
    sentence: chainSentence(chain, NAME),
    work,
    about,
    // ⚑ **602 · the fixture keeps its own world constructable.** Only `ask_parent` records which
    // work a question is about, so a row that named some is this app's row. ⛔ **The APP derives
    // neither from the other** — see `HowItWasRaised` for why that coupling is refused; this line
    // is a fixture choosing a state that can exist, not a claim about the fold.
    raisedBy: about.is === 'nothing-recorded-it' ? 'the-provider' : 'this-app',
    // ⚑ **619 · this fixture is about WHICH WORK and never about what may be pressed** — a row
    // that offered something would draw buttons and move the sentences this suite reads.
    offered: null,
    asked: null,
  }
}

const walk = <T>(rows: readonly T[]): LedgerWalk<T> => ({
  rows,
  walk: 'every-conversation-that-routed',
  ledgers: rows.length,
  rowsUnread: 0,
})

/** ⚑ **UI-009** — the piece each question card's head names, in the order drawn. */
function cardPieces(html: string): string[] {
  return [...html.matchAll(/data-cy="question-piece"[^>]*>([^<]*)</g)].map((one) => one[1] ?? '')
}

/** ⛔ The `data-about` arm and the sentence beside it, for every work line on screen. */
function workLines(html: string): { arm: string; said: string }[] {
  const found: { arm: string; said: string }[] = []
  const pattern = /<p class="pq-work"[^>]*data-about="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g
  for (const match of html.matchAll(pattern)) {
    found.push({
      arm: match[1] ?? '',
      said: (match[2] ?? '').replace(/<!--[\s\S]*?-->/g, '').trim(),
    })
  }
  return found
}

describe('474 · the three things a queue row can say about which work', () => {
  afterEach(() => {
    usePersonsQueue().forget()
  })

  const render = async (rows: readonly PersonsQueueRowInput[]): Promise<string> => {
    const queue = usePersonsQueue()
    queue.supply(
      walk(rows.map((one) => asked(one.requestId, one.askedBy, one.about, one.work))),
      walk([]),
      WORLD,
      DOORS,
    )
    return renderToString(createSSRApp({ render: () => h(PersonsQueue as never, {}) }))
  }

  interface PersonsQueueRowInput {
    requestId: string
    askedBy: string
    about: AboutWork
    work: readonly WorkInHand[]
  }

  const HOLDING: readonly WorkInHand[] = [{ label: 'W1.3' }, { label: 'W1.4' }]

  /**
   * 🔴 **The three arms on one screen, which is the only way to see that they differ.** ⛔ All three
   * conversations hold the SAME two open pieces, so nothing but the edge can account for what each
   * says. ⚑ **UI-009** — the named edge is the card's piece; the unfollowable one names none; the
   * unrecorded one is drawn with no work line at all.
   */
  it('🔴 an edge named, an edge unfollowable and no edge at all read as three different things', async () => {
    const html = await render([
      {
        requestId: 'req_named',
        askedBy: 'sess_worker-a',
        about: { is: 'the-asker-named-it', work: { label: 'W1.4' } },
        work: HOLDING,
      },
      {
        requestId: 'req_ghost',
        askedBy: 'sess_worker-b',
        about: { is: 'named-work-nothing-answers-to' },
        work: HOLDING,
      },
      {
        requestId: 'number:1',
        askedBy: 'sess_worker-c',
        about: { is: 'nothing-recorded-it' },
        work: HOLDING,
      },
    ])
    // ⚑ **UI-009 · no question row draws a work line** — the provider's row is drawn, and says
    // nothing about which work.
    expect(workLines(html)).toEqual([])
    expect(html).toContain('data-cy="persons-queue-row-sess_worker-c:number:1"')
    expect(html).not.toContain('which of it this is about is not recorded')
    // ⛔ **The edge is NAMED, by the label a person quotes** — on the card's head (UI-009), and the
    // unfollowable edge names no piece rather than a wrong one.
    expect(cardPieces(html)).toEqual(['W1.4'])
    expect(html).not.toContain('This is about W')
    expect(html).not.toContain('named the piece of work this is about')
  })

  /**
   * ⛔ **A conversation holding NOTHING still has its piece said**, because an omitted piece would
   * read as *this is about nothing in particular* — HO-024 §5.3. ⚑ **UI-009** — on the card's head;
   * no question row draws a work line.
   */
  it('⛔ the card names its piece even when the asking conversation holds no open work', async () => {
    const html = await render([
      {
        requestId: 'req_named',
        askedBy: 'sess_worker-a',
        about: { is: 'the-asker-named-it', work: { label: 'W1.9' } },
        work: [],
      },
      {
        requestId: 'req_ghost',
        askedBy: 'sess_worker-b',
        about: { is: 'named-work-nothing-answers-to' },
        work: [],
      },
      {
        requestId: 'number:1',
        askedBy: 'sess_worker-c',
        about: { is: 'nothing-recorded-it' },
        work: [],
      },
    ])
    // ⚑ **UI-009** — the card says its piece whatever the conversation holds.
    expect(cardPieces(html)).toEqual(['W1.9'])
    expect(workLines(html)).toEqual([])
    expect(html).toContain('data-cy="persons-queue-row-sess_worker-c:number:1"')
    expect(html).not.toContain('No piece of work is recorded for the conversation that asked.')
  })
})
