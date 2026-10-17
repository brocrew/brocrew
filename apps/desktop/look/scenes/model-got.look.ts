import { defineComponent, h, nextTick, provide } from 'vue'
import ModelGotSwitch from '../../src/renderer/src/components/ModelGotSwitch.vue'
import { READ_WHAT_THE_MODEL_GOT } from '../../src/renderer/src/lib/agent-inputs'
import { modelGotAnswer } from '../../test/dom/what-this-agent-was-given.fixture'
import { scene } from '../capture'

/**
 * 🎨 **"Show what the model got", opened under one message** (F093 C9 d): BroBot's parts in order and
 * the provider's own record. Fake data: `test/dom/what-this-agent-was-given.fixture.ts`.
 */
scene('model-got', async (stage) => {
  const Host = defineComponent({
    setup() {
      provide(READ_WHAT_THE_MODEL_GOT, async () => modelGotAnswer())
      return () =>
        h(
          'div',
          {
            style: 'padding: 24px; min-height: 100vh; background: var(--panel)',
            'data-chat-theme': 'light',
          },
          [
            h(ModelGotSwitch, {
              words: 'Make the header warmer, and keep the logo where it is.',
              ordinal: 42,
            }),
          ],
        )
    },
  })
  const m = stage.mount(Host, {})
  m.q('model-got-switch').click()
  await nextTick()
  await new Promise((done) => setTimeout(done, 50))
})
