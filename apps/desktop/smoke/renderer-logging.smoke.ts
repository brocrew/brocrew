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
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'fictional-window-error',
        filename: 'https://fiction.invalid/modules/window.js?example=1#origin',
        lineno: 12,
        colno: 5,
        cancelable: true,
      }));
      const stackless = new Error('fictional-stackless-error');
      stackless.stack = undefined;
      window.dispatchEvent(new ErrorEvent('error', {
        error: stackless,
        filename: 'https://fiction.invalid/modules/stackless.js',
        lineno: 24,
        colno: 8,
        cancelable: true,
      }));
      setTimeout(function fictionalThrow() { throw new Error('fictional-renderer-uncaught') }, 0);
      function fictionalReject() {
        void Promise.reject(new Error('fictional-renderer-rejection'));
      }
      fictionalReject();
      void Promise.reject();
      void Promise.reject('fictional-renderer-string-reason');
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
      const errorLines = text.split(/\r?\n/).filter((line) => /^\[.*?\] \[error\]/.test(line))
      const rendererErrors = errorLines.filter((line) => line.includes('(renderer-error)'))
      for (const expected of [
        'error reason=undefined at https://fiction.invalid/modules/window.js?example=1#origin:12:5: fictional-window-error',
        'error reason=Error at https://fiction.invalid/modules/stackless.js:24:8: fictional-stackless-error',

        'unhandledrejection reason=undefined origin=unavailable',
        'unhandledrejection reason=string: fictional-renderer-string-reason',
        'unhandledrejection reason=Error: fictional-renderer-rejection',
      ]) {
        assert.equal(
          rendererErrors.filter((line) => line.split('(renderer-error)')[1]?.trim() === expected)
            .length,
          1,
          expected,
        )
      }
      assert.equal(
        rendererErrors.filter((line) =>
          /\(renderer-error\)\s+error reason=Error at .+: Uncaught Error: fictional-renderer-uncaught$/.test(
            line,
          ),
        ).length,
        1,
      )
      assert.equal(rendererErrors.length, 6)
      assert.equal(errorLines.length, 8, 'six browser events and two explicit console errors')
      assert.match(text, /fictional-renderer-uncaught[^\n]*\r?\n\s+at fictionalThrow\b/)
      assert.match(text, /fictional-renderer-rejection[^\n]*\r?\n\s+at fictionalReject\b/)
      assert.equal(text.match(/fictional-error-default-false/g)?.length, 3)
      assert.equal(text.match(/fictional-rejection-default-false/g)?.length, 3)
      assert.doesNotMatch(text, /fictional-(?:error|rejection)-default-true/)
      assert.deepEqual(await readdir(join(root, 'logs')), ['brocrew.log'])
      process.stdout.write(
        JSON.stringify({
          result: 'PASS',
          file,
          debug: 'off-on-off',
          defaultErrorsPreserved: true,
        }) + '\n',
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
