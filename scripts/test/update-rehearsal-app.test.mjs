import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  closeExpectedLaunchSetup,
  saveRehearsalCodexKey,
  aScriptedModel,
} from '../lib/update-rehearsal-app.mjs'

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

function keyWindow(result) {
  return {
    evaluate: (body) =>
      new AsyncFunction('window', body)({
        api: {
          runtime: {
            setApiKey: async ({ provider }) => {
              assert.equal(provider, 'codex')
              if (result instanceof Error) throw result
              return result
            },
          },
        },
      }),
  }
}

test('the shared fictional key setup records only a successful usable status', async () => {
  const recorded = []
  const facts = await saveRehearsalCodexKey(
    keyWindow({ provider: 'codex', set: true, inUse: true, unexpected: 'discard-this-field' }),
    { record: (one) => recorded.push(one) },
  )
  assert.deepEqual(recorded, [facts])
  assert.equal(facts.set, true)
  assert.equal(facts.inUse, true)
  assert.equal(facts.refused, false)
  assert.equal(JSON.stringify(facts).includes('discard-this-field'), false)
})

test('a resolved key refusal or unreadable save cannot proceed to a fixture turn', async () => {
  for (const status of [
    { provider: 'codex', set: false, inUse: false, refused: 'discard-refusal-detail' },
    { provider: 'codex', set: true, inUse: false },
    { provider: 'codex', set: true, inUse: true, readState: 'unreadable' },
    { provider: 'claude', set: true, inUse: true },
    new Error('discard-thrown-detail'),
  ]) {
    const recorded = []
    await assert.rejects(
      saveRehearsalCodexKey(keyWindow(status), { record: (one) => recorded.push(one) }),
      /not saved and usable/,
    )
    assert.equal(recorded.length, 1)
    assert.equal(JSON.stringify(recorded).includes('discard-'), false)
  }
})

test('the shared model records response ids and completion without headers or request bodies', async () => {
  const model = await aScriptedModel(null, () => 'test')
  try {
    const expected = model.nextResponseId()
    const response = await fetch(`http://127.0.0.1:${model.port}/v1/responses?discard-query`, {
      method: 'POST',
      headers: { 'x-test-private': 'discard-header' },
      body: 'discard-body',
    })
    assert.equal(response.status, 200)
    assert.match(await response.text(), new RegExp(expected))
    assert.deepEqual(model.requests, [
      {
        received: true,
        post: true,
        responsesRoute: true,
        modelsRoute: false,
        responseId: expected,
        held: false,
        completed: true,
      },
    ])
    assert.equal(JSON.stringify(model.requests).includes('discard-'), false)
    assert.notEqual(model.nextResponseId(), expected)
  } finally {
    model.closeAllConnections()
    await new Promise((done) => model.close(done))
  }
})

test('the shared model still holds and releases the Windows refusal turn', async () => {
  const model = await aScriptedModel('fictional-hold', () => 'test')
  try {
    const response = await fetch(`http://127.0.0.1:${model.port}/v1/responses`, {
      method: 'POST',
      body: 'fictional-hold',
    })
    assert.equal(model.isHolding(), true)
    assert.equal(model.requests[0].completed, false)
    model.release()
    assert.match(await response.text(), /response.completed/)
    assert.equal(model.requests[0].completed, true)
  } finally {
    model.closeAllConnections()
    await new Promise((done) => model.close(done))
  }
})
