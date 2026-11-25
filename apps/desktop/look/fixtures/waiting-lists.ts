import { nextTick } from 'vue'
import WaitingOnYou from '../../src/renderer/src/components/WaitingOnYou.vue'
import { usePersonsQueue } from '../../src/renderer/src/lib/persons-queue'
import type { LedgerWalk } from '../../src/shared/question-contracts'
import { aWaitingPageWithEveryCard, NOW } from '../../test/dom/a-waiting-page-with-every-card'
import { boxOf, crop, type LookStage } from '../capture'

/**
 * *Waiting on you* as its five lists draw: one list open, its first read still on its way, nothing
 * in it, or a read that did not answer. Made-up agents, folders and commands.
 */

type List = 'questions' | 'todo' | 'approvals' | 'work' | 'reply'

const nothing = <Row>(): LedgerWalk<Row> => ({
  rows: [],
  walk: 'every-conversation-that-routed',
  ledgers: 1,
  rowsUnread: 0,
})

const DOORS = {
  travel: () => {},
  settle: () => {},
  takeOver: () => {},
  open: () => {},
}

function widthOf(stage: LookStage): number {
  const rail = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rail-w'))
  return Math.round(stage.width - rail)
}

async function settled(): Promise<void> {
  for (let i = 0; i < 3; i++) await nextTick()
}

/** Every kind of card, with one list open. */
export async function waitingList(stage: LookStage, list: List): Promise<void> {
  const m = await aWaitingPageWithEveryCard(widthOf(stage), stage.height, true)
  await settled()
  m.q(`waiting-pill-${list}`).click()
  await settled()
}

/** The first read has not answered: grey cards where the list will be. */
export async function waitingLoading(stage: LookStage): Promise<void> {
  stage.mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: widthOf(stage) })
  await settled()
}

/** Every read answered, and nothing waits. */
export async function waitingEmpty(stage: LookStage): Promise<void> {
  usePersonsQueue().supply(
    nothing(),
    nothing(),
    {
      held: new Set<string>(),
      answerable: new Map(),
      answeredFromHere: new Set<string>(),
      now: NOW,
      lastLookAnswered: { questions: true, decisions: true },
    },
    DOORS,
  )
  stage.mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: widthOf(stage) })
  await settled()
}

/** The read for decisions never answered and the one for questions stopped answering. */
export async function waitingFailed(stage: LookStage): Promise<void> {
  usePersonsQueue().supply(
    nothing(),
    null,
    {
      held: new Set<string>(),
      answerable: new Map(),
      answeredFromHere: new Set<string>(),
      now: NOW,
      lastLookAnswered: { questions: false, decisions: false },
    },
    DOORS,
  )
  stage.mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: widthOf(stage) })
  await settled()
}

/**
 * One page through its first read: grey cards while nothing has answered, saved as
 * `waiting-before-read.png`; then the reads land on that same page, and the picture is the list
 * they bring. The fixture mounts a second page to supply the reads; it is taken away again.
 */
export async function waitingLoadingThenRead(stage: LookStage): Promise<void> {
  const page = stage.mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: widthOf(stage) })
  await settled()
  await crop('waiting-before-read', boxOf(page.q('waiting-on-you')))
  const supplier = await aWaitingPageWithEveryCard(widthOf(stage), stage.height, true)
  supplier.host.remove()
  await settled()
}

/**
 * One page whose first reads both fail: no grey cards and no "nothing here", only the line that
 * says the list couldn't be read, saved as `waiting-failed-whole.png`. Then the next reads answer
 * on that same page, and the picture is the list they bring.
 */
export async function waitingFailedThenRead(stage: LookStage): Promise<void> {
  usePersonsQueue().supply(
    null,
    null,
    {
      held: new Set<string>(),
      answerable: new Map(),
      answeredFromHere: new Set<string>(),
      now: NOW,
      lastLookAnswered: { questions: false, decisions: false },
    },
    DOORS,
  )
  const page = stage.mount(WaitingOnYou, { needsYou: [], clock: NOW }, { width: widthOf(stage) })
  await settled()
  await crop('waiting-failed-whole', boxOf(page.q('waiting-on-you')))
  const supplier = await aWaitingPageWithEveryCard(widthOf(stage), stage.height, true)
  supplier.host.remove()
  await settled()
}
