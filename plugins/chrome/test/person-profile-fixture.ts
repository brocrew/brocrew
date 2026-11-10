import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startAgentChrome } from '../src/app.js'
import { loadConfig } from '../src/config.js'
import { createProfileStore } from '../src/profiles/store.js'
import { silentLogger } from '../src/logger.js'
import { FakeBrowser } from './fakes.js'

export async function personProfile(cleanup: Array<() => void | Promise<void>>) {
  const home = fs.mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-person-delete-'),
  )
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }))
  const mcpToken = 'fictional-mcp-'.repeat(8),
    adminToken = 'fictional-person-'.repeat(8)
  const authPath = join(home, 'fictional-auth.json')
  fs.writeFileSync(authPath, JSON.stringify({ mcpToken, adminToken }), { mode: 0o600 })
  const config = loadConfig({ BROCREW_CHROME_DATA: home, BROCREW_CHROME_AUTH: authPath })
  const store = createProfileStore({ home })
  const browser = new FakeBrowser(store.dirOf)
  const server = await startAgentChrome(config, { store, browser, logger: silentLogger })
  cleanup.push(() => server.close())
  store.create('fern', 'panel')
  const directory = store.dirOf('fern')
  fs.writeFileSync(join(directory, 'Cookies'), 'fictional cookies')
  const url = 'http://127.0.0.1:' + (server.httpServer.address() as { port: number }).port
  return { store, browser, directory, url, adminToken, mcpToken, server }
}
