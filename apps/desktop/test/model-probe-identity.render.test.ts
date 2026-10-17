import { describe, expect, it } from 'vitest'
import { createModelLists } from '../src/renderer/src/lib/model-lists'
import type { ModelList } from '../src/shared/runtime-ipc'

/**
 * # 🟠 293 §5 · a pre-auth model probe overwrites the freshly re-probed menu (289 rank 5)
 *
 * The host invalidates its memoized promise when a credential gesture settles, and `RuntimeScreen`
 * clears the profile's state and starts another ask — ⛔ **but `askModels` wrote every eventual
 * answer with no request identity.**
 *
 * > *Probe P1 for profile `work` begins under account A. A sign-in or a re-copy changes the
 * > credential, invalidates P1's cache entry, and starts P2. P2 resolves account B's models first.
 * > P1 resolves last and overwrites `models[work]` with account A's catalogue.*
 *
 * The launcher then offers models the current account cannot use, or hides models it can, and
 * selecting the stale offering fails only when somebody tries to start a conversation.
 *
 * ⚑ **UI-012 · re-aimed at `createModelLists`**, where the ticket and `forget` moved with
 * `RuntimeScreen`'s probes: the window's one holder of the model picker's lists keeps the same
 * rule. ⚠️ **`.render.test.ts` for the file's history** — it imported the screen's SFC; it now
 * imports the lib the rule lives in. Nothing is rendered here.
 *
 * ⚠️ **Every read below is a DEFERRED promise resolved by hand.** The finding is an ordering, and
 * an ordering that depends on which mock happened to settle first is not a test of it.
 */

const listFor = (id: string): ModelList => ({
  provider: 'claude',
  notAsked: null,
  standIn: null,
  models: [{ id, label: id, addedBy: 'the-provider' }],
  lastPicked: null,
  startsOn: null,
})
const ACCOUNT_A = listFor('a-only')
const ACCOUNT_B = listFor('b-only')

function deferred(): {
  promise: Promise<ModelList>
  resolve: (list: ModelList) => void
  reject: (error: Error) => void
} {
  let resolve!: (list: ModelList) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ModelList>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** The holder over a bridge whose `modelList` answers with `read`, and whose writes are inert. */
function holderOver(read: () => Promise<ModelList>): ReturnType<typeof createModelLists> {
  return createModelLists(() => ({
    modelList: read,
    addHandAddedModel: () => Promise.resolve([]),
    deleteHandAddedModel: () => Promise.resolve([]),
  }))
}

/** What the screen holds for Claude's list in `work` — the answer, or `undefined`. */
function shownIn(lists: ReturnType<typeof createModelLists>): ModelList | undefined {
  const held = lists.held('claude', 'work')
  return held?.state === 'answered' ? held.list : undefined
}

describe('293 §5 · an answer applies only while it still owns the profile', () => {
  it('🔴 a probe from before the credential changed cannot replace the one from after it', async () => {
    const first = deferred()
    const second = deferred()
    const answers = [first, second]
    let handedOut = 0
    const lists = holderOver(() => answers[handedOut++]!.promise)

    // P1, under account A.
    const p1 = lists.read('claude', 'work', { once: true })
    // The credential gesture: the host forgets its memo, the screen forgets its answer, and asks
    // again. ⛔ P1 is still in flight the whole time.
    lists.forget('work')
    const p2 = lists.read('claude', 'work', { once: true })

    // ⚑ **P2 first, which is the interleaving the finding needs** — a re-probe that answers quickly
    // while the pre-auth one is still waiting on a provider child that was slow to start.
    second.resolve(ACCOUNT_B)
    await p2
    expect(shownIn(lists), 'the new account’s menu never arrived').toEqual(ACCOUNT_B)

    // …and now the ghost answers.
    first.resolve(ACCOUNT_A)
    await p1

    // 🔴 The finding: before 293 this was `ACCOUNT_A` — the launcher offering the account the person
    // had just signed out of, for the rest of the app run.
    expect(shownIn(lists), 'a pre-auth probe replaced the re-probed menu').toEqual(ACCOUNT_B)
    expect(handedOut, 'the second probe was never started — nothing was raced').toBe(2)
  })

  it('⚑ …and an answer that still owns the profile is applied, which is the pairing', async () => {
    // Without this, a holder that applied NOTHING would satisfy the test above and leave every
    // picker in the app with no list at all.
    const only = deferred()
    const lists = holderOver(() => only.promise)

    const asking = lists.read('claude', 'work', { once: true })
    only.resolve(ACCOUNT_A)
    await asking

    expect(shownIn(lists)).toEqual(ACCOUNT_A)
  })

  it('⚠️ asks once per profile, because asking spawns a provider child', async () => {
    // 058's rule, carried through the refactor rather than assumed: a re-render must not be a probe.
    let asked = 0
    const lists = holderOver(() => {
      asked += 1
      return Promise.resolve(ACCOUNT_A)
    })

    await lists.read('claude', 'work', { once: true })
    await lists.read('claude', 'work', { once: true })
    await lists.read('claude', 'work')

    expect(asked, 'a repeated ask started a second provider child').toBe(1)
    expect(shownIn(lists)).toEqual(ACCOUNT_A)
  })

  it('⛔ a credential change with NO replacement probe still disowns the one in flight', async () => {
    // ⚠️ The half a bump-on-ask-only fix would miss. The screen re-asks about profiles a surface is
    // SHOWING; a credential change on any other profile leaves P1 free to land its pre-auth answer
    // minutes later, into a profile the app has deliberately forgotten.
    const stale = deferred()
    const lists = holderOver(() => stale.promise)

    const p1 = lists.read('claude', 'work', { once: true })
    lists.forget('work') // nothing started in its place
    stale.resolve(ACCOUNT_A)
    await p1

    expect(
      lists.held('claude', 'work'),
      'a forgotten profile was given an answer anyway',
    ).toBeNull()
  })

  it('⚠️ a probe that THREW is not retried, and does not block the next credential gesture', async () => {
    // Both halves of 058's refusal, unchanged: a failed probe is asked once by the screen, and
    // `forget` is what makes it askable again — which is the only reason a failed menu is not
    // permanent.
    let asked = 0
    let answer: () => Promise<ModelList> = () => {
      asked += 1
      return Promise.reject(new Error('the provider would not start'))
    }
    const lists = holderOver(() => answer())

    await lists.read('claude', 'work', { once: true })
    answer = () => Promise.resolve(ACCOUNT_A)
    await lists.read('claude', 'work', { once: true })
    expect(asked, 'a failed probe was retried on the next ask').toBe(1)
    expect(shownIn(lists)).toBeUndefined()

    lists.forget('work')
    answer = () => Promise.resolve(ACCOUNT_B)
    await lists.read('claude', 'work', { once: true })
    expect(shownIn(lists), 'a credential gesture could not revive a failed menu').toEqual(ACCOUNT_B)
  })
})
