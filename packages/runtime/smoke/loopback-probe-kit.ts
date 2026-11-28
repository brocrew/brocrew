import { readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { codexAppServerArgs } from '../src/codex/codex-runtime'
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { bundledCodexBinary } from './bundled-codex'
import { join } from 'node:path'

/**
 * The few pieces every loopback capture probe wrote for itself: the Codex provider stanza that
 * points the product at a capture server, the port read back out of it, and an owned `listen(0)`.
 * Each probe keeps what is its own (the model, the name it shows, the key variable, its measure and
 * its capture); only the text and steps that were identical live here.
 */

/** What differs between probes' capture stanzas; everything else in the stanza is shared. */
interface CaptureStanza {
  readonly port: number
  readonly model: string
  /** The `name` the stanza shows, which says which probe's capture this is. */
  readonly name: string
  /** The environment variable the stanza asks for its key in. */
  readonly envKey: string
}

/** A Codex `config.toml` that sends the model through the capture server on `port`, with no retries. */
export function captureProviderStanza({ port, model, name, envKey }: CaptureStanza): string {
  return [
    `model = "${model}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    `name = "${name}"`,
    `base_url = "http://127.0.0.1:${port}/v1"`,
    `env_key = "${envKey}"`,
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

/**
 * ⚑ Rule 40: the port the child was CONFIGURED with, read back from the config it reads; `null` when
 * the config names no loopback port.
 */
export function configuredPortOf(config: string): number | null {
  const match = /^base_url = "http:\/\/127\.0\.0\.1:(\d+)\/v1"$/m.exec(config)
  return match === null ? null : Number(match[1])
}

/** {@link configuredPortOf} for the `config.toml` in a Codex home the probe launched with. */
export function configuredPortOfHome(home: string): number | null {
  return configuredPortOf(readFileSync(join(home, 'config.toml'), 'utf8'))
}

/** Listen on an owned loopback port and return it. */
export async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return address.port
}

/**
 * Bounded, standing rule 13: a request that never answers is NOT PERFORMED, never waited on. One
 * deadline, set once by the probe, and the returned function bounds any one request to it.
 */
export function boundedBy(deadlineMs: number): <T>(what: string, work: Promise<T>) => Promise<T> {
  return async <T>(what: string, work: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`NOT PERFORMED — ${what} did not answer in ${deadlineMs}ms`)),
            deadlineMs,
          )
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/** ⛔ Every `await` on a launch or a turn is bounded; a stall is NOT PERFORMED, never waited on. */
export async function bounded<T>(
  what: string,
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const giveUp = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work(giveUp.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          giveUp.abort()
          reject(new Error(`NOT PERFORMED — ${what} did not finish in ${String(ms)}ms`))
        }, ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Wait, bounded, until `done()` holds. */
export const until = async (what: string, ms: number, done: () => boolean): Promise<void> =>
  await bounded(what, ms, async (signal) => {
    while (!done() && !signal.aborted) await new Promise((resolve) => setTimeout(resolve, 10))
  })

/** ⚑ Rule 40: the port the child is configured with must be the one the endpoint listens on. */
export function assertConfiguredPort(configured: number | null, listenedOn: number): void {
  if (configured !== listenedOn) {
    throw new Error(
      `NOT PERFORMED — the config names port ${String(configured)}, the endpoint is on ${String(listenedOn)}`,
    )
  }
}

/** The environment a capture probe's child gets: its own home and the loopback provider's key. */
function captureChildEnv(
  root: string,
  codexHome: string,
  keyVariable: string,
): Record<string, string> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: root,
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome,
    [keyVariable]: 'probe-only',
  }
}

/** The transport's own close: `close()` ends stdin, waits `EXIT_GRACE_MS`, then SIGTERM and SIGKILL each wait `KILL_GRACE_MS`. */
export const EXIT_GRACE_MS = 2_000
export const KILL_GRACE_MS = 2_000

/** The real `codex app-server` child a capture probe spawns, in its own home and with the loopback key. */
export function spawnCaptureChild(
  cwd: string,
  root: string,
  codexHome: string,
  keyVariable: string,
): SpawnCodexTransport {
  return new SpawnCodexTransport(bundledCodexBinary(), codexAppServerArgs(), {
    cwd,
    env: captureChildEnv(root, codexHome, keyVariable),
    exitGraceMs: EXIT_GRACE_MS,
    killGraceMs: KILL_GRACE_MS,
  })
}
