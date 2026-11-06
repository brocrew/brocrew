import type { Server } from 'node:http'

export async function listenLoopback(
  server: Server,
  options: {
    waitForListening?: (listening: Promise<void>) => Promise<void>
    missingPortMessage?: string
  } = {},
): Promise<number> {
  const listening = new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  await (options.waitForListening ? options.waitForListening(listening) : listening)
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error(options.missingPortMessage ?? 'no loopback port')
  }
  return address.port
}

export function captureProviderStanza(
  port: number,
  options: { model: string; name: string; envKey: string },
): string {
  return [
    `model = "${options.model}"`,
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    `name = "${options.name}"`,
    `base_url = "http://127.0.0.1:${port}/v1"`,
    `env_key = "${options.envKey}"`,
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}
