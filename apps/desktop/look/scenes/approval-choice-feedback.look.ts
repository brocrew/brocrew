import { expect } from 'vitest'
import { scene } from '../capture'
import { settle, windowStage } from '../fixtures/window'
import { wearTheme } from '../fixtures/themes'
import { createSessionStore } from '../../src/renderer/src/lib/session-store'
import { META } from '../../test/dom/harness'
import { assertDrawn } from '../../test/dom/drawn'
import type { ApprovalModeDisclosure, RuntimeBridge } from '../../src/shared/runtime-ipc'

scene('approval choice feedback', async (stage) => {
  wearTheme('brocrew')
  let answer: (value: ApprovalModeDisclosure) => void = () => {}
  const store = createSessionStore({
    onEvent: () => () => {},
    onLiveness: () => () => {},
    createSession: async () => ({ ...META, approvalMode: 'auto' }),
    setApprovalMode: () =>
      new Promise<ApprovalModeDisclosure>((resolve) => {
        answer = resolve
      }),
  } as unknown as RuntimeBridge)
  const id = (await store.create({ provider: 'claude' }))!
  const record = store.get(id)!
  const m = stage.mount(
    windowStage({
      titleBar: true,
      railCollapsed: true,
      pane: {
        record,
        onSetApprovalMode: (mode: 'ask' | 'auto') => void store.setApprovalMode(id, mode),
      },
    }),
    {},
  )
  const state = import.meta.env.LOOK_SWITCH_STATE ?? 'before'
  await settle()
  if (state !== 'before') {
    m.q('card-approval').click()
    await settle()
    answer({
      approvalMode: 'auto',
      pendingApprovalMode: 'ask',
      approvalNote: 'Auto',
      blanketGrants: [],
    })
    await settle()
    if (state === 'after') {
      record.meta = { ...record.meta!, approvalMode: 'ask', pendingApprovalMode: null }
      await settle()
    }
  }
  if (state === 'pending') {
    expect((m.q('card-approval') as HTMLInputElement).checked).toBe(false)
    assertDrawn(m.q('card-approval-pending'), 'pending choice', m.host)
  } else expect(m.all('card-approval-pending')).toHaveLength(0)
  assertDrawn(m.q('session-approval-indicator'), 'mode tag', m.host)
  store.dispose()
})
