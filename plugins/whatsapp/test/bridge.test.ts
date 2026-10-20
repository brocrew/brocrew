import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { startBridge, type Bridge } from '../src/bridge.js'
import { loadConfig } from '../src/config.js'
import { silentLogger } from '../src/logger.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})

/** A stand-in for the Go program: it reads its configuration line, serves /status and /unlink, and records what it was given. */
const FAKE = `#!${process.execPath}
const http = require('node:http'), fs = require('node:fs'), path = require('node:path')
let line = '', started = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  line += chunk
  if (started || !line.includes('\\n')) return
  started = true
  const cfg = JSON.parse(line.slice(0, line.indexOf('\\n')))
  fs.writeFileSync(path.join(cfg.dataDir, 'fake-run.json'), JSON.stringify({
    pid: process.pid, cwd: process.cwd(), env: Object.keys(process.env).sort(), config: cfg,
  }))
  fs.writeFileSync(path.join(cfg.dataDir, 'session.db'), 'fictional session')
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer ' + cfg.token) { res.writeHead(401); res.end('{}'); return }
    res.writeHead(200, { 'content-type': 'application/json' })
    if (req.url === '/unlink') {
      fs.appendFileSync(path.join(cfg.dataDir, '..', 'fake-log-outs'), process.pid + '\\n')
      const confirmed = !fs.existsSync(path.join(cfg.dataDir, 'fake-unconfirmed'))
      setTimeout(() => { res.end(JSON.stringify({ ok: true, confirmed })); setTimeout(() => process.exit(3), 20) }, 300)
      return
    }
    if (req.url === '/groups') {
      if (fs.existsSync(path.join(cfg.dataDir, 'fake-groups-fail'))) { res.statusCode = 503; res.end('{}'); return }
      let body = ''
      req.on('data', (chunk) => body += chunk)
      req.on('end', () => {
        fs.appendFileSync(path.join(cfg.dataDir, 'fake-groups'), body + '\\n')
        res.end(JSON.stringify({ groups: [{ jid: '120363000000000001@g.us', name: 'ATLAS Team' }] }))
      })
      return
    }
    const linked = fs.existsSync(path.join(cfg.dataDir, 'fake-linked'))
    res.end(JSON.stringify({ state: linked ? 'linked' : 'unlinked', expired: false, account: '' }))
  })
  server.listen(0, '127.0.0.1', () => process.stdout.write(JSON.stringify({ listening: server.address().port }) + '\\n'))
})
process.stdin.on('end', () => process.exit(0))
`

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

function setup(program = FAKE, built = program) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-whatsapp-bridge-'))
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }))
  const authPath = path.join(home, 'fixture-auth.json')
  fs.writeFileSync(
    authPath,
    JSON.stringify({
      mcpToken: 'fictional-mcp-'.repeat(8),
      adminToken: 'fictional-person-'.repeat(8),
    }),
    { mode: 0o600 },
  )
  const config = loadConfig({ BROCREW_WHATSAPP_DATA: home, BROCREW_WHATSAPP_AUTH: authPath })
  const packaged = path.join(home, 'package-whatsapp-bridge')
  fs.writeFileSync(packaged, program, { mode: 0o400 })
  let unlinked = 0
  const begin = (): Bridge => {
    const started = startBridge({
      config,
      program: packaged,
      sha256: createHash('sha256').update(built).digest('hex'),
      logger: silentLogger,
      onUnlinked: () => unlinked++,
      pollMs: 50,
    })
    cleanup.push(() => started.close())
    return started
  }
  const bridge = begin()
  const run = () => {
    const file = path.join(config.bridgeData, 'fake-run.json')
    return fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, 'utf8')) as {
          pid: number
          cwd: string
          env: string[]
          config: Record<string, string>
        })
      : null
  }
  return { config, bridge, begin, run, unlinked: () => unlinked }
}

describe('the bridge program', () => {
  it('runs only the program whose SHA-256 the server was built with', async () => {
    const { bridge, config, run } = setup(FAKE, FAKE + '// another build\n')
    await until(() => bridge.status().state === 'unavailable')
    expect(fs.readdirSync(config.bin)).toEqual([])
    expect(run()).toBeNull()
    // Nothing reached WhatsApp, so the phone still lists the device.
    bridge.unlink()
    expect(bridge.status().removeOnPhone).toBe(true)
  })

  it('refreshes from the bridge even while the cached groups are fresh', async () => {
    const { bridge, config } = setup()
    await until(() => bridge.status().state === 'unlinked')
    await expect(bridge.refreshGroups()).rejects.toThrow()
    fs.writeFileSync(path.join(config.bridgeData, 'fake-linked'), '')
    await until(() => bridge.groups().length === 1)
    await bridge.refreshGroups()
    await bridge.refreshGroups()
    const requests = fs
      .readFileSync(path.join(config.bridgeData, 'fake-groups'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(requests.slice(-2)).toEqual([{ refresh: true }, { refresh: true }])
    expect(bridge.groups()).toEqual([{ jid: '120363000000000001@g.us', name: 'ATLAS Team' }])
    fs.writeFileSync(path.join(config.bridgeData, 'fake-groups-fail'), '')
    await expect(bridge.refreshGroups()).rejects.toThrow()
    expect(bridge.groups()).toEqual([{ jid: '120363000000000001@g.us', name: 'ATLAS Team' }])
  })

  it('runs an owner-only copy, with its folders and a fresh token on standard input only', async () => {
    const { bridge, config, run } = setup()
    await until(() => bridge.status().state === 'unlinked')
    const [copy] = fs.readdirSync(config.bin)
    expect(copy).toMatch(/^whatsapp-bridge-[0-9a-f]{16}$/)
    expect(fs.statSync(path.join(config.bin, copy)).mode & 0o777).toBe(0o700)
    const started = run()!
    expect(started.cwd).toBe(fs.realpathSync(config.bridgeData))
    // macOS adds __CF_USER_TEXT_ENCODING inside every process it starts; the server passes only these.
    expect(started.env.filter((name) => name !== '__CF_USER_TEXT_ENCODING')).toEqual([
      'HOME',
      'LC_ALL',
      'PATH',
      'TMPDIR',
    ])
    expect(started.config).toEqual({
      dataDir: config.bridgeData,
      filesDir: config.files,
      downloadsDir: config.downloads,
      scratchDir: config.scratch,
      token: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
  })

  it('after Log out, reads not linked at once, deletes the session and starts afresh with a new token', async () => {
    const { bridge, config, run, unlinked } = setup()
    await until(() => bridge.status().state === 'unlinked')
    fs.writeFileSync(path.join(config.bridgeData, 'fake-linked'), '')
    fs.writeFileSync(
      path.join(config.downloads, '0123456789abcdef_MSG00003.jpg'),
      'fictional photo',
    )
    fs.writeFileSync(path.join(config.scratch, 'upload-fictional'), 'fictional upload')
    await until(() => bridge.status().state === 'linked')
    const first = run()!
    const done = bridge.unlink()
    const seen = new Set<string>()
    await until(() => {
      seen.add(bridge.status().state)
      return unlinked() === 1 && run() !== null && run()!.pid !== first.pid
    })
    for (let i = 0; i < 5; i++) {
      seen.add(bridge.status().state)
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    expect([...seen]).toEqual(['unlinked'])
    expect(bridge.groups()).toEqual([])
    expect(bridge.status().removeOnPhone).toBe(false)
    await done
    expect(fs.readdirSync(config.downloads)).toEqual([])
    expect(fs.readdirSync(config.scratch)).toEqual([])
    expect(fs.existsSync(path.join(config.home, 'log-out.pending'))).toBe(false)
    expect(run()!.config.token).not.toBe(first.config.token)
    expect(fs.readFileSync(path.join(config.bridgeData, 'session.db'), 'utf8')).toBe(
      'fictional session',
    )
    expect(fs.statSync(config.bridgeData).mode & 0o777).toBe(0o700)
  })

  it('asks the person to remove the device on the phone only when WhatsApp did not confirm it, until the next link', async () => {
    const { bridge, config, run, unlinked } = setup()
    await until(() => bridge.status().state === 'unlinked')
    fs.writeFileSync(path.join(config.bridgeData, 'fake-linked'), '')
    fs.writeFileSync(path.join(config.bridgeData, 'fake-unconfirmed'), '')
    await until(() => bridge.status().state === 'linked')
    const first = run()!
    bridge.unlink()
    expect(bridge.status().removeOnPhone).toBe(false)
    await until(() => unlinked() === 1 && run() !== null && run()!.pid !== first.pid)
    await until(() => bridge.status().state === 'unlinked')
    expect(bridge.status()).toMatchObject({ state: 'unlinked', removeOnPhone: true })
    // The restarted bridge takes a moment to listen; the person's next Link a phone starts a new link.
    let linking = false
    for (const end = Date.now() + 10_000; !linking && Date.now() < end;) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      linking = await bridge.pair()
    }
    expect(linking).toBe(true)
    expect(bridge.status().removeOnPhone).toBe(false)
  })

  it('finishes at the next start a Log out the app quit during: WhatsApp first, then the wipe', async () => {
    const { bridge, begin, config, run, unlinked } = setup()
    await until(() => bridge.status().state === 'unlinked')
    fs.writeFileSync(path.join(config.bridgeData, 'fake-linked'), '')
    fs.writeFileSync(path.join(config.bridgeData, 'messages.db'), 'fictional messages')
    fs.writeFileSync(
      path.join(config.downloads, '0123456789abcdef_MSG00003.jpg'),
      'fictional photo',
    )
    await until(() => bridge.status().state === 'linked')
    void bridge.unlink()
    // The app quits while the bridge is still logging out: nothing is wiped yet.
    await until(() => fs.existsSync(path.join(config.home, 'fake-log-outs')))
    await bridge.close()
    expect(unlinked()).toBe(0)
    expect(fs.existsSync(path.join(config.bridgeData, 'messages.db'))).toBe(true)
    const next = begin()
    expect(next.status().state).toBe('unlinked')
    await until(() => unlinked() === 1)
    expect(
      fs.readFileSync(path.join(config.home, 'fake-log-outs'), 'utf8').trim().split('\n'),
    ).toHaveLength(2)
    expect(fs.existsSync(path.join(config.bridgeData, 'messages.db'))).toBe(false)
    expect(fs.readdirSync(config.downloads)).toEqual([])
    expect(fs.existsSync(path.join(config.home, 'log-out.pending'))).toBe(false)
    await until(() => run() !== null && next.status().state === 'unlinked')
  })

  it('restarts a bridge that stops, and stops it when the server closes', async () => {
    const { bridge, run, unlinked } = setup()
    await until(() => bridge.status().state === 'unlinked')
    const first = run()!
    process.kill(first.pid, 'SIGKILL')
    await until(() => bridge.status().state === 'unavailable')
    await until(() => run()!.pid !== first.pid && bridge.status().state === 'unlinked')
    expect(unlinked()).toBe(0)
    const second = run()!.pid
    await bridge.close()
    expect(() => process.kill(second, 0)).toThrow()
  })
})
