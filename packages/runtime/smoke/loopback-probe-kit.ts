import type { Server } from 'node:http'

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
