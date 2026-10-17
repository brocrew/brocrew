import { nextTick } from 'vue'
import { vi } from 'vitest'
import { scene } from '../capture'
import { agentInputsStage } from '../fixtures/agent-inputs'

/** The agent's own instructions, open and in view on the System prompt tab. */
scene('agent-inputs-instructions', async (stage) => {
  const m = stage.mount(agentInputsStage(), {})
  const tab = await vi.waitFor(() => m.q('input-tab-1'))
  tab.click()
  await nextTick()
  const file = m.host.querySelector<HTMLDetailsElement>(
    '[data-cy="input-part"][data-key="file:/Users/someone/provider-homes/designer/brobot-instructions.md"]',
  )!
  file.querySelector('summary')!.click()
  // The native toggle event renders the body after the summary opens.
  const own = await vi.waitFor(() => {
    const section = [...file.querySelectorAll<HTMLElement>('[data-cy="input-section"]')].find(
      (one) => one.querySelector('strong')?.textContent === 'Your own instructions',
    )
    if (!section) throw new Error('The profile file has not shown its own instructions.')
    return section
  })
  own.scrollIntoView({ block: 'start' })
})
