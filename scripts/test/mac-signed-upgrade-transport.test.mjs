import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { Agent, request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { requestFor, startControlledTransport } from '../mac-signed-upgrade-transport.mjs'

const bytes = Buffer.from('candidate disk image bytes')
const names = ['BroCrew-0.2.12-arm64.dmg', 'latest-mac.yml']
const build = { version: '0.2.12', manifest: 'version: 0.2.12\n', names }

test('only the update file, the feed and the release files are served, and nothing else', () => {
  assert.equal(requestFor('brocrew.app', '/update/latest-mac.yml?v=0.2.11', build).kind, 'manifest')
  assert.equal(requestFor('github.com', '/brocrew/brocrew/releases.atom', build).kind, 'atom')
  assert.equal(
    requestFor(
      'github.com',
      '/brocrew/brocrew/releases/download/v0.2.12/BroCrew-0.2.12-arm64.dmg',
      build,
    ).name,
    'BroCrew-0.2.12-arm64.dmg',
  )
  assert.throws(() => requestFor('brocrew.app', '/update/other.dmg', build))
  assert.throws(() =>
    requestFor(
      'github.com',
      '/other/repo/releases/download/v0.2.12/BroCrew-0.2.12-arm64.dmg',
      build,
    ),
  )
})

async function throughProxy(proxy, path) {
  const address = new URL(proxy.address)
  const socket = await new Promise((done, failed) => {
    const request = httpRequest({
      hostname: address.hostname,
      port: address.port,
      method: 'CONNECT',
      path: 'brocrew.app:443',
    })
    request.once('connect', (_response, socket) => done(socket))
    request.once('error', failed)
    request.end()
  })
  const agent = new Agent({ keepAlive: false })
  agent.createConnection = () =>
    tlsConnect({ socket, servername: 'brocrew.app', rejectUnauthorized: false })
  try {
    return await new Promise((done, failed) => {
      const request = httpsRequest({ hostname: 'brocrew.app', path, agent }, (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.once('end', () =>
          done({ status: response.statusCode, body: Buffer.concat(chunks) }),
        )
        response.once('error', failed)
      })
      request.once('error', failed)
      request.end()
    })
  } finally {
    agent.destroy()
    socket.destroy()
  }
}

test('the CONNECT TLS transport serves the update file and the release folder files', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-transport-'))
  let proxy
  try {
    writeFileSync(join(folder, names[0]), bytes)
    proxy = await startControlledTransport({ folder, initial: { ...build, directory: folder } })
    assert.equal(
      (await throughProxy(proxy, '/update/latest-mac.yml?v=0.2.11')).body.toString(),
      build.manifest,
    )
    const asset = await throughProxy(proxy, '/update/BroCrew-0.2.12-arm64.dmg?v=0.2.11')
    assert.deepEqual(asset.body, bytes)
    assert.equal(proxy.requests[1].bytes, bytes.length)
    // The client can read the last byte before the server's stream finishes.
    for (let wait = 0; !proxy.requests[1].completed && wait < 100; wait++)
      await new Promise((done) => setTimeout(done, 10))
    assert.equal(proxy.requests[1].completed, true)
    proxy.requireHealthy()
    assert.equal(JSON.stringify(proxy.requests).includes('?'), false)
    proxy.switchTo({ ...build, version: '0.2.13', manifest: 'version: 0.2.13\n' })
    assert.equal(
      (await throughProxy(proxy, '/update/latest-mac.yml')).body.toString(),
      'version: 0.2.13\n',
    )
  } finally {
    if (proxy) await proxy.close()
    rmSync(folder, { recursive: true })
  }
}, 30_000)

test('a missing release file fails the transport', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-transport-fail-'))
  let proxy
  try {
    proxy = await startControlledTransport({ folder, initial: { ...build, directory: folder } })
    await assert.rejects(throughProxy(proxy, '/update/BroCrew-0.2.12-arm64.dmg'))
    assert.throws(() => proxy.requireHealthy())
    assert.equal(proxy.requests[0].completed, false)
  } finally {
    if (proxy) await proxy.close()
    rmSync(folder, { recursive: true })
  }
}, 30_000)
