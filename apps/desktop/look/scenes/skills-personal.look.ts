import { scene } from '../capture'
import { settingsWindow } from '../fixtures/settings-window'
import { settle } from '../fixtures/window'

scene('skills-personal', async (stage) => {
  const m = stage.mount(settingsWindow(), {})
  await settle()
  const row = m.all('skill-row').find((one) => one.textContent?.includes('recipe-check'))
  if (!row) throw new Error('fictional skill missing')
  row.click()
  await settle()
})
