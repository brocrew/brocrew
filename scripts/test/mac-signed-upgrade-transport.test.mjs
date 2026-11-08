import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { request as httpRequest } from 'node:http'
import { Agent, request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import {
  requestFor,
  githubAssetBody,
  startControlledTransport,
} from '../mac-signed-upgrade-transport.mjs'

const bytes = Buffer.from('sealed GitHub candidate bytes')
const seal = {
  name: 'BroCrew-0.2.12-arm64.dmg',
  assetId: 7,
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
    ).seal.assetId,
    7,
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

test('draft auth goes only to GitHub API and the temporary redirect never enters output', async () => {
  const calls = []
  const body = await githubAssetBody(7, 'fictional-token', async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1)
      return new Response(null, {
        status: 302,
        headers: {
          location:
            'https://release-assets.githubusercontent.com/github-production-release-asset/7?fictional-secret=never-log',
        },
      })
    return new Response(bytes)
  })
  assert.equal(await body.text(), bytes.toString())
  assert.equal(calls[0].options.headers.authorization, 'Bearer fictional-token')
  assert.equal(calls[1].options.headers, undefined)
  assert.equal(calls[1].options.redirect, 'error')
  for (const location of [
    'http://release-assets.githubusercontent.com/asset',
    'https://attacker.example/asset',
  ])
    await assert.rejects(
      githubAssetBody(
        7,
        'fictional-token',
        async () => new Response(null, { status: 302, headers: { location } }),
      ),
    )
  await assert.rejects(
    githubAssetBody(7, 'fictional-token', async () => {
      throw new Error('https://secret.example/?token=secret')
    }),
    (error) => !error.message.includes('secret'),
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

test('actual CONNECT TLS transport serves metadata and hashes real streamed asset bytes', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-transport-'))
  let proxy
  try {
    proxy = await startControlledTransport({
      folder,
      initial: build,
      token: 'fictional-token',
      upstream: async (id, token) => {
        assert.equal(id, 7)
        assert.equal(token, 'fictional-token')
        return new Response(bytes)
      },
    })
    assert.equal(
      (await throughProxy(proxy, '/update/latest-mac.yml?v=0.2.11')).body.toString(),
      build.manifest,
    )
    const asset = await throughProxy(proxy, '/update/BroCrew-0.2.12-arm64.dmg?v=0.2.11')
    assert.deepEqual(asset.body, bytes)
    assert.equal(proxy.requests[1].sha256, seal.sha256)
    assert.equal(proxy.requests[1].completed, true)
    proxy.requireHealthy()
    assert.equal(JSON.stringify(proxy.requests).includes('fictional-token'), false)
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

test('streamed wrong candidate bytes fail the transport without leaking an upstream URL', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'signed-upgrade-transport-fail-'))
  let proxy
  try {
    proxy = await startControlledTransport({
      folder,
      initial: build,
      token: 'fictional-token',
      upstream: async () => new Response(Buffer.from('wrong')),
    })
    await assert.rejects(throughProxy(proxy, '/update/BroCrew-0.2.12-arm64.dmg'))
    assert.throws(() => proxy.requireHealthy())
    assert.equal(proxy.requests[0].completed, false)
    assert.equal(JSON.stringify(proxy.requests).includes('fictional-token'), false)
  } finally {
    if (proxy) await proxy.close()
    rmSync(folder, { recursive: true })
  }
}, 30_000)
