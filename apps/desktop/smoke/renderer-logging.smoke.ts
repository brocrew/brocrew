import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { appLogFile, logInfo, openLog, setDebug } from '../src/main/logging/log'

const root = process.argv.find((one) => one.startsWith('--probe-root='))!.slice(13)
const renderer = process.argv.find((one) => one.startsWith('--probe-renderer='))!.slice(17)
app.setPath('userData', root)
app.disableHardwareAcceleration()
const file = appLogFile(root)
openLog(file, { console: false })
log.initialize()

async function written(marker: string): Promise<string> {
  const until = Date.now() + 5000
  while (Date.now() < until) {
    const text = await readFile(file, 'utf8').catch(() => '')
    if (text.includes(marker)) return text
    await new Promise((done) => setTimeout(done, 20))
  }
  throw new Error(`Log marker not written: ${marker}`)
}

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    })
    try {
      await window.loadURL('data:text/html,<html><body>Logging probe</body></html>')
      await window.webContents.executeJavaScript(await readFile(renderer, 'utf8'))
      logInfo('main', 'fictional-main-marker')
      await window.webContents.executeJavaScript(`
      window.addEventListener('error', event => console.info('fictional-error-default-' + event.defaultPrevented));
      window.addEventListener('unhandledrejection', event => console.info('fictional-rejection-default-' + event.defaultPrevented));
      console.debug('fictional-debug-off');
      console.error('fictional-renderer-error-off');
      console.info('fictional-off-barrier');
      setTimeout(() => { throw new Error('fictional-renderer-uncaught') }, 0);
      void Promise.reject(new Error('fictional-renderer-rejection'));
      'scheduled';
    `)
      await written('fictional-off-barrier')
      await written('fictional-renderer-uncaught')
      await written('fictional-renderer-rejection')
      await written('fictional-error-default-false')
      let text = await written('fictional-rejection-default-false')
      assert.ok(text.includes('fictional-main-marker'))
      assert.ok(text.includes('fictional-renderer-error-off'))
      assert.ok(!text.includes('fictional-debug-off'))
      setDebug(true)
      await window.webContents.executeJavaScript("console.debug('fictional-debug-on')")
      await written('fictional-debug-on')
      setDebug(false)
      await window.webContents.executeJavaScript(`
      console.debug('fictional-debug-disabled-again');
      console.error('fictional-error-disabled-again');
      console.info('fictional-final-barrier');
    `)
      text = await written('fictional-final-barrier')
      assert.ok(text.includes('fictional-error-disabled-again'))
      assert.ok(!text.includes('fictional-debug-disabled-again'))
      assert.deepEqual(await readdir(join(root, 'logs')), ['brocrew.log'])
      process.stdout.write(
        JSON.stringify({ result: 'PASS', file, debug: 'off-on-off', defaultErrorsPreserved: true }) + '\n',
      )
      window.destroy()
      app.exit(0)
    } catch (error) {
      console.error(error)
      window.destroy()
      app.exit(1)
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
