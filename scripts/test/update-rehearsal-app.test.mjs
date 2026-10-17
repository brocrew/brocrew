import assert from 'node:assert/strict'
import { test } from 'vitest'
import { closeExpectedLaunchSetup } from '../lib/update-rehearsal-app.mjs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function aWindow({
  label = 'Set up Claude',
  provider = 'claude',
  closeButton = true,
  remember = true,
} = {}) {
  let open = true
  let closeCount = 0
  let dismissed = null
  const setup = { getAttribute: () => provider }
  const dialog = {
    getClientRects: () => (open ? [{}] : []),
    getAttribute: () => label,
    querySelector: () => setup,
  }
  const document = {
    querySelectorAll: () => (open ? [dialog] : []),
    querySelector: () =>
      open && closeButton
        ? {
            click: () => {
              closeCount += 1
              open = false
              if (remember) dismissed = 'true'
            },
          }
        : null,
  }
  const localStorage = { getItem: () => dismissed }
  return {
    cdp: {
      evaluate: (body) =>
        new AsyncFunction('document', 'localStorage', body)(document, localStorage),
    },
    state: () => ({ open, closeCount, dismissed }),
  }
}

test('the first-start Claude setup is observed, closed, and remembered before other clicks', async () => {
  const page = aWindow()
  assert.deepEqual(await closeExpectedLaunchSetup(page.cdp, { wait: 0 }), {
    expected: 'Set up Claude',
    provider: 'claude',
    closed: true,
    remembered: true,
  })
  assert.deepEqual(page.state(), { open: false, closeCount: 1, dismissed: 'true' })
})

test('a different provider dialog is not silently dismissed as the expected setup', async () => {
  const page = aWindow({ label: 'Set up Codex', provider: 'codex' })
  await assert.rejects(closeExpectedLaunchSetup(page.cdp, { wait: 0 }), /expected Set up Claude/)
  assert.equal(page.state().closeCount, 0)
  assert.equal(page.state().open, true)
})

test('a setup with no Close button does not let the rehearsal continue', async () => {
  const page = aWindow({ closeButton: false })
  await assert.rejects(closeExpectedLaunchSetup(page.cdp, { wait: 0 }), /no Close setup button/)
  assert.equal(page.state().open, true)
})

test('a setup dismissal must be remembered for the next launch', async () => {
  const page = aWindow({ remember: false })
  await assert.rejects(closeExpectedLaunchSetup(page.cdp, { wait: 0 }), /remember the choice/)
  assert.equal(page.state().closeCount, 1)
})
