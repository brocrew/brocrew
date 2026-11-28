import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

/** Launch a probe process and keep its combined output available for diagnostics. */
export function launchForCdp(executable, args, cwd) {
  const child = spawn(executable, args, {
    cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  return { child, output: () => output }
}

export async function waitFor(what, read, budgetMs, pollMs) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    let last
    try {
      last = await read()
    } catch {
      last = null
    }
    if (last !== null && last !== undefined && last !== false) return last
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new Error(`timed out after ${String(budgetMs)}ms waiting for ${what}`)
}

/**
 * ⛔ **Three states, not two** — who is listening on this port, or *we could not ask*.
 *
 * `lsof -t` exits **1** when nothing matches, so a bare `catch { return [] }` would make *"nothing
 * is there"* and *"the question could not be put"* the same answer.
 */
export function listenersOn(port) {
  try {
    const out = execFileSync('lsof', ['-t', `-iTCP:${String(port)}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { asked: true, pids: out.trim().split('\n').filter(Boolean).map(Number) }
  } catch (error) {
    if (error?.status === 1) return { asked: true, pids: [] }
    return { asked: false, pids: [], why: error?.message ?? String(error) }
  }
}

/** One CDP connection to the renderer. */
export class RendererCdp {
  #socket
  #id = 0
  #pending = new Map()
  #boundMs = null

  static async attach(port, { launchMs, pollMs }) {
    const target = await waitFor(
      'a renderer target holding a document',
      async () => {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
          signal: AbortSignal.timeout(2_000),
        })
        if (!response.ok) return null
        const list = await response.json()
        return Array.isArray(list)
          ? (list.find(
              (t) =>
                t.type === 'page' &&
                typeof t.webSocketDebuggerUrl === 'string' &&
                t.url !== '' &&
                t.url !== 'about:blank',
            ) ?? null)
          : null
      },
      launchMs,
      pollMs,
    )
    const cdp = new RendererCdp()
    await cdp.#connect(target.webSocketDebuggerUrl)
    await cdp.send('Runtime.enable')
    await cdp.send('Page.enable')
    return cdp
  }

  #connect(url) {
    this.#socket = new WebSocket(url)
    this.#socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      const pending = this.#pending.get(message.id)
      if (!pending) return
      this.#pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    return new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', resolve, { once: true })
      this.#socket.addEventListener('error', reject, { once: true })
    })
  }

  send(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression: `(() => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'the page threw')
    }
    return result.result.value
  }

  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(data, 'base64'))
    return file
  }

  close() {
    this.#socket?.close()
  }

  /**
   * A target the caller found itself, with every wait bounded: the socket must open within
   * `boundMs`, each {@link call} must be answered within it, and a socket that closes fails what is
   * still waiting. Nothing is enabled on the target.
   */
  static async connect(url, { boundMs }) {
    const cdp = new RendererCdp()
    cdp.#boundMs = boundMs
    let timer
    try {
      await Promise.race([
        cdp.#connect(url).catch(() => {
          throw new Error('the DevTools socket failed to open')
        }),
        new Promise((resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`the DevTools socket did not open in ${cdp.#seconds()}`)),
            boundMs,
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    cdp.#socket.addEventListener('close', () => {
      for (const pending of cdp.#pending.values()) {
        pending.reject(new Error('the DevTools socket closed'))
      }
      cdp.#pending.clear()
    })
    return cdp
  }

  /**
   * A request on a {@link connect}ed target. Unanswered in time, it fails naming its method and its
   * registration is dropped, so a late answer finds nothing waiting.
   */
  call(method, params = {}) {
    const id = ++this.#id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error(`${method}: no answer in ${this.#seconds()}`))
      }, this.#boundMs)
      this.#pending.set(id, {
        resolve: (result) => {
          clearTimeout(timer)
          resolve(result)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(new Error(`${method}: ${error.message}`))
        },
      })
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** What `expression` evaluates to in the page, as written, where {@link evaluate} takes a body. */
  async evaluateExpression(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails) {
      const said = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(`in the page: ${said}`)
    }
    return result.result.value
  }

  #seconds() {
    return `${String(this.#boundMs / 1000)} s`
  }
}
