import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { disclosureFixture, settingsPeer } from './plugin-disclosure-fixtures'
import { cleanupLifecycleFixtures } from './plugin-lifecycle-fixtures'
import type { PluginMutationReview, PluginReviewTransfer } from '../src/shared/plugin-settings'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of closers.splice(0).reverse()) await close()
  await cleanupLifecycleFixtures()
})
async function setup() {
  const f = await disclosureFixture({ installed: true })
  closers.push(f.close)
  const c = await f.connect()
  return { f, c, a: settingsPeer(c), b: settingsPeer(c) }
}

it('progress and cancellation belong to the exact requesting window and operation', async () => {
  const { c, a, b } = await setup()
  const shown = await c.reviewMutation!('update', 'chrome')
  let active!: PluginReviewTransfer,
    finish!: (value: PluginMutationReview) => void,
    started!: () => void
  const begun = new Promise<void>((resolve) => {
    started = resolve
  })
  vi.spyOn(c, 'reviewMutation').mockImplementationOnce(async (_action, _id, transfer) => {
    active = transfer!
    started()
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const requestId = randomUUID()
  const pending = a.call({ kind: 'prepare', action: 'update', id: 'chrome', requestId })
  await begun
  const progress = {
    requestId,
    id: 'chrome',
    phase: 'downloading' as const,
    receivedBytes: 2,
    totalBytes: 10,
  }
  active.onProgress(progress)
  expect(a.owner.webContents.send).toHaveBeenCalledWith('plugins:review-progress', progress)
  expect(b.owner.webContents.send).not.toHaveBeenCalledWith(
    'plugins:review-progress',
    expect.anything(),
  )
  await b.call({ kind: 'cancel-prepare', id: 'chrome', requestId })
  await a.call({ kind: 'cancel-prepare', id: 'chrome', requestId: randomUUID() })
  expect(active.signal.aborted).toBe(false)
  await a.call({ kind: 'cancel-prepare', id: 'chrome', requestId })
  expect(active.signal.aborted).toBe(true)
  const deliveries = a.owner.webContents.send.mock.calls.length
  active.onProgress({ ...progress, receivedBytes: 3 })
  expect(a.owner.webContents.send.mock.calls).toHaveLength(deliveries)
  finish(shown)
  expect(await pending).toMatchObject({ ok: false, mutationFailure: 'policy-refused' })
})

it('cancel during catalogue admission prevents the download from starting afterward', async () => {
  const { c, a } = await setup()
  const cards = await c.catalogue()
  let finish!: (value: typeof cards) => void, started!: () => void
  const begun = new Promise<void>((resolve) => {
    started = resolve
  })
  vi.spyOn(c, 'catalogue').mockImplementationOnce(async () => {
    started()
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  const review = vi.spyOn(c, 'reviewMutation')
  const requestId = randomUUID()
  const pending = a.call({ kind: 'prepare', action: 'update', id: 'chrome', requestId })
  await begun
  await a.call({ kind: 'cancel-prepare', id: 'chrome', requestId })
  finish(cards)
  expect(await pending).toMatchObject({ ok: false })
  expect(review).not.toHaveBeenCalled()
})

it('an old terminal answer cannot cancel its same-card replacement', async () => {
  const { c, a } = await setup()
  const shown = await c.reviewMutation!('update', 'chrome')
  const starts: Array<() => void> = [],
    finishes: Array<(value: PluginMutationReview) => void> = []
  const begun = [0, 1].map(() => new Promise<void>((resolve) => starts.push(resolve)))
  let turn = 0
  vi.spyOn(c, 'reviewMutation').mockImplementation(async () => {
    starts[turn++]!()
    return new Promise((resolve) => finishes.push(resolve))
  })
  const cancel = vi.spyOn(c, 'cancelPreparations')
  const first = a.call({ kind: 'prepare', action: 'update', id: 'chrome', requestId: randomUUID() })
  await begun[0]
  const second = a.call({
    kind: 'prepare',
    action: 'update',
    id: 'chrome',
    requestId: randomUUID(),
  })
  await begun[1]
  const cancellations = cancel.mock.calls.length
  finishes[0]!(shown)
  expect(await first).toMatchObject({ ok: false, mutationFailure: 'policy-refused' })
  expect(cancel.mock.calls).toHaveLength(cancellations)
  finishes[1]!(shown)
  expect(await second).toMatchObject({ ok: true })
})
