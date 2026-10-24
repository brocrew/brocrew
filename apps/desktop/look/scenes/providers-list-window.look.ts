import { scene } from '../capture'
import { settingsWindow } from '../fixtures/settings-window'
import { settle } from '../fixtures/window'
import { CAPABILITY_FIXTURE } from '../../test/provider-capability-fixture'

// Real Settings and provider controls, with the established fictional bridge only.
scene('providers-list-window', async (stage) => {
  const theme = import.meta.env['LOOK_PROVIDER_THEME'] === 'crew-night' ? 'crew-night' : 'classic'
  const preview = settingsWindow('providers', theme, undefined, CAPABILITY_FIXTURE)
  if (import.meta.env['LOOK_PROVIDER_SETUP'] === 'true') {
    const check = window.api.runtime.checkProviderAuth
    window.api.runtime.checkProviderAuth = async (asked) =>
      asked.provider === 'codex'
        ? { state: 'absent', reason: 'No fictional sign-in is saved.', why: 'no-login' }
        : check(asked)
  }
  const m = stage.mount(preview, {})
  await settle()
  const open = import.meta.env['LOOK_PROVIDER_OPEN']
  if (typeof open === 'string' && open !== '') {
    m.host
      .querySelector<HTMLButtonElement>(`[data-cy="provider-row"][data-provider="${open}"]`)
      ?.click()
    await settle()
  }
  const caption = document.createElement('div')
  caption.textContent = 'Preview · fictional agents, account and usage figures'
  caption.style.cssText =
    'position:fixed;bottom:8px;left:50%;transform:translateX(-50%);padding:6px 12px;border-radius:20px;background:#202938;color:white;font:12px sans-serif;z-index:9999;white-space:nowrap'
  document.body.append(caption)
})
