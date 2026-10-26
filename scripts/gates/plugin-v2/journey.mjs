import fs from 'node:fs'
import path from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { press } from '../../lib/update-rehearsal-app.mjs'
import { openPlugins, pluginPage, waitFor } from '../plugin-packaged/cdp.mjs'
import { demand, readFile } from './contract.mjs'
import { startApp, quit, samples } from './processes.mjs'

const selector = (id, cy) => `[data-plugin="${id}"] [data-cy="${cy}"]`
async function cards(run) {
  const answer = await run.cdp.evaluate(`return await window.api.plugins.request({kind:'list'})`)
  demand(answer?.ok && Array.isArray(answer.cards))
  return answer.cards
}
async function state(run, id, wanted) {
  let selected
  await waitFor(async () => {
    selected = (await cards(run)).find((c) => c.id === id)
    return selected?.installed === wanted && (!wanted || selected.state === 'Running')
  }, 200000)
  return selected
}
export function assertAccessLabels(shown, resources) {
  const labels = resources.map(
    (r) =>
      `${r.label}: ${r.read ? (r.write ? 'Read, Write' : 'Read') : r.write ? 'Write' : 'No access'}`,
  )
  demand(
    Array.isArray(shown) && shown.length === labels.length && new Set(shown).size === shown.length,
  )
  demand(isDeepStrictEqual([...shown].sort(), labels.sort()))
}
async function visibleReview(run, id, expected) {
  await press(run.cdp, selector(id, 'plugin-review-install'))
  let shown
  await waitFor(async () => {
    shown = await run.cdp.evaluate(`
   const box=document.querySelector(${JSON.stringify(selector(id, 'plugin-review-details'))});
   return box?{bdi:[...box.querySelectorAll('bdi')].map(e=>e.textContent.trim()),
     resources:[...box.querySelectorAll('li')].map(e=>e.textContent.trim()),
     confirm:!!box.querySelector('[data-cy="plugin-review-confirm"]:not(:disabled)')}:null;`)
    return shown?.confirm === true
  }, 60000)
  demand(shown.bdi[0] === expected.version && shown.bdi[1] === expected.authors.join(', '))
  demand(shown.bdi[2] === expected.permissions.description)
  assertAccessLabels(shown.resources, expected.permissions.resources)
}
async function configure(run, id) {
  await press(run.cdp, selector(id, 'plugin-configure'))
  const page = await pluginPage(run.port)
  try {
    if (id === 'whatsapp')
      await waitFor(
        () =>
          page.evaluate(`
    const shown=id=>{const e=document.getElementById(id);return !!e&&!e.hidden};
    return document.getElementById('status')?.textContent==='Not linked.'&&shown('link-phone')&&
      !shown('pairing')&&!shown('account')&&document.getElementById('read')?.disabled===false;`),
        60000,
      )
    else
      await waitFor(
        () =>
          page.evaluate(
            `return !!document.getElementById('profiles')&&!!document.getElementById('create')`,
          ),
        60000,
      )
  } finally {
    page.close()
    await press(run.cdp, '[data-cy="plugin-close"]')
  }
}
export async function journey(options, summary) {
  const { root, global, records } = options
  const expected = JSON.parse(readFile(path.join(root, 'expected.json')))
  let run = await startApp({ ...options, workspace: path.join(root, 'workspace') })
  try {
    await openPlugins(run.cdp)
    demand((await cards(run)).every((c) => c.installed === false))
    for (const id of ['chrome', 'whatsapp']) {
      const p = (summary.plugins[id] = {})
      const before = (await samples(global, records, root))
        .map((r) => r.pid)
        .sort()
        .join(',')
      await visibleReview(run, id, expected[id])
      p.review = true
      await press(run.cdp, selector(id, 'plugin-review-cancel'))
      demand((await state(run, id, false)).installed === false)
      demand(
        (await samples(global, records, root))
          .map((r) => r.pid)
          .sort()
          .join(',') === before,
      )
      p.cancelZeroInstalls = true
      // A separate NEGATIVE bridge exercise; successful installation below is UI-only.
      const negative = await run.cdp.evaluate(`
    const r=await window.api.plugins.request({kind:'prepare',action:'install',id:${JSON.stringify(id)}});
    if(!r.ok||!r.review)throw new Error('Missing native review');
    const details=r.review.details;
    await window.api.plugins.request({kind:'list'});
    const refused=await window.api.plugins.request({kind:'install',id:${JSON.stringify(id)},consent:r.review.consent});
    return {details,refused:refused.ok===false&&refused.mutationFailure==='policy-refused'};`)
      demand(negative.refused && isDeepStrictEqual(negative.details, expected[id]))
      demand((await state(run, id, false)).installed === false)
      demand(
        (await samples(global, records, root))
          .map((r) => r.pid)
          .sort()
          .join(',') === before,
      )
      p.staleRefused = true
      p.nativeDetailsMatched = true
      await visibleReview(run, id, expected[id])
      await press(run.cdp, selector(id, 'plugin-review-confirm'))
      p.confirmed = true
      // A list request itself invalidates consent. Wait passively for the UI handler to finish
      // before polling the normal list API, or the test would revoke its own accepted review.
      await waitFor(
        () =>
          run.cdp.evaluate(`
    const c=document.querySelector('[data-plugin="${id}"]');
    return !!c&&c.textContent.includes('Installed for all workspaces.')&&c.textContent.includes('Running')&&
      !c.querySelector('[data-cy="plugin-starting"]');`),
        240000,
      )
      const c = await state(run, id, true)
      demand(c.installedVersion === expected[id].version)
      p.running = true
      if (id === 'whatsapp') {
        const rows = await samples(global, records, root)
        demand(rows.filter((r) => /whatsapp-bridge/i.test(r.name)).length === 1)
        p.bridgeObserved = true
      }
    }
    fs.writeFileSync(path.join(root, 'list-mode'), 'empty')
    await quit(run)
    run = await startApp({ ...options, workspace: path.join(root, 'workspace') })
    await openPlugins(run.cdp)
    for (const id of ['chrome', 'whatsapp']) await state(run, id, true)
    const empty = await cards(run)
    for (const id of ['chrome', 'whatsapp']) {
      const c = empty.find((c) => c.id === id)
      demand(c?.installed === true && c.updatesUnavailable === true)
      const refused = await run.cdp.evaluate(
        `return await window.api.plugins.request({kind:'prepare',action:'update',id:${JSON.stringify(id)}})`,
      )
      demand(refused.ok === false)
      summary.plugins[id].emptyManaged = true
      await configure(run, id)
      summary.plugins[id].configured = true
      await press(run.cdp, selector(id, 'plugin-uninstall'))
      await press(run.cdp, '[data-cy="plugin-uninstall-confirm"]')
      await waitFor(async () => !(await cards(run)).find((c) => c.id === id)?.installed, 90000)
      summary.plugins[id].removed = true
    }
  } finally {
    await quit(run)
  }
}
