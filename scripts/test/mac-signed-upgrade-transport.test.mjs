import { test, vi } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { Agent, request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { requestFor, startControlledTransport } from '../mac-signed-upgrade-transport.mjs'

const bytes = Buffer.from('sealed original Release artifact bytes')
const seal = {
  name: 'BroCrew-0.2.12-arm64.dmg',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sha512: createHash('sha512').update(bytes).digest('base64'),
}
const build = { version: '0.2.12', manifest: 'version: 0.2.12\n', files: [seal] }

test('only real metadata and sealed asset URLs are mapped, with query values omitted from receipts', () => {
  assert.equal(requestFor('brocrew.app', '/update/latest-mac.yml?v=0.2.11', build).kind, 'manifest')
  assert.equal(requestFor('github.com', '/brocrew/brocrew/releases.atom', build).kind, 'atom')
  assert.equal(
    requestFor(
      'github.com',
      '/brocrew/brocrew/releases/download/v0.2.12/BroCrew-0.2.12-arm64.dmg',
      build,
    ).seal.name,
    seal.name,
  )
  assert.throws(() => requestFor('brocrew.app', '/update/unsealed.dmg', build))
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

test('actual CONNECT TLS transport serves original artifact bytes without a token or draft request', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-artifact-transport-'))
  writeFileSync(join(folder, seal.name), bytes)
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('No draft, redirect or network fallback is permitted.')
  })
  let proxy
  try {
    proxy = await startControlledTransport({ folder, initial: { ...build, directory: folder } })
    assert.equal(
      (await throughProxy(proxy, '/update/latest-mac.yml?v=0.2.11')).body.toString(),
      build.manifest,
    )
    const asset = await throughProxy(proxy, '/update/BroCrew-0.2.12-arm64.dmg?v=0.2.11')
    assert.deepEqual(asset.body, bytes)
    assert.equal(proxy.requests[1].sha256, seal.sha256)
    assert.equal(proxy.requests[1].sha512, seal.sha512)
    assert.equal(proxy.requests[1].bytes, seal.size)
    assert.equal(proxy.requests[1].upstream, 'sealed original Release artifact')
    assert.equal(proxy.requests[1].completed, true)
    proxy.requireHealthy()
    assert.equal(network.mock.calls.length, 0)
    assert.equal(JSON.stringify(proxy.requests).includes('?'), false)
    assert.equal(JSON.stringify(proxy.requests).includes(folder), false)
    proxy.switchTo({
      ...build,
      directory: folder,
      version: '0.2.13',
      manifest: 'version: 0.2.13\n',
    })
    assert.equal(
      (await throughProxy(proxy, '/update/latest-mac.yml')).body.toString(),
      'version: 0.2.13\n',
    )
  } finally {
    if (proxy) await proxy.close()
    network.mockRestore()
    rmSync(folder, { recursive: true })
  }
}, 30_000)

test('changed original artifact bytes fail closed without a draft or network fallback', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-artifact-wrong-'))
  writeFileSync(join(folder, seal.name), Buffer.alloc(bytes.length, 0))
  const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
    throw new Error('No network fallback is permitted.')
  })
  let proxy
  try {
    proxy = await startControlledTransport({ folder, initial: { ...build, directory: folder } })
    await assert.rejects(throughProxy(proxy, '/update/BroCrew-0.2.12-arm64.dmg'))
    assert.throws(() => proxy.requireHealthy())
    assert.equal(proxy.requests[0].completed, false)
    assert.equal(JSON.stringify(proxy.requests).includes(folder), false)
    assert.equal(network.mock.calls.length, 0)
  } finally {
    if (proxy) await proxy.close()
    network.mockRestore()
    rmSync(folder, { recursive: true })
  }
}, 30_000)

test('a substituted linked artifact file cannot supply a controlled download', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-artifact-link-'))
  writeFileSync(join(folder, 'other-file'), bytes)
  symlinkSync(join(folder, 'other-file'), join(folder, seal.name))
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
