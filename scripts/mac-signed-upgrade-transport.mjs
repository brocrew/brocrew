import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect } from 'node:net'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createReadStream } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
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
  requireEvidence(
    build.names.includes(name) && name !== 'latest-mac.yml',
    'Controlled transport received an unexpected request.',
  )
  return { kind: 'asset', name }
}

function atomFor(version) {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><id>brocrew-proof</id><title>Controlled candidate</title><updated>2026-11-08T00:00:00Z</updated><entry><id>v${version}</id><title>Controlled candidate ${version}</title><updated>2026-11-08T00:00:00Z</updated><link href="https://github.com/brocrew/brocrew/releases/tag/v${version}"/><content>Controlled transport fixture</content></entry></feed>`
}

export async function startControlledTransport({ folder, initial }) {
  let build = initial
  const requests = [],
    failures = [],
    sockets = new Set()
  const exec = promisify(execFile)
  const keyPath = join(folder, 'transport.key'),
    certPath = join(folder, 'transport.crt')
  const openssl = process.platform === 'win32' ? 'openssl.exe' : '/usr/bin/openssl'
  await exec(openssl, [
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
        const path = join(build.directory, route.name)
        record.name = route.name
        record.bytes = (await stat(path)).size
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': record.bytes,
          'cache-control': 'no-store',
        })
        await pipeline(createReadStream(path), response)
      }
      record.completed = true
    } catch (error) {
      record.failure = `Controlled update transport failed: ${error.message}`
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
