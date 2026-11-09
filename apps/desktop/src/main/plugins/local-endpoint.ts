import { createHash } from 'node:crypto'

/** A socket file, or a Windows pipe named from the server's routing identity. */
export function localEndpoint(
  socketPath: string,
  purpose: 'owner' | 'person',
  identity: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return socketPath
  const name = createHash('sha256').update(`brocrew-plugin-${purpose}\0${identity}`).digest('hex')
  return `\\\\.\\pipe\\brocrew-plugin-${purpose}-${name.slice(0, 32)}`
}

/** Whether endpoints are socket files removed by their path; pipes are not. */
export const isSocketFile = (platform: NodeJS.Platform = process.platform): boolean =>
  platform !== 'win32'
