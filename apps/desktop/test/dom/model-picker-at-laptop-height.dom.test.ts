import { afterEach, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h } from 'vue'
import type { Provider } from '@brobot2/shared'
import { providerConnectionFixtures } from '../../look/fixtures/providers'
import ModelPicker from '../../src/renderer/src/components/ModelPicker.vue'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { mount, unmountAll } from './harness'
import { providerLaunchFixture, settleProviderLaunch as settle } from './provider-launch.fixture'

providerLaunchFixture()
const original = { width: innerWidth, height: innerHeight }
afterEach(async () => {
  unmountAll()
  await page.viewport(original.width, original.height)
})

function visible(node: HTMLElement) {
  const b = node.getBoundingClientRect()
  expect(b.width).toBeGreaterThan(0)
  expect(b.height).toBeGreaterThan(0)
  expect(b.top).toBeGreaterThanOrEqual(0)
  expect(b.bottom).toBeLessThanOrEqual(innerHeight)
  expect(node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2))).toBe(true)
}

for (const width of [760, 1180]) {
  for (const running of [false, true]) {
    for (const count of [8, 24]) {
      it(`keeps effort and Take visible at ${width}×720, ${running ? 'running' : 'new'}, ${count} models`, async () => {
        await page.viewport(width, 720)
        const take = vi.fn(async () => null)
        const lists = createModelLists(() => ({
          providerLaunchChoices: async ({ provider }) => ({
            ready: true,
            connections: providerConnectionFixtures().filter((row) => row.provider === provider),
            defaultConnectionId: `${provider}:sign-in`,
            defaultModel: { model: 'fictional-0', effort: 'medium' },
            defaultModelToSend: null,
            list: {
              provider,
              notAsked: null,
              standIn: null,
              lastPicked: null,
              startsOn: null,
              models: Array.from({ length: count }, (_, i) => ({
                id: `fictional-${i}`,
                label: `Fictional model ${i + 1}`,
                description: 'A fictional model for writing, planning and tool use.',
                addedBy: 'the-provider' as const,
                efforts: ['low', 'medium', 'high', 'extra'].map((id) => ({ id, label: id })),
                defaultEffort: 'medium',
              })),
            },
          }),
          resolveProviderLaunch: async () => ({
            provider: 'codex' as const,
            pickerProvider: 'codex' as const,
            connectionId: 'codex:sign-in',
            readiness: [{ provider: 'codex' as const, ready: true }],
          }),
          addHandAddedModel: window.api.runtime.addHandAddedModel,
          deleteHandAddedModel: window.api.runtime.deleteHandAddedModel,
        }))
        const Frame = defineComponent({
          setup: () => () =>
            h('div', { style: 'position:fixed;left:80px;bottom:80px' }, [
              h(ModelPicker, {
                providers: (running ? ['codex'] : ['claude', 'codex']) as Provider[],
                chooseConnection: true,
                shown: {
                  provider: 'codex',
                  connectionId: 'codex:sign-in',
                  model: 'fictional-0',
                  effort: 'medium',
                },
                lists,
                takeWords: 'Take',
                take,
              }),
            ]),
        })
        const m = mount(Frame, {}, { width, height: 720 })
        m.q('model-picker-face').click()
        await settle()
        expect(m.all('model-picker-row')).toHaveLength(count)
        for (const control of [
          ...m.all('model-picker-effort'),
          m.q('model-picker-cancel'),
          m.q('model-picker-take'),
        ])
          visible(control)
        const last = m.all('model-picker-row').at(-1)!
        last.scrollIntoView({ block: 'nearest' })
        await settle()
        visible(last)
        last.querySelector('input')!.click()
        const high = m.all('model-picker-effort').find((row) => row.dataset.effort === 'high')!
        visible(high)
        high.querySelector('input')!.click()
        m.q('model-picker-take').click()
        await settle()
        expect(take).toHaveBeenCalledExactlyOnceWith({
          provider: 'codex',
          connectionId: 'codex:sign-in',
          model: `fictional-${count - 1}`,
          effort: 'high',
        })
      })
    }
  }
}
