import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig as chromeConfig } from '../../../plugins/chrome/src/config'
import { loadConfig as whatsAppConfig } from '../../../plugins/whatsapp/src/config'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
describe.skipIf(process.platform === 'win32')('normal plugin folder permissions', () => {
  it.each([
    ['CHROME', chromeConfig],
    ['WHATSAPP', whatsAppConfig],
  ] as const)('opens %s with readable fake auth and leaves the folder mode unchanged', (name, load) => {
    const home = mkdtempSync(join(tmpdir(), 'normal-plugin-'))
    roots.push(home)
    const authPath = join(home, 'fictional-auth.json')
    writeFileSync(authPath, JSON.stringify({ mcpToken: 'fictional-mcp-'.repeat(4), adminToken: 'fictional-admin-'.repeat(4) }))
    chmodSync(home, 0o755)
    chmodSync(authPath, 0o644)
    const config = load({ [`BROCREW_${name}_DATA`]: home, [`BROCREW_${name}_AUTH`]: authPath })
    expect(config.home).toBe(home)
    expect(config.token).toBe('fictional-mcp-'.repeat(4))
    expect(statSync(home).mode & 0o777).toBe(0o755)
    expect(statSync(authPath).mode & 0o777).toBe(0o644)
  })
})
