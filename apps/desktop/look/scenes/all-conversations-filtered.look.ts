import { scene } from '../capture'
import { mountLibrary } from '../fixtures/all-conversations'

/** 🎨 The same list with its provider filter set, so an active filter chip is drawn. */
scene('all-conversations-filtered', async (stage) => {
  const m = await mountLibrary(stage)
  const select = m.host.querySelector<HTMLSelectElement>('[data-cy="library-facet-provider"]')!
  select.value = 'codex'
  select.dispatchEvent(new Event('change'))
  await new Promise((done) => setTimeout(done, 80))
})
