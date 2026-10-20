/** Actual Settings→preload→IPC→isolated Chrome UI. Fictional lifecycle and RPC peer only. */
import { app, BrowserWindow, ipcMain, protocol, WebContentsView, nativeTheme } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { registerPluginSettings, type PluginSettingsController } from '../src/main/plugins/settings'
import { guardedAppIpc } from '../src/main/app-ipc'
import { installPluginUiRpc } from '../src/main/plugins/ui/host'
import { PLUGIN_SCHEME } from '../src/main/plugins/ui/assets'
import { chromeUiFixture, FICTIONAL_CHROME } from '../test/chrome-ui-fixture'
import { READABILITY_THEME_NAMES } from './plugin-settings-themes'
const probeRoot = process.env.BROBOT_PLUGIN_UI_PROBE_ROOT,
  cropRoot = process.env.BROBOT_PLUGIN_UI_CROPS
if (!probeRoot || !cropRoot) throw new Error('fictional fixture folders required')
const root = probeRoot,
  out = cropRoot
mkdirSync(join(root, 'data'), { recursive: true, mode: 0o700 })
mkdirSync(out, { recursive: true })
app.setPath('userData', join(root, 'data'))
app.setPath('crashDumps', root)
protocol.registerSchemesAsPrivileged([PLUGIN_SCHEME])
nativeTheme.themeSource = 'light'
app.on('window-all-closed', () => {})
let assertions = 0,
  phase = 0,
  step = 0
const check = (ok: unknown) => {
  assert.ok(ok)
  assertions++
  writeFileSync(
    join(root, 'counts.json'),
    JSON.stringify({ passed: false, assertions, phase, step }),
  )
}
async function wait(check: () => Promise<boolean>) {
  for (let n = 0; n < 120; n++) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('fictional fixture not ready')
}
async function run() {
  await app.whenReady()
  installPluginUiRpc(ipcMain)
  for (const width of [1180, 760])
    for (const theme of READABILITY_THEME_NAMES) {
      nativeTheme.themeSource = ['synthwave', 'see-through-dark'].includes(theme) ? 'dark' : 'light'
      phase++
      const owner = new BrowserWindow({
        width,
        height: 900,
        useContentSize: true,
        show: false,
        frame: false,
        webPreferences: {
          preload: join(__dirname, '../preload/plugin-settings-fixture.js'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      const fixture = chromeUiFixture(
        join(process.env.BROBOT_PLUGIN_SOURCE_ROOT!, 'plugins/chrome'),
      )
      let reads = 0,
        installed = theme !== 'classic',
        installs = 0,
        uninstalls = 0
      const controller: PluginSettingsController = {
        catalogue: async () => [
          { id: 'chrome', name: 'Chrome', state: installed ? 'Running' : 'Available', installed },
          { id: 'fictional-maps', name: 'Fictional Maps', state: 'Available', installed: false },
        ],
        install: async () => {
          installs++
          installed = true
        },
        uninstall: async () => {
          uninstalls++
          installed = false
        },
        screen: async () => ({
          ...fixture,
          current: () => true,
          onInvalidate: () => () => {},
          propose: () => {},
          peer: {
            read: async (_p, _r, binding) => {
              check(binding.pluginId === 'chrome')
              reads++
              return FICTIONAL_CHROME
            },
            subscribe: async () => () => {},
            proposeConfig: async () => ({ resources: [] }),
          },
        }),
      }
      // Fake seams are injected only in this inert fixture, never installed in the product.
      ipcMain.removeHandler('plugins:settings')
      registerPluginSettings(
        guardedAppIpc(ipcMain),
        (event) => (event.sender === owner.webContents ? owner : null),
        controller,
      )
      await owner.loadFile(join(root, 'renderer/look/plugins-window.html'), { query: { theme } })
      await wait(() =>
        owner.webContents.executeJavaScript(
          `document.querySelectorAll('[data-cy="plugin-card"]').length===2`,
        ),
      )
      if (theme === 'classic') {
        await owner.webContents.executeJavaScript(
          `document.querySelector('[data-plugin="chrome"] [data-cy="plugin-install"]').click()`,
        )
        await wait(() =>
          owner.webContents.executeJavaScript(
            `document.querySelector('[data-plugin="chrome"] [data-cy="plugin-state"]').textContent==='Running'`,
          ),
        )
        check(installs === 1 && installed)
        owner.showInactive()
        await new Promise((resolve) => setTimeout(resolve, 250))
        step++
        writeFileSync(
          join(out, `plugins-${width}.png`),
          (await owner.capturePage(undefined, { stayHidden: true })).resize({ width }).toPNG(),
        )
        const box = await owner.webContents.executeJavaScript(
          `(()=>{const r=document.querySelector('[data-cy="plugin-card"]').getBoundingClientRect();return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}})()`,
        )
        writeFileSync(
          join(out, `chrome-card-${width}.png`),
          (await owner.capturePage(box, { stayHidden: true })).resize({ width: box.width }).toPNG(),
        )
      }
      await owner.webContents.executeJavaScript(
        `document.querySelector('[data-cy="plugin-configure"]').click()`,
      )
      await wait(async () =>
        owner.contentView.children.some((view) => view instanceof WebContentsView),
      )
      const view = owner.contentView.children.find(
        (view) => view instanceof WebContentsView,
      ) as WebContentsView
      const contents = view.webContents
      await wait(() =>
        contents.executeJavaScript(`document.querySelectorAll('.profile-tabs li').length===2`),
      )
      check(reads > 0)
      check(
        await contents.executeJavaScript(
          `document.querySelector('#profiles').textContent.includes('birch') && document.querySelector('[data-profile=birch] .profile-tabs').textContent.includes('Oak atlas')`,
        ),
      )
      check(
        await contents.executeJavaScript(
          `[typeof require,typeof process,typeof api,typeof fixturePlugins].every(value=>value==='undefined')`,
        ),
      )
      check(
        await contents.executeJavaScript(`(()=>{
        const birch=document.querySelector('[data-profile=birch]'),fir=document.querySelector('[data-profile=fir]');
        return birch.querySelector('.profile-state').textContent==='Open' && fir.querySelector('.profile-state').textContent==='Closed'
          && birch.querySelectorAll('.profile-tabs li').length===2 && !fir.querySelector('.profile-tabs')
          && birch.querySelector('.tab-title').textContent==='Oak atlas'
          && birch.querySelector('.tab-url').textContent==='https://atlas.example.invalid/'
          && !birch.querySelector('.profile-tabs').textContent.includes('birch —')
          && document.documentElement.scrollWidth<=innerWidth;
      })()`),
      )
      // This package has only flat system-colour surfaces: measure resolved text/ancestor pairs.
      const contrast = await contents.executeJavaScript(`(()=>{
   const probe=document.createElement('i');probe.style.backgroundColor='Canvas';document.body.append(probe);const canvas=getComputedStyle(probe).backgroundColor;probe.remove();
   const rgba=s=>s.match(/[\\d.]+/g)?.map(Number)??[];
   const luminance=s=>{const a=rgba(s).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};
   return [...document.querySelectorAll('h1,h2,p,label,strong,span,li,button,input')].filter(e=>e.getBoundingClientRect().width>0).every(e=>{let bg=canvas;for(let n=e;n;n=n.parentElement){const s=getComputedStyle(n).backgroundColor,a=rgba(s);if(a.length===3||a[3]===1){bg=s;break}}const ink=luminance(getComputedStyle(e).color),paper=luminance(bg);return (Math.max(ink,paper)+.05)/(Math.min(ink,paper)+.05)>=4.5})
  })()`)
      check(contrast)
      if (theme === 'classic') {
        check(!contents.isDestroyed())
        contents.setBackgroundThrottling(false)
        step++
        writeFileSync(
          join(out, `configuration-frame-${width}.png`),
          (await owner.capturePage(undefined, { stayHidden: true })).resize({ width }).toPNG(),
        )
        step++
        writeFileSync(
          join(out, `chrome-screen-${width}.png`),
          (await contents.capturePage(undefined, { stayHidden: true }))
            .resize({ width: view.getBounds().width })
            .toPNG(),
        )
      }
      await owner.webContents.executeJavaScript(
        `document.querySelector('[data-cy="plugin-close"]').click()`,
      )
      await wait(async () => contents.isDestroyed())
      check(contents.isDestroyed())
      if (theme === 'classic') {
        await owner.webContents.executeJavaScript(
          `document.querySelector('[data-cy="plugin-uninstall"]').click()`,
        )
        await wait(() =>
          owner.webContents.executeJavaScript(
            `!!document.querySelector('[data-cy="plugin-uninstall-confirm"]')`,
          ),
        )
        await owner.webContents.executeJavaScript(
          `document.querySelector('[data-cy="plugin-uninstall-confirm"]').click()`,
        )
        await wait(() =>
          owner.webContents.executeJavaScript(
            `document.querySelector('[data-plugin="chrome"] [data-cy="plugin-state"]').textContent==='Available'`,
          ),
        )
        check(uninstalls === 1 && !installed)
      }
      owner.destroy()
    }
}
void run()
  .then(() => {
    writeFileSync(
      join(root!, 'counts.json'),
      JSON.stringify({ passed: true, assertions, themes: 8, widths: 2 }),
    )
    app.exit(0)
  })
  .catch(() => {
    writeFileSync(
      join(root!, 'counts.json'),
      JSON.stringify({ passed: false, assertions, phase, step }),
    )
    app.exit(1)
  })
