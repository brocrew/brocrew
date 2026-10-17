import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import WorkingTogether from '../../src/renderer/src/components/WorkingTogether.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import type { CastReading } from '../../src/renderer/src/lib/working-together'
import { mount, unmountAll } from './harness'
import { assertDrawn, drawnReady } from './drawn'
import { idlePanel, OWNER } from './sub-agents-idle-fixture'

const cast = useWhoCalledWhom()
afterEach(() => {
  unmountAll()
  cast.loadingFor.value = null
  cast.reading.value = null
  cast.railSays.value = null
  cast.forest.value = null
})

it('shows loading for the selected conversation, then its empty or loaded answer', async () => {
  const data = idlePanel(1)
  const state = reactive<{ conversation: string; reading: CastReading | null }>({
    conversation: OWNER,
    reading: null,
  })
  cast.loadingFor.value = OWNER
  const view = mount(
    defineComponent({
      setup: () => () =>
        h(WorkingTogether, {
          reading: state.reading,
          conversation: state.conversation,
          identities: data.identities,
          canOpen: false,
        }),
    }),
    {},
    { width: 480, height: 650 },
  )
  await drawnReady()
  expect(view.q('cast-loading').getAttribute('role')).toBe('status')
  assertDrawn(
    view.q('cast-loading'),
    'the first relationship reading is visibly in flight',
    view.host,
  )
  expect(view.all('cast-not-read')).toHaveLength(0)
  expect(view.all('cast-sub-agents')).toHaveLength(0)
  state.reading = data.reading
  cast.loadingFor.value = null
  await nextTick()
  expect(view.all('cast-loading')).toHaveLength(0)
  expect(view.q('cast-sub-agents').querySelector('.count')?.textContent).toBe('(1)')
  // A refresh keeps the last good cards instead of replacing them with a loading placeholder.
  cast.loadingFor.value = OWNER
  await nextTick()
  expect(view.all('cast-loading')).toHaveLength(0)
  expect(view.all('cast-sub-agents')).toHaveLength(1)
  state.conversation = 'fictional-next'
  cast.loadingFor.value = 'fictional-next'
  await nextTick()
  expect(view.all('cast-loading')).toHaveLength(1)
  expect(view.all('cast-sub-agents')).toHaveLength(0)
  expect(view.all('cast-not-read')).toHaveLength(0)
  state.reading = { ...idlePanel(0).reading, conversation: 'fictional-next' }
  cast.loadingFor.value = null
  await nextTick()
  expect(view.all('cast-loading')).toHaveLength(0)
  expect(view.all('cast-not-read')).toHaveLength(0)
  expect(view.all('cast-children-empty')).toHaveLength(1)
})

it('does not borrow another conversation’s in-flight state or claim a refused read is empty', async () => {
  cast.loadingFor.value = 'fictional-other'
  const view = mount(WorkingTogether, {
    reading: null,
    conversation: OWNER,
    identities: null,
    canOpen: false,
  })
  await nextTick()
  expect(view.all('cast-loading')).toHaveLength(0)
  expect(view.all('cast-not-read')).toHaveLength(1)
  cast.loadingFor.value = null
  await nextTick()
  expect(view.all('cast-not-read')).toHaveLength(1)
  expect(view.all('cast-children-empty')).toHaveLength(0)
})
