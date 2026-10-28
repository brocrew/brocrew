import { press, until } from '../../lib/update-rehearsal-app.mjs'

/** Setup can arrive after the bridge; never click Settings through its overlay. */
export async function openPlugins(cdp, { click = press, wait = waitFor, signal } = {}) {
  await wait(async () => {
    signal?.throwIfAborted()
    const state = await cdp.evaluate(`
      const has = key => Boolean(document.querySelector('[data-cy="' + key + '"]'));
      return {
        setup: has('provider-setup-dialog'), close: has('setup-close'),
        workspace: has('rail-settings'), tab: has('settings-tab-plugins'),
        plugins: has('plugins-section'),
        selected: document.querySelector('[data-cy="settings-tab-plugins"]')?.getAttribute('aria-selected') === 'true'
      }`)
    signal?.throwIfAborted()
    if (state.setup || state.close) {
      if (state.close) await click(cdp, '[data-cy="setup-close"]')
      return false
    }
    if (!state.workspace) return false
    if (state.plugins && state.selected) return true
    await click(cdp, state.tab ? '[data-cy="settings-tab-plugins"]' : '[data-cy="rail-settings"]')
    return false
  })
}

/** Reacquire Plugins before locating and pressing each control, with a bounded recovery count. */
export async function pressInPlugins(cdp, selector, { click = press, open = openPlugins } = {}) {
  let reopens = 0
  await click(cdp, selector, {
    beforePress: async () => {
      const witness = await cdp.evaluate(`
        return {
          selectedSettingsTab: document.querySelector('[data-cy^="settings-tab-"][aria-selected="true"]')?.getAttribute('data-cy') ?? null,
          plugins: Boolean(document.querySelector('[data-cy="plugins-section"]'))
        }`)
      if (witness.selectedSettingsTab === 'settings-tab-plugins' && witness.plugins) return
      if (reopens === 3)
        throw new Error(
          `Plugins tab recovery exhausted before ${selector}: ${JSON.stringify(witness)}`,
        )
      reopens += 1
      await open(cdp)
    },
  })
}

/** A selected WebContentsView, not the main window's preload or a fake plugin page. */
export async function pluginPage(port) {
  const target = await until(
    async () => {
      const rows = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      return rows.find(
        (row) =>
          row.type === 'page' &&
          row.url?.startsWith('brocrew-plugin://') &&
          row.webSocketDebuggerUrl,
      )
    },
    200_000,
    200,
  )
  if (!target) throw new Error('No real plugin view')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let next = 0
  const pending = new Map()
  const refuseAll = () => {
    for (const item of pending.values()) {
      clearTimeout(item.timer)
      item.reject(new Error('Plugin view closed'))
    }
    pending.clear()
  }
  socket.addEventListener('close', refuseAll)
  socket.addEventListener('error', refuseAll)
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data),
      item = pending.get(message.id)
    if (!item) return
    clearTimeout(item.timer)
    pending.delete(message.id)
    if (message.error) item.reject(new Error('Plugin protocol refused'))
    else item.resolve(message.result)
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++next,
        timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('Plugin protocol timeout'))
        }, 15_000)
      pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (body) => {
    const value = await send('Runtime.evaluate', {
      expression: `(async()=>{${body}})()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (value.exceptionDetails) throw new Error('Plugin page refused')
    return value.result?.value
  }
  return {
    evaluate,
    send,
    close: () => {
      refuseAll()
      socket.close()
    },
  }
}
export async function waitFor(test, wait = 60_000) {
  if (!(await until(test, wait, 250))) throw new Error('Packaged gate timed out')
}
/** Restored configuration must show the retained, enabled profile before it is asserted. */
export async function enabledProfile(page, wait = waitFor) {
  await wait(() =>
    page.evaluate(`
      const row = document.querySelector('[data-profile="fern"]');
      return Boolean(row && [...row.querySelectorAll('button')].some(b => b.textContent === 'Disable' && !b.disabled))`),
  )
}
export async function pluginButton(page, label) {
  await waitFor(() =>
    page.evaluate(`
    const row = document.querySelector('[data-profile="fern"]');
    const button = [...(row?.querySelectorAll('button') ?? [])].find(b => b.textContent === ${JSON.stringify(label)});
    return Boolean(button && !button.disabled)`),
  )
  const box = await page.evaluate(`
    const row = document.querySelector('[data-profile="fern"]');
    const button = [...row.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)});
    const r = button.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}`)
  await page.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    button: 'left',
    clickCount: 1,
    ...box,
  })
  await page.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    button: 'left',
    clickCount: 1,
    ...box,
  })
}
