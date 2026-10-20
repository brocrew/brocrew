import { session, WebContentsView } from 'electron'
import type { IpcMain, IpcMainInvokeEvent, WebContents, WebFrameMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { VerifiedPluginPackage } from '../package-verifier'
import {
  exact,
  plain,
  PLUGIN_UI_EVENT,
  PLUGIN_UI_LIMITS,
  PLUGIN_UI_RPC,
  PLUGIN_UI_UNAVAILABLE,
} from '../../../shared/plugin-ui'
import { PluginUiAssets } from './assets'
import { PluginUiRpc, type PluginUiBinding, type PluginUiPeer } from './rpc'
import { markPluginSender, markPluginSession } from './senders'

interface Registered {
  generation: string
  accepts(frame: WebFrameMain | null): boolean
  rpc: PluginUiRpc
}
const registered = new Map<WebContents, Registered>()
export function installPluginUiRpc(ipc: Pick<IpcMain, 'handle'>): void {
  ipc.handle(
    PLUGIN_UI_RPC,
    async (event: IpcMainInvokeEvent, input: unknown, ...extra: unknown[]) => {
      const view = registered.get(event.sender)
      if (
        !view ||
        !plain(input) ||
        !exact(input, ['generation', 'packet']) ||
        extra.length ||
        input.generation !== view.generation ||
        !view.accepts(event.senderFrame)
      )
        return { ok: false, error: PLUGIN_UI_UNAVAILABLE }
      try {
        return { ok: true, data: await view.rpc.invoke(input.packet) }
      } catch {
        return { ok: false, error: PLUGIN_UI_UNAVAILABLE }
      }
    },
  )
}
export interface PluginUiHostOptions {
  verified: VerifiedPluginPackage
  binding: Readonly<PluginUiBinding>
  peer: PluginUiPeer
  current(binding: Readonly<PluginUiBinding>): boolean
  /** Controller wires lease loss, uninstall, upgrade and restore to this revoker. */
  onInvalidate(revoke: () => void | Promise<void>): () => void
  /** BroCrew-owned Apply flow; proposing never commits configuration. */
  propose(publicProposal: unknown, revision: number): void
  detached?(): void
}
export interface PluginConfigurationView {
  readonly view: WebContentsView
  readonly origin: string
  close(): Promise<void>
}
/** A failed open's refusal, with the closed step that refused it and the cause's code. */
const refusal = (step: string, cause?: unknown) =>
  Object.assign(new Error(PLUGIN_UI_UNAVAILABLE), {
    step,
    code: (cause as { code?: unknown } | undefined)?.code,
  })
export async function openPluginConfigurationView(
  options: PluginUiHostOptions,
): Promise<PluginConfigurationView> {
  const id = randomUUID(),
    generation = randomUUID(),
    assets = (() => {
      try {
        return new PluginUiAssets(options.verified, id)
      } catch (error) {
        throw refusal('assets', error)
      }
    })()
  const binding = Object.freeze({ ...options.binding })
  const authorized = () => {
    try {
      return options.current(binding)
    } catch {
      return false
    }
  }
  if (
    binding.pluginId !== options.verified.manifest.id ||
    !/^[a-f0-9]{64}$/.test(binding.releaseDigest) ||
    !authorized()
  )
    throw refusal('binding')
  const isolated = session.fromPartition(`plugin-ui:${id}`, { cache: false })
  markPluginSession(isolated)
  isolated.setPermissionCheckHandler(() => false)
  isolated.setPermissionRequestHandler((_contents, _permission, answer) => answer(false))
  isolated.setDevicePermissionHandler(() => false)
  const view = new WebContentsView({
    webPreferences: {
      session: isolated,
      preload: join(__dirname, '../preload/plugin-ui.js'),
      additionalArguments: [`--brocrew-plugin-generation=${generation}`],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      navigateOnDragDrop: false,
      devTools: false,
      safeDialogs: true,
    },
  })
  const contents = view.webContents
  markPluginSender(contents)
  let closed = false,
    frame: WebFrameMain | null = null,
    loaded = false,
    mainRequested = false,
    cleanup: Promise<void> | undefined,
    /** What closed the view while it was loading, for the refusal. */
    closedBy: string | undefined
  const closeFor = (why: string) => {
    closedBy ??= why
    void close()
  }
  const lifecycle: { stop?: () => void } = {}
  const loadAbort = new AbortController()
  const current = () => {
    const live = !closed && !contents.isDestroyed() && authorized()
    if (!live && !closed) closeFor(contents.isDestroyed() ? 'destroyed' : 'unauthorized')
    return live
  }
  const accepts = (sender: WebFrameMain | null): boolean => {
    try {
      return (
        current() &&
        sender !== null &&
        sender === frame &&
        sender === contents.mainFrame &&
        sender.url === assets.entry &&
        contents.getURL() === assets.entry
      )
    } catch {
      return false
    }
  }
  const rpc = new PluginUiRpc({
    binding,
    schemas: options.verified.manifest.ui!.methodSchemas,
    peer: options.peer,
    current: () => accepts(frame),
    now: () => performance.now(),
    propose: options.propose,
    emit(subscriptionId, data) {
      if (accepts(frame)) frame!.send(PLUGIN_UI_EVENT, generation, { subscriptionId, data })
    },
  })
  const close = (): Promise<void> => {
    if (cleanup) return cleanup
    let finish: () => void = () => {},
      fail: (error: Error) => void = () => {}
    cleanup = new Promise<void>((resolve, reject) => {
      finish = resolve
      fail = reject
    })
    // Event-driven revokers do not have an awaiting caller. Keep rejection handled,
    // while explicit close() still reports failure to prove destruction.
    void cleanup.catch(() => {})
    closed = true
    frame = null
    registered.delete(contents)
    loadAbort.abort()
    rpc.close()
    try {
      lifecycle.stop?.()
    } catch {
      /* teardown must continue */
    }
    const destroyed = new Promise<boolean>((resolve) => {
      if (contents.isDestroyed()) return resolve(true)
      const ended = () => {
        clearTimeout(timer)
        resolve(true)
      }
      const timer = setTimeout(() => {
        contents.removeListener('destroyed', ended)
        resolve(false)
      }, PLUGIN_UI_LIMITS.timeout)
      contents.once('destroyed', ended)
      try {
        options.detached?.()
      } catch {
        /* still close the owned contents */
      }
      try {
        contents.close({ waitForBeforeUnload: false })
      } catch {
        clearTimeout(timer)
        contents.removeListener('destroyed', ended)
        resolve(contents.isDestroyed())
      }
    })
    void destroyed.then(async (confirmed) => {
      const cleared = await Promise.allSettled(
        [
          () => isolated.protocol.unhandle('brocrew-plugin'),
          () => isolated.clearStorageData(),
          () => isolated.clearCache(),
          () => isolated.closeAllConnections(),
        ].map((clear) => Promise.resolve().then(clear)),
      )
      if (
        confirmed &&
        contents.isDestroyed() &&
        cleared.every((result) => result.status === 'fulfilled')
      )
        finish()
      else fail(new Error(PLUGIN_UI_UNAVAILABLE))
    })
    return cleanup
  }
  try {
    registered.set(contents, { generation, accepts, rpc })
    isolated.protocol.handle('brocrew-plugin', (request) => assets.response(request))
    isolated.webRequest.onBeforeRequest((details, answer) => {
      if (details.resourceType === 'mainFrame') {
        if (mainRequested || details.url !== assets.entry) {
          answer({ cancel: true })
          closeFor(mainRequested ? 'second-main-request' : 'main-request-elsewhere')
          return
        }
        mainRequested = true
      }
      const allowed =
        current() &&
        assets.permits(details.url, details.method) &&
        details.webContentsId === contents.id &&
        details.resourceType !== 'subFrame' &&
        (details.resourceType !== 'mainFrame' || details.url === assets.entry)
      answer({ cancel: !allowed })
    })
    isolated.on('will-download', (event) => {
      event.preventDefault()
      void close()
    })
    contents.setWindowOpenHandler(() => {
      void close()
      return { action: 'deny' }
    })
    contents.on('will-frame-navigate', (event) => {
      event.preventDefault()
      closeFor('navigation')
    })
    contents.on('will-redirect', (event) => {
      event.preventDefault()
      closeFor('redirect')
    })
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      void close()
    })
    contents.on('did-navigate', (_event, url) => {
      if (loaded || url !== assets.entry) {
        closeFor(
          loaded
            ? 'navigated-twice'
            : url.startsWith(`${assets.origin}/`)
              ? 'navigated-other-path'
              : 'navigated-other-origin',
        )
        return
      }
      loaded = true
      frame = contents.mainFrame
    })
    contents.on('did-navigate-in-page', () => {
      void close()
    })
    contents.on('render-process-gone', () => {
      closeFor('renderer-gone')
    })
    contents.on('destroyed', () => {
      void close()
    })
    lifecycle.stop = options.onInvalidate(() => {
      closedBy ??= 'invalidated'
      return close()
    })
    if (closed) lifecycle.stop()
    if (closed) throw refusal('revoked')
    let timer: ReturnType<typeof setTimeout> | undefined
    let canceled: (() => void) | undefined
    const revoked = new Promise<never>((_resolve, reject) => {
      canceled = () => reject(refusal(closedBy ?? 'revoked'))
      loadAbort.signal.addEventListener('abort', canceled, { once: true })
    })
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(refusal('load-timeout')), PLUGIN_UI_LIMITS.timeout)
    })
    await Promise.race([
      Promise.resolve()
        .then(() => contents.loadURL(assets.entry))
        .catch((error: unknown) => {
          throw refusal(closedBy ?? 'load', error)
        }),
      revoked,
      deadline,
    ]).finally(() => {
      clearTimeout(timer)
      if (canceled) loadAbort.signal.removeEventListener('abort', canceled)
    })
    if (!current()) throw refusal(closedBy ?? 'revoked')
    if (!loaded) throw refusal('not-navigated')
  } catch (error) {
    await close()
    throw (error as { step?: unknown } | null)?.step ? error : refusal('open', error)
  }
  return { view, origin: assets.origin, close }
}
