import path from 'node:path'
import { demand, readFile } from './contract.mjs'
import { startApp, quit, bounded } from './processes.mjs'
import { waitFor } from '../plugin-packaged/cdp.mjs'
import { assertMainAppBehavior } from './reload-source/contract.mjs'

export async function reloadJourney({ root, app, records }) {
  const token = readFile(path.join(root, 'gate-token'), 64).toString()
  const workspace = path.join(root, 'reload-workspace')
  let run
  try {
    run = await startApp({
      root,
      app,
      records,
      workspace,
      global: path.join(root, 'reload-global'),
    })
    const control = (op) =>
      run.cdp.evaluate(
        `return await window.__pluginReloadGate.command(${JSON.stringify(op)},${JSON.stringify(token)})`,
      )
    // Known refusal must come from our nonce/op handler, before the controller receives it.
    for (const [op, nonce] of [
      ['arm', '0'.repeat(64)],
      ['unrecognised', token],
    ]) {
      demand(
        await run.cdp.evaluate(
          `try{await window.__pluginReloadGate.command(${JSON.stringify(op)},${JSON.stringify(nonce)});return false}catch(e){return String(e).includes('plugin-reload-main-app-gate-only')}`,
        ),
      )
    }
    demand(
      await run.cdp.evaluate(`
   const created=await window.api.runtime.createSession({provider:'claude',approvalMode:'ask',model:'fake-claude-a',cwd:${JSON.stringify(workspace)}});
   if(typeof created.sessionId!=='string'||!created.sessionId)throw new Error('Missing dedicated session');
   window.__reloadDriverState={sessionId:created.sessionId,promises:[],settled:[]};return true;`),
    )
    const armed = await control('arm')
    demand(armed.phase === 'armed' && armed.queryCount === 1)
    const send = async (text) => {
      demand(
        await run.cdp.evaluate(`
    const s=window.__reloadDriverState,i=s.promises.length;s.settled.push('pending');
    const actual=window.api.runtime.send({sessionId:s.sessionId,text:${JSON.stringify(text)}});
    s.promises.push(actual.then(()=>{s.settled[i]='resolved'},()=>{s.settled[i]='rejected'}));return true;`),
      )
    }
    const pending = async (count) =>
      demand(
        await run.cdp.evaluate(
          `const s=window.__reloadDriverState;return s.promises.length===${count}&&s.settled.every(v=>v==='pending')`,
        ),
      )
    await send('reload original fern')
    let status
    await waitFor(async () => {
      status = await control('status')
      return status.phase === 'retiring-held'
    }, 20000)
    demand(
      status.queryCount === 1 &&
        status.oldReloads === 1 &&
        status.oldCloses === 1 &&
        status.oldReturns === 1 &&
        status.oldPushes === 0 &&
        status.failedTerminals === 1 &&
        status.retiring === true,
    )
    await pending(1)
    await send('reload queued birch')
    await waitFor(async () => {
      status = await control('status')
      return status.arrivalTailChanges === 1
    }, 5000)
    await pending(2)
    await send('reload queued cedar')
    await waitFor(async () => {
      status = await control('status')
      return status.arrivalTailChanges === 2
    }, 5000)
    await pending(3)
    status = await control('releaseReload')
    demand(
      status.phase === 'reload-released' &&
        status.oldPushes === 0 &&
        status.queryCount === 1 &&
        status.failedTerminals === 1 &&
        status.completedTerminals === 0,
    )
    await pending(3)
    status = await control('releaseRetirement')
    demand(status.phase === 'retirement-released')
    demand(
      await bounded(
        run.cdp.evaluate(
          `const s=window.__reloadDriverState;await Promise.all(s.promises);return s.promises.length===3&&s.settled.every(v=>v==='resolved')`,
        ),
        30000,
      ),
    )
    console.error('Reload status before receipt:', JSON.stringify(await control('status')))
    let behavior
    try {
      behavior = assertMainAppBehavior(await bounded(control('receipt'), 30000))
    } catch (error) {
      try {
        console.error(
          'Reload status after receipt failure:',
          JSON.stringify(await control('status')),
        )
      } catch (statusError) {
        console.error('Reload status readback failed:', statusError?.stack ?? String(statusError))
      }
      throw error
    }
    await quit(run)
    run = undefined
    const db = JSON.parse(readFile(path.join(root, 'reload-native-db-closed.json'), 4096))
    demand(
      Object.keys(db).sort().join(',') === 'closed,schema,token' &&
        db.schema === 1 &&
        db.closed === true &&
        db.token === token,
    )
    return {
      behavior,
      nativeIpc: {
        createdViaNormalPreload: true,
        threeRealSends: true,
        sampledDistinctActualArrivals: true,
        threePendingBeforeExit: true,
        threeResolvedAfterExit: true,
        nonceAndOpRefused: true,
      },
      nativeDatabaseClosed: true,
      nativeAppClosed: true,
    }
  } finally {
    if (run) await quit(run)
  }
}
