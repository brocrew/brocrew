import { PluginSupervisorError } from '../supervisor/protocol'

export async function readAdminJson(
  url: string,
  headers: { Authorization: string },
  signal: AbortSignal,
  maxBytes: number,
): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
  })
  if (!response.ok) {
    const reply = await response.json()
    throw new Error(
      typeof reply === 'object' && reply !== null && 'error' in reply && reply.error != null
        ? String(reply.error)
        : `Plugin configuration read failed (${response.status}).`,
    )
  }
  if (!response.body) throw new PluginSupervisorError('unavailable')
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      bytes += next.value.byteLength
      if (bytes > maxBytes) throw new PluginSupervisorError('unavailable')
      parts.push(next.value)
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
