import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('the packaged server reports the startup error message instead of only Error', () => {
  const artifact = process.env.BROCREW_CHROME_TEST_ARTIFACT
  expect(artifact, 'Build a fresh artifact and set BROCREW_CHROME_TEST_ARTIFACT').toBeTruthy()
  const payload = ['.', 'chrome-darwin-arm64', 'chrome-win32-x64']
    .map((part) => path.join(artifact!, part, 'package'))
    .find((dir) => fs.existsSync(path.join(dir, 'server.mjs')))
  expect(payload).toBeTruthy()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-startup-error-'))
  try {
    const auth = path.join(home, 'auth.json')
    fs.writeFileSync(auth, JSON.stringify({ mcpToken: 'a'.repeat(64), adminToken: 'b'.repeat(64) }), { mode: 0o600 })
    fs.writeFileSync(path.join(home, 'files'), 'a file cannot be the workspace directory')
    const env: NodeJS.ProcessEnv = { ...process.env, BROCREW_CHROME_DATA: home, BROCREW_CHROME_AUTH: auth }
    delete env.BROCREW_CHROME_SHARED
    const result = spawnSync(process.execPath, [path.join(payload!, 'server.mjs')], {
      cwd: home, env, encoding: 'utf8', timeout: 10000,
    })
    expect(result.status, result.stderr).toBe(1)
    expect(result.stderr).toContain('agent-chrome: cannot start: Plugin unavailable. Try again.')
    expect(result.stderr).not.toContain('agent-chrome: cannot start: Error\n')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
