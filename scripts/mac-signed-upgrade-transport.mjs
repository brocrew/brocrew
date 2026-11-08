import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, X509Certificate } from 'node:crypto'
import { requireEvidence } from './lib/mac-update-test.mjs'

const controlledHosts = new Set(['brocrew.app', 'github.com', 'api.github.com'])

export function requestFor(host, path, build) {
  const url = new URL(path, `https://${host}`)
  if (host === 'brocrew.app' && url.pathname === '/update/latest-mac.yml')
    return { kind: 'manifest' }
  if (host === 'github.com' && url.pathname === '/brocrew/brocrew/releases.atom')
    return { kind: 'atom' }
  if (host === 'api.github.com' && url.pathname === '/repos/brocrew/brocrew/releases/latest')
    return { kind: 'release' }
  if (
    host === 'github.com' &&
    url.pathname === `/brocrew/brocrew/releases/download/v${build.version}/latest-mac.yml`
  )
    return { kind: 'manifest' }
  const name =
    host === 'brocrew.app' && url.pathname.startsWith('/update/')
      ? decodeURIComponent(url.pathname.slice('/update/'.length))
      : host === 'github.com' &&
          url.pathname.startsWith(`/brocrew/brocrew/releases/download/v${build.version}/`)
        ? decodeURIComponent(url.pathname.split('/').at(-1))
        : null
  const seal = build.files.find((file) => file.name === name)
  requireEvidence(
    seal && seal.name !== 'latest-mac.yml',
    'Controlled transport received an unexpected request.',
  )
  return { kind: 'asset', seal }
}

function atomFor(version) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>brocrew-proof</id><title>Controlled candidate</title><updated>2026-11-08T00:00:00Z</updated><entry><id>v${version}</id><title>Controlled candidate ${version}</title><updated>2026-11-08T00:00:00Z</updated><link href="https://github.com/brocrew/brocrew/releases/tag/v${version}"/><content>Controlled transport fixture</content></entry></feed>`
}

// Authentication and the temporary download URL remain outside the app and every receipt.
export async function githubAssetBody(assetId, token, fetcher = fetch) {
  requireEvidence(
    Number.isSafeInteger(assetId) && assetId > 0 && token,
    'A draft GitHub asset binding is missing.',
  )
  const redirect = await fetcher(
    `https://api.github.com/repos/brocrew/brocrew/releases/assets/${assetId}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/octet-stream',
        'x-github-api-version': '2022-11-28',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(60_000),
    },
  ).catch(() => {
    throw new Error('GitHub draft asset redirect request failed.')
  })
  const location = redirect.headers.get('location')
  if (!(redirect.status >= 300 && redirect.status < 400 && location))
    throw Object.assign(new Error('GitHub did not supply a draft asset redirect.'), {
      upstreamStatus: redirect.status,
    })
  const url = new URL(location)
  requireEvidence(
    url.protocol === 'https:' &&
      url.hostname === 'release-assets.githubusercontent.com' &&
      !url.username &&
      !url.password,
    'GitHub draft asset redirect origin differs.',
  )
  const response = await fetcher(url.href, {
    redirect: 'error',
    signal: AbortSignal.timeout(600_000),
  }).catch(() => {
    throw new Error('GitHub draft asset body request failed.')
  })
  if (!(response.ok && response.body))
    throw Object.assign(new Error('GitHub draft asset body was unavailable.'), {
      upstreamStatus: response.status,
    })
  return response
}

export async function startControlledTransport({
  folder,
  initial,
  token,
  upstream = githubAssetBody,
}) {
  let build = initial
  const requests = [],
    failures = [],
    sockets = new Set()
  const exec = promisify(execFile)
  const keyPath = join(folder, 'transport.key'),
    certPath = join(folder, 'transport.crt')
  await exec('/usr/bin/openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=BroCrew controlled update transport',
    '-addext',
    'subjectAltName=DNS:brocrew.app,DNS:github.com,DNS:api.github.com',
    '-keyout',
    keyPath,
    '-out',
    certPath,
  ])
  const key = await readFile(keyPath),
    cert = await readFile(certPath)
  const spki = createHash('sha256')
    .update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64')
  await rm(keyPath)
  await rm(certPath)
  const https = createHttpsServer({ key, cert }, async (request, response) => {
    const record = {
      host: request.headers.host,
      path: request.url.split('?')[0],
      method: request.method,
      version: build.version,
      completed: false,
    }
    requests.push(record)
    try {
      requireEvidence(request.method === 'GET', 'Controlled feed received a non-GET request.')
      const route = requestFor(request.headers.host, request.url, build)
      record.kind = route.kind
      if (route.kind === 'manifest') {
        response.writeHead(200, { 'content-type': 'text/yaml', 'cache-control': 'no-store' })
        response.end(build.manifest)
      } else if (route.kind === 'atom') {
        response.writeHead(200, {
          'content-type': 'application/atom+xml',
          'cache-control': 'no-store',
        })
        response.end(atomFor(build.version))
      } else if (route.kind === 'release') {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ tag_name: `v${build.version}` }))
      } else {
        const seal = route.seal
        const body = await upstream(seal.assetId, token)
        const sha256 = createHash('sha256'),
          sha512 = createHash('sha512')
        let bytes = 0
        record.name = seal.name
        record.assetId = seal.assetId
        record.upstream = 'GitHub release asset; redirect kept only in memory'
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': seal.size,
          'cache-control': 'no-store',
        })
        for await (const chunk of body.body) {
          bytes += chunk.length
          sha256.update(chunk)
          sha512.update(chunk)
          if (!response.write(chunk))
            await new Promise((done, failed) => {
              const drained = () => {
                response.off('close', closed)
                done()
              }
              const closed = () => {
                response.off('drain', drained)
                failed(new Error('App closed the controlled download.'))
              }
              response.once('drain', drained)
              response.once('close', closed)
            })
        }
        record.bytes = bytes
        record.sha256 = sha256.digest('hex')
        record.sha512 = sha512.digest('base64')
        requireEvidence(
          bytes === seal.size && record.sha256 === seal.sha256 && record.sha512 === seal.sha512,
          'GitHub draft asset bytes differ from sealed candidate.',
        )
        response.end()
      }
      record.completed = true
    } catch (error) {
      // Neither an upstream exception nor a temporary URL is suitable artifact content.
      record.failure = 'Controlled update transport failed; no later proof stage is valid.'
      if (Number.isInteger(error.upstreamStatus)) record.upstreamStatus = error.upstreamStatus
      failures.push(record.failure)
      if (!response.headersSent) response.writeHead(502)
      response.destroy()
    }
  })
  https.on('tlsClientError', () => {
    failures.push('Controlled TLS handshake failed.')
  })
  const proxy = createServer((_request, response) => response.writeHead(502).end())
  proxy.on('connect', (request, socket, head) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const [host, port] = request.url.split(':')
    if (controlledHosts.has(host) && port === '443') {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) socket.unshift(head)
      https.emit('connection', socket)
    } else {
      // Unrelated HTTPS retains its normal end-to-end TLS and server certificate.
      const remote = connect(Number(port), host, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length) remote.write(head)
        socket.pipe(remote).pipe(socket)
      })
      remote.once('error', () => socket.destroy())
      socket.once('error', () => remote.destroy())
      socket.once('close', () => remote.destroy())
    }
  })
  await new Promise((done, failed) => {
    proxy.once('error', failed)
    proxy.listen(0, '127.0.0.1', done)
  })
  const address = `http://127.0.0.1:${proxy.address().port}`
  return {
    address,
    spki,
    requests,
    failures,
    switchTo(next) {
      build = next
    },
    requireHealthy() {
      requireEvidence(failures.length === 0, failures.join(' '))
    },
    async close() {
      for (const socket of sockets) socket.destroy()
      await new Promise((done) => proxy.close(done))
    },
  }
}
