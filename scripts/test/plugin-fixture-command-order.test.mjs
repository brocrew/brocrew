import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { fixtureHtml } from '../gates/plugin-packaged/fake-browser.mjs'

const children = []
const roots = []
const servers = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const closed = new Promise((resolve) => child.once('close', resolve))
    child.kill('SIGTERM')
    await closed
  }
  for (const server of servers.splice(0)) await new Promise((resolve) => server.close(resolve))
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

async function pipeFixture(url = 'http://127.0.0.1:1234/fern') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fern-order-'))
  roots.push(root)
  fs.writeFileSync(path.join(root, 'browser-fixture.json'), JSON.stringify({ url }))
  const source = `import {runBrowser} from ${JSON.stringify(new URL('../gates/plugin-packaged/fake-browser.mjs', import.meta.url).href)};runBrowser(${JSON.stringify(root)});`
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  const frames = []
  const waiting = new Map()
  let input = ''
  child.stdio[4].on('data', (bytes) => {
    input += bytes.toString()
    let end
    while ((end = input.indexOf('\0')) !== -1) {
      const frame = JSON.parse(input.slice(0, end))
      input = input.slice(end + 1)
      frames.push(frame)
      const done = waiting.get(frame.id)
      if (done) {
        waiting.delete(frame.id)
        done.resolve(frame)
      }
    }
  })
  const failed = (error) => {
    for (const done of waiting.values()) done.reject(error)
    waiting.clear()
  }
  child.once('error', failed)
  child.once('exit', (code, signal) => failed(new Error(`Fixture exited: ${code}/${signal}`)))
  function response(id) {
    const held = frames.find((frame) => frame.id === id)
    if (held) return Promise.resolve(held)
    if (child.exitCode !== null || child.signalCode !== null)
      return Promise.reject(new Error('Fixture already exited'))
    return new Promise((resolve, reject) => waiting.set(id, { resolve, reject }))
  }
  const send = (...messages) =>
    child.stdio[3].write(messages.map((message) => JSON.stringify(message) + '\0').join(''))
  send({ id: 1, method: 'Target.setAutoAttach', params: {} })
  await response(1)
  const sessionId = frames.find((frame) => frame.method === 'Target.attachedToTarget').params
    .sessionId
  return { frames, response, send, sessionId }
}

function expectEarlierResponse(fixture, eventAt) {
  const order = fixture.frames.map((frame) =>
    frame.id === undefined
      ? `${frame.method}@${frame.params?.timestamp ?? ''}`
      : `reply:${frame.id}`,
  )
  const responseAt = fixture.frames.findIndex((frame) => frame.id === 2)
  expect(responseAt).toBeGreaterThanOrEqual(0)
  expect(eventAt).toBeGreaterThanOrEqual(0)
  expect(responseAt, JSON.stringify(order)).toBeLessThan(eventAt)
}

describe.skipIf(process.platform === 'win32')('fixture pipe command order', () => {
  it('answers the frame tree before lifecycle events from the next coalesced command', async () => {
    const fixture = await pipeFixture()
    fixture.send(
      { id: 2, method: 'Page.getFrameTree', sessionId: fixture.sessionId },
      { id: 3, method: 'Runtime.runIfWaitingForDebugger', sessionId: fixture.sessionId },
    )
    await fixture.response(3)
    expectEarlierResponse(
      fixture,
      fixture.frames.findIndex((frame) => frame.method === 'Page.lifecycleEvent'),
    )
  })

  it('keeps a later data callback behind an asynchronous navigation response', async () => {
    let reply
    let arrived
    const requested = new Promise((resolve) => {
      arrived = resolve
    })
    const server = createServer((_, response) => {
      reply = () => response.end(fixtureHtml)
      arrived()
    })
    servers.push(server)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/fern`
    const fixture = await pipeFixture(url)
    fixture.send({ id: 2, method: 'Page.navigate', params: { url }, sessionId: fixture.sessionId })
    await requested
    fixture.send({ id: 3, method: 'Runtime.runIfWaitingForDebugger', sessionId: fixture.sessionId })
    reply()
    await fixture.response(3)
    expectEarlierResponse(
      fixture,
      fixture.frames.findIndex(
        (frame) => frame.method === 'Page.lifecycleEvent' && frame.params.timestamp === 1,
      ),
    )
  })

  it('keeps the same ordering when the caller waits between commands', async () => {
    const fixture = await pipeFixture()
    fixture.send({ id: 2, method: 'Page.getFrameTree', sessionId: fixture.sessionId })
    await fixture.response(2)
    fixture.send({ id: 3, method: 'Runtime.runIfWaitingForDebugger', sessionId: fixture.sessionId })
    await fixture.response(3)
    expectEarlierResponse(
      fixture,
      fixture.frames.findIndex((frame) => frame.method === 'Page.lifecycleEvent'),
    )
  })
})
