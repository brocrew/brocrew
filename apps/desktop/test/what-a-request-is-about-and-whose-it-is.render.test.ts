import type {
  AboutWork,
  LedgerWalk,
  PersonsQuestion,
  RoutedRequest,
  WorkInHand,
} from '../src/shared/question-contracts'
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
  aPersonsSince,
} from '../src/shared/questions'

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

/** The piece each question card's head names, in the order drawn. */
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

describe('which work a queue row says it is about', () => {
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

  it('a named piece is on the card; an unfollowable one names none; the provider’s row is drawn without a work line', async () => {
    const html = await render([
      {
        requestId: 'req_named',
        askedBy: 'sess_worker-a',
        about: { is: 'the-asker-named-it', work: { label: 'W1.3' } },
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
      {
        requestId: 'req_named_idle',
        askedBy: 'sess_worker-d',
        about: { is: 'the-asker-named-it', work: { label: 'W1.9' } },
        work: [],
      },
      {
        requestId: 'req_ghost_idle',
        askedBy: 'sess_worker-e',
        about: { is: 'named-work-nothing-answers-to' },
        work: [],
      },
      {
        requestId: 'number:2',
        askedBy: 'sess_worker-f',
        about: { is: 'nothing-recorded-it' },
        work: [],
      },
    ])
    expect(workLines(html)).toEqual([])
    expect(html).toContain('data-cy="persons-queue-row-sess_worker-c:number:1"')
    expect(html).toContain('data-cy="persons-queue-row-sess_worker-f:number:2"')
    expect(cardPieces(html)).toEqual(['W1.3', 'W1.9'])
  })
})
