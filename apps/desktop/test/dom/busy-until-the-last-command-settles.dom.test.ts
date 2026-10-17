import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import type { ResumedSession, RuntimeBridge } from '../../src/shared/runtime-ipc'
import { META, mount, paneProps, unmountAll, visible } from './harness'

/**
 * # 🔴 737 · `730` F-7 — a conversation is busy until the LAST of its commands settles, or its bound (`A_COMMAND_IS_WAITED_ON_MS`) passes
 *
 * ⚠️ **`739` (`737` F-6) bounds each command**: one with no answer stops counting towards `busy` at
 * `A_COMMAND_IS_WAITED_ON_MS` (15 s), and the pane says so. Every Stop below settles inside its
 * bound, so what is measured here is unchanged; past the bound is
 * `test/dom/a-command-that-has-no-answer.dom.test.ts`.
 *
 * ⛔ **`record.busy` was a boolean**, raised and lowered by every command the store sends for a
 * conversation. Two can be out at once — a second Stop pressed while the first still waits, which
 * the host joins to the standing ask and answers under its own bound (`RuntimeHost.interrupt`,
 * R83) — and the first to settle lowered it under the other. ⚑ What a person saw: **Leave
 * planning** lit again while a Stop was still out.
 *
 * ⚑ **The REAL store and the REAL pane** — the store adopts a planning conversation the host hands
 * back (`attachOpen`), and the pane is mounted on that same reactive record, so what is measured is
 * the button a person would press. Only the bridge is a double, and its Stops wait until the test
 * answers them.
 */

afterEach(unmountAll)

/** ⚑ A store holding one planning Codex conversation, whose Stops wait on the test. */
async function aPlanningConversationWhoseStopsWait() {
  const answers: (() => void)[] = []
  const handed: ResumedSession = {
    ...META,
    provider: 'codex',
    planNeedsGoAhead: true,
    history: { entries: [], from: 0, hasOlder: false, turnAligned: true },
    handover: 'attached',
  }
  const bridge = {
    onEvent: () => () => undefined,
    onLiveness: () => () => undefined,
    attachOpen: async () => [handed],
    interrupt: () => new Promise<void>((resolve) => void answers.push(resolve)),
  } as unknown as RuntimeBridge
  const store = createSessionStore(bridge)
  expect(await store.attachOpen(), 'the premise: the store holds the conversation').toEqual([
    'sess_1',
  ])
  const record = store.get('sess_1')
  if (record === null) throw new Error('the store adopted nothing')
  const m = mount(ConversationPane, paneProps({ record }))
  const leave = (): HTMLButtonElement => m.q('plan-leave-button') as HTMLButtonElement
  expect(visible(leave()), 'the premise: Leave planning is on screen').toBe(true)
  return { store, answers, leave }
}

describe('🔴 737 · `730` F-7 — Leave planning stays dark while a Stop is still out, inside its bound (`A_COMMAND_IS_WAITED_ON_MS`)', () => {
  it('⚑ the control: one Stop darkens it while it is out, and it is lit again when that Stop settles', async () => {
    const { store, answers, leave } = await aPlanningConversationWhoseStopsWait()
    expect(leave().disabled, 'nothing is out').toBe(false)

    const stop = store.interrupt('sess_1')
    await nextTick()
    expect(leave().disabled, 'the Stop is out').toBe(true)
    answers[0]?.()
    await stop
    await nextTick()
    expect(leave().disabled, 'nothing is out any more').toBe(false)
    store.dispose()
  })

  it('🔴 two Stops out, the FIRST settles — still dark, because the second is still out', async () => {
    const { store, answers, leave } = await aPlanningConversationWhoseStopsWait()
    const first = store.interrupt('sess_1')
    void store.interrupt('sess_1')
    await nextTick()
    expect(answers, 'both presses reached the host').toHaveLength(2)

    answers[0]?.()
    await first
    await nextTick()
    // ⚑ The photograph is taken here: the second Stop is still out.
    expect(leave().disabled, 'lit while a Stop for this conversation was still out').toBe(true)
    store.dispose()
  })

  it('⚑ …and lit once the second one settles too', async () => {
    const { store, answers, leave } = await aPlanningConversationWhoseStopsWait()
    const first = store.interrupt('sess_1')
    const second = store.interrupt('sess_1')
    answers[0]?.()
    await first
    answers[1]?.()
    await second
    await nextTick()
    expect(leave().disabled).toBe(false)
    store.dispose()
  })
})
