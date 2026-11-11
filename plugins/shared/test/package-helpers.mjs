import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function packageTestHelpers(prefix) {
  const cleanup = []
  const temporary = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
    return root
  }
  const requestFor = (url) => async (endpoint, token, body, origin) => {
    const response = await fetch(url + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }
  async function connectClient(client, transport) {
    await client.connect(transport)
    cleanup.push(() => client.close())
    return client
  }
  return { cleanup, temporary, requestFor, connectClient }
}
