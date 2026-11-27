import { expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { captureLog } from './lib/log-file'
import { setup, settingsCall } from './plugin-production-fixtures'

async function deepRoot(f: Awaited<ReturnType<typeof setup>>) {
  const home = join(dirname(f.options.root), `fictional-deep-home-${'d'.repeat(120)}`)
  await mkdir(home, { mode: 0o700 })
  const root = join(home, 'plugins')
  expect(Buffer.byteLength(join(root, 'supervisor', 'owner.sock'))).toBeGreaterThan(100)
  return root
}

it.skipIf(process.platform === 'win32')(
  'says the plugin folder path is too long when its service socket would not fit',
  async () => {
    const f = await setup()
    const root = await deepRoot(f)
    const captured = await captureLog()
    f.controller.start({ ...f.options, root })
    await f.controller.ready!()
    await expect(settingsCall(f.controller)({ kind: 'list' })).resolves.toEqual({
      ok: false,
      listState: 'fetch-error',
      reason: 'path-too-long',
    })
    const text = await captured.text()
    await captured.close()
    expect(text).toContain(
      "[plugins] path-too-long: The plugin folder's path is too long on this computer.",
    )
    expect(text).not.toContain('Check available disk space')
    expect(existsSync(root)).toBe(false)
    expect(f.fetch).not.toHaveBeenCalled()
    expect(f.supervisor.start).not.toHaveBeenCalled()
    await f.controller.close()
  },
)
