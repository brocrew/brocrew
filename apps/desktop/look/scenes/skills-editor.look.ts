import { scene } from '../capture'
import { settingsWindow } from '../fixtures/settings-window'
import { settle } from '../fixtures/window'

scene('skills-editor', async (stage) => {
  const m = stage.mount(settingsWindow(), {})
  await settle()
  m.q('skills-add').click()
  await settle()
  for (const [field, value] of [
    ['skill-name', 'crumb-check'],
    ['skill-description', 'Check a fictional loaf before sharing the recipe.'],
    ['skill-reminder', 'Check the crumb.'],
    [
      'skill-text',
      '# Check the crumb\n\nReview the flour and water quantities. Ask before changing a quantity.',
    ],
  ]) {
    const input = m.q(field!) as HTMLInputElement
    input.value = value!
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  await settle()
})
