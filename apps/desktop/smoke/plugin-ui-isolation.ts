/** Inert Electron boundary probe. No application entry, provider, supervisor or real plugin starts. */
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import {
  openPluginConfigurationView,
  installPluginUiRpc,
  type PluginConfigurationView,
} from '../src/main/plugins/ui/host'
import { PLUGIN_SCHEME } from '../src/main/plugins/ui/assets'
import { uiFixture } from '../test/plugin-ui-fixtures'
import { guardedAppIpc } from '../src/main/app-ipc'
import { isPluginSender } from '../src/main/plugins/ui/senders'

const root = process.env.BROBOT_PLUGIN_UI_PROBE_ROOT
if (!root) throw new Error('fictional probe root required')
mkdirSync(join(root, 'user-data'), { recursive: true, mode: 0o700 })
app.setPath('userData', join(root, 'user-data'))
app.setPath('crashDumps', root)
protocol.registerSchemesAsPrivileged([PLUGIN_SCHEME])
let count = 0,
  phase = 0
const checkpoint = () =>
  writeFileSync(
    join(root, 'counts.json'),
    JSON.stringify({ passed: false, assertions: count, phase }),
  )
checkpoint()
const check = (value: unknown) => {
  assert.ok(value)
  count++
  checkpoint()
}
const views: PluginConfigurationView[] = []
async function run() {
  await app.whenReady()
  phase = 1
  checkpoint()
  installPluginUiRpc(ipcMain)
  let appCalls = 0,
    peerCalls = 0
  guardedAppIpc(ipcMain).handle('app:fictional-probe', () => {
    appCalls++
    return 'private app data'
  })
  const owner = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  phase = 2
  checkpoint()
  async function create() {
    phase = 3
    checkpoint()
    const f = uiFixture()
    let revoke = () => {},
      live = true
    const host = await openPluginConfigurationView({
      verified: f.verified,
      binding: f.binding,
      peer: {
        read: async (_payload, _revision, binding) => {
          peerCalls++
          assert.equal(binding.pluginId, 'fictional-bakery')
          return { loaves: 2 }
        },
        subscribe: async () => () => {},
        proposeConfig: async () => ({ resources: [] }),
      },
      current: () => live,
      onInvalidate: (stop) => {
        revoke = stop
        return () => {}
      },
      propose: () => {},
    })
    phase = 4
    checkpoint()
    views.push(host)
    owner.contentView.addChildView(host.view)
    host.view.setBounds({ x: 0, y: 0, width: 300, height: 200 })
    host.view.webContents.setBackgroundThrottling(false)
    return {
      host,
      revoke: () => {
        live = false
        revoke()
      },
    }
  }
  const a = await create(),
    b = await create(),
    wc = a.host.view.webContents
  check(a.host.origin !== b.host.origin)
  check(wc.session !== b.host.view.webContents.session)
  check(wc.session.storagePath === null)
  check(isPluginSender({ session: wc.session, getURL: () => 'about:blank' }))
  check((await wc.executeJavaScript('location.origin')) === a.host.origin)
  check((await wc.executeJavaScript('document.documentElement.dataset.ready')) === 'yes')
  check(
    await wc.executeJavaScript(
      '[typeof require,typeof process,typeof api,typeof recovery,typeof ipcRenderer].every(x=>x==="undefined")',
    ),
  )
  const reply = await wc.executeJavaScript(`new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('fictional DOM bridge unanswered')),5000);
    addEventListener('message',event=>{if(event.source===window && event.data.requestId==='own' && typeof event.data.ok==='boolean'){clearTimeout(timeout);resolve(event.data)}});
    postMessage({channel:'brocrew-plugin-ui:v1',requestId:'own',method:'read',payload:{},configRevision:0},location.origin);
  })`)
  assert.deepEqual(reply, {
    channel: 'brocrew-plugin-ui:v1',
    requestId: 'own',
    ok: true,
    data: { loaves: 2 },
  })
  count++
  check(peerCalls === 1)
  check(
    await wc.executeJavaScript(
      `(()=>{const script=document.createElement('script');script.textContent='window.fictionalInlineRan=true';document.head.append(script);return typeof window.fictionalInlineRan==='undefined'})()`,
    ),
  )
  await wc.executeJavaScript(`localStorage.setItem('fictional-own-value','one')`)
  check(
    (await b.host.view.webContents.executeJavaScript(
      `localStorage.getItem('fictional-own-value')`,
    )) === null,
  )
  check(
    await wc.executeJavaScript(
      `(async()=>{try{await fetch(${JSON.stringify(b.host.origin + '/ui/index.html')});return false}catch{return true}})()`,
    ),
  )
  await wc.executeJavaScript(
    `postMessage({channel:'brocrew-plugin-ui:v1',requestId:'foreign',method:'app:fictional-probe',payload:{},configRevision:0},location.origin)`,
  )
  check(appCalls === 0 && peerCalls === 1)
  const c = await create()
  const windowsBefore = BrowserWindow.getAllWindows().length
  const cContents = c.host.view.webContents
  const cGone = once(cContents, 'destroyed')
  void c.host.view.webContents
    .executeJavaScript(`window.open('https://example.invalid/'); true`, true)
    .catch(() => {})
  await Promise.race([cGone, new Promise((resolve) => setTimeout(resolve, 1000))])
  check(BrowserWindow.getAllWindows().length === windowsBefore)
  await c.host.close()
  check(cContents.isDestroyed())
  const d = await create()
  const dContents = d.host.view.webContents
  const dGone = once(dContents, 'destroyed')
  void d.host.view.webContents
    .executeJavaScript(`location.href='https://example.invalid/'`)
    .catch(() => {})
  await Promise.race([dGone, new Promise((resolve) => setTimeout(resolve, 1000))])
  check(dContents.isDestroyed())
  const e = await create()
  const eContents = e.host.view.webContents
  eContents.reload()
  await new Promise((resolve) => setTimeout(resolve, 100))
  check(eContents.isDestroyed())
  const bContents = b.host.view.webContents
  b.revoke()
  await b.host.close()
  check(bContents.isDestroyed())
  const isolated = wc.session
  await isolated.cookies.set({
    url: 'https://fictional.example.invalid',
    name: 'fictional-cookie',
    value: 'fictional-value',
  })
  check((await isolated.cookies.get({})).length === 1)
  await a.host.close()
  check(wc.isDestroyed())
  check((await isolated.cookies.get({})).length === 0)
  owner.destroy()
}
void run()
  .then(async () => {
    for (const view of views) await view.close()
    writeFileSync(join(root, 'counts.json'), JSON.stringify({ passed: true, assertions: count }))
    app.exit(0)
  })
  .catch(async () => {
    for (const view of views) await view.close().catch(() => {})
    writeFileSync(
      join(root, 'counts.json'),
      JSON.stringify({ passed: false, assertions: count, phase }),
    )
    app.exit(1)
  })
