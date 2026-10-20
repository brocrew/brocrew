import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { fixtureHtml, fixtureTitle } from './fake-browser.mjs'
import { waitFor } from './cdp.mjs'
import { bounded } from './processes.mjs'
import { providerErrors } from './provider-state.mjs'

// The server never proxies or reads a URL/path from the request.
export async function serveFixture(root) {
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/fern' ? 200 : 404, { 'Content-Type': 'text/html' })
    response.end(request.url === '/fern' ? fixtureHtml : '')
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const url = `http://127.0.0.1:${server.address().port}/fern`
  fs.writeFileSync(path.join(root, 'browser-fixture.json'), JSON.stringify({ url }), {
    mode: 0o600,
  })
  return {
    close: () =>
      new Promise((resolve) => {
        server.close(resolve)
        server.closeAllConnections()
      }),
  }
}
export function safeTabs(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.keys(value).sort().join(',') === 'count,rowPresent,titleCategory' &&
    typeof value.rowPresent === 'boolean' &&
    Number.isInteger(value.count) &&
    value.count >= 0 &&
    value.count <= 200 &&
    ['none', 'fixture', 'other'].includes(value.titleCategory)
  )
}
export async function observeTabs(view) {
  const value = await view.evaluate(`
    const row = document.querySelector('[data-profile="fern"]');
    const tabs = [...(row?.querySelectorAll('.profile-tabs li') ?? [])];
    const titles = tabs.map(tab => tab.querySelector('.tab-title')?.textContent);
    return {rowPresent: Boolean(row), count: tabs.length, titleCategory: tabs.length === 0 ? 'none' :
      titles.every(title => title === ${JSON.stringify(fixtureTitle)}) ? 'fixture' : 'other'};
  `)
  if (!safeTabs(value)) throw new Error('Unsafe tab observation')
  return value
}
export async function waitTabs(view, count, wait = waitFor) {
  await wait(async () => {
    const value = await observeTabs(view)
    return (
      value.rowPresent &&
      value.count === count &&
      value.titleCategory === (count ? 'fixture' : 'none')
    )
  }, 20000)
  return observeTabs(view)
}
export async function createProviderTurn(run, cwd, { deadline = 60000, wait = waitFor } = {}) {
  const evaluate = (body) => bounded(run.cdp.evaluate(body), deadline)
  const sessionId = await evaluate(`
    const created = await window.api.runtime.createSession({provider:'claude', approvalMode:'auto',
      model:'fake-claude-a', cwd:${JSON.stringify(cwd)}});
    return created.sessionId;
  `)
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('Fixture session absent')
  const progress = { started: true, returned: false }
  return {
    progress,
    async turn(text, expected) {
      progress.returned = false
      progress.errorCategory = 'bridge'
      try {
        // This is the normal window-owned person-turn door; no host or broker bypass.
        await evaluate(
          `await window.api.runtime.send({sessionId:${JSON.stringify(sessionId)}, text:${JSON.stringify(text)}}); return true`,
        )
        await bounded(
          wait(
            () =>
              evaluate(`
          const history = await window.api.runtime.latestHistory({sessionId:${JSON.stringify(sessionId)}});
          return history.entries.some(entry => entry.event.type === 'assistant_message' &&
            entry.event.text === ${JSON.stringify('echo: ' + expected)});
        `),
            20000,
          ),
          deadline,
        )
        progress.returned = true
        progress.errorCategory = 'other'
      } catch (error) {
        progress.errorCategory = ['Packaged gate timed out', 'Owned process deadline'].includes(
          error?.message,
        )
          ? 'timeout'
          : 'bridge'
        throw error
      }
    },
    close: () =>
      bounded(
        evaluate(
          `await window.api.runtime.close({sessionId:${JSON.stringify(sessionId)}});return true`,
        ),
        5000,
      ),
  }
}
export function browserEvidence(root, read) {
  let proof = {}
  try {
    proof = JSON.parse(read(path.join(root, 'provider-proof.json')))
  } catch {
    /* No completed provider observation yet. */
  }
  const receipts = fs.readdirSync(root).filter((name) => /^cdp-\d+\.json$/.test(name))
  let navigations = 0,
    evaluations = 0,
    closedTabs = 0,
    unsupportedCommands = 0
  for (const name of receipts) {
    const record = JSON.parse(read(path.join(root, name)))
    for (const key of [
      'navigations',
      'evaluations',
      'closedTabs',
      'rejectedNavigations',
      'unsupportedCommands',
    ])
      if (!Number.isSafeInteger(record[key]) || record[key] < 0)
        throw new Error('Invalid browser proof')
    navigations += record.navigations
    evaluations += record.evaluations
    closedTabs += record.closedTabs
    unsupportedCommands += record.unsupportedCommands
  }
  return {
    agentStarted: proof.agentStarted === true,
    turnSent: proof.turnSent === true,
    toolCalled: proof.toolCalled === true,
    homePrepared: fs.existsSync(path.join(root, 'fake-provider-home-ready.json')),
    routeReady: proof.routeReady === true,
    toolOpened: proof.opened === true,
    toolRead: proof.read === true,
    titleReturned: proof.titleReturned === true,
    toolClosed: proof.closed === true,
    calls: Number.isSafeInteger(proof.calls) && proof.calls >= 0 ? proof.calls : 0,
    navigations,
    evaluations,
    closedTabs,
    unsupportedCommands,
  }
}

export function providerErrorCategory(root, read) {
  try {
    const value = JSON.parse(read(path.join(root, 'provider-proof.json'))).errorCategory
    return providerErrors.includes(value) ? value : 'other'
  } catch {
    return 'other'
  }
}
