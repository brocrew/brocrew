// The parts of the update rehearsal that drive a running BroBot and stand in for the world around
// it, in `scripts/windows-update-test.mjs`: the window, reached over the DevTools protocol and
// pressed as a person presses it; a scripted model; and a local feed. Node built-ins only.
import { createReadStream, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { basename, join } from 'node:path'
import { feedToken, LOCAL_FEED_PORT, LOCAL_FEED_URL } from './update-rehearsal.mjs'

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Wait until `test` answers something truthy, or `ms` pass; answers it, or null. */
export async function until(test, ms, every = 1_000) {
  const end = Date.now() + ms
  for (;;) {
    const answer = await test()
    if (answer) return answer
    if (Date.now() >= end) return null
    await sleep(every)
  }
}

/**
 * The run's own record: each line stamped, each check kept, and the evidence written to `results`
 * whatever happens. A check that fails is a failure; `must` also stops the run, for a check the rest
 * stands on.
 */
export function aRecord(results, name) {
  const started = Date.now()
  const lines = []
  const failures = []
  const stamp = () => `+${((Date.now() - started) / 1000).toFixed(1)}s`
  const say = (line) => {
    const said = `[${name} ${stamp()}] ${line}`
    lines.push(said)
    console.log(said)
  }
  const fail = (line) => {
    failures.push(line)
    say(`✗ ${line}`)
  }
  const check = (ok, line) => (ok ? say(`✓ ${line}`) : fail(line))
  const must = (ok, line) => {
    check(ok, line)
    if (!ok) throw new Error(`nothing after this can be measured: ${line}`)
  }
  const keep = (file, text) => writeFileSync(join(results, file), text)
  return {
    say,
    fail,
    check,
    must,
    keep,
    stamp,
    failures,
    minutes: () => Math.round((Date.now() - started) / 6_000) / 10,
    lines,
  }
}

/**
 * One window over the DevTools protocol: `evaluate` runs an async function body in the page, and
 * `send` any protocol method. Waits for the window to offer `window.api`.
 */
export async function attach(port, { wait = 180_000 } = {}) {
  const target = await until(async () => {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
      return pages.find((one) => one.type === 'page' && one.webSocketDebuggerUrl)
    } catch {
      return null
    }
  }, wait)
  if (target === null) throw new Error(`no window on DevTools port ${String(port)}`)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((done, failed) => {
    socket.addEventListener('open', done, { once: true })
    socket.addEventListener('error', failed, { once: true })
  })
  let next = 0
  const pending = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  const send = (method, params = {}) =>
    new Promise((done, failed) => {
      const id = ++next
      pending.set(id, (message) => {
        if (message.error) failed(new Error(`${method}: ${message.error.message}`))
        else done(message.result)
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (body) => {
    const result = await send('Runtime.evaluate', {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'the page threw')
    }
    return result.result?.value
  }
  const ready = await until(async () => {
    try {
      return await evaluate('return Boolean(window.api?.updates && window.api?.runtime)')
    } catch {
      return false
    }
  }, wait)
  if (!ready) throw new Error('the window never offered window.api')
  /** Every window and page this app has open, as the DevTools endpoint lists them. */
  const targets = async () => (await fetch(`http://127.0.0.1:${String(port)}/json/list`)).json()
  return { evaluate, send, targets, close: () => socket.close() }
}

/**
 * Press what `selector` names as a person does: the pointer moves to its middle, and the left button
 * goes down and up there. ⚑ Real input events, so a disabled or covered button is not pressed. A
 * window draws its controls a moment after it opens: the button has 30 s to be drawn and enabled.
 */
export async function press(cdp, selector) {
  const where = () =>
    cdp.evaluate(`
    const one = document.querySelector(${JSON.stringify(selector)})
    if (one === null) return null
    one.scrollIntoView({ block: 'center' })
    const box = one.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, disabled: one.disabled === true }`)
  const box = await until(
    async () => {
      const found = await where()
      return found !== null && !found.disabled ? found : null
    },
    30_000,
    250,
  )
  if (box === null) {
    const last = await where()
    throw new Error(last === null ? `the window shows no ${selector}` : `${selector} is disabled`)
  }
  const at = { x: box.x, y: box.y }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...at,
    button: 'left',
    clickCount: 1,
  })
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...at,
    button: 'left',
    clickCount: 1,
  })
}

/** The text an element shows, trimmed and on one line, or null when the window shows none. */
export const shown = (cdp, selector) =>
  cdp.evaluate(
    `return document.querySelector(${JSON.stringify(selector)})?.textContent?.replace(/\\s+/g, ' ').trim() ?? null`,
  )

/** Confirm and close the provider setup that a fresh runner's first launch must show. */
export async function closeExpectedLaunchSetup(cdp, { wait = 60_000 } = {}) {
  const dialogs = () =>
    cdp.evaluate(`return [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]')]
      .filter((one) => one.getClientRects().length > 0)
      .map((one) => ({
        label: one.getAttribute('aria-label'),
        provider: one.querySelector('[data-provider][data-step]')?.getAttribute('data-provider') ?? null,
      }))`)
  const open = await until(
    async () => {
      const now = await dialogs()
      return now.length > 0 ? now : null
    },
    wait,
    250,
  )
  if (open?.length !== 1 || open[0].label !== 'Set up Claude' || open[0].provider !== 'claude') {
    throw new Error(`the expected Set up Claude dialog was not shown: ${JSON.stringify(open)}`)
  }
  const pressed =
    await cdp.evaluate(`const close = document.querySelector('[role=dialog] button[aria-label="Close setup"]')
    if (close === null) return false
    close.click()
    return true`)
  if (!pressed) throw new Error('the expected setup dialog has no Close setup button')
  const closed = await until(
    async () => ((await dialogs()).length === 0 ? true : null),
    15_000,
    250,
  )
  const remembered = await cdp.evaluate(
    `return localStorage.getItem('brobot2.providerSetupDismissed') === 'true'`,
  )
  if (!closed || !remembered) {
    throw new Error('closing the setup did not leave the window clear and remember the choice')
  }
  return { expected: 'Set up Claude', provider: 'claude', closed: true, remembered: true }
}

/** The updates menu, opened from the rail's workspace button if it is not open already. */
export async function openTheUpdatesMenu(cdp) {
  if ((await shown(cdp, '[data-cy="updates-menu"]')) !== null) return
  await press(cdp, '[data-cy="rail-workspace"]')
  if (
    !(await until(async () => (await shown(cdp, '[data-cy="updates-menu"]')) !== null, 10_000, 250))
  ) {
    throw new Error('the rail’s workspace button did not open the updates menu')
  }
}

/** What the window's updates menu says now: its state's kind and its sentence. */
export async function menuSays(cdp) {
  await openTheUpdatesMenu(cdp)
  return cdp.evaluate(`
    const where = document.querySelector('[data-cy="updates-state"]')
    return {
      kind: where?.getAttribute('data-state') ?? null,
      said: document.querySelector('[data-cy="updates-said"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      dot: document.querySelector('[data-cy="rail-update-dot"]') !== null,
      visible: document.visibilityState,
    }`)
}

/** A picture of the window, kept as evidence. */
export async function screenshot(cdp, file) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(data, 'base64'))
}

/**
 * A scripted model on the Responses API, for Codex: it answers every request at once, except the
 * first that carries `holdMarker`, whose answer waits until `release()`. Nothing reaches a provider.
 */
export async function aScriptedModel(holdMarker, stamp) {
  const log = []
  let held = null
  let heldOnce = false
  const server = createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const id = `resp_update_rehearsal_${String(log.length + 1)}`
      const hold = !heldOnce && Buffer.concat(chunks).toString('utf8').includes(holdMarker)
      log.push(`${stamp()} ${request.method} ${request.url}${hold ? ' (held)' : ''}`)
      if (request.method !== 'POST') return response.writeHead(404).end()
      const send = (kind, payload) =>
        response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      send('response.created', { response: { id } })
      const finish = () => {
        send('response.output_item.done', {
          output_index: 0,
          item: {
            type: 'message',
            id: `msg_${id}`,
            status: 'completed',
            role: 'assistant',
            content: [{ type: 'output_text', text: `update rehearsal ${id}`, annotations: [] }],
          },
        })
        send('response.completed', {
          response: {
            id,
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 1,
              output_tokens_details: { reasoning_tokens: 0 },
              total_tokens: 2,
            },
          },
        })
        response.end()
      }
      if (hold) {
        heldOnce = true
        held = finish
      } else finish()
    })
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return {
    port: server.address().port,
    log,
    isHolding: () => held !== null,
    release: () => {
      held?.()
      held = null
    },
    close: () => {
      held?.()
      server.close()
    },
  }
}

export const SCRIPTED_MODEL = 'gpt-5.4'

/** The Codex profile home's `config.toml` that sends every turn to the scripted model. */
export function codexConfigFor(modelPort) {
  return [
    `model = ${JSON.stringify(SCRIPTED_MODEL)}`,
    'model_provider = "update_rehearsal"',
    '',
    '[model_providers.update_rehearsal]',
    'name = "BroBot update rehearsal, a local scripted model"',
    `base_url = "http://127.0.0.1:${String(modelPort)}/v1"`,
    // ⚠️ BroBot keeps a Codex key only when Codex says the profile runs on it, which Codex says only
    // for a provider that uses OpenAI's login. The fake key then goes to this local model only.
    'requires_openai_auth = true',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

/**
 * The local feed: it serves one release's files at a time — A's update file first, so A finds itself
 * up to date, then B's once `offer(…)` is called. ⚑ A's own blockmap is never served, so
 * electron-updater downloads the whole installer rather than a difference.
 */
export async function aLocalFeed(stamp) {
  const log = []
  let served = new Map()
  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, LOCAL_FEED_URL).pathname.slice(1))
    const file = served.get(name)
    log.push(`${stamp()} ${request.method} ${request.url} → ${file ? 200 : 404}`)
    if (file === undefined) return response.writeHead(404).end()
    response.writeHead(200, { 'content-length': String(statSync(file).size) })
    createReadStream(file).pipe(response)
  })
  await new Promise((done) => server.listen(LOCAL_FEED_PORT, '127.0.0.1', done))
  return {
    log,
    offer: (files) => {
      served = new Map(files.map((file) => [basename(file), file]))
    },
    close: () => server.close(),
  }
}

/**
 * The environment the app under test starts with: the runner's, without any token, and on a private
 * feed with that feed's token as `GH_TOKEN`, which electron-updater and the guided download read
 * for a feed whose `app-update.yml` says `private: true`.
 */
export function theAppsEnvironment(feed) {
  const env = { ...process.env }
  for (const name of [
    'GITHUB_TOKEN',
    'GH_TOKEN',
    'ACTIONS_RUNTIME_TOKEN',
    'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  ]) {
    delete env[name]
  }
  const token = feedToken(feed, process.env)
  if (token !== null) env.GH_TOKEN = token
  return env
}
