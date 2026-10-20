import { createHash } from 'node:crypto'

/**
 * Where one of the plugin host's local servers listens: its socket file inside the private plugin
 * root, or on Windows a named pipe named from the server's secret key, which only this user can
 * read. Node gives its pipes Windows' default access list, under which other accounts may open a
 * pipe to read but never to write; so each server writes nothing before a client has proved it
 * holds the key, except one fresh random challenge.
 */
export function localEndpoint(
  socketPath: string,
  purpose: 'owner' | 'person',
  key: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return socketPath
  const name = createHash('sha256').update(`brocrew-plugin-${purpose}\0${key}`).digest('hex')
  return `\\\\.\\pipe\\brocrew-plugin-${purpose}-${name.slice(0, 32)}`
}

/** Whether endpoints are socket files, made private and removed by their path; pipes are not. */
export const isSocketFile = (platform: NodeJS.Platform = process.platform): boolean =>
  platform !== 'win32'
