import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline'
import type { WhatsAppConfig } from './config.js'
import { privateDirectory } from './config.js'
import type { Logger } from './logger.js'
import { GROUP_ID } from './settings.js'

export type BridgeState =
  'starting' | 'unlinked' | 'pairing' | 'connecting' | 'linked' | 'unavailable'
export interface BridgeQr {
  size: number
  bits: string
  expiresAt: number
}
export interface BridgeStatus {
  state: BridgeState
  /** The last code ran out before a phone scanned it. */
  expired: boolean
  account: string
  qr: BridgeQr | null
  /** The last Log out cleared this side only: WhatsApp didn't confirm the device's removal. */
  removeOnPhone: boolean
}
export interface BridgeGroup {
  jid: string
  name: string
}
export interface BridgeReply {
  status: number
  body: unknown
}
export class BridgeUnavailable extends Error {}

/** The Go program that holds the WhatsApp session. Everything WhatsApp goes through it. */
export interface Bridge {
  status(): BridgeStatus
  /** The account's groups as last read, while linked. */
  groups(): readonly BridgeGroup[]
  refreshGroups(): Promise<void>
  call(
    route: string,
    body: unknown,
    options: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<BridgeReply>
  /** Starts showing QR codes. */
  pair(): Promise<boolean>
  /**
   * Logs this device out, then deletes the session, the messages and the downloads. It resolves once they are gone;
   * a log out the app quits during is finished at the next start.
   */
  unlink(): Promise<void>
  close(): Promise<void>
}

const REPLY_BYTES = 8 * 1024 * 1024
const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000]
const EXIT_UNLINKED = 3
const STATES: readonly string[] = ['unlinked', 'pairing', 'connecting', 'linked']
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')
const unavailableStatus = (state: BridgeState): BridgeStatus => ({
  state,
  expired: false,
  account: '',
  qr: null,
  removeOnPhone: false,
})

function parseStatus(value: unknown): BridgeStatus | null {
  const view = value as Partial<{ state: unknown; expired: unknown; account: unknown; qr: unknown }>
  if (!view || typeof view.state !== 'string' || !STATES.includes(view.state)) return null
  const qr = view.qr as Partial<BridgeQr> | undefined
  const validQr =
    qr !== undefined &&
    Number.isInteger(qr.size) &&
    qr.size! >= 21 &&
    qr.size! <= 177 &&
    typeof qr.bits === 'string' &&
    qr.bits.length === qr.size! * qr.size! &&
    /^[01]+$/.test(qr.bits) &&
    Number.isSafeInteger(qr.expiresAt)
  return {
    state: view.state as BridgeState,
    expired: view.expired === true,
    account: typeof view.account === 'string' ? view.account.slice(0, 120) : '',
    qr: view.state === 'pairing' && validQr ? (qr as BridgeQr) : null,
    removeOnPhone: false,
  }
}

function parseGroups(value: unknown): BridgeGroup[] | null {
  const groups = (value as { groups?: unknown } | null)?.groups
  if (!Array.isArray(groups)) return null
  return groups
    .filter(
      (one): one is BridgeGroup =>
        typeof one?.jid === 'string' && GROUP_ID.test(one.jid) && typeof one.name === 'string',
    )
    .slice(0, 1024)
    .map((one) => ({ jid: one.jid, name: one.name.slice(0, 120) }))
}

async function readBounded(response: Response): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return null
  const parts: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > REPLY_BYTES) throw new BridgeUnavailable()
      parts.push(next.value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  return JSON.parse(Buffer.concat(parts).toString('utf8'))
}

/**
 * Copies the packaged program into the private bin folder as an owner-only executable, but only when
 * its bytes are the ones this server was built with. The package's own files are read-only. The copy
 * keeps the program's extension: Windows starts no program file without one, such as `.exe`.
 */
async function installProgram(program: string, expected: string, bin: string): Promise<string> {
  const bytes = await fs.promises.readFile(program)
  if (sha256(bytes) !== expected) throw new BridgeUnavailable()
  const target = path.join(bin, `whatsapp-bridge-${expected.slice(0, 16)}${path.extname(program)}`)
  const present = fs.lstatSync(target, { throwIfNoEntry: false })
  if (present?.isFile() && sha256(await fs.promises.readFile(target)) === expected) {
    fs.chmodSync(target, 0o700)
    return target
  }
  fs.rmSync(target, { force: true, recursive: true })
  const stage = path.join(bin, `.stage-${randomBytes(8).toString('hex')}`)
  fs.writeFileSync(stage, bytes, { mode: 0o700, flag: 'wx' })
  fs.renameSync(stage, target)
  // Windows refuses to delete a program that is still running; an old copy goes at a later start.
  for (const name of fs.readdirSync(bin))
    if (name !== path.basename(target))
      try {
        fs.rmSync(path.join(bin, name), { force: true })
      } catch {
        /* Left for the next start. */
      }
  return target
}

/**
 * The bridge's whole environment. On Windows it also needs the system folder and PATH the host gave
 * this server (sockets cannot start without SystemRoot), and finds its temporary folder in TEMP and TMP.
 */
function bridgeEnvironment(config: WhatsAppConfig): NodeJS.ProcessEnv {
  if (process.platform !== 'win32')
    return { HOME: config.home, TMPDIR: config.scratch, PATH: '/usr/bin:/bin', LC_ALL: 'C' }
  const system = ['SystemRoot', 'windir', 'SystemDrive', 'PATH'].flatMap((name) => {
    const value = process.env[name]
    return value ? [[name, value]] : []
  })
  return {
    ...Object.fromEntries(system),
    HOME: config.home,
    TEMP: config.scratch,
    TMP: config.scratch,
    LC_ALL: 'C',
  }
}

export function startBridge(options: {
  config: WhatsAppConfig
  /** The bridge program inside the installed package. */
  program: string
  /** The SHA-256 the program had when this server was built. */
  sha256: string
  logger: Logger
  /** The device is no longer linked and its data is gone. */
  onUnlinked: () => void
  pollMs?: number
}): Bridge {
  const { config, logger } = options
  let child: ChildProcess | undefined
  let port = 0
  let token = ''
  let status = unavailableStatus('starting')
  let groups: BridgeGroup[] = []
  let groupsAt = 0
  let closing = false
  let wipeOnExit = false
  let failures = 0
  let startedAt = 0
  let pollTimer: NodeJS.Timeout | undefined
  let launchTimer: NodeJS.Timeout | undefined
  let polling = false
  // Kept until the next link starts; the bridge itself never knows.
  let removeOnPhone = false
  let logoutAnswered = false
  const wiped: Array<() => void> = []
  // Written before a log out starts and removed after the wipe, so a quit in between is finished at the next start.
  const pending = path.join(config.home, 'log-out.pending')
  if (fs.existsSync(pending)) {
    wipeOnExit = true
    status = unavailableStatus('unlinked')
  }

  const later = (ms: number, fn: () => void): NodeJS.Timeout => {
    const handle = setTimeout(fn, ms)
    handle.unref()
    return handle
  }
  const relaunch = (ms: number) => {
    clearTimeout(launchTimer)
    if (!closing) launchTimer = later(ms, () => void launch())
  }

  async function call(
    route: string,
    body: unknown,
    { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs: number },
  ): Promise<BridgeReply> {
    if (!port || !child) throw new BridgeUnavailable()
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]),
    }).catch(() => {
      throw new BridgeUnavailable()
    })
    return { status: response.status, body: await readBounded(response) }
  }

  async function poll(): Promise<void> {
    if (polling || closing || !port) return
    polling = true
    try {
      const reply = await call('/status', undefined, { timeoutMs: 2000 })
      const next = reply.status === 200 ? parseStatus(reply.body) : null
      // After Log out the page and the tools read "not linked" at once, while the bridge finishes logging out.
      if (next && !wipeOnExit) status = next
      if (!wipeOnExit && next?.state === 'linked' && Date.now() - groupsAt > 30_000) {
        const listed = await call('/groups', {}, { timeoutMs: 15_000 })
        const parsed = listed.status === 200 ? parseGroups(listed.body) : null
        if (parsed) {
          groups = parsed
          groupsAt = Date.now()
        }
      } else if (next?.state === 'unlinked' || next?.state === 'pairing') {
        // While it reconnects, the account's groups stay as last read.
        groups = []
        groupsAt = 0
      }
      if (startedAt && Date.now() - startedAt > 60_000) failures = 0
    } catch {
      // The next poll tries again; the process's exit is what marks the bridge unavailable.
    } finally {
      polling = false
      clearTimeout(pollTimer)
      if (!closing && port)
        pollTimer = later(
          status.state === 'pairing' ? 1000 : (options.pollMs ?? 3000),
          () => void poll(),
        )
    }
  }

  function wipe(): void {
    for (const dir of [config.bridgeData, config.downloads, config.scratch]) {
      fs.rmSync(dir, { recursive: true, force: true })
      privateDirectory(dir)
    }
    groups = []
    groupsAt = 0
    options.onUnlinked()
    fs.rmSync(pending, { force: true })
    for (const done of wiped.splice(0)) done()
  }

  /** Asks the running bridge to log out on WhatsApp's side; it exits when done, and its exit wipes. */
  function sendLogout(running: ChildProcess): void {
    logoutAnswered = false
    // The bridge may wait 15 seconds for a connection, then 10 for WhatsApp to confirm the logout.
    void call('/unlink', {}, { timeoutMs: 35_000 })
      .then(
        (reply) =>
          reply.status === 200 &&
          (reply.body as { confirmed?: unknown } | null)?.confirmed === true,
      )
      .catch(() => false)
      .then((confirmed) => {
        logoutAnswered = true
        removeOnPhone = !confirmed
        if (child === running) running.kill('SIGTERM')
      })
  }

  async function launch(): Promise<void> {
    if (closing) return
    if (status.state !== 'unlinked') status = unavailableStatus('starting')
    let program: string
    try {
      program = await installProgram(options.program, options.sha256, config.bin)
    } catch {
      logger.error('bridge program refused')
      if (wipeOnExit) {
        // A log out can't reach WhatsApp without the bridge; this side is still cleared.
        wipeOnExit = false
        removeOnPhone = true
        wipe()
      }
      status = unavailableStatus('unavailable')
      return
    }
    if (closing) return
    token = randomBytes(32).toString('hex')
    const started = spawn(program, [], {
      cwd: config.bridgeData,
      env: bridgeEnvironment(config),
      stdio: ['pipe', 'pipe', 'ignore'],
      // Windows would otherwise open a console window for the program.
      windowsHide: true,
    })
    child = started
    startedAt = Date.now()
    started.stdin!.on('error', () => undefined)
    started.stdin!.write(
      JSON.stringify({
        dataDir: config.bridgeData,
        filesDir: config.files,
        downloadsDir: config.downloads,
        scratchDir: config.scratch,
        token,
      }) + '\n',
    )
    const lines = createInterface({ input: started.stdout! })
    const ready = setTimeout(() => started.kill('SIGTERM'), 30_000)
    lines.once('line', (line) => {
      clearTimeout(ready)
      try {
        const announced = (JSON.parse(line) as { listening?: unknown }).listening
        if (!Number.isInteger(announced) || (announced as number) <= 0) throw new Error()
        port = announced as number
        if (wipeOnExit) sendLogout(started)
        void poll()
      } catch {
        started.kill('SIGTERM')
      }
    })
    let ended = false
    const end = (code: number | null) => {
      if (ended) return
      ended = true
      clearTimeout(ready)
      lines.close()
      if (child === started) {
        child = undefined
        port = 0
      }
      if (closing) return
      if (code === EXIT_UNLINKED || wipeOnExit) {
        // A log out that ended with no answer from the bridge was not confirmed by WhatsApp.
        if (wipeOnExit && !logoutAnswered) removeOnPhone = true
        wipeOnExit = false
        failures = 0
        logger.info('bridge unlinked')
        wipe()
        status = unavailableStatus('unlinked')
        relaunch(0)
        return
      }
      logger.warn('bridge stopped', { code })
      status = unavailableStatus('unavailable')
      const wait = BACKOFF_MS[Math.min(failures, BACKOFF_MS.length - 1)]
      failures++
      relaunch(wait)
    }
    // A program that cannot start reports an error and may never report an exit.
    started.once('error', () => end(null))
    started.once('exit', (code) => end(code))
  }

  void launch()
  return {
    status: () => ({ ...status, removeOnPhone }),
    groups: () => groups,
    async refreshGroups() {
      if (status.state !== 'linked' || wipeOnExit || closing) throw new BridgeUnavailable()
      const running = child
      const reply = await call('/groups', { refresh: true }, { timeoutMs: 4000 })
      const parsed = reply.status === 200 ? parseGroups(reply.body) : null
      if (!parsed || child !== running || status.state !== 'linked' || wipeOnExit || closing)
        throw new BridgeUnavailable()
      groups = parsed
      groupsAt = Date.now()
    },
    call,
    async pair() {
      try {
        // Inside the five seconds the app gives a settings change.
        const reply = await call('/pair', {}, { timeoutMs: 4500 })
        const next = reply.status === 200 ? parseStatus(reply.body) : null
        if (next) {
          status = next
          removeOnPhone = false
        }
        return next !== null
      } catch {
        return false
      }
    },
    unlink() {
      const done = new Promise<void>((resolve) => wiped.push(resolve))
      if (wipeOnExit) return done
      wipeOnExit = true
      status = unavailableStatus('unlinked')
      groups = []
      groupsAt = 0
      fs.writeFileSync(pending, '', { mode: 0o600 })
      const running = child
      if (!running) {
        wipeOnExit = false
        removeOnPhone = true
        wipe()
        relaunch(0)
      } else if (port) sendLogout(running)
      // A bridge that is still starting logs out as soon as it listens.
      return done
    },
    async close() {
      closing = true
      clearTimeout(pollTimer)
      clearTimeout(launchTimer)
      const running = child
      if (!running) return
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => running.kill('SIGKILL'), 6000)
        running.once('exit', () => {
          clearTimeout(force)
          resolve()
        })
        running.stdin?.end()
      })
    },
  }
}
