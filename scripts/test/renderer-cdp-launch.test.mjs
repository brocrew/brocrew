import { once } from 'node:events'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { launchForCdp } from '../lib/renderer-cdp.mjs'

afterEach(() => vi.unstubAllEnvs())

it('keeps the requested argv and cwd, clears Electron node mode, and collects both output streams', async () => {
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
  const cwd = realpathSync(tmpdir())
  const launch = launchForCdp(
    process.execPath,
    [
      '-e',
      "process.stdout.write(JSON.stringify({cwd:process.cwd(),arg:process.argv[1],node:process.env.ELECTRON_RUN_AS_NODE??null}));process.stderr.write('probe diagnostic')",
      'two words',
    ],
    cwd,
  )
  const [code] = await once(launch.child, 'close')
  expect(code).toBe(0)
  const output = launch.output()
  expect(output).toContain(JSON.stringify({ cwd, arg: 'two words', node: null }))
  expect(output).toContain('probe diagnostic')
})
